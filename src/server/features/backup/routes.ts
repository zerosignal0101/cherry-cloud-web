import { backupRequestSchemas } from '@shared/ipc/schemas/backup'
import type { IpcHandlersFor } from '@shared/ipc/types'

import type { RpcRegistry } from '../../transport/registry'
import type { AutoBackupScheduler } from './AutoBackupScheduler'
import type { BackupService } from './BackupService'

export interface BackupRouteOptions {
  backup: BackupService
  scheduler: AutoBackupScheduler
}

const handlers = (options: BackupRouteOptions): IpcHandlersFor<typeof backupRequestSchemas> => ({
  'backup.get_auto_sync_state': async () => options.scheduler.getStateSnapshot(),
  'backup.acknowledge_auto_sync_notification': async ({ type, id }) => {
    options.scheduler.acknowledgeNotification(type, id)
  },
  'backup.manual_completion.record': async ({ type }) => {
    options.scheduler.recordManualBackupCompletion(type)
  },

  'backup.get_secret_status': async () => options.backup.getSecretStatus(),
  'backup.set_secret': async ({ key, value }) => {
    options.backup.setSecret(key, value)
    options.scheduler.refresh(key === 'webdav.password' ? 'webdav' : 's3')
  },
  'backup.clear_secret': async ({ key }) => {
    options.backup.clearSecret(key)
    options.scheduler.refresh(key === 'webdav.password' ? 'webdav' : 's3')
  },

  'backup.check_webdav': async () => options.backup.checkWebdav(),
  'backup.backup_to_webdav': async ({ fileName }) => options.backup.backupToWebdav(fileName),
  'backup.list_webdav_files': async () => options.backup.listWebdavFiles(),
  'backup.delete_webdav_file': async ({ fileName }) => options.backup.deleteWebdavFile(fileName),
  'backup.restore_from_webdav': async ({ fileName }) => options.backup.restoreFromWebdav(fileName),

  'backup.check_s3': async () => options.backup.checkS3(),
  'backup.backup_to_s3': async ({ fileName }) => options.backup.backupToS3(fileName),
  'backup.list_s3_files': async () => options.backup.listS3Files(),
  'backup.delete_s3_file': async ({ fileName }) => options.backup.deleteS3File(fileName),
  'backup.restore_from_s3': async ({ fileName }) => options.backup.restoreFromS3(fileName)
})

export function registerBackupRoutes(registry: RpcRegistry, options: BackupRouteOptions): void {
  registry.register(backupRequestSchemas, handlers(options))
}
