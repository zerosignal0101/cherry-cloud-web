import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { SecretBox } from '../secrets'
import { SecretStore } from '../secretStore'

const directories: string[] = []

function createStore(): { store: SecretStore; file: string; keyFile: string } {
  const directory = mkdtempSync(join(tmpdir(), 'ccw-secret-store-'))
  directories.push(directory)
  const keyFile = join(directory, 'secret.key')
  const file = join(directory, 'secrets.json')
  return { store: new SecretStore(file, new SecretBox(undefined, keyFile)), file, keyFile }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('SecretStore', () => {
  it('persists encrypted values and reloads them', () => {
    const { store, file, keyFile } = createStore()
    store.set('webdav.password', 'hunter2')

    expect(store.get('webdav.password')).toBe('hunter2')
    expect(store.has('webdav.password')).toBe(true)
    expect(store.list()).toEqual(['webdav.password'])

    const raw = readFileSync(file, 'utf8')
    expect(raw).not.toContain('hunter2')

    const reloaded = new SecretStore(file, new SecretBox(undefined, keyFile))
    expect(reloaded.get('webdav.password')).toBe('hunter2')
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  it('deletes values and reports whether anything changed', () => {
    const { store } = createStore()
    store.set('s3.secret', 'value')

    expect(store.delete('s3.secret')).toBe(true)
    expect(store.delete('s3.secret')).toBe(false)
    expect(store.has('s3.secret')).toBe(false)
  })

  it('validates names and values', () => {
    const { store } = createStore()

    expect(() => store.set('Bad Name', 'x')).toThrow(/Invalid secret name/)
    expect(() => store.set('../escape', 'x')).toThrow(/Invalid secret name/)
    expect(() => store.set('valid', '')).toThrow(/must not be empty/)
    expect(() => store.set('valid', 'x'.repeat(16 * 1024 + 1))).toThrow(/exceeds/)
  })
})
