import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'

import { buildApp } from '../../../app'
import type { ServerConfig } from '../../../config'

const apps: FastifyInstance[] = []
const tempDirs: string[] = []
const PASSWORD = 'test-password'

function config(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const dataDir = mkdtempSync(join(tmpdir(), 'ccw-notes-routes-'))
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

async function login(app: FastifyInstance): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: PASSWORD } })
  const cookie = response.cookies.find((entry) => entry.name === 'ccw_session')
  if (!cookie) throw new Error('session cookie missing')
  return `ccw_session=${cookie.value}`
}

async function rpc(
  app: FastifyInstance,
  cookie: string,
  route: string,
  input?: unknown
): Promise<{ ok: boolean; data?: unknown; error?: { code: string; message: string } }> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/rpc',
    headers: { cookie },
    payload: { route, input }
  })
  return response.json()
}

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('notes routes', () => {
  it('serves the logical notes root through app.get_info', async () => {
    const app = await createApp()
    const cookie = await login(app)
    await expect(rpc(app, cookie, 'app.get_info')).resolves.toMatchObject({
      ok: true,
      data: { notesPath: '/notes' }
    })
  })

  it('creates, reads, renames, moves, searches and deletes notes', async () => {
    const app = await createApp()
    const cookie = await login(app)

    expect(await rpc(app, cookie, 'notes.mkdir', { path: '/notes/inbox' })).toMatchObject({ ok: true })
    expect(
      await rpc(app, cookie, 'notes.write', {
        path: '/notes/inbox/today.md',
        content: '# today\nalpha beta'
      })
    ).toMatchObject({ ok: true })

    await expect(rpc(app, cookie, 'notes.read', { path: '/notes/inbox/today.md' })).resolves.toMatchObject({
      ok: true,
      data: { content: '# today\nalpha beta' }
    })

    await expect(
      rpc(app, cookie, 'notes.check_name', { parentPath: '/notes/inbox', name: 'today', isFile: true })
    ).resolves.toMatchObject({ ok: true, data: { safeName: 'today', exists: true } })

    await expect(
      rpc(app, cookie, 'notes.rename', { path: '/notes/inbox/today.md', newName: 'renamed' })
    ).resolves.toMatchObject({ ok: true, data: { path: '/notes/inbox/renamed.md', name: 'renamed' } })

    await rpc(app, cookie, 'notes.mkdir', { path: '/notes/archive' })
    await expect(
      rpc(app, cookie, 'notes.move', {
        fromPath: '/notes/inbox/renamed.md',
        toPath: '/notes/archive/renamed.md'
      })
    ).resolves.toMatchObject({ ok: true, data: { path: '/notes/archive/renamed.md' } })

    await expect(rpc(app, cookie, 'notes.search', { keyword: 'beta' })).resolves.toMatchObject({
      ok: true,
      data: {
        results: [expect.objectContaining({ path: '/notes/archive/renamed.md', matchType: 'content' })]
      }
    })

    await rpc(app, cookie, 'notes.delete', { path: '/notes/archive', recursive: true })
    await expect(rpc(app, cookie, 'notes.list', { path: '/notes', recursive: true })).resolves.toMatchObject({
      ok: true,
      data: { entries: [expect.objectContaining({ path: '/notes/inbox', kind: 'directory' })] }
    })
  })

  it('refuses notes paths outside the namespace', async () => {
    const app = await createApp()
    const cookie = await login(app)

    const response = await rpc(app, cookie, 'notes.write', { path: '/etc/notes.md', content: 'x' })
    expect(response.ok).toBe(false)
    expect(response.error?.code).not.toBe('ROUTE_NOT_FOUND')
  })
})
