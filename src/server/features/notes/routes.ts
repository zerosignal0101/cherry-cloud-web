import { application } from '@application'
import { fileEntryService } from '@data/services/FileEntryService'
import { noteService } from '@data/services/NoteService'
import { fileHandlers } from '@main/ipc/handlers/file'
import { fileObservationHandlers } from '@main/ipc/handlers/fileObservation'
import type { FileEntryId } from '@shared/data/types/file'
import { fileRequestSchemas } from '@shared/ipc/schemas/file'
import { fileObservationRequestSchemas } from '@shared/ipc/schemas/fileObservation'
import { notesRequestSchemas } from '@shared/ipc/schemas/notes'
import type { IpcHandlersFor } from '@shared/ipc/types'
import { IpcChannel } from '@shared/IpcChannel'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { NOTES_ROOT_PATH } from '@shared/types/note'
import type {
  CreateTreeIpcResult,
  SerializedTreeNode,
  TreeMutationEvent,
  TreeMutationPushPayload
} from '@shared/utils/file'

import type { RpcRegistry } from '../../transport/registry'
import type { NotesStorage } from './NotesStorage'

type NotesHandlers = IpcHandlersFor<typeof notesRequestSchemas>

/**
 * Imported Markdown from the desktop build points at `file://<host>/files/<id>.<ext>`.
 * When the entry is still in the file library, rewrite it to the authenticated
 * `/media/:id` route the browser can actually render.
 */
function rewriteLegacyImageLinks(content: string): string {
  return content.replace(/file:\/\/[^\s)"'<>]*\/files\/([0-9a-fA-F-]{36})(?:\.[A-Za-z0-9]+)?/g, (match, id: string) =>
    fileEntryService.findById(id as FileEntryId) ? `/media/${id}` : match
  )
}

const notesHandlers = (storage: NotesStorage): NotesHandlers => ({
  'notes.validate_directory': ({ path }) => storage.validateDirectory(path),
  'notes.check_name': ({ parentPath, name, isFile }) => storage.checkName(parentPath, name, isFile),
  'notes.mkdir': ({ path }) => storage.mkdir(path),
  'notes.write': ({ path, content }) => storage.write(path, rewriteLegacyImageLinks(content)),
  'notes.read': ({ path }) => storage.read(path),
  'notes.delete': async ({ path, recursive }) => {
    await storage.delete(path, recursive)
    noteService.deleteByPath({ rootPath: NOTES_ROOT_PATH, path, recursive })
  },
  'notes.rename': async ({ path, newName }) => {
    const renamed = await storage.rename(path, newName)
    noteService.rewritePath({
      rootPath: NOTES_ROOT_PATH,
      fromPath: path,
      toPath: renamed.path,
      recursive: true
    })
    return renamed
  },
  'notes.move': async ({ fromPath, toPath }) => {
    const moved = await storage.move(fromPath, toPath)
    noteService.rewritePath({ rootPath: NOTES_ROOT_PATH, fromPath, toPath: moved.path, recursive: true })
    return moved
  },
  'notes.list': async ({ path, recursive }) => ({ entries: await storage.list(path, recursive) }),
  'notes.search': async (input) => ({ results: await storage.search(input) })
})

export interface FileNamespace {
  readonly logicalRoot: string
  readonly physicalRoot: string
  isNamespace(logicalPath: string): boolean
  physicalPath(logicalPath: string): string
  logicalPath(physicalPath: string): string
}

function requireSender(senderId: string | null) {
  const webContents = senderId == null ? undefined : application.get('WindowManager').getWindow(senderId)?.webContents
  if (senderId == null || !webContents) throw new Error('File operation requires a connected tab')
  return { senderId, webContents }
}

interface SenderProxy {
  readonly id: string
  send(channel: string, ...args: unknown[]): void
  isDestroyed(): boolean
}

interface DirectoryTreeManagerLike {
  create(
    owner: { windowId: string; webContents: SenderProxy },
    rootPath: string,
    options: unknown,
    refresh?: boolean
  ): Promise<CreateTreeIpcResult>
}

function namespaceForPath(namespaces: readonly FileNamespace[], logicalPath: string): FileNamespace | undefined {
  return namespaces.find((namespace) => namespace.isNamespace(logicalPath))
}

function namespaceContainsPhysical(namespace: FileNamespace, physicalPath: string): boolean {
  return physicalPath === namespace.physicalRoot || physicalPath.startsWith(`${namespace.physicalRoot}${pathSep}`)
}

const pathSep = process.platform === 'win32' ? '\\' : '/'

function mapLogicalPath(namespaces: readonly FileNamespace[], physicalPath: string): string {
  const namespace = namespaces.find((candidate) => namespaceContainsPhysical(candidate, physicalPath))
  if (!namespace) throw new Error(`Path is outside the managed file namespaces: ${physicalPath}`)
  return namespace.logicalPath(physicalPath)
}

function mapSnapshot(node: SerializedTreeNode, namespaces: readonly FileNamespace[]): SerializedTreeNode {
  const mapped: SerializedTreeNode = {
    ...node,
    path: mapLogicalPath(namespaces, node.path)
  }
  if (node.children) {
    const children: Record<string, SerializedTreeNode> = Object.create(null)
    for (const [name, child] of Object.entries(node.children)) {
      children[name] = mapSnapshot(child, namespaces)
    }
    return { ...mapped, children }
  }
  return mapped
}

