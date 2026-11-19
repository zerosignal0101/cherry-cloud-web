import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

/** Layout under `DATA_DIR`; every server-side write goes through these paths. */
export interface DataPaths {
  root: string
  database: string
  files: string
  logs: string
  providerRegistry: string
  secrets: string
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
