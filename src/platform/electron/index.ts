/* eslint-disable no-unused-vars -- every member mirrors its Electron signature so upstream call sites typecheck; the server implementation is intentionally a no-op. */
/**
 * Minimal Electron stand-in for the headless server.
 *
 * Upstream `src/main` modules import `electron` at module scope for a handful of
 * host services (app paths, logging, IPC registration). The web build keeps those
 * modules unchanged and resolves `electron` to this file instead — see the
 * `electron` entry in `tsconfig.server.json`.
 *
 * Rules:
 * - Only what the server actually runs belongs here. Adding a member is a signal
 *   that more of the desktop main process is being reused, so add it deliberately.
 * - Electron renderer/IPC semantics are *not* emulated: `ipcMain` accepts handlers
 *   and drops them, because the browser talks to the server over `window.api.ipcApi`
 *   (HTTP + WebSocket), never over Electron IPC.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { resolveDataDir, resolveDataPaths } from '../dataPaths'

export interface IpcMainEvent {
  sender: unknown
  frameId: number
  returnValue: unknown
}

export interface IpcMainInvokeEvent {
  sender: unknown
  frameId: number
}

export type IpcMainListener = (event: IpcMainEvent, ...args: unknown[]) => void
export type IpcMainInvokeListener = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

type AppPathName = 'userData' | 'logs' | 'temp' | 'sessionData' | 'appData' | 'home' | 'crashDumps'

const paths = resolveDataPaths(resolveDataDir())

const appPaths: Record<AppPathName, string> = {
  userData: paths.root,
  logs: paths.logs,
  temp: paths.root,
  sessionData: paths.root,
  appData: paths.root,
  home: paths.root,
  crashDumps: paths.logs
}

function normalizeLocale(raw: string | undefined): string {
  const value = raw?.split('.')[0]?.replace('_', '-')
  return value && value.length > 0 ? value : 'en-US'
}

export const app = {
  /** The server is always a deployed build; dev-only path diversion must not run. */
  isPackaged: true,
  name: 'cherry-cloud-web',
  /**
   * Registry compatibility keys off this value. The check accepts
   * `minAppVersion <= version <= sourceAppVersion`, and the GitCode mirror's
   * catalog is generated from 2.2.0 while the bundled catalog tracks 2.2.2.
   * Reporting 2.2.0 is the newest value both mirrors accept; override with
   * `APP_VERSION` when syncing to a different upstream tag.
   */
  getVersion: (): string => process.env.APP_VERSION ?? '2.2.0',
  getAppPath: (): string => process.cwd(),
  getPath: (name: AppPathName): string => appPaths[name] ?? paths.root,
  setPath: (_name: AppPathName, _value: string): void => {},
  setAppLogsPath: (): void => {},
  getPreferredSystemLanguages: (): string[] => [normalizeLocale(process.env.LC_ALL ?? process.env.LANG)],
  getLocale: (): string => normalizeLocale(process.env.LC_ALL ?? process.env.LANG),
  isReady: (): boolean => true,
  whenReady: async (): Promise<void> => {},
  on: (): typeof app => app,
  once: (): typeof app => app,
  off: (): typeof app => app,
  quit: (): void => {},
  exit: (code = 0): never => process.exit(code)
}

export const ipcMain = {
  handle: (_channel: string, _listener: IpcMainInvokeListener): void => {},
  handleOnce: (_channel: string, _listener: IpcMainInvokeListener): void => {},
  removeHandler: (_channel: string): void => {},
  on: (_channel: string, _listener: IpcMainListener): typeof ipcMain => ipcMain,
  once: (_channel: string, _listener: IpcMainListener): typeof ipcMain => ipcMain,
  off: (_channel: string, _listener: IpcMainListener): typeof ipcMain => ipcMain,
  removeListener: (_channel: string, _listener: IpcMainListener): typeof ipcMain => ipcMain,
  removeAllListeners: (_channel?: string): typeof ipcMain => ipcMain,
  emit: (): boolean => false
}

export const dialog = {
  showMessageBox: async (): Promise<{ response: number; checkboxChecked: boolean }> => ({
    response: 0,
    checkboxChecked: false
  }),
  showMessageBoxSync: (): number => 0,
  showErrorBox: (): void => {},
  // The browser supplies files as multipart uploads; a native picker has no
  // server-side equivalent. Answering "cancelled" is the honest shape for the
  // desktop handlers that still mention one.
  showOpenDialog: async (): Promise<{ canceled: true; filePaths: string[] }> => ({ canceled: true, filePaths: [] }),
  showSaveDialog: async (): Promise<{ canceled: true; filePath?: string }> => ({ canceled: true })
}

export class ClipboardItem {
  constructor(readonly data: Record<string, string>) {}
}

