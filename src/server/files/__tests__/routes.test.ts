import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'

import { buildApp } from '../../app'
import type { ServerConfig } from '../../config'
import { parseRange } from '../routes'
import { splitFilename } from '../service'

const apps: FastifyInstance[] = []
const tempDirs: string[] = []

function testConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const dataDir = mkdtempSync(join(tmpdir(), 'ccw-files-'))
  tempDirs.push(dataDir)
  return {
    host: '127.0.0.1',
    port: 0,
    dataDir,
    migrationsDir: resolve(process.cwd(), 'migrations/sqlite-drizzle'),
    webDist: resolve(process.cwd(), 'dist/web'),
    isProduction: false,
    ...overrides
  }
}

async function createApp(config: ServerConfig = testConfig()): Promise<FastifyInstance> {
  const app = await buildApp(config)
  apps.push(app)
  return app
}

function multipartBody(filename: string, content: string, boundary = 'ccw-boundary') {
  const body = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"`,
    'Content-Type: text/plain',
    '',
    content,
    `--${boundary}--`,
    ''
  ].join('\r\n')
  return { body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } }
}

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('POST /api/files', () => {
  it('stores the upload and returns a media url', async () => {
    const app = await createApp()
    const { body, headers } = multipartBody('notes.txt', 'hello web')

    const response = await app.inject({ method: 'POST', url: '/api/files', payload: body, headers })

    expect(response.statusCode).toBe(201)
    const uploaded = response.json<{ id: string; name: string; ext: string; size: number; url: string }>()
    expect(uploaded).toMatchObject({ name: 'notes', ext: 'txt', size: 9, mime: 'text/plain' })
    expect(uploaded.url).toBe(`/media/${uploaded.id}`)
  })

  it('rejects an upload without the access token when one is configured', async () => {
    const app = await createApp(testConfig({ authToken: 'secret' }))
    const { body, headers } = multipartBody('notes.txt', 'hello')

    const unauthorized = await app.inject({ method: 'POST', url: '/api/files', payload: body, headers })
    expect(unauthorized.statusCode).toBe(401)

    const authorized = await app.inject({
      method: 'POST',
      url: '/api/files',
      payload: body,
      headers: { ...headers, authorization: 'Bearer secret' }
    })
    expect(authorized.statusCode).toBe(201)
  })

  it('rejects a request without a file field', async () => {
    const app = await createApp()
    const response = await app.inject({
      method: 'POST',
      url: '/api/files',
      payload: '',
      headers: { 'content-type': 'multipart/form-data; boundary=ccw-boundary' }
    })
    expect(response.statusCode).toBe(400)
  })
})

describe('GET /media/:id', () => {
  it('serves the stored bytes with metadata and range support', async () => {
    const app = await createApp()
    const { body, headers } = multipartBody('notes.txt', 'hello web')
    const upload = await app.inject({ method: 'POST', url: '/api/files', payload: body, headers })
    const { id, url } = upload.json<{ id: string; url: string }>()

    const full = await app.inject({ method: 'GET', url })
    expect(full.statusCode).toBe(200)
    expect(full.headers['content-type']).toContain('text/plain')
    expect(full.headers['accept-ranges']).toBe('bytes')
    expect(full.body).toBe('hello web')

    const partial = await app.inject({ method: 'GET', url, headers: { range: 'bytes=0-4' } })
    expect(partial.statusCode).toBe(206)
    expect(partial.headers['content-range']).toBe('bytes 0-4/9')
    expect(partial.body).toBe('hello')

    const unsatisfiable = await app.inject({ method: 'GET', url, headers: { range: 'bytes=50-60' } })
    expect(unsatisfiable.statusCode).toBe(416)

    const conditional = await app.inject({ method: 'GET', url, headers: { 'if-none-match': full.headers.etag as string } })
    expect(conditional.statusCode).toBe(304)

    expect(id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('returns 404 for unknown or malformed ids', async () => {
    const app = await createApp()

    const unknown = await app.inject({ method: 'GET', url: '/media/01a1f36c-0000-7000-8000-000000000000' })
    expect(unknown.statusCode).toBe(404)

    const malformed = await app.inject({ method: 'GET', url: '/media/not-an-id' })
    expect(malformed.statusCode).toBe(404)
  })
})

describe('parseRange', () => {
  it('handles open, closed and suffix ranges', () => {
    expect(parseRange(undefined, 10)).toBeNull()
    expect(parseRange('bytes=0-4', 10)).toEqual({ start: 0, end: 4 })
    expect(parseRange('bytes=4-', 10)).toEqual({ start: 4, end: 9 })
    expect(parseRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 })
    expect(parseRange('bytes=0-100', 10)).toEqual({ start: 0, end: 9 })
  })

  it('rejects ranges that cannot be satisfied', () => {
    expect(parseRange('bytes=10-20', 10)).toBe('invalid')
    expect(parseRange('bytes=5-2', 10)).toBe('invalid')
    expect(parseRange('bytes=-', 10)).toBe('invalid')
    expect(parseRange('items=0-2', 10)).toBe('invalid')
  })
})

describe('splitFilename', () => {
  it('strips paths and lowercases the extension', () => {
    expect(splitFilename('C:\\Users\\me\\Report.PDF')).toEqual({ name: 'Report', ext: 'pdf' })
    expect(splitFilename('/tmp/archive.tar.gz')).toEqual({ name: 'archive.tar', ext: 'gz' })
    expect(splitFilename('README')).toEqual({ name: 'README', ext: null })
    expect(splitFilename('.env')).toEqual({ name: '.env', ext: null })
  })
})
