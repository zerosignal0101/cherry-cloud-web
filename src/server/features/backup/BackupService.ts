import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, mkdir, rm } from 'node:fs/promises'
import { hostname } from 'node:os'
import path from 'node:path'

import type { DataPaths } from '@platform/dataPaths'
import { Mutex, tryAcquire } from 'async-mutex'

import { application } from '@application'
import { loggerService } from '@logger'
import { logFailure } from '@main/core/logger/logFailure'
import { classifyStorageFailure } from '@main/services/remoteStorage/failureFacts'
import {
  BACKUP_ACTIVE_WRITERS_ERROR_CODE,
  BACKUP_BACKGROUND_TASKS_ERROR_CODE,
  BACKUP_OPERATION_BUSY_ERROR_CODE,
  type BackupFileInfo,
  type BackupProgress,
  type BackupRestoreResult,
  type BackupSecretKey,
  type BackupSecretStatus,
  type ManualRemoteBackupResult,
  type S3Config,
  type WebDavConfig
} from '@shared/types/backup'
import type { FailureFacts } from '@shared/types/errorReporting'

import type { DatabaseHandle } from '../../data/database'
import { createBackupArchive, extractBackupArchive, writeRestoreJournal } from './archive'
import type { BackupManifest } from './manifest'
import { assertRemoteFileName, cleanupOldBackups, S3Remote, WebDavRemote } from './remote'
import type { RestoreJournal } from './restoreGate'

const logger = loggerService.withContext('BackupService')

const QUIESCE_TIMEOUT_MS = 30_000
const SECRET_WEBDAV_PASSWORD: BackupSecretKey = 'webdav.password'
const SECRET_S3_ACCESS_KEY: BackupSecretKey = 's3.secret_access_key'
const LEGACY_WEBDAV_PREFERENCE = 'data.backup.webdav.pass'
const LEGACY_S3_PREFERENCE = 'data.backup.s3.secret_access_key'

export class BackupOperationBusyError extends Error {
  constructor() {
    super(`${BACKUP_OPERATION_BUSY_ERROR_CODE}: Another backup operation is already in progress.`)
    this.name = 'BackupOperationBusyError'
  }
}

export class BackupActiveWritersError extends Error {
  constructor() {
    super(
      `${BACKUP_ACTIVE_WRITERS_ERROR_CODE}: A conversation or background job is still running. Wait for it to finish and retry.`
    )
    this.name = 'BackupActiveWritersError'
  }
}

export interface BackupServiceOptions {
  dataPaths: DataPaths
  database: DatabaseHandle
  secretStore: {
    has(name: string): boolean
    get(name: string): string | undefined
    set(name: string, value: string): void
    delete(name: string): boolean
  }
  appVersion: string
  migrationsDir: string
}

export class BackupService {
  private readonly operationMutex = new Mutex()
  private readonly dataPaths: DataPaths
  private readonly database: DatabaseHandle
  private readonly secretStore: BackupServiceOptions['secretStore']
  private readonly appVersion: string
  private readonly migrationsDir: string
  private activeAbortController: AbortController | null = null
  private onManualBackupCompleted: ((type: 'webdav' | 's3') => void) | null = null

  constructor(options: BackupServiceOptions) {
    this.dataPaths = options.dataPaths
    this.database = options.database
    this.secretStore = options.secretStore
    this.appVersion = options.appVersion
    this.migrationsDir = options.migrationsDir
  }

  /** Wired after the auto-backup scheduler starts; manual runs reset its timer. */
  setManualCompletionHandler(handler: (type: 'webdav' | 's3') => void): void {
    this.onManualBackupCompleted = handler
  }

  /** Migrate desktop-era plaintext preferences into SecretService once per install. */
  async migrateLegacySecrets(): Promise<void> {
    await this.migrateLegacySecret(SECRET_WEBDAV_PASSWORD, LEGACY_WEBDAV_PREFERENCE)
    await this.migrateLegacySecret(SECRET_S3_ACCESS_KEY, LEGACY_S3_PREFERENCE)
  }

