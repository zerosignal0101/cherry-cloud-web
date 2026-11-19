import { randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LENGTH = 64
const SALT_BYTES = 16
const MIN_PASSWORD_LENGTH = 8
const STORED_VERSION = 'scrypt-v1'

interface StoredAuth {
  version: string
  salt: string
  hash: string
  updatedAt: number
}

/**
 * The single account's password, stored as a scrypt hash in `DATA_DIR/auth.json`.
 *
 * Provisioning happens once: `ADMIN_PASSWORD` creates the file on first boot and
 * is ignored afterwards, so rotating the env var later does not silently change
 * the password. Reset by deleting the file (and setting the env var again).
 */
export class AuthStore {
  private readonly file: string
  private stored: StoredAuth

  constructor(file: string, initialPassword: string | undefined) {
    this.file = file
    this.stored = loadStored(file) ?? provision(file, initialPassword)
  }

  async verify(password: string): Promise<boolean> {
    if (typeof password !== 'string' || password.length === 0) return false
    const candidate = await derive(password, Buffer.from(this.stored.salt, 'base64'))
    const expected = Buffer.from(this.stored.hash, 'base64')
    return candidate.length === expected.length && timingSafeEqual(candidate, expected)
  }

  async setPassword(password: string): Promise<void> {
    assertPasswordStrength(password)
    const salt = randomBytes(SALT_BYTES)
    const hash = await derive(password, salt)
    this.writeStored({
      version: STORED_VERSION,
      salt: salt.toString('base64'),
      hash: hash.toString('base64'),
      updatedAt: Date.now()
    })
  }

  private writeStored(stored: StoredAuth): void {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
    writeFileSync(this.file, JSON.stringify(stored, null, 2) + '\n', { mode: 0o600 })
    chmodSync(this.file, 0o600)
    this.stored = stored
  }
}

function loadStored(file: string): StoredAuth | null {
  if (!existsSync(file)) return null
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<StoredAuth>
  if (
    parsed.version !== STORED_VERSION ||
    typeof parsed.salt !== 'string' ||
    typeof parsed.hash !== 'string' ||
    typeof parsed.updatedAt !== 'number'
  ) {
    throw new Error(`Invalid auth file at ${file}; delete it to re-provision from ADMIN_PASSWORD`)
  }
  return parsed as StoredAuth
}

function provision(file: string, initialPassword: string | undefined): StoredAuth {
  const initial = initialPassword?.trim()
  if (!initial) {
    throw new Error(
      'No password configured. Set ADMIN_PASSWORD (at least 8 characters) for the first start, ' +
        'or restore DATA_DIR/auth.json.'
    )
  }
  assertPasswordStrength(initial)
  // Synchronous on purpose: this runs once per install, before the server listens.
  const salt = randomBytes(SALT_BYTES)
  const stored: StoredAuth = {
    version: STORED_VERSION,
    salt: salt.toString('base64'),
    hash: scryptSync(initial, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }).toString('base64'),
    updatedAt: Date.now()
  }
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  writeFileSync(file, JSON.stringify(stored, null, 2) + '\n', { mode: 0o600 })
  chmodSync(file, 0o600)
  return stored
}

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (error, key) => {
      if (error) reject(error)
      else resolve(key)
    })
  })
}

function assertPasswordStrength(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  }
}
