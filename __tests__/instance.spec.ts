import { pass } from '@blackglory/prelude'
import { Deferred, delay } from 'extra-promise'
import { Instance, InstanceState } from '@src/instance'

describe('Instance', () => {
  describe('construtor', () => {
    test('sync', async () => {
      const value = {}

      const instance = new Instance(() => value)
      const state1 = instance.getState()
      const instanceDeferred = instance._value
      const instanceValue = await instance._value
      const state2 = instance.getState()

      expect(instanceDeferred).toBeInstanceOf(Deferred)
      expect(instanceValue).toBe(value)
      expect(state1).toBe(InstanceState.Creating)
      expect(state2).toBe(InstanceState.Idle)
    })

    test('async', async () => {
      const value = {}

      const instance = new Instance(() => {
        delay(100)
        return value
      })
      const state1 = instance.getState()
      const instanceDeferred = instance._value
      const instanceValue = await instance._value
      const state2 = instance.getState()

      expect(instanceDeferred).toBeInstanceOf(Deferred)
      expect(instanceValue).toBe(value)
      expect(state1).toBe(InstanceState.Creating)
      expect(state2).toBe(InstanceState.Idle)
    })
  })

  test('waitForCreated', async () => {
    const instance = new Instance(pass)

    const state1 = instance.getState()
    await instance.waitForCreated()
    const state2 = instance.getState()

    expect(state1).toBe(InstanceState.Creating)
    expect(state2).toBe(InstanceState.Idle)
  })

  describe('destroyInstance', () => {
    test('state: creating', async () => {
      const destroy = jest.fn()
      const instance = new Instance(pass, destroy)
      const state1 = instance.getState()

      const promise = instance.destroy()
      const state2 = instance.getState()
      await promise
      const state3 = instance.getState()

      expect(state1).toBe(InstanceState.Creating)
      expect(state2).toBe(InstanceState.Creating)
      expect(state3).toBe(InstanceState.Destroyed)
    })

    test('state: idle', async () => {
      const destroy = jest.fn()
      const instance = new Instance(pass, destroy)
      await instance.waitForCreated()
      const state1 = instance.getState()

      const promise = instance.destroy()
      const state2 = instance.getState()
      await promise
      const state3 = instance.getState()

      expect(state1).toBe(InstanceState.Idle)
      expect(state2).toBe(InstanceState.Destroying)
      expect(state3).toBe(InstanceState.Destroyed)
    })

    test('state: using', async () => {
      const destroy = jest.fn()
      const instance = new Instance(pass, destroy)
      await instance.waitForCreated()
      instance.use(() => delay(100))
      const state1 = instance.getState()

      const promise = instance.destroy()
      const state2 = instance.getState()
      await promise
      const state3 = instance.getState()

      expect(state1).toBe(InstanceState.Using)
      expect(state2).toBe(InstanceState.Using)
      expect(state3).toBe(InstanceState.Destroyed)
    })

    test('state:destroying', async () => {
      const destroy = jest.fn()
      const instance = new Instance(pass, destroy)
      await instance.waitForCreated()
      instance.destroy()
      const state1 = instance.getState()

      const promise = instance.destroy()
      const state2 = instance.getState()
      await promise
      const state3 = instance.getState()

      expect(state1).toBe(InstanceState.Destroying)
      expect(state2).toBe(InstanceState.Destroying)
      expect(state3).toBe(InstanceState.Destroyed)
    })

    test('state:destroyed', async () => {
      const destroy = jest.fn()
      const instance = new Instance(pass, destroy)
      await instance.waitForCreated()
      await instance.destroy()
      const state1 = instance.getState()

      const promise = instance.destroy()
      const state2 = instance.getState()
      await promise
      const state3 = instance.getState()

      expect(state1).toBe(InstanceState.Destroyed)
      expect(state2).toBe(InstanceState.Destroyed)
      expect(state3).toBe(InstanceState.Destroyed)
    })
  })
})
