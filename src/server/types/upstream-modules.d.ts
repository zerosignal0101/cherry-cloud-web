/**
 * Type-level stand-ins for modules the upstream tree imports but the web server
 * never executes.
 *
 * - `@cherrystudio/computer-use` drives a real desktop; the web build has no
 *   target for it and the service that imports it is not registered.
 * - `registry-js` and `@paymoapp/electron-shutdown-handler` are Windows-only
 *   native addons, imported lazily behind platform checks.
 * - `@napi-rs/system-ocr` is the platform OCR binding behind the desktop
 *   `system` processor; it is never loaded on the Linux server.
 * - `?raw` / `?nodeWorker` are Electron Vite import queries. The server build
 *   resolves them in `vite.server.config.ts`; these declarations give the type
 *   checker the shapes those imports produce.
 */

declare module '@cherrystudio/computer-use' {
  export type Action = any
  export type AppInfo = any
  export type AppSession = any
  export type ComputerUseClient = any
  export type Element = any
  export type ObserveInput = any
  export type PermissionStatus = any
  export type Snapshot = any
  /**
   * `start` is typed (not `any`) so `task.client ??= ComputerUse.start(...)`
   * narrows to `Promise<ComputerUseClient>` instead of staying optional.
   */
  export const ComputerUse: {
    start(input: { runtimePath: string }, options?: { signal?: AbortSignal }): Promise<ComputerUseClient>
    [key: string]: any
  }
  /**
   * Declared as a class rather than `any` so `error instanceof ComputerUseError`
   * narrows `unknown` catch variables in the automation services.
   */
  export class ComputerUseError extends Error {
    constructor(code: string, message: string, options?: { effect?: string; cause?: unknown })
    readonly code: string
  }
}

declare module 'registry-js' {
  export const HKEY: any
  export const RegistryValueType: any
  export function enumerateValuesSafe(...args: any[]): any[]
}

/**
 * Platform OCR binding for the desktop `system` processor. It is a native addon
 * the web build does not ship; the processor's `isSupported()` keeps it off the
 * list on Linux, and its handler catches a failed lazy import with a readable
 * error. The declaration only lets the file-processing registry type-check.
 */
declare module '@napi-rs/system-ocr' {
  export const OcrAccuracy: { Fast: number; Accurate: number }
  export function recognize(
    image: string | Uint8Array,
    accuracy: number,
    langs?: string[],
    signal?: AbortSignal
  ): Promise<{ text: string }>
}

declare module '@paymoapp/electron-shutdown-handler' {
  export interface ShutdownHandler {
    setWindowHandle(window: unknown): void
    start(): void
    stop(): void
    on(event: 'shutdown', callback: () => void): void
    removeAllListeners(): void
    blockShutdown(reason: string): void
    releaseShutdown(): void
  }
  const handler: ShutdownHandler
  export default handler
}

declare module '*?raw' {
  const content: string
  export default content
}

declare module '*?nodeWorker' {
  import type { Worker } from 'node:worker_threads'

  const createWorker: (options: {
    workerData: unknown
    // Electron Vite types this as `NodeJS.ProcessEnv`, so callers may spread
    // `process.env` (whose values can be `undefined`).
    env?: NodeJS.ProcessEnv
  }) => Worker
  export default createWorker
}

/** The main build replaces `import.meta.env` with build-time values. */
interface ImportMeta {
  readonly env: Record<string, string | undefined>
}
