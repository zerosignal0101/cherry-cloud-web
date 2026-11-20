import { ExportService } from '@main/services/ExportService'
import ObsidianVaultService from '@main/services/ObsidianVaultService'
import type { exportRequestSchemas } from '@shared/ipc/schemas/export'
import type { IpcHandlersFor } from '@shared/ipc/types'

// Both are plain, non-lifecycle classes; a single module-level instance backs the routes.
const exportService = new ExportService()
const obsidianVaultService = new ObsidianVaultService()

export const exportHandlers: IpcHandlersFor<typeof exportRequestSchemas> = {
  'export.word.from_markdown': async ({ markdown, fileName }, ctx) => {
    return exportService.exportToWord(markdown, fileName, ctx.senderId)
  },
  'export.word.download': async ({ markdown, fileName }) => {
    const buffer = await exportService.createWordBuffer(markdown)
    return {
      fileName: normalizeDocxFileName(fileName),
      base64: buffer.toString('base64'),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' as const
    }
  },
  'export.obsidian.get_vaults': async () => obsidianVaultService.getVaults(),
  'export.obsidian.get_files': async ({ vaultName }) => obsidianVaultService.getFilesByVaultName(vaultName)
}

export function normalizeDocxFileName(fileName: string): string {
  const base =
    fileName
      .replace(/[\\/]/g, '_')
      .replace(/[<>:"|?*\p{Cc}]/gu, '_')
      .trim() || 'document'
  return base.toLowerCase().endsWith('.docx') ? base : `${base}.docx`
}
