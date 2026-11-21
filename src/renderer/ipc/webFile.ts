import type { FileHandle } from '@shared/data/types/file'
import type { CreateInternalEntryInput } from '@shared/ipc/schemas/file'
import { NOTES_ROOT_PATH } from '@shared/types/note'
import { getFileTypeByExt } from '@shared/utils/file'

import { ipcApi } from './ipcApi'

/**
 * Browser implementation of the legacy `window.api.file` surface.
 *
 * The desktop preload handed the renderer real filesystem paths and let it ask
 * the main process to read/write them. A browser has no filesystem: the only
 * sanctioned route is `POST /api/files`, which stores the bytes under
 * `DATA_DIR/files` and returns an entry the renderer can reference by
 * `/media/:id`. This adapter therefore:
 *
 * - implements the operations that map cleanly onto that model (upload,
 *   metadata/file-entry RPCs, browser downloads);
 * - returns no path from `getPathForFile` — callers must use the browser
 *   `File`/`Blob` they already have (see the composer attachment flows);
 * - throws a descriptive error for path-based mutations, so a missed page
 *   fails loudly instead of silently touching the wrong thing.
 */

export interface UploadedFileEntry {
  id: string
  name: string
  ext: string | null
  size: number | null
  mime: string
  url: string
}

export interface UploadedFileMetadata {
  id: string
  name: string
  origin_name: string
  /** Same-origin media URL, used for previews and as an opaque path stand-in. */
  path: string
  size: number
  /** Extension including the leading dot, matching `FileMetadata.ext`. */
  ext: string
  type: ReturnType<typeof getFileTypeByExt>
  created_at: string
  count: number
  /** The picked bytes, so composer attachments can be sent without re-reading a path. */
  blob: File
}

const UNSUPPORTED = (method: string): never => {
  throw new Error(`window.api.file.${method} is not available in the web build`)
}

/**
 * Notes are the one path-shaped surface the browser may address. Everything
 * under the server's logical `/notes` namespace goes to the sandboxed notes
 * RPCs; any other path is rejected here instead of reaching host `fs` code.
 */
function notesPath(rawPath: string): string {
  const normalized = rawPath.replace(/\\/g, '/')
  if (!isNotesPath(normalized)) {
    throw new Error(`window.api.file received a non-notes path: ${rawPath}`)
  }
  return normalized
}

function isNotesPath(rawPath: string): boolean {
  const normalized = rawPath.replace(/\\/g, '/')
  return normalized === NOTES_ROOT_PATH || normalized.startsWith(`${NOTES_ROOT_PATH}/`)
}

function splitName(filename: string): { name: string; ext: string | null } {
  const base = (filename.split(/[\\/]/).pop() ?? filename).trim() || 'file'
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return { name: base, ext: null }
  return { name: base.slice(0, dot), ext: base.slice(dot + 1).toLowerCase() || null }
}

/** Upload one browser `File`/`Blob` through the only write surface the server exposes. */
export async function uploadFile(file: Blob, filename: string): Promise<UploadedFileEntry> {
  const body = new FormData()
  body.append('file', file, filename)
  const response = await fetch('/api/files', { method: 'POST', body, credentials: 'same-origin' })
  if (!response.ok) {
    throw new Error(`Upload failed (HTTP ${response.status})`)
  }
  return (await response.json()) as UploadedFileEntry
}

function toUploadedMetadata(uploaded: UploadedFileEntry, file: File): UploadedFileMetadata {
  return {
    id: uploaded.id,
    name: uploaded.name || splitName(file.name).name,
    origin_name: file.name || uploaded.name,
    // `/media/:id` passes the absolute-path shape check and is what the renderer
    // can actually display; it is never handed to server-side `fs` code.
    path: uploaded.url,
    size: uploaded.size ?? file.size,
    ext: uploaded.ext ? `.${uploaded.ext}` : splitName(file.name).ext ? `.${splitName(file.name).ext}` : '',
    type: getFileTypeByExt(uploaded.ext ?? splitName(file.name).ext ?? ''),
    created_at: new Date().toISOString(),
    count: 1,
    blob: file
  }
}

/**
 * Open the platform picker without a dialog bridge. Resolves with the chosen
 * files (empty on cancel); the caller decides what to upload.
 */
