import type { FastifyInstance } from 'fastify'
import * as z from 'zod'

import { ApiServer } from '@main/data/api/core/ApiServer'
import { apiHandlers } from '@main/data/api/handlers/apiHandlers'
import type { DataRequest } from '@shared/data/api/types'

import { ForbiddenError, UnauthorizedError, type AuthGuard } from '../auth/guard'
import { forbidden, unauthorized } from './auth'

const dataRequestSchema = z.object({
  id: z.string().min(1),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  path: z.string().min(1),
  // `params` doubles as both path substitution (`:id`) and query values, and the
  // renderer's typed client sends them as plain JS values (`limit: 20`). Callers
  // are validated per endpoint inside `ApiServer`; narrowing here would reject
  // requests the desktop app accepts.
  params: z.record(z.string(), z.unknown()).optional(),
  body: z.unknown().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  metadata: z.object({ timestamp: z.number(), spanContext: z.unknown().optional() }).optional()
})

export interface DataRouteOptions {
  guard: AuthGuard
  apiServer: ApiServer
}

/**
 * HTTP transport for the upstream DataApi.
 *
 * `ApiServer` is already transport-agnostic — the desktop app bridged it over
 * Electron IPC. One POST carrying the `DataRequest` envelope is the whole
 * adapter; the response envelope keeps `status`/`error` so the renderer client
 * (`window.api.dataApi.request`) sees the same shape it always has.
 */
export async function registerDataRoutes(app: FastifyInstance, options: DataRouteOptions): Promise<void> {
  app.post('/api/data', async (request, reply) => {
    try {
      options.guard.assertSameOrigin(request)
      options.guard.assertAuthenticated(request)
    } catch (error) {
      if (error instanceof ForbiddenError) return forbidden(reply)
      if (error instanceof UnauthorizedError) return unauthorized(reply)
      throw error
    }

    const parsed = dataRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_request',
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
      })
    }

    return options.apiServer.handleRequest(parsed.data as DataRequest)
  })
}

let apiServer: ApiServer | null = null

/** `ApiServer` is a process singleton; tests build several apps in one process. */
export function getApiServer(): ApiServer {
  apiServer ??= ApiServer.initialize(apiHandlers)
  return apiServer
}
