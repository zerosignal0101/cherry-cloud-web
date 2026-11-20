import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import type { SecretBox } from './secrets'

const SECRET_NAME_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,63}$/
const MAX_SECRET_CHARS = 16 * 1024

interface SecretFile {
  version: 1
  values: Record<string, string>
}

/**
 * Server-side secret storage for feature credentials (backup providers, channel
 * tokens, …). Values are encrypted with `SecretBox` and only ever leave this
 * module through `get()`; the renderer-facing surface, when it exists, must use
 * `has()`/`list()` and never expose the plaintext.
 *
 * The file is written atomically with `0600` so a crash cannot leave a partial
 * JSON document behind.
 */
export class SecretStore {
  private values: Record<string, string> | null = null

  constructor(
    private readonly file: string,
    private readonly box: SecretBox
  ) {}

  has(name: string): boolean {
    this.assertName(name)
    return this.load()[name] !== undefined
  }

  get(name: string): string | undefined {
    this.assertName(name)
    const payload = this.load()[name]
    return payload === undefined ? undefined : this.box.decrypt(payload)
  }

  set(name: string, value: string): void {
    this.assertName(name)
    if (typeof value !== 'string' || value.length === 0) throw new Error('Secret value must not be empty')
    if (value.length > MAX_SECRET_CHARS) throw new Error(`Secret value exceeds ${MAX_SECRET_CHARS} characters`)
    const values = { ...this.load(), [name]: this.box.encrypt(value) }
    this.save(values)
    this.values = values
  }

  delete(name: string): boolean {
    this.assertName(name)
    const values = { ...this.load() }
    if (values[name] === undefined) return false
    delete values[name]
    this.save(values)
    this.values = values
    return true
  }

  /** Names only — never the values. */
  list(): string[] {
    return Object.keys(this.load()).sort()
  }

  private assertName(name: string): void {
    if (!SECRET_NAME_PATTERN.test(name)) {
      throw new Error('Invalid secret name (expected lower-case letters, digits, dot, dash or underscore)')
    }
  }

  private load(): Record<string, string> {
    if (this.values) return this.values
    if (!existsSync(this.file)) {
      this.values = {}
      return this.values
    }
    const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<SecretFile>
    if (parsed.version !== 1 || typeof parsed.values !== 'object' || parsed.values === null) {
      throw new Error(`Unsupported secret store format: ${this.file}`)
    }
    this.values = parsed.values
    return this.values
  }

  private save(values: Record<string, string>): void {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
    const temporary = `${this.file}.${process.pid}.tmp`
    try {
      writeFileSync(temporary, JSON.stringify({ version: 1, values } satisfies SecretFile), { mode: 0o600 })
      renameSync(temporary, this.file)
    } finally {
      rmSync(temporary, { force: true })
    }
  }
}
