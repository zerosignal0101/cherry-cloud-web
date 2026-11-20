import path from 'node:path'

import * as z from 'zod'

export const BACKUP_FORMAT = 'cherry-cloud-web'
export const BACKUP_VERSION = 1
export const BACKUP_METADATA_FILE = 'metadata.json'
export const BACKUP_DATABASE_ARCHIVE_PATH = 'database/cherry.db'

/**
 * DATA_DIR entries included in every archive. The database is archived
 * separately through `VACUUM INTO`; everything else is copied as-is except
 * symlinks, which are never followed.
 *
 * Logs and `tmp/` are deliberately absent: they are diagnostics/scratch data,
 * and a restore must not clobber the running server's logs.
 */
export const BACKUP_ENTRIES = [
  { target: 'auth.json', archivePath: 'data/auth.json', kind: 'file' },
  { target: 'cache.json', archivePath: 'data/cache.json', kind: 'file' },
  { target: 'secrets.json', archivePath: 'data/secrets.json', kind: 'file' },
  { target: 'secret.key', archivePath: 'data/secret.key', kind: 'file' },
  { target: 'session.key', archivePath: 'data/session.key', kind: 'file' },
  { target: 'files', archivePath: 'data/files', kind: 'directory' },
  { target: 'notes', archivePath: 'data/notes', kind: 'directory' },
  { target: 'Skills', archivePath: 'data/Skills', kind: 'directory' },
  { target: 'workspaces', archivePath: 'data/workspaces', kind: 'directory' },
  { target: 'miniapps', archivePath: 'data/miniapps', kind: 'directory' },
  { target: 'Agents', archivePath: 'data/Agents', kind: 'directory' },
  { target: 'provider-registry', archivePath: 'data/provider-registry', kind: 'directory' },
  { target: 'external', archivePath: 'data/external', kind: 'directory' },
  { target: 'exports', archivePath: 'data/exports', kind: 'directory' }
] as const satisfies ReadonlyArray<BackupEntry>

export type BackupResourceKind = 'file' | 'directory'

export interface BackupEntry {
  /** Relative to DATA_DIR. */
  target: string
  /** Relative to the archive root. */
  archivePath: string
  kind: BackupResourceKind
}

export interface BackupResource extends BackupEntry {
  /**
   * `false` records that the entry did not exist at backup time. Restore
   * removes the live entry in that case, so an old backup cannot leave data
   * created after it behind.
   */
  present: boolean
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT
  version: typeof BACKUP_VERSION
  createdAt: string
  appVersion: string
  database: {
    archivePath: typeof BACKUP_DATABASE_ARCHIVE_PATH
    sha256: string
    size: number
  }
  resources: BackupResource[]
}

const relativePathSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => {
    if (value.includes('\0') || value.includes('\\') || path.posix.isAbsolute(value)) return false
    return value.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..')
  }, 'Expected a normalized relative path')

const backupResourceSchema = z.object({
  target: relativePathSchema,
  archivePath: relativePathSchema,
  kind: z.enum(['file', 'directory']),
  present: z.boolean()
})

export const backupManifestSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(BACKUP_VERSION),
  createdAt: z.string().min(1),
  appVersion: z.string(),
  database: z.object({
    archivePath: z.literal(BACKUP_DATABASE_ARCHIVE_PATH),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    size: z.number().int().nonnegative()
  }),
  resources: z.array(backupResourceSchema).max(BACKUP_ENTRIES.length)
})

/** Reject metadata that names an entry outside the fixed restore whitelist. */
export function assertManifestResourcesAreManaged(resources: BackupResource[]): void {
  const allowed = new Map<string, BackupEntry>(BACKUP_ENTRIES.map((entry) => [entry.target, entry]))
  const seen = new Set<string>()
  for (const resource of resources) {
    const expected = allowed.get(resource.target)
    if (!expected) throw new Error(`Backup metadata names an unsupported resource: ${resource.target}`)
    if (seen.has(resource.target)) throw new Error(`Backup metadata repeats resource: ${resource.target}`)
    if (resource.archivePath !== expected.archivePath || resource.kind !== expected.kind) {
      throw new Error(`Backup metadata does not match the managed layout for: ${resource.target}`)
    }
    seen.add(resource.target)
  }
}
