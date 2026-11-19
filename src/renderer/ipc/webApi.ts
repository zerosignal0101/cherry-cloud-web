import type { SerializedIpcError } from '@shared/ipc/errors/IpcError'

type Listener = (payload: unknown) => void

const listeners = new Map<string, Set<Listener>>()
const RECONNECT_BASE_MS = 500
const RECONNECT_MAX_MS = 30_000
const HEARTBEAT_MS = 25_000

let socket: WebSocket | null = null
let reconnectAttempts = 0
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null

function websocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  // The session cookie authenticates the upgrade; no query-string token exists.
  return `${protocol}//${window.location.host}/api/ws`
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
      headers: { 'content-type': 'application/json' },
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

/** Installs the browser implementation of the preload bridge. Idempotent. */
export function installWebApi(): void {
  if (window.api?.ipcApi) return
  window.api = { ipcApi: { request, on } }
}
