import { afterEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'

import { AutoBackupScheduler } from '../AutoBackupScheduler'
import type { BackupService } from '../BackupService'

const schedules = new Map<string, () => void | Promise<void>>()

function createScheduler() {
  const backup = {
    setManualCompletionHandler: vi.fn(),
    getSecretStatus: vi.fn(() => ({ webdavPassword: true, s3SecretAccessKey: false })),
    backupToWebdav: vi.fn().mockResolvedValue({ fileName: 'webdav.zip', cleanupFailed: false }),
    backupToS3: vi.fn().mockResolvedValue({ fileName: 's3.zip', cleanupFailed: false })
  } as unknown as BackupService
  const preferences = {
    get: vi.fn((key: string) => {
      if (key === 'data.backup.webdav.auto_sync') return true
      if (key === 'data.backup.webdav.host') return 'https://dav.example'
      if (key === 'data.backup.webdav.sync_interval') return 1
      if (key === 'data.backup.s3.auto_sync') return false
      return ''
    }),
    subscribeMultipleChanges: vi.fn(() => () => undefined)
  }
  const schedulerService = {
    registerSchedule: vi.fn((id: string, _trigger: unknown, callback: () => void | Promise<void>) => {
      schedules.set(id, callback)
      return { dispose: vi.fn() }
    }),
    unregister: vi.fn()
  }
  const cache = {
    getPersist: vi.fn(() => ({ webdav: null, s3: null, local: null, nutstore: null })),
    setPersist: vi.fn(),
    setShared: vi.fn()
  }
  const ipc = { broadcast: vi.fn() }
  const notifications = { publish: vi.fn().mockResolvedValue(true) }

  vi.spyOn(application, 'get').mockImplementation((name: string) => {
    if (name === 'PreferenceService') return preferences
    if (name === 'NotificationService') return notifications
    throw new Error(`Unexpected service: ${name}`)
  })
  vi.spyOn(application, 'getOptional').mockImplementation((name: string) => {
    if (name === 'SchedulerService') return schedulerService
    if (name === 'CacheService') return cache
    if (name === 'IpcApiService') return ipc
    return undefined
  })

  return { scheduler: new AutoBackupScheduler(backup), backup, preferences, schedulerService, cache, ipc }
}

afterEach(() => {
  schedules.clear()
  vi.restoreAllMocks()
})

describe('AutoBackupScheduler', () => {
  it('runs a due WebDAV schedule, records the time and emits success', async () => {
    const { scheduler, backup, cache, ipc } = createScheduler()
    scheduler.start()

    expect(schedules.has('auto-backup:webdav')).toBe(true)
    await schedules.get('auto-backup:webdav')?.()

    expect(backup.backupToWebdav).toHaveBeenCalledWith(undefined)
    expect(cache.setPersist).toHaveBeenCalledWith(
      'backup.auto_sync.last_attempt_times',
      expect.objectContaining({ webdav: expect.any(Number) })
    )
    expect(cache.setShared).toHaveBeenCalledWith(
      'backup.auto_sync.state.webdav',
      expect.objectContaining({ type: 'webdav', status: 'succeeded' })
    )
    expect(ipc.broadcast).toHaveBeenCalledWith(
      'backup.auto_sync_state_changed',
      expect.objectContaining({ type: 'webdav', status: 'succeeded' })
    )
    scheduler.stop()
  })

  it('does not schedule a provider that is disabled', () => {
    const { scheduler } = createScheduler()
    scheduler.start()
    expect(schedules.has('auto-backup:webdav')).toBe(true)
    expect(schedules.has('auto-backup:s3')).toBe(false)
    scheduler.stop()
  })
})
