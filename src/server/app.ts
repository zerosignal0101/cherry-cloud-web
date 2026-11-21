import { createHmac } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import fastifyCookie from '@fastify/cookie'
import fastifyMultipart from '@fastify/multipart'
import fastifyRateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import { resolveDataPaths } from '@platform/dataPaths'
import Fastify, { type FastifyInstance } from 'fastify'

import { application } from '@application'
import { loggerService } from '@logger'

import { registerAiRoutes, registerCapabilityRoutes, registerTranslateRoutes } from './ai/routes'
import { startAiRuntime, stopAiRuntime } from './ai/runtime'
import { configureWindowManager } from './ai/webServices'
import { AuthGuard } from './auth/guard'
import { AuthStore } from './auth/password'
import { SessionSigner } from './auth/session'
import type { ServerConfig } from './config'
import { openDatabase, type DatabaseHandle } from './data/database'
import { configureDbService } from './data/dbService'
import { webSeeders } from './data/seeders'
import { installWindowManager, uninstallWindowManager } from './data/windowManager'
import { registerAgentRoutes } from './features/agents/routes'
import { AutoBackupScheduler } from './features/backup/AutoBackupScheduler'
import { BackupService } from './features/backup/BackupService'
import { promotePendingRestore } from './features/backup/restoreGate'
import { registerBackupRoutes } from './features/backup/routes'
import { registerBrowserRoutes } from './features/browser/routes'
import { registerExportRoutes } from './features/export/routes'
import { registerFileProcessingRoutes } from './features/fileProcessing/routes'
import { MiniAppAssets } from './features/miniapps/MiniAppAssets'
import { registerMiniAppHttpRoutes, registerMiniAppRoutes } from './features/miniapps/routes'
import { NotesStorage } from './features/notes/NotesStorage'
import { registerNotesRoutes } from './features/notes/routes'
import { registerSkillRoutes, registerSkillUploadRoutes } from './features/skills/routes'
import { SkillStorage } from './features/skills/SkillStorage'
import { AgentWorkspaceNamespace } from './features/workspace/AgentWorkspaceNamespace'
import { registerWorkspaceRoutes } from './features/workspace/routes'
import { WorkspaceService } from './features/workspace/WorkspaceService'
import { registerFileRoutes } from './files/routes'
import { MAX_UPLOAD_BYTES } from './files/service'
import { deriveKeyFromSecret, loadOrCreateKeyFile, SecretBox } from './platform/secrets'
import { SecretStore } from './platform/secretStore'
import { registerAuthRoutes, sanitizeNext } from './routes/auth'
import { registerCacheRoutes } from './routes/cache'
import { registerComputerUseRoutes } from './routes/computerUse'
import { getApiServer, registerDataRoutes } from './routes/data'
import { registerEntityImageRoutes } from './routes/entityImages'
import { registerHostRoutes } from './routes/host'
import { registerNotificationRoutes } from './routes/notification'
import { registerPreferenceRoutes } from './routes/preference'
import { registerPreviewRoutes } from './routes/previews'
import { registerSystemRoutes } from './routes/system'
import { registerTrashRoutes } from './routes/trash'
import { registerUiRoutes } from './routes/ui'
import { ConnectionRegistry } from './transport/connections'
import { EventHub } from './transport/events'
import { registerRpcRoutes, registerWebSocketRoute } from './transport/plugins'
import { RpcRegistry } from './transport/registry'

declare module 'fastify' {
  interface FastifyInstance {
    events: EventHub
    db: DatabaseHandle
  }
}

/** Paths that answer before a session exists: the login page, its assets, and health. */
function isPublicPath(rawUrl: string): boolean {
  const path = rawUrl.split('?')[0] ?? '/'
  return (
    path === '/login' ||
    path.startsWith('/assets/') ||
    path === '/favicon.ico' ||
    path.startsWith('/api/') ||
    path.startsWith('/media/')
  )
}

