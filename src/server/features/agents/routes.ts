import { agentHandlers } from '@main/ipc/handlers/agent'
import { agentRequestSchemas, type AgentMemoryFile } from '@shared/ipc/schemas/agent'
import type { IpcHandlersFor } from '@shared/ipc/types'

import type { RpcRegistry } from '../../transport/registry'

const MEMORY_SEGMENTS: Record<AgentMemoryFile['key'], string[]> = {
  soul: ['SOUL.md'],
  user: ['USER.md'],
  fact: ['memory', 'FACT.md'],
  journal: ['memory', 'JOURNAL.jsonl']
}

function logicalRoot(agentId: string): string {
  return `/agents/${agentId}`
}

function projectMemoryFile(agentId: string, file: AgentMemoryFile): AgentMemoryFile {
  return {
    ...file,
    path: [logicalRoot(agentId), ...MEMORY_SEGMENTS[file.key]].join('/')
  }
}

/**
 * Agent identity/memory routes.
 *
 * The upstream handlers resolve fixed files under `DATA_DIR/Agents/<agentId>`
 * and return their host paths for display. The browser never receives host
 * layout: the same files are projected under the logical `/agents/<id>` tree.
 * Opening a folder is a desktop action and is rejected explicitly.
 */
const webAgentHandlers: IpcHandlersFor<typeof agentRequestSchemas> = {
  ...agentHandlers,
  'agent.memory.read': async (input, context) => {
    const snapshot = await agentHandlers['agent.memory.read'](input, context)
    return {
      directory: logicalRoot(input.agentId),
      files: snapshot.files.map((file) => projectMemoryFile(input.agentId, file))
    }
  },
  'agent.memory.write': async (input, context) => {
    const file = await agentHandlers['agent.memory.write'](input, context)
    return projectMemoryFile(input.agentId, file)
  },
  'agent.memory.open_folder': async () => {
    throw new Error('Agent memory opens in the in-app editor')
  }
}

export function registerAgentRoutes(registry: RpcRegistry): void {
  registry.register(agentRequestSchemas, webAgentHandlers)
}
