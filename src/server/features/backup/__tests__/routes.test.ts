import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'

import { buildApp } from '../../../app'
import type { ServerConfig } from '../../../config'

const apps: FastifyInstance[] = []
const tempDirs: string[] = []
const PASSWORD = 'backup-test-password'

function config(): ServerConfig {
  const dataDir = mkdtempSync(join(tmpdir(), 'ccw-backup-routes-'))
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
    allowedOrigins: []
  }
}

async function createApp(): Promise<FastifyInstance> {
  const app = await buildApp(config())
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
): Promise<{ ok: boolean; data?: unknown; error?: { message?: string } }> {
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

describe('backup routes', () => {
  it('stores backup credentials without reading plaintext back', async () => {
    const app = await createApp()
    const cookie = await login(app)

    await expect(rpc(app, cookie, 'backup.get_secret_status')).resolves.toMatchObject({
      ok: true,
      data: { webdavPassword: false, s3SecretAccessKey: false }
    })

    await expect(
      rpc(app, cookie, 'backup.set_secret', { key: 'webdav.password', value: 'super-secret' })
    ).resolves.toMatchObject({ ok: true })
    await expect(rpc(app, cookie, 'backup.get_secret_status')).resolves.toMatchObject({
      ok: true,
      data: { webdavPassword: true }
    })

    await expect(rpc(app, cookie, 'backup.clear_secret', { key: 'webdav.password' })).resolves.toMatchObject({
      ok: true
    })
    await expect(rpc(app, cookie, 'backup.get_secret_status')).resolves.toMatchObject({
      ok: true,
      data: { webdavPassword: false }
    })
  })

  it('serves the real automatic-backup snapshot', async () => {
    const app = await createApp()
    const cookie = await login(app)

    await expect(rpc(app, cookie, 'backup.get_auto_sync_state')).resolves.toMatchObject({
      ok: true,
      data: { pendingNotifications: [] }
    })
  })

  it('generates Word documents on the server for browser download', async () => {
    const app = await createApp()
    const cookie = await login(app)

    const response = await rpc(app, cookie, 'export.word.download', {
      markdown: '# Title\n\nBody',
      fileName: 'report'
    })
    expect(response.ok).toBe(true)
    const data = response.data as { fileName: string; base64: string; mimeType: string }
    expect(data.fileName).toBe('report.docx')
    expect(data.mimeType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    expect(Buffer.from(data.base64, 'base64').subarray(0, 2).toString()).toBe('PK')
  })
})
