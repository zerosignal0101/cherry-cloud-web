import { aiHandlers } from '@main/ipc/handlers/ai'
import { fileHandlers } from '@main/ipc/handlers/file'
import { mcpHandlers } from '@main/ipc/handlers/mcp'
import { webSearchHandlers } from '@main/ipc/handlers/webSearch'
import { aiRequestSchemas } from '@shared/ipc/schemas/ai'
import { fileRequestSchemas } from '@shared/ipc/schemas/file'
import { mcpRequestSchemas } from '@shared/ipc/schemas/mcp'
import { webSearchRequestSchemas } from '@shared/ipc/schemas/webSearch'

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

/**
 * File routes backed by `FileManager`, which the web runtime now registers.
 *
 * The renderer still calls some of these through `window.api.file` (metadata,
 * physical-path lookup, rename, trash); the rest answer honestly with a
 * service error until their desktop counterpart is replaced. Registering the
 * whole schema keeps the route set identical to the type contract instead of a
 * hand-maintained subset that drifts.
 */
export function registerFileIpcRoutes(registry: RpcRegistry): void {
  registry.register(fileRequestSchemas, fileHandlers)
}

/**
 * Capability routes owned by the settings surfaces: web-search provider checks
 * and MCP server interactions. Their services are part of the web lifecycle;
 * protocol-install routes still depend on `ProtocolService` and only fail if a
 * caller asks for an install flow this build does not expose.
 */
export function registerCapabilityRoutes(registry: RpcRegistry): void {
  registry.register(webSearchRequestSchemas, webSearchHandlers)
  registry.register(mcpRequestSchemas, mcpHandlers)
}