  getSecretStatus(): BackupSecretStatus {
    return {
      webdavPassword: this.secretStore.has(SECRET_WEBDAV_PASSWORD),
      s3SecretAccessKey: this.secretStore.has(SECRET_S3_ACCESS_KEY)
    }
  }

  setSecret(key: BackupSecretKey, value: string): void {
    this.secretStore.set(key, value)
  }

  clearSecret(key: BackupSecretKey): void {
    this.secretStore.delete(key)
  }

  async checkWebdav(signal?: AbortSignal): Promise<boolean> {
    return this.runExclusive(async () => {
      this.assertNoLiveWriters()
      const remote = await this.webdavRemote()
      return remote.check(signal)
    })
  }

  async checkS3(signal?: AbortSignal): Promise<boolean> {
    return this.runExclusive(async () => {
      this.assertNoLiveWriters()
      const remote = await this.s3Remote()
      return remote.check(signal)
    })
  }

  async backupToWebdav(fileName: string | undefined, signal?: AbortSignal): Promise<ManualRemoteBackupResult> {
    return this.runExclusive(async () => {
      const config = this.readWebdavConfig()
      const remote = new WebDavRemote({ ...config, webdavPass: this.requireSecret('webdav.password') })
      return this.performRemoteBackup(
        'webdav',
        fileName,
        remote.upload.bind(remote),
        remote.list.bind(remote),
        remote.remove.bind(remote),
        config.maxBackups ?? 0,
        signal
      )
    })
  }

  async backupToS3(fileName: string | undefined, signal?: AbortSignal): Promise<ManualRemoteBackupResult> {
    return this.runExclusive(async () => {
      const config = this.readS3Config()
      const remote = new S3Remote({ ...config, secretAccessKey: this.requireSecret('s3.secret_access_key') })
      return this.performRemoteBackup(
        's3',
        fileName,
        remote.upload.bind(remote),
        remote.list.bind(remote),
        remote.remove.bind(remote),
        config.maxBackups,
        signal
      )
    })
  }

  async listWebdavFiles(signal?: AbortSignal): Promise<BackupFileInfo[]> {
    return (await this.webdavRemote()).list(signal)
  }

  async listS3Files(signal?: AbortSignal): Promise<BackupFileInfo[]> {
    return (await this.s3Remote()).list(signal)
  }

  async deleteWebdavFile(fileName: string, signal?: AbortSignal): Promise<boolean> {
    assertRemoteFileName(fileName)
    return (await this.webdavRemote()).remove(fileName, signal)
  }

  async deleteS3File(fileName: string, signal?: AbortSignal): Promise<boolean> {
    assertRemoteFileName(fileName)
    return (await this.s3Remote()).remove(fileName, signal)
  }

  async restoreFromWebdav(fileName: string, signal?: AbortSignal): Promise<BackupRestoreResult> {
    assertRemoteFileName(fileName)
    return this.runExclusive(async () => {
      const remote = await this.webdavRemote()
      return this.stageRestore(fileName, (target) => remote.download(fileName, target, signal), signal)
    })
  }

  async restoreFromS3(fileName: string, signal?: AbortSignal): Promise<BackupRestoreResult> {
    assertRemoteFileName(fileName)
    return this.runExclusive(async () => {
      const remote = await this.s3Remote()
      return this.stageRestore(fileName, (target) => remote.download(fileName, target, signal), signal)
    })
  }

  /** Abort a running manual/automatic operation during server shutdown. */
  abort(reason = 'Server shutting down'): void {
    this.activeAbortController?.abort(new DOMException(reason, 'AbortError'))
  }

