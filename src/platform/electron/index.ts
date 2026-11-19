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

export const nativeTheme = {
  shouldUseDarkColors: false,
  themeSource: 'system' as 'system' | 'light' | 'dark'
}

export default { app, ipcMain, dialog, shell, clipboard, ClipboardItem, nativeTheme }
