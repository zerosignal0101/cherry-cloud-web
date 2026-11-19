import type { FastifyInstance, FastifyReply } from 'fastify'
import * as z from 'zod'

import type { AuthGuard } from '../auth/guard'
import { ForbiddenError } from '../auth/guard'
import type { AuthStore } from '../auth/password'
import type { SessionSigner } from '../auth/session'

const loginSchema = z.object({ password: z.string().min(1).max(1024) })

const INVALID_CREDENTIALS = {
  ok: false,
  error: { code: 'INVALID_CREDENTIALS', message: 'Wrong password' }
}

export interface AuthRouteOptions {
  guard: AuthGuard
  store: AuthStore
  signer: SessionSigner
}

export async function registerAuthRoutes(app: FastifyInstance, options: AuthRouteOptions): Promise<void> {
  app.get('/api/auth/status', async (request) => ({
    ok: true,
    data: { authenticated: options.guard.isAuthenticated(request) }
  }))

  // Rate limiting needs the proxy-aware client IP, which `trustProxy` already provides.
  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } },
    async (request, reply) => {
      try {
        options.guard.assertSameOrigin(request)
      } catch (error) {
        if (error instanceof ForbiddenError) return forbidden(reply)
        throw error
      }

      const parsed = loginSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ ok: false, error: { code: 'INVALID_REQUEST' } })

      if (!(await options.store.verify(parsed.data.password))) {
        // A short constant delay blunts scripted guessing beyond the rate limit.
        await delay(300)
        return reply.code(401).send(INVALID_CREDENTIALS)
      }

      const { token, expiresAt } = options.signer.issue()
      options.guard.setSession(reply, token, expiresAt, options.guard.isSecureRequest(request))
      return { ok: true, data: { authenticated: true, expiresAt } }
    }
  )

  app.post('/api/auth/logout', async (request, reply) => {
    try {
      options.guard.assertSameOrigin(request)
    } catch (error) {
      if (error instanceof ForbiddenError) return forbidden(reply)
      throw error
    }
    options.guard.clearSession(reply)
    return { ok: true, data: { authenticated: false } }
  })
}

/**
 * `next` may only point inside this app: a single leading slash, never a
 * protocol-relative URL or a header-injection attempt. The SPA login view keeps
 * the value in the address bar and returns here after a successful login.
 */
export function sanitizeNext(raw: string | undefined): string {
  if (!raw) return '/'
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/'
  if (raw.includes('\n') || raw.includes('\r')) return '/'
  return raw
}

export function redirect(reply: FastifyReply, location: string): FastifyReply {
  return reply.header('cache-control', 'no-store').redirect(location, 302)
}

export function forbidden(reply: FastifyReply): FastifyReply {
  return reply.code(403).send({ ok: false, error: { code: 'FORBIDDEN', message: 'Cross-origin request rejected' } })
}

export function unauthorized(reply: FastifyReply): FastifyReply {
  return reply.code(401).send({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
