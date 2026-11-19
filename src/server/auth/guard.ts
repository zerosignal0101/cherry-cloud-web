import type { FastifyRequest } from 'fastify'

export class UnauthorizedError extends Error {
  constructor(message = 'Authentication required') {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

/**
 * Temporary M1 gate: one shared access token for the public surface. M3 replaces
 * this with the password session cookie and short-lived WebSocket tickets.
 */
export class AccessGuard {
  constructor(private readonly token: string | undefined) {}

  requireToken(): boolean {
    return Boolean(this.token)
  }

  assertHttp(request: FastifyRequest): void {
    if (!this.token) return
    const header = request.headers.authorization
    const bearer = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : undefined
    if (bearer !== this.token) throw new UnauthorizedError()
  }

  /** Browsers cannot set headers on the upgrade request, so the token rides in the query string. */
  isWebSocketAllowed(token: string | undefined): boolean {
    if (!this.token) return true
    return token === this.token
  }
}
