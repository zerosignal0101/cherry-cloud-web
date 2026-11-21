import { assistantHandlers } from '@main/ipc/handlers/assistant'
import { profileHandlers } from '@main/ipc/handlers/profile'
import { providerHandlers } from '@main/ipc/handlers/provider'
import { assistantRequestSchemas } from '@shared/ipc/schemas/assistant'
import { profileRequestSchemas } from '@shared/ipc/schemas/profile'
import { providerRequestSchemas } from '@shared/ipc/schemas/provider'

import type { RpcRegistry } from '../transport/registry'

/**
 * Avatar and logo commands carry raw upload bytes, so they cannot travel over
 * DataApi. Each handler normalizes the image, creates a `file_entry`, binds the
 * owner's slot and compensates if the bind fails — the same pipeline the
 * desktop build uses.
 */
export function registerEntityImageRoutes(registry: RpcRegistry): void {
  registry.register(assistantRequestSchemas, assistantHandlers)
  registry.register(profileRequestSchemas, profileHandlers)
  registry.register(providerRequestSchemas, providerHandlers)
}
