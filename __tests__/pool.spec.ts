import { pass } from '@blackglory/prelude'
import { Pool } from '@src/pool'
import { getErrorAsync } from 'return-style'
import { Deferred, StatefulPromise, StatefulPromiseState, delay } from 'extra-promise'

describe('Pool', () => {
  describe('create', () => {
    describe('pool does not automatically create minimum number of instances', () => {
      test('options.minInstances = 0', () => {
        const create = jest.fn()

        const pool = new Pool({
          create
        , minInstances: 0
        })

        expect(create).not.toBeCalled()
        expect(pool.size).toBe(0)
      })

      test('options.minInstances > 0', () => {
        const create = jest.fn()

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
        const create = jest.fn()
        const destroy = jest.fn()
        const pool = new Pool({
          create
        , destroy
        })
        const deferred = new Deferred<void>()
        pool.use(() => deferred)
        // 确保是先调用了use, 然后才执行的destroy
        await delay(100)

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
          const create = jest.fn()
          const destroy = jest.fn()
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
          const create = jest.fn()
          const destroy = jest.fn()
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
          const create = jest.fn()
          const pool = new Pool({
            create
          , minInstances: 0
          })

          await pool.destroy()

          expect(pool.size).toBe(0)
        })

        test('with idle instances', async () => {
          const create = jest.fn()
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

  describe('use', () => {
    test('user returns a value', async () => {
      const value = {}
      const create = jest.fn()
      const pool = new Pool({ create })

      const result = await pool.use(() => value)

      expect(result).toBe(value)
    })

    test('user throws an error', async () => {
      const customError = new Error('custom error')
      const create = jest.fn()
      const pool = new Pool({ create })

      const err = await getErrorAsync(() => pool.use(() => {
        throw customError
      }))

      expect(err).toBe(customError)
    })

    test('reuse', async () => {
      const value = {}
      const create = jest.fn(() => value)
      const pool = new Pool({
        create
      , maxInstances: 1
      , minInstances: 1
      })
      await pool.use(() => value)

      const result = await pool.use(value => value)

      expect(create).toBeCalledTimes(1)
      expect(result).toBe(value)
    })

    describe('concurrencyPerInstance', () => {
      test('users < concurrency', async () => {
        const create = jest.fn()
        const pool = new Pool({
          create
        , concurrencyPerInstance: 2
        })

        const promise1 = pool.use(() => delay(100))
        const promise2 = pool.use(() => delay(100))
        const size = pool.size
        await promise1
        await promise2

        expect(size).toBe(1)
      })

      test('users = concurrency', async () => {
        const create = jest.fn()
        const pool = new Pool({
          create
        , concurrencyPerInstance: 2
        })

        const promise1 = pool.use(() => delay(100))
        const promise2 = pool.use(() => delay(100))
        const promise3 = pool.use(() => delay(100))
        const size = pool.size
        await promise1
        await promise2
        await promise3

        expect(size).toBe(2)
      })
    })

    describe('use when pool does not have idle instances', () => {
      describe('number of instances < maxInstances', () => {
        it('construct a new instance', async () => {
          const value = {}
          const create = jest.fn(() => value)
          const pool = new Pool({
            create
          , maxInstances: Infinity
          })

          const result = await pool.use(value => value)

          expect(create).toBeCalledTimes(1)
          expect(result).toBe(value)
        })
      })

      describe('number of instances = maxInstances', () => {
        it('wait for an idle instance', async () => {
          const value = {}
          const create = jest.fn(() => value)
          const pool = new Pool({
            create
          , maxInstances: 1
          })
          const deferred = new Deferred<void>()
          pool.use(() => deferred)

          const result = StatefulPromise.from(pool.use(value => value))
          await Promise.resolve()
          const state1 = result.state
          deferred.resolve()
          const proResult = await result
          const state2 = result.state

          expect(create).toBeCalledTimes(1)
          expect(state1).toBe(StatefulPromiseState.Pending)
          expect(state2).toBe(StatefulPromiseState.Fulfilled)
          expect(proResult).toBe(value)
        })
      })
    })
  })

  describe('size', () => {
    test('minInstances === 0', async () => {
      const create = jest.fn()
      const destroy = jest.fn()
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
      const create = jest.fn()
      const destroy = jest.fn()
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
      const create = jest.fn()
      const destroy = jest.fn()
      const pool = new Pool({
        create
      , destroy
      , idleTimeout: 1000
      , minInstances: 0
      })
      await pool.use(pass)

      const result1 = pool.size
      await delay(1000)
      const result2 = pool.size

      expect(result1).toBe(1)
      expect(result2).toBe(0)
      expect(destroy).toBeCalledTimes(1)
    })

    test('cancel scheduled deletion', async () => {
      const create = jest.fn()
      const destroy = jest.fn()
      const pool = new Pool({
        create
      , destroy
      , idleTimeout: 1000
      , minInstances: 0
      })
      await pool.use(pass)

      const result1 = pool.size
      await delay(500)
      await pool.use(pass)
      await delay(500)
      const result2 = pool.size

      expect(result1).toBe(1)
      expect(result2).toBe(1)
      expect(destroy).toBeCalledTimes(0)
    })
  })
})
