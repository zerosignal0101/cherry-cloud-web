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

function config(): ServerConfig {
  const dataDir = mkdtempSync(join(tmpdir(), 'ccw-file-processing-routes-'))
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
  input: unknown
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

describe('file processing routes', () => {
  it('lists the processors the web runtime can actually run', async () => {
    const app = await createApp()
    const cookie = await login(app)

    const response = await rpc(app, cookie, 'file_processing.list_available_processors', undefined)

    expect(response.ok).toBe(true)
    const processorIds = (response.data as { processorIds: string[] }).processorIds
    expect(processorIds).toEqual(expect.arrayContaining(['tesseract', 'paddleocr', 'mistral', 'open-mineru']))
    // Local ONNX OCR needs Electron's utility-process host, which the server does not have.
    expect(processorIds).not.toContain('local-paddleocr')
    expect(processorIds).not.toContain('local-document')
  })

  it('answers unknown task ids with null instead of a missing route', async () => {
    const app = await createApp()
    const cookie = await login(app)

    const response = await rpc(app, cookie, 'file_processing.get_task', { taskId: 'missing-task' })

    expect(response).toMatchObject({ ok: true, data: null })
  })
})
