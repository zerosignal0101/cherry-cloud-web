import { citationHandlers } from '@main/ipc/handlers/citation'
import { toolResultHandlers } from '@main/ipc/handlers/toolResult'
import { citationRequestSchemas } from '@shared/ipc/schemas/citation'
import { toolResultRequestSchemas } from '@shared/ipc/schemas/toolResult'

import type { RpcRegistry } from '../transport/registry'

/**
 * Server-side remote previews used by chat: citation link previews and image
 * thumbnails embedded in tool results. Both fetch through the server's guarded
 * remote-fetch helpers, so the browser never contacts arbitrary origins.
 */
export function registerPreviewRoutes(registry: RpcRegistry): void {
  registry.register(citationRequestSchemas, citationHandlers)
  registry.register(toolResultRequestSchemas, toolResultHandlers)
}
