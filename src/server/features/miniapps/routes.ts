import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { FastifyInstance, FastifyReply } from 'fastify'
import mime from 'mime'

import { application } from '@application'
import { installationOf } from '@main/features/miniApp/install/installer'
import { previewFileForInstall } from '@main/features/miniApp/install/installFlow'
import { miniAppInstallPath } from '@main/features/miniApp/paths'
import { miniAppHandlers } from '@main/ipc/handlers/miniApp'
import { miniAppRequestSchemas } from '@shared/ipc/schemas/miniApp'
import type { IpcContext, IpcHandlersFor } from '@shared/ipc/types'
import { MINI_APP_MAX_PACKAGE_BYTES, MiniAppIdSchema } from '@shared/types/miniAppManifest'

import { ForbiddenError, UnauthorizedError, type AuthGuard } from '../../auth/guard'
import { forbidden, unauthorized } from '../../routes/auth'
import { normalizeClientId } from '../../transport/connections'
import type { RpcRegistry } from '../../transport/registry'
import { handleWebMiniAppBridge } from './bridge'
import { buildMiniAppBridgeScript } from './bridgeScript'
import type { MiniAppAssets } from './MiniAppAssets'

/** Thrown by the handlers below when the desktop-only entry point is called. */
const desktopOnly = (message: string) => async (): Promise<never> => {
  throw new Error(message)
}

/** Install/update tokens whose bytes still live in a server temp directory. */
const uploadDirectories = new Map<string, string>()
const uploadDirectoryByOwner = new Map<string, string>()

async function rememberUpload(token: string, directory: string, ownerId: string): Promise<void> {
  const previous = uploadDirectoryByOwner.get(ownerId)
  if (previous && previous !== directory) await rm(previous, { recursive: true, force: true })
  uploadDirectoryByOwner.set(ownerId, directory)
  uploadDirectories.set(token, directory)
}

async function forgetUpload(token: string | undefined): Promise<void> {
  if (!token) return
  const directory = uploadDirectories.get(token)
  uploadDirectories.delete(token)
  if (!directory) return
  for (const [ownerId, value] of uploadDirectoryByOwner) {
    if (value === directory) uploadDirectoryByOwner.delete(ownerId)
  }
  await rm(directory, { recursive: true, force: true })
}

async function sweepOldUploads(root: string): Promise<void> {
  const tmp = path.join(root, 'tmp')
  try {
    const entries = await readdir(tmp, { withFileTypes: true })
    const cutoff = Date.now() - 60 * 60_000
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('miniapp-upload-')) continue
      const target = path.join(tmp, entry.name)
      const info = await stat(target).catch(() => null)
      if (info && info.mtimeMs < cutoff) await rm(target, { recursive: true, force: true })
    }
  } catch {
    // No temp directory yet: nothing to sweep.
  }
}

function sanitize<T>(assets: MiniAppAssets, value: T): T {
  return assets.rewriteValue(value) as T
}

interface MiniAppRouteOptions {
  assets: MiniAppAssets
  dataRoot: string
}

export function registerMiniAppRoutes(registry: RpcRegistry, assets: MiniAppAssets): void {
  const handlers: IpcHandlersFor<typeof miniAppRequestSchemas> = {
    ...miniAppHandlers,
    'mini_app.install.pick_and_preview': desktopOnly('Pick a .miniapp file in the browser instead'),
    'mini_app.install.preview_file': desktopOnly('Upload the .miniapp file through POST /api/miniapps/preview'),
    'mini_app.activity.open_folder': desktopOnly('Mini app logs live inside DATA_DIR'),
    'mini_app.runtime.prepare': async ({ appId }) => {
      await application.get('MiniAppRuntimeService').recovered
      if (application.get('MiniAppRuntimeService').isQuiescing(appId)) {
        throw new Error(`Mini app ${appId} is being updated`)
      }
    },
    'mini_app.runtime.set_visible': async () => {},
    'mini_app.install.confirm': async (input, context) => {
      try {
        const installed = await miniAppHandlers['mini_app.install.confirm'](input, context)
        return sanitize(assets, installed)
      } finally {
        await forgetUpload(input.installToken)
      }
    },
    'mini_app.install.cancel_preview': async (input, context) => {
      try {
        await miniAppHandlers['mini_app.install.cancel_preview'](input, context)
      } finally {
        await forgetUpload(input.installToken)
      }
    },
    'mini_app.update.apply': async (input, context) => {
      try {
        await miniAppHandlers['mini_app.update.apply'](input, context)
      } finally {
        await forgetUpload(input.updateToken)
      }
    },
    'mini_app.bridge.invoke': (input) => handleWebMiniAppBridge(input.appId, input)
  }

  // Every mini app RPC response may carry a `cherry-miniapp://` URL from the
  // shared DataApi DTO. Rewrite it once, here, instead of teaching each page the
  // browser's asset route.
  const sanitizedHandlers = Object.fromEntries(
    Object.entries(handlers).map(([route, handler]) => [
      route,
      async (input: unknown, context: IpcContext) =>
        sanitize(assets, await (handler as (value: unknown, ctx: IpcContext) => Promise<unknown>)(input, context))
    ])
  ) as IpcHandlersFor<typeof miniAppRequestSchemas>

  registry.register(miniAppRequestSchemas, sanitizedHandlers)
}

export interface MiniAppHttpRouteOptions extends MiniAppRouteOptions {
  guard: AuthGuard
}

