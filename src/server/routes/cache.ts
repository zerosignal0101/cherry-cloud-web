import { application } from '@application'
import type { CacheEntry } from '@shared/data/cache/cacheTypes'
import { cacheRequestSchemas } from '@shared/ipc/schemas/cache'
import type { IpcHandlersFor } from '@shared/ipc/types'

import type { RpcRegistry } from '../transport/registry'

interface WebCacheBridge {
  getAllSharedSnapshot(): Record<string, CacheEntry>
  setShared(key: string, value: unknown, ttl?: number): void
  deleteShared(key: string): boolean
}

const cache = (): WebCacheBridge => application.get('CacheService')

const cacheHandlers: IpcHandlersFor<typeof cacheRequestSchemas> = {
  'cache.get_all_shared': async () => cache().getAllSharedSnapshot(),
  'cache.sync_shared': async ({ type, key, value, expireAt }) => {
    // Persist-cache writes are tab-local in the web build; only the shared tier
    // has a server-side mirror to update.
    if (type !== 'shared') return
    const ttl = expireAt === undefined ? undefined : expireAt - Date.now()
    // A missing value or an already-expired entry is a tombstone, matching the
    // desktop `{ value: undefined }` delete protocol.
    if (value === undefined || (ttl !== undefined && ttl <= 0)) {
      cache().deleteShared(key)
      return
    }
    cache().setShared(key, value, ttl)
  }
}

/**
 * Browser tabs mirror the main-process shared cache so job progress, runtime
 * statuses and other `CacheService`-owned state stay live without polling.
 */
export function registerCacheRoutes(registry: RpcRegistry): void {
  registry.register(cacheRequestSchemas, cacheHandlers)
}
