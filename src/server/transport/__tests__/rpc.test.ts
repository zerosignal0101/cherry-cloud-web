import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import type { FastifyInstance } from 'fastify'
import WebSocket from 'ws'
import { afterEach, describe, expect, it } from 'vitest'

import { buildApp } from '../../app'
import type { ServerConfig } from '../../config'

const apps: FastifyInstance[] = []
const tempDirs: string[] = []

const PASSWORD = 'test-password'

function config(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const dataDir = mkdtempSync(join(tmpdir(), 'ccw-rpc-'))
  tempDirs.push(dataDir)
  return {
    host: '127.0.0.1',
    port: 0,
    dataDir,
    migrationsDir: resolve(process.cwd(), 'migrations/sqlite-drizzle'),
    webDist: '/tmp/cherry-cloud-web-no-dist',
    isProduction: true,
    adminPassword: PASSWORD,
    sessionTtlDays: 30,
    forceSecureCookie: false,
    allowedOrigins: [],
    ...overrides
  }
}

async function createApp(overrides: Partial<ServerConfig> = {}): Promise<FastifyInstance> {
  const app = await buildApp(config(overrides))
  apps.push(app)
  return app
}

/** Logs in through the real endpoint and returns the session cookie header. */
async function login(app: FastifyInstance, password = PASSWORD): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password } })
  expect(response.statusCode).toBe(200)
  const cookie = response.cookies.find((entry) => entry.name === 'ccw_session')
  if (!cookie) throw new Error('session cookie missing')
  return `ccw_session=${cookie.value}`
}

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('POST /api/rpc', () => {
  it('returns the IpcResult envelope for a known route', async () => {
    const app = await createApp()
    const cookie = await login(app)
    const response = await app.inject({
      method: 'POST',
      url: '/api/rpc',
      headers: { cookie },
      payload: { route: 'system.ping', input: { echo: 'hi' } }
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ ok: true, data: { echo: 'hi', transport: 'web' } })
  })

  it('returns ROUTE_NOT_FOUND as a 200 envelope', async () => {
    const app = await createApp()
    const cookie = await login(app)
    const response = await app.inject({
      method: 'POST',
      url: '/api/rpc',
      headers: { cookie },
      payload: { route: 'system.nope' }
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ ok: false, error: { code: 'ROUTE_NOT_FOUND' } })
  })

  it('rejects malformed envelopes with 400', async () => {
    const app = await createApp()
    const cookie = await login(app)
    const response = await app.inject({
      method: 'POST',
      url: '/api/rpc',
      headers: { cookie },
      payload: { route: 42 }
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } })
  })

  it('requires a session cookie', async () => {
    const app = await createApp()
    const denied = await app.inject({ method: 'POST', url: '/api/rpc', payload: { route: 'system.ping' } })
    expect(denied.statusCode).toBe(401)

    const cookie = await login(app)
    const allowed = await app.inject({
      method: 'POST',
      url: '/api/rpc',
      headers: { cookie },
      payload: { route: 'system.ping' }
    })
    expect(allowed.statusCode).toBe(200)
    expect(allowed.json()).toMatchObject({ ok: true })
  })

  it('rejects a forged session cookie', async () => {
    const app = await createApp()
    const response = await app.inject({
      method: 'POST',
      url: '/api/rpc',
      headers: { cookie: 'ccw_session=v1.eyJleHAiOjk5OTk5OTk5OTk5OTl9.forged' },
      payload: { route: 'system.ping' }
    })
    expect(response.statusCode).toBe(401)
  })

  it('rejects cross-origin posts', async () => {
    const app = await createApp()
    const cookie = await login(app)
    const response = await app.inject({
      method: 'POST',
      url: '/api/rpc',
      headers: { cookie, origin: 'https://evil.example' },
      payload: { route: 'system.ping' }
    })
    expect(response.statusCode).toBe(403)
  })
})

describe('WS /api/ws', () => {
  async function listen(app: FastifyInstance): Promise<number> {
    await app.listen({ host: '127.0.0.1', port: 0 })
    const address = app.server.address()
    if (!address || typeof address === 'string') throw new Error('expected a TCP address')
    return address.port
  }

  it('broadcasts events to clients holding a session cookie', async () => {
    const app = await createApp()
    const cookie = await login(app)
    const port = await listen(app)

    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/ws`, { headers: { cookie } })
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

  it('closes upgrades without a session', async () => {
    const app = await createApp()
    const port = await listen(app)

    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/ws`)
    const code = await new Promise<number>((resolve) => socket.once('close', (value) => resolve(value)))
    expect(code).toBe(4401)
  })
})
