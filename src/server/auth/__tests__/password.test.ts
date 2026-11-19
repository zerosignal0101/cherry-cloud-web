import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { AuthStore } from '../password'

const tempDirs: string[] = []

function authFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ccw-auth-'))
  tempDirs.push(dir)
  return join(dir, 'auth.json')
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('AuthStore', () => {
  it('provisions from the initial password and verifies it', async () => {
    const file = authFile()
    const store = new AuthStore(file, 'correct-horse')

    await expect(store.verify('correct-horse')).resolves.toBe(true)
    await expect(store.verify('wrong-horse')).resolves.toBe(false)
    await expect(store.verify('')).resolves.toBe(false)
  })

  it('writes a 0600 file that only stores a salted hash', () => {
    const file = authFile()
    new AuthStore(file, 'correct-horse')

    const raw = readFileSync(file, 'utf8')
    expect(raw).not.toContain('correct-horse')
    expect(JSON.parse(raw)).toMatchObject({ version: 'scrypt-v1' })
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  it('reloads an existing file without the initial password', async () => {
    const file = authFile()
    new AuthStore(file, 'correct-horse')

    const reopened = new AuthStore(file, undefined)
    await expect(reopened.verify('correct-horse')).resolves.toBe(true)
  })

  it('rejects a short password and refuses to provision without one', () => {
    expect(() => new AuthStore(authFile(), 'short')).toThrow(/at least 8 characters/)
    expect(() => new AuthStore(authFile(), undefined)).toThrow(/No password configured/)
  })

  it('rejects a corrupted auth file instead of silently re-provisioning', () => {
    const file = authFile()
    writeFileSync(file, JSON.stringify({ version: 'nope' }))
    expect(() => new AuthStore(file, 'correct-horse')).toThrow(/Invalid auth file/)
  })

  it('rotates the stored password', async () => {
    const file = authFile()
    const store = new AuthStore(file, 'correct-horse')
    await store.setPassword('another-password')

    await expect(store.verify('another-password')).resolves.toBe(true)
    await expect(store.verify('correct-horse')).resolves.toBe(false)
  })
})
