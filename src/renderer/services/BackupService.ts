/**
 * @deprecated v2 replacement pending. The retained v1 engine currently creates real compatibility
 * archives containing Data, IndexedDB, Local Storage, and cache.json.
 */
//TODO Data Refactor
// The code is messy, need to refactor all the backup related code

import dayjs from 'dayjs'

import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { getBackupErrorTitleKey, getLocalizedBackupErrorMessage } from '@renderer/utils/backup'
import { uuid } from '@renderer/utils/uuid'
import type { AutoBackupType } from '@shared/types/backup'

import { notificationService } from './notification'

const logger = loggerService.withContext('BackupService')

export interface RemoteSyncState {
  lastSyncTime: number | null
  syncing: boolean
  lastSyncError: string | null
}

let backupSyncState: Record<AutoBackupType, RemoteSyncState> = {
  webdav: { lastSyncTime: null, syncing: false, lastSyncError: null },
  s3: { lastSyncTime: null, syncing: false, lastSyncError: null },
  local: { lastSyncTime: null, syncing: false, lastSyncError: null },
  nutstore: { lastSyncTime: null, syncing: false, lastSyncError: null }
}
const backupSyncListeners = new Set<() => void>()

export const getBackupSyncState = () => backupSyncState
export const subscribeBackupSyncState = (listener: () => void) => {
  backupSyncListeners.add(listener)
  return () => backupSyncListeners.delete(listener)
}

export const setBackupSyncState = (type: AutoBackupType, patch: Partial<RemoteSyncState>) => {
  backupSyncState = { ...backupSyncState, [type]: { ...backupSyncState[type], ...patch } }
  backupSyncListeners.forEach((listener) => listener())
}

export async function recordManualBackupCompletion(type: AutoBackupType): Promise<void> {
  try {
    await ipcApi.request('backup.manual_completion.record', { type })
  } catch (error) {
    logger.error('Failed to record manual backup completion', error as Error)
  }
}

const setWebDAVSyncState = (patch: Partial<RemoteSyncState>) => setBackupSyncState('webdav', patch)
const setS3SyncState = (patch: Partial<RemoteSyncState>) => setBackupSyncState('s3', patch)
const setLocalBackupSyncState = (patch: Partial<RemoteSyncState>) => setBackupSyncState('local', patch)

type ManualBackupOptions = { customFileName?: string }

export async function backup(skipBackupFile = false) {
  const filename = `cherry-studio.${dayjs().format('YYYYMMDDHHmm')}.zip`
  const selectFolder = await window.api.file.selectFolder()
  if (selectFolder) {
    // Use the direct compatibility archive with the selected full or slim resource set.
    await window.api.backup.backup(filename, selectFolder, skipBackupFile)
    toast.success(i18n.t('message.backup.success'))
  }
}

export async function restore() {
  // notificationService is imported as a module-level singleton
  const file = await window.api.file.open({ filters: [{ name: '备份文件', extensions: ['zip'] }] })

  if (file) {
    try {
      await window.api.backup.restore(file.filePath)

      void notificationService.send({
        id: uuid(),
        type: 'success',
        title: i18n.t('common.success'),
        message: i18n.t('message.restore.success'),
        silent: false,
        timestamp: Date.now(),
        source: 'backup'
      })
      // The main process has committed the restore journal and will relaunch.
      return
    } catch (error) {
      logger.error('restore: Error restoring backup file:', error as Error)
      void popup.error({
        title: i18n.t(getBackupErrorTitleKey(error)),
        content: getLocalizedBackupErrorMessage(error, 'error.backup.file_format'),
        centered: true
      })
    }
  }
}

// 备份到 webdav
export async function backupToWebdav({ customFileName = '' }: ManualBackupOptions = {}) {
  setWebDAVSyncState({ syncing: true, lastSyncError: null })

  const finalFileName = customFileName
    ? customFileName.endsWith('.zip')
      ? customFileName
      : `${customFileName}.zip`
    : undefined

  try {
    const { cleanupFailed } = await window.api.backup.backupToWebdav({ fileName: finalFileName })
    await recordManualBackupCompletion('webdav')
    if (cleanupFailed) {
      const message = i18n.t('message.backup.cleanup_failed')
      setWebDAVSyncState({ lastSyncError: message })
      toast.warning(message)
    } else {
      setWebDAVSyncState({ lastSyncError: null })
      toast.success(i18n.t('message.backup.success'))
    }
  } catch (error: any) {
    const message = getLocalizedBackupErrorMessage(error, 'message.backup.failed', { tlsCertificateHint: true })
    setWebDAVSyncState({ lastSyncError: message })
    toast.error(message)
    logger.error('[Backup] backupToWebdav: Error uploading file to WebDAV:', error)
  } finally {
    setWebDAVSyncState({ lastSyncTime: Date.now(), syncing: false })
  }
}