/** Clipboard writes are dropped: the browser owns the user's clipboard, not the server. */
export const clipboard = {
  write: async (_items: ClipboardItem[]): Promise<void> => {},
  read: async (): Promise<ClipboardItem[]> => [],
  writeText: (_text: string): void => {},
  readText: (): string => ''
}

export const shell = {
  openPath: async (_path: string): Promise<string> => '',
  openExternal: async (_url: string): Promise<void> => {},
  showItemInFolder: (_path: string): void => {}
}

/**
 * Provider requests run on Node's `fetch`, not Chromium's network stack. The
 * one Electron-specific behaviour upstream relies on is the User-Agent
 * smuggling in `src/main/ai/utils/customFetch.ts`: Chromium overwrites the
 * `User-Agent` header, so upstream sends `x-cherry-studio-user-agent` and
 * restores it in a session interceptor. Node does not overwrite headers, so the
 * rewrite happens here and the interceptor below stays a no-op.
 */
export const net = {
  fetch: async (input: string | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    const userAgent = request.headers.get('x-cherry-studio-user-agent')
    if (!userAgent) return fetch(request)

    const headers = new Headers(request.headers)
    headers.delete('x-cherry-studio-user-agent')
    headers.set('user-agent', userAgent)
    return fetch(new Request(request, { headers }))
  }
}

interface WebContentsStub {
  readonly id: number
  readonly hostWebContents?: WebContentsStub
  send(_channel: string, ..._args: unknown[]): void
  isDestroyed(): boolean
  isFocused?(): boolean
}

/** No guest webContents exist server-side; only identity/liveness probes reach this. */
export const webContents = {
  getAllWebContents: (): WebContentsStub[] => [],
  fromId: (_id: number): WebContentsStub | undefined => undefined,
  on: (_event: string, _listener: (...args: unknown[]) => void): typeof webContents => webContents,
  once: (_event: string, _listener: (...args: unknown[]) => void): typeof webContents => webContents,
  off: (_event: string, _listener: (...args: unknown[]) => void): typeof webContents => webContents,
  removeListener: (_event: string, _listener: (...args: unknown[]) => void): typeof webContents => webContents
}

/**
 * Per-partition session stand-in. Mini-app installation only asks sessions to
 * clear storage and install network handlers; with no Chromium here every policy
 * is satisfied vacuously, and the actual browser-side isolation is the signed
 * sandbox iframe served by `src/server/features/miniapps`.
 */
function createSessionStub(): {
  protocol: { handle(_scheme: string, _handler: unknown): void; unhandle(_scheme: string): void }
  webRequest: {
    onBeforeRequest(_listener: unknown): void
    onHeadersReceived(_listener: unknown): void
    onBeforeSendHeaders(_listener: unknown): void
  }
  cookies: { flushStore(): Promise<void> }
  clearStorageData(): Promise<void>
  clearCache(): Promise<void>
  clearCodeCaches(_options: unknown): Promise<void>
  flushStorageData(): void
  setProxy(_config: unknown): Promise<void>
  setPermissionRequestHandler(_handler: unknown): void
  setPermissionCheckHandler(_handler: unknown): void
  setDisplayMediaRequestHandler(_handler: unknown): void
  setDevicePermissionHandler(_handler: unknown): void
  setBluetoothPairingHandler(_handler: unknown): void
  removeAllListeners(_event: string): void
  on(_event: string, _listener: (...args: unknown[]) => void): void
  once(_event: string, _listener: (...args: unknown[]) => void): void
} {
  return {
    protocol: { handle: (): void => {}, unhandle: (): void => {} },
    webRequest: {
      onBeforeRequest: (): void => {},
      onHeadersReceived: (): void => {},
      onBeforeSendHeaders: (): void => {}
    },
    cookies: { flushStore: async (): Promise<void> => {} },
    clearStorageData: async (): Promise<void> => {},
    clearCache: async (): Promise<void> => {},
    clearCodeCaches: async (): Promise<void> => {},
    flushStorageData: (): void => {},
    setProxy: async (): Promise<void> => {},
    setPermissionRequestHandler: (): void => {},
    setPermissionCheckHandler: (): void => {},
    setDisplayMediaRequestHandler: (): void => {},
    setDevicePermissionHandler: (): void => {},
    setBluetoothPairingHandler: (): void => {},
    removeAllListeners: (): void => {},
    on: (): void => {},
    once: (): void => {}
  }
}

const partitionSessions = new Map<string, ReturnType<typeof createSessionStub>>()
const defaultSession = createSessionStub()

export const session = {
  defaultSession,
  fromPartition: (partition: string): ReturnType<typeof createSessionStub> => {
    const existing = partitionSessions.get(partition)
    if (existing) return existing
    const created = createSessionStub()
    partitionSessions.set(partition, created)
    return created
  }
}

