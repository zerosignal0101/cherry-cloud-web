import { createHmac } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { application } from '@application'
import { resolveDataPaths } from '@platform/dataPaths'
import fastifyCookie from '@fastify/cookie'
import fastifyMultipart from '@fastify/multipart'
import fastifyRateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import Fastify, { type FastifyInstance } from 'fastify'

import { AuthGuard } from './auth/guard'
import { AuthStore } from './auth/password'
import { SessionSigner } from './auth/session'
import { openDatabase, type DatabaseHandle } from './data/database'
import { webSeeders } from './data/seeders'
import { MAX_UPLOAD_BYTES } from './files/service'
import { registerFileRoutes } from './files/routes'
import { registerAuthRoutes } from './routes/auth'
import { registerSystemRoutes } from './routes/system'
import { EventHub } from './transport/events'
import { registerRpcRoutes, registerWebSocketRoute } from './transport/plugins'
import { RpcRegistry } from './transport/registry'
import { deriveKeyFromSecret, loadOrCreateKeyFile } from './platform/secrets'
import type { ServerConfig } from './config'

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
  const registry = new RpcRegistry()
  registerSystemRoutes(registry)

  const db = openDatabase({
    databasePath: dataPaths.database,
    migrationsDir: config.migrationsDir,
    seeders: webSeeders
  })
  application.register('DbService', db)

  app.decorate('events', events)
  app.decorate('db', db)
  app.addHook('onClose', async () => {
    events.closeAll()
    db.close()
    application.unregister('DbService')
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
  await registerRpcRoutes(app, { registry, guard })
  await registerWebSocketRoute(app, { registry, guard })
  await registerFileRoutes(app, { guard })

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
