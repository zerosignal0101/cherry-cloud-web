import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'

import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'

import { buildApp } from '../../../app'
import type { ServerConfig } from '../../../config'

const apps: FastifyInstance[] = []
const tempDirs: string[] = []
const PASSWORD = 'test-password'

function config(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const dataDir = mkdtempSync(join(tmpdir(), 'ccw-workspace-routes-'))
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

describe('workspace routes', () => {
  it('creates, reads and deletes files inside the server sandbox', async () => {
    const app = await createApp()
    const cookie = await login(app)

    const created = await rpc(app, cookie, 'workspace.create', { name: 'Notes' })
    expect(created.ok).toBe(true)
    const workspace = created.data as { id: string; name: string }

    const written = await rpc(app, cookie, 'workspace.write_file', {
      id: workspace.id,
      path: 'daily/today.md',
      content: '# today'
    })
    expect(written.ok).toBe(true)

    const read = await rpc(app, cookie, 'workspace.read_file', {
      id: workspace.id,
      path: 'daily/today.md'
    })
    expect(read).toMatchObject({ ok: true, data: { content: '# today' } })

    const listed = await rpc(app, cookie, 'workspace.list_files', { id: workspace.id, path: 'daily' })
    expect(listed).toMatchObject({ ok: true, data: { entries: [{ path: 'daily/today.md' }] } })

    const deleted = await rpc(app, cookie, 'workspace.delete', { id: workspace.id })
    expect(deleted.ok).toBe(true)
    const after = await rpc(app, cookie, 'workspace.list', {})
    expect(after.ok).toBe(true)
    const remaining = (after.data as { workspaces: Array<{ id: string }> }).workspaces.map((item) => item.id)
    expect(remaining).not.toContain(workspace.id)
  })

  it('refuses to leave the workspace root', async () => {
    const app = await createApp()
    const cookie = await login(app)
    const created = await rpc(app, cookie, 'workspace.create', { name: 'Notes' })
    const workspace = created.data as { id: string }

    const escaped = await rpc(app, cookie, 'workspace.write_file', {
      id: workspace.id,
      path: '../outside.md',
      content: 'x'
    })
    expect(escaped.ok).toBe(false)
    expect(escaped.error?.code).not.toBe('ROUTE_NOT_FOUND')
  })

  it('does not register code CLI or terminal routes', async () => {
    const app = await createApp()
    const cookie = await login(app)

    for (const route of ['code_cli.run', 'code_cli.read_config', 'code_cli.write_config', 'code_terminal.status']) {
      const response = await rpc(app, cookie, route, {})
      expect(response.ok).toBe(false)
      expect(response.error?.code).toBe('ROUTE_NOT_FOUND')
    }
  })
})

describe('M10 route registration', () => {
  it('serves translate.open instead of returning ROUTE_NOT_FOUND', async () => {
    const app = await createApp()
    const cookie = await login(app)

    const response = await rpc(app, cookie, 'translate.open', {
      streamId: 'translate:test',
      text: 'hello',
      targetLangCode: 'zh-cn'
    })

    expect(response.ok).toBe(false)
    expect(response.error?.code).not.toBe('ROUTE_NOT_FOUND')
  })

  it('can create, read and delete a scheduled task', async () => {
    const app = await createApp()
    const cookie = await login(app)

    const providerId = app.db.getDb().select().from(userProviderTable).limit(1).all()[0]?.providerId
    if (!providerId) throw new Error('preset provider was not seeded')
    const modelId = `${providerId}::test-model`
    app.db
      .getDb()
      .insert(userModelTable)
      .values({
        id: modelId,
        providerId,
        modelId: 'test-model',
        name: 'Test model',
        capabilities: [],
        supportsStreaming: true,
        orderKey: 'a0'
      })
      .run()

    const agent = await rpc(app, cookie, 'ai.agent.create', {
      type: 'pi',
      name: 'Task agent',
      model: modelId
    })
    expect(agent.ok).toBe(true)
    const agentId = (agent.data as { id: string }).id

    const created = await rpc(app, cookie, 'ai.agent.task.create', {
      agentId,
      name: 'Daily summary',
      prompt: 'Summarize the day',
      trigger: { kind: 'interval', ms: 60_000 },
      workspace: { type: 'system' },
      timeoutMinutes: null
    })
    expect(created.ok).toBe(true)
    const taskId = (created.data as { id: string }).id

    const listed = await app.inject({
      method: 'POST',
      url: '/api/data',
      headers: { cookie },
      payload: { id: 'tasks-1', method: 'GET', path: '/agent-tasks' }
    })
    expect(listed.statusCode).toBe(200)
    expect(listed.json()).toMatchObject({ status: 200 })

    const deleted = await rpc(app, cookie, 'ai.agent.task.delete', { agentId, taskId })
    expect(deleted).toMatchObject({ ok: true })
  })

  it('serves notification.activate for persisted records', async () => {
    const app = await createApp()
    const cookie = await login(app)

    const response = await rpc(app, cookie, 'notification.activate', { id: 'missing' })
    expect(response.ok).toBe(false)
    expect(response.error?.code).not.toBe('ROUTE_NOT_FOUND')
  })

  it('mirrors shared cache entries for browser tabs', async () => {
    const app = await createApp()
    const cookie = await login(app)

    const key = 'jobs.state.probe'
    const set = await rpc(app, cookie, 'cache.sync_shared', {
      type: 'shared',
      key,
      value: { status: 'running' },
      expireAt: Date.now() + 60_000
    })
    expect(set.ok).toBe(true)

    const snapshot = await rpc(app, cookie, 'cache.get_all_shared', undefined)
    expect(snapshot).toMatchObject({ ok: true, data: { [key]: { value: { status: 'running' } } } })

    const deleted = await rpc(app, cookie, 'cache.sync_shared', { type: 'shared', key })
    expect(deleted.ok).toBe(true)
    const after = await rpc(app, cookie, 'cache.get_all_shared', undefined)
    expect(after).toMatchObject({ ok: true, data: {} })
  })
})
