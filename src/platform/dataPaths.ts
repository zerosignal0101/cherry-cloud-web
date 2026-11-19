import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Layout under `DATA_DIR`; every server-side write goes through these paths.
 *
 * This module sits below both `src/platform` (the Electron shim) and
 * `src/server` so each of them can resolve the data root without importing the
 * other. `DATA_DIR` defaults to `./.data` relative to the process cwd.
 */
export interface DataPaths {
  root: string
  database: string
  files: string
  logs: string
  providerRegistry: string
  secrets: string
}

export function resolveDataDir(configured: string | undefined = process.env.DATA_DIR): string {
  const trimmed = configured?.trim()
  return resolve(trimmed && trimmed.length > 0 ? trimmed : './.data')
}

export function resolveDataPaths(root: string): DataPaths {
  const absoluteRoot = resolve(root)
  return {
    root: absoluteRoot,
    database: resolve(absoluteRoot, 'cherry.db'),
    files: resolve(absoluteRoot, 'files'),
    logs: resolve(absoluteRoot, 'logs'),
    providerRegistry: resolve(absoluteRoot, 'provider-registry'),
    secrets: resolve(absoluteRoot, 'secret.key')
  }
}

export function ensureDataPaths(paths: DataPaths): void {
  for (const directory of [paths.root, paths.files, paths.logs, paths.providerRegistry]) {
    mkdirSync(directory, { recursive: true })
  }
}
