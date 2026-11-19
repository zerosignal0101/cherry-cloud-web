import { describe, expect, it } from 'vitest'

import { settingsMenu } from '@renderer/components/settingsMenu'

const routes = settingsMenu.map(({ route }) => route)

describe('settings menu scope', () => {
  it('lists the surfaces the Web deployment implements', () => {
    expect(routes).toEqual(
      expect.arrayContaining([
        '/settings/provider',
        '/settings/model',
        '/settings/mcp',
        '/settings/websearch',
        '/settings/general',
        '/settings/appearance',
        '/settings/data',
        '/settings/about'
      ])
    )
  })

  it('omits Cherry cloud, local runtimes and desktop-only assistants', () => {
    for (const route of [
      '/settings/profile',
      '/settings/local-models',
      '/settings/api-gateway',
      '/settings/skills',
      '/settings/computer-use',
      '/settings/browser',
      '/settings/channels',
      '/settings/device-connections',
      '/settings/shortcut',
      '/settings/quick-assistant',
      '/settings/selection-assistant',
      '/settings/screenshot',
      '/settings/dependencies'
    ]) {
      expect(routes).not.toContain(route)
    }
  })
})
