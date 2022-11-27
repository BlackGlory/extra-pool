import { go, Awaitable } from '@blackglory/prelude'
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
| 'used'
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
    used: InstanceState.Idle
  }
, [InstanceState.Destroying]: {
    destroyed: InstanceState.Destroyed
  }
, [InstanceState.Destroyed]: {}
}

export class Instance<T> {
  private fsm: ObservableFiniteStateMachine<InstanceState, InstanceEvent>
  readonly _value: Deferred<T>

  constructor(
    createValue: () => Awaitable<T>
  , private destroyValue?: (value: T) => Awaitable<void>
  ) {
    this._value = new Deferred<T>()
    this.fsm = new ObservableFiniteStateMachine<InstanceState, InstanceEvent>(
      instanceSchema
    , InstanceState.Creating
    )

    go(async () => {
      try {
        const val = await createValue()
        this._value.resolve(val)
        this.fsm.send('created')
      } catch (e) {
        this._value.reject(e)
      }
    })
  }

  async waitForCreated(): Promise<void> {
    await this._value
  }

  getState(): InstanceState {
    return this.fsm.state
  }

  async use<U>(fn: (instance: T) => Awaitable<U>): Promise<U> {
    this.fsm.send('use')
    const value = await this._value
    try {
      return await fn(value)
    } finally {
      this.fsm.send('used')
    }
  }

  async destroy(): Promise<void> {
    if (
      this.fsm.matches(InstanceState.Creating) ||
      this.fsm.matches(InstanceState.Using)
    ) {
      await firstValueFrom(
        this.fsm.observeStateChanges().pipe(
          filter(state => state.newState === InstanceState.Idle)
        )
      )
    }

    if (this.fsm.matches(InstanceState.Idle)) {
      this.fsm.send('destroy')
      // 如果destroyed过程报错, 则程序崩溃, 这是预期行为.
      await this.destroyValue?.(await this._value)
      this.fsm.send('destroyed')
    } else if (this.fsm.matches(InstanceState.Destroying)) {
      await firstValueFrom(
        this.fsm.observeStateChanges().pipe(
          filter(state => state.newState === InstanceState.Destroyed)
        )
      )
    }
  }
}
