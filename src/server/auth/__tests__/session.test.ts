import { describe, expect, it } from 'vitest'

import { SessionSigner } from '../session'

const HOUR = 60 * 60 * 1000

function signer(ttlMs = 24 * HOUR): SessionSigner {
  return new SessionSigner(Buffer.from('test-key-material-32-bytes-long!!'), ttlMs)
}

describe('SessionSigner', () => {
  it('round-trips a freshly issued token', () => {
    const s = signer()
    const { token, expiresAt } = s.issue()

    const payload = s.verify(token)
    expect(payload?.exp).toBe(expiresAt)
    expect(payload?.sid).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('rejects expired tokens', () => {
    const now = Date.now()
    const s = signer(HOUR)
    const { token } = s.issue(now)

    expect(s.verify(token, now + HOUR - 1)).not.toBeNull()
    expect(s.verify(token, now + HOUR + 1)).toBeNull()
  })

  it('rejects a token signed with another key', () => {
    const other = new SessionSigner(Buffer.from('a-different-key-material-1234567'), 24 * HOUR)
    const { token } = other.issue()

    expect(signer().verify(token)).toBeNull()
  })

  it('rejects a tampered payload', () => {
    const s = signer()
    const { token } = s.issue()
    const [version, , signature] = token.split('.')
    const forgedPayload = Buffer.from(JSON.stringify({ iat: Date.now(), exp: Date.now() + HOUR, sid: 'x' })).toString(
      'base64url'
    )

    expect(s.verify(`${version}.${forgedPayload}.${signature}`)).toBeNull()
  })

  it('rejects malformed input', () => {
    const s = signer()
    expect(s.verify(undefined)).toBeNull()
    expect(s.verify('')).toBeNull()
    expect(s.verify('v2.abc.def')).toBeNull()
    expect(s.verify('v1.only-two')).toBeNull()
    expect(s.verify('v1.!!!.@@@')).toBeNull()
  })
})
