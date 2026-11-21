import * as z from 'zod'

import { defineRoute } from '../define'

const headerMapSchema = z.record(z.string(), z.string()).optional()

const authMessageSchema = z.object({
  device_code: z.string().min(1),
  user_code: z.string().min(1),
  verification_uri: z.string().min(1)
})

const tokenSchema = z.object({ token: z.string().min(1) })

/**
 * GitHub Copilot device-flow commands. The desktop preload exposed these on
 * `window.api.copilot`; the web build runs the same flow on the server so the
 * GitHub token never has to live in browser storage.
 */
export const copilotRequestSchemas = {
  'copilot.get_auth_message': defineRoute({
    input: z.object({ headers: headerMapSchema }),
    output: authMessageSchema
  }),
  'copilot.get_copilot_token': defineRoute({
    input: z.object({ deviceCode: z.string().min(1), headers: headerMapSchema }),
    output: z.object({ access_token: z.string().min(1) })
  }),
  'copilot.save_copilot_token': defineRoute({
    input: z.object({ token: z.string().min(1) }),
    output: z.void()
  }),
  'copilot.get_token': defineRoute({
    input: z.object({ headers: headerMapSchema }),
    output: tokenSchema
  }),
  'copilot.get_user': defineRoute({
    input: z.object({ accessToken: z.string().min(1) }),
    output: z.object({ login: z.string().min(1), avatar: z.string().min(1) })
  }),
  'copilot.logout': defineRoute({ input: z.void(), output: z.void() })
}
