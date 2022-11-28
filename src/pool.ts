import { CustomError } from '@blackglory/errors'
import { go, Awaitable } from '@blackglory/prelude'
import { Queue } from '@blackglory/structures'
import { FiniteStateMachine } from 'extra-fsm'
import { Deferred } from 'extra-promise'
import { toArray, filter } from 'iterable-operator'
import { setTimeout } from 'extra-timers'
import { Instance, InstanceState } from './instance'

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
  Running = 'running'
, Destroying = 'destroying'
, Destroyed = 'destroyed'
}

type PoolEvent =
| 'destroy'
| 'destroyed'

const poolSchema = {
  [PoolState.Running]: {
    destroy: PoolState.Destroying
  }
, [PoolState.Destroying]: {
    destroyed: PoolState.Destroyed
  }
, [PoolState.Destroyed]: {}
}

export class Pool<T> {
  private createInstance: () => Awaitable<T>
  private destroyInstance?: (value: T) => Awaitable<void>
  private fsm = new FiniteStateMachine<PoolState, PoolEvent>(
    poolSchema
  , PoolState.Running
  )
  private waitingUsers: Queue<Deferred<IPoolItem<T>>> = new Queue()
  private items: Set<IPoolItem<T>> = new Set()
  private maxInstances: number
  private minInstances: number
  private idleTimeout: number
  private concurrencyPerInstance: number

  get size(): number {
    return this.items.size
  }

  constructor(options: IPoolOptions<T>) {
    this.createInstance = options.create
    this.destroyInstance = options.destroy
    this.maxInstances = options.maxInstances ?? Infinity
    this.minInstances = options.minInstances ?? 0
    this.idleTimeout = options.idleTimeout ?? 0
    this.concurrencyPerInstance = options.concurrencyPerInstance ?? 1
  }

  /**
   * 如果所有实例都不空闲, 该函数会通过返回Promise来阻塞使用者, 直到有空闲的实例.
   * 函数的使用者应该尊重阻塞, 否则会意外制造大量非必要的Promise.
   */
  async use<U>(fn: (instance: T) => Awaitable<U>): Promise<U> {
    const self = this

    const item = go(() => {
      const candidateItems = toArray(filter(
        this.items
      , item => item.instance.users < this.concurrencyPerInstance
      ))

      if (candidateItems.length) {
        return candidateItems.reduce((previous, current) => {
          if (current.instance.users < previous.instance.users) {
            return current
          } else {
            return previous
          }
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
        delete item.cancelScheduledDeletion
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

    for (const item of this.items) {
      await item.instance.destroy()
    }
    this.items.clear()

    let deferred: Deferred<IPoolItem<T>> | undefined
    while (deferred = this.waitingUsers.dequeue()) {
      deferred.reject(new UnavailablePool())
    }

    this.fsm.send('destroyed')
  }
}

export class UnavailablePool extends CustomError {}
