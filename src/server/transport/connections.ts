import type { WebSocket } from 'ws'

import { encodeBinary } from '@shared/ipc/binary'
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
  /**
   * Upstream services (agent warm leases, projection subscriptions) observe
   * `WebContents` destruction through Node's EventEmitter API. The adapter
   * caches one object per client id so `once`/`removeListener` pair correctly;
   * destruction fires only after the window-manager reconnect grace.
   */
  once(event: 'destroyed', listener: () => void): WebContentsLike
  removeListener(event: 'destroyed', listener: () => void): WebContentsLike
  on(event: 'destroyed', listener: () => void): WebContentsLike
}

const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/
const MAX_PENDING_EVENTS = 1000

/** Accept a browser-provided client id only in its expected shape. */
export function normalizeClientId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  return CLIENT_ID_PATTERN.test(raw) ? raw : null
}

export class ConnectionRegistry {
  private readonly connections = new Map<string, ClientConnection>()
  private readonly identities = new Set<string>()
  private readonly pending = new Map<string, Array<{ event: string; payload: unknown }>>()
  private readonly detachListeners = new Set<(clientId: string) => void>()
  private readonly attachListeners = new Set<(clientId: string) => void>()
  /**
   * One adapter per client id. Upstream services key per-window state off the
   * `WebContents` object itself, so a new object per lookup would leak warm
   * leases and destroyed listeners on every call.
   */
  private readonly webContentsAdapters = new Map<string, WebContentsLike>()
  private readonly destroyedListeners = new Map<string, Set<() => void>>()

  /**
   * Register a tab identity from an authenticated RPC header. The socket may
   * still be handshaking (or not opened yet); services such as the directory
   * tree only need a stable identity, and events queue until `attach` flushes.
   */
  ensure(clientId: string): void {
    this.identities.add(clientId)
    this.notifyAttach(clientId)
  }

  hasIdentity(clientId: string | null | undefined): boolean {
    return !!clientId && this.identities.has(clientId)
  }

  attach(clientId: string, socket: WebSocket): ClientConnection {
    this.identities.add(clientId)
    const connection: ClientConnection = {
      clientId,
      send: (event, payload) => {
        if (socket.readyState !== socket.OPEN) return
        socket.send(JSON.stringify({ type: 'event', event, payload: encodeBinary(payload) }))
      },
      isOpen: () => socket.readyState === socket.OPEN
    }
    this.connections.set(clientId, connection)
    const queued = this.pending.get(clientId)
    if (queued) {
      this.pending.delete(clientId)
      for (const { event, payload } of queued) connection.send(event, payload)
    }
    this.notifyAttach(clientId)
    return connection
  }

  detach(clientId: string, connection: ClientConnection): void {
    if (this.connections.get(clientId) !== connection) return
    this.connections.delete(clientId)
    this.identities.delete(clientId)
    this.pending.delete(clientId)
    for (const listener of this.detachListeners) listener(clientId)
  }

  /**
   * Notify services that own per-tab resources (directory watchers, edit
   * leases). The connection for a client id can be replaced by a reconnect;
   * only the socket that was actually current fires the event.
   */
  onDetach(listener: (clientId: string) => void): () => void {
    this.detachListeners.add(listener)
    return () => {
      this.detachListeners.delete(listener)
    }
  }

  /** Fires on a socket attach or a fresh RPC identity (a reload cancels teardown). */
  onAttach(listener: (clientId: string) => void): () => void {
    this.attachListeners.add(listener)
    return () => {
      this.attachListeners.delete(listener)
    }
  }

  private notifyAttach(clientId: string): void {
    for (const listener of this.attachListeners) listener(clientId)
  }

  resolve(clientId: string | null | undefined): ClientConnection | undefined {
    return clientId ? this.connections.get(clientId) : undefined
  }

  /**
   * Adapter handed to upstream services that expect a `WebContents`. Absent
   * connection → events queue until the tab's socket attaches; a torn-down
   * identity behaves exactly like a destroyed window.
   */
  webContents(clientId: string): WebContentsLike {
    const cached = this.webContentsAdapters.get(clientId)
    if (cached) return cached

    const adapter: WebContentsLike = {
      id: clientId,
      send: (channel, ...args) => {
        const event = channel === IpcChannel.IpcApi_Event ? String(args[0]) : channel
        const payload = channel === IpcChannel.IpcApi_Event ? args[1] : args[0]
        const connection = this.connections.get(clientId)
        if (connection) {
          connection.send(event, payload)
          return
        }
        if (!this.identities.has(clientId)) return
        const queued = this.pending.get(clientId) ?? []
        if (queued.length >= MAX_PENDING_EVENTS) queued.shift()
        queued.push({ event, payload })
        this.pending.set(clientId, queued)
      },
      isDestroyed: () => !this.identities.has(clientId),
      once: (_event, listener) => {
        let listeners = this.destroyedListeners.get(clientId)
        if (!listeners) {
          listeners = new Set()
          this.destroyedListeners.set(clientId, listeners)
        }
        const onceListener = () => {
          listeners.delete(onceListener)
          listener()
        }
        listeners.add(onceListener)
        return adapter
      },
      on: (_event, listener) => {
        let listeners = this.destroyedListeners.get(clientId)
        if (!listeners) {
          listeners = new Set()
          this.destroyedListeners.set(clientId, listeners)
        }
        listeners.add(listener)
        return adapter
      },
      removeListener: (_event, listener) => {
        const listeners = this.destroyedListeners.get(clientId)
        if (!listeners) return adapter
        listeners.delete(listener)
        if (listeners.size === 0) this.destroyedListeners.delete(clientId)
        return adapter
      }
    }
    this.webContentsAdapters.set(clientId, adapter)
    return adapter
  }

  /**
   * Fired by the window manager once a detached tab has stayed away past the
   * reconnect grace. This is the true "window destroyed" edge: a reload
   * re-attaches the same client id and never reaches here.
   */
  markDestroyed(clientId: string): void {
    if (this.identities.has(clientId)) return
    this.webContentsAdapters.delete(clientId)
    const listeners = this.destroyedListeners.get(clientId)
    this.destroyedListeners.delete(clientId)
    if (!listeners) return
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch {
        // One bad listener must not keep the others from releasing their leases.
      }
    }
  }

  broadcast(event: string, payload: unknown): void {
    for (const connection of this.connections.values()) connection.send(event, payload)
  }

  get size(): number {
    return this.connections.size
  }
}
