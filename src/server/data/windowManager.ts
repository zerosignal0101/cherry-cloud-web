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
  getWindow(windowId: string): { id: string; webContents: WebContentsLike; isFocused(): boolean; isDestroyed(): boolean } | undefined
  getWindowIdByWebContents(webContents: WebContentsLike): string | undefined
}

export function createWindowManagerBridge(connections: ConnectionRegistry): WindowManagerBridge {
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
      if (!connections.resolve(windowId)) return undefined
      return {
        id: windowId,
        webContents: connections.webContents(windowId),
        isFocused: () => true,
        isDestroyed: () => !connections.resolve(windowId)
      }
    },
    getWindowIdByWebContents: (webContents) => (webContents.isDestroyed() ? undefined : webContents.id)
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