/**
 * Browser upload + signed asset routes.
 *
 * The upload replaces the desktop file picker: the browser posts the `.miniapp`
 * bytes, the server stages them under `DATA_DIR/tmp`, and the ordinary preview →
 * consent → confirm ledger runs unchanged. The temp directory lives until the
 * token is consumed or cancelled.
 */
export async function registerMiniAppHttpRoutes(app: FastifyInstance, options: MiniAppHttpRouteOptions): Promise<void> {
  await sweepOldUploads(options.dataRoot)

  app.post('/api/miniapps/preview', async (request, reply) => {
    try {
      options.guard.assertSameOrigin(request)
      options.guard.assertAuthenticated(request)
    } catch (error) {
      if (error instanceof ForbiddenError) return forbidden(reply)
      if (error instanceof UnauthorizedError) return unauthorized(reply)
      throw error
    }

    const ownerId = normalizeClientId(request.headers['x-client-id'])
    if (!ownerId) return reply.code(400).send({ error: 'x-client-id is required' })

    const part = await request.file()
    if (!part) return reply.code(400).send({ error: 'Multipart field "file" is required' })
    const data = await part.toBuffer()
    if (data.byteLength === 0) return reply.code(400).send({ error: 'The uploaded package is empty' })
    if (data.byteLength > MINI_APP_MAX_PACKAGE_BYTES) {
      return reply.code(413).send({ error: `The package exceeds the ${MINI_APP_MAX_PACKAGE_BYTES}-byte limit` })
    }

    const stagingRoot = path.join(options.dataRoot, 'tmp')
    await mkdir(stagingRoot, { recursive: true })
    const directory = await mkdtemp(path.join(stagingRoot, 'miniapp-upload-'))
    const packagePath = path.join(directory, 'upload.miniapp')
    try {
      await writeFile(packagePath, data, { mode: 0o600 })
      const preview = await previewFileForInstall(packagePath, ownerId)
      const token = preview.kind === 'upgrade' ? preview.update.updateToken : preview.installToken
      await rememberUpload(token, directory, ownerId)
      return reply.code(200).send(sanitize(options.assets, preview))
    } catch (error) {
      await rm(directory, { recursive: true, force: true })
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) })
    }
  })

  app.get('/api/miniapps/:appId/assets/:token/*', async (request, reply) => {
    const params = request.params as { appId?: string; token?: string; '*': string }
    const parsedId = MiniAppIdSchema.safeParse(params.appId)
    if (!parsedId.success || !params.token || !options.assets.verify(parsedId.data, params.token)) {
      return reply.code(404).send({ error: 'not_found' })
    }
    return serveAsset(parsedId.data, params.token, params['*'], reply)
  })
}

async function serveAsset(appId: string, token: string, rawPath: string, reply: FastifyReply): Promise<unknown> {
  let relative: string
  try {
    relative = decodeURIComponent(rawPath ?? '').replace(/^\/+/, '')
  } catch {
    return reply.code(404).send({ error: 'not_found' })
  }
  if (relative.includes('\0') || relative.includes('\\') || relative.split('/').includes('..')) {
    return reply.code(404).send({ error: 'not_found' })
  }
  if (relative === '__cherry' || relative.startsWith('__cherry/')) {
    return reply.code(404).send({ error: 'not_found' })
  }

  try {
    // The same installation witness the desktop protocol uses.
    installationOf(appId)
  } catch {
    return reply.code(404).send({ error: 'not_found' })
  }

  let root: string
  let target: string
  try {
    root = await realpath(miniAppInstallPath(appId))
    target = await realpath(path.join(root, relative || 'index.html'))
  } catch {
    return reply.code(404).send({ error: 'not_found' })
  }
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    return reply.code(403).send({ error: 'forbidden' })
  }
  const info = await stat(target).catch(() => null)
  if (!info?.isFile()) return reply.code(404).send({ error: 'not_found' })

  const extension = path.extname(target).toLowerCase()
  const contentType = mime.getType(extension) || 'application/octet-stream'
  const headers = {
    'content-type': contentType,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'access-control-allow-origin': '*',
    'cross-origin-resource-policy': 'cross-origin',
    'content-security-policy': [
      `sandbox allow-scripts`,
      `default-src 'self' data: blob:`,
      `script-src 'self' 'unsafe-inline' 'unsafe-eval'`,
      `style-src 'self' 'unsafe-inline'`,
      `img-src 'self' data: blob:`,
      `font-src 'self' data:`,
      `media-src 'self' data: blob:`,
      `connect-src 'none'`,
      `frame-src 'none'`,
      `worker-src 'none'`,
      `object-src 'none'`,
      `base-uri 'self'`,
      `form-action 'none'`
    ].join('; ')
  }

  if (contentType.startsWith('text/html')) {
    let html = await readFile(target, 'utf8')
    const base = `/api/miniapps/${encodeURIComponent(appId)}/assets/${token}/`
    // Root-relative references inside a package are author mistakes; keep them
    // inside this app instead of letting them hit the host application.
    html = html.replace(/(\s(?:src|href)=["'])\/(?!\/)/g, `$1${base}`)
    const script = `<script>${buildMiniAppBridgeScript(appId)}</script>`
    html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${script}</body>`) : `${html}${script}`
    return reply.headers(headers).send(html)
  }

  return reply.headers(headers).send(await readFile(target))
}
