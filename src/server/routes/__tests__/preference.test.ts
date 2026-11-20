import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'

import { ConnectionRegistry } from '../../transport/connections'
import { RpcRegistry } from '../../transport/registry'
import { registerPreferenceRoutes } from '../preference'

const service = {
  get: vi.fn((key: string) => `value-of-${key}`),
  getAll: vi.fn(() => ({ 'app.language': 'en-US' })),
  getMultipleRaw: vi.fn((keys: string[]) => Object.fromEntries(keys.map((key) => [key, key]))),
  set: vi.fn(async () => {}),
  setMultiple: vi.fn(async () => {})
}

let registry: RpcRegistry
let connections: ConnectionRegistry

const ctx = { senderId: 'client-1' }

async function dispatch(route: string, input?: unknown) {
  return registry.dispatch(route, input, ctx)
}

beforeEach(() => {
  // The handlers resolve the service by name on every call, exactly like the
  // lifecycle container does once `startAiRuntime()` has run.
  application.register('PreferenceService', service)
  connections = new ConnectionRegistry()
  registry = new RpcRegistry()
  registerPreferenceRoutes(registry, connections)
})

afterEach(() => {
  application.unregister('PreferenceService')
  vi.clearAllMocks()
})

describe('preference routes', () => {
  it('reads a single value through the service', async () => {
    const result = await dispatch('preference.get', { key: 'app.language' })

    expect(result).toEqual({ ok: true, data: 'value-of-app.language' })
    expect(service.get).toHaveBeenCalledWith('app.language')
  })

  it('rejects an empty key at the transport', async () => {
    const result = await dispatch('preference.get', { key: '' })

    expect(result.ok).toBe(false)
    expect(service.get).not.toHaveBeenCalled()
  })

  it('returns the full cache and a batched read', async () => {
    expect(await dispatch('preference.get_all')).toEqual({ ok: true, data: { 'app.language': 'en-US' } })
    expect(await dispatch('preference.get_multiple_raw', { keys: ['a', 'b'] })).toEqual({
      ok: true,
      data: { a: 'a', b: 'b' }
    })
  })

  it('broadcasts a write to every tab', async () => {
    const broadcast = vi.spyOn(connections, 'broadcast')

    const result = await dispatch('preference.set', { key: 'app.language', value: 'zh-CN' })

    expect(result).toEqual({ ok: true, data: undefined })
    expect(service.set).toHaveBeenCalledWith('app.language', 'zh-CN')
    expect(broadcast).toHaveBeenCalledWith('preference:changed', { key: 'app.language', value: 'zh-CN' })
  })

  it('broadcasts one event per key in a batch write', async () => {
    const broadcast = vi.spyOn(connections, 'broadcast')

    await dispatch('preference.set_multiple', { updates: { a: 1, b: 2 } })

    expect(service.setMultiple).toHaveBeenCalledWith({ a: 1, b: 2 })
    expect(broadcast).toHaveBeenCalledTimes(2)
    expect(broadcast).toHaveBeenCalledWith('preference:changed', { key: 'a', value: 1 })
    expect(broadcast).toHaveBeenCalledWith('preference:changed', { key: 'b', value: 2 })
  })

  it('acknowledges a subscription without touching the service', async () => {
    expect(await dispatch('preference.subscribe', { keys: ['app.language'] })).toEqual({ ok: true, data: undefined })
    expect(service.get).not.toHaveBeenCalled()
  })
})
