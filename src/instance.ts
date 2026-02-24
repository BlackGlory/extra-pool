import { Awaitable, NonEmptyArray, pass } from '@blackglory/prelude'
import { ObservableFiniteStateMachine, IFiniteStateMachineSchema } from 'extra-fsm'
import { Deferred } from 'extra-promise'
import { firstValueFrom } from 'rxjs'
import { filter, map } from 'rxjs/operators'

export enum InstanceState {
  Created
, Initializing
, Idle
, Busy
, Destroying
, Destroyed
}

type InstanceEvent =
| 'init'
| 'inited'
| 'fail'
| 'use'
| 'idle'
| 'destroy'
| 'destroyed'

const instanceSchema: IFiniteStateMachineSchema<InstanceState, InstanceEvent> = {
  [InstanceState.Created]: {
    init: InstanceState.Initializing
  , destroy: InstanceState.Destroyed
  }
, [InstanceState.Initializing]: {
    inited: InstanceState.Idle
  , fail: InstanceState.Created
  }
, [InstanceState.Idle]: {
    use: InstanceState.Busy
  , destroy: InstanceState.Destroying
  }
, [InstanceState.Busy]: {
    idle: InstanceState.Idle
  }
, [InstanceState.Destroying]: {
    destroyed: InstanceState.Destroyed
  }
, [InstanceState.Destroyed]: {}
}

export class Instance<T> {
  private fsm: ObservableFiniteStateMachine<
    InstanceState
  , InstanceEvent
  > = new ObservableFiniteStateMachine(
    instanceSchema
  , InstanceState.Created
  )

  private deferredCreateInstance: Deferred<T> = createDeferred()
  private deferredDestroyInstance: Deferred<void> = createDeferred()

  #users = 0
  get users(): number {
    return this.#users
  }

  get state(): InstanceState {
    return this.fsm.state
  }

  constructor(
    private createInstance: () => Awaitable<T>
  , private destroyInstance?: (value: T) => Awaitable<void>
  ) {}

  async use<U>(fn: (instance: T) => Awaitable<U>): Promise<U> {
    const self = this

    switch (this.fsm.state) {
      case InstanceState.Created: {
        addUser()

        try {
          this.fsm.send('init')

          let instance: T
          try {
            instance = await this.createInstance()
            this.deferredCreateInstance.resolve(instance)

            this.fsm.send('inited')
          } catch (e) {
            this.deferredCreateInstance.reject(e)
            this.deferredCreateInstance = createDeferred()

            this.fsm.send('fail')

            throw e
          }

          this.fsm.send('use')
          return await fn(instance)
        } finally {
          removeUser()
        }
      }
      case InstanceState.Initializing: {
        addUser()

        try {
          const instance = await this.deferredCreateInstance

          // 由导致初始化的调用将负责状态转换.

          return await fn(instance)
        } finally {
          removeUser()
        }
      }
      case InstanceState.Idle: {
        addUser()

        try {
          this.fsm.send('use')

          const instance = await this.deferredCreateInstance

          return await fn(instance)
        } finally {
          removeUser()
        }
      }
      case InstanceState.Busy: {
        addUser()

        try {
          const instance = await this.deferredCreateInstance

          return await fn(instance)
        } finally {
          removeUser()
        }
      }
      case InstanceState.Destroying:
      case InstanceState.Destroyed: throw new Error('The instance is not available')
      default: throw new Error(`Unhandled state`)
    }

    function addUser(): void {
      self.#users++
    }

    function removeUser(): void {
      if ((--self.#users) === 0) {
        if (self.fsm.can('idle')) self.fsm.send('idle')
      }
    }
  }

  async destroy(): Promise<void> {
    switch (this.fsm.state) {
      case InstanceState.Created: {
        this.fsm.send('destroy')

        return
      }
      case InstanceState.Initializing: {
        await this.waitForState(
          InstanceState.Idle
        , InstanceState.Created
        )

        return await this.destroy()
      }
      case InstanceState.Idle: {
        this.fsm.send('destroy')

        const instance = await this.deferredCreateInstance

        try {
          await this.destroyInstance?.(instance)
        } catch (e) {
          // 如果destroy过程中出错, 之后的所有destroy调用都会抛出相同错误.
          // 此实例的状态将停留在Destroying, 这是预期行为.
          this.deferredDestroyInstance.reject(e)

          throw e
        }

        this.fsm.send('destroyed')

        this.deferredDestroyInstance.resolve()

        return
      }
      case InstanceState.Busy: {
        await this.waitForState(InstanceState.Idle)

        return await this.destroy()
      }
      case InstanceState.Destroying: {
        await this.deferredDestroyInstance

        return
      }
      case InstanceState.Destroyed: return
      default: throw new Error(`Unhandled state`)
    }
  }

  async waitForState<States extends NonEmptyArray<InstanceState>>(
    ...states: States
  ): Promise<States[number]> {
    return await firstValueFrom(
      this.fsm.observeStateChanges().pipe(
        map(change => change.newState)
      , filter(newState => states.includes(newState))
      )
    )
  }
}

function createDeferred<T>(): Deferred<T> {
  const deferred = new Deferred<T>()
  Promise.resolve(deferred).catch(pass)
  return deferred
}
