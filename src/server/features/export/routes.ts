import { exportRequestSchemas } from '@shared/ipc/schemas/export'
import type { IpcHandlersFor } from '@shared/ipc/types'

import type { RpcRegistry } from '../../transport/registry'

const webExportSchemas = {
  'export.word.download': exportRequestSchemas['export.word.download']
}

const handlers: IpcHandlersFor<typeof webExportSchemas> = {
  'export.word.download': async ({ markdown, fileName }) => {
    const { ExportService } = await import('@main/services/ExportService')
    const buffer = await new ExportService().createWordBuffer(markdown)
    return {
      fileName: normalizeDocxFileName(fileName),
      base64: buffer.toString('base64'),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' as const
    }
  }
}

export function registerExportRoutes(registry: RpcRegistry): void {
  registry.register(webExportSchemas, handlers)
}

function normalizeDocxFileName(fileName: string): string {
  const base =
    fileName
      .replace(/[\\/]/g, '_')
      .replace(/[<>:"|?*\p{Cc}]/gu, '_')
      .trim() || 'document'
  return base.toLowerCase().endsWith('.docx') ? base : `${base}.docx`
}
