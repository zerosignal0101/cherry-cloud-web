/**
 * Headless stand-in for the Electron `Application` singleton.
 *
 * Upstream `src/main/data/**` reaches the database through
 * `application.get('DbService')` and resolves data directories through
 * `application.getPath(...)`. This module provides exactly those two seams for
 * the server process, without the Electron lifecycle (preboot, windows, quit
 * guards) that `src/main/core/application/Application.ts` orchestrates.
 *
 * The server owns registration: `src/server/data/database.ts` registers the
 * database handle as `DbService` during bootstrap. Services that reach for a
 * service nobody registered get `undefined` back from `getOptional` rather than
 * a silently-created instance.
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'

import type { DbOrTx, DbType } from '@data/db/types'

import { resolveDataDir, resolveDataPaths, type DataPaths } from './dataPaths'

/**
 * The one service upstream data code resolves by name. Typed structurally rather
 * than as the `DbService` class so this module stays free of the lifecycle
 * container; `src/server/data/database.ts` provides an implementation.
 */
export interface SqliteDatabaseService {
  readonly isReady: boolean
  getDb(): DbType
  withWriteTx<T>(fn: (tx: DbOrTx) => T): T
}

/**
 * `CacheService` is the one upstream service whose call sites pass a type
 * argument through `application.get(...)` (`cache.get<T>(key)`). Typing it
 * here keeps those generic calls compiling; everything else stays `any` because
 * the server registers instances by name and code that needs a real type
 * imports the module that owns the service.
 */
export interface CacheServiceLike {
  get<T = unknown>(key: string): T | undefined
  set<T = unknown>(key: string, value: T, ttlMs?: number): void
  has(key: string): boolean
  delete(key: string): boolean
  getShared<T = unknown>(key: string): T | undefined
  setShared<T = unknown>(key: string, value: T, ttlMs?: number): void
  hasShared(key: string): boolean
  deleteShared(key: string): boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getPersist(key: string): any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setPersist(key: string, value: any): void
  hasPersist(key: string): boolean
  deletePersist(key: string): void
  getListenerCount(key?: string): number
}

/**
 * Service name → instance. Deliberately open: every other upstream data service
 * only ever asks for `DbService`, and a name nobody registered fails loudly in
 * `get()`. Server code that wants a typed handle imports the module that owns
 * the service instead of going through this map.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface WebServiceMap {
  DbService: SqliteDatabaseService
  CacheService: CacheServiceLike
  [name: string]: any
}

export class WebApplication {
  private readonly services = new Map<string, unknown>()
  private readonly ensuredPaths = new Set<string>()
  private dataPaths: DataPaths

  constructor(dataDir?: string) {
    this.dataPaths = resolveDataPaths(dataDir ?? resolveDataDir())
  }

  /** Point the path registry at `DATA_DIR`; called once during server bootstrap. */
  setDataDir(dataDir: string): void {
    this.dataPaths = resolveDataPaths(dataDir)
    this.ensuredPaths.clear()
  }

  register<K extends string>(name: K, service: WebServiceMap[K]): void {
    if (this.services.has(name)) {
      throw new Error(`Service '${String(name)}' is already registered`)
    }
    this.services.set(name, service)
  }

  unregister(name: string): void {
    this.services.delete(name)
  }

  get<K extends string>(name: K): WebServiceMap[K] {
    const service = this.services.get(name)
    if (service === undefined) {
      throw new Error(`Service '${String(name)}' is not registered`)
    }
    return service
  }

  getOptional<K extends string>(name: K): WebServiceMap[K] | undefined {
    return this.services.get(name)
  }

  /** Upstream calls this on services that may legitimately be absent. */
  getExisting<K extends string>(name: K): WebServiceMap[K] | undefined {
    return this.getOptional(name)
  }

  isReady(): boolean {
    return true
  }

  /**
   * Resolve a registered data path. The key set is upstream's `PathKey`; the web
   * build only wires the keys its data layer actually reads, and unknown keys
   * resolve under `DATA_DIR` so a stray consumer fails visibly on content rather
   * than throwing during bootstrap.
   */
  getPath(key: string, filename?: string): string {
    const base = this.resolveKey(key)
    if (!this.ensuredPaths.has(base)) {
      mkdirSync(key.endsWith('file') ? path.dirname(base) : base, { recursive: true })
      this.ensuredPaths.add(base)
    }
    return filename === undefined ? base : path.join(base, filename)
  }

  private resolveKey(key: string): string {
    const known: Record<string, string> = {
      'app.userdata': this.dataPaths.root,
      'app.userdata.data': this.dataPaths.root,
      'app.database.file': this.dataPaths.database,
      'app.database.migrations': path.resolve(process.cwd(), 'migrations/sqlite-drizzle'),
      'app.logs': this.dataPaths.logs,
      'app.temp': path.join(this.dataPaths.root, 'tmp'),
      'app.root': process.cwd(),
      'app.root.resources': path.resolve(process.cwd(), 'resources'),
      'app.extra_resources': path.resolve(process.cwd(), 'resources'),
      'sys.home': process.cwd(),
      'feature.files.data': this.dataPaths.files,
      'feature.files.trash': path.join(this.dataPaths.files, '.trash'),
      'feature.provider_registry.override': this.dataPaths.providerRegistry
    }
    return known[key] ?? path.join(this.dataPaths.root, key)
  }
}

/**
 * Lazily-initialized singleton, mirroring the upstream export shape so
 * `import { application } from '@application'` keeps working unchanged.
 */
export const application: WebApplication = new WebApplication()
