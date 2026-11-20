import { ipcApi } from '@renderer/ipc'

/**
 * Server-side Word generation + browser download.
 *
 * The server owns markdown-it/docx and returns the bytes; this helper only turns
 * the base64 payload into an object URL. It deliberately does not use a native
 * save dialog, which does not exist in the browser.
 */
export async function exportWordFromMarkdown(markdown: string, fileName: string): Promise<boolean> {
  const result = await ipcApi.request('export.word.download', { markdown, fileName })
  const binary = atob(result.base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: result.mimeType }))
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = result.fileName
    document.body.appendChild(link)
    link.click()
    link.remove()
    return true
  } finally {
    URL.revokeObjectURL(url)
  }
}
