import { mkdirSync } from 'node:fs'
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, rmdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { NotesEntry, NotesSearchMatch, NotesSearchResult } from '@shared/ipc/schemas/notes'
import { NOTES_ROOT_PATH } from '@shared/types/note'
import { sanitizeFilename } from '@shared/utils/file'

const MARKDOWN_EXT = '.md'
const MAX_NOTE_BYTES = 8 * 1024 * 1024
const MAX_DEPTH = 32
const MAX_SEARCH_FILES = 5000
const DEFAULT_MAX_MATCHES_PER_FILE = 50
const DEFAULT_CONTEXT_LENGTH = 50
const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024

export class NotesPathError extends Error {
  override readonly name = 'NotesPathError' as const
}

export interface NotesSearchOptions {
  keyword: string
  caseSensitive?: boolean
  useRegex?: boolean
  maxResults?: number
  maxFileSize?: number
  maxMatchesPerFile?: number
  contextLength?: number
}

interface SearchFile {
  logicalPath: string
  physicalPath: string
  name: string
  treePath: string
  createdAt: string
  updatedAt: string
  size: number
}

/**
 * Server storage for Markdown notes.
 *
 * The renderer addresses notes as `/notes/...`; this class resolves that logical
 * namespace to `DATA_DIR/notes` and is the only place that touches host paths.
 * Every operation rejects traversal, absolute escapes, NUL/backslashes and
 * symlinked components before it reaches the filesystem.
 */
export class NotesStorage {
  private readonly root: string
  private readonly realRootPromise: Promise<string>

  constructor(root: string) {
    this.root = path.resolve(root)
    mkdirSync(this.root, { recursive: true, mode: 0o700 })
    this.realRootPromise = realpath(this.root)
  }

  get physicalRoot(): string {
    return this.root
  }

  get logicalRoot(): string {
    return NOTES_ROOT_PATH
  }

  isNamespace(logicalPath: string): boolean {
    return logicalPath === NOTES_ROOT_PATH || logicalPath.startsWith(`${NOTES_ROOT_PATH}/`)
  }

  /** Map a logical `/notes/...` path to its host path. Internal call sites only. */
  physicalPath(logicalPath: string): string {
    return this.resolve(logicalPath)
  }

  /** Map a host path under the notes root back to the logical namespace. */
  logicalPath(physicalPath: string): string {
    return this.toLogical(physicalPath)
  }

  async validateDirectory(logicalPath: string): Promise<boolean> {
    try {
      const target = this.resolve(logicalPath)
      await this.assertNoSymlink(target)
      return (await lstat(target)).isDirectory()
    } catch {
      return false
    }
  }

  async checkName(
    parentPath: string,
    rawName: string,
    isFile: boolean
  ): Promise<{ safeName: string; exists: boolean }> {
    const parent = this.resolve(parentPath)
    await this.assertNoSymlink(parent)
    const parentInfo = await lstat(parent)
    if (!parentInfo.isDirectory()) throw new NotesPathError('Notes parent path is not a directory')

    const safeName = this.sanitizeName(rawName, isFile)
    const target = path.join(parent, isFile ? `${safeName}${MARKDOWN_EXT}` : safeName)
    return { safeName, exists: await this.exists(target) }
  }

  async mkdir(logicalPath: string): Promise<void> {
    const target = this.resolve(logicalPath)
    if (target === this.root) return
    const parent = path.dirname(target)
    await this.ensureDirectory(parent)
    await this.assertNoSymlink(target)
    try {
      const info = await lstat(target)
      if (!info.isDirectory()) throw new NotesPathError('Notes path already exists as a file')
      return
    } catch (error) {
      if (!isNotFound(error)) throw error
    }
    await mkdir(target, { mode: 0o700 })
  }

  async write(logicalPath: string, content: string): Promise<void> {
    const target = this.resolve(logicalPath)
    if (target === this.root) throw new NotesPathError('Cannot write the notes root')
    if (Buffer.byteLength(content, 'utf8') > MAX_NOTE_BYTES) {
      throw new NotesPathError(`Note exceeds the ${MAX_NOTE_BYTES}-byte limit`)
    }
    await this.ensureDirectory(path.dirname(target))
    await this.assertNoSymlink(target)
    try {
      const info = await lstat(target)
      if (info.isSymbolicLink()) throw new NotesPathError('Notes path contains a symbolic link')
      if (info.isDirectory()) throw new NotesPathError('Notes path is a directory')
    } catch (error) {
      if (!isNotFound(error)) throw error
    }
    await writeFile(target, content, { encoding: 'utf8', mode: 0o600 })
  }

