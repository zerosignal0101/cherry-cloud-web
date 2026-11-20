import * as z from 'zod'

import { AUTO_BACKUP_TYPES, type AutoBackupEvent, type BackupProgress } from '@shared/types/backup'

import { defineRoute } from '../define'

const autoBackupTypeSchema = z.enum(AUTO_BACKUP_TYPES)
const eventFields = { id: z.number().int().positive(), type: autoBackupTypeSchema }
const autoBackupEventSchema = z.discriminatedUnion('status', [
  z.object({ ...eventFields, status: z.literal('running') }),
  z.object({ ...eventFields, status: z.literal('stopped') }),
  z.object({ ...eventFields, status: z.literal('succeeded'), timestamp: z.number() }),
  z.object({
    ...eventFields,
    status: z.literal('warning'),
    timestamp: z.number(),
    reason: z.literal('cleanup_failed')
  }),
  z.object({ ...eventFields, status: z.literal('failed'), timestamp: z.number(), errorMessage: z.string() })
])

export const backupSecretKeySchema = z.enum(['webdav.password', 's3.secret_access_key'])
const secretValueSchema = z.string().min(1).max(4096)
const remoteFileNameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (value) =>
      value !== '.' &&
      value !== '..' &&
      !value.includes('/') &&
      !value.includes('\\') &&
      !value.includes('\0') &&
      value.toLowerCase().endsWith('.zip'),
    'Expected a plain .zip file name'
  )

const backupFileInfoSchema = z.object({
  fileName: z.string(),
  modifiedTime: z.string(),
  size: z.number()
})

const restoreResultSchema = z.object({
  restoreId: z.string(),
  fileName: z.string(),
  createdAt: z.string(),
  requiresRestart: z.literal(true)
})

export const backupRequestSchemas = {
  'backup.get_auto_sync_state': defineRoute({
    input: z.void(),
    output: z.object({ pendingNotifications: z.array(autoBackupEventSchema) })
  }),
  'backup.acknowledge_auto_sync_notification': defineRoute({
    input: z.object({ type: autoBackupTypeSchema, id: z.number().int().positive() }),
    output: z.void()
  }),
  'backup.manual_completion.record': defineRoute({
    input: z.object({ type: autoBackupTypeSchema }),
    output: z.void()
  }),

  /** Fragments only: values are encrypted by SecretService and never read back. */
  'backup.get_secret_status': defineRoute({
    input: z.void(),
    output: z.object({ webdavPassword: z.boolean(), s3SecretAccessKey: z.boolean() })
  }),
  'backup.set_secret': defineRoute({
    input: z.object({ key: backupSecretKeySchema, value: secretValueSchema }),
    output: z.void()
  }),
  'backup.clear_secret': defineRoute({
    input: z.object({ key: backupSecretKeySchema }),
    output: z.void()
  }),

  'backup.check_webdav': defineRoute({ input: z.void(), output: z.boolean() }),
  'backup.backup_to_webdav': defineRoute({
    input: z.object({ fileName: remoteFileNameSchema.optional() }),
    output: z.object({ fileName: z.string(), cleanupFailed: z.boolean() })
  }),
  'backup.list_webdav_files': defineRoute({ input: z.void(), output: z.array(backupFileInfoSchema) }),
  'backup.delete_webdav_file': defineRoute({
    input: z.object({ fileName: remoteFileNameSchema }),
    output: z.boolean()
  }),
  'backup.restore_from_webdav': defineRoute({
    input: z.object({ fileName: remoteFileNameSchema }),
    output: restoreResultSchema
  }),

  'backup.check_s3': defineRoute({ input: z.void(), output: z.boolean() }),
  'backup.backup_to_s3': defineRoute({
    input: z.object({ fileName: remoteFileNameSchema.optional() }),
    output: z.object({ fileName: z.string(), cleanupFailed: z.boolean() })
  }),
  'backup.list_s3_files': defineRoute({ input: z.void(), output: z.array(backupFileInfoSchema) }),
  'backup.delete_s3_file': defineRoute({
    input: z.object({ fileName: remoteFileNameSchema }),
    output: z.boolean()
  }),
  'backup.restore_from_s3': defineRoute({
    input: z.object({ fileName: remoteFileNameSchema }),
    output: restoreResultSchema
  })
}

export type BackupEventSchemas = {
  'backup.auto_sync_state_changed': AutoBackupEvent
  'backup.progress': BackupProgress
}
