import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance } from 'fastify'

import type { ServerConfig } from './config'

export async function buildApp(config: ServerConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      transport: config.isProduction ? undefined : { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } }
    },
    trustProxy: true,
    bodyLimit: 32 * 1024 * 1024
  })

  app.get('/api/health', async () => ({ ok: true, uptime: process.uptime() }))

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
