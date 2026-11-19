import type { FastifyInstance } from 'fastify'
import WebSocket from 'ws'
import { afterEach, describe, expect, it } from 'vitest'

import { buildApp } from '../../app'
import type { ServerConfig } from '../../config'

const apps: FastifyInstance[] = []

function config(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    dataDir: '/tmp/cherry-cloud-web-test',
    webDist: '/tmp/cherry-cloud-web-no-dist',
    isProduction: true,
    ...overrides
  }
}

async function createApp(overrides: Partial<ServerConfig> = {}): Promise<FastifyInstance> {
  const app = await buildApp(config(overrides))
  apps.push(app)
  return app
}

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close()
})

describe('POST /api/rpc', () => {
  it('returns the IpcResult envelope for a known route', async () => {
    const app = await createApp()
    const response = await app.inject({
      method: 'POST',
      url: '/api/rpc',
      payload: { route: 'system.ping', input: { echo: 'hi' } }
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ ok: true, data: { echo: 'hi', transport: 'web' } })
  })

  it('returns ROUTE_NOT_FOUND as a 200 envelope', async () => {
    const app = await createApp()
    const response = await app.inject({ method: 'POST', url: '/api/rpc', payload: { route: 'system.nope' } })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ ok: false, error: { code: 'ROUTE_NOT_FOUND' } })
  })

  it('rejects malformed envelopes with 400', async () => {
    const app = await createApp()
    const response = await app.inject({ method: 'POST', url: '/api/rpc', payload: { route: 42 } })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } })
  })

  it('requires the shared token when configured', async () => {
    const app = await createApp({ authToken: 'secret-token' })

    const denied = await app.inject({ method: 'POST', url: '/api/rpc', payload: { route: 'system.ping' } })
    expect(denied.statusCode).toBe(401)

    const allowed = await app.inject({
      method: 'POST',
      url: '/api/rpc',
      headers: { authorization: 'Bearer secret-token' },
      payload: { route: 'system.ping' }
    })
    expect(allowed.statusCode).toBe(200)
    expect(allowed.json()).toMatchObject({ ok: true })
  })
})

describe('WS /api/ws', () => {
  it('broadcasts events to connected clients', async () => {
    const app = await createApp({ authToken: 'secret-token' })
    await app.listen({ host: '127.0.0.1', port: 0 })
    const address = app.server.address()
    if (!address || typeof address === 'string') throw new Error('expected a TCP address')

    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/ws?token=secret-token`)
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve())
      socket.once('error', reject)
    })

    const message = new Promise<unknown>((resolve) => {
      socket.once('message', (raw) => resolve(JSON.parse(raw.toString())))
    })
    app.events.broadcast('system.test', { value: 1 })

    await expect(message).resolves.toEqual({ type: 'event', event: 'system.test', payload: { value: 1 } })
    socket.close()
  })

  it('closes unauthenticated upgrades', async () => {
    const app = await createApp({ authToken: 'secret-token' })
    await app.listen({ host: '127.0.0.1', port: 0 })
    const address = app.server.address()
    if (!address || typeof address === 'string') throw new Error('expected a TCP address')

    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/ws`)
    const code = await new Promise<number>((resolve) => socket.once('close', (value) => resolve(value)))
    expect(code).toBe(4401)
  })
})