export async function buildApp(config: ServerConfig): Promise<FastifyInstance> {
  application.setDataDir(config.dataDir)
  const dataPaths = resolveDataPaths(config.dataDir)
  const restoreOutcome = await promotePendingRestore(dataPaths, config.migrationsDir)
  if (restoreOutcome === 'promoted') {
    loggerService.withContext('Server').info('Promoted a staged restore before opening the database')
  }

  const app = Fastify({
    logger:
      process.env.NODE_ENV === 'test'
        ? false
        : {
            level: process.env.LOG_LEVEL ?? 'info',
            transport: config.isProduction
              ? undefined
              : { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } }
          },
    trustProxy: true,
    bodyLimit: 32 * 1024 * 1024
  })

  const store = new AuthStore(dataPaths.auth, config.adminPassword)
  const sessionKey = createHmac('sha256', baseKey(config.appSecret, dataPaths.sessionKey))
    .update('cherry-cloud-web/session-v1')
    .digest()
  const signer = new SessionSigner(sessionKey, config.sessionTtlDays * 24 * 60 * 60 * 1000)
  const guard = new AuthGuard(signer, {
    allowedOrigins: config.allowedOrigins,
    forceSecureCookie: config.forceSecureCookie
  })

  const events = new EventHub()
  const connections = new ConnectionRegistry()
  const registry = new RpcRegistry()
  const workspaceService = new WorkspaceService(dataPaths.workspaces)
  registerSystemRoutes(registry)
  registerHostRoutes(registry)
  registerAiRoutes(registry, { workspaceService })
  registerTranslateRoutes(registry)
  registerNotificationRoutes(registry)
  registerCacheRoutes(registry)
  registerComputerUseRoutes(registry)
  registerExportRoutes(registry)
  const miniAppAssets = new MiniAppAssets(dataPaths.root)
  registerMiniAppRoutes(registry, miniAppAssets)
  const notesStorage = new NotesStorage(dataPaths.notes)
  const skillStorage = new SkillStorage(dataPaths.agentsSkills)
  const agentWorkspaces = new AgentWorkspaceNamespace(dataPaths.root)
  registerNotesRoutes(registry, { storage: notesStorage, namespaces: [skillStorage, agentWorkspaces] })
  registerAgentRoutes(registry)
  registerBrowserRoutes(registry)
  registerSkillRoutes(registry, { storage: skillStorage })
  registerCapabilityRoutes(registry)
  registerFileProcessingRoutes(registry)
  registerPreferenceRoutes(registry, connections)
  registerTrashRoutes(registry)
  registerEntityImageRoutes(registry)
  registerPreviewRoutes(registry)
  registerWorkspaceRoutes(registry, workspaceService)

  const secretStore = new SecretStore(dataPaths.secretStore, new SecretBox(config.appSecret, dataPaths.secrets))
  application.register('SecretService', secretStore)

  const db = openDatabase({
    databasePath: dataPaths.database,
    migrationsDir: config.migrationsDir,
    seeders: webSeeders
  })
  application.register('DbService', db)
  configureDbService(db)
  configureWindowManager(installWindowManager(connections))

  const backupService = new BackupService({
    dataPaths,
    database: db,
    secretStore,
    appVersion: process.env.APP_VERSION ?? '0.1.0',
    migrationsDir: config.migrationsDir
  })
  const autoBackupScheduler = new AutoBackupScheduler(backupService)
  registerBackupRoutes(registry, { backup: backupService, scheduler: autoBackupScheduler })

  app.decorate('events', events)
  app.decorate('db', db)
  app.addHook('onClose', async () => {
    autoBackupScheduler.stop()
    backupService.abort()
    await stopAiRuntime()
    events.closeAll()
    uninstallWindowManager()
    db.close()
    application.unregister('DbService')
    application.unregister('SecretService')
  })

  await app.register(fastifyCookie)
  await app.register(fastifyWebsocket, {
    options: { maxPayload: 4 * 1024 * 1024 }
  })
  await app.register(fastifyMultipart, {
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 4 }
  })
  await app.register(fastifyRateLimit, { global: false })

  app.addHook('onRequest', async (request, reply) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return
    if (isPublicPath(request.url)) return
    if (guard.isAuthenticated(request)) return
    return reply.redirect(`/login?next=${encodeURIComponent(request.url)}`, 302)
  })

  await registerAuthRoutes(app, { guard, store, signer })
  await registerUiRoutes(app)
  await registerRpcRoutes(app, { registry, guard, connections })
  await registerWebSocketRoute(app, { registry, guard, connections })
  await registerFileRoutes(app, { guard })
  await registerSkillUploadRoutes(app, { guard, dataRoot: dataPaths.root })
  await registerDataRoutes(app, { guard, apiServer: getApiServer(), miniAppAssets })
  await registerMiniAppHttpRoutes(app, { guard, dataRoot: dataPaths.root, assets: miniAppAssets })

  // The AI stack plugs into the upstream lifecycle; start it only after the
  // database and the transport are ready, since its services resolve both.
  await startAiRuntime()
  try {
    await backupService.migrateLegacySecrets()
  } catch (error) {
    app.log.warn({ error }, 'Failed to migrate legacy backup credentials')
  }
  autoBackupScheduler.start()

  app.get('/api/health', async () => ({
    ok: true,
    uptime: process.uptime(),
    events: events.size,
    db: db.isReady
  }))

  const hasWebBuild = existsSync(resolve(config.webDist, 'index.html'))
  if (hasWebBuild) {
    await app.register(fastifyStatic, { root: config.webDist, wildcard: false })
  }

  /**
   * The login view is part of the SPA (M5 replaced the server-rendered form).
   * Unauthenticated visitors get `index.html`; the renderer decides whether to
   * show the login screen or the application from `/api/auth/status`. An
   * authenticated visitor is bounced to `next` so a stale bookmark cannot keep
   * them on a form they no longer need.
   */
  app.get('/login', async (request, reply) => {
    const next = sanitizeNext((request.query as { next?: string } | undefined)?.next)
    if (guard.isAuthenticated(request)) return reply.header('cache-control', 'no-store').redirect(next, 302)
    if (!hasWebBuild) return reply.code(503).send({ error: 'web_build_missing' })
    // The shell itself must not be cached: it is the same document for the
    // authenticated app and the login gate. Hashed assets keep their default.
    return reply.header('cache-control', 'no-store').type('text/html').sendFile('index.html', { cacheControl: false })
  })

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/') || request.url.startsWith('/media/')) {
      return reply.code(404).send({ error: 'not_found' })
    }
    if (!hasWebBuild) {
      return reply.code(503).send({ error: 'web_build_missing' })
    }
    return reply.sendFile('index.html')
  })

  return app
}

function baseKey(appSecret: string | undefined, sessionKeyFile: string): Buffer {
  return appSecret ? deriveKeyFromSecret(appSecret) : loadOrCreateKeyFile(sessionKeyFile)
}

export { isPublicPath }
