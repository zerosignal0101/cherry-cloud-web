import type { FastifyInstance } from 'fastify'
import * as z from 'zod'

import { decodeBinary, encodeBinary } from '@shared/ipc/binary'

import { ForbiddenError, UnauthorizedError, type AuthGuard } from '../auth/guard'
import { forbidden, unauthorized } from '../routes/auth'
import { normalizeClientId, type ConnectionRegistry } from './connections'
import type { RpcRegistry } from './registry'

const rpcRequestSchema = z.object({
  route: z.string().min(1),
  input: z.unknown().optional()
})

export interface RpcPluginOptions {
  registry: RpcRegistry
  guard: AuthGuard
  connections: ConnectionRegistry
}

export async function registerRpcRoutes(app: FastifyInstance, options: RpcPluginOptions): Promise<void> {
  app.post('/api/rpc', async (request, reply) => {
    try {
      options.guard.assertSameOrigin(request)
      options.guard.assertAuthenticated(request)
    } catch (error) {
      if (error instanceof ForbiddenError) return forbidden(reply)
      if (error instanceof UnauthorizedError) return unauthorized(reply)
      throw error
    }

    const parsed = rpcRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: 'VALIDATION_FAILED', message: 'Invalid RPC envelope', data: { issues: parsed.error.issues } }
      })
    }

    // The tab's WebSocket connection is the caller's identity. Handlers that
    // stream back to the caller (`ai.stream.*`) resolve it through
    // `IpcContext.senderId`, exactly like a WindowId in the desktop app.
    const senderId = normalizeClientId(request.headers['x-client-id'])
    if (senderId) options.connections.ensure(senderId)

    const result = await options.registry.dispatch(parsed.data.route, decodeBinary(parsed.data.input), { senderId })
    return encodeBinary(result)
  })
}

export async function registerWebSocketRoute(app: FastifyInstance, options: RpcPluginOptions): Promise<void> {
  // @fastify/websocket must be registered by the caller before this route exists.
  app.get('/api/ws', { websocket: true }, (socket, request) => {
    // Same HttpOnly cookie as HTTP — the browser attaches it to the upgrade
    // request — plus an Origin check so another site cannot open an
    // authenticated socket with the user's cookie.
    let allowed = false
    try {
      options.guard.assertSameOrigin(request)
      allowed = options.guard.isAuthenticated(request)
    } catch {
      allowed = false
    }
    if (!allowed) {
      socket.close(4401, 'unauthorized')
      return
    }

    const query = request.query as Record<string, unknown> | undefined
    const clientId = normalizeClientId(query?.client)
    if (!clientId) {
      socket.close(4400, 'missing client id')
      return
    }

    app.events.add(socket)
    const connection = options.connections.attach(clientId, socket)
    socket.on('close', () => options.connections.detach(clientId, connection))

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
