import { copilotService } from '@main/services/CopilotService'
import { copilotRequestSchemas } from '@shared/ipc/schemas/copilot'
import type { IpcHandlersFor } from '@shared/ipc/types'

import type { RpcRegistry } from '../transport/registry'

/** `CopilotService` still takes Electron's event argument; the server has none. */
const NO_EVENT = null as unknown as Electron.IpcMainInvokeEvent

const handlers: IpcHandlersFor<typeof copilotRequestSchemas> = {
  'copilot.get_auth_message': async ({ headers }) => copilotService.getAuthMessage(NO_EVENT, headers),
  'copilot.get_copilot_token': async ({ deviceCode, headers }) =>
    copilotService.getCopilotToken(NO_EVENT, deviceCode, headers),
  'copilot.save_copilot_token': async ({ token }) => {
    await copilotService.saveCopilotToken(NO_EVENT, token)
  },
  'copilot.get_token': async ({ headers }) => copilotService.getToken(NO_EVENT, headers),
  'copilot.get_user': async ({ accessToken }) => copilotService.getUser(NO_EVENT, accessToken),
  'copilot.logout': async () => {
    await copilotService.logout()
  }
}

/**
 * Server-side GitHub Copilot device flow. The upstream service stores the OAuth
 * token through `safeStorage`; the platform shim now provides the same AES-GCM
 * encryption on the server, so the provider request path can exchange it too.
 */
export function registerCopilotRoutes(registry: RpcRegistry): void {
  registry.register(copilotRequestSchemas, handlers)
}
