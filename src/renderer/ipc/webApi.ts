import type { SerializedIpcError } from '@shared/ipc/errors/IpcError'
import { IpcChannel } from '@shared/IpcChannel'

import { ipcApi } from './ipcApi'

type Listener = (payload: unknown) => void

const listeners = new Map<string, Set<Listener>>()
const RECONNECT_BASE_MS = 500
const RECONNECT_MAX_MS = 30_000
const HEARTBEAT_MS = 25_000
const CLIENT_ID_KEY = 'ccw_client_id'

let socket: WebSocket | null = null
let reconnectAttempts = 0
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null

/**
 * Stable per-tab identity. The server addresses directed stream events to this
 * id (the web equivalent of a WindowId), so it must survive reconnects and be
 * the same value on the RPC request and the WebSocket upgrade.
 */
function clientId(): string {
  let id = sessionStorage.getItem(CLIENT_ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    sessionStorage.setItem(CLIENT_ID_KEY, id)
  }
  return id
}

function websocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  // The session cookie authenticates the upgrade; no query-string token exists.
  return `${protocol}//${window.location.host}/api/ws?client=${encodeURIComponent(clientId())}`
}

/** Session expired or missing: send the browser to the login page and stop retrying. */
function redirectToLogin(): void {
  if (window.location.pathname === '/login') return
  const next = window.location.pathname + window.location.search
  window.location.assign(`/login?next=${encodeURIComponent(next)}`)
}

function dispatch(event: string, payload: unknown): void {
  const subscribers = listeners.get(event)
  if (!subscribers) return
  for (const listener of [...subscribers]) {
    try {
      listener(payload)
    } catch (error) {
      // A broken subscriber must not stop the other listeners; the logger depends on this bridge.
      // eslint-disable-next-line no-restricted-syntax
      console.error('[web-api] event listener failed', error)
    }
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer) return
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempts, RECONNECT_MAX_MS)
  reconnectAttempts += 1
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, delay)
}

function connect(): void {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return

  const next = new WebSocket(websocketUrl())
  socket = next

  next.addEventListener('open', () => {
    reconnectAttempts = 0
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    heartbeatTimer = setInterval(() => {
      if (next.readyState === WebSocket.OPEN) next.send(JSON.stringify({ type: 'ping' }))
    }, HEARTBEAT_MS)
  })

  next.addEventListener('message', (event) => {
    let message: unknown
    try {
      message = JSON.parse(String(event.data))
    } catch {
      return
    }
    if (typeof message !== 'object' || message === null) return
    const frame = message as { type?: string; event?: string; payload?: unknown }
    if (frame.type === 'event' && typeof frame.event === 'string') dispatch(frame.event, frame.payload)
  })

  next.addEventListener('close', (event) => {
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    heartbeatTimer = null
    if (socket === next) socket = null
    if (event.code === 4401) {
      redirectToLogin()
      return
    }
    scheduleReconnect()
  })

  next.addEventListener('error', () => next.close())
}

async function request(route: string, input?: unknown): Promise<unknown> {
  let response: Response
  try {
    response = await fetch('/api/rpc', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-client-id': clientId() },
      credentials: 'same-origin',
      body: JSON.stringify({ route, input })
    })
  } catch (error) {
    return transportFailure(error)
  }

  if (response.status === 401) {
    redirectToLogin()
    return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }
  }

  const text = await response.text()
  if (!text) {
    return transportFailure(`Empty response (HTTP ${response.status})`)
  }

  try {
    return JSON.parse(text)
  } catch {
    return transportFailure(`Malformed response (HTTP ${response.status})`)
  }
}

function transportFailure(cause: unknown): { ok: false; error: SerializedIpcError } {
  return {
    ok: false,
    error: {
      code: 'TRANSPORT_ERROR',
      message: cause instanceof Error ? cause.message : String(cause)
    }
  }
}

function on(event: string, callback: Listener): () => void {
  let subscribers = listeners.get(event)
  if (!subscribers) {
    subscribers = new Set()
    listeners.set(event, subscribers)
  }
  subscribers.add(callback)
  connect()
  return () => {
    subscribers.delete(callback)
    if (subscribers.size === 0) listeners.delete(event)
  }
}

