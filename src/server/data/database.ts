import fs from 'node:fs'
import path from 'node:path'

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import { applyMigrations } from '@data/db/applyMigrations'
import { registerKnowledgeFunctions } from '@data/db/knowledgeFunctions'
import { SeedRunner } from '@data/db/seeding/SeedRunner'
import type { DbOrTx, DbType, ISeeder } from '@data/db/types'
import { loggerService } from '@logger'

const logger = loggerService.withContext('Database')

/**
 * Headless counterpart of upstream `DbService`: same connection settings, same
 * migration path, no lifecycle container.
 *
 * `DbService` is a lifecycle-managed service whose constructor reads electron
 * paths and whose `onInit` seeds the desktop feature set. The server owns those
 * decisions itself (see `./seeders.ts`), so it opens the database directly and
 * registers the resulting handle as `DbService` for the upstream data services
 * that ask `application.get('DbService')` for `getDb()` / `withWriteTx()`.
 */
export interface DatabaseHandle {
  readonly isReady: boolean
  getDb(): DbType
  /** Atomic multi-statement writes; see the invariant note in `DbService.withWriteTx`. */
  withWriteTx<T>(fn: (tx: DbOrTx) => T): T
  close(): void
}

export interface OpenDatabaseOptions {
  databasePath: string
  /** Directory holding drizzle's `*.sql` files and `meta/_journal.json`. */
  migrationsDir: string
  seeders?: ISeeder[]
}

export function openDatabase({ databasePath, migrationsDir, seeders = [] }: OpenDatabaseOptions): DatabaseHandle {
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Database migrations not found at ${migrationsDir}`)
  }

  removeCorruptDatabase(databasePath)

  const sqlite = new Database(databasePath)
  registerKnowledgeFunctions(sqlite)
  const db = drizzle({ client: sqlite, casing: 'snake_case' })

  try {
    // One persistent connection for the process lifetime, so these hold until close.
    sqlite.pragma('journal_mode = WAL')
    sqlite.pragma('synchronous = NORMAL')
    sqlite.pragma('foreign_keys = ON')
    sqlite.pragma('busy_timeout = 5000')

    applyMigrations(db, migrationsDir)
    logger.info('Database migrations applied', { databasePath })

    if (seeders.length > 0) {
      new SeedRunner(db).runAll(seeders)
    }
  } catch (error) {
    sqlite.close()
    throw error
  }

  logger.info('Database connection initialized', { databasePath })

  return {
    isReady: true,
    getDb: () => db,
    withWriteTx: <T>(fn: (tx: DbOrTx) => T): T => db.transaction(fn, { behavior: 'immediate' }),
    close: () => sqlite.close()
  }
}

/**
 * SQLite reports `SQLITE_IOERR_SHORT_READ` when the main file is 0 bytes, or when
 * a `-wal`/`-shm` pair outlives a deleted database. Clearing those lets SQLite
 * recreate the file instead of failing at open.
 */
function removeCorruptDatabase(databasePath: string): void {
  if (fs.existsSync(databasePath)) {
    if (fs.statSync(databasePath).size > 0) return
    logger.warn('Database file is empty (0 bytes), removing', { databasePath })
    fs.unlinkSync(databasePath)
  }

  for (const suffix of ['-wal', '-shm']) {
    const auxPath = databasePath + suffix
    if (fs.existsSync(auxPath)) {
      logger.warn('Removing orphaned database auxiliary file', { file: path.basename(auxPath) })
      fs.unlinkSync(auxPath)
    }
  }
}
