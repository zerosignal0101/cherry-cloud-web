import { createHash } from 'node:crypto'

import { getCurrentSystemMessage } from '@earendil-works/pi-ai/utils/transcript'
import { estimateTokens, type AgentSession } from '@earendil-works/pi-coding-agent'

import type {
  ContextCategory,
  ContextCategoryKey,
  ContextResource,
  OperationResult,
  ThreadContextUsage
} from '@cherrystudio/agent-runtime'

export function readContextUsage(session: AgentSession): OperationResult<ThreadContextUsage> {
  const usage = session.getContextUsage()
  const model = session.model
  if (!usage || !model)
    return {
      status: 'unknown',
      error: { operation: 'contextUsage', code: 'no-model', message: 'No model context window' }
    }
  const projection = session.sessionManager.buildSessionProjection()
  const system = getCurrentSystemMessage(projection.messages)
  const tools = session.getAllTools()
  const loaded = new Set(system?.toolsAdded?.map((tool) => tool.name))
  const deferred = tools.filter(
    (tool) => !loaded.has(tool.name) && (tool.exposure === 'deferred' || tool.exposure === 'codemode')
  )
  const categories: ContextCategory[] = []
  const resources: ContextResource[] = []
  const systemParts = [
    ...(system?.toolsAdded ?? []).map((tool) => ({
      id: tool.name,
      kind: 'system-tools',
      state: 'loaded' as const,
      tokens: estimateTokens({ role: 'system', content: JSON.stringify(tool) })
    })),
    ...deferred.map((tool) => ({
      id: tool.name,
      kind: 'system-tools',
      state: 'deferred' as const,
      tokens: estimateTokens({ role: 'system', content: JSON.stringify(tool) })
    }))
  ]
  for (const part of systemParts) {
    const key = categoryKeys[part.kind] ?? 'other'
    const id = `${key}:${part.state}`
    const category = categories.find((entry) => entry.id === id)
    if (category) categories[categories.indexOf(category)] = { ...category, tokens: category.tokens + part.tokens }
    else categories.push({ id, key, occupancy: part.state, tokens: part.tokens, precision: 'estimated' })
    resources.push({
      id: `tool:${part.id}`,
      category: key,
      name: part.id,
      state: part.state,
      count: { tokens: part.tokens, precision: 'estimated' }
    })
  }
  categories.push({
    id: 'messages',
    key: 'messages',
    occupancy: 'included',
    precision: 'estimated',
    tokens: projection.messages
      .filter((message) => message.role !== 'system')
      .reduce((sum, message) => sum + estimateTokens(message), 0)
  })
  return {
    status: 'confirmed',
    value: {
      model: model.id,
      revision: createHash('sha256')
        .update(JSON.stringify([model, session.sessionManager.getLeafId(), system, deferred]))
        .digest('hex'),
      contextWindow: usage.contextWindow,
      ...(usage.tokens === null ? {} : { used: { tokens: usage.tokens, precision: 'estimated' as const } }),
      basis: 'current-context',
      breakdown: { coverage: 'partial', categories },
      resources
    }
  }
}

const categoryKeys: Record<string, ContextCategoryKey> = {
  'system-prompt': 'system-prompt',
  'system-tools': 'system-tools',
  'mcp-tools': 'mcp-tools',
  'mcp-instructions': 'mcp-instructions',
  'memory-files': 'memory-files',
  skills: 'skills',
  agents: 'agents'
}
