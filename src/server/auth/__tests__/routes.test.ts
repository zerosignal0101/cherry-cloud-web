import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'

import { buildApp } from '../../app'
import type { ServerConfig } from '../../config'
import { sanitizeNext } from '../../routes/auth'

const apps: FastifyInstance[] = []
const tempDirs: string[] = []
const PASSWORD = 'test-password'

function config(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const dataDir = mkdtempSync(join(tmpdir(), 'ccw-auth-routes-'))
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

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('POST /api/auth/login', () => {
  it('issues an HttpOnly session cookie for the right password', async () => {
    const app = await createApp()
    const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: PASSWORD } })

    expect(response.statusCode).toBe(200)
    const cookie = response.cookies.find((entry) => entry.name === 'ccw_session')
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' })
    expect(cookie?.value.split('.')).toHaveLength(3)
    expect(response.json()).toMatchObject({ ok: true, data: { authenticated: true } })
  })

  it('rejects a wrong password without setting a cookie', async () => {
    const app = await createApp()
    const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'nope-nope' } })

    expect(response.statusCode).toBe(401)
    expect(response.cookies).toHaveLength(0)
  })

  it('rejects a cross-origin login attempt', async () => {
    const app = await createApp()
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'https://evil.example' },
      payload: { password: PASSWORD }
    })

    expect(response.statusCode).toBe(403)
    expect(response.cookies).toHaveLength(0)
  })

  it('accepts a configured extra origin', async () => {
    const app = await createApp({ allowedOrigins: ['http://localhost:5173'] })
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'http://localhost:5173' },
      payload: { password: PASSWORD }
    })

    expect(response.statusCode).toBe(200)
  })
})

describe('/api/auth/status and logout', () => {
  it('reports the session state and clears it on logout', async () => {
    const app = await createApp()

    const anonymous = await app.inject({ method: 'GET', url: '/api/auth/status' })
    expect(anonymous.json()).toMatchObject({ data: { authenticated: false } })

    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: PASSWORD } })
    const cookie = `ccw_session=${login.cookies.find((entry) => entry.name === 'ccw_session')?.value}`

    const authenticated = await app.inject({ method: 'GET', url: '/api/auth/status', headers: { cookie } })
    expect(authenticated.json()).toMatchObject({ data: { authenticated: true } })

    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } })
    expect(logout.statusCode).toBe(200)
    expect(logout.cookies.find((entry) => entry.name === 'ccw_session')?.value).toBe('')
  })
})

describe('login page and SPA gate', () => {
  it('redirects an unauthenticated page request to /login', async () => {
    const app = await createApp()
    const response = await app.inject({ method: 'GET', url: '/chat/abc' })

    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe('/login?next=%2Fchat%2Fabc')
  })

  it('serves the SPA shell (not a redirect) without a session', async () => {
    const webDist = mkdtempSync(join(tmpdir(), 'ccw-auth-web-'))
    tempDirs.push(webDist)
    writeFileSync(join(webDist, 'index.html'), '<!doctype html><html><body><div id="root"></div></body></html>')

    const app = await createApp({ webDist })
    const response = await app.inject({ method: 'GET', url: '/login?next=%2Fapp%2Fchat' })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/html')
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.body).toContain('<div id="root">')
  })

  it('explains a missing web build instead of redirecting', async () => {
    const app = await createApp()
    const response = await app.inject({ method: 'GET', url: '/login' })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ error: 'web_build_missing' })
  })

  it('bounces an authenticated visitor away from /login', async () => {
    const app = await createApp()
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: PASSWORD } })
    const cookie = `ccw_session=${login.cookies.find((entry) => entry.name === 'ccw_session')?.value}`

    const response = await app.inject({ method: 'GET', url: '/login?next=%2Fsettings', headers: { cookie } })
    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe('/settings')
  })

  it('lets API and asset paths through the gate', async () => {
    const app = await createApp()
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200)
    // No web build in this config: the point is that the gate did not redirect.
    expect((await app.inject({ method: 'GET', url: '/assets/app.js' })).statusCode).not.toBe(302)
  })
})

describe('sanitizeNext', () => {
  it('only allows same-origin absolute paths', () => {
    expect(sanitizeNext('/chat/1')).toBe('/chat/1')
    expect(sanitizeNext(undefined)).toBe('/')
    expect(sanitizeNext('https://evil.example/')).toBe('/')
    expect(sanitizeNext('//evil.example/')).toBe('/')
    expect(sanitizeNext('/\\evil.example')).toBe('/')
    expect(sanitizeNext('/ok\ninjected')).toBe('/')
  })
})
