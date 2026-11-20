import { createHmac, timingSafeEqual } from 'node:crypto'
import path from 'node:path'

import { loadOrCreateKeyFile } from '../../platform/secrets'

/**
 * Signed asset URLs for local mini apps.
 *
 * The guest is served from a sandboxed iframe with an opaque origin, so it cannot
 * carry the session cookie to its own subresources. Instead the server mints one
 * unguessable path segment per app; every relative asset under the document stays
 * beneath that segment, and a request without the exact segment is a 404.
 *
 * The key lives under `DATA_DIR/miniapps` and survives restarts, so a tab restored
 * after a restart still resolves the same URL.
 */
export class MiniAppAssets {
  private readonly key: Buffer

  constructor(dataRoot: string) {
    this.key = loadOrCreateKeyFile(path.join(dataRoot, 'miniapps', 'assets.key'))
  }

  tokenFor(appId: string): string {
    return createHmac('sha256', this.key).update(`mini-app-assets\0${appId}`).digest('base64url')
  }

  verify(appId: string, token: string): boolean {
    const expected = Buffer.from(this.tokenFor(appId))
    const received = Buffer.from(token)
    return expected.length === received.length && timingSafeEqual(expected, received)
  }

  /** Entry is package-relative POSIX, already validated by the manifest schema. */
  assetUrl(appId: string, entry: string): string {
    const segments = entry.split('/').filter(Boolean).map(encodeURIComponent).join('/')
    return `/api/miniapps/${encodeURIComponent(appId)}/assets/${this.tokenFor(appId)}/${segments}`
  }

  /**
   * Rewrite the legacy desktop scheme wherever it appears in a response. The
   * browser has no custom-scheme handler; every package URL becomes the signed
   * HTTP route the iframe can actually load.
   */
  rewriteValue(value: unknown): unknown {
    if (typeof value === 'string') return this.rewriteString(value)
    if (Array.isArray(value)) return value.map((entry) => this.rewriteValue(entry))
    if (value && typeof value === 'object') {
      if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value
      const result: Record<string, unknown> = {}
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        result[key] = this.rewriteValue(entry)
      }
      return result
    }
    return value
  }

  private rewriteString(value: string): string {
    const prefix = 'cherry-miniapp://'
    if (!value.startsWith(prefix)) return value
    try {
      const parsed = new URL(value)
      const appId = parsed.host
      const entry = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''))
      if (!appId || !entry) return value
      return this.assetUrl(appId, entry)
    } catch {
      return value
    }
  }
}
