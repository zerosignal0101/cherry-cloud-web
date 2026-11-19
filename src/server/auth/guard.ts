import type { FastifyReply, FastifyRequest } from 'fastify'

import { SESSION_COOKIE, type SessionPayload, type SessionSigner } from './session'

export class UnauthorizedError extends Error {
  constructor(message = 'Authentication required') {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends Error {
  constructor(message = 'Cross-origin request rejected') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

export interface AuthGuardOptions {
  /** Extra origins allowed beyond the request's own host (e.g. a dev Vite server). */
  allowedOrigins: string[]
  /** Force the `Secure` cookie flag when TLS terminates at a proxy that rewrites the protocol. */
  forceSecureCookie: boolean
}

/**
 * Session gate for HTTP, WebSocket upgrades and media reads.
 *
 * WebSocket authentication rides the same HttpOnly cookie as HTTP — the browser
 * attaches it to the upgrade request — so no query-string ticket is needed. The
 * Origin check is what stops another site from opening an authenticated socket or
 * replaying cookie-bearing POSTs: the cookie itself is unreadable cross-site.
 */
export class AuthGuard {
  constructor(
    private readonly signer: SessionSigner,
    private readonly options: AuthGuardOptions
  ) {}

  readSession(request: FastifyRequest): SessionPayload | null {
    const cookies = (request as FastifyRequest & { cookies?: Record<string, string | undefined> }).cookies
    return this.signer.verify(cookies?.[SESSION_COOKIE])
  }

  isAuthenticated(request: FastifyRequest): boolean {
    return this.readSession(request) !== null
  }

  assertAuthenticated(request: FastifyRequest): void {
    if (!this.isAuthenticated(request)) throw new UnauthorizedError()
  }

  /**
   * Browsers always send `Origin` on cross-site POSTs and WebSocket upgrades. A
   * missing header means a non-browser client, which cannot ride the user's
   * cookies, so it is allowed through here and still needs a valid session.
   */
  assertSameOrigin(request: FastifyRequest): void {
    const origin = request.headers.origin
    if (!origin) return
    if (this.options.allowedOrigins.includes(origin)) return

    let originHost: string
    try {
      originHost = new URL(origin).host
    } catch {
      throw new ForbiddenError('Malformed Origin header')
    }
    if (originHost !== request.headers.host) throw new ForbiddenError()
  }

  setSession(reply: FastifyReply, token: string, expiresAt: number, secure: boolean): void {
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: secure || this.options.forceSecureCookie,
      expires: new Date(expiresAt)
    })
  }

  clearSession(reply: FastifyReply): void {
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
  }

  isSecureRequest(request: FastifyRequest): boolean {
    return request.protocol === 'https'
  }
}
