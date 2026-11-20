import { randomUUID } from 'node:crypto'
import dns from 'node:dns'
import { BlockList, isIP } from 'node:net'

import { type CallToolResult, McpServer } from '@modelcontextprotocol/server'
import type { Browser, BrowserContext, Dialog, Page, Request } from 'playwright-core'

import { loggerService } from '@logger'
import { toolDefinitions } from '@main/ai/mcp/browserToolDefinitions'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

const logger = loggerService.withContext('ServerBrowserSession')

const SUPPORTED = new Set([
  'open',
  'execute',
  'screenshot',
  'snapshot',
  'list_tabs',
  'switch_tab',
  'close_tab',
  'reset',
  'handle_dialog',
  'click',
  'hover',
  'scroll',
  'type',
  'press_key',
  'select_option',
  'go_back',
  'go_forward',
  'wait_for',
  'find',
  'console_messages',
  'network_requests'
])

const NON_GLOBAL = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
] as const) {
  NON_GLOBAL.addSubnet(address, prefix, 'ipv4')
}
for (const [address, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8]
] as const) {
  NON_GLOBAL.addSubnet(address, prefix, 'ipv6')
}

function isPrivateAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 0) return true
  return NON_GLOBAL.check(address, family === 6 ? 'ipv6' : 'ipv4')
}

/**
 * The agent browser runs on the server.
 *
 * One MCP connection owns one Chromium context and one page, so two Agent
 * sessions never share cookies or a tab. Navigation is restricted to public
 * HTTP(S): every main-frame and subresource request resolves its hostname and is
 * refused when it points at a loopback, private, link-local or metadata address.
 */
class PlaywrightBrowserSession {
  private browser: Browser | undefined
  private context: BrowserContext | undefined
  private page: Page | undefined
  private tabId = randomUUID()
  private pendingDialog: Dialog | undefined
  private readonly consoleBuffer: Array<{ level: string; text: string; at: number }> = []
  private readonly networkBuffer: Array<{ url: string; method: string; status?: number; at: number }> = []
  private readonly hostDecisions = new Map<string, boolean>()
  private closing: Promise<void> | undefined

