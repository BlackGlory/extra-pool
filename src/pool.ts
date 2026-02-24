import { go, Awaitable, CustomError, isntEmptyArray, assert, isPositiveInfinity } from '@blackglory/prelude'
import { Queue } from '@blackglory/structures'
import { FiniteStateMachine, IFiniteStateMachineSchema } from 'extra-fsm'
import { Deferred, DeferredGroup, each } from 'extra-promise'
import { toArray, filter } from 'iterable-operator'
import { setTimeout } from 'extra-timers'
import { Instance } from './instance.js'

interface IPoolOptions<T> {
  create: () => Awaitable<T>

  /**
   * 该函数用于销毁实例.
   * 它是可选的, 有一些实例可能不需要销毁或不需要手动销毁.
   */
  destroy?: (value: T) => Awaitable<void>

  /**
   * 池中实例的最高数量, 默认为Infinity.
   */
  maxInstances?: number

  /**
   * 池中实例的最低数量, 默认为0.
   * 注意, 非零值不意味着最低数量的实例会与池一同被创建,
   * 该值的主要作用是防止空闲实例被全部销毁(导致下次使用时需要重新创建实例).
   */
  minInstances?: number

  /**
   * 空闲实例的存活时间(毫秒).
   * 默认为0, 空闲实例会被立即销毁.
   */
  idleTimeout?: number

  /**
   * 每个实例的并发数.
   * 默认为1, 每个实例只能同时有一个用户.
   */
  concurrencyPerInstance?: number
}

interface IPoolItem<T> {
  instance: Instance<T>

  /**
   * 空闲实例会在idleTimeout之后被删除, 该函数用于取消预定的删除操作.
   */
  cancelScheduledDeletion?: () => void
}

enum PoolState {
  Running
, Destroying
, Destroyed
}

type PoolEvent =
| 'destroy'
| 'destroyed'

const poolSchema: IFiniteStateMachineSchema<PoolState, PoolEvent> = {
  [PoolState.Running]: {
    destroy: PoolState.Destroying
  }
, [PoolState.Destroying]: {
    destroyed: PoolState.Destroyed
  }
, [PoolState.Destroyed]: {}
}

export class Pool<T> {
  private readonly createInstance: () => Awaitable<T>
  private readonly destroyInstance?: (value: T) => Awaitable<void>
  private readonly fsm: FiniteStateMachine<
    PoolState
  , PoolEvent
  > = new FiniteStateMachine(
    poolSchema
  , PoolState.Running
  )
  private readonly waitingUsers: Queue<Deferred<IPoolItem<T>>> = new Queue()
  private readonly items: Set<IPoolItem<T>> = new Set()
  private readonly minInstances: number
  private readonly maxInstances: number
  private readonly idleTimeout: number
  private readonly concurrencyPerInstance: number

  get capacity(): number {
    return this.maxInstances
  }

  get size(): number {
    return this.items.size
  }

  constructor(options: IPoolOptions<T>) {
    this.createInstance = options.create
    this.destroyInstance = options.destroy

    this.minInstances = options.minInstances ?? 0
    assert(
      Number.isInteger(this.minInstances) &&
      Number.isFinite(this.minInstances) &&
      this.minInstances >= 0
    , 'The minInstances must be a non-negative finite integer'
    )

    this.maxInstances = options.maxInstances ?? Infinity
    assert(
      (
        Number.isInteger(this.maxInstances) ||
        isPositiveInfinity(this.maxInstances)
      ) &&
      this.maxInstances >= this.minInstances
    , 'The maxInstances must be either an integer greater than or equal to minInstances, or Infinity'
    )

    this.idleTimeout = options.idleTimeout ?? 0
    assert(
      Number.isInteger(this.idleTimeout) &&
      Number.isFinite(this.idleTimeout) &&
      this.idleTimeout >= 0
    , 'The idleTimeout must be a non-negative finite integer'
    )

    this.concurrencyPerInstance = options.concurrencyPerInstance ?? 1
    assert(
      Number.isInteger(this.concurrencyPerInstance) &&
      this.concurrencyPerInstance >= 1
    , 'The concurrencyPerInstance must an integer greater than or equal to 1'
    )
  }

  async prewarm(targetInstances: number): Promise<void> {
    assert(
      targetInstances >= this.minInstances &&
      targetInstances <= this.maxInstances &&
      Number.isFinite(targetInstances)
    , 'The targetInstances must be an finite integer in [minInstances, maxInstances]'
    )

    const promises: Array<Promise<void>> = []

    const deferredGroup = new DeferredGroup<void>()
    while (this.size < targetInstances) {
      const deferred = new Deferred<void>()
      deferredGroup.add(deferred)
      promises.push(this.use(() => deferred))
    }
    deferredGroup.resolve()

    await Promise.all(promises)
  }

  /**
   * 如果所有实例都不空闲, 该函数会通过返回Promise来阻塞使用者, 直到有空闲的实例.
   * 函数的使用者应该尊重阻塞, 否则会意外制造大量非必要的Promise.
   */
  async use<U>(fn: (instance: T) => Awaitable<U>): Promise<U> {
    assert(this.fsm.matches(PoolState.Running), 'The pool is not available')

    const self = this

    const item = go(() => {
      const candidateItems = toArray(filter(
        this.items
      , item => item.instance.users < this.concurrencyPerInstance
      ))

      if (isntEmptyArray(candidateItems)) {
        // 找到负载最低(用户量最少)的项目.
        return candidateItems.reduce((previous, current) => {
          return current.instance.users < previous.instance.users
               ? current
               : previous
        })
      }
    })

    if (item) {
      return await useItem(item)
    } else {
      if (this.items.size < this.maxInstances) {
        const instance = new Instance(this.createInstance, this.destroyInstance)
        const item: IPoolItem<T> = { instance }
        this.items.add(item)
        return await useItem(item)
      } else {
        const waitingUser = new Deferred<IPoolItem<T>>()
        this.waitingUsers.enqueue(waitingUser)
        const item = await waitingUser
        return await useItem(item)
      }
    }

    async function useItem(item: IPoolItem<T>): Promise<U> {
      // 由于使用该实例, 取消其预定的删除动作.
      if (item.cancelScheduledDeletion) {
        item.cancelScheduledDeletion()
        item.cancelScheduledDeletion = undefined
      }

      try {
        return await item.instance.use(fn)
      } finally {
        const waitingUser = self.waitingUsers.dequeue()
        if (waitingUser) {
          waitingUser.resolve(item)
        } else {
          if (
            item.instance.users === 0 &&
            self.items.size > self.minInstances
          ) {
            if (self.idleTimeout > 0) {
              item.cancelScheduledDeletion = setTimeout(
                self.idleTimeout
              , deleteInstance
              )
            } else {
              await deleteInstance()
            }
          }
        }
      }

      async function deleteInstance(): Promise<void> {
        self.items.delete(item)
        await item.instance.destroy()
      }
    }
  }

  async destroy(): Promise<void> {
    this.fsm.send('destroy')

    await each(this.items, item => item.instance.destroy())
    this.items.clear()

    let waitingUser: Deferred<IPoolItem<T>> | undefined
    while (waitingUser = this.waitingUsers.dequeue()) {
      waitingUser.reject(new UnavailablePool())
    }

    this.fsm.send('destroyed')
  }
}

export class UnavailablePool extends CustomError {}
