import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'

import mime from 'mime'
import type { FastifyInstance, FastifyReply } from 'fastify'

import { resolvePhysicalPath } from '@main/services/file/utils/pathResolver'
import { FileEntryIdSchema } from '@shared/data/types/file'

import type { AccessGuard } from '../auth/guard'
import { UnauthorizedError } from '../auth/guard'
import { findFileEntry, storeUploadedFile } from './service'

export interface FileRouteOptions {
  guard: AccessGuard
}

export async function registerFileRoutes(app: FastifyInstance, options: FileRouteOptions): Promise<void> {
  app.post('/api/files', async (request, reply) => {
    try {
      options.guard.assertHttp(request)
    } catch (error) {
      if (error instanceof UnauthorizedError) return sendUnauthorized(reply)
      throw error
    }

    const part = await request.file()
    if (!part) {
      return reply.code(400).send({ ok: false, error: { code: 'NO_FILE', message: 'Multipart field "file" is required' } })
    }

    const data = await part.toBuffer()
    const entry = await storeUploadedFile({ filename: part.filename, data })

    return reply.code(201).send(
      entryToResponse(entry.id, entry.name, entry.ext, entry.origin === 'internal' ? entry.size : null)
    )
  })

  /**
   * Media is served without the access token: `<img src>`/`<audio src>` cannot set
   * an Authorization header. The URL is unguessable (uuid v7) and the route becomes
   * session-gated together with the rest of the app in M3.
   */
  app.get('/media/:id', async (request, reply) => {
    const parsed = FileEntryIdSchema.safeParse((request.params as { id?: string }).id)
    if (!parsed.success) return reply.code(404).send({ error: 'not_found' })

    const entry = findFileEntry(parsed.data)
    if (!entry) return reply.code(404).send({ error: 'not_found' })

    const physicalPath = resolvePhysicalPath(entry)
    const info = await stat(physicalPath).catch(() => null)
    if (!info) return reply.code(404).send({ error: 'not_found' })

    const contentType = (entry.ext && mime.getType(entry.ext)) || 'application/octet-stream'
    const contentHash = entry.origin === 'internal' ? entry.contentHash : null
    const etag = contentHash ? `"${contentHash}"` : `"${info.size}-${Math.floor(info.mtimeMs)}"`

    reply
      .header('content-type', contentType)
      .header('accept-ranges', 'bytes')
      .header('etag', etag)
      .header('cache-control', 'private, max-age=31536000, immutable')
      .header('content-disposition', contentDisposition(entry.name, entry.ext))

    if (request.headers['if-none-match'] === etag) {
      return reply.code(304).send()
    }

    const range = parseRange(request.headers.range, info.size)
    if (range === 'invalid') {
      return reply.code(416).header('content-range', `bytes */${info.size}`).send()
    }
    if (range) {
      return reply
        .code(206)
        .header('content-range', `bytes ${range.start}-${range.end}/${info.size}`)
        .header('content-length', range.end - range.start + 1)
        .send(createReadStream(physicalPath, { start: range.start, end: range.end }))
    }

    reply.header('content-length', info.size)
    return reply.send(createReadStream(physicalPath))
  })
}

function sendUnauthorized(reply: FastifyReply): FastifyReply {
  return reply.code(401).send({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } })
}

function entryToResponse(id: string, name: string, ext: string | null, size: number | null) {
  return {
    id,
    name,
    ext,
    size,
    mime: (ext && mime.getType(ext)) || 'application/octet-stream',
    url: `/media/${id}`
  }
}

/** RFC 6266: keep an ASCII fallback and add the UTF-8 form browsers prefer. */
function contentDisposition(name: string, ext: string | null): string {
  const filename = ext ? `${name}.${ext}` : name
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

interface ByteRange {
  start: number
  end: number
}

/**
 * Only the single-range form is supported — that is all `<video>`/`<audio>`
 * seeking needs, and multi-range responses are not worth the multipart writer.
 */
export function parseRange(header: string | undefined, size: number): ByteRange | 'invalid' | null {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return 'invalid'

  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return 'invalid'

  if (rawStart === '') {
    // Suffix form: the last N bytes.
    const suffix = Number(rawEnd)
    if (suffix === 0) return 'invalid'
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }

  const start = Number(rawStart)
  const end = rawEnd === '' ? size - 1 : Number(rawEnd)
  if (start >= size || end < start) return 'invalid'
  return { start, end: Math.min(end, size - 1) }
}