  private async ensurePage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page
    if (!this.browser) {
      const { chromium } = await import('playwright-core')
      this.browser = await chromium.launch({
        headless: true,
        executablePath: process.env.BROWSER_EXECUTABLE_PATH?.trim() || undefined,
        args: process.env.BROWSER_NO_SANDBOX === '1' ? ['--no-sandbox', '--disable-dev-shm-usage'] : []
      })
    }
    this.context ??= await this.browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    })
    await this.installRequestGuard(this.context)
    const page = await this.context.newPage()
    this.page = page
    this.tabId = randomUUID()
    this.consoleBuffer.length = 0
    this.networkBuffer.length = 0
    page.on('console', (message) => {
      this.consoleBuffer.push({
        level: message.type(),
        text: message.text().slice(0, 2_000),
        at: Date.now()
      })
      if (this.consoleBuffer.length > 200) this.consoleBuffer.shift()
    })
    page.on('pageerror', (error) => {
      this.consoleBuffer.push({ level: 'error', text: String(error).slice(0, 2_000), at: Date.now() })
      if (this.consoleBuffer.length > 200) this.consoleBuffer.shift()
    })
    page.on('request', (request) => {
      this.recordRequest(request)
    })
    page.on('response', (response) => {
      const entry = this.networkBuffer.find((candidate) => candidate.url === response.url())
      if (entry) entry.status = response.status()
    })
    page.on('requestfailed', (request) => {
      const entry = this.networkBuffer.find((candidate) => candidate.url === request.url())
      if (entry) entry.status = 0
    })
    page.on('dialog', (dialog) => {
      this.pendingDialog = dialog
    })
    page.on('close', () => {
      if (this.page === page) this.page = undefined
    })
    return page
  }

  private recordRequest(request: Request): void {
    this.networkBuffer.push({
      url: request.url().slice(0, 2_048),
      method: request.method(),
      at: Date.now()
    })
    if (this.networkBuffer.length > 200) this.networkBuffer.shift()
  }

  private async installRequestGuard(context: BrowserContext): Promise<void> {
    await context.route('**/*', async (route) => {
      const url = route.request().url()
      try {
        if (!(await this.isPublicUrl(url))) {
          await route.abort('blockedbyclient')
          return
        }
        await route.continue()
      } catch (error) {
        logger.warn('Browser request guard failed', { url, error })
        await route.abort('failed').catch(() => {})
      }
    })
  }

  private async isPublicUrl(raw: string): Promise<boolean> {
    let parsed: URL
    try {
      parsed = new URL(raw)
    } catch {
      return false
    }
    if (parsed.protocol === 'data:' || parsed.protocol === 'blob:') return true
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    if (parsed.username || parsed.password) return false
    if (parsed.hostname.startsWith('[') || isIP(parsed.hostname)) return !isPrivateAddress(parsed.hostname)
    const cached = this.hostDecisions.get(parsed.hostname)
    if (cached !== undefined) return cached
    const addresses = await dns.promises.lookup(parsed.hostname, { all: true })
    const safe = addresses.length > 0 && addresses.every(({ address }) => !isPrivateAddress(address))
    this.hostDecisions.set(parsed.hostname, safe)
    return safe
  }

  async assertUrl(raw: string): Promise<string> {
    const url = new URL(raw)
    if (!(await this.isPublicUrl(url.toString()))) {
      throw new Error('The browser may only open public HTTP(S) pages')
    }
    return url.toString()
  }

  async open(
    input: {
      url: string
      format?: 'html' | 'txt' | 'markdown' | 'json'
      selector?: string
      maxChars?: number
      timeout?: number
      newTab?: boolean
      privateMode?: boolean
      showWindow?: boolean
    },
    signal: AbortSignal
  ): Promise<CallToolResult> {
    signal.throwIfAborted()
    const url = await this.assertUrl(input.url)
    const page = await this.ensurePage()
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: input.timeout ?? 15_000 })
    await page.waitForTimeout(250)
    if (input.format) {
      const selector = input.selector ?? 'body'
      const content = await page.evaluate(
        ({ selector, format }) => {
          const root = document.querySelector(selector) || document.body
          if (!root) return ''
          if (format === 'html') return root.outerHTML
          if (format === 'json') return root.textContent || ''
          return (root as HTMLElement).innerText || root.textContent || ''
        },
        { selector, format: input.format }
      )
      const capped =
        typeof content === 'string' && input.maxChars && content.length > input.maxChars
          ? `${content.slice(0, input.maxChars)}\n... [truncated at ${input.maxChars} chars]`
          : content
      return textResult({ tabId: this.tabId, content: capped })
    }
    return textResult({
      tabId: this.tabId,
      currentUrl: page.url(),
      title: await page.title()
    })
  }

  async snapshot(input: { scope?: string; maxChars?: number; full?: boolean }): Promise<CallToolResult> {
    const page = await this.ensurePage()
    const text = await page.evaluate(
      ({ scope, maxChars }) => {
        type Seen = { ref: string; role: string; name: string; tag: string; text: string }
        const seen: Seen[] = []
        const root = scope ? document.querySelector(`[data-cherry-ref="${scope}"]`) || document.body : document.body
        const roleOf = (element: Element): string => {
          const explicit = element.getAttribute('role')
          if (explicit) return explicit
          switch (element.tagName.toLowerCase()) {
            case 'a':
              return 'link'
            case 'button':
              return 'button'
            case 'input': {
              const type = (element as HTMLInputElement).type
              return type === 'checkbox' ? 'checkbox' : type === 'radio' ? 'radio' : 'textbox'
            }
            case 'textarea':
              return 'textbox'
            case 'select':
              return 'combobox'
            case 'img':
              return 'img'
            case 'h1':
            case 'h2':
            case 'h3':
              return 'heading'
            default:
              return element.hasAttribute('aria-label') || element.hasAttribute('contenteditable') ? 'generic' : ''
          }
        }
        const nameOf = (element: Element): string => {
          const aria = element.getAttribute('aria-label')
          if (aria) return aria
          const labelled = element.getAttribute('aria-labelledby')
          if (labelled) {
            const target = document.getElementById(labelled)
            if (target?.textContent) return target.textContent.trim()
          }
          if (element instanceof HTMLImageElement) return element.alt || element.title
          if (element instanceof HTMLInputElement) {
            return element.getAttribute('aria-label') || element.placeholder || element.value || element.name
          }
          return (element.textContent || '').trim()
        }
        let counter = Number((window as unknown as { __cherryRefCounter?: number }).__cherryRefCounter ?? 0)
        const candidates = root.querySelectorAll(
          'a,button,input,textarea,select,img,[role],[contenteditable="true"],[tabindex]'
        )
        for (const element of Array.from(candidates)) {
          if (!(element instanceof HTMLElement || element instanceof SVGElement)) continue
          const rect = element.getBoundingClientRect()
          if (rect.width <= 0 || rect.height <= 0) continue
          const role = roleOf(element)
          if (!role) continue
          let ref = element.getAttribute('data-cherry-ref')
          if (!ref) {
            counter += 1
            ref = `e${counter}`
            element.setAttribute('data-cherry-ref', ref)
          }
          seen.push({
            ref,
            role,
            name: nameOf(element).replace(/\s+/g, ' ').slice(0, 200),
            tag: element.tagName.toLowerCase(),
            text: ''
          })
          if (seen.length >= 500) break
        }
        ;(window as unknown as { __cherryRefCounter?: number }).__cherryRefCounter = counter
        const bodyText = ((root as HTMLElement).innerText || '').slice(0, 20_000)
        const lines = seen.map((item) => `${item.ref} ${item.role}${item.name ? ` "${item.name}"` : ''} <${item.tag}>`)
        const text = [`URL: ${location.href}`, `TITLE: ${document.title}`, ...lines, '', bodyText].join('\n')
        return text.slice(0, maxChars ?? 40_000)
      },
      { scope: input.scope, maxChars: input.maxChars }
    )
    return textResult({ tabId: this.tabId, id: randomUUID(), text, complete: text.length < (input.maxChars ?? 40_000) })
  }

  async screenshot(input: {
    fullPage?: boolean
    ref?: string
    format?: 'png' | 'jpeg'
    quality?: number
  }): Promise<CallToolResult> {
    const page = await this.ensurePage()
    const format = input.format ?? 'png'
    const options = {
      type: format,
      fullPage: input.ref ? false : (input.fullPage ?? false),
      ...(format === 'jpeg' && input.quality !== undefined ? { quality: input.quality } : {})
    } as const
    const buffer = input.ref
      ? await page.locator(`[data-cherry-ref="${input.ref}"]`).screenshot(options)
      : await page.screenshot(options)
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ tabId: this.tabId, url: page.url(), title: await page.title(), format })
        },
        { type: 'image', data: buffer.toString('base64'), mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png' }
      ]
    }
  }

  async click(input: {
    ref: string
    button?: 'left' | 'right' | 'middle'
    clickCount?: number
  }): Promise<CallToolResult> {
    const page = await this.ensurePage()
    await page.locator(`[data-cherry-ref="${input.ref}"]`).click({
      button: input.button ?? 'left',
      clickCount: input.clickCount ?? 1,
      timeout: 15_000
    })
    await page.waitForTimeout(250)
    return textResult({ tabId: this.tabId, url: page.url(), title: await page.title(), status: 'completed' })
  }

  async hover(input: { ref: string }): Promise<CallToolResult> {
    const page = await this.ensurePage()
    await page.locator(`[data-cherry-ref="${input.ref}"]`).hover({ timeout: 15_000 })
    await page.waitForTimeout(150)
    return textResult({ tabId: this.tabId, status: 'completed' })
  }

  async type(input: { ref: string; text: string; clear?: boolean; submit?: boolean }): Promise<CallToolResult> {
    const page = await this.ensurePage()
    const locator = page.locator(`[data-cherry-ref="${input.ref}"]`)
    if (input.clear !== false) await locator.fill('')
    await locator.fill(input.text)
    if (input.submit) await locator.press('Enter')
    await page.waitForTimeout(250)
    return textResult({ tabId: this.tabId, url: page.url(), status: 'completed' })
  }

  async pressKey(input: { key: string }): Promise<CallToolResult> {
    const page = await this.ensurePage()
    await page.keyboard.press(input.key)
    await page.waitForTimeout(150)
    return textResult({ tabId: this.tabId, status: 'completed' })
  }

  async scroll(input: { ref?: string; pages?: number }): Promise<CallToolResult> {
    const page = await this.ensurePage()
    const delta = (input.pages ?? 1) * 700
    if (input.ref) {
      await page.locator(`[data-cherry-ref="${input.ref}"]`).evaluate((element, amount) => {
        element.scrollBy(0, amount)
      }, delta)
    } else {
      await page.mouse.wheel(0, delta)
    }
    await page.waitForTimeout(150)
    return textResult({ tabId: this.tabId, status: 'completed' })
  }

  async selectOption(input: { ref: string; values: string[] }): Promise<CallToolResult> {
    const page = await this.ensurePage()
    await page.locator(`[data-cherry-ref="${input.ref}"]`).selectOption(input.values)
    return textResult({ tabId: this.tabId, status: 'completed' })
  }

  async history(direction: -1 | 1): Promise<CallToolResult> {
    const page = await this.ensurePage()
    if (direction === -1) await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15_000 })
    else await page.goForward({ waitUntil: 'domcontentloaded', timeout: 15_000 })
    await page.waitForTimeout(200)
    return textResult({ tabId: this.tabId, url: page.url(), title: await page.title() })
  }

  async waitFor(input: { text?: string; ref?: string; gone?: boolean; timeoutMs?: number }): Promise<CallToolResult> {
    const page = await this.ensurePage()
    const deadline = Date.now() + (input.timeoutMs ?? 10_000)
    while (Date.now() < deadline) {
      const present = await page.evaluate(
        ({ text, ref }) => {
          const byRef = ref ? !!document.querySelector(`[data-cherry-ref="${ref}"]`) : false
          const byText = text ? (document.body.innerText || '').includes(text) : false
          return { byRef, byText }
        },
        { text: input.text, ref: input.ref }
      )
      const checks = [input.text === undefined || present.byText, input.ref === undefined || present.byRef]
      if (checks.every((value) => (input.gone ? !value : value))) {
        return textResult({ tabId: this.tabId, status: 'completed', url: page.url() })
      }
      await page.waitForTimeout(250)
    }
    return textResult({ tabId: this.tabId, status: 'timeout' })
  }

  async find(input: { role?: string; name?: string }): Promise<CallToolResult> {
    const page = await this.ensurePage()
    const matches = await page.evaluate(
      ({ role, name }) => {
        const roleOf = (element: Element): string =>
          element.getAttribute('role') ||
          (element.tagName === 'BUTTON'
            ? 'button'
            : element.tagName === 'A'
              ? 'link'
              : element.tagName === 'INPUT'
                ? 'textbox'
                : element.tagName === 'IMG'
                  ? 'img'
                  : '')
        const nameOf = (element: Element): string =>
          (
            element.getAttribute('aria-label') ||
            (element instanceof HTMLInputElement ? element.placeholder || element.value : '') ||
            element.textContent ||
            ''
          )
            .trim()
            .replace(/\s+/g, ' ')
        let counter = Number((window as unknown as { __cherryRefCounter?: number }).__cherryRefCounter ?? 0)
        const found: Array<{ ref: string; role: string; name: string }> = []
        for (const element of Array.from(
          document.querySelectorAll('a,button,input,textarea,select,img,[role],[contenteditable="true"]')
        )) {
          if (!(element instanceof HTMLElement || element instanceof SVGElement)) continue
          const elementRole = roleOf(element)
          const elementName = nameOf(element)
          if (role && elementRole !== role) continue
          if (name && elementName !== name) continue
          let ref = element.getAttribute('data-cherry-ref')
          if (!ref) {
            counter += 1
            ref = `e${counter}`
            element.setAttribute('data-cherry-ref', ref)
          }
          found.push({ ref, role: elementRole, name: elementName.slice(0, 200) })
          if (found.length >= 100) break
        }
        ;(window as unknown as { __cherryRefCounter?: number }).__cherryRefCounter = counter
        return found
      },
      { role: input.role, name: input.name }
    )
    return textResult({ tabId: this.tabId, matches })
  }

  async execute(code: string, timeoutMs: number): Promise<CallToolResult> {
    const page = await this.ensurePage()
    const result = await Promise.race([
      page.evaluate(code),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Script execution timed out')), timeoutMs))
    ])
    return textResult(result)
  }

  async consoleMessages(level: 'error' | 'warning' | 'all', clear: boolean): Promise<CallToolResult> {
    const wanted = this.consoleBuffer.filter(
      (entry) => level === 'all' || (level === 'error' ? entry.level === 'error' : entry.level === 'warning')
    )
    if (clear) {
      for (const entry of wanted) {
        const index = this.consoleBuffer.indexOf(entry)
        if (index >= 0) this.consoleBuffer.splice(index, 1)
      }
    }
    return textResult({
      tabId: this.tabId,
      messages: wanted.slice(-200).map(({ level: messageLevel, text, at }) => ({ level: messageLevel, text, at }))
    })
  }

  async networkRequests(clear: boolean): Promise<CallToolResult> {
    const requests = [...this.networkBuffer]
    if (clear) this.networkBuffer.length = 0
    return textResult({ tabId: this.tabId, requests: requests.slice(-200) })
  }

  async handleDialog(input: { accept: boolean; promptText?: string }): Promise<CallToolResult> {
    const dialog = this.pendingDialog
    if (!dialog) throw new Error('No JavaScript dialog is open')
    this.pendingDialog = undefined
    if (input.accept) await dialog.accept(input.promptText)
    else await dialog.dismiss()
    return textResult({ tabId: this.tabId, status: 'completed' })
  }

  listTabs(): CallToolResult {
    return textResult({
      tabs: this.page && !this.page.isClosed() ? [{ tabId: this.tabId, url: this.page.url(), title: 'current' }] : []
    })
  }

  async switchTab(tabId: string): Promise<CallToolResult> {
    if (tabId !== this.tabId) throw new Error('Unknown tab id')
    return textResult({ tabId: this.tabId, status: 'completed' })
  }

  async closeTab(): Promise<CallToolResult> {
    await this.page?.close().catch(() => {})
    this.page = undefined
    this.tabId = randomUUID()
    return textResult({ status: 'completed' })
  }

  async reset(): Promise<CallToolResult> {
    await this.close()
    return textResult({ status: 'completed' })
  }

  async close(): Promise<void> {
    if (this.closing) return this.closing
    this.closing = (async () => {
      const results = await Promise.allSettled([this.page?.close(), this.context?.close(), this.browser?.close()])
      for (const result of results) {
        if (result.status === 'rejected') logger.debug('Browser cleanup step failed', { error: result.reason })
      }
      this.page = undefined
      this.context = undefined
      this.browser = undefined
    })()
    return this.closing
  }
}

