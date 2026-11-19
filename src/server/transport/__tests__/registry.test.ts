import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import { defineRoute } from '@shared/ipc/define'
import { IpcError, IpcErrorCode } from '@shared/ipc/errors/IpcError'
import type { IpcHandlersFor } from '@shared/ipc/types'

import { RpcRegistry } from '../registry'

const schemas = {
  'test.echo': defineRoute({ input: z.object({ value: z.number() }), output: z.object({ doubled: z.number() }) }),
  'test.fail': defineRoute({ input: z.void(), output: z.void() })
} satisfies Record<string, ReturnType<typeof defineRoute>>

const handlers: IpcHandlersFor<typeof schemas> = {
  'test.echo': async ({ value }) => ({ doubled: value * 2 }),
  'test.fail': async () => {
    throw new IpcError('HANDLER_FAILED', 'boom', { detail: 1 })
  }
}

const ctx = { senderId: null }

describe('RpcRegistry', () => {
  it('dispatches a valid request', async () => {
    const registry = new RpcRegistry()
    registry.register(schemas, handlers)

    await expect(registry.dispatch('test.echo', { value: 21 }, ctx)).resolves.toEqual({ ok: true, data: { doubled: 42 } })
  })

  it('rejects unknown routes', async () => {
    const registry = new RpcRegistry()
    registry.register(schemas, handlers)

    const result = await registry.dispatch('test.nope', {}, ctx)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe(IpcErrorCode.ROUTE_NOT_FOUND)
  })

  it('rejects inherited object keys as unknown routes', async () => {
    const registry = new RpcRegistry()
    registry.register(schemas, handlers)

    const result = await registry.dispatch('constructor', {}, ctx)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe(IpcErrorCode.ROUTE_NOT_FOUND)
  })

  it('surfaces zod issues as VALIDATION_FAILED', async () => {
    const registry = new RpcRegistry()
    registry.register(schemas, handlers)

    const result = await registry.dispatch('test.echo', { value: 'nope' }, ctx)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe(IpcErrorCode.VALIDATION_FAILED)
      expect(result.error.data).toMatchObject({ issues: expect.any(Array) })
    }
  })

  it('keeps handler codes and normalizes unknown throws', async () => {
    const registry = new RpcRegistry()
    registry.register(schemas, handlers)

    const failed = await registry.dispatch('test.fail', undefined, ctx)
    expect(failed).toEqual({ ok: false, error: { code: 'HANDLER_FAILED', message: 'boom', data: { detail: 1 } } })

    registry.register(
      { 'test.unknown': defineRoute({ input: z.void(), output: z.void() }) },
      {
        'test.unknown': async () => {
          throw new TypeError('lost')
        }
      }
    )
    const internalResult = await registry.dispatch('test.unknown', undefined, ctx)
    expect(internalResult.ok).toBe(false)
    if (!internalResult.ok) expect(internalResult.error.code).toBe(IpcErrorCode.INTERNAL)
  })

  it('refuses duplicate route registration', () => {
    const registry = new RpcRegistry()
    registry.register(schemas, handlers)
    expect(() => registry.register(schemas, handlers)).toThrow(/Duplicate IpcApi route/)
  })
})