// 从 webdav 恢复
export async function restoreFromWebdav(fileName?: string) {
  if (!fileName) throw new Error('A backup file name is required')
  await window.api.backup.restoreFromWebdav({ fileName })
  toast.warning(i18n.t('message.restore.restart_required'))
  logger.info('[WebDAVBackup] Restore staged; server restart required')
}

export async function backupToS3({ customFileName = '' }: ManualBackupOptions = {}) {
  setS3SyncState({ syncing: true, lastSyncError: null })

  const finalFileName = customFileName
    ? customFileName.endsWith('.zip')
      ? customFileName
      : `${customFileName}.zip`
    : undefined

  try {
    const { cleanupFailed } = await window.api.backup.backupToS3({ fileName: finalFileName })

    await recordManualBackupCompletion('s3')
    if (cleanupFailed) {
      const message = i18n.t('message.backup.cleanup_failed')
      setS3SyncState({ lastSyncError: message })
      toast.warning(message)
    } else {
      setS3SyncState({ lastSyncError: null })
      toast.success(i18n.t('message.backup.success'))
    }
  } catch (error: any) {
    const message = getLocalizedBackupErrorMessage(error)
    setS3SyncState({ lastSyncError: message })
    logger.error('backupToS3: Error uploading file to S3:', error)
    toast.error(message)
  } finally {
    setS3SyncState({ lastSyncTime: Date.now(), syncing: false })
  }
}

// 从 S3 恢复
export async function restoreFromS3(fileName?: string) {
  if (!fileName) {
    const files = await window.api.backup.listS3Files()
    fileName = files[0]?.fileName
  }

  if (fileName) {
    await window.api.backup.restoreFromS3({ fileName })
    toast.warning(i18n.t('message.restore.restart_required'))
    logger.info('[S3Backup] Restore staged; server restart required')
  }
}

/**
 * Backup to local directory
 */
export async function backupToLocal({ customFileName = '' }: ManualBackupOptions = {}) {
  setLocalBackupSyncState({ syncing: true, lastSyncError: null })

  const { localBackupDirSetting, localBackupMaxBackups, localBackupSkipBackupFile } =
    await preferenceService.getMultiple({
      localBackupDirSetting: 'data.backup.local.dir',
      localBackupMaxBackups: 'data.backup.local.max_backups',
      localBackupSkipBackupFile: 'data.backup.local.skip_backup_file'
    })
  const localBackupDir = await window.api.resolvePath(localBackupDirSetting)
  const finalFileName = customFileName
    ? customFileName.endsWith('.zip')
      ? customFileName
      : `${customFileName}.zip`
    : undefined

  try {
    // Use direct backup method (copy IndexedDB/LocalStorage directories)
    const { result, cleanupFailed } = await window.api.backup.backupToLocalDir(finalFileName, {
      localBackupDir,
      maxBackups: localBackupMaxBackups,
      skipBackupFile: localBackupSkipBackupFile
    })

    if (result) {
      await recordManualBackupCompletion('local')
      if (cleanupFailed) {
        const message = i18n.t('message.backup.cleanup_failed')
        setLocalBackupSyncState({ lastSyncError: message })
        toast.warning(message)
      } else {
        setLocalBackupSyncState({ lastSyncError: null })
      }
    } else {
      const message = i18n.t('message.backup.failed')
      setLocalBackupSyncState({
        lastSyncError: message
      })
      void popup.error({ title: message, content: message })
    }

    return result
  } catch (error: any) {
    logger.error('[LocalBackup] Backup failed:', error)
    const message = getLocalizedBackupErrorMessage(error)

    setLocalBackupSyncState({
      lastSyncError: message
    })
    void popup.error({ title: i18n.t('message.backup.failed'), content: message })

    throw error
  } finally {
    setLocalBackupSyncState({ lastSyncTime: Date.now(), syncing: false })
  }
}

export async function restoreFromLocal(fileName: string) {
  const localBackupDirSetting = await preferenceService.get('data.backup.local.dir')
  const localBackupDir = await window.api.resolvePath(localBackupDirSetting)
  await window.api.backup.restoreFromLocalBackup(fileName, localBackupDir)
  logger.info('[LocalBackup] Backup restore staged, app will restart')

  return true
}