function textResult(value: unknown): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: typeof value === 'string' ? value : JSON.stringify(value)
      }
    ]
  }
}

export class ServerBrowserMcpServer {
  private readonly session = new PlaywrightBrowserSession()
  private server: McpServer | undefined

  createServer(): McpServer {
    const server = new McpServer({ name: '@cherry/browser', version: '0.1.0-server' })
    for (const tool of toolDefinitions) {
      if (!SUPPORTED.has(tool.name)) continue
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.inputSchema },
        async (args, context) => this.callTool(tool.name, args, context.mcpReq.signal)
      )
    }
    server.server.onclose = () => {
      void this.session.close()
    }
    this.server = server
    return server
  }

  async close(): Promise<void> {
    const server = this.server
    this.server = undefined
    await this.session.close()
    await server?.close().catch(() => {})
  }

  private async callTool(name: string, args: unknown, signal: AbortSignal): Promise<CallToolResult> {
    try {
      signal.throwIfAborted()
      switch (name) {
        case 'open':
          return await this.session.open(args as never, signal)
        case 'snapshot':
          return await this.session.snapshot(args as never)
        case 'screenshot':
          return await this.session.screenshot(args as never)
        case 'click':
          return await this.session.click(args as never)
        case 'hover':
          return await this.session.hover(args as never)
        case 'type':
          return await this.session.type(args as never)
        case 'press_key':
          return await this.session.pressKey(args as never)
        case 'scroll':
          return await this.session.scroll(args as never)
        case 'select_option':
          return await this.session.selectOption(args as never)
        case 'go_back':
          return await this.session.history(-1)
        case 'go_forward':
          return await this.session.history(1)
        case 'wait_for':
          return await this.session.waitFor(args as never)
        case 'find':
          return await this.session.find(args as never)
        case 'execute':
          return await this.session.execute(
            (args as { code: string }).code,
            (args as { timeout?: number }).timeout ?? 5_000
          )
        case 'console_messages': {
          const input = args as { level: 'error' | 'warning' | 'all'; clear: boolean }
          return await this.session.consoleMessages(input.level, input.clear)
        }
        case 'network_requests':
          return await this.session.networkRequests((args as { clear: boolean }).clear)
        case 'handle_dialog':
          return await this.session.handleDialog(args as never)
        case 'list_tabs':
          return this.session.listTabs()
        case 'switch_tab':
          return await this.session.switchTab((args as { tabId: string }).tabId)
        case 'close_tab':
          return await this.session.closeTab()
        case 'reset':
          return await this.session.reset()
        default:
          throw new Error(`Browser tool "${name}" is not available in the server runtime`)
      }
    } catch (error) {
      return {
        isError: true,
        content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }]
      }
    }
  }
}

@Injectable('BrowserSessionService')
@ServicePhase(Phase.WhenReady)
export class ServerBrowserSessionService extends BaseService {
  /** Marks the granular browser tool surface as mountable for this process. */
  readonly providesDirectTools = true

  createMcpServer(): McpServer {
    return new ServerBrowserMcpServer().createServer()
  }

  async createMcpEndpoint(): Promise<{ createServer(): McpServer; close(): Promise<void> }> {
    const server = new ServerBrowserMcpServer()
    return {
      createServer: () => server.createServer(),
      close: () => server.close()
    }
  }
}