  async read(logicalPath: string): Promise<{ content: string; updatedAt: number }> {
    const target = await this.resolveExisting(logicalPath)
    const info = await lstat(target)
    if (!info.isFile()) throw new NotesPathError('Notes path is not a file')
    if (info.size > MAX_NOTE_BYTES) throw new NotesPathError(`Note exceeds the ${MAX_NOTE_BYTES}-byte limit`)
    const buffer = await readFile(target)
    if (buffer.includes(0)) throw new NotesPathError('Binary files cannot be read as notes')
    return { content: buffer.toString('utf8'), updatedAt: Math.round(info.mtimeMs) }
  }

  async delete(logicalPath: string, recursive: boolean): Promise<void> {
    const target = this.resolve(logicalPath)
    if (target === this.root) throw new NotesPathError('Cannot delete the notes root')
    await this.assertNoSymlink(target)
    const info = await this.lstatOptional(target)
    if (!info) return
    if (info.isDirectory()) {
      if (recursive) await rm(target, { recursive: true, force: true })
      else await rmdir(target)
      return
    }
    await unlink(target)
  }

  async rename(logicalPath: string, newName: string): Promise<{ path: string; name: string }> {
    const source = await this.resolveExisting(logicalPath)
    if (source === this.root) throw new NotesPathError('Cannot rename the notes root')
    const info = await lstat(source)
    const safeName = this.sanitizeName(newName, info.isFile())
    const target = path.join(path.dirname(source), info.isFile() ? `${safeName}${MARKDOWN_EXT}` : safeName)
    if (target === source) return { path: this.toLogical(source), name: safeName }
    await this.assertNoSymlink(target)
    if (await this.exists(target)) throw new Error(`Target name already exists: ${safeName}`)
    await rename(source, target)
    return { path: this.toLogical(target), name: safeName }
  }

  async move(fromPath: string, toPath: string): Promise<{ path: string }> {
    const source = await this.resolveExisting(fromPath)
    const target = this.resolve(toPath)
    if (source === this.root) throw new NotesPathError('Cannot move the notes root')
    if (target === source) return { path: this.toLogical(source) }
    if (isInside(source, target)) throw new NotesPathError('Cannot move a folder into itself')

    const info = await lstat(source)
    await this.ensureDirectory(path.dirname(target))
    await this.assertNoSymlink(target)
    if (await this.exists(target)) throw new Error('Target path already exists')
    if (info.isDirectory() && (await this.exists(target))) throw new Error('Target directory already exists')
    await rename(source, target)
    return { path: this.toLogical(target) }
  }

  async list(logicalPath: string, recursive = false): Promise<NotesEntry[]> {
    const target = await this.resolveExisting(logicalPath)
    const info = await lstat(target)
    if (!info.isDirectory()) throw new NotesPathError('Notes path is not a directory')
    const entries: NotesEntry[] = []
    await this.collectEntries(target, entries, recursive, 0)
    return entries.sort((left, right) =>
      left.kind === right.kind ? left.name.localeCompare(right.name) : left.kind === 'directory' ? -1 : 1
    )
  }

