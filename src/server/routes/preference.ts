import { application } from '@application'
import { preferenceRequestSchemas } from '@shared/ipc/schemas/preference'
import type { IpcHandlersFor } from '@shared/ipc/types'
import { IpcChannel } from '@shared/IpcChannel'

import type { ConnectionRegistry } from '../transport/connections'
import type { RpcRegistry } from '../transport/registry'

/**
 * The subset of `PreferenceService` the browser needs. Declared structurally so
 * this module never widens the service's generic key→value contract just to
 * accept a runtime string from the network; `PreferenceService.resolveKey`
 * remains the single validator for untrusted keys.
 */
interface PreferenceAccess {
  get(key: string): unknown
  getAll(): Record<string, unknown>
  getMultipleRaw(keys: string[]): Record<string, unknown>
  set(key: string, value: unknown): Promise<void>
  setMultiple(updates: Record<string, unknown>): Promise<void>
}

const preferenceService = (): PreferenceAccess =>
  // Resolved per request: the lifecycle container owns the instance and only
  // exists after `startAiRuntime()`, which runs after route registration.
  application.get('PreferenceService') as PreferenceAccess

export function registerPreferenceRoutes(registry: RpcRegistry, connections: ConnectionRegistry): void {
  const handlers: IpcHandlersFor<typeof preferenceRequestSchemas> = {
    'preference.get': async ({ key }) => preferenceService().get(key),

    'preference.get_multiple_raw': async ({ keys }) => preferenceService().getMultipleRaw(keys),

    'preference.get_all': async () => preferenceService().getAll(),

    'preference.set': async ({ key, value }) => {
      await preferenceService().set(key, value)
      connections.broadcast(IpcChannel.Preference_Changed, { key, value })
    },

    'preference.set_multiple': async ({ updates }) => {
      await preferenceService().setMultiple(updates)
      for (const [key, value] of Object.entries(updates)) {
        connections.broadcast(IpcChannel.Preference_Changed, { key, value })
      }
    },

    /**
     * No server-side subscription state: a write is broadcast to every tab and
     * each tab filters by the keys it asked for. The desktop version keyed this
     * by BrowserWindow id, which has no counterpart here.
     */
    'preference.subscribe': async () => {}
  }

  registry.register(preferenceRequestSchemas, handlers)
}