/**
 * Server-side replacement for Electron `safeStorage`.
 *
 * Upstream services (Copilot, MCP OAuth, device identity) encrypt a small token
 * with this API. The browser cannot offer an OS keychain, so the server uses
 * AES-256-GCM with `APP_SECRET` (or a generated key file next to the other
 * secret material). The payload format mirrors `SecretBox` so a restored
 * `secret.key` keeps existing tokens readable.
 */
const SAFE_STORAGE_VERSION = 'v1'
const SAFE_STORAGE_KEY_BYTES = 32
let safeStorageKey: Buffer | undefined

function getSafeStorageKey(): Buffer {
  if (safeStorageKey) return safeStorageKey
  const secret = process.env.APP_SECRET?.trim()
  if (secret) {
    safeStorageKey = scryptSync(secret, 'cherry-cloud-web', SAFE_STORAGE_KEY_BYTES)
    return safeStorageKey
  }
  const keyFile = paths.secrets
  if (existsSync(keyFile)) {
    safeStorageKey = Buffer.from(readFileSync(keyFile, 'utf8').trim(), 'base64')
    return safeStorageKey
  }
  const key = randomBytes(SAFE_STORAGE_KEY_BYTES)
  mkdirSync(dirname(keyFile), { recursive: true, mode: 0o700 })
  writeFileSync(keyFile, key.toString('base64') + '\n', { mode: 0o600 })
  safeStorageKey = key
  return key
}

export const safeStorage = {
  isEncryptionAvailable: (): boolean => true,
  encryptString: (text: string): Buffer => {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', getSafeStorageKey(), iv)
    const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
    return Buffer.from(
      [
        SAFE_STORAGE_VERSION,
        iv.toString('base64'),
        cipher.getAuthTag().toString('base64'),
        ciphertext.toString('base64')
      ].join(':'),
      'utf8'
    )
  },
  decryptString: (buffer: Buffer): string => {
    const [version, iv, tag, ciphertext] = buffer.toString('utf8').split(':')
    if (version !== SAFE_STORAGE_VERSION || !iv || !tag || ciphertext === undefined) {
      throw new Error('Unsupported safeStorage payload')
    }
    const decipher = createDecipheriv('aes-256-gcm', getSafeStorageKey(), Buffer.from(iv, 'base64'))
    decipher.setAuthTag(Buffer.from(tag, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8')
  }
}

export const nativeTheme = {
  shouldUseDarkColors: false,
  themeSource: 'system' as 'system' | 'light' | 'dark'
}

/**
 * Power state lives with the OS session, which the server does not own: every
 * suspend/resume/lock hook simply never fires, and sleep prevention is a no-op.
 * `PowerService` still runs so the rest of the lifecycle keeps its shape.
 */
export const powerMonitor = {
  onBatteryPower: false,
  on: (_event: string, _listener: (...args: unknown[]) => void): typeof powerMonitor => powerMonitor,
  once: (_event: string, _listener: (...args: unknown[]) => void): typeof powerMonitor => powerMonitor,
  off: (_event: string, _listener: (...args: unknown[]) => void): typeof powerMonitor => powerMonitor,
  removeListener: (_event: string, _listener: (...args: unknown[]) => void): typeof powerMonitor => powerMonitor,
  isOnBatteryPower: (): boolean => false,
  getSystemIdleTime: (): number => 0
}

export const powerSaveBlocker = {
  start: (_type: string): number => 0,
  stop: (_id: number): void => {},
  isStarted: (_id: number): boolean => false
}

/** No windows exist server-side; callers only ever iterate or probe this API. */
export class BrowserWindow {
  static getAllWindows(): BrowserWindow[] {
    return []
  }
  static getFocusedWindow(): BrowserWindow | null {
    return null
  }
  static fromWebContents(_contents: unknown): BrowserWindow | null {
    return null
  }
  readonly webContents = { send: (_channel: string, ..._args: unknown[]): void => {}, id: 0 }
  isDestroyed(): boolean {
    return true
  }
  destroy(): void {}
  on(_event: string, _listener: (...args: unknown[]) => void): this {
    return this
  }
  once(_event: string, _listener: (...args: unknown[]) => void): this {
    return this
  }
  removeListener(_event: string, _listener: (...args: unknown[]) => void): this {
    return this
  }
  isVisible(): boolean {
    return false
  }
  show(): void {}
  hide(): void {}
  close(): void {}
  loadURL(_url: string): Promise<void> {
    return Promise.resolve()
  }
}

export default {
  app,
  ipcMain,
  dialog,
  shell,
  clipboard,
  ClipboardItem,
  nativeTheme,
  net,
  session,
  webContents,
  safeStorage,
  powerMonitor,
  powerSaveBlocker,
  BrowserWindow
}
