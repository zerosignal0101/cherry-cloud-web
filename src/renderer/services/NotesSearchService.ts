import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import type { NotesTreeNode } from '@renderer/types/note'

const logger = loggerService.withContext('NotesSearchService')

/**
 * Search match result
 */
export interface SearchMatch {
  lineNumber: number
  lineContent: string
  matchStart: number
  matchEnd: number
  context: string
}

/**
 * Search result with match information
 */
export interface SearchResult extends NotesTreeNode {
  matchType: 'filename' | 'content' | 'both'
  matches?: SearchMatch[]
  score: number
}

/**
 * Search options
 */
export interface SearchOptions {
  caseSensitive?: boolean
  useRegex?: boolean
  maxFileSize?: number
  maxMatchesPerFile?: number
  contextLength?: number
}

/**
 * Escape regex special characters
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Calculate relevance score
 * - Filename match has higher priority
 * - More matches increase score
 * - More recent updates increase score
 */
export function calculateRelevanceScore(node: NotesTreeNode, keyword: string, matches: SearchMatch[]): number {
  let score = 0

  // Exact filename match (highest weight)
  if (node.name.toLowerCase() === keyword.toLowerCase()) {
    score += 200
  }
  // Filename contains match (high weight)
  else if (node.name.toLowerCase().includes(keyword.toLowerCase())) {
    score += 100
  }

  // Content match count
  score += Math.min(matches.length * 2, 50)

  // Recent updates boost score
  const daysSinceUpdate = (Date.now() - new Date(node.updatedAt).getTime()) / (1000 * 60 * 60 * 24)
  score += Math.max(0, 10 - daysSinceUpdate)

  return score
}

/**
 * Search file content for keyword matches
 */
export async function searchFileContent(
  node: NotesTreeNode,
  keyword: string,
  options: SearchOptions = {}
): Promise<SearchResult | null> {
  const {
    caseSensitive = false,
    useRegex = false,
    maxFileSize = 10 * 1024 * 1024, // 10MB
    maxMatchesPerFile = 50,
    contextLength = 50
  } = options

  try {
    if (node.type !== 'file') {
      return null
    }

    const content = await window.api.file.readExternal(node.externalPath)

    if (!content) {
      return null
    }

    if (content.length > maxFileSize) {
      logger.warn(`File too large to search: ${node.externalPath} (${content.length} bytes)`)
      return null
    }

    const flags = caseSensitive ? 'g' : 'gi'
    const pattern = useRegex ? new RegExp(keyword, flags) : new RegExp(escapeRegex(keyword), flags)

    const lines = content.split('\n')
    const matches: SearchMatch[] = []

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      pattern.lastIndex = 0

      let match: RegExpExecArray | null
      while ((match = pattern.exec(line)) !== null) {
        // `exec` does not advance lastIndex on a zero-width match, so a pattern
        // such as `.*` or `^` would fill the result list with the same empty hit
        // and stop the file from being searched further.
        if (match[0].length === 0) {
          pattern.lastIndex = match.index + 1
          continue
        }
        const matchStart = match.index
        const matchEnd = matchStart + match[0].length

        // Keep context short: only 2 chars before match, more after
        const beforeMatch = Math.min(2, matchStart)
        const contextStart = matchStart - beforeMatch
        const contextEnd = Math.min(line.length, matchEnd + contextLength)

        // Add ellipsis if context doesn't start at line beginning
        const prefix = contextStart > 0 ? '...' : ''
        const contextText = prefix + line.substring(contextStart, contextEnd)

        matches.push({
          lineNumber: i + 1,
          lineContent: line,
          matchStart: beforeMatch + prefix.length,
          matchEnd: matchEnd - matchStart + beforeMatch + prefix.length,
          context: contextText
        })

        if (matches.length >= maxMatchesPerFile) {
          break
        }
      }

      if (matches.length >= maxMatchesPerFile) {
        break
      }
    }

    if (matches.length === 0) {
      return null
    }

    const score = calculateRelevanceScore(node, keyword, matches)

    return {
      ...node,
      matchType: 'content',
      matches,
      score
    }
  } catch (error) {
    logger.error(`Failed to search file content for ${node.externalPath}:`, error as Error)
    return null
  }
}

/**
 * Check if filename matches keyword
 */
export function matchFileName(node: NotesTreeNode, keyword: string, caseSensitive = false): boolean {
  const name = caseSensitive ? node.name : node.name.toLowerCase()
  const key = caseSensitive ? keyword : keyword.toLowerCase()
  return name.includes(key)
}

/**
 * Search all notes through the server.
 *
 * The server owns the Markdown files, so it can scan them without the browser
 * fetching every note. `nodes` is kept in the signature for callers that already
 * hold the tree; the authoritative file list comes from `DATA_DIR/notes`.
 */
export async function searchAllFiles(
  _nodes: NotesTreeNode[],
  keyword: string,
  options: SearchOptions = {},
  signal?: AbortSignal
): Promise<SearchResult[]> {
  if (signal?.aborted) return []
  const startTime = performance.now()

  const { results } = await ipcApi.request('notes.search', {
    keyword,
    caseSensitive: options.caseSensitive,
    useRegex: options.useRegex,
    maxFileSize: options.maxFileSize,
    maxMatchesPerFile: options.maxMatchesPerFile,
    contextLength: options.contextLength,
    maxResults: 100
  })
  if (signal?.aborted) return []

  const mapped: SearchResult[] = results.map((result) => ({
    id: result.path,
    name: result.name,
    type: 'file',
    treePath: result.treePath,
    externalPath: result.path,
    createdAt: result.createdAt,
    updatedAt: result.updatedAt,
    matchType: result.matchType,
    matches: result.matches,
    score: result.score
  }))

  const duration = (performance.now() - startTime).toFixed(2)
  logger.debug(
    `Full-text search completed: keyword="${keyword}", duration=${duration}ms, resultsFound=${mapped.length}`
  )
  return mapped
}
