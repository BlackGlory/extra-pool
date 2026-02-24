import { pass } from '@blackglory/prelude'
import { delay } from 'extra-promise'
import { Instance, InstanceState } from '@src/instance'

describe('Instance', () => {
  describe('construtor', () => {
    test('sync', async () => {
      const value = {}

      const instance = new Instance(() => value)
      const state1 = instance.getState()
      const internalInstanceValue = await instance._instance
      const state2 = instance.getState()

      expect(internalInstanceValue).toBe(value)
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
      const internalInstanceValue = await instance._instance
      const state2 = instance.getState()

      expect(internalInstanceValue).toBe(value)
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

  describe('use', () => {
    test('state: idle', async () => {
      const instance = new Instance(pass)
      await instance.waitForCreated()
      const state1 = instance.getState()
      const users1 = instance.users
      const fn = jest.fn()

      const promise = instance.use(fn)
      const state2 = instance.getState()
      const users2 = instance.users
      await promise
      const state3 = instance.getState()
      const users3 = instance.users

      expect(state1).toBe(InstanceState.Idle)
      expect(users1).toBe(0)
      expect(state2).toBe(InstanceState.Using)
      expect(users2).toBe(1)
      expect(state3).toBe(InstanceState.Idle)
      expect(users3).toBe(0)
    })

    test('state: using', async () => {
      const instance = new Instance(pass)
      await instance.waitForCreated()
      const usePromise1 = instance.use(() => delay(100))
      const state1 = instance.getState()
      const users1 = instance.users
      const fn = jest.fn()

      const usePromise2 = instance.use(fn)
      const state2 = instance.getState()
      const users2 = instance.users
      await usePromise2
      const state3 = instance.getState()
      const users3 = instance.users
      await usePromise1
      const state4 = instance.getState()
      const users4 = instance.users

      expect(state1).toBe(InstanceState.Using)
      expect(users1).toBe(1)
      expect(state2).toBe(InstanceState.Using)
      expect(users2).toBe(2)
      expect(state3).toBe(InstanceState.Using)
      expect(users3).toBe(1)
      expect(state4).toBe(InstanceState.Idle)
      expect(users4).toBe(0)
    })
  })

  describe('destroy', () => {
    test('state: creating', async () => {
      const destroy = jest.fn()
      const instance = new Instance(pass, destroy)
      const state1 = instance.getState()

      const promise = instance.destroy()
      const state2 = instance.getState()
      await promise
      const state3 = instance.getState()

      expect(destroy).toBeCalledTimes(1)
      expect(state1).toBe(InstanceState.Creating)
      expect(state2).toBe(InstanceState.Creating)
      expect(state3).toBe(InstanceState.Destroyed)
    })

    test('state: idle', async () => {
      const destroy = jest.fn(() => delay(100))
      const instance = new Instance(pass, destroy)
      await instance.waitForCreated()
      const state1 = instance.getState()
      const users1 = instance.users

      const promise = instance.destroy()
      const state2 = instance.getState()
      const users2 = instance.users
      await promise
      const state3 = instance.getState()
      const users3 = instance.users

      expect(destroy).toBeCalledTimes(1)
      expect(state1).toBe(InstanceState.Idle)
      expect(users1).toBe(0)
      expect(state2).toBe(InstanceState.Destroying)
      expect(users2).toBe(0)
      expect(state3).toBe(InstanceState.Destroyed)
      expect(users3).toBe(0)
    })

    test('state: using', async () => {
      const destroy = jest.fn(() => delay(100))
      const instance = new Instance(pass, destroy)
      await instance.waitForCreated()
      const usePromise = instance.use(() => delay(100))
      const state1 = instance.getState()
      const users1 = instance.users

      const destroyPromise = instance.destroy()
      const state2 = instance.getState()
      const users2 = instance.users
      await usePromise
      const state3 = instance.getState()
      const users3 = instance.users
      await destroyPromise
      const state4 = instance.getState()
      const users4 = instance.users

      expect(destroy).toBeCalledTimes(1)
      expect(state1).toBe(InstanceState.Using)
      expect(users1).toBe(1)
      expect(state2).toBe(InstanceState.Using)
      expect(users2).toBe(1)
      expect(state3).toBe(InstanceState.Destroying)
      expect(users3).toBe(0)
      expect(state4).toBe(InstanceState.Destroyed)
      expect(users4).toBe(0)
    })

    test('state: destroying', async () => {
      const destroy = jest.fn()
      const instance = new Instance(pass, destroy)
      await instance.waitForCreated()
      instance.destroy()
      const state1 = instance.getState()

      const promise = instance.destroy()
      const state2 = instance.getState()
      await promise
      const state3 = instance.getState()

      expect(destroy).toBeCalledTimes(1)
      expect(state1).toBe(InstanceState.Destroying)
      expect(state2).toBe(InstanceState.Destroying)
      expect(state3).toBe(InstanceState.Destroyed)
    })

    test('state: destroyed', async () => {
      const destroy = jest.fn()
      const instance = new Instance(pass, destroy)
      await instance.waitForCreated()
      await instance.destroy()
      const state1 = instance.getState()

      const promise = instance.destroy()
      const state2 = instance.getState()
      await promise
      const state3 = instance.getState()

      expect(destroy).toBeCalledTimes(1)
      expect(state1).toBe(InstanceState.Destroyed)
      expect(state2).toBe(InstanceState.Destroyed)
      expect(state3).toBe(InstanceState.Destroyed)
    })
  })
})
