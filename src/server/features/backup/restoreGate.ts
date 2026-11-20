import { existsSync } from 'node:fs'
import { lstat, mkdir, readFile, readdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'

import type { DataPaths } from '@platform/dataPaths'
import * as z from 'zod'

import { loggerService } from '@logger'

import { validateRestoreStaging, writeRestoreJournal } from './archive'
import { backupManifestSchema, assertManifestResourcesAreManaged, type BackupManifest } from './manifest'

const logger = loggerService.withContext('RestoreGate')

const restoreJournalSchema = z.object({
  version: z.literal(1),
  restoreId: z.string().min(1),
  createdAt: z.string().min(1),
  fileName: z.string().min(1),
  appVersion: z.string(),
  state: z.enum(['ready', 'applying', 'applied']),
  stagingPath: z.string().min(1),
  manifest: backupManifestSchema
})

export type RestoreJournal = z.infer<typeof restoreJournalSchema>

interface PromotionEntry {
  label: string
  livePath: string
  stagedPath: string
  asidePath: string
  recursive: boolean
  present: boolean
}

export type RestoreGateOutcome = 'none' | 'promoted' | 'cleaned'

/**
 * Apply a staged restore before the database and auth store are opened.
 *
 * Restores are deliberately staged by the running process and promoted on the
 * next start: closing and reopening SQLite under a live lifecycle container
 * would leave every service holding a detached connection. The journal is
 * written before any rename and re-read on retry, so a crash mid-promotion can
 * resume; entries that were already moved aside are never moved twice.
 */
export async function promotePendingRestore(dataPaths: DataPaths, migrationsDir: string): Promise<RestoreGateOutcome> {
  const journalPath = dataPaths.restoreJournal
  if (!existsSync(journalPath)) {
    await rm(dataPaths.restoreStaging, { recursive: true, force: true }).catch(() => {})
    return 'none'
  }

  const journal = await readJournal(journalPath)
  if (journal.state === 'applied') {
    await rm(dataPaths.restoreStaging, { recursive: true, force: true }).catch(() => {})
    await rm(journalPath, { force: true }).catch(() => {})
    logger.info('Restore promotion was already applied; cleaned up staging', { restoreId: journal.restoreId })
    return 'cleaned'
  }

  const stagingPath = resolveStagingPath(dataPaths, journal)
  const manifest =
    journal.state === 'ready' ? await validateRestoreStaging(stagingPath, migrationsDir) : journal.manifest
  assertManifestResourcesAreManaged(manifest.resources)
  if (manifest.database.sha256 !== journal.manifest.database.sha256) {
    throw new Error('Restore staging no longer matches its journal')
  }

  const asideRoot = path.join(dataPaths.restoreAside, journal.restoreId)
  await pruneOldAsides(dataPaths.restoreAside, journal.restoreId)
  const entries = buildPromotionEntries(dataPaths, stagingPath, asideRoot, manifest)
  if (journal.state === 'ready') {
    await assertAllStaged(entries)
  } else {
    // `applying` means a previous process was interrupted mid-promotion. Already
    // promoted entries no longer exist in staging, so only the remaining ones
    // can be checked; the archive was fully validated before the journal was
    // written.
    await assertResumableStaging(entries)
  }

  const applying: RestoreJournal = { ...journal, state: 'applying' }
  await writeRestoreJournal(journalPath, applying)
  const completed: PromotionEntry[] = []

  try {
    for (const entry of entries) {
      await promoteEntry(entry)
      completed.push(entry)
    }
    await writeRestoreJournal(journalPath, { ...applying, state: 'applied' })
    await rm(stagingPath, { recursive: true, force: true })
    await rm(journalPath, { force: true })
    logger.info('Restore promoted; restart completed', {
      restoreId: journal.restoreId,
      backupFileName: journal.fileName,
      aside: asideRoot
    })
    return 'promoted'
  } catch (error) {
    logger.error('Restore promotion failed; rolling back completed entries', toError(error), {
      restoreId: journal.restoreId
    })
    let rollbackFailed = false
    for (const entry of completed.reverse()) {
      try {
        await rollbackEntry(entry)
      } catch (rollbackError) {
        rollbackFailed = true
        logger.error('Restore rollback failed for entry', toError(rollbackError), { path: entry.livePath })
      }
    }
    if (!rollbackFailed) {
      await rm(journalPath, { force: true }).catch(() => {})
    }
    throw error
  }
}

async function readJournal(journalPath: string): Promise<RestoreJournal> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(journalPath, 'utf8'))
  } catch (error) {
    throw new Error(`Restore journal is unreadable: ${journalPath}`, { cause: error })
  }
  const result = restoreJournalSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`Restore journal is invalid: ${result.error.message}`)
  }
  return result.data
}

function resolveStagingPath(dataPaths: DataPaths, journal: RestoreJournal): string {
  const relative = journal.stagingPath
  if (path.isAbsolute(relative) || relative.includes('\0') || relative.split(/[\\/]/).includes('..')) {
    throw new Error('Restore journal staging path is not relative')
  }
  const stagingPath = path.resolve(dataPaths.root, relative)
  const stagingRoot = path.resolve(dataPaths.restoreStaging)
  if (stagingPath !== stagingRoot && !stagingPath.startsWith(`${stagingRoot}${path.sep}`)) {
    throw new Error('Restore staging is outside the managed restore directory')
  }
  return stagingPath
}

