import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { resolveDataDir } from '@platform/dataPaths'

export interface ServerConfig {
  host: string
  port: number
  dataDir: string
  /** Drizzle migration folder copied from upstream (`migrations/sqlite-drizzle`). */
  migrationsDir: string
  webDist: string
  isProduction: boolean
  /** Temporary shared token; replaced by password sessions in M3. */
  authToken?: string
  appSecret?: string
}

function resolveMigrationsDir(): string {
  const configured = process.env.MIGRATIONS_DIR?.trim()
  return resolve(configured && configured.length > 0 ? configured : './migrations/sqlite-drizzle')
}

function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === '::1' || host === 'localhost'
}

export function loadConfig(): ServerConfig {
  const port = Number(process.env.PORT ?? 8787)
  const webDist = resolve(process.env.WEB_DIST?.trim() || resolve(process.cwd(), 'dist/web'))
  const host = process.env.HOST?.trim() || '127.0.0.1'
  const authToken = process.env.APP_TOKEN?.trim() || undefined

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${process.env.PORT}`)
  }

  // Milestone M1 has no user authentication yet, so a non-loopback bind must be token-gated.
  if (!authToken && !isLoopbackHost(host)) {
    throw new Error('APP_TOKEN is required when HOST is not a loopback address')
  }

  return {
    host,
    port,
    dataDir: resolveDataDir(),
    migrationsDir: resolveMigrationsDir(),
    webDist,
    isProduction: process.env.NODE_ENV === 'production',
    authToken,
    appSecret: process.env.APP_SECRET?.trim() || undefined
  }
}

export function assertWebDist(config: ServerConfig): void {
  if (config.isProduction && !existsSync(resolve(config.webDist, 'index.html'))) {
    throw new Error(`Web build not found at ${config.webDist}; run "pnpm build:web" first`)
  }
}