function mapEvent(event: TreeMutationEvent, namespaces: readonly FileNamespace[]): TreeMutationEvent {
  if (event.type === 'status') return event
  if (event.type === 'renamed') {
    return {
      ...event,
      oldPath: mapLogicalPath(namespaces, event.oldPath),
      newPath: mapLogicalPath(namespaces, event.newPath)
    }
  }
  if (event.type === 'added') {
    return {
      ...event,
      path: mapLogicalPath(namespaces, event.path),
      parentPath: mapLogicalPath(namespaces, event.parentPath)
    }
  }
  return { ...event, path: mapLogicalPath(namespaces, event.path) }
}

function mapPayload(payload: TreeMutationPushPayload, namespaces: readonly FileNamespace[]): TreeMutationPushPayload {
  return { ...payload, event: mapEvent(payload.event, namespaces) }
}

/**
 * `file.tree.*`, `file.edit.*` and `file.observe.*` predate the notes/skill
 * features and speak host paths. Their renderers keep using those primitives, so
 * this wrapper translates every managed logical namespace on the way in and
 * rewrites tree snapshots/mutations on the way out. Paths outside a namespace
 * are delegated to the upstream handler unchanged.
 */
function fileHandlersForNamespaces(namespaces: readonly FileNamespace[]): IpcHandlersFor<typeof fileRequestSchemas> {
  return {
    ...fileHandlers,
    'file.validate_notes_directory': async (path) => {
      const notes = namespaces.find((namespace) => namespace.logicalRoot === '/notes')
      return notes?.isNamespace(path) ? true : false
    },
    'file.tree.create': async (input, context) => {
      const namespace = namespaceForPath(namespaces, input.rootPath)
      if (!namespace) return fileHandlers['file.tree.create'](input, context)

      const { senderId, webContents } = requireSender(context.senderId)
      const proxy: SenderProxy = {
        id: webContents.id,
        isDestroyed: () => webContents.isDestroyed(),
        send: (channel, ...args) => {
          if (channel === IpcChannel.IpcApi_Event && args[0] === 'file.tree.mutation' && args[1]) {
            webContents.send(channel, args[0], mapPayload(args[1] as TreeMutationPushPayload, namespaces))
            return
          }
          webContents.send(channel, ...args)
        }
      }
      const manager = application.get('DirectoryTreeManager') as DirectoryTreeManagerLike
      const result = await manager.create(
        { windowId: senderId, webContents: proxy },
        namespace.physicalPath(input.rootPath),
        input.options,
        input.refresh
      )
      return { ...result, snapshot: mapSnapshot(result.snapshot, namespaces) }
    },
    'file.tree.rename': async (input, context) => {
      const namespace = namespaceForPath(namespaces, input.oldPath)
      if (!namespace) return fileHandlers['file.tree.rename'](input, context)
      return fileHandlers['file.tree.rename'](
        { ...input, oldPath: AbsoluteFilePathSchema.parse(namespace.physicalPath(input.oldPath)) },
        context
      )
    },
    'file.edit.open': async (input, context) => {
      if (input.handle.kind !== 'path') return fileHandlers['file.edit.open'](input, context)
      const namespace = namespaceForPath(namespaces, input.handle.path)
      if (!namespace) return fileHandlers['file.edit.open'](input, context)
      return fileHandlers['file.edit.open'](
        {
          handle: {
            kind: 'path',
            path: AbsoluteFilePathSchema.parse(namespace.physicalPath(input.handle.path))
          }
        },
        context
      )
    }
  }
}

const fileObservationHandlersForNamespaces = (
  namespaces: readonly FileNamespace[]
): IpcHandlersFor<typeof fileObservationRequestSchemas> => ({
  ...fileObservationHandlers,
  'file.observe.open': async (input, context) => {
    if (input.handle.kind !== 'path') return fileObservationHandlers['file.observe.open'](input, context)
    const namespace = namespaceForPath(namespaces, input.handle.path)
    if (!namespace) return fileObservationHandlers['file.observe.open'](input, context)
    return fileObservationHandlers['file.observe.open'](
      {
        handle: {
          kind: 'path',
          path: AbsoluteFilePathSchema.parse(namespace.physicalPath(input.handle.path))
        }
      },
      context
    )
  }
})

export interface NotesRouteOptions {
  storage: NotesStorage
  /** Additional managed trees (currently the Skill library) served by the same file primitives. */
  namespaces?: readonly FileNamespace[]
}

export function registerNotesRoutes(registry: RpcRegistry, options: NotesRouteOptions): void {
  const namespaces: readonly FileNamespace[] = [options.storage, ...(options.namespaces ?? [])]
  registry.register(notesRequestSchemas, notesHandlers(options.storage))
  registry.register(fileRequestSchemas, fileHandlersForNamespaces(namespaces))
  registry.register(fileObservationRequestSchemas, fileObservationHandlersForNamespaces(namespaces))
}
