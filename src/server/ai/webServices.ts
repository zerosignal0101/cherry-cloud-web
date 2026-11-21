import { application } from '@application'
import type { AgentAttachmentSelection } from '@cherrystudio/remote-protocol/agent'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentTaskService } from '@data/services/AgentTaskService'
import {
  BaseService,
  type Disposable,
  DependsOn,
  Injectable,
  Phase,
  ServicePhase,
  toDisposable
} from '@main/core/lifecycle'
import { sweepAbandonedStaging } from '@main/features/miniApp/install/installer'
import { recoverInterruptedPublishes } from '@main/features/miniApp/install/publishJournal'
import { MiniAppRuntimeService } from '@main/features/miniApp/runtime/MiniAppRuntimeService'
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

  onWindowDestroyed(callback: (window: { id: string }) => void): Disposable {
    return toDisposable(requireBridge().onWindowDestroyed(callback))
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
 * Mini app runtime for the browser build.
 *
 * The desktop class owns `<webview>` guests; here every mini app is a sandboxed
 * iframe whose capabilities reach the server through one authenticated RPC route,
 * so there is no guest `WebContents` to register. The inherited install, update,
 * journal, quota and attention logic is reused unchanged; only the guest ledger
 * and the Chromium partition preparation are replaced.
 */
@Injectable('MiniAppRuntimeService')
@ServicePhase(Phase.WhenReady)
export class WebMiniAppRuntimeService extends MiniAppRuntimeService {
  protected async onReady(): Promise<void> {
    const unrepaired = new Set<string>()
    try {
      for (const outcome of await recoverInterruptedPublishes()) {
        if (outcome.action === 'failed') unrepaired.add(outcome.appId)
      }
    } finally {
      if (!this.recovered.isResolved) this.recovered.resolve(unrepaired)
    }
    await sweepAbandonedStaging()
    this.broadcastAttentionState()
  }

  /** An iframe is always considered visible/focused enough for its own capabilities. */
  isGuestVisible(_webContentsId: number): boolean {
    return true
  }

  isGuestAlive(_webContentsId: number): boolean {
    return true
  }

  /** No webview guests exist; every quiesce therefore completes immediately. */
  guestsOf(_appId: string): number[] {
    return []
  }

  /** Partition prep is meaningless without Chromium; the iframe uses a signed HTTP URL. */
  async ensurePartition(_appId: string): Promise<void> {}

  isPartitionReady(_appId: string): boolean {
    return true
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

/**
 * Channel runtimes drive external messengers (Telegram, Slack, …) and depend on
 * desktop window/credential plumbing that the web build does not ship. Registering
 * the name keeps agent task execution from failing at the channel lookup; no
 * adapter is ever returned, so tasks with channel recipients simply send nothing.
 */
@Injectable('ChannelManager')
@ServicePhase(Phase.WhenReady)
export class WebChannelManager extends BaseService {
  getAdapter(_channelId: string): undefined {
    return undefined
  }

  getAgentAdapters(_agentId: string): [] {
    return []
  }

  getAdapterStatuses(_agentId: string): [] {
    return []
  }

  getChannelLogs(_channelId: string): [] {
    return []
  }

  requestReconcile(_channelId: string): void {}

  async reconcileChannel(_channelId: string): Promise<void> {}

  async removeChannel(_channelId: string): Promise<void> {}

  reconcileAgent(_agentId: string, _clearSessionTracker?: boolean): void {}

  waitForQrAndReconcile(_agentId: string, _channelId: string, _timeoutMs?: number): Promise<never> {
    return Promise.reject(new Error('Channel pairing is not available in the web build'))
  }

  pause(_reason?: string): Disposable {
    return toDisposable(() => {})
  }

  async drainInFlight(_options: { timeoutMs: number }): Promise<{ stragglerIds: string[] }> {
    return { stragglerIds: [] }
  }

  listActiveWork(): Array<{ id: string; summary: string }> {
    return []
  }

  async start(): Promise<void> {}

  async stop(): Promise<void> {}
}

/**
 * Remote LAN access belongs to the desktop remote-control feature. The API
 * gateway only calls `closeIngress` when it binds the loopback listener, so a
 * no-op keeps its invariants without opening network surfaces.
 */
@Injectable('RemoteAccessService')
@ServicePhase(Phase.WhenReady)
export class WebRemoteAccessService extends BaseService {
  closeIngress(): void {}

  async createInvitation(): Promise<never> {
    throw new Error('Remote access is not available in the web build')
  }
}

/**
 * Pending remote attachment selections come from the desktop remote-control
 * upload intake. Browsers upload through `POST /api/files`, so there is never a
 * remote selection to report; answering an empty list keeps the agent chat
 * subscription working without starting the desktop intake services.
 */
@Injectable('AttachmentPresenceService')
@ServicePhase(Phase.WhenReady)
export class WebAttachmentPresenceService extends BaseService {
  async list(_sessionId: string): Promise<AgentAttachmentSelection[]> {
    return []
  }
}

/**
 * Knowledge bases need a vector store and an embedding runtime the web build
 * does not ship. `buildAgentParams` still asks `hasAnyBase()` on every turn to
 * gate the `kb_*` tools; answering false lets them drop out normally instead of
 * taking the fail-open error path on each request.
 */
@Injectable('KnowledgeService')
@ServicePhase(Phase.WhenReady)
export class WebKnowledgeService extends BaseService {
  hasAnyBase(): boolean {
    return false
  }
}

/**
 * Claude Code executes a downloaded CLI through Electron-era spawn plumbing and
 * is explicitly deferred from the web runtime. `AgentSessionRuntimeService`
 * declares these owners in `@DependsOn` (and calls their close hooks on every
 * session teardown), so the names must exist even though Pi is the only
 * runtime the web build enables.
 */
@Injectable('ClaudeCodeProcessManager')
@ServicePhase(Phase.WhenReady)
export class WebClaudeCodeProcessManager extends BaseService {}

@Injectable('ClaudeCodeWarmQueryManager')
@ServicePhase(Phase.WhenReady)
@DependsOn(['ClaudeCodeProcessManager'])
export class WebClaudeCodeWarmQueryManager extends BaseService {
  async close(_key: string): Promise<void> {}

  closeAgentSessionWarm(_sessionId: string): void {}
}

/**
 * Web slice of `AgentLifecycleService`.
 *
 * Scheduled-task deletion only needs the database half (trash the task's sessions
 * and remove the schedule); runtime teardown, workspace archives and the rest of
 * the agent lifecycle arrive with the agent runtime in M12. Methods outside this
 * slice fail with an explicit message rather than a missing-method TypeError.
 */
@Injectable('AgentLifecycleService')
@ServicePhase(Phase.WhenReady)
export class WebAgentLifecycleService extends BaseService {
  async deleteTaskWithSessions(taskId: string): Promise<boolean> {
    const result = application.get('DbService').withWriteTx((tx) => {
      const ids = agentSessionService.listTaskSessionIds(taskId)
      const trashed = agentSessionService.trashByIdsTx(tx, ids)
      const deleted = agentTaskService.deleteScheduleTx(tx, taskId)
      return { ...trashed, deleted }
    })
    if (result.deliveryResults.length > 0) {
      agentSessionMessageService.publishDeliveryChanges(result.deliveryResults)
    }
    if (result.trashedIds.length > 0) {
      agentSessionService.notifyReadModelChange(result.trashedIds, 'membership')
    }
    return result.deleted
  }

  listActiveWork(): Array<{ id: string; summary: string }> {
    return []
  }

  pauseIngress(_reason?: string): Disposable {
    return toDisposable(() => {})
  }

  pauseExecution(_reason?: string): Disposable {
    return toDisposable(() => {})
  }

  async drainIngress(_options: { timeoutMs: number }): Promise<{ stragglerIds: string[] }> {
    return { stragglerIds: [] }
  }

  async drainInFlight(_options: { timeoutMs: number }): Promise<{ stragglerIds: string[] }> {
    return { stragglerIds: [] }
  }

  private unavailable(): never {
    throw new Error('Agent archive and restore are not available in the web build yet')
  }

  archiveAgent(): never {
    return this.unavailable()
  }

  purgeAgent(): never {
    return this.unavailable()
  }

  deleteActiveAgentPermanently(): never {
    return this.unavailable()
  }

  restoreAgent(): never {
    return this.unavailable()
  }

  archiveSessions(): never {
    return this.unavailable()
  }

  purgeSessions(): never {
    return this.unavailable()
  }

  deleteActiveSessionsPermanently(): never {
    return this.unavailable()
  }

  restoreSession(): never {
    return this.unavailable()
  }

  archiveAgentSessions(): never {
    return this.unavailable()
  }

  deleteWorkspace(): never {
    return this.unavailable()
  }

  reuseOrCreateSession(): never {
    return this.unavailable()
  }

  purgeExpiredSessions(): never {
    return this.unavailable()
  }

  purgeExpiredAgents(): never {
    return this.unavailable()
  }

  reconcile(): never {
    return this.unavailable()
  }

  sweepOrphans(): never {
    return this.unavailable()
  }
}
