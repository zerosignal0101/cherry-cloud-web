import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * Shared-cache bridge for browser tabs.
 *
 * The desktop preload relays `cache:sync` messages between windows. In the web
 * build tabs are IpcApi connections, so the same snapshots and deltas travel as
 * RPC requests and WebSocket events. Keys are validated as opaque strings here;
 * `CacheService` owns the key schema and only accepts schema-defined keys at the
 * TypeScript boundary.
 */
export const CacheEntrySchema = z.object({
  value: z.unknown(),
  expireAt: z.number().optional()
})

export const cacheRequestSchemas = {
  'cache.get_all_shared': defineRoute({
    input: z.void(),
    output: z.record(z.string(), CacheEntrySchema)
  }),
  'cache.sync_shared': defineRoute({
    input: z.strictObject({
      type: z.enum(['shared', 'persist']),
      key: z.string().min(1).max(512),
      /** Absent means delete, matching the desktop `CacheSyncMessage` protocol. */
      value: z.unknown().optional(),
      expireAt: z.number().optional()
    }),
    output: z.void()
  })
} as const
