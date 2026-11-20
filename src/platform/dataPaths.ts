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
  /** Encrypted-secret key material for provider credentials. */
  secrets: string
  /** Server-owned secret store (encrypted values, never exposed to the renderer). */
  secretStore: string
  /** Markdown notes; the only copy, exposed through the logical `/notes` namespace. */
  notes: string
  /** Installed Skill library, exposed through the logical `/skills` namespace. */
  agentsSkills: string
  /** Sandbox root for notes, agent and code workspaces. */
  workspaces: string
  /** Scratch space for generated archives; never restored. */
  backupTemp: string
  /** Extracted backup trees awaiting the startup promotion gate. */
  restoreStaging: string
  /** Previous DATA_DIR entries retained while a restore is promoted. */
  restoreAside: string
  /** Pending restore journal read before the database is opened. */
  restoreJournal: string
  /** Password hash for the single account. */
  auth: string
  /** HMAC key for session cookies, derived from `APP_SECRET` when set. */
  sessionKey: string
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
    secrets: resolve(absoluteRoot, 'secret.key'),
    secretStore: resolve(absoluteRoot, 'secrets.json'),
    notes: resolve(absoluteRoot, 'notes'),
    agentsSkills: resolve(absoluteRoot, 'Skills'),
    workspaces: resolve(absoluteRoot, 'workspaces'),
    backupTemp: resolve(absoluteRoot, 'tmp', 'backup'),
    restoreStaging: resolve(absoluteRoot, 'restore-staging'),
    restoreAside: resolve(absoluteRoot, 'restore-aside'),
    restoreJournal: resolve(absoluteRoot, 'restore-journal.json'),
    auth: resolve(absoluteRoot, 'auth.json'),
    sessionKey: resolve(absoluteRoot, 'session.key')
  }
}

export function ensureDataPaths(paths: DataPaths): void {
  for (const directory of [
    paths.root,
    paths.files,
    paths.logs,
    paths.notes,
    paths.providerRegistry,
    paths.workspaces,
    paths.backupTemp
  ]) {
    mkdirSync(directory, { recursive: true })
  }
}
