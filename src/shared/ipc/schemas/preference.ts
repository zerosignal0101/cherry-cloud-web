import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * Preference routes — the Web replacement for the desktop preload's
 * `window.api.preference` bridge (`Preference_Get`, `Preference_Set`, …).
 *
 * Desktop reached the main-process `PreferenceService` through Electron IPC on
 * fixed channels. The browser reaches the same service over `POST /api/rpc`, so
 * the channel set is restated as typed routes: values stay `unknown` here
 * because the key→value mapping is enforced by `PreferenceService`, not by this
 * transport layer.
 *
 * `preference.subscribe` carries no server state: one user owns every tab, so a
 * write fans out `preference.changed` to all of them and each tab filters by its
 * own subscriptions.
 */
export const preferenceRequestSchemas = {
  'preference.get': defineRoute({
    input: z.object({ key: z.string().min(1) }),
    output: z.unknown()
  }),
  'preference.get_multiple_raw': defineRoute({
    input: z.object({ keys: z.array(z.string().min(1)) }),
    output: z.record(z.string(), z.unknown())
  }),
  'preference.get_all': defineRoute({
    input: z.void(),
    output: z.record(z.string(), z.unknown())
  }),
  'preference.set': defineRoute({
    input: z.object({ key: z.string().min(1), value: z.unknown() }),
    output: z.void()
  }),
  'preference.set_multiple': defineRoute({
    input: z.object({ updates: z.record(z.string(), z.unknown()) }),
    output: z.void()
  }),
  'preference.subscribe': defineRoute({
    input: z.object({ keys: z.array(z.string().min(1)) }),
    output: z.void()
  })
}

export type PreferenceEventSchemas = {
  /** One preference was written; broadcast to every connected tab. */
  'preference.changed': { key: string; value: unknown }
}
