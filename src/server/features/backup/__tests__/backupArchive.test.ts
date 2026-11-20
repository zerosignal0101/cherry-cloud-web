import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { ensureDataPaths, resolveDataPaths } from '@platform/dataPaths'
import JSZip from 'jszip'
import StreamZip from 'node-stream-zip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { openDatabase } from '../../../data/database'
import { createBackupArchive, extractBackupArchive, writeRestoreJournal } from '../archive'
import { BACKUP_METADATA_FILE } from '../manifest'
import { promotePendingRestore, type RestoreJournal } from '../restoreGate'

const MIGRATIONS = resolve(process.cwd(), 'migrations/sqlite-drizzle')
const roots: string[] = []

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  roots.push(root)
  ensureDataPaths(resolveDataPaths(root))
  return root
}

function seedData(root: string): void {
  writeFileSync(join(root, 'auth.json'), '{"version":"scrypt-v1"}')
  writeFileSync(join(root, 'cache.json'), '{"persist":true}')
  writeFileSync(join(root, 'secrets.json'), '{"version":1,"values":{}}')
  writeFileSync(join(root, 'secret.key'), 'secret')
  writeFileSync(join(root, 'session.key'), 'session')
  mkdirSync(join(root, 'files'), { recursive: true })
  writeFileSync(join(root, 'files', 'attachment.bin'), 'file-bytes')
  mkdirSync(join(root, 'notes', 'daily'), { recursive: true })
  writeFileSync(join(root, 'notes', 'daily', 'today.md'), '# today')
  mkdirSync(join(root, 'Skills', 'review'), { recursive: true })
  writeFileSync(join(root, 'Skills', 'review', 'SKILL.md'), '# review')
  mkdirSync(join(root, 'workspaces', 'project'), { recursive: true })
  writeFileSync(join(root, 'workspaces', 'project', 'main.ts'), 'export {}')
  mkdirSync(join(root, 'miniapps', 'data', 'demo'), { recursive: true })
  writeFileSync(join(root, 'miniapps', 'data', 'demo', 'state.json'), '{}')
  mkdirSync(join(root, 'Agents', 'system'), { recursive: true })
  writeFileSync(join(root, 'Agents', 'system', 'agent.json'), '{}')
  mkdirSync(join(root, 'provider-registry'), { recursive: true })
  writeFileSync(join(root, 'provider-registry', 'providers.json'), '[]')
  mkdirSync(join(root, 'logs'), { recursive: true })
  writeFileSync(join(root, 'logs', 'secret.log'), 'must not be backed up')
  mkdirSync(join(root, 'tmp'), { recursive: true })
  writeFileSync(join(root, 'tmp', 'scratch'), 'must not be backed up')
}

async function archiveFrom(root: string): Promise<{
  filePath: string
  manifest: Awaited<ReturnType<typeof createBackupArchive>>['manifest']
  db: ReturnType<typeof openDatabase>
}> {
  const dataPaths = resolveDataPaths(root)
  const db = openDatabase({ databasePath: dataPaths.database, migrationsDir: MIGRATIONS, seeders: [] })
  const archive = await createBackupArchive({
    dataRoot: root,
    database: db,
    outputPath: join(dataPaths.backupTemp, 'snapshot.zip'),
    appVersion: 'test'
  })
  return { ...archive, db }
}

