import { computerUseRequestSchemas } from '@shared/ipc/schemas/computerUse'
import type { IpcHandlersFor } from '@shared/ipc/types'

import type { RpcRegistry } from '../transport/registry'

/**
 * The shared agent surfaces probe desktop control on mount. The web build has no
 * OS control channel, so the honest answer is an empty snapshot rather than a
 * route error that would surface as a toast. Actual computer use remains out of
 * scope (see docs/architecture/feature-migration.md).
 */
const computerUseRoutes = {
  'computer_use.get_controls': computerUseRequestSchemas['computer_use.get_controls']
} as const

const computerUseHandlers: IpcHandlersFor<typeof computerUseRoutes> = {
  'computer_use.get_controls': async () => []
}

export function registerComputerUseRoutes(registry: RpcRegistry): void {
  registry.register(computerUseRoutes, computerUseHandlers)
}
