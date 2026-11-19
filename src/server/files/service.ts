import { fileEntryService } from '@data/services/FileEntryService'
import { fileRefService } from '@data/services/FileRefService'
import { danglingCache } from '@main/services/file/danglingCache'
import type { FileManagerDeps } from '@main/services/file/internal/deps'
import { createInternal } from '@main/services/file/internal/entry/create'
import { createVersionCacheImpl } from '@main/services/file/versionCache'
import type { CleanupPolicy, FileEntry, FileEntryId } from '@shared/data/types/file'
import { KeyedMutex } from '@shared/utils/async'

/**
 * Server-side file storage.
 *
 * The browser has no filesystem, so the only creation surface the web build needs
 * is `createInternal` — an entry whose bytes Cherry owns under `DATA_DIR/files`,
 * written atomically by upstream's implementation. Reaching under the file
 * module's private `internal/*` door is deliberate: `FileManager` itself is a
 * lifecycle service whose `onInit` registers IPC handlers and a cleanup job
 * against services this process does not run, and the barrel does not expose the
 * bytes-creation primitive. If upstream ever exports it, switch to the barrel.
 */

/** Mirrors the dependency bundle `FileManager` builds, minus the per-instance state it owns. */
const deps: FileManagerDeps = {
  fileEntryService,
  fileRefService,
  danglingCache,
  versionCache: createVersionCacheImpl(2000),
  contentWriteLock: new KeyedMutex()
}

/** One upload request carries one file; attachments in a message are separate requests. */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024

const MAX_NAME_LENGTH = 200

export interface UploadedFile {
  /** Original filename as sent by the browser; used only to derive display name and extension. */
  filename: string
  data: Uint8Array
}

/**
 * Split a browser-supplied filename into the entry's display name and extension.
 * Path separators never survive (the browser may send a full path), and the name
 * is capped so a hostile header cannot bloat the row.
 */
export function splitFilename(filename: string): { name: string; ext: string | null } {
  // eslint-disable-next-line no-control-regex -- stripping control bytes is the point: they must not reach the DB or a header
  const base = (filename.split(/[\\/]/).pop() ?? filename).replace(/[\u0000-\u001f]/g, '').trim()
  const dot = base.lastIndexOf('.')
  if (dot <= 0) {
    return { name: (base || 'file').slice(0, MAX_NAME_LENGTH), ext: null }
  }
  return {
    name: base.slice(0, dot).slice(0, MAX_NAME_LENGTH) || 'file',
    ext: base.slice(dot + 1).toLowerCase() || null
  }
}

export async function storeUploadedFile(
  upload: UploadedFile,
  cleanupPolicy: CleanupPolicy = 'delete_when_unreferenced'
): Promise<FileEntry> {
  const { name, ext } = splitFilename(upload.filename)
  return createInternal(deps, {
    source: 'bytes',
    data: upload.data,
    name,
    ext,
    cleanupPolicy
  })
}

export function findFileEntry(id: FileEntryId): FileEntry | null {
  return fileEntryService.findById(id)
}