  private async performRemoteBackup(
    type: 'webdav' | 's3',
    fileName: string | undefined,
    upload: (filePath: string, fileName: string, signal?: AbortSignal) => Promise<void>,
    list: (signal?: AbortSignal) => Promise<BackupFileInfo[]>,
    remove: (fileName: string, signal?: AbortSignal) => Promise<boolean>,
    maxBackups: number,
    signal?: AbortSignal
  ): Promise<ManualRemoteBackupResult> {
    this.assertNoLiveWriters()
    const archive = await this.createArchive(signal)
    const remoteName = assertRemoteFileName(fileName ?? path.basename(archive.filePath))
    try {
      this.emitProgress({ operation: 'backup', stage: 'uploading', progress: 90, total: 100 })
      await upload(archive.filePath, remoteName, signal)
      this.emitProgress({ operation: 'backup', stage: 'completed', progress: 100, total: 100 })
      const cleanupError = await cleanupOldBackups(maxBackups, await list(signal), (name) => remove(name, signal))
      this.onManualBackupCompleted?.(type)
      return { fileName: remoteName, cleanupFailed: cleanupError !== null }
    } catch (error) {
      logFailure(logger, 'Remote backup failed', error, `backup.${type}`, this.classifyFailure(error))
      throw error
    } finally {
      await rm(path.dirname(archive.filePath), { recursive: true, force: true }).catch(() => {})
    }
  }

  private async createArchive(
    signal?: AbortSignal
  ): Promise<{ filePath: string; manifest: BackupManifest; size: number }> {
    this.activeAbortController = new AbortController()
    const operationSignal = signal
      ? AbortSignal.any([signal, this.activeAbortController.signal])
      : this.activeAbortController.signal
    const workDir = path.join(this.dataPaths.backupTemp, `create-${randomUUID()}`)
    await mkdir(workDir, { recursive: true, mode: 0o700 })
    await chmod(workDir, 0o700)
    const filePath = path.join(workDir, this.defaultFileName())

    try {
      return await this.withWriterQuiesce(operationSignal, () =>
        createBackupArchive({
          dataRoot: this.dataPaths.root,
          database: this.database,
          outputPath: filePath,
          appVersion: this.appVersion,
          signal: operationSignal,
          onProgress: (progress) => this.emitProgress(progress)
        })
      )
    } catch (error) {
      await rm(workDir, { recursive: true, force: true }).catch(() => {})
      throw error
    } finally {
      this.activeAbortController = null
    }
  }

