import type { FastifyInstance } from 'fastify'
import * as z from 'zod'

import type { AccessGuard } from '../auth/guard'
import { UnauthorizedError } from '../auth/guard'
import type { RpcRegistry } from './registry'

const rpcRequestSchema = z.object({
  route: z.string().min(1),
  input: z.unknown().optional()
})

export interface RpcPluginOptions {
  registry: RpcRegistry
  guard: AccessGuard
}

export async function registerRpcRoutes(app: FastifyInstance, options: RpcPluginOptions): Promise<void> {
  app.post('/api/rpc', async (request, reply) => {
    try {
      options.guard.assertHttp(request)
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return reply.code(401).send({ ok: false, error: { code: 'UNAUTHORIZED', message: error.message } })
      }
      throw error
    }

    const parsed = rpcRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: 'VALIDATION_FAILED', message: 'Invalid RPC envelope', data: { issues: parsed.error.issues } }
      })
    }

    return options.registry.dispatch(parsed.data.route, parsed.data.input, { senderId: null })
  })
}

export async function registerWebSocketRoute(app: FastifyInstance, options: RpcPluginOptions): Promise<void> {
  // @fastify/websocket must be registered by the caller before this route exists.
  app.get('/api/ws', { websocket: true }, (socket, request) => {
    const url = new URL(request.url, 'http://localhost')
    if (!options.guard.isWebSocketAllowed(url.searchParams.get('token') ?? undefined)) {
      socket.close(4401, 'unauthorized')
      return
    }
    app.events.add(socket)

    socket.on('message', (raw) => {
      let message: unknown
      try {
        message = JSON.parse(raw.toString())
      } catch {
        return
      }
      if (typeof message === 'object' && message !== null && (message as { type?: string }).type === 'ping') {
        socket.send(JSON.stringify({ type: 'pong', time: Date.now() }))
      }
    })
  })
}