  async search(options: NotesSearchOptions): Promise<NotesSearchResult[]> {
    const keyword = options.keyword.trim()
    if (!keyword) return []
    const caseSensitive = options.caseSensitive ?? false
    const maxMatchesPerFile = options.maxMatchesPerFile ?? DEFAULT_MAX_MATCHES_PER_FILE
    const contextLength = options.contextLength ?? DEFAULT_CONTEXT_LENGTH
    const maxResults = options.maxResults ?? 100
    const maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE

    let pattern: RegExp | null = null
    try {
      pattern = options.useRegex
        ? new RegExp(keyword, caseSensitive ? 'g' : 'gi')
        : new RegExp(escapeRegex(keyword), caseSensitive ? 'g' : 'gi')
    } catch {
      // An invalid regular expression cannot match content; filename matching still applies.
    }

    const files: SearchFile[] = []
    await this.collectSearchFiles(this.root, files, maxFileSize)
    const needle = caseSensitive ? keyword : keyword.toLowerCase()
    const results: NotesSearchResult[] = []

    for (const file of files) {
      if (results.length >= maxResults * 4) break
      const name = caseSensitive ? file.name : file.name.toLowerCase()
      const nameMatch = name.includes(needle)
      let matches: NotesSearchMatch[] = []
      if (pattern) {
        try {
          const content = await readFile(file.physicalPath, 'utf8')
          matches = findMatches(content, pattern, maxMatchesPerFile, contextLength)
        } catch {
          matches = []
        }
      }
      if (!nameMatch && matches.length === 0) continue
      const score =
        (name === needle ? 200 : nameMatch ? 100 : 0) + Math.min(matches.length * 2, 50) + recencyScore(file.updatedAt)
      results.push({
        path: file.logicalPath,
        name: file.name,
        treePath: file.treePath,
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
        matchType: nameMatch && matches.length > 0 ? 'both' : nameMatch ? 'filename' : 'content',
        matches,
        score
      })
    }

    return results.sort((left, right) => right.score - left.score).slice(0, maxResults)
  }

  private async collectEntries(
    directory: string,
    entries: NotesEntry[],
    recursive: boolean,
    depth: number
  ): Promise<void> {
    if (depth > MAX_DEPTH) return
    const children = await readdir(directory, { withFileTypes: true })
    for (const child of children) {
      if (child.isSymbolicLink()) continue
      if (child.name.startsWith('.')) continue
      const absolute = path.join(directory, child.name)
      const info = await lstat(absolute)
      const kind = child.isDirectory() ? 'directory' : child.isFile() ? 'file' : undefined
      if (!kind) continue
      entries.push({
        path: this.toLogical(absolute),
        name: kind === 'file' ? stripMarkdownExt(child.name) : child.name,
        kind,
        size: kind === 'file' ? info.size : 0,
        updatedAt: Math.round(info.mtimeMs)
      })
      if (recursive && kind === 'directory') await this.collectEntries(absolute, entries, true, depth + 1)
    }
  }

  private async collectSearchFiles(directory: string, files: SearchFile[], maxFileSize: number): Promise<void> {
    if (files.length >= MAX_SEARCH_FILES) return
    const children = await readdir(directory, { withFileTypes: true })
    for (const child of children) {
      if (files.length >= MAX_SEARCH_FILES) return
      if (child.isSymbolicLink() || child.name.startsWith('.')) continue
      const absolute = path.join(directory, child.name)
      if (child.isDirectory()) {
        await this.collectSearchFiles(absolute, files, maxFileSize)
        continue
      }
      if (!child.isFile() || !child.name.toLowerCase().endsWith(MARKDOWN_EXT)) continue
      const info = await lstat(absolute)
      if (info.size > maxFileSize) continue
      const relative = this.toLogical(absolute).slice(NOTES_ROOT_PATH.length + 1)
      const name = stripMarkdownExt(child.name)
      files.push({
        logicalPath: this.toLogical(absolute),
        physicalPath: absolute,
        name,
        treePath: `/${stripMarkdownExt(relative)}`,
        createdAt: new Date(info.birthtimeMs || info.mtimeMs).toISOString(),
        updatedAt: new Date(info.mtimeMs).toISOString(),
        size: info.size
      })
    }
  }

  private resolve(logicalPath: string): string {
    const normalized = this.normalizeLogical(logicalPath)
    const relative = normalized === NOTES_ROOT_PATH ? '' : normalized.slice(NOTES_ROOT_PATH.length + 1)
    const segments = relative ? relative.split('/') : []
    if (segments.length > MAX_DEPTH) throw new NotesPathError('Notes path is too deep')
    const target = path.resolve(this.root, ...segments)
    if (target !== this.root && !target.startsWith(`${this.root}${path.sep}`)) {
      throw new NotesPathError('Notes path escapes its root')
    }
    return target
  }

  private async resolveExisting(logicalPath: string): Promise<string> {
    const target = this.resolve(logicalPath)
    await this.assertNoSymlink(target)
    const info = await this.lstatOptional(target)
    if (!info) throw new NotesPathError(`Notes path does not exist: ${logicalPath}`)
    return target
  }