/**
 * Data API transport: the same `DataRequest → DataResponse` envelope the desktop
 * preload carried over IPC, now an HTTP request. The server answers 200 with the
 * envelope for both success and failure, so business errors stay in `error`.
 */
async function dataRequest(request: unknown): Promise<unknown> {
  let response: Response
  try {
    response = await fetch('/api/data', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-client-id': clientId() },
      credentials: 'same-origin',
      body: JSON.stringify(request)
    })
  } catch (error) {
    return dataTransportFailure(request, error)
  }

  if (response.status === 401) {
    redirectToLogin()
    return dataTransportFailure(request, 'Authentication required')
  }

  const text = await response.text()
  if (!text) return dataTransportFailure(request, `Empty response (HTTP ${response.status})`)

  try {
    return JSON.parse(text)
  } catch {
    return dataTransportFailure(request, `Malformed response (HTTP ${response.status})`)
  }
}

function dataTransportFailure(
  request: unknown,
  cause: unknown
): {
  id: string
  status: number
  error: { code: string; message: string }
} {
  const id = typeof request === 'object' && request !== null && 'id' in request ? String(request.id) : ''
  return {
    id,
    status: 503,
    error: {
      code: 'SERVICE_UNAVAILABLE',
      message: cause instanceof Error ? cause.message : String(cause)
    }
  }
}

/**
 * `window.api.preference` — the desktop preload exposed these as
 * `ipcRenderer.invoke(Preference_*)`; here they are IpcApi routes backed by the
 * same main-process `PreferenceService`.
 *
 * `onChanged` listens on the legacy `preference:changed` channel because that is
 * the name the server broadcasts on, so one event name covers both transports.
 */
const preference = {
  get: (key: string) => ipcApi.request('preference.get', { key }),
  getMultipleRaw: (keys: string[]) => ipcApi.request('preference.get_multiple_raw', { keys }),
  getAll: () => ipcApi.request('preference.get_all'),
  set: (key: string, value: unknown) => ipcApi.request('preference.set', { key, value }),
  setMultiple: (updates: Record<string, unknown>) => ipcApi.request('preference.set_multiple', { updates }),
  subscribe: (keys: string[]) => ipcApi.request('preference.subscribe', { keys }),
  onChanged: (callback: (key: string, value: unknown) => void): (() => void) =>
    on(IpcChannel.Preference_Changed, (payload) => {
      const change = payload as { key?: unknown; value?: unknown } | undefined
      if (typeof change?.key === 'string') callback(change.key, change.value)
    })
}

/**
 * `window.electron` — `@electron-toolkit/preload` on desktop. The renderer still
 * reads `process.env` for log levels and platform branches, and a few desktop
 * call sites invoke channels that have no server counterpart (log forwarding,
 * tab tear-off, Python worker). They get inert implementations rather than an
 * undefined global, which is what used to crash the tree on first render.
 */
function installElectronShim(): void {
  if (window.electron) return
  const noop = (): void => {}
  const noopUnsubscribe = (): void => {}
  window.electron = {
    ipcRenderer: {
      invoke: async (): Promise<undefined> => undefined,
      send: noop,
      sendSync: (): undefined => undefined,
      sendTo: noop,
      sendToHost: noop,
      postMessage: noop,
      on: noopUnsubscribe,
      once: noopUnsubscribe,
      addListener: noopUnsubscribe,
      removeListener: noop,
      removeAllListeners: noop
    },
    process: {
      platform: 'web',
      env: {
        NODE_ENV: import.meta.env.PROD ? 'production' : 'development'
      }
    }
  }
}

/** Installs the browser implementation of the preload bridge. Idempotent. */
export function installWebApi(): void {
  installElectronShim()
  if (window.api?.ipcApi) return
  window.api = {
    ipcApi: { request, on },
    dataApi: {
      request: dataRequest,
      onDataChanged: (callback: Listener) => on('data-api:data-changed', callback)
    },
    preference
  }
}
