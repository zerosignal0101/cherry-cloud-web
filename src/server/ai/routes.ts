import { agentWorkspaceStorageService } from '@main/ai/agents/AgentWorkspaceStorageService'
import { aiHandlers } from '@main/ipc/handlers/ai'
import { mcpHandlers } from '@main/ipc/handlers/mcp'
import { translateHandlers } from '@main/ipc/handlers/translate'
import { webSearchHandlers } from '@main/ipc/handlers/webSearch'
import { aiRequestSchemas } from '@shared/ipc/schemas/ai'
import { mcpRequestSchemas } from '@shared/ipc/schemas/mcp'
import { translateRequestSchemas } from '@shared/ipc/schemas/translate'
import { webSearchRequestSchemas } from '@shared/ipc/schemas/webSearch'

import type { WorkspaceService } from '../features/workspace/WorkspaceService'
import type { RpcRegistry } from '../transport/registry'

/**
 * Chat-path IpcApi routes, served by the upstream handlers over HTTP.
 *
 * The desktop app registers every domain at once. The web build starts with the
 * domains the chat core needs and adds the rest as their feature areas land, so
 * a route that has no web implementation fails with `ROUTE_NOT_FOUND` instead of
 * reaching a desktop-only service.
 */
export interface AiRouteOptions {
  workspaceService?: WorkspaceService
}

export function registerAiRoutes(registry: RpcRegistry, options: AiRouteOptions = {}): void {
  const handlers = {
    ...aiHandlers,
    'ai.agent.workspace.register': async (input: { path: string; name?: string }) => {
      const match = /^\/workspaces\/([A-Za-z0-9_-]{8,64})$/.exec(input.path)
      if (!match || !options.workspaceService) {
        throw new Error('Workspace must be created on the server before it is attached to an agent')
      }
      const workspace = await agentWorkspaceStorageService.registerWorkspace(
        options.workspaceService.pathFor(match[1]),
        { name: input.name }
      )
      // The RPC response travels to the browser too; never echo the host path.
      return { ...workspace, path: input.path }
    }
  }
  registry.register(aiRequestSchemas, handlers)
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

/**
 * Text translation only. PDF translation needs the BabelDOC sidecar and a
 * server-side toolchain, so those routes stay unregistered until that phase
 * lands; the renderer still streams the result through `ai.stream.*`.
 */
const translateRoutes = {
  'translate.open': translateRequestSchemas['translate.open']
} as const

const translateRouteHandlers = {
  'translate.open': translateHandlers['translate.open']
} as const

export function registerTranslateRoutes(registry: RpcRegistry): void {
  registry.register(translateRoutes, translateRouteHandlers)
}
