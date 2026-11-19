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
  getVersion: (): string => process.env.APP_VERSION ?? '0.0.0',
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
  showErrorBox: (): void => {}
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

export const session = {
  defaultSession: {
    webRequest: {
      onBeforeSendHeaders: (_listener: unknown): void => {}
    }
  },
  fromPartition: (_partition: string): typeof session.defaultSession => session.defaultSession
}

/** The server has no OS keychain; encrypted-at-rest secrets are not supported. */
export const safeStorage = {
  isEncryptionAvailable: (): boolean => false,
  encryptString: (_text: string): Buffer => {
    throw new Error('safeStorage is not available in the web build')
  },
  decryptString: (_buffer: Buffer): string => {
    throw new Error('safeStorage is not available in the web build')
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
  removeListener: (_event: string, _listener: (...args: unknown[]) => void): typeof powerMonitor =>
    powerMonitor,
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
  safeStorage,
  powerMonitor,
  powerSaveBlocker,
  BrowserWindow
}