export function pickBrowserFiles(options?: { accept?: string; multiple?: boolean }): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = options?.multiple ?? true
    if (options?.accept) input.accept = options.accept
    input.style.display = 'none'
    document.body.appendChild(input)

    let settled = false
    const finish = (files: File[]) => {
      if (settled) return
      settled = true
      input.remove()
      resolve(files)
    }

    input.addEventListener('change', () => finish(Array.from(input.files ?? [])))
    // `cancel` is supported by current browsers; the focus fallback covers the rest.
    input.addEventListener('cancel', () => finish([]))
    window.addEventListener(
      'focus',
      () => {
        // The change event fires before focus returns when a file was chosen.
        setTimeout(() => {
          if (!input.files || input.files.length === 0) finish([])
        }, 300)
      },
      { once: true }
    )

    input.click()
  })
}

function downloadFile(filename: string, content: string | Uint8Array | Blob): string {
  const blob =
    content instanceof Blob
      ? content
      : content instanceof Uint8Array
        ? new Blob([content as BlobPart])
        : new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Revoke on the next task so the browser has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 0)
  return filename
}

function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',')
  const header = comma >= 0 ? dataUrl.slice(0, comma) : ''
  const payload = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
  const mime = /data:([^;,]+)/.exec(header)?.[1] ?? 'application/octet-stream'
  if (/;base64/i.test(header)) {
    const binary = atob(payload)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return new Blob([bytes], { type: mime })
  }
  return new Blob([decodeURIComponent(payload)], { type: mime })
}

