import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const SESSION_COOKIE = 'ccw_session'
const TOKEN_VERSION = 'v1'
const SESSION_ID_BYTES = 8

export interface SessionPayload {
  /** Issued at, epoch ms. */
  iat: number
  /** Expires at, epoch ms. */
  exp: number
  /** Random id — reserved for a future revocation list. */
  sid: string
}

/**
 * Stateless session tokens: `<version>.<payload>.<hmac>`, signed with a key that
 * lives only on the server. A single-instance deployment has no session store to
 * share, and logout is a cookie clear, so a signed expiry is sufficient.
 */
export class SessionSigner {
  constructor(
    private readonly key: Buffer,
    private readonly ttlMs: number
  ) {}

  issue(now = Date.now()): { token: string; expiresAt: number } {
    const payload: SessionPayload = {
      iat: now,
      exp: now + this.ttlMs,
      sid: randomBytes(SESSION_ID_BYTES).toString('base64url')
    }
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
    return { token: `${TOKEN_VERSION}.${encoded}.${this.sign(encoded)}`, expiresAt: payload.exp }
  }

  verify(token: string | undefined, now = Date.now()): SessionPayload | null {
    if (!token) return null
    const parts = token.split('.')
    if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return null

    const [, encoded, signature] = parts
    const expected = Buffer.from(this.sign(encoded), 'utf8')
    const actual = Buffer.from(signature, 'utf8')
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null

    try {
      const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<SessionPayload>
      if (typeof payload.exp !== 'number' || payload.exp <= now) return null
      if (typeof payload.iat !== 'number' || typeof payload.sid !== 'string') return null
      return payload as SessionPayload
    } catch {
      return null
    }
  }

  private sign(encodedPayload: string): string {
    return createHmac('sha256', this.key).update(`${TOKEN_VERSION}.${encodedPayload}`).digest('base64url')
  }
}
