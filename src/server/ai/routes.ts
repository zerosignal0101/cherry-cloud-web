import { aiHandlers } from '@main/ipc/handlers/ai'
import { aiRequestSchemas } from '@shared/ipc/schemas/ai'

import type { RpcRegistry } from '../transport/registry'

/**
 * Chat-path IpcApi routes, served by the upstream handlers over HTTP.
 *
 * The desktop app registers every domain at once. The web build starts with the
 * domains the chat core needs and adds the rest as their feature areas land, so
 * a route that has no web implementation fails with `ROUTE_NOT_FOUND` instead of
 * reaching a desktop-only service.
 */
export function registerAiRoutes(registry: RpcRegistry): void {
  registry.register(aiRequestSchemas, aiHandlers)
}
