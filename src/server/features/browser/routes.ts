import { browserHistoryService } from '@data/services/BrowserHistoryService'
import { browserRequestSchemas } from '@shared/ipc/schemas/browser'

import type { RpcRegistry } from '../../transport/registry'

/**
 * Browser routes the web build actually serves.
 *
 * The standalone browser is a sandboxed iframe, so there is no Chromium
 * partition to clear and no host browser profile to import. History is the one
 * piece of state the server owns; recording visits keeps the settings history
 * useful without exposing any desktop browser integration.
 */
const webBrowserHandlers = {
  'browser.visit.record': async ({ url, title, visitedAt }) => {
    browserHistoryService.record({ url, title, visitedAt, source: 'web' })
  },
  'browser.data.clear': async ({ kind }) => {
    // Cookies and HTTP cache belong to the user's own browser and are cleared
    // there. The server can only clear the history it stores.
    if (kind === 'history') browserHistoryService.clear()
  },
  'browser.import.sources': async () => [],
  'browser.import.run': async () => {
    throw new Error('Importing a desktop browser profile is not available in the web build')
  },
  // The renderer's legacy Agent browser pane still speaks these routes. The
  // server-side Playwright runtime is driven by the Agent's MCP tools, not by a
  // renderer guest, so pane attachment has nothing to own and is a no-op.
  'browser.pane.attach': async () => ({ tabId: crypto.randomUUID() }),
  'browser.cursor.present': async () => {},
  'browser.cursor.arrive': async () => {},
  'browser.pane.detach': async () => {},
  'browser.input.focused': async () => {}
}

export function registerBrowserRoutes(registry: RpcRegistry): void {
  registry.register(browserRequestSchemas, webBrowserHandlers)
}
