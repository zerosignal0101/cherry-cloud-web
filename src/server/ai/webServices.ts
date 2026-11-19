import { BaseService, type Disposable, Injectable, Phase, ServicePhase, toDisposable } from '@main/core/lifecycle'

import type { WindowManagerBridge } from '../data/windowManager'

/**
 * Web replacement for the services the AI stack resolves by name but that only
 * exist to drive desktop surfaces. Each one keeps the upstream contract (so
 * `@DependsOn` and `application.get(name)` still work) and degrades to no-ops.
 */

let bridge: WindowManagerBridge | undefined

export function configureWindowManager(instance: WindowManagerBridge): void {
  bridge = instance
}

const requireBridge = (): WindowManagerBridge => {
  if (!bridge) throw new Error('WindowManager was resolved before the transport bridge was installed')
  return bridge
}

/**
 * Windows are browser tabs here. Only the fan-out and sender-identity methods
 * have meaning; the rest describe a window geometry the server does not own.
 */
@Injectable('WindowManager')
@ServicePhase(Phase.WhenReady)
export class WebWindowManager extends BaseService {
  broadcast(channel: string, ...args: unknown[]): void {
    requireBridge().broadcast(channel, ...args)
  }

  broadcastToType(type: string, channel: string, ...args: unknown[]): void {
    requireBridge().broadcastToType(type, channel, ...args)
  }

  getWindow(windowId: string): unknown {
    return requireBridge().getWindow(windowId)
  }

  getWindowIdByWebContents(webContents: { id?: string; isDestroyed?: () => boolean }): string | undefined {
    return requireBridge().getWindowIdByWebContents(webContents as never)
  }

  getWindowsByType(_type: string): unknown[] {
    return []
  }

  getWindowType(_windowId: string | number): string | undefined {
    return undefined
  }

  getWindowId(_window: unknown): string | undefined {
    return undefined
  }

  onWindowDestroyed(_callback: (...args: unknown[]) => void): Disposable {
    // No window lifecycle exists, so the callback can never fire.
    return toDisposable(() => {})
  }

  pushInitDataToType(_type: string, _data: unknown): void {}
}

/**
 * Upstream reports token usage to Cherry's analytics endpoint after every turn.
 * The web build collects nothing (see AGENTS.md), so the call sites stay but the
 * payload is dropped.
 */
@Injectable('AnalyticsService')
@ServicePhase(Phase.WhenReady)
export class WebAnalyticsService extends BaseService {
  trackTokenUsage(_payload: unknown): void {}
  track(_event: string, _properties?: unknown): void {}
  isEnabled(): boolean {
    return false
  }
}

/**
 * Browsing lives in the user's browser, not on the server, so the MCP bridge
 * that exposes the built-in browser tool has nothing to attach to.
 */
@Injectable('BrowserSessionService')
@ServicePhase(Phase.WhenReady)
export class WebBrowserSessionService extends BaseService {
  createMcpEndpoint(): never {
    throw new Error('The built-in browser tool is not available in the web build')
  }
}

/**
 * `AiService` declares this as a dependency for the automation tools. The REPL
 * runtime itself is desktop-only, so the registration only keeps the dependency
 * graph intact; every entry point reports the capability as absent.
 */
@Injectable('AutomationReplService')
@ServicePhase(Phase.WhenReady)
export class WebAutomationReplService extends BaseService {
  isAccepting(): boolean {
    return false
  }

  async execute(): Promise<never> {
    throw new Error('Automation is not available in the web build')
  }
}