  private async stageRestore(
    fileName: string,
    download: (target: string) => Promise<void>,
    signal?: AbortSignal
  ): Promise<BackupRestoreResult> {
    if (existsSync(this.dataPaths.restoreJournal)) {
      throw new Error('Another restore is already staged. Restart the server before staging a new restore.')
    }
    const restoreId = randomUUID()
    const workDir = path.join(this.dataPaths.backupTemp, `restore-${restoreId}`)
    const archivePath = path.join(workDir, 'backup.zip')
    const stagingPath = path.join(this.dataPaths.restoreStaging, restoreId)
    await mkdir(workDir, { recursive: true, mode: 0o700 })
    await chmod(workDir, 0o700)

    try {
      this.emitProgress({ operation: 'restore', stage: 'downloading', progress: 5, total: 100 })
      await download(archivePath)
      signal?.throwIfAborted()
      const extracted = await extractBackupArchive({
        archivePath,
        stagingDir: stagingPath,
        migrationsDir: this.migrationsDir,
        signal,
        onProgress: (progress) => this.emitProgress(progress)
      })

      const journal: RestoreJournal = {
        version: 1,
        restoreId,
        createdAt: new Date().toISOString(),
        fileName,
        appVersion: this.appVersion,
        state: 'ready',
        stagingPath: path.relative(this.dataPaths.root, extracted.stagingDir),
        manifest: extracted.manifest
      }
      await writeRestoreJournal(this.dataPaths.restoreJournal, journal)
      logger.info('Restore staged; server restart required to promote it', {
        restoreId,
        fileName
      })
      this.emitProgress({ operation: 'restore', stage: 'completed', progress: 100, total: 100 })
      return {
        restoreId,
        fileName,
        createdAt: journal.createdAt,
        requiresRestart: true
      }
    } catch (error) {
      await rm(stagingPath, { recursive: true, force: true }).catch(() => {})
      await rm(this.dataPaths.restoreJournal, { force: true }).catch(() => {})
      throw error
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  private async withWriterQuiesce<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    const holds: Array<{ dispose(): void }> = []
    const lifecycle = application.getOptional('AgentLifecycleService') as
      | {
          pauseIngress(reason?: string): { dispose(): void }
          pauseExecution(reason?: string): { dispose(): void }
          drainIngress(options: { timeoutMs: number }): Promise<{ stragglerIds: string[] }>
          drainInFlight(options: { timeoutMs: number }): Promise<{ stragglerIds: string[] }>
        }
      | undefined
    const aiStreams = application.getOptional('AiStreamManager') as
      | {
          pause(reason?: string): { dispose(): void }
          drainInFlight(options: { timeoutMs: number }): Promise<{ stragglerIds: string[] }>
        }
      | undefined
    const agentJobs = application.getOptional('AgentJobsService') as
      | {
          pause(reason?: string): { dispose(): void }
          drainInFlight(options: { timeoutMs: number }): Promise<{ settled: boolean }>
        }
      | undefined
    const jobs = application.getOptional('JobManager') as
      | {
          pause(reason?: string): { dispose(): void }
          drainInFlight(options: {
            timeoutMs: number
          }): Promise<{ stragglerIds: string[]; startupRecoveryPending: boolean }>
        }
      | undefined

    try {
      const ingressHold = lifecycle?.pauseIngress('backup: capture consistent snapshot')
      if (ingressHold) holds.push(ingressHold)
      if (lifecycle) {
        const verdict = await lifecycle.drainIngress({ timeoutMs: QUIESCE_TIMEOUT_MS })
        if (verdict.stragglerIds.length > 0) throw this.backgroundTasksError()
      }

      const streamHold = aiStreams?.pause('backup: capture consistent snapshot')
      if (streamHold) holds.push(streamHold)
      const executionHold = lifecycle?.pauseExecution('backup: capture consistent snapshot')
      if (executionHold) holds.push(executionHold)
      const agentJobsHold = agentJobs?.pause('backup: capture consistent snapshot')
      if (agentJobsHold) holds.push(agentJobsHold)
      const jobsHold = jobs?.pause('backup: capture consistent snapshot')
      if (jobsHold) holds.push(jobsHold)

      const verdicts = await Promise.all([
        aiStreams?.drainInFlight({ timeoutMs: QUIESCE_TIMEOUT_MS }),
        lifecycle?.drainInFlight({ timeoutMs: QUIESCE_TIMEOUT_MS }),
        agentJobs?.drainInFlight({ timeoutMs: QUIESCE_TIMEOUT_MS }),
        jobs?.drainInFlight({ timeoutMs: QUIESCE_TIMEOUT_MS })
      ])
      if (
        verdicts.some((verdict) => {
          if (!verdict) return false
          if ('settled' in verdict) return !verdict.settled
          return (
            verdict.stragglerIds.length > 0 ||
            ('startupRecoveryPending' in verdict && verdict.startupRecoveryPending === true)
          )
        })
      ) {
        throw this.backgroundTasksError()
      }
      signal.throwIfAborted()

      const cache = application.getOptional('CacheService') as { flushPersistForBackup?(): void } | undefined
      cache?.flushPersistForBackup?.()

      return await operation()
    } finally {
      for (const hold of holds.reverse()) {
        try {
          hold.dispose()
        } catch (error) {
          logger.warn('Failed to release backup writer hold', { error })
        }
      }
    }
  }

  private async webdavRemote(): Promise<WebDavRemote> {
    return new WebDavRemote({ ...this.readWebdavConfig(), webdavPass: this.requireSecret('webdav.password') })
  }

  private async s3Remote(): Promise<S3Remote> {
    return new S3Remote({ ...this.readS3Config(), secretAccessKey: this.requireSecret('s3.secret_access_key') })
  }

  private readWebdavConfig(): WebDavConfig {
    const preferences = application.get('PreferenceService')
    const config: WebDavConfig = {
      webdavHost: preferences.get('data.backup.webdav.host'),
      webdavUser: preferences.get('data.backup.webdav.user'),
      webdavPath: preferences.get('data.backup.webdav.path'),
      maxBackups: preferences.get('data.backup.webdav.max_backups'),
      disableStream: preferences.get('data.backup.webdav.disable_stream'),
      allowSelfSignedTls: preferences.get('data.backup.webdav.allow_self_signed_tls') ?? false
    }
    if (!config.webdavHost?.trim()) throw new Error('WebDAV host is not configured')
    return config
  }

  private readS3Config(): S3Config {
    const preferences = application.get('PreferenceService')
    const config: S3Config = {
      endpoint: preferences.get('data.backup.s3.endpoint'),
      region: preferences.get('data.backup.s3.region'),
      bucket: preferences.get('data.backup.s3.bucket'),
      accessKeyId: preferences.get('data.backup.s3.access_key_id'),
      secretAccessKey: '',
      root: preferences.get('data.backup.s3.root'),
      autoSync: preferences.get('data.backup.s3.auto_sync'),
      syncInterval: preferences.get('data.backup.s3.sync_interval'),
      maxBackups: preferences.get('data.backup.s3.max_backups')
    }
    if (!config.endpoint?.trim() || !config.bucket?.trim() || !config.accessKeyId?.trim()) {
      throw new Error('S3 endpoint, bucket and access key are required')
    }
    return config
  }

  private requireSecret(key: BackupSecretKey): string {
    const value = this.secretStore.get(key)
    if (!value) {
      throw new Error(
        key === SECRET_WEBDAV_PASSWORD ? 'WebDAV password is not configured' : 'S3 secret access key is not configured'
      )
    }
    return value
  }

  private async migrateLegacySecret(key: BackupSecretKey, preferenceKey: string): Promise<void> {
    if (this.secretStore.has(key)) return
    const value = application.get('PreferenceService').get(preferenceKey)
    if (typeof value !== 'string' || value.length === 0) return
    this.secretStore.set(key, value)
    await application.get('PreferenceService').set(preferenceKey, '')
    logger.info('Migrated legacy backup credential into SecretService', { key })
  }

  private assertNoLiveWriters(): void {
    const aiStreams = application.getOptional('AiStreamManager') as { hasLiveStreams?(): boolean } | undefined
    const lifecycle = application.getOptional('AgentLifecycleService') as
      | { listActiveWork?(): Array<unknown> }
      | undefined
    if (aiStreams?.hasLiveStreams?.() || (lifecycle?.listActiveWork?.().length ?? 0) > 0) {
      throw new BackupActiveWritersError()
    }
  }

  private defaultFileName(): string {
    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
    const host = hostname().replace(/[^A-Za-z0-9._-]/g, '-')
    return `cherry-cloud-web.${stamp}.${host || 'server'}.zip`
  }

  private emitProgress(progress: BackupProgress): void {
    try {
      application.getOptional('IpcApiService')?.broadcast('backup.progress', progress)
    } catch (error) {
      logger.debug('Failed to broadcast backup progress', { error })
    }
  }

  private async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await tryAcquire(this.operationMutex, new BackupOperationBusyError()).runExclusive(operation)
    } catch (error) {
      if (error instanceof BackupOperationBusyError) throw error
      logFailure(logger, 'Backup operation failed', error, 'backup.operation', this.classifyFailure(error))
      throw error
    }
  }

  private classifyFailure(error: unknown): FailureFacts {
    if (error instanceof BackupActiveWritersError) {
      return { source: 'application', kind: 'expected', reason: 'backup_precondition', outcome: 'failed' }
    }
    const storage = classifyStorageFailure(error)
    if (storage.kind === 'expected') return storage
    return { source: 'application', kind: 'reliability', reason: 'backup_failed', outcome: 'failed' }
  }

  private backgroundTasksError(): Error {
    return new Error(`${BACKUP_BACKGROUND_TASKS_ERROR_CODE}: Background data writes did not quiesce in time.`)
  }
}
