import { preferenceTable } from '@data/db/schemas/preference'
import type { DbType, ISeeder } from '@data/db/types'

/**
 * Preference defaults that differ from the desktop app.
 *
 * The shared defaults describe a desktop install: the first launch walks the
 * user through connecting a provider (and CherryIN), and the privacy gate asks
 * for consent before usage data is uploaded. Neither flow applies here — there
 * is no account or vendor cloud to connect to, and the server collects nothing
 * (see AGENTS.md) — so a fresh database starts past onboarding with data
 * collection off.
 *
 * Rows are only inserted when absent, so a deployment that already has a
 * database is never rewritten.
 */
const OVERRIDES: Record<string, unknown> = {
  'app.onboarding.provider_setup.status': 'completed',
  'app.privacy.data_collection.enabled': false
}

export class WebDefaultsSeeder implements ISeeder {
  readonly name = 'web-defaults'
  readonly description = 'Override desktop-only first-run defaults'
  readonly version = '1'

  run(db: DbType): void {
    const existing = new Set(
      db
        .select()
        .from(preferenceTable)
        .all()
        .filter((row) => row.scope === 'default')
        .map((row) => row.key)
    )

    const rows = Object.entries(OVERRIDES)
      .filter(([key]) => !existing.has(key))
      .map(([key, value]) => ({ scope: 'default', key, value }))

    if (rows.length > 0) {
      db.insert(preferenceTable).values(rows).run()
    }
  }
}
