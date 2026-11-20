import { existsSync, createWriteStream } from 'node:fs'
import { chmod, lstat, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import Database from 'better-sqlite3'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import StreamZip from 'node-stream-zip'

import { loggerService } from '@logger'
import { readAppliedChain } from '@main/data/db/restore/appliedChain'
import { hashDbFile } from '@main/data/db/restore/hashDbFile'
import { assertNoFoldedPathCollisions, assertZipEntriesWithin } from '@main/utils/zipSafety'
import type { BackupProgress } from '@shared/types/backup'

import type { DatabaseHandle } from '../../data/database'
import {
  assertManifestResourcesAreManaged,
  BACKUP_DATABASE_ARCHIVE_PATH,
  BACKUP_ENTRIES,
  BACKUP_FORMAT,
  BACKUP_METADATA_FILE,
  BACKUP_VERSION,
  backupManifestSchema,
  type BackupManifest,
  type BackupResource
} from './manifest'

const logger = loggerService.withContext('BackupArchive')

const MAX_ARCHIVE_ENTRIES = 250_000
const MAX_EXTRACTED_BYTES = 100 * 1024 * 1024 * 1024
const ARCHIVE_FILE_MODE = 0o600
const STAGING_DIR_MODE = 0o700

export interface CreateArchiveOptions {
  dataRoot: string
  database: DatabaseHandle
  outputPath: string
  appVersion: string
  signal?: AbortSignal
  onProgress?: (progress: BackupProgress) => void
}

export interface CreatedArchive {
  filePath: string
  manifest: BackupManifest
  size: number
}

export interface ExtractArchiveOptions {
  archivePath: string
  stagingDir: string
  migrationsDir: string
  signal?: AbortSignal
  onProgress?: (progress: BackupProgress) => void
}

export interface ExtractedArchive {
  manifest: BackupManifest
  stagingDir: string
  databasePath: string
}

/**
 * Create a full server backup archive.
 *
 * The SQLite database is captured with `VACUUM INTO` first; callers must have
 * quiesced writers before calling so the file resources copied immediately
 * after come from the same logical instant. Symlinks are never followed: they
 * could point outside `DATA_DIR` and would make the archive depend on host
 * state the restore server does not own.
 */
export async function createBackupArchive(options: CreateArchiveOptions): Promise<CreatedArchive> {
  const { dataRoot, database, outputPath, appVersion, signal, onProgress } = options
  const root = path.resolve(dataRoot)
  const databaseSnapshotPath = path.join(path.dirname(outputPath), `.db-${path.basename(outputPath)}`)
  let output: ReturnType<typeof createWriteStream> | undefined
  let archive: { abort(): void } | undefined

  await mkdir(path.dirname(outputPath), { recursive: true, mode: STAGING_DIR_MODE })
  onProgress?.({ operation: 'backup', stage: 'preparing', progress: 0, total: 100 })
  signal?.throwIfAborted()

  try {
    database.createSnapshot(databaseSnapshotPath)
    const databaseStats = await stat(databaseSnapshotPath)
    const databaseHash = await hashDbFile(databaseSnapshotPath)
    onProgress?.({ operation: 'backup', stage: 'snapshot', progress: 10, total: 100 })
    signal?.throwIfAborted()

    const resources: BackupResource[] = []
    const files: Array<{ source: string; archivePath: string; size: number }> = []
    const directoryEntries: string[] = []
    for (const entry of BACKUP_ENTRIES) {
      const source = path.join(root, entry.target)
      const sourceStats = await lstat(source).catch(() => null)
      if (!sourceStats) {
        resources.push({ ...entry, present: false })
        continue
      }
      if (sourceStats.isSymbolicLink()) {
        logger.warn('Skipping symlinked backup resource', { target: entry.target })
        resources.push({ ...entry, present: false })
        continue
      }
      if (entry.kind === 'file') {
        if (!sourceStats.isFile()) {
          logger.warn('Skipping non-file backup resource', { target: entry.target })
          resources.push({ ...entry, present: false })
          continue
        }
        resources.push({ ...entry, present: true })
        files.push({ source, archivePath: entry.archivePath, size: sourceStats.size })
        continue
      }
      if (!sourceStats.isDirectory()) {
        logger.warn('Skipping non-directory backup resource', { target: entry.target })
        resources.push({ ...entry, present: false })
        continue
      }
      resources.push({ ...entry, present: true })
      directoryEntries.push(`${entry.archivePath}/`)
      files.push(...(await walkFiles(source, entry.archivePath, signal)))
    }

    const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
    let copiedBytes = 0
    onProgress?.({ operation: 'backup', stage: 'copying_files', progress: 15, total: 100 })

    const manifest: BackupManifest = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      createdAt: new Date().toISOString(),
      appVersion,
      database: {
        archivePath: BACKUP_DATABASE_ARCHIVE_PATH,
        sha256: databaseHash,
        size: databaseStats.size
      },
      resources
    }

    const { ZipArchive } = await import('archiver')
    const outputStream = createWriteStream(outputPath, { mode: ARCHIVE_FILE_MODE })
    const zip = new ZipArchive({ zlib: { level: 1 }, zip64: true })
    output = outputStream
    archive = zip

    const completed = new Promise<void>((resolve, reject) => {
      const cleanup = () => signal?.removeEventListener('abort', onAbort)
      const onAbort = () => {
        zip.abort()
        reject(signal?.reason ?? new DOMException('Backup aborted', 'AbortError'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) {
        onAbort()
        return
      }
      outputStream.on('close', () => {
        cleanup()
        resolve()
      })
      outputStream.on('error', (error) => {
        cleanup()
        reject(error)
      })
      zip.on('error', (error: unknown) => {
        cleanup()
        reject(error)
      })
      zip.on('warning', (error: unknown) => {
        logger.warn('Backup archive warning', { error })
      })
      zip.pipe(outputStream)
    })

    zip.append(JSON.stringify(manifest, null, 2), { name: BACKUP_METADATA_FILE })
    zip.file(databaseSnapshotPath, { name: BACKUP_DATABASE_ARCHIVE_PATH })
    for (const directory of directoryEntries) {
      zip.append('', { name: directory, type: 'directory' })
    }
    for (const file of files) {
      signal?.throwIfAborted()
      zip.file(file.source, { name: file.archivePath })
      copiedBytes += file.size
      const progress = totalBytes > 0 ? 15 + Math.floor((copiedBytes / totalBytes) * 65) : 80
      onProgress?.({ operation: 'backup', stage: 'copying_files', progress, total: 100 })
    }

    onProgress?.({ operation: 'backup', stage: 'compressing', progress: 85, total: 100 })
    await Promise.all([zip.finalize(), completed])
    const outputStats = await stat(outputPath)
    await chmod(outputPath, ARCHIVE_FILE_MODE)
    onProgress?.({ operation: 'backup', stage: 'completed', progress: 100, total: 100 })
    return { filePath: outputPath, manifest, size: outputStats.size }
  } catch (error) {
    output?.destroy()
    archive?.abort()
    await rm(outputPath, { force: true }).catch(() => {})
    throw error
  } finally {
    await rm(databaseSnapshotPath, { force: true }).catch(() => {})
  }
}

async function walkFiles(
  directory: string,
  archiveRoot: string,
  signal?: AbortSignal
): Promise<Array<{ source: string; archivePath: string; size: number }>> {
  const result: Array<{ source: string; archivePath: string; size: number }> = []
  const realRoot = await realpath(directory)
  const queue: Array<{ directory: string; archivePath: string }> = [{ directory, archivePath: archiveRoot }]

  while (queue.length > 0) {
    signal?.throwIfAborted()
    const current = queue.shift()!
    const entries = await readdir(current.directory, { withFileTypes: true })
    for (const entry of entries) {
      signal?.throwIfAborted()
      const source = path.join(current.directory, entry.name)
      const archivePath = `${current.archivePath}/${entry.name}`
      const stats = await lstat(source)
      if (stats.isSymbolicLink()) {
        logger.warn('Skipping symlink in backup resource', { path: source })
        continue
      }
      if (stats.isDirectory()) {
        const real = await realpath(source)
        if (real !== realRoot && !real.startsWith(`${realRoot}${path.sep}`)) {
          logger.warn('Skipping directory that escapes the backup root', { path: source })
          continue
        }
        queue.push({ directory: source, archivePath })
      } else if (stats.isFile()) {
        result.push({ source, archivePath, size: stats.size })
      }
    }
  }
  return result
}

/**
 * Extract and validate a backup in its own staging directory.
 *
 * The archive is untrusted input: entry names are checked for traversal and
 * case/Unicode collisions before extraction, the expanded size is capped, and
 * the extracted tree is scanned for symlinks before any metadata is trusted.
 */
export async function extractBackupArchive(options: ExtractArchiveOptions): Promise<ExtractedArchive> {
  const { archivePath, stagingDir, migrationsDir, signal, onProgress } = options
  const targetDir = path.resolve(stagingDir)
  await mkdir(targetDir, { recursive: true, mode: STAGING_DIR_MODE })
  await chmod(targetDir, STAGING_DIR_MODE)

  onProgress?.({ operation: 'restore', stage: 'extracting', progress: 15, total: 100 })
  const zip = new StreamZip.async({ file: archivePath })
  try {
    const entries = await zip.entries()
    const names = Object.keys(entries)
    if (names.length > MAX_ARCHIVE_ENTRIES) {
      throw new Error(`Backup contains too many entries (${names.length})`)
    }
    let expandedBytes = 0
    for (const entry of Object.values(entries)) {
      expandedBytes += entry.size
      if (expandedBytes > MAX_EXTRACTED_BYTES) {
        throw new Error('Backup expands beyond the configured restore limit')
      }
    }
    assertZipEntriesWithin(names, targetDir)
    assertNoFoldedPathCollisions(names, 'Backup')
    await zip.extract(null, targetDir)
  } finally {
    await zip.close()
  }
  signal?.throwIfAborted()

  await assertNoSymlinks(targetDir)
  const metadata = await validateRestoreStaging(targetDir, migrationsDir)
  onProgress?.({ operation: 'restore', stage: 'validating', progress: 80, total: 100 })
  return {
    manifest: metadata,
    stagingDir: targetDir,
    databasePath: path.join(targetDir, metadata.database.archivePath)
  }
}

/**
 * Re-run every trust check against an extracted tree. Used after extraction and
 * again by the startup promotion gate, so a tree that changed between the two
 * phases cannot be promoted.
 */
export async function validateRestoreStaging(stagingDir: string, migrationsDir: string): Promise<BackupManifest> {
  const targetDir = path.resolve(stagingDir)
  await assertNoSymlinks(targetDir)
  await hardenRestoredTree(targetDir)
  const metadataPath = path.join(targetDir, BACKUP_METADATA_FILE)
  const metadata = backupManifestSchema.parse(JSON.parse(await readFile(metadataPath, 'utf8')))
  assertManifestResourcesAreManaged(metadata.resources)

  const databasePath = path.join(targetDir, metadata.database.archivePath)
  const databaseStats = await lstat(databasePath).catch(() => null)
  if (!databaseStats?.isFile() || databaseStats.isSymbolicLink()) {
    throw new Error('Backup is missing its SQLite database')
  }
  if (databaseStats.size !== metadata.database.size) {
    throw new Error('Backup SQLite size does not match its manifest')
  }
  const actualHash = await hashDbFile(databasePath)
  if (actualHash !== metadata.database.sha256) {
    throw new Error('Backup SQLite checksum does not match its manifest')
  }
  validateBackupDatabase(databasePath, migrationsDir)

  for (const resource of metadata.resources) {
    if (!resource.present) continue
    const resourcePath = path.join(targetDir, resource.archivePath)
    const resourceStats = await lstat(resourcePath).catch(() => null)
    if (resource.kind === 'file') {
      if (!resourceStats?.isFile() || resourceStats.isSymbolicLink()) {
        throw new Error(`Backup is missing file resource: ${resource.target}`)
      }
    } else if (!resourceStats?.isDirectory() || resourceStats.isSymbolicLink()) {
      throw new Error(`Backup is missing directory resource: ${resource.target}`)
    }
  }
  return metadata
}

function validateBackupDatabase(databasePath: string, migrationsDir: string): void {
  const sqlite = new Database(databasePath, { fileMustExist: true })
  try {
    const integrity = String(sqlite.pragma('integrity_check', { simple: true }))
    if (integrity !== 'ok') {
      throw new Error(`Backup SQLite integrity check failed: ${integrity}`)
    }
    const chain = readAppliedChain(sqlite)
    if (chain.length === 0) throw new Error('Backup SQLite migration chain is empty')
    const bundled = readMigrationFiles({ migrationsFolder: migrationsDir })
    if (
      chain.length > bundled.length ||
      !chain.every(
        (item, index) => item.folderMillis === bundled[index].folderMillis && item.hash === bundled[index].hash
      )
    ) {
      throw new Error('Backup was created by a newer or incompatible server version')
    }
  } finally {
    sqlite.close()
  }
  if (existsSync(`${databasePath}-wal`) || existsSync(`${databasePath}-shm`)) {
    throw new Error('Backup database contains unexpected WAL sidecars')
  }
}

async function assertNoSymlinks(root: string): Promise<void> {
  const queue = [root]
  while (queue.length > 0) {
    const current = queue.shift()!
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`Backup contains a symbolic link: ${entryPath}`)
      if (entry.isDirectory()) queue.push(entryPath)
    }
  }
}

/**
 * ZIP extraction does not preserve the source's restrictive modes. Strip group
 * and other access from the whole restored tree while preserving owner execute
 * bits (workspace scripts), so restored credentials and attachments are not
 * world-readable.
 */
async function hardenRestoredTree(root: string): Promise<void> {
  const queue = [root]
  while (queue.length > 0) {
    const current = queue.shift()!
    const currentStats = await lstat(current)
    await chmod(current, (currentStats.mode & 0o700) | 0o700)
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        queue.push(entryPath)
        continue
      }
      const stats = await lstat(entryPath)
      await chmod(entryPath, stats.mode & 0o700 || 0o600)
    }
  }
}

/** Write the manifest that the startup promotion gate consumes. */
export async function writeRestoreJournal(filePath: string, journal: unknown): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.tmp`
  await mkdir(path.dirname(filePath), { recursive: true, mode: STAGING_DIR_MODE })
  await writeFile(tempPath, JSON.stringify(journal, null, 2) + '\n', { mode: 0o600 })
  await rename(tempPath, filePath)
}
