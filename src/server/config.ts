import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

export interface ServerConfig {
  host: string
  port: number
  dataDir: string
  webDist: string
  isProduction: boolean
}

function resolveDataDir(): string {
  const configured = process.env.DATA_DIR?.trim()
  return resolve(configured && configured.length > 0 ? configured : './.data')
}

export function loadConfig(): ServerConfig {
  const port = Number(process.env.PORT ?? 8787)
  const webDist = resolve(process.env.WEB_DIST?.trim() || resolve(process.cwd(), 'dist/web'))

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${process.env.PORT}`)
  }

  return {
    host: process.env.HOST?.trim() || '127.0.0.1',
    port,
    dataDir: resolveDataDir(),
    webDist,
    isProduction: process.env.NODE_ENV === 'production'
  }
}

export function assertWebDist(config: ServerConfig): void {
  if (config.isProduction && !existsSync(resolve(config.webDist, 'index.html'))) {
    throw new Error(`Web build not found at ${config.webDist}; run "pnpm build:web" first`)
  }
}
