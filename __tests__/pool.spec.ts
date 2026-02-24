import { describe, test, it, expect, vi } from 'vitest'
import { pass } from '@blackglory/prelude'
import { Pool } from '@src/pool.js'
import { getErrorAsync } from 'return-style'
import { Deferred, StatefulPromise, StatefulPromiseState } from 'extra-promise'
import { waitForAllMacrotasksProcessed, waitForTimeout } from '@blackglory/wait-for'

const TIME_ERROR = 1

describe('Pool', () => {
  describe('create', () => {
    describe('pool does not automatically create minimum number of instances', () => {
      test('options.minInstances = 0', () => {
        const create = vi.fn()

        const pool = new Pool({
          create
        , minInstances: 0
        })

        expect(create).not.toBeCalled()
        expect(pool.size).toBe(0)
      })

      test('options.minInstances > 0', () => {
        const create = vi.fn()

        const pool = new Pool({
          create
        , minInstances: 0
        })

        expect(create).not.toBeCalled()
        expect(pool.size).toBe(0)
      })
    })
  })

  describe('destroy', () => {
    describe('pool is busy', () => {
      it('blocks until a pool is idle', async () => {
        const create = vi.fn()
        const destroy = vi.fn()
        const pool = new Pool({
          create
        , destroy
        })
        const deferred = new Deferred<void>()
        pool.use(() => deferred)
        // 确保是先调用了use, 然后才执行的destroy.
        await waitForAllMacrotasksProcessed()

        const promise = StatefulPromise.from(pool.destroy())
        await Promise.resolve()
        const state1 = promise.state
        deferred.resolve()
        await promise
        const state2 = promise.state

        expect(state1).toBe(StatefulPromiseState.Pending)
        expect(state2).toBe(StatefulPromiseState.Fulfilled)
      })
    })

    describe('pool is idle', () => {
      describe('with options.destroy', () => {
        test('without idle instances', async () => {
          const create = vi.fn()
          const destroy = vi.fn()
          const pool = new Pool({
            create
          , destroy
          , minInstances: 0
          })

          await pool.destroy()

          expect(destroy).not.toBeCalled()
          expect(pool.size).toBe(0)
        })

        test('with idle instances', async () => {
          const create = vi.fn()
          const destroy = vi.fn()
          const pool = new Pool({
            create
          , destroy
          , minInstances: 1
          })
          await pool.use(pass)

          await pool.destroy()

          expect(destroy).toBeCalledTimes(1)
          expect(pool.size).toBe(0)
        })
      })

      describe('without options.destroy', () => {
        test('without idle instances', async () => {
          const create = vi.fn()
          const pool = new Pool({
            create
          , minInstances: 0
          })

          await pool.destroy()

          expect(pool.size).toBe(0)
        })

        test('with idle instances', async () => {
          const create = vi.fn()
          const pool = new Pool({
            create
          , minInstances: 1
          })
          await pool.use(pass)

          await pool.destroy()

          expect(pool.size).toBe(0)
        })
      })
    })
  })

  describe('prewarm', () => {
    test('general', async () => {
      const create = vi.fn()
      const pool = new Pool({
        create
        // 由于负载均衡, 即使concurrencyPerInstance大于1, 也只需调用10次.
      , concurrencyPerInstance: 2
      , idleTimeout: 1000
      })

      await pool.prewarm(10)

      expect(create).toBeCalledTimes(10)
      expect(pool.size).toBe(10)
    })

    test('edge: idleTimeout = 0', async () => {
      const create = vi.fn()
      const pool = new Pool({
        create
      , concurrencyPerInstance: 1
      , idleTimeout: 0
      })

      await pool.prewarm(10)

      expect(create).toBeCalledTimes(10)
      // 由于idleTimeout被设置为0, 在预热完毕后就销毁所有创建好的实例.
      expect(pool.size).toBe(0)
    })
  })

  describe('use', () => {
    test('user returns a value', async () => {
      const internalInstance = {}
      const create = vi.fn()
      const pool = new Pool({ create })

      const result = await pool.use(() => internalInstance)

      expect(result).toBe(internalInstance)
    })

    test('user throws an error', async () => {
      const customError = new Error('custom error')
      const create = vi.fn()
      const pool = new Pool({ create })

      const err = await getErrorAsync(() => pool.use(() => {
        throw customError
      }))

      expect(err).toBe(customError)
    })

    test('reuse', async () => {
      const internalInstance = {}
      const create = vi.fn(() => internalInstance)
      const pool = new Pool({
        create
      , maxInstances: 1
      , minInstances: 1
      })
      await pool.use(() => internalInstance)

      const result = await pool.use(internalInstance => internalInstance)

      expect(create).toBeCalledTimes(1)
      expect(result).toBe(internalInstance)
    })

    describe('concurrencyPerInstance', () => {
      test('users < concurrency', async () => {
        const create = vi.fn()
        const pool = new Pool({
          create
        , concurrencyPerInstance: 2
        })

        const deferred = new Deferred<void>()
        const promise1 = pool.use(() => deferred)
        const promise2 = pool.use(() => deferred)
        const size = pool.size
        deferred.resolve()
        await Promise.all([promise1, promise2])

        expect(size).toBe(1)
      })

      test('users = concurrency', async () => {
        const create = vi.fn()
        const pool = new Pool({
          create
        , concurrencyPerInstance: 2
        })

        const deferred = new Deferred<void>()
        const promise1 = pool.use(() => deferred)
        const promise2 = pool.use(() => deferred)
        const promise3 = pool.use(() => deferred)
        const size = pool.size
        deferred.resolve()
        await Promise.all([promise1, promise2, promise3])

        expect(size).toBe(2)
      })
    })

    describe('use when pool does not have idle instances', () => {
      describe('number of instances < maxInstances', () => {
        it('construct a new instance', async () => {
          const internalInstance = {}
          const create = vi.fn(() => internalInstance)
          const pool = new Pool({
            create
          , maxInstances: Infinity
          })

          const result = await pool.use(internalInstance => internalInstance)

          expect(create).toBeCalledTimes(1)
          expect(result).toBe(internalInstance)
        })
      })

      describe('number of instances = maxInstances', () => {
        it('wait for an idle instance', async () => {
          const internalInstance = {}
          const create = vi.fn(() => internalInstance)
          const pool = new Pool({
            create
          , maxInstances: 1
          })
          const deferred = new Deferred<void>()
          pool.use(() => deferred)

          const result = StatefulPromise.from(pool.use(internalInstance => internalInstance))
          await Promise.resolve()
          const state1 = result.state
          deferred.resolve()
          const proResult = await result
          const state2 = result.state

          expect(create).toBeCalledTimes(1)
          expect(state1).toBe(StatefulPromiseState.Pending)
          expect(state2).toBe(StatefulPromiseState.Fulfilled)
          expect(proResult).toBe(internalInstance)
        })
      })
    })
  })

  test('capacity', () => {
    const create = vi.fn()
    const destroy = vi.fn()
    const pool = new Pool({
      create
    , destroy
    , maxInstances: 1
    })

    const result = pool.capacity

    expect(result).toBe(1)
  })

  describe('size', () => {
    test('minInstances === 0', async () => {
      const create = vi.fn()
      const destroy = vi.fn()
      const pool = new Pool({
        create
      , destroy
      , minInstances: 0
      })
      await pool.use(pass)

      const result = pool.size

      expect(result).toBe(0)
      expect(destroy).toBeCalledTimes(1)
    })

    test('minInstances !== 0', async () => {
      const create = vi.fn()
      const destroy = vi.fn()
      const pool = new Pool({
        create
      , destroy
      , minInstances: 1
      })
      await pool.use(pass)

      const result = pool.size

      expect(result).toBe(1)
      expect(destroy).not.toBeCalled()
    })
  })

  describe('delete instance', () => {
    test('deleted', async () => {
      const create = vi.fn()
      const destroy = vi.fn()
      const pool = new Pool({
        create
      , destroy
      , idleTimeout: 1000
      , minInstances: 0
      })
      await pool.use(pass)

      const result1 = pool.size
      await waitForTimeout(1000 + TIME_ERROR)
      const result2 = pool.size

      expect(result1).toBe(1)
      expect(result2).toBe(0)
      expect(destroy).toBeCalledTimes(1)
    })

    test('cancel scheduled deletion', async () => {
      const create = vi.fn()
      const destroy = vi.fn()
      const pool = new Pool({
        create
      , destroy
      , idleTimeout: 1000
      , minInstances: 0
      })
      await pool.use(pass)

      const result1 = pool.size
      await waitForTimeout(500 + TIME_ERROR)
      await pool.use(pass)
      await waitForTimeout(500 + TIME_ERROR)
      const result2 = pool.size

      expect(result1).toBe(1)
      expect(result2).toBe(1)
      expect(destroy).toBeCalledTimes(0)
    })
  })
})
