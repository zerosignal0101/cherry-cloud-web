import { BaseService, type Disposable, Injectable, Phase, ServicePhase, toDisposable } from '@main/core/lifecycle'
import { IpcChannel } from '@shared/IpcChannel'

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
 * Upstream's `IpcApiService` owns the Electron `IpcApi_Request` channel plus the
 * event senders. The channel belongs to `src/server/transport` here, so only the
 * senders are kept: `send` targets one tab, the broadcasts fan out to every open
 * tab, and both ride the connection registry's `IpcApi_Event` translation.
 */
@Injectable('IpcApiService')
@ServicePhase(Phase.WhenReady)
export class WebIpcApiService extends BaseService {
  send(windowId: string, event: string, payload: unknown): void {
    const window = requireBridge().getWindow(windowId)
    if (window && !window.isDestroyed()) {
      window.webContents.send(IpcChannel.IpcApi_Event, event, payload)
    }
  }

  broadcast(event: string, payload: unknown): void {
    requireBridge().broadcast(IpcChannel.IpcApi_Event, event, payload)
  }

  broadcastToType(windowType: string, event: string, payload: unknown): void {
    requireBridge().broadcastToType(windowType, IpcChannel.IpcApi_Event, event, payload)
  }
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

/**
 * Desktop protocol handlers (`cherry://`, pending MCP install links) are fed by
 * OS-level URL events. A browser tab cannot receive them, so the pending list is
 * always empty and install requests are rejected. The MCP settings page polls
 * the list on mount; a registered service keeps that poll quiet.
 */
@Injectable('ProtocolService')
@ServicePhase(Phase.WhenReady)
export class WebProtocolService extends BaseService {
  listPendingMcpInstallRequests(_windowId: string): unknown[] {
    return []
  }

  installPendingMcpInstallRequest(_windowId: string, _requestId: string): Promise<never> {
    return Promise.reject(new Error('Protocol-based MCP install is not available in the web build'))
  }

  cancelPendingMcpInstallRequest(_windowId: string, _requestId: string): void {}

  onMainRendererReady(_windowId: string): void {}
}
