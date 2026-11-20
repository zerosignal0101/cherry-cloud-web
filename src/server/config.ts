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
  /** Used only on the first start, when `DATA_DIR/auth.json` does not exist yet. */
  adminPassword?: string
  /** Session cookie lifetime in days. */
  sessionTtlDays: number
  /** Force the `Secure` cookie flag when a proxy terminates TLS but rewrites the protocol. */
  forceSecureCookie: boolean
  /** Extra origins allowed for POSTs and WebSocket upgrades, beyond the request host. */
  allowedOrigins: string[]
  /** Key material for encrypting provider credentials and signing sessions. */
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
  const sessionTtlDays = Number(process.env.SESSION_TTL_DAYS ?? 30)

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${process.env.PORT}`)
  }
  if (!Number.isFinite(sessionTtlDays) || sessionTtlDays <= 0) {
    throw new Error(`Invalid SESSION_TTL_DAYS: ${process.env.SESSION_TTL_DAYS}`)
  }
  if (!isLoopbackHost(host) && !process.env.ADMIN_PASSWORD && !existsSync(resolve(resolveDataDir(), 'auth.json'))) {
    throw new Error('ADMIN_PASSWORD is required for the first start on a non-loopback address (at least 8 characters)')
  }

  return {
    host,
    port,
    dataDir: resolveDataDir(),
    migrationsDir: resolveMigrationsDir(),
    webDist,
    isProduction: process.env.NODE_ENV === 'production',
    adminPassword: process.env.ADMIN_PASSWORD?.trim() || undefined,
    sessionTtlDays,
    forceSecureCookie: process.env.COOKIE_SECURE === 'true',
    allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
    appSecret: process.env.APP_SECRET?.trim() || undefined
  }
}

export function assertWebDist(config: ServerConfig): void {
  if (config.isProduction && !existsSync(resolve(config.webDist, 'index.html'))) {
    throw new Error(`Web build not found at ${config.webDist}; run "pnpm build:web" first`)
  }
}
