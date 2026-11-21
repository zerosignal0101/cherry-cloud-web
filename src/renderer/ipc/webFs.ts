import { AbsoluteFilePathSchema } from '@shared/types/file'
import { NOTES_ROOT_PATH } from '@shared/types/note'
import { createFilePathHandle } from '@shared/utils/file'

import { ipcApi } from './ipcApi'

/**
 * Browser implementation of the legacy `window.api.fs` read surface.
 *
 * Desktop code read files straight from the host. In the web build there are
 * three sanctioned sources:
 * - `/media/:id` for uploaded file entries (session-cookie authenticated);
 * - the logical `/notes` namespace;
 * - server paths served by the `file.read` route (uploads, workspaces, skills).
 *
 * Anything else is rejected rather than falling back to a host filesystem call.
 */
function isNotesPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/')
  return normalized === NOTES_ROOT_PATH || normalized.startsWith(`${NOTES_ROOT_PATH}/`)
}

function sameOriginMediaUrl(path: string): string | null {
  try {
    const url = new URL(path, window.location.origin)
    return url.origin === window.location.origin && url.pathname.startsWith('/media/') ? url.href : null
  } catch {
    return null
  }
}

async function readBytes(path: string): Promise<Uint8Array> {
  const mediaUrl = sameOriginMediaUrl(path)
  if (mediaUrl) {
    const response = await fetch(mediaUrl, { credentials: 'same-origin' })
    if (!response.ok) throw new Error(`Failed to read media ${path}: HTTP ${response.status}`)
    return new Uint8Array(await response.arrayBuffer())
  }

  if (isNotesPath(path)) {
    const { content } = await ipcApi.request('notes.read', { path })
    return new TextEncoder().encode(content)
  }

  const { content } = await ipcApi.request('file.read', {
    handle: createFilePathHandle(AbsoluteFilePathSchema.parse(path)),
    options: { mode: 'full', encoding: 'binary' }
  })
  return content
}

function decode(bytes: Uint8Array, encoding: string): string {
  try {
    return new TextDecoder(encoding).decode(bytes)
  } catch {
    // Unknown label: the callers that pass an encoding only ever ask for UTF-8.
    return new TextDecoder().decode(bytes)
  }
}

export const fsApi = {
  /** Node-style read: encoding present → text, otherwise bytes. */
  async read(path: string, encoding?: string): Promise<string | Uint8Array> {
    const bytes = await readBytes(path)
    return encoding ? decode(bytes, encoding) : bytes
  },
  async readText(path: string): Promise<string> {
    return decode(await readBytes(path), 'utf-8')
  }
}
