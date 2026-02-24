import { describe, test, expect, vi } from 'vitest'
import { pass } from '@blackglory/prelude'
import { Deferred } from 'extra-promise'
import { getErrorPromise } from 'return-style'
import { Instance, InstanceState } from '@src/instance.js'

describe('Instance', () => {
  describe('use', () => {
    test('state: created', async () => {
      const internalInstance = {}
      const createInstance = vi.fn(() => internalInstance)
      const instance = new Instance(createInstance)
      const useHandler = vi.fn(() => ({
        state: instance.state
      , users: instance.users
      }))

      const startState = instance.state
      const startUsers = instance.users
      const result = await instance.use(useHandler)
      const endState = instance.state
      const endUsers = instance.users

      expect(startState).toBe(InstanceState.Created)
      expect(startUsers).toBe(0)
      expect(result).toStrictEqual({
        state: InstanceState.Busy
      , users: 1
      })
      expect(endState).toBe(InstanceState.Idle)
      expect(endUsers).toBe(0)
      expect(createInstance).toBeCalledTimes(1)
      expect(useHandler).toBeCalledTimes(1)
      expect(useHandler).toBeCalledWith(internalInstance)
    })

    test('state: initializing', async () => {
      const internalInstance = {}
      const deferred = new Deferred<typeof internalInstance>()
      const createInstance = vi.fn(() => deferred)
      const instance = new Instance(createInstance)
      instance.use(pass)
      const useHandler = vi.fn(() => ({
        state: instance.state
      , users: instance.users
      }))

      const startState = instance.state
      const startUsers = instance.users
      const promise = instance.use(useHandler)
      deferred.resolve(internalInstance)
      const result = await promise
      const endState = instance.state
      const endUsers = instance.users

      expect(startState).toBe(InstanceState.Initializing)
      expect(startUsers).toBe(1)
      expect(result).toStrictEqual({
        state: InstanceState.Busy
      , users: 1
      })
      expect(endState).toBe(InstanceState.Idle)
      expect(endUsers).toBe(0)
      expect(createInstance).toBeCalledTimes(1)
      expect(useHandler).toBeCalledTimes(1)
      expect(useHandler).toBeCalledWith(internalInstance)
    })

    test('state: idle', async () => {
      const internalInstance = {}
      const createInstance = vi.fn(() => internalInstance)
      const instance = new Instance(createInstance)
      await instance.use(pass)
      const useHandler = vi.fn(() => ({
        state: instance.state
      , users: instance.users
      }))

      const startState = instance.state
      const startUsers = instance.users
      const result = await instance.use(useHandler)
      const endState = instance.state
      const endUsers = instance.users

      expect(startState).toBe(InstanceState.Idle)
      expect(startUsers).toBe(0)
      expect(result).toStrictEqual({
        state: InstanceState.Busy
      , users: 1
      })
      expect(endState).toBe(InstanceState.Idle)
      expect(endUsers).toBe(0)
      expect(createInstance).toBeCalledTimes(1)
      expect(useHandler).toBeCalledTimes(1)
      expect(useHandler).toBeCalledWith(internalInstance)
    })

    test('state: busy', async () => {
      const internalInstance = {}
      const createInstance = vi.fn(() => internalInstance)
      const instance = new Instance(createInstance)
      const deferred = new Deferred<typeof internalInstance>()
      const promise = instance.use(() => deferred)
      await instance.waitForState(InstanceState.Busy)
      const useHandler = vi.fn(() => ({
        state: instance.state
      , users: instance.users
      }))

      const startState = instance.state
      const startUsers = instance.users
      const result = await instance.use(useHandler)
      const endState = instance.state
      const endUsers = instance.users
      deferred.resolve(internalInstance)
      await promise

      expect(startState).toBe(InstanceState.Busy)
      expect(startUsers).toBe(1)
      expect(result).toStrictEqual({
        state: InstanceState.Busy
      , users: 2
      })
      expect(endState).toBe(InstanceState.Busy)
      expect(endUsers).toBe(1)
      expect(createInstance).toBeCalledTimes(1)
      expect(useHandler).toBeCalledTimes(1)
      expect(useHandler).toBeCalledWith(internalInstance)
    })

    test('state: destroying', async () => {
      const internalInstance = {}
      const createInstance = vi.fn(() => internalInstance)
      const deferred = new Deferred<void>()
      const destroyInstance = vi.fn(() => deferred)
      const instance = new Instance(createInstance, destroyInstance)
      await instance.use(pass)
      const promise = instance.destroy()
      const useHandler = vi.fn(() => ({
        state: instance.state
      , users: instance.users
      }))

      const startState = instance.state
      const startUsers = instance.users
      const err = await getErrorPromise(instance.use(useHandler))
      const endState = instance.state
      const endUsers = instance.users
      deferred.resolve()
      await promise

      expect(startState).toBe(InstanceState.Destroying)
      expect(startUsers).toBe(0)
      expect(err).toBeInstanceOf(Error)
      expect(err?.message).toBe('The instance is not available')
      expect(endState).toBe(InstanceState.Destroying)
      expect(endUsers).toBe(0)
      expect(createInstance).toBeCalledTimes(1)
      expect(destroyInstance).toBeCalledTimes(1)
      expect(destroyInstance).toBeCalledWith(internalInstance)
      expect(useHandler).not.toBeCalled()
    })

    test('state: destroyed', async () => {
      const internalInstance = {}
      const createInstance = vi.fn(() => internalInstance)
      const deferred = new Deferred<void>()
      const destroyInstance = vi.fn()
      const instance = new Instance(createInstance, destroyInstance)
      await instance.destroy()
      const useHandler = vi.fn(() => ({
        state: instance.state
      , users: instance.users
      }))

      const startState = instance.state
      const startUsers = instance.users
      const err = await getErrorPromise(instance.use(useHandler))
      const endState = instance.state
      const endUsers = instance.users
      deferred.resolve()

      expect(startState).toBe(InstanceState.Destroyed)
      expect(startUsers).toBe(0)
      expect(err).toBeInstanceOf(Error)
      expect(err?.message).toBe('The instance is not available')
      expect(endState).toBe(InstanceState.Destroyed)
      expect(endUsers).toBe(0)
      expect(createInstance).not.toBeCalled()
      expect(destroyInstance).not.toBeCalled()
      expect(useHandler).not.toBeCalled()
    })

    test('edge: throw an error when creating instance', async () => {
      const customError = new Error('custom error')
      const internalInstance = {}
      let times = 0
      const createInstance = vi.fn(() => {
        if (times++ === 0) throw customError
        return internalInstance
      })
      const instance = new Instance(createInstance)
      const useHandler = vi.fn(() => ({
        state: instance.state
      , users: instance.users
      }))

      const state1 = instance.state
      const users1 = instance.users
      const err = await getErrorPromise(instance.use(useHandler))
      const state2 = instance.state
      const users2 = instance.users
      const result = await instance.use(useHandler)
      const state3 = instance.state
      const users3 = instance.users

      expect(state1).toBe(InstanceState.Created)
      expect(users1).toBe(0)
      expect(err).toBe(customError)
      expect(state2).toBe(InstanceState.Created)
      expect(users2).toBe(0)
      expect(result).toStrictEqual({
        state: InstanceState.Busy
      , users: 1
      })
      expect(state3).toBe(InstanceState.Idle)
      expect(users3).toBe(0)
      expect(createInstance).toBeCalledTimes(2)
      expect(useHandler).toBeCalledTimes(1)
      expect(useHandler).toBeCalledWith(internalInstance)
    })
  })

  describe('destroy', () => {
    test('state: created', async () => {
      const createInstance = vi.fn()
      const destroyInstance = vi.fn()
      const instance = new Instance(createInstance, destroyInstance)

      const startState = instance.state
      const startUsers = instance.users
      await instance.destroy()
      const endState = instance.state
      const endUsers = instance.users

      expect(startState).toBe(InstanceState.Created)
      expect(startUsers).toBe(0)
      expect(endState).toBe(InstanceState.Destroyed)
      expect(endUsers).toBe(0)
      expect(createInstance).not.toBeCalled()
      expect(destroyInstance).not.toBeCalled()
    })

    test('state: initializing', async () => {
      const internalInstance = {}
      const deferred = new Deferred<typeof internalInstance>()
      const createInstance = vi.fn(() => deferred)
      const destroyInstance = vi.fn()
      const instance = new Instance(createInstance, destroyInstance)
      instance.use(pass)

      const startState = instance.state
      const startUsers = instance.users
      const promise = instance.destroy()
      deferred.resolve(internalInstance)
      await promise
      const endState = instance.state
      const endUsers = instance.users

      expect(startState).toBe(InstanceState.Initializing)
      expect(startUsers).toBe(1)
      expect(endState).toBe(InstanceState.Destroyed)
      expect(endUsers).toBe(0)
      expect(createInstance).toBeCalledTimes(1)
      expect(destroyInstance).toBeCalledTimes(1)
      expect(destroyInstance).toBeCalledWith(internalInstance)
    })

    test('state: idle', async () => {
      const internalInstance = {}
      const createInstance = vi.fn(() => internalInstance)
      const destroyInstance = vi.fn()
      const instance = new Instance(createInstance, destroyInstance)
      await instance.use(pass)

      const startState = instance.state
      const startUsers = instance.users
      await instance.destroy()
      const endState = instance.state
      const endUsers = instance.users

      expect(startState).toBe(InstanceState.Idle)
      expect(startUsers).toBe(0)
      expect(endState).toBe(InstanceState.Destroyed)
      expect(endUsers).toBe(0)
      expect(createInstance).toBeCalledTimes(1)
      expect(destroyInstance).toBeCalledTimes(1)
      expect(destroyInstance).toBeCalledWith(internalInstance)
    })

    test('state: busy', async () => {
      const internalInstance = {}
      const createInstance = vi.fn(() => internalInstance)
      const destroyInstance = vi.fn()
      const instance = new Instance(createInstance, destroyInstance)
      const deferred = new Deferred<void>()
      instance.use(() => deferred)
      await instance.waitForState(InstanceState.Busy)

      const startState = instance.state
      const startUsers = instance.users
      const promise = instance.destroy()
      deferred.resolve()
      await promise
      const endState = instance.state
      const endUsers = instance.users

      expect(startState).toBe(InstanceState.Busy)
      expect(startUsers).toBe(1)
      expect(endState).toBe(InstanceState.Destroyed)
      expect(endUsers).toBe(0)
      expect(createInstance).toBeCalledTimes(1)
      expect(destroyInstance).toBeCalledTimes(1)
      expect(destroyInstance).toBeCalledWith(internalInstance)
    })

    test('state: destroying', async () => {
      const internalInstance = {}
      const createInstance = vi.fn(() => internalInstance)
      const deferred = new Deferred<void>()
      const destroyInstance = vi.fn(() => deferred)
      const instance = new Instance(createInstance, destroyInstance)
      await instance.use(pass)
      instance.destroy()

      const startState = instance.state
      const startUsers = instance.users
      const promise = instance.destroy()
      deferred.resolve()
      await promise
      const endState = instance.state
      const endUsers = instance.users

      expect(startState).toBe(InstanceState.Destroying)
      expect(startUsers).toBe(0)
      expect(endState).toBe(InstanceState.Destroyed)
      expect(endUsers).toBe(0)
      expect(createInstance).toBeCalledTimes(1)
      expect(destroyInstance).toBeCalledTimes(1)
      expect(destroyInstance).toBeCalledWith(internalInstance)
    })

    test('state: destroyed', async () => {
      const internalInstance = {}
      const createInstance = vi.fn(() => internalInstance)
      const destroyInstance = vi.fn()
      const instance = new Instance(createInstance, destroyInstance)
      await instance.destroy()

      const startState = instance.state
      const startUsers = instance.users
      await instance.destroy()
      const endState = instance.state
      const endUsers = instance.users

      expect(startState).toBe(InstanceState.Destroyed)
      expect(startUsers).toBe(0)
      expect(endState).toBe(InstanceState.Destroyed)
      expect(endUsers).toBe(0)
      expect(createInstance).not.toBeCalled()
      expect(destroyInstance).not.toBeCalled()
    })

    test('edge: throw an error when destroying instance', async () => {
      const internalInstance = {}
      const createInstance = vi.fn(() => internalInstance)
      const customError = new Error('custom error')
      const destroyInstance = vi.fn(() => { throw customError })
      const instance = new Instance(createInstance, destroyInstance)
      await instance.use(pass)

      const state1 = instance.state
      const users1 = instance.users
      const err1 = await getErrorPromise(instance.destroy())
      const state2 = instance.state
      const users2 = instance.users
      const err2 = await getErrorPromise(instance.destroy())
      const state3 = instance.state
      const users3 = instance.users

      expect(state1).toBe(InstanceState.Idle)
      expect(users1).toBe(0)
      expect(err1).toBe(customError)
      expect(state2).toBe(InstanceState.Destroying)
      expect(users2).toBe(0)
      expect(err2).toBe(customError)
      expect(state3).toBe(InstanceState.Destroying)
      expect(users3).toBe(0)
      expect(createInstance).toBeCalledTimes(1)
      expect(destroyInstance).toBeCalledTimes(1)
      expect(destroyInstance).toBeCalledWith(internalInstance)
    })
  })
})
