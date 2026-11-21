import { describe, expect, it } from 'vitest'

import { RpcRegistry } from '../../transport/registry'
import { registerAiRoutes } from '../routes'

describe('web AI routes', () => {
  it('leaves the deferred Claude Code binary routes unregistered', () => {
    const registry = new RpcRegistry()
    registerAiRoutes(registry)

    expect(registry.has('ai.claude_code.binary.status')).toBe(false)
    expect(registry.has('ai.claude_code.binary.ensure')).toBe(false)
    expect(registry.has('ai.claude_code.binary.retry')).toBe(false)
    // Sanity check that the rest of the chat-path domain still registers.
    expect(registry.has('ai.agent.sessions.delete')).toBe(true)
  })
})
