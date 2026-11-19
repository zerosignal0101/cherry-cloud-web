import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'

import { buildApp } from '../../app'
import type { ServerConfig } from '../../config'

const apps: FastifyInstance[] = []
const tempDirs: string[] = []

const PASSWORD = 'test-password'

function config(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const dataDir = mkdtempSync(join(tmpdir(), 'ccw-data-'))
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

async function createApp(): Promise<FastifyInstance> {
  const app = await buildApp(config())
  apps.push(app)
  return app
}

async function login(app: FastifyInstance): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: PASSWORD } })
  expect(response.statusCode).toBe(200)
  const cookie = response.cookies.find((entry) => entry.name === 'ccw_session')
  if (!cookie) throw new Error('session cookie missing')
  return `ccw_session=${cookie.value}`
}

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('POST /api/data', () => {
  it('creates and lists topics through the upstream DataApi handlers', async () => {
    const app = await createApp()
    const cookie = await login(app)

    const created = await app.inject({
      method: 'POST',
      url: '/api/data',
      headers: { cookie },
      payload: { id: 'req-1', method: 'POST', path: '/topics', body: { name: 'web topic' } }
    })

    expect(created.statusCode).toBe(200)
    const createBody = created.json<{ status: number; data: { id: string; name: string } }>()
    expect(createBody.status).toBeLessThan(300)
    expect(createBody.data).toMatchObject({ name: 'web topic' })

    const listed = await app.inject({
      method: 'POST',
      url: '/api/data',
      headers: { cookie },
      payload: { id: 'req-2', method: 'GET', path: '/topics', query: {} }
    })

    const listBody = listed.json<{ status: number; data: { items: Array<{ id: string; name: string }> } }>()
    expect(listBody.status).toBe(200)
    expect(listBody.data.items.map((topic) => topic.name)).toContain('web topic')
  })

  it('reports unknown endpoints in the error envelope, not as an HTTP failure', async () => {
    const app = await createApp()
    const cookie = await login(app)

    const response = await app.inject({
      method: 'POST',
      url: '/api/data',
      headers: { cookie },
      payload: { id: 'req-3', method: 'GET', path: '/nope' }
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ status: 404, error: { code: 'NOT_FOUND' } })
  })

  it('requires a session and validates the envelope', async () => {
    const app = await createApp()

    const denied = await app.inject({
      method: 'POST',
      url: '/api/data',
      payload: { id: 'req-4', method: 'GET', path: '/topics' }
    })
    expect(denied.statusCode).toBe(401)

    const cookie = await login(app)
    const malformed = await app.inject({
      method: 'POST',
      url: '/api/data',
      headers: { cookie },
      payload: { id: 'req-5', method: 'TRACE', path: '/topics' }
    })
    expect(malformed.statusCode).toBe(400)
  })

  it('pushes a data-change event to the writer tab', async () => {
    const app = await createApp()
    const cookie = await login(app)

    await app.listen({ host: '127.0.0.1', port: 0 })
    const address = app.server.address()
    if (!address || typeof address === 'string') throw new Error('expected a TCP address')

    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/ws?client=data-test-client`, {
      headers: { cookie }
    })
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve())
      socket.once('error', reject)
    })

    const changed = new Promise<unknown>((resolve) => {
      socket.on('message', (raw) => {
        const frame = JSON.parse(raw.toString()) as { event?: string; payload?: unknown }
        if (frame.event === 'data-api:data-changed') resolve(frame.payload)
      })
    })

    await app.inject({
      method: 'POST',
      url: '/api/data',
      headers: { cookie },
      payload: { id: 'req-6', method: 'POST', path: '/topics', body: { name: 'notify' } }
    })

    const payload = (await changed) as Array<{ endpoint?: string }>
    expect(payload.length).toBeGreaterThan(0)
    expect(payload.every((effect) => typeof effect.endpoint === 'string')).toBe(true)
    socket.close()
  })
})