  private normalizeLogical(value: string): string {
    if (value.includes('\0') || value.includes('\\')) throw new NotesPathError('Invalid notes path')
    const normalized = value.length > 1 ? value.replace(/\/+$/, '') : value
    if (normalized !== NOTES_ROOT_PATH && !normalized.startsWith(`${NOTES_ROOT_PATH}/`)) {
      throw new NotesPathError(`Notes paths must start with ${NOTES_ROOT_PATH}`)
    }
    const relative = normalized === NOTES_ROOT_PATH ? '' : normalized.slice(NOTES_ROOT_PATH.length + 1)
    if (!relative) return normalized
    const segments = relative.split('/')
    if (segments.length > MAX_DEPTH) throw new NotesPathError('Notes path is too deep')
    for (const segment of segments) {
      if (!segment || segment === '.' || segment === '..') throw new NotesPathError('Invalid notes path')
    }
    return normalized
  }

  private sanitizeName(rawName: string, isFile: boolean): string {
    let name = rawName.trim()
    if (isFile && name.toLowerCase().endsWith(MARKDOWN_EXT)) name = name.slice(0, -MARKDOWN_EXT.length)
    const safeName = sanitizeFilename(name)
    if (!safeName || safeName === '.' || safeName === '..') {
      throw new NotesPathError('Invalid note name')
    }
    return safeName
  }

  private async ensureDirectory(directory: string): Promise<void> {
    if (directory !== this.root && !directory.startsWith(`${this.root}${path.sep}`)) {
      throw new NotesPathError('Notes path escapes its root')
    }
    await this.assertNoSymlink(directory)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await this.assertNoSymlink(directory)
  }

  /**
   * Reject symlinks on the way to `target` and verify the nearest existing
   * ancestor resolves inside the real notes root.
   */
  private async assertNoSymlink(target: string): Promise<void> {
    const relative = path.relative(this.root, target)
    let current = this.root
    for (const segment of relative ? relative.split(path.sep) : []) {
      current = path.join(current, segment)
      const info = await this.lstatOptional(current)
      if (!info) break
      if (info.isSymbolicLink()) throw new NotesPathError(`Notes path contains a symbolic link: ${segment}`)
    }

    const realRoot = await this.realRootPromise
    let existing = target
    while (true) {
      try {
        const realExisting = await realpath(existing)
        if (realExisting !== realRoot && !realExisting.startsWith(`${realRoot}${path.sep}`)) {
          throw new NotesPathError('Notes path resolves outside its root')
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

  private async lstatOptional(target: string) {
    try {
      return await lstat(target)
    } catch (error) {
      if (isNotFound(error)) return undefined
      throw error
    }
  }

  private async exists(target: string): Promise<boolean> {
    return (await this.lstatOptional(target)) !== undefined
  }

  private toLogical(physical: string): string {
    const relative = path.relative(this.root, physical)
    if (!relative) return NOTES_ROOT_PATH
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new NotesPathError('Notes path is outside its root')
    }
    return `${NOTES_ROOT_PATH}/${relative.split(path.sep).join('/')}`
  }
}

function stripMarkdownExt(value: string): string {
  return value.toLowerCase().endsWith(MARKDOWN_EXT) ? value.slice(0, -MARKDOWN_EXT.length) : value
}

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`)
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

function isNotDirectory(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOTDIR'
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function recencyScore(updatedAt: string): number {
  const days = (Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24)
  return Math.max(0, 10 - days)
}

function findMatches(
  content: string,
  pattern: RegExp,
  maxMatchesPerFile: number,
  contextLength: number
): NotesSearchMatch[] {
  const lines = content.split('\n')
  const matches: NotesSearchMatch[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(line)) !== null) {
      if (match[0].length === 0) {
        pattern.lastIndex = match.index + 1
        continue
      }
      const matchStart = match.index
      const matchEnd = matchStart + match[0].length
      const beforeMatch = Math.min(2, matchStart)
      const contextStart = matchStart - beforeMatch
      const contextEnd = Math.min(line.length, matchEnd + contextLength)
      const prefix = contextStart > 0 ? '...' : ''
      matches.push({
        lineNumber: index + 1,
        lineContent: line,
        matchStart: beforeMatch + prefix.length,
        matchEnd: matchEnd - matchStart + beforeMatch + prefix.length,
        context: prefix + line.substring(contextStart, contextEnd)
      })
      if (matches.length >= maxMatchesPerFile) return matches
    }
  }
  return matches
}
