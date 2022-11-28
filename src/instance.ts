import { go, assert, Awaitable } from '@blackglory/prelude'
import { Deferred } from 'extra-promise'
import { ObservableFiniteStateMachine } from 'extra-fsm'
import { firstValueFrom } from 'rxjs'
import { filter } from 'rxjs/operators'

export enum InstanceState {
  Creating = 'creating'
, Idle = 'idle'
, Using = 'using'
, Destroying = 'destroying'
, Destroyed = 'destroyed'
}

type InstanceEvent =
| 'created'
| 'use'
| 'idle'
| 'destroy'
| 'destroyed'

const instanceSchema = {
  [InstanceState.Creating]: {
    created: InstanceState.Idle
  }
, [InstanceState.Idle]: {
    use: InstanceState.Using
  , destroy: InstanceState.Destroying
  }
, [InstanceState.Using]: {
    idle: InstanceState.Idle
  }
, [InstanceState.Destroying]: {
    destroyed: InstanceState.Destroyed
  }
, [InstanceState.Destroyed]: {}
}

export class Instance<T> {
  private fsm: ObservableFiniteStateMachine<InstanceState, InstanceEvent>
  private _users = 0
  readonly _instance: Deferred<T>

  get users(): number {
    return this._users
  }

  constructor(
    createInstance: () => Awaitable<T>
  , private destroyInstance?: (value: T) => Awaitable<void>
  ) {
    this._instance = new Deferred<T>()
    this.fsm = new ObservableFiniteStateMachine<InstanceState, InstanceEvent>(
      instanceSchema
    , InstanceState.Creating
    )

    go(async () => {
      try {
        const instance = await createInstance()
        this.fsm.send('created')
        this._instance.resolve(instance)
      } catch (e) {
        this._instance.reject(e)
      }
    })
  }

  async waitForCreated(): Promise<void> {
    await this._instance
  }

  getState(): InstanceState {
    return this.fsm.state
  }

  async use<U>(fn: (instance: T) => Awaitable<U>): Promise<U> {
    // 不要尝试将此处的代码改编成switch管道, 很难正确编写.

    assert(
      this.fsm.state !== InstanceState.Destroying &&
      this.fsm.state !== InstanceState.Destroyed
    , 'The instance is not available'
    )

    this._users++

    if (this.fsm.state === InstanceState.Creating) {
      await this._instance
    }

    if (this.fsm.state === InstanceState.Idle) {
      this.fsm.send('use')
    }

    assert(this.fsm.state === InstanceState.Using, 'The instance state should be using')
    const instance = await this._instance
    try {
      const result = await fn(instance)
      return result
    } finally {
      if ((--this._users) === 0) {
        this.fsm.send('idle')
      }
    }
  }

  async destroy(): Promise<void> {
    if (
      this.fsm.state === InstanceState.Creating ||
      this.fsm.state === InstanceState.Using
    ) {
      await firstValueFrom(
        this.fsm.observeStateChanges().pipe(
          filter(state => state.newState === InstanceState.Idle)
        )
      )
    }

    if (this.fsm.state === InstanceState.Idle) {
      this.fsm.send('destroy')
      // 如果destroyed过程报错, 则程序崩溃, 这是预期行为.
      await this.destroyInstance?.(await this._instance)
      this.fsm.send('destroyed')
    } else if (this.fsm.state === InstanceState.Destroying) {
      await firstValueFrom(
        this.fsm.observeStateChanges().pipe(
          filter(state => state.newState === InstanceState.Destroyed)
        )
      )
    }
  }
}