export const fileApi = {
  /** Browsers never expose a filesystem path; path-based flows must use the `File` itself. */
  getPathForFile: (_file: File): string => '',

  /**
   * Desktop signature: `(options) => FileMetadata[]`. The browser picker returns
   * the chosen bytes and then uploads them, so downstream code gets a real
   * entry id plus the `blob` needed to send it.
   */
  async select(options?: { filters?: Array<{ name: string; extensions: string[] }> }): Promise<UploadedFileMetadata[]> {
    const extensions = (options?.filters ?? []).flatMap((filter) =>
      filter.extensions.filter((ext) => ext && ext !== '*').map((ext) => `.${ext.replace(/^\./, '')}`)
    )
    const files = await pickBrowserFiles({
      multiple: true,
      accept: extensions.length > 0 ? extensions.join(',') : undefined
    })
    return Promise.all(files.map(async (file) => toUploadedMetadata(await uploadFile(file, file.name), file)))
  },

  selectFolder: async (): Promise<null> => UNSUPPORTED('selectFolder'),

  /** Legacy signature: `save(name, content, options)`. Triggers a browser download. */
  async save(filename: string, content: string | Uint8Array | Blob): Promise<string> {
    return downloadFile(filename, content)
  },

  /** Legacy signature: `saveImage(name, dataUrl)`. */
  async saveImage(filename: string, dataUrl: string): Promise<string> {
    return downloadFile(filename, dataUrlToBlob(dataUrl))
  },

  /** Create a FileEntry from bytes (send-time attachment bridge). */
  async createInternalEntry(params: {
    source: 'bytes' | 'base64' | 'path'
    data?: Uint8Array | string
    path?: string
    name?: string
    ext?: string | null
  }): Promise<{ id: string; name: string; ext: string | null; size: number | null }> {
    if (params.source === 'path') {
      return UNSUPPORTED('createInternalEntry(source: path)')
    }
    let bytes: Blob
    if (params.source === 'base64') {
      bytes = dataUrlToBlob(`data:application/octet-stream;base64,${String(params.data ?? '')}`)
    } else {
      bytes = new Blob([params.data as BlobPart])
    }
    const filename = params.ext ? `${params.name ?? 'file'}.${params.ext}` : (params.name ?? 'file')
    const uploaded = await uploadFile(bytes, filename)
    return { id: uploaded.id, name: uploaded.name, ext: uploaded.ext, size: uploaded.size }
  },

  getMetadata: (handle: FileHandle) => ipcApi.request('file.get_metadata', handle),
  batchGetMetadata: (items: Array<{ key: string; handle: FileHandle }>) =>
    ipcApi.request('file.batch_get_metadata', { items }),
  async getPhysicalPath({ id }: { id: string }): Promise<string> {
    const paths = (await ipcApi.request('file.batch_get_physical_paths', { ids: [id] })) as Record<string, string>
    const path = paths?.[id]
    if (!path) throw new Error(`No physical path for file entry ${id}`)
    return path
  },
  batchGetPhysicalPaths: (ids: string[]) => ipcApi.request('file.batch_get_physical_paths', { ids }),
  batchGetDanglingStates: (ids: string[]) => ipcApi.request('file.batch_get_dangling_states', { ids }),
  batchCreateInternalEntries: (items: CreateInternalEntryInput[]) =>
    ipcApi.request('file.batch_create_internal_entries', { items }),
  batchTrash: (ids: string[]) => ipcApi.request('file.batch_trash', { ids }),
  batchRestore: (ids: string[]) => ipcApi.request('file.batch_restore', { ids }),
  batchPermanentDeleteFromTrash: (ids: string[]) => ipcApi.request('file.batch_permanent_delete_from_trash', { ids }),
  batchRemoveFromLibrary: (ids: string[]) => ipcApi.request('file.batch_remove_from_library', { ids }),
  /**
   * The desktop preload exposed both `file.rename` (FileEntry id) and the notes
   * path rename under the same name. The first argument disambiguates: the
   * virtual notes namespace goes to the sandboxed notes route.
   */
  rename: (idOrPath: string, newName: string) =>
    isNotesPath(idOrPath)
      ? ipcApi.request('notes.rename', { path: notesPath(idOrPath), newName })
      : ipcApi.request('file.rename', { id: idOrPath, newName }),

  /** Path-based reads/writes target the server-owned notes sandbox. */
  get: async (): Promise<null> => null,
  createTempFile: async (): Promise<string> => UNSUPPORTED('createTempFile'),
  write: async (path: string, content: string): Promise<void> => {
    await ipcApi.request('notes.write', { path: notesPath(path), content })
  },
  readExternal: async (path: string): Promise<string> => {
    const result = await ipcApi.request('notes.read', { path: notesPath(path) })
    return result.content
  },
  checkFileName: (parentPath: string, name: string, isFile: boolean) =>
    ipcApi.request('notes.check_name', { parentPath: notesPath(parentPath), name, isFile }),
  mkdir: async (path: string): Promise<void> => {
    await ipcApi.request('notes.mkdir', { path: notesPath(path) })
  },
  move: async (fromPath: string, toPath: string): Promise<void> => {
    await ipcApi.request('notes.move', { fromPath: notesPath(fromPath), toPath: notesPath(toPath) })
  },
  moveDir: async (fromPath: string, toPath: string): Promise<void> => {
    await ipcApi.request('notes.move', { fromPath: notesPath(fromPath), toPath: notesPath(toPath) })
  },
  renameDir: (path: string, newName: string) => ipcApi.request('notes.rename', { path: notesPath(path), newName }),
  listDirectory: async (path: string, options?: { recursive?: boolean }): Promise<string[]> => {
    const result = await ipcApi.request('notes.list', {
      path: notesPath(path),
      recursive: options?.recursive
    })
    return result.entries.map((entry) => entry.path)
  },
  listDirectoryEntries: async (): Promise<[]> => [],
  deleteExternalFile: async (path: string): Promise<void> => {
    await ipcApi.request('notes.delete', { path: notesPath(path), recursive: false })
  },
  deleteExternalDir: async (path: string): Promise<void> => {
    await ipcApi.request('notes.delete', { path: notesPath(path), recursive: true })
  },
  validateNotesDirectory: async (path: string): Promise<boolean> => {
    try {
      return await ipcApi.request('notes.validate_directory', { path: notesPath(path) })
    } catch {
      return false
    }
  },
  batchUploadMarkdown: async (): Promise<[]> => [],
  binaryImage: async (): Promise<never> => UNSUPPORTED('binaryImage'),
  /**
   * Desktop `file.open` presented a dialog and returned the chosen file's path
   * and bytes. Browsers only expose the bytes, so import flows read `content`
   * while `filePath` stays the display name. Returning `undefined` (the old
   * stub) made the import dialog sit on "selecting" forever.
   */
  async open(options?: {
    filters?: Array<{ name: string; extensions: string[] }>
  }): Promise<{ filePath: string; content: string } | undefined> {
    const extensions = (options?.filters ?? []).flatMap((filter) =>
      filter.extensions.filter((ext) => ext && ext !== '*').map((ext) => `.${ext.replace(/^\./, '')}`)
    )
    const [file] = await pickBrowserFiles({
      multiple: false,
      accept: extensions.length > 0 ? extensions.join(',') : undefined
    })
    if (!file) return undefined
    return { filePath: file.name, content: await file.text() }
  },
  showInFolder: async (): Promise<void> => undefined
}
