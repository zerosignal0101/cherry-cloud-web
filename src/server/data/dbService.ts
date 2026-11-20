import type { DbOrTx, DbType } from '@data/db/types'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import type { DatabaseHandle } from './database'

/**
 * Lifecycle-shaped view of the server's database connection.
 *
 * Upstream services declare `@DependsOn(['DbService'])` and resolve the service
 * by name, so the headless build registers this class instead of the desktop
 * `DbService` (which owns electron paths, seeding and file layout). The actual
 * connection stays with `src/server/data/database.ts`; this class only forwards.
 */
let handle: DatabaseHandle | undefined

export function configureDbService(database: DatabaseHandle): void {
  handle = database
}

function requireHandle(): DatabaseHandle {
  if (!handle) {
    throw new Error('DbService was resolved before the database connection was configured')
  }
  return handle
}

@Injectable('DbService')
@ServicePhase(Phase.BeforeReady)
export class WebDbService extends BaseService {
  getDb(): DbType {
    return requireHandle().getDb()
  }

  withWriteTx<T>(fn: (tx: DbOrTx) => T): T {
    return requireHandle().withWriteTx(fn)
  }

  createSnapshot(targetPath: string): void {
    requireHandle().createSnapshot(targetPath)
  }

  checkpointTruncate(): void {
    requireHandle().checkpointTruncate()
  }
}
