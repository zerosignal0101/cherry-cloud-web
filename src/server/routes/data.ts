import type { FastifyInstance } from 'fastify'
import * as z from 'zod'

import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { ApiServer } from '@main/data/api/core/ApiServer'
import { apiHandlers } from '@main/data/api/handlers/apiHandlers'
import type { DataRequest, DataResponse } from '@shared/data/api/types'

import { ForbiddenError, UnauthorizedError, type AuthGuard } from '../auth/guard'
import type { MiniAppAssets } from '../features/miniapps/MiniAppAssets'
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
  /** Rewrites `cherry-miniapp://` DTO URLs into signed browser asset routes. */
  miniAppAssets?: MiniAppAssets
}

/**
 * HTTP transport for the upstream DataApi.
 *
 * `ApiServer` is already transport-agnostic — the desktop app bridged it over
 * Electron IPC. One POST carrying the `DataRequest` envelope is the whole
 * adapter; the response envelope keeps `status`/`error` so the renderer client
 * (`window.api.dataApi.request`) sees the same shape it always has.
 */
/**
 * Responses in the agent domain embed host layout (`Workspace.path`, a Skill's
 * `sourceUrl` from a local ZIP). The browser only ever sees server-owned
 * logical namespaces; the physical path stays inside the runtime.
 */
function sanitizeAgentDomainPaths(response: DataResponse): DataResponse {
  if (!('data' in response) || response.data === undefined) return response
  let workspaces: Array<{ id: string; path: string }> = []
  try {
    workspaces = agentWorkspaceService
      .list({ includeSystem: true })
      .map(({ id, path }) => ({ id, path }))
      .sort((left, right) => right.path.length - left.path.length)
  } catch {
    // A database that is still opening must not corrupt the response.
  }

  const rewrite = (value: unknown): unknown => {
    if (typeof value === 'string') {
      const workspace = workspaces.find(
        (candidate) => value === candidate.path || value.startsWith(`${candidate.path}/`)
      )
      if (workspace) {
        const suffix = value.slice(workspace.path.length)
        return `/workspaces/${workspace.id}${suffix}`
      }
      return value
    }
    if (Array.isArray(value)) return value.map(rewrite)
    if (value && typeof value === 'object') {
      const result: Record<string, unknown> = {}
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        if (key === 'sourceUrl' && typeof entry === 'string' && !/^https?:\/\//i.test(entry)) continue
        result[key] = rewrite(entry)
      }
      return result
    }
    return value
  }

  return { ...response, data: rewrite(response.data) }
}

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

    const response = sanitizeAgentDomainPaths(await options.apiServer.handleRequest(parsed.data as DataRequest))
    return options.miniAppAssets ? options.miniAppAssets.rewriteValue(response) : response
  })
}

let apiServer: ApiServer | null = null

/** `ApiServer` is a process singleton; tests build several apps in one process. */
export function getApiServer(): ApiServer {
  apiServer ??= ApiServer.initialize(apiHandlers)
  return apiServer
}
