import { trashHandlers } from '@main/ipc/handlers/trash'
import { trashRequestSchemas } from '@shared/ipc/schemas/trash'

import type { RpcRegistry } from '../transport/registry'

/**
 * Recycle Bin commands shared with the desktop build: archiving moves topics
 * (and assistants) into the trash, while permanent deletion and "empty now"
 * coordinate with the purge job owned by `TrashService`.
 */
export function registerTrashRoutes(registry: RpcRegistry): void {
  registry.register(trashRequestSchemas, trashHandlers)
}
