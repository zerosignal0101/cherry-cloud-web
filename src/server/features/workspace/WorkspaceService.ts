import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { mkdir, readFile, readdir, realpath, rm, rmdir, stat, lstat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { WorkspaceEntry, WorkspaceSummary } from '@shared/ipc/schemas/workspace'

const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/
const METADATA_FILE = 'workspace.json'
const MAX_FILE_BYTES = 1_000_000
const MAX_DEPTH = 32

interface WorkspaceMetadata {
  id: string
  name: string
  createdAt: number
}

/**
 * The single server-owned filesystem sandbox for feature data.
 *
 * Notes, agent workspaces and code workspaces all get a directory under
 * `DATA_DIR/workspaces`. Requests carry a workspace id and a relative path;
 * absolute paths and host layout never cross the transport. Symlinked
 * components are rejected instead of followed, so a workspace cannot be used
 * to escape the root even by someone who can write inside it.
 */
export class WorkspaceService {
  constructor(private readonly root: string) {
    mkdirSync(root, { recursive: true, mode: 0o700 })
  }

  async list(): Promise<WorkspaceSummary[]> {
    const entries = await readdir(this.root, { withFileTypes: true })
    const summaries: WorkspaceSummary[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !WORKSPACE_ID_PATTERN.test(entry.name)) continue
      const workspaceRoot = path.join(this.root, entry.name)
      try {
        const info = await stat(workspaceRoot)
        const metadata = await this.readMetadata(workspaceRoot, entry.name)
        summaries.push({
          id: metadata.id,
          name: metadata.name,
          createdAt: metadata.createdAt,
          updatedAt: Math.round(info.mtimeMs)
        })
      } catch {
        // A concurrently deleted or unreadable directory is not a workspace response.
      }
    }
    return summaries.sort((left, right) => left.createdAt - right.createdAt)
  }

  async create(name: string): Promise<WorkspaceSummary> {
    const id = randomUUID()
    const workspaceRoot = this.workspaceRoot(id)
    await mkdir(workspaceRoot, { mode: 0o700 })
    const createdAt = Date.now()
    await writeFile(path.join(workspaceRoot, METADATA_FILE), JSON.stringify({ id, name, createdAt }), {
      encoding: 'utf8',
      mode: 0o600
    })
    return { id, name, createdAt, updatedAt: createdAt }
  }

  /**
   * Idempotently create a workspace with a fixed id. Used for server-owned
   * feature roots (the code-CLI config workspace) that must exist before the
   * first user request but should not be recreated or renamed on restart.
   */
  async ensure(id: string, name: string): Promise<WorkspaceSummary> {
    const workspaceRoot = this.workspaceRoot(id)
    try {
      const info = await lstat(workspaceRoot)
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new Error(`Unknown workspace: ${id}`)
      }
    } catch (error) {
      if (!isNotFound(error)) throw error
      await mkdir(workspaceRoot, { mode: 0o700 })
    }

    const metadataPath = path.join(workspaceRoot, METADATA_FILE)
    try {
      const metadataInfo = await lstat(metadataPath)
      if (metadataInfo.isSymbolicLink() || !metadataInfo.isFile()) {
        throw new Error(`Invalid workspace metadata: ${id}`)
      }
    } catch (error) {
      if (!isNotFound(error)) throw error
      const createdAt = Date.now()
      await writeFile(metadataPath, JSON.stringify({ id, name, createdAt }), {
        encoding: 'utf8',
        mode: 0o600
      })
    }
    const info = await stat(workspaceRoot)
    const metadata = await this.readMetadata(workspaceRoot, id)
    return { id: metadata.id, name: metadata.name, createdAt: metadata.createdAt, updatedAt: Math.round(info.mtimeMs) }
  }

  async delete(id: string): Promise<void> {
    const workspaceRoot = await this.assertWorkspaceRoot(id)
    await rmDirectory(workspaceRoot)
  }

  /** Host path for a created workspace. Internal call sites only. */
  pathFor(id: string): string {
    return this.workspaceRoot(id)
  }

  async exists(id: string): Promise<boolean> {
    try {
      const info = await lstat(this.workspaceRoot(id))
      return info.isDirectory() && !info.isSymbolicLink()
    } catch {
      return false
    }
  }

  async listFiles(id: string, relativePath = ''): Promise<WorkspaceEntry[]> {
    const workspaceRoot = await this.assertWorkspaceRoot(id)
    const target = this.resolvePath(workspaceRoot, relativePath)
    await this.assertNoSymlink(workspaceRoot, target)
    const info = await stat(target)
    if (!info.isDirectory()) throw new Error('Workspace path is not a directory')

    const entries = await readdir(target, { withFileTypes: true })
    const result: WorkspaceEntry[] = []
    for (const entry of entries) {
      if (relativePath === '' && entry.name === METADATA_FILE) continue
      if (entry.isSymbolicLink()) continue
      const absolute = path.join(target, entry.name)
      const entryInfo = await lstat(absolute)
      const kind = entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : undefined
      if (!kind) continue
      result.push({
        path: toPosix(relativePath ? `${relativePath}/${entry.name}` : entry.name),
        name: entry.name,
        kind,
        size: kind === 'file' ? entryInfo.size : 0,
        updatedAt: Math.round(entryInfo.mtimeMs)
      })
    }
    return result.sort((left, right) =>
      left.kind === right.kind ? left.name.localeCompare(right.name) : left.kind === 'directory' ? -1 : 1
    )
  }

  async readFile(id: string, relativePath: string): Promise<{ content: string; size: number; updatedAt: number }> {
    const workspaceRoot = await this.assertWorkspaceRoot(id)
    const target = this.resolvePath(workspaceRoot, relativePath)
    await this.assertNoSymlink(workspaceRoot, target)
    const info = await lstat(target)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Workspace path is not a regular file')
    if (info.size > MAX_FILE_BYTES) throw new Error(`File exceeds the ${MAX_FILE_BYTES}-byte workspace limit`)
    const buffer = await readFile(target)
    if (buffer.includes(0)) throw new Error('Binary files cannot be read as text')
    return { content: buffer.toString('utf8'), size: info.size, updatedAt: Math.round(info.mtimeMs) }
  }

  async writeFile(id: string, relativePath: string, content: string): Promise<{ size: number; updatedAt: number }> {
    const workspaceRoot = await this.assertWorkspaceRoot(id)
    const target = this.resolvePath(workspaceRoot, relativePath)
    const size = Buffer.byteLength(content, 'utf8')
    if (size > MAX_FILE_BYTES) throw new Error(`File exceeds the ${MAX_FILE_BYTES}-byte workspace limit`)

    const parent = path.dirname(target)
    await this.ensureParent(workspaceRoot, parent)
    await this.assertNoSymlink(workspaceRoot, target)
    try {
      const existing = await lstat(target)
      if (existing.isSymbolicLink()) throw new Error('Workspace path contains a symbolic link')
      if (existing.isDirectory()) throw new Error('Workspace path is a directory')
    } catch (error) {
      if (!isNotFound(error)) throw error
    }
    await writeFile(target, content, { encoding: 'utf8', mode: 0o600 })
    const info = await stat(target)
    return { size: info.size, updatedAt: Math.round(info.mtimeMs) }
  }

  async deleteFile(id: string, relativePath: string): Promise<void> {
    const workspaceRoot = await this.assertWorkspaceRoot(id)
    const target = this.resolvePath(workspaceRoot, relativePath)
    await this.assertNoSymlink(workspaceRoot, target)
    const info = await lstat(target)
    if (info.isDirectory()) {
      await rmdir(target)
      return
    }
    await unlink(target)
  }

  private workspaceRoot(id: string): string {
    if (!WORKSPACE_ID_PATTERN.test(id)) throw new Error(`Invalid workspace id: ${id}`)
    const candidate = path.resolve(this.root, id)
    if (path.dirname(candidate) !== path.resolve(this.root)) throw new Error(`Invalid workspace id: ${id}`)
    return candidate
  }

  private async assertWorkspaceRoot(id: string): Promise<string> {
    const workspaceRoot = this.workspaceRoot(id)
    const info = await lstat(workspaceRoot)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Unknown workspace: ${id}`)
    return workspaceRoot
  }

  private resolvePath(workspaceRoot: string, relativePath: string): string {
    const normalized = normalizeRelativePath(relativePath)
    const target = path.resolve(workspaceRoot, normalized)
    if (target !== workspaceRoot && !target.startsWith(`${workspaceRoot}${path.sep}`)) {
      throw new Error('Workspace path escapes its root')
    }
    return target
  }

  private async ensureParent(workspaceRoot: string, parent: string): Promise<void> {
    if (parent !== workspaceRoot && !parent.startsWith(`${workspaceRoot}${path.sep}`)) {
      throw new Error('Workspace path escapes its root')
    }
    await this.assertNoSymlink(workspaceRoot, parent)
    await mkdir(parent, { recursive: true, mode: 0o700 })
    await this.assertNoSymlink(workspaceRoot, parent)
  }

  /**
   * Reject any symlink on the way to `target` and verify the nearest existing
   * ancestor's real path stays inside the workspace. The final component may not
   * exist yet (writes create it), so the check stops at the first ENOENT.
   */
  private async assertNoSymlink(workspaceRoot: string, target: string): Promise<void> {
    const relative = path.relative(workspaceRoot, target)
    let current = workspaceRoot
    for (const segment of relative ? relative.split(path.sep) : []) {
      current = path.join(current, segment)
      let info
      try {
        info = await lstat(current)
      } catch (error) {
        if (isNotFound(error)) break
        throw error
      }
      if (info.isSymbolicLink()) throw new Error(`Workspace path contains a symbolic link: ${segment}`)
    }

    const realRoot = await realpath(workspaceRoot)
    let existing = target
    while (true) {
      try {
        const realExisting = await realpath(existing)
        if (realExisting !== realRoot && !realExisting.startsWith(`${realRoot}${path.sep}`)) {
          throw new Error('Workspace path resolves outside its root')
        }
        return
      } catch (error) {
        if (!isNotFound(error) && !isNotDirectory(error)) throw error
        const parent = path.dirname(existing)
        if (parent === existing) return
        existing = parent
      }
    }
  }

  private async readMetadata(workspaceRoot: string, fallbackId: string): Promise<WorkspaceMetadata> {
    const info = await stat(workspaceRoot)
    try {
      const parsed = JSON.parse(
        await readFile(path.join(workspaceRoot, METADATA_FILE), 'utf8')
      ) as Partial<WorkspaceMetadata>
      if (typeof parsed.name === 'string' && parsed.name.trim() && typeof parsed.createdAt === 'number') {
        return { id: fallbackId, name: parsed.name.trim(), createdAt: parsed.createdAt }
      }
    } catch {
      // A missing or hand-edited metadata file falls back to the directory id.
    }
    return { id: fallbackId, name: fallbackId, createdAt: Math.round(info.birthtimeMs || info.mtimeMs) }
  }
}

function normalizeRelativePath(raw: string): string {
  if (raw === '') return ''
  if (raw.includes('\0') || raw.includes('\\')) throw new Error('Invalid workspace path')
  const segments = raw.split('/')
  if (segments.length > MAX_DEPTH) throw new Error('Workspace path is too deep')
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..') throw new Error('Invalid workspace path')
  }
  return segments.join(path.sep)
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/')
}

async function rmDirectory(target: string): Promise<void> {
  await rm(target, { recursive: true, force: true })
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

function isNotDirectory(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOTDIR'
}
