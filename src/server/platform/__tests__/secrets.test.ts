import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { SecretBox } from '../secrets'

const directories: string[] = []

function keyFile(): string {
  const directory = mkdtempSync(join(tmpdir(), 'cherry-secret-'))
  directories.push(directory)
  return join(directory, 'nested', 'secret.key')
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('SecretBox', () => {
  it('round-trips with a generated key file', () => {
    const file = keyFile()
    const box = new SecretBox(undefined, file)

    const payload = box.encrypt('sk-test-1234')
    expect(payload).toMatch(/^v1:/)
    expect(new SecretBox(undefined, file).decrypt(payload)).toBe('sk-test-1234')
    expect(readFileSync(file, 'utf8').trim()).not.toHaveLength(0)
  })

  it('derives a stable key from APP_SECRET without touching disk', () => {
    const box = new SecretBox('passphrase', keyFile())
    const other = new SecretBox('passphrase', '/does/not/exist')
    expect(other.decrypt(box.encrypt('token'))).toBe('token')
  })

  it('rejects tampered payloads and unknown versions', () => {
    const file = keyFile()
    const box = new SecretBox(undefined, file)
    const payload = box.encrypt('hello')
    const parts = payload.split(':')
    parts[3] = Buffer.from('tampered').toString('base64')

    expect(() => box.decrypt(parts.join(':'))).toThrow()
    expect(() => box.decrypt('v2:a:b:c')).toThrow(/Unsupported secret payload/)
  })
})
