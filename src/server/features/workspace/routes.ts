import { workspaceRequestSchemas } from '@shared/ipc/schemas/workspace'
import type { IpcHandlersFor } from '@shared/ipc/types'

import type { RpcRegistry } from '../../transport/registry'
import type { WorkspaceService } from './WorkspaceService'

const workspaceHandlers = (service: WorkspaceService): IpcHandlersFor<typeof workspaceRequestSchemas> => ({
  'workspace.list': async () => ({ workspaces: await service.list() }),
  'workspace.create': async ({ name }) => service.create(name),
  'workspace.delete': async ({ id }) => service.delete(id),
  'workspace.list_files': async ({ id, path }) => ({ entries: await service.listFiles(id, path ?? '') }),
  'workspace.read_file': async ({ id, path }) => service.readFile(id, path),
  'workspace.write_file': async ({ id, path, content }) => service.writeFile(id, path, content),
  'workspace.delete_file': async ({ id, path }) => service.deleteFile(id, path)
})

/**
 * Workspace routes are deliberately separate from the AI domain: their only
 * dependency is the server filesystem sandbox, and keeping them together makes
 * the path-validation boundary easy to audit.
 */
export function registerWorkspaceRoutes(registry: RpcRegistry, service: WorkspaceService): void {
  registry.register(workspaceRequestSchemas, workspaceHandlers(service))
}