beforeEach(() => {
  // Each test creates its own roots; kept empty so afterEach owns cleanup.
})

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('backup archive', () => {
  it('captures the SQLite snapshot and DATA_DIR resources while excluding logs and tmp', async () => {
    const root = tempRoot('ccw-backup-archive-')
    seedData(root)
    const { filePath, manifest, db } = await archiveFrom(root)
    db.close()

    expect(manifest.format).toBe('cherry-cloud-web')
    expect(manifest.database.size).toBeGreaterThan(0)
    expect(manifest.resources.map((resource) => resource.target)).toEqual(
      expect.arrayContaining([
        'auth.json',
        'cache.json',
        'files',
        'notes',
        'Skills',
        'workspaces',
        'miniapps',
        'Agents'
      ])
    )

    const zip = new StreamZip.async({ file: filePath })
    try {
      const names = Object.keys(await zip.entries())
      expect(names).toContain(BACKUP_METADATA_FILE)
      expect(names).toContain('database/cherry.db')
      expect(names).toContain('data/files/attachment.bin')
      expect(names).toContain('data/notes/daily/today.md')
      expect(names.some((name) => name.includes('logs/'))).toBe(false)
      expect(names.some((name) => name.includes('tmp/'))).toBe(false)
    } finally {
      await zip.close()
    }
  })

  it('rejects zip-slip entry names before extracting anything', async () => {
    const root = tempRoot('ccw-backup-zip-slip-')
    const archivePath = join(root, 'bad.zip')
    const zip = new JSZip()
    zip.file('../escape.txt', 'outside')
    writeFileSync(archivePath, await zip.generateAsync({ type: 'nodebuffer' }))

    await expect(
      extractBackupArchive({
        archivePath,
        stagingDir: join(root, 'restore-staging', 'bad'),
        migrationsDir: MIGRATIONS
      })
    ).rejects.toThrow()
  })

  it('promotes a staged archive on the next start and keeps the previous data aside', async () => {
    const source = tempRoot('ccw-backup-source-')
    seedData(source)
    const { filePath, manifest, db } = await archiveFrom(source)
    db.close()

    const target = tempRoot('ccw-backup-target-')
    writeFileSync(join(target, 'files', 'old.bin'), 'old')
    mkdirSync(join(target, 'exports'), { recursive: true })
    writeFileSync(join(target, 'exports', 'created-after-backup.txt'), 'new')
    const targetPaths = resolveDataPaths(target)
    const targetDb = openDatabase({
      databasePath: targetPaths.database,
      migrationsDir: MIGRATIONS,
      seeders: []
    })
    targetDb.close()

    const restoreId = 'restore-test'
    const stagingDir = join(targetPaths.restoreStaging, restoreId)
    await extractBackupArchive({
      archivePath: filePath,
      stagingDir,
      migrationsDir: MIGRATIONS
    })
    const journal: RestoreJournal = {
      version: 1,
      restoreId,
      createdAt: new Date().toISOString(),
      fileName: 'snapshot.zip',
      appVersion: 'test',
      state: 'ready',
      stagingPath: join('restore-staging', restoreId),
      manifest
    }
    await writeRestoreJournal(targetPaths.restoreJournal, journal)

    await expect(promotePendingRestore(targetPaths, MIGRATIONS)).resolves.toBe('promoted')

    expect(readFileSync(join(target, 'files', 'attachment.bin'), 'utf8')).toBe('file-bytes')
    expect(existsSync(join(target, 'files', 'old.bin'))).toBe(false)
    expect(readFileSync(join(target, 'notes', 'daily', 'today.md'), 'utf8')).toBe('# today')
    // `exports` did not exist at backup time, so the restore removes data created later.
    expect(existsSync(join(target, 'exports'))).toBe(false)
    expect(existsSync(targetPaths.restoreJournal)).toBe(false)
    expect(existsSync(join(targetPaths.restoreAside, restoreId, 'files', 'old.bin'))).toBe(true)
  })

  it('resumes a promotion that crashed after one resource was already swapped', async () => {
    const source = tempRoot('ccw-backup-resume-source-')
    seedData(source)
    const { filePath, manifest, db } = await archiveFrom(source)
    db.close()

    const target = tempRoot('ccw-backup-resume-target-')
    writeFileSync(join(target, 'files', 'old.bin'), 'old')
    const targetPaths = resolveDataPaths(target)
    const targetDb = openDatabase({
      databasePath: targetPaths.database,
      migrationsDir: MIGRATIONS,
      seeders: []
    })
    targetDb.close()

    const restoreId = 'restore-resume'
    const stagingDir = join(targetPaths.restoreStaging, restoreId)
    await extractBackupArchive({ archivePath: filePath, stagingDir, migrationsDir: MIGRATIONS })

    // Simulate a crash after `files` was promoted: the old live tree is aside,
    // the staged tree is live, and the journal never reached `applied`.
    const asideRoot = join(targetPaths.restoreAside, restoreId)
    mkdirSync(join(asideRoot, 'files'), { recursive: true })
    renameSync(join(target, 'files', 'old.bin'), join(asideRoot, 'files', 'old.bin'))
    renameSync(join(stagingDir, 'data', 'files', 'attachment.bin'), join(target, 'files', 'attachment.bin'))
    rmSync(join(stagingDir, 'data', 'files'), { recursive: true, force: true })

    const journal: RestoreJournal = {
      version: 1,
      restoreId,
      createdAt: new Date().toISOString(),
      fileName: 'snapshot.zip',
      appVersion: 'test',
      state: 'applying',
      stagingPath: join('restore-staging', restoreId),
      manifest
    }
    await writeRestoreJournal(targetPaths.restoreJournal, journal)

    await expect(promotePendingRestore(targetPaths, MIGRATIONS)).resolves.toBe('promoted')
    expect(readFileSync(join(target, 'files', 'attachment.bin'), 'utf8')).toBe('file-bytes')
    expect(readFileSync(join(target, 'notes', 'daily', 'today.md'), 'utf8')).toBe('# today')
    expect(existsSync(targetPaths.restoreJournal)).toBe(false)
  })

  it('does not follow symlinks while building the archive', async () => {
    const root = tempRoot('ccw-backup-symlink-')
    seedData(root)
    const outside = join(root, 'outside.txt')
    writeFileSync(outside, 'outside')
    symlinkSync(outside, join(root, 'files', 'link.txt'))

    const { filePath, db } = await archiveFrom(root)
    db.close()

    const zip = new StreamZip.async({ file: filePath })
    try {
      const names = Object.keys(await zip.entries())
      expect(names).toContain('data/files/attachment.bin')
      expect(names).not.toContain('data/files/link.txt')
    } finally {
      await zip.close()
    }
  })
})
