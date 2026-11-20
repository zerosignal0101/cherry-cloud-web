import { fileProcessingHandlers } from '@main/ipc/handlers/fileProcessing'
import { fileProcessingRequestSchemas } from '@shared/ipc/schemas/fileProcessing'

import type { RpcRegistry } from '../../transport/registry'

/**
 * File-processing routes: listing the processors the server can run, starting a
 * conversion, polling its task, and probing Open MinerU. The handlers stay the
 * upstream adapters — the stateful work lives in `FileProcessingService`, which
 * the web runtime registers as a lifecycle service.
 */
export function registerFileProcessingRoutes(registry: RpcRegistry): void {
  registry.register(fileProcessingRequestSchemas, fileProcessingHandlers)
}
