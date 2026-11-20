/**
 * Typed surface for the browser build.
 *
 * `window.electron` is not Electron: `installWebApi()` installs an inert
 * compatibility object containing the platform/process probes and no-op IPC
 * channels that upstream renderer code still reads. It is installed before any
 * application module is evaluated, so the properties are always present at
 * runtime. No Electron types are imported here.
 */
declare global {
  interface WebElectronIpcRenderer {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>
    send(channel: string, ...args: unknown[]): void
    sendSync(channel: string, ...args: unknown[]): unknown
    sendTo(channel: string, ...args: unknown[]): void
    sendToHost(channel: string, ...args: unknown[]): void
    postMessage(channel: string, message: unknown, ...args: unknown[]): void
    on(channel: string, listener: (...args: any[]) => void): () => void
    once(channel: string, listener: (...args: any[]) => void): () => void
    addListener(channel: string, listener: (...args: any[]) => void): () => void
    removeListener(channel: string, listener: (...args: any[]) => void): void
    removeAllListeners(channel?: string): void
  }

  interface Window {
    /** Web transport facade; replaced by the IPC bridge implementation in `src/renderer/ipc`. */
    api: any
    /** Inert desktop-preload compatibility object installed by `installWebApi()`. */
    electron: {
      ipcRenderer: WebElectronIpcRenderer
      process: {
        platform: string
        env: Record<string, string | undefined>
      }
    }
  }
}

export {}
