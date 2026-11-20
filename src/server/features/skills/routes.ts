import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { FastifyInstance } from 'fastify'

import { skillService } from '@main/ai/skills/SkillService'
import { skillHandlers } from '@main/ipc/handlers/skill'
import { skillRequestSchemas } from '@shared/ipc/schemas/skill'
import type { IpcHandlersFor } from '@shared/ipc/types'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import { ForbiddenError, UnauthorizedError, type AuthGuard } from '../../auth/guard'
import { forbidden, unauthorized } from '../../routes/auth'
import type { RpcRegistry } from '../../transport/registry'
import type { SkillStorage } from './SkillStorage'

const MAX_SKILL_ZIP_BYTES = 20 * 1024 * 1024

/**
 * Strip host-only provenance from Skill payloads. ZIP installs normally record
 * `file:///tmp/...` (the upload staging file, or the desktop picker path); the
 * browser gets `null` instead, and uploads use a stable `zip://<sha256>` URL so
 * re-installing the same archive still replaces the same row.
 */
function sanitizeSkillValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeSkillValue)
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'sourceUrl' && typeof entry === 'string' && !/^https?:\/\//i.test(entry)) {
        result[key] = null
        continue
      }
      result[key] = sanitizeSkillValue(entry)
    }
    return result
  }
  return value
}

const sanitizedSkillHandlers = Object.fromEntries(
  Object.entries(skillHandlers).map(([route, handler]) => [
    route,
    async (...args: unknown[]) => sanitizeSkillValue(await (handler as (...a: unknown[]) => unknown)(...args))
  ])
) as unknown as IpcHandlersFor<typeof skillRequestSchemas>

const webSkillHandlers = (storage: SkillStorage): IpcHandlersFor<typeof skillRequestSchemas> => ({
  ...sanitizedSkillHandlers,
  'skill.install_from_directory': async () => {
    throw new Error('Installing from a server directory is not available; upload a ZIP instead')
  },
  'skill.install_from_zip': async () => {
    throw new Error('Upload the ZIP through POST /api/skills/install')
  },
  'skill.discover_system': async () => [],
  'skill.import_system': async () => {
    throw new Error('Importing a system Skill directory is not available in the web build')
  },
  'skill.folder.open': async () => {
    throw new Error('Skill folders open in the in-app file browser')
  },
  'skill.folder.resolve': async ({ skillId }) => {
    const skill = await skillService.getById(skillId)
    if (!skill) throw new Error(`Skill not found: ${skillId}`)
    const rootPath = AbsoluteFilePathSchema.parse(storage.logicalPath(skillService.getInstalledSkillDirectory(skill)))
    return skill.source === 'builtin'
      ? { rootPath, access: 'read_only' as const, readOnlyReason: 'builtin' as const }
      : { rootPath, access: 'read_write' as const }
  }
})

export interface SkillRouteOptions {
  storage: SkillStorage
}

export function registerSkillRoutes(registry: RpcRegistry, options: SkillRouteOptions): void {
  registry.register(skillRequestSchemas, webSkillHandlers(options.storage))
}

export interface SkillUploadRouteOptions {
  guard: AuthGuard
  /** DATA_DIR root; uploads stage under `<root>/tmp` and are removed after install. */
  dataRoot: string
}

/**
 * Local Skill installation for the browser: `POST /api/skills/install`.
 *
 * The desktop picker handed the main process a host path. The browser cannot
 * produce one, so the ZIP arrives as multipart bytes, is staged under
 * `DATA_DIR/tmp`, installed through the same `SkillService.installFromZip`
 * path, and removed regardless of outcome.
 */
export async function registerSkillUploadRoutes(app: FastifyInstance, options: SkillUploadRouteOptions): Promise<void> {
  app.post('/api/skills/install', async (request, reply) => {
    try {
      options.guard.assertSameOrigin(request)
      options.guard.assertAuthenticated(request)
    } catch (error) {
      if (error instanceof ForbiddenError) return forbidden(reply)
      if (error instanceof UnauthorizedError) return unauthorized(reply)
      throw error
    }

    const part = await request.file()
    if (!part) {
      return reply.code(400).send({ error: 'Multipart field "file" is required' })
    }
    const data = await part.toBuffer()
    if (data.byteLength === 0) return reply.code(400).send({ error: 'The uploaded ZIP is empty' })
    if (data.byteLength > MAX_SKILL_ZIP_BYTES) {
      return reply.code(413).send({ error: `The Skill ZIP exceeds the ${MAX_SKILL_ZIP_BYTES}-byte limit` })
    }

    const stagingRoot = path.join(options.dataRoot, 'tmp')
    await mkdir(stagingRoot, { recursive: true })
    const directory = await mkdtemp(path.join(stagingRoot, 'skill-upload-'))
    const zipFilePath = path.join(directory, 'upload.zip')
    try {
      await writeFile(zipFilePath, data, { mode: 0o600 })
      const contentHash = createHash('sha256').update(data).digest('hex')
      const skill = await skillService.installFromZip({
        zipFilePath,
        sourceUrl: `zip://sha256/${contentHash}`
      })
      return reply.code(201).send({ skill: sanitizeSkillValue(skill) })
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
}
