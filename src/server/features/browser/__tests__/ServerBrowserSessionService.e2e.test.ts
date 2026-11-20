import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { afterEach, describe, expect, it } from 'vitest'

import { ServerBrowserMcpServer } from '../ServerBrowserSessionService'

/**
 * Optional end-to-end check for the server browser. It needs a Chromium
 * executable and public network access, neither of which the unit suite may
 * assume; run with:
 *
 *   RUN_BROWSER_E2E=1 BROWSER_EXECUTABLE_PATH=/usr/bin/google-chrome pnpm test
 */
describe.skipIf(process.env.RUN_BROWSER_E2E !== '1')('server browser runtime', () => {
  let server: ServerBrowserMcpServer | undefined
  let client: Client | undefined

  afterEach(async () => {
    await client?.close().catch(() => undefined)
    await server?.close().catch(() => undefined)
    client = undefined
    server = undefined
  })

  it('opens a page, snapshots it and returns a screenshot', async () => {
    server = new ServerBrowserMcpServer()
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    serveStdio(() => server!.createServer(), { transport: serverTransport })
    client = new Client({ name: 'server-browser-e2e', version: '1' })
    await client.connect(clientTransport)

    const opened = await client.callTool({ name: 'open', arguments: { url: 'https://example.com' } })
    expect(opened.isError).not.toBe(true)
    const openPayload = JSON.parse((opened.content[0] as { text: string }).text)
    expect(openPayload.currentUrl).toBe('https://example.com/')

    const snapshot = await client.callTool({ name: 'snapshot', arguments: {} })
    expect(snapshot.isError).not.toBe(true)
    expect((snapshot.content[0] as { text: string }).text).toContain('Example Domain')

    const screenshot = await client.callTool({ name: 'screenshot', arguments: { format: 'png' } })
    expect(screenshot.content.some((entry) => entry.type === 'image')).toBe(true)
  }, 60_000)
})
