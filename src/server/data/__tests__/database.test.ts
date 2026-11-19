import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { count, like, sql } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { appStateTable } from '@data/db/schemas/appState'
import { preferenceTable } from '@data/db/schemas/preference'

import { openDatabase, type DatabaseHandle } from '../database'
import { webSeeders } from '../seeders'

const migrationsDir = resolve(process.cwd(), 'migrations/sqlite-drizzle')

const tempDirs: string[] = []
let handle: DatabaseHandle | undefined

function tempDatabasePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ccw-db-'))
  tempDirs.push(dir)
  return join(dir, 'cherry.db')
}

function listTables(): string[] {
  const db = handle!.getDb()
  return db
    .all<{ name: string }>(sql`select name from sqlite_master where type = 'table'`)
    .map((row) => row.name)
}

function countPreferences(): number {
  const [row] = handle!.getDb().select({ value: count() }).from(preferenceTable).all()
  return row?.value ?? 0
}

afterEach(() => {
  handle?.close()
  handle = undefined
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('openDatabase', () => {
  it('applies the upstream schema and seeds defaults', () => {
    handle = openDatabase({ databasePath: tempDatabasePath(), migrationsDir, seeders: webSeeders })

    expect(listTables()).toEqual(expect.arrayContaining(['app_state', 'preference', 'file_entry', 'assistant']))
    expect(countPreferences()).toBeGreaterThan(0)

    const seededKeys = handle
      .getDb()
      .select({ key: appStateTable.key })
      .from(appStateTable)
      .where(like(appStateTable.key, 'seed:%'))
      .all()
      .map((row) => row.key)

    expect(seededKeys).toEqual(
      expect.arrayContaining([
        'seed:preference',
        'seed:knowledge-base-order',
        'seed:conversationListSort',
        'seed:translateLanguage'
      ])
    )
  })

  it('reopens an existing database without re-seeding', () => {
    const databasePath = tempDatabasePath()

    handle = openDatabase({ databasePath, migrationsDir, seeders: webSeeders })
    const firstCount = countPreferences()
    handle.close()

    handle = openDatabase({ databasePath, migrationsDir, seeders: webSeeders })

    expect(firstCount).toBeGreaterThan(0)
    expect(countPreferences()).toBe(firstCount)
  })

  it('fails fast when the migration folder is missing', () => {
    expect(() =>
      openDatabase({ databasePath: tempDatabasePath(), migrationsDir: join(tmpdir(), 'ccw-missing-migrations') })
    ).toThrow(/migrations not found/i)
  })
})
