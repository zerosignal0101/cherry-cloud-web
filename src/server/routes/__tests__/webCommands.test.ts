import { describe, expect, it } from 'vitest'

import { RpcRegistry } from '../../transport/registry'
import { registerCopilotRoutes } from '../copilot'
import { registerEntityImageRoutes } from '../entityImages'
import { registerPreviewRoutes } from '../previews'
import { registerTraceRoutes } from '../trace'

describe('web command routes', () => {
  it('registers the avatar and logo commands', () => {
    const registry = new RpcRegistry()
    registerEntityImageRoutes(registry)

    expect(registry.has('assistant.set_avatar')).toBe(true)
    expect(registry.has('profile.set_avatar')).toBe(true)
    expect(registry.has('provider.set_logo')).toBe(true)
  })

  it('registers the chat preview commands', () => {
    const registry = new RpcRegistry()
    registerPreviewRoutes(registry)

    expect(registry.has('citation.fetch_preview')).toBe(true)
    expect(registry.has('citation.cancel_previews')).toBe(true)
    expect(registry.has('tool_result.preview_image')).toBe(true)
  })

  it('registers the trace snapshot command', () => {
    const registry = new RpcRegistry()
    registerTraceRoutes(registry)

    expect(registry.has('trace.get_data')).toBe(true)
  })

  it('registers the GitHub Copilot device flow commands', () => {
    const registry = new RpcRegistry()
    registerCopilotRoutes(registry)

    expect(registry.has('copilot.get_auth_message')).toBe(true)
    expect(registry.has('copilot.get_copilot_token')).toBe(true)
    expect(registry.has('copilot.save_copilot_token')).toBe(true)
    expect(registry.has('copilot.get_token')).toBe(true)
    expect(registry.has('copilot.get_user')).toBe(true)
    expect(registry.has('copilot.logout')).toBe(true)
  })
})
