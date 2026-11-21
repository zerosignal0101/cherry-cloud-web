import { application } from '@application'
import type { TraceStorageService } from '@main/ai/observability/storage/TraceStorageService'
import { traceRequestSchemas } from '@shared/ipc/schemas/trace'
import type { IpcHandlersFor } from '@shared/ipc/types'

import type { RpcRegistry } from '../transport/registry'

const handlers: IpcHandlersFor<typeof traceRequestSchemas> = {
  'trace.get_data': async ({ topicId, traceId, cursor }) => {
    const service = application.get('TraceStorageService') as TraceStorageService
    return service.getTraceData(topicId, traceId, cursor)
  }
}

/** Developer-mode span snapshots for the browser trace pane. */
export function registerTraceRoutes(registry: RpcRegistry): void {
  registry.register(traceRequestSchemas, handlers)
}
