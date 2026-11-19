import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const VERSION = 'v1'
const IV_BYTES = 12
const KEY_BYTES = 32

/**
 * Server-side replacement for Electron `safeStorage`. Provider API keys must stay
 * readable by the server alone; the key comes from `APP_SECRET` when set, otherwise
 * from a generated file that only the service user can read.
 */
export class SecretBox {
  private readonly key: Buffer

  constructor(secret: string | undefined, keyFile: string) {
    this.key = secret?.trim() ? deriveKey(secret.trim()) : loadOrCreateKeyFile(keyFile)
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join(
      ':'
    )
  }

  decrypt(payload: string): string {
    const [version, iv, tag, ciphertext] = payload.split(':')
    if (version !== VERSION || !iv || !tag || ciphertext === undefined) {
      throw new Error('Unsupported secret payload')
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'))
    decipher.setAuthTag(Buffer.from(tag, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8')
  }
}

function deriveKey(secret: string): Buffer {
  return scryptSync(secret, 'cherry-cloud-web', KEY_BYTES)
}

function loadOrCreateKeyFile(keyFile: string): Buffer {
  if (existsSync(keyFile)) {
    return Buffer.from(readFileSync(keyFile, 'utf8').trim(), 'base64')
  }
  const key = randomBytes(KEY_BYTES)
  mkdirSync(dirname(keyFile), { recursive: true, mode: 0o700 })
  writeFileSync(keyFile, key.toString('base64') + '\n', { mode: 0o600 })
  chmodSync(keyFile, 0o600)
  return key
}
