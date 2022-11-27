import { CustomError } from '@blackglory/errors'
import { Awaitable } from '@blackglory/prelude'
import { Queue } from '@blackglory/structures'
import { FiniteStateMachine } from 'extra-fsm'
import { Deferred } from 'extra-promise'
import { find } from 'iterable-operator'
import { Instance } from './instance'
import { setTimeout } from 'extra-timers'

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
}

interface IItem<T> {
  instance: Instance<T>
  using: boolean
  cancelDeletion?: () => void
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
  private createValue: () => Awaitable<T>
  private destroyValue?: (value: T) => Awaitable<void>
  private fsm = new FiniteStateMachine<PoolState, PoolEvent>(
    poolSchema
  , PoolState.Running
  )
  private items: Set<IItem<T>> = new Set()
  private userDeferredQueue: Queue<Deferred<IItem<T>>> = new Queue()
  private maxInstances: number
  private minInstances: number
  private idleTimeout: number

  get size(): number {
    return this.items.size
  }

  constructor(options: IPoolOptions<T>) {
    this.createValue = options.create
    this.destroyValue = options.destroy
    this.maxInstances = options.maxInstances ?? Infinity
    this.minInstances = options.minInstances ?? 0
    this.idleTimeout = options.idleTimeout ?? 0
  }

  /**
   * 如果所有实例都不空闲, 该函数会通过返回Promise来阻塞使用者, 直到有空闲的实例.
   * 函数的使用者应该尊重阻塞, 否则会意外制造大量非必要的Promise.
   */
  async use<U>(fn: (instance: T) => Awaitable<U>): Promise<U> {
    const self = this

    const item = find(this.items, instance => !instance.using)
    if (item) {
      return await use(item)
    } else {
      if (this.items.size < this.maxInstances) {
        const instance = new Instance(this.createValue, this.destroyValue)
        const item: IItem<T> = {
          instance
        , using: true
        }
        this.items.add(item)
        return await use(item)
      } else {
        const deferred = new Deferred<IItem<T>>()
        this.userDeferredQueue.enqueue(deferred)
        const item = await deferred
        return await use(item)
      }
    }

    async function use(item: IItem<T>): Promise<U> {
      item.using = true

      if (item.cancelDeletion) {
        item.cancelDeletion()
        delete item.cancelDeletion
      }

      await item.instance.waitForCreated()
      try {
        return await item.instance.use(fn)
      } finally {
        if (self.userDeferredQueue.size > 0) {
          self.userDeferredQueue.dequeue()!.resolve(item)
        } else {
          item.using = false
          if (self.items.size > self.minInstances) {
            if (self.idleTimeout > 0) {
              item.cancelDeletion = setTimeout(self.idleTimeout, removeItem)
            } else {
              await removeItem()
            }
          }
        }
      }

      async function removeItem(): Promise<void> {
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

    let deferred: Deferred<IItem<T>> | undefined
    while (deferred = this.userDeferredQueue.dequeue()) {
      deferred.reject(new UnavailablePool())
    }


    this.fsm.send('destroyed')
  }
}

export class UnavailablePool extends CustomError {}
