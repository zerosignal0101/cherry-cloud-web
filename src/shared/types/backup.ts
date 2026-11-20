/**
 * Backup storage configs (WebDAV / S3). Cross-process: the renderer manages
 * these via settings UI and the main process consumes them in the backup
 * services; both sides pass them across the IPC boundary.
 */

export type WebDavConfig = {
  webdavHost: string
  webdavUser?: string
  webdavPass?: string
  webdavPath?: string
  fileName?: string
  maxBackups?: number
  skipBackupFile?: boolean
  disableStream?: boolean
  /** Opt-in: skip ALL certificate checks for this server (self-signed/private-CA, and also expired or wrong-hostname certificates). Default (unset/false) verifies. */
  allowSelfSignedTls?: boolean
}

export type LocalBackupConfig = {
  localBackupDir?: string
  maxBackups?: number
  skipBackupFile?: boolean
}

export type S3Config = {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  root?: string
  fileName?: string
  skipBackupFile?: boolean
  autoSync: boolean
  syncInterval: number
  maxBackups: number
}

export type BackupResult<T> = {
  result: T
  cleanupFailed: boolean
}

/** Remote backup targets supported by the web build (local folders and Nutstore are removed). */
export const BACKUP_REMOTE_TYPES = ['webdav', 's3'] as const
export type BackupRemoteType = (typeof BACKUP_REMOTE_TYPES)[number]

/** One server-generated backup archive listed in a remote provider. */
export type BackupFileInfo = {
  fileName: string
  modifiedTime: string
  size: number
}

/** Progress fan-out for manual/automatic backup and restore. */
export type BackupProgress = {
  operation: 'backup' | 'restore'
  stage:
    | 'preparing'
    | 'snapshot'
    | 'copying_files'
    | 'compressing'
    | 'uploading'
    | 'downloading'
    | 'extracting'
    | 'validating'
    | 'completed'
  progress: number
  total: number
}

/** Result of staging a restore; the process must restart before it is promoted. */
export type BackupRestoreResult = {
  restoreId: string
  fileName: string
  createdAt: string
  requiresRestart: true
}

/** Whether an encrypted credential is present; plaintext never crosses the RPC boundary. */
export type BackupSecretStatus = {
  webdavPassword: boolean
  s3SecretAccessKey: boolean
}

/** Both credentials remain server-side and may be rotated/cleared independently. */
export type BackupSecretKey = 'webdav.password' | 's3.secret_access_key'

export type ManualRemoteBackupResult = {
  fileName: string
  cleanupFailed: boolean
}

export const AUTO_BACKUP_TYPES = ['webdav', 's3', 'local', 'nutstore'] as const
export type AutoBackupType = (typeof AUTO_BACKUP_TYPES)[number]

export type AutoBackupEventInput =
  | { type: AutoBackupType; status: 'running' }
  | { type: AutoBackupType; status: 'stopped' }
  | { type: AutoBackupType; status: 'succeeded'; timestamp: number }
  | { type: AutoBackupType; status: 'warning'; timestamp: number; reason: 'cleanup_failed' }
  | { type: AutoBackupType; status: 'failed'; timestamp: number; errorMessage: string }

export type AutoBackupEvent = AutoBackupEventInput & { id: number }

export type AutoBackupSnapshot = {
  pendingNotifications: AutoBackupEvent[]
}

export const BACKUP_ACTIVE_WRITERS_ERROR_CODE = 'BACKUP_ACTIVE_WRITERS'
export const BACKUP_BACKGROUND_TASKS_ERROR_CODE = 'BACKUP_BACKGROUND_TASKS'
export const BACKUP_DISK_FULL_ERROR_CODE = 'BACKUP_DISK_FULL'
export const BACKUP_NEWER_VERSION_ERROR_CODE = 'BACKUP_NEWER_VERSION'
export const BACKUP_OPERATION_BUSY_ERROR_CODE = 'BACKUP_OPERATION_BUSY'

export const BACKUP_WEBDAV_TOO_LARGE_ERROR_CODE = 'BACKUP_WEBDAV_TOO_LARGE'
