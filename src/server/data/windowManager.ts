import { application } from '@application'
import { IpcChannel } from '@shared/IpcChannel'

import type { ConnectionRegistry, WebContentsLike } from '../transport/connections'

/**
 * The DataApi data-change signal and a few upstream services reach
 * `application.get('WindowManager')` to fan an event out to every window.
 *
 * The server has no windows; the browser tabs are `ClientConnection`s. This
 * adapter keeps upstream call sites unchanged by translating the two channels
 * they use onto the connection registry:
 *   - `IpcChannel.IpcApi_Event` → `broadcast(event, payload)` (typed AI events)
 *   - anything else → `broadcast(channel, payload)` (e.g. DataApi_DataChanged)
 *
 * `getWindow` returns a window-shaped handle for a live connection so senders
 * that resolve "the caller window" keep working.
 */
export interface WindowManagerBridge {
  broadcast(channel: string, ...args: unknown[]): void
  broadcastToType(_type: string, channel: string, ...args: unknown[]): void
  getWindow(
    windowId: string
  ): { id: string; webContents: WebContentsLike; isFocused(): boolean; isDestroyed(): boolean } | undefined
  getWindowIdByWebContents(webContents: WebContentsLike): string | undefined
  /** Fires when the socket for a tab actually goes away (not on reconnect replacement). */
  onWindowDestroyed(callback: (window: { id: string }) => void): () => void
}

export function createWindowManagerBridge(connections: ConnectionRegistry): WindowManagerBridge {
  /**
   * A tab reload closes the socket and reconnects with the same client id.
   * Treating that as a window destruction would permanently close file-edit
   * leases for the tab, so teardown waits out the reconnect window; any new
   * socket or RPC from the same client cancels it.
   */
  const DESTROY_GRACE_MS = 15_000
  const destroyTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const destroyedListeners = new Set<(window: { id: string }) => void>()

  connections.onDetach((clientId) => {
    const existing = destroyTimers.get(clientId)
    if (existing) clearTimeout(existing)
    destroyTimers.set(
      clientId,
      setTimeout(() => {
        destroyTimers.delete(clientId)
        if (connections.hasIdentity(clientId)) return
        connections.markDestroyed(clientId)
        for (const listener of destroyedListeners) listener({ id: clientId })
      }, DESTROY_GRACE_MS)
    )
  })
  connections.onAttach((clientId) => {
    const timer = destroyTimers.get(clientId)
    if (!timer) return
    clearTimeout(timer)
    destroyTimers.delete(clientId)
  })

  const broadcast = (channel: string, ...args: unknown[]): void => {
    if (channel === IpcChannel.IpcApi_Event && typeof args[0] === 'string') {
      connections.broadcast(args[0], args[1])
      return
    }
    connections.broadcast(channel, args.length > 1 ? args : args[0])
  }

  return {
    broadcast,
    broadcastToType: (_type, channel, ...args) => broadcast(channel, ...args),
    getWindow: (windowId) => {
      if (!connections.hasIdentity(windowId)) return undefined
      return {
        id: windowId,
        webContents: connections.webContents(windowId),
        isFocused: () => true,
        isDestroyed: () => !connections.hasIdentity(windowId)
      }
    },
    getWindowIdByWebContents: (webContents) => (webContents.isDestroyed() ? undefined : webContents.id),
    onWindowDestroyed: (callback) => {
      destroyedListeners.add(callback)
      return () => {
        destroyedListeners.delete(callback)
      }
    }
  }
}

/** Registers the bridge for the lifetime of the server process. */
export function installWindowManager(connections: ConnectionRegistry): WindowManagerBridge {
  const bridge = createWindowManagerBridge(connections)
  application.register('WindowManager', bridge)
  return bridge
}

export function uninstallWindowManager(): void {
  application.unregister('WindowManager')
}
