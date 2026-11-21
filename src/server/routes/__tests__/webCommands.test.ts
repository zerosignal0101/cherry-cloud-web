import { describe, expect, it } from 'vitest'

import { RpcRegistry } from '../../transport/registry'
import { registerEntityImageRoutes } from '../entityImages'
import { registerPreviewRoutes } from '../previews'

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
})