function buildPromotionEntries(
  dataPaths: DataPaths,
  stagingPath: string,
  asideRoot: string,
  manifest: BackupManifest
): PromotionEntry[] {
  const entries: PromotionEntry[] = [
    {
      label: 'sqlite',
      livePath: dataPaths.database,
      stagedPath: path.join(stagingPath, manifest.database.archivePath),
      asidePath: path.join(asideRoot, path.basename(dataPaths.database)),
      recursive: false,
      present: true
    }
  ]
  for (const resource of manifest.resources) {
    entries.push({
      label: resource.target,
      livePath: path.join(dataPaths.root, resource.target),
      stagedPath: path.join(stagingPath, resource.archivePath),
      asidePath: path.join(asideRoot, resource.target),
      recursive: resource.kind === 'directory',
      present: resource.present
    })
  }
  return entries
}

async function assertAllStaged(entries: PromotionEntry[]): Promise<void> {
  for (const entry of entries) {
    if (!entry.present) {
      if (await pathExists(entry.stagedPath)) {
        throw new Error(`Restore staging unexpectedly contains ${entry.label}`)
      }
      continue
    }
    const stats = await lstat(entry.stagedPath).catch(() => null)
    if (!stats) throw new Error(`Restore staging is missing ${entry.label}`)
    if (stats.isSymbolicLink()) throw new Error(`Restore staging contains a symlink for ${entry.label}`)
    if (entry.recursive ? !stats.isDirectory() : !stats.isFile()) {
      throw new Error(`Restore staging has the wrong kind for ${entry.label}`)
    }
  }
}

async function assertResumableStaging(entries: PromotionEntry[]): Promise<void> {
  for (const entry of entries) {
    const stagedStats = await lstat(entry.stagedPath).catch(() => null)
    if (!entry.present) {
      if (stagedStats) throw new Error(`Restore staging unexpectedly contains ${entry.label}`)
      continue
    }
    if (!stagedStats) {
      // A missing staged entry is either already live or still has its original
      // live copy waiting to be moved aside. At least one must exist.
      const liveOrAside = (await pathExists(entry.livePath)) || (await pathExists(entry.asidePath))
      if (!liveOrAside) throw new Error(`Restore staging lost ${entry.label} before promotion finished`)
      continue
    }
    if (stagedStats.isSymbolicLink()) throw new Error(`Restore staging contains a symlink for ${entry.label}`)
    if (entry.recursive ? !stagedStats.isDirectory() : !stagedStats.isFile()) {
      throw new Error(`Restore staging has the wrong kind for ${entry.label}`)
    }
  }
}

async function promoteEntry(entry: PromotionEntry): Promise<void> {
  await mkdir(path.dirname(entry.asidePath), { recursive: true, mode: 0o700 })
  await mkdir(path.dirname(entry.livePath), { recursive: true, mode: 0o700 })

  const [liveExists, asideExists, stagedExists] = await Promise.all([
    pathExists(entry.livePath),
    pathExists(entry.asidePath),
    pathExists(entry.stagedPath)
  ])

  // A resumable promotion may have already moved this entry live. Never move
  // the (new) live copy aside when there is nothing staged to replace it.
  if (entry.present && !stagedExists) return

  if (!asideExists && liveExists) {
    await rename(entry.livePath, entry.asidePath)
  }
  if (entry.label === 'sqlite') {
    await rm(`${entry.livePath}-wal`, { force: true }).catch(() => {})
    await rm(`${entry.livePath}-shm`, { force: true }).catch(() => {})
  }
  if (stagedExists) {
    if (await pathExists(entry.livePath)) {
      await rm(entry.livePath, { recursive: entry.recursive, force: true })
    }
    await rename(entry.stagedPath, entry.livePath)
  }
}

async function rollbackEntry(entry: PromotionEntry): Promise<void> {
  const [liveExists, asideExists, stagedExists] = await Promise.all([
    pathExists(entry.livePath),
    pathExists(entry.asidePath),
    pathExists(entry.stagedPath)
  ])
  if (liveExists) {
    if (stagedExists) {
      await rm(entry.livePath, { recursive: entry.recursive, force: true })
    } else {
      await rename(entry.livePath, entry.stagedPath)
    }
  }
  if (asideExists) {
    await rename(entry.asidePath, entry.livePath)
    if (entry.label === 'sqlite') {
      await rm(`${entry.livePath}-wal`, { force: true }).catch(() => {})
      await rm(`${entry.livePath}-shm`, { force: true }).catch(() => {})
    }
  }
}

async function pathExists(target: string): Promise<boolean> {
  return lstat(target)
    .then(() => true)
    .catch(() => false)
}

async function pruneOldAsides(asideRoot: string, keep: string): Promise<void> {
  const entries = await readdir(asideRoot, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === keep) continue
    await rm(path.join(asideRoot, entry.name), { recursive: true, force: true }).catch(() => {})
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
