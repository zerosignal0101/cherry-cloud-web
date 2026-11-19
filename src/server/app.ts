import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { application } from '@application'
import { resolveDataPaths } from '@platform/dataPaths'
import fastifyMultipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import Fastify, { type FastifyInstance } from 'fastify'

import { AccessGuard } from './auth/guard'
import { openDatabase, type DatabaseHandle } from './data/database'
import { webSeeders } from './data/seeders'
import { registerFileRoutes } from './files/routes'
import { MAX_UPLOAD_BYTES } from './files/service'
import { registerSystemRoutes } from './routes/system'
import { EventHub } from './transport/events'
import { registerRpcRoutes, registerWebSocketRoute } from './transport/plugins'
import { RpcRegistry } from './transport/registry'
import type { ServerConfig } from './config'

declare module 'fastify' {
  interface FastifyInstance {
    events: EventHub
    db: DatabaseHandle
  }
}

export async function buildApp(config: ServerConfig): Promise<FastifyInstance> {
  application.setDataDir(config.dataDir)

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

  const events = new EventHub()
  const guard = new AccessGuard(config.authToken)
  const registry = new RpcRegistry()
  registerSystemRoutes(registry)

  const db = openDatabase({
    databasePath: resolveDataPaths(config.dataDir).database,
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

  await app.register(fastifyWebsocket, {
    options: { maxPayload: 4 * 1024 * 1024 }
  })
  await app.register(fastifyMultipart, {
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 4 }
  })
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
