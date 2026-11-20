import path from 'node:path'

import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'

import type { FileNamespace } from '../notes/routes'

const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/

/**
 * Logical `/workspaces/<id>` view over the Agent workspace rows.
 *
 * Browser responses never carry the physical workspace directory (see the
 * DataApi sanitizer), and the file primitives still speak host paths. This
 * namespace resolves the row id back to its directory and rewrites snapshots,
 * edits and observation events the same way `/notes` and `/skills` do.
 */
export class AgentWorkspaceNamespace implements FileNamespace {
  readonly logicalRoot = '/workspaces'

  constructor(readonly physicalRoot: string) {}

  isNamespace(logicalPath: string): boolean {
    const normalized = toPosix(logicalPath)
    if (!normalized.startsWith('/workspaces/')) return false
    const id = normalized.slice('/workspaces/'.length).split('/')[0]
    return WORKSPACE_ID_PATTERN.test(id)
  }

  physicalPath(logicalPath: string): string {
    const normalized = toPosix(logicalPath)
    if (!this.isNamespace(normalized)) throw new Error(`Not an agent workspace path: ${logicalPath}`)
    const [id, ...segments] = normalized.slice('/workspaces/'.length).split('/')
    const workspace = agentWorkspaceService.getById(id, { includeSystem: true })
    const root = path.resolve(workspace.path)
    const relative = segments.filter(Boolean).join('/')
    if (relative.includes('\0') || relative.includes('\\')) throw new Error('Invalid workspace path')
    const target = relative ? path.resolve(root, relative) : root
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
      throw new Error('Workspace path escapes its root')
    }
    return target
  }

  logicalPath(physicalPath: string): string {
    const target = path.resolve(physicalPath)
    const workspace = agentWorkspaceService
      .list({ includeSystem: true })
      .filter((candidate) => {
        const root = path.resolve(candidate.path)
        return target === root || target.startsWith(`${root}${path.sep}`)
      })
      .sort((left, right) => right.path.length - left.path.length)[0]
    if (!workspace) throw new Error(`Path is outside every agent workspace: ${physicalPath}`)
    const suffix = target.slice(path.resolve(workspace.path).length)
    return `/workspaces/${workspace.id}${toPosix(suffix)}`
  }
}

function toPosix(value: string): string {
  return value.replace(/\\/g, '/')
}
