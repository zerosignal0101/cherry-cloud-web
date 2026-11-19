import type { WebSocket } from 'ws'

import { IpcChannel } from '@shared/IpcChannel'

/**
 * The browser is the server's only renderer, so the "window" a main-process
 * service talks to is a WebSocket connection, not an `Electron.WebContents`.
 *
 * A tab identifies itself with a stable client id (generated once per tab and
 * kept in `sessionStorage`): it travels as `x-client-id` on every RPC and as the
 * `client` query parameter on the WebSocket upgrade. `IpcContext.senderId` is
 * that client id, which keeps upstream handlers that resolve
 * `WindowManager.getWindow(senderId)` working against the adapter below.
 */
export interface ClientConnection {
  readonly clientId: string
  /** Appends one server → browser event to this connection only. */
  send(event: string, payload: unknown): void
  isOpen(): boolean
}

/**
 * The subset of `Electron.WebContents` that stream listeners touch. `id` is the
 * client id, so `WebContentsListener`'s `wc:${id}:${topicId}` key stays stable
 * across reconnects of the same tab.
 */
export interface WebContentsLike {
  readonly id: string
  send(channel: string, ...args: unknown[]): void
  isDestroyed(): boolean
}

const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/

/** Accept a browser-provided client id only in its expected shape. */
export function normalizeClientId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  return CLIENT_ID_PATTERN.test(raw) ? raw : null
}

export class ConnectionRegistry {
  private readonly connections = new Map<string, ClientConnection>()

  attach(clientId: string, socket: WebSocket): ClientConnection {
    const connection: ClientConnection = {
      clientId,
      send: (event, payload) => {
        if (socket.readyState !== socket.OPEN) return
        socket.send(JSON.stringify({ type: 'event', event, payload }))
      },
      isOpen: () => socket.readyState === socket.OPEN
    }
    this.connections.set(clientId, connection)
    return connection
  }

  detach(clientId: string, connection: ClientConnection): void {
    if (this.connections.get(clientId) === connection) this.connections.delete(clientId)
  }

  resolve(clientId: string | null | undefined): ClientConnection | undefined {
    return clientId ? this.connections.get(clientId) : undefined
  }

  /**
   * Adapter handed to upstream services that expect a `WebContents`. Absent
   * connection → a dead adapter, exactly like a destroyed window.
   */
  webContents(clientId: string): WebContentsLike {
    return {
      id: clientId,
      send: (channel, ...args) => {
        const connection = this.connections.get(clientId)
        if (!connection) return
        const event = channel === IpcChannel.IpcApi_Event ? String(args[0]) : channel
        connection.send(event, channel === IpcChannel.IpcApi_Event ? args[1] : args[0])
      },
      isDestroyed: () => !this.connections.has(clientId)
    }
  }

  broadcast(event: string, payload: unknown): void {
    for (const connection of this.connections.values()) connection.send(event, payload)
  }

  get size(): number {
    return this.connections.size
  }
}
