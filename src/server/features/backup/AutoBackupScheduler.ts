import { application } from '@application'
import { loggerService } from '@logger'
import { publishBackupResult } from '@main/services/backupNotifications'
import type { UnifiedPreferenceKeyType } from '@shared/data/preference/preferenceTypes'
import {
  type AutoBackupEvent,
  type AutoBackupEventInput,
  type AutoBackupSnapshot,
  type AutoBackupType
} from '@shared/types/backup'

import type { BackupService } from './BackupService'

const logger = loggerService.withContext('AutoBackupScheduler')

const SCHEDULE_PREFIX = 'auto-backup:'
const LAST_ATTEMPT_TIMES_KEY = 'backup.auto_sync.last_attempt_times'
const STARTUP_GRACE_PERIOD_MS = 60_000
const INITIAL_DELAY_MS = 1_000

const WATCHED_PREFERENCES: Record<'webdav' | 's3', UnifiedPreferenceKeyType[]> = {
  webdav: ['data.backup.webdav.auto_sync', 'data.backup.webdav.host', 'data.backup.webdav.sync_interval'],
  s3: ['data.backup.s3.auto_sync', 'data.backup.s3.endpoint', 'data.backup.s3.sync_interval']
}

interface ScheduleState {
  enabled: boolean
  intervalMs: number
}

/**
 * One-shot schedule chain for the two remote targets the web build supports.
 *
 * It deliberately does not reuse upstream `AutoBackupService`: that class calls
 * the desktop `LegacyBackupManager` and writes to Electron userData. The state
 * event shape is identical, so the existing settings hooks and notification
 * centre keep working unchanged.
 */
export class AutoBackupScheduler {
  private active = false
  private nextEventId = 0
  private readonly pendingNotifications = new Map<AutoBackupType, AutoBackupEvent>()
  private readonly generations: Record<'webdav' | 's3', number> = { webdav: 0, s3: 0 }
  private unsubscribePreferences: (() => void) | null = null

  constructor(private readonly backup: BackupService) {}

  start(): void {
    if (this.active) return
    this.active = true
    this.backup.setManualCompletionHandler((type) => this.recordManualBackupCompletion(type))

    try {
      const preferences = application.get('PreferenceService')
      this.unsubscribePreferences = preferences.subscribeMultipleChanges(
        Object.values(WATCHED_PREFERENCES).flat(),
        (key) => {
          const target = (Object.keys(WATCHED_PREFERENCES) as Array<'webdav' | 's3'>).find((type) =>
            WATCHED_PREFERENCES[type].includes(key)
          )
          if (target) this.restart(target, 'fromLastSyncTime')
        }
      )
    } catch (error) {
      logger.warn('Failed to subscribe to automatic backup preferences', { error })
    }

    this.restoreLastAttemptStates()
    this.restart('webdav', 'startup')
    this.restart('s3', 'startup')
  }

  stop(): void {
    this.active = false
    this.unsubscribePreferences?.()
    this.unsubscribePreferences = null
    for (const type of ['webdav', 's3'] as const) {
      this.generations[type]++
      application.getOptional('SchedulerService')?.unregister(this.scheduleId(type))
    }
    this.pendingNotifications.clear()
  }

  getStateSnapshot(): AutoBackupSnapshot {
    return { pendingNotifications: [...this.pendingNotifications.values()] }
  }

  acknowledgeNotification(type: AutoBackupType, id: number): void {
    if (this.pendingNotifications.get(type)?.id === id) this.pendingNotifications.delete(type)
  }

  recordManualBackupCompletion(type: AutoBackupType): void {
    this.recordLastAttemptTime(type, Date.now())
    if (this.active && (type === 'webdav' || type === 's3')) {
      this.restart(type, 'fromLastSyncTime')
    }
  }

  /** Re-evaluate one provider after its credential was set or cleared. */
  refresh(type: AutoBackupType): void {
    if (this.active && (type === 'webdav' || type === 's3')) {
      this.restart(type, 'fromLastSyncTime')
    }
  }

  private restoreLastAttemptStates(): void {
    const cache = application.getOptional('CacheService')
    const stored = cache?.getPersist(LAST_ATTEMPT_TIMES_KEY) as Record<string, number | null> | undefined
    if (!stored) return
    for (const type of ['webdav', 's3'] as const) {
      const timestamp = stored[type]
      if (typeof timestamp === 'number') {
        cache?.setShared(`backup.auto_sync.state.${type}`, {
          id: ++this.nextEventId,
          type,
          status: 'succeeded',
          timestamp
        })
      }
    }
  }

  private restart(type: 'webdav' | 's3', mode: 'startup' | 'fromLastSyncTime' | 'fromNow'): void {
    if (!this.active) return
    this.generations[type]++
    application.getOptional('SchedulerService')?.unregister(this.scheduleId(type))
    const settings = this.getScheduleSettings(type)
    if (!settings.enabled || settings.intervalMs <= 0) {
      logger.debug('Automatic backup is disabled or incomplete', { type })
      return
    }

    let delay = INITIAL_DELAY_MS
    if (mode === 'startup') {
      delay = Math.max(STARTUP_GRACE_PERIOD_MS, this.remainingDelay(type, settings.intervalMs))
    } else if (mode === 'fromLastSyncTime') {
      delay = this.remainingDelay(type, settings.intervalMs)
    } else {
      delay = settings.intervalMs
    }

    application
      .getOptional('SchedulerService')
      ?.registerSchedule(this.scheduleId(type), { kind: 'once', at: Date.now() + delay }, () =>
        this.handleScheduledBackup(type, this.generations[type])
      )
    logger.debug('Automatic backup scheduled', { type, delayMs: delay })
  }

  private remainingDelay(type: 'webdav' | 's3', intervalMs: number): number {
    const cache = application.getOptional('CacheService')
    const stored = cache?.getPersist(LAST_ATTEMPT_TIMES_KEY) as Record<string, number | null> | undefined
    const last = stored?.[type]
    return typeof last === 'number' ? Math.max(INITIAL_DELAY_MS, last + intervalMs - Date.now()) : intervalMs
  }

  private async handleScheduledBackup(type: 'webdav' | 's3', generation: number): Promise<void> {
    if (!this.isCurrent(type, generation)) return
    const settings = this.getScheduleSettings(type)
    if (!settings.enabled || settings.intervalMs <= 0) return

    this.emit({ type, status: 'running' })
    try {
      const result =
        type === 'webdav' ? await this.backup.backupToWebdav(undefined) : await this.backup.backupToS3(undefined)
      const timestamp = Date.now()
      this.recordLastAttemptTime(type, timestamp)
      if (result.cleanupFailed) {
        this.emit({ type, status: 'warning', timestamp, reason: 'cleanup_failed' })
      } else {
        this.emit({ type, status: 'succeeded', timestamp })
      }
    } catch (error) {
      const timestamp = Date.now()
      this.recordLastAttemptTime(type, timestamp)
      const message = error instanceof Error ? error.message : String(error)
      logger.warn('Automatic backup failed', { type, error: message })
      this.emit({ type, status: 'failed', timestamp, errorMessage: message })
    } finally {
      if (this.isCurrent(type, generation)) this.restart(type, 'fromNow')
    }
  }

  private emit(event: AutoBackupEventInput): void {
    if (!this.active) return
    if (event.status === 'succeeded' || event.status === 'warning' || event.status === 'failed') {
      publishBackupResult(`backup:auto:${event.type}:${event.timestamp}`, event.status, event.timestamp)
    }
    const emitted: AutoBackupEvent = { ...event, id: ++this.nextEventId }
    application.getOptional('CacheService')?.setShared(`backup.auto_sync.state.${event.type}`, emitted)
    if (event.status === 'warning' || event.status === 'failed') {
      this.pendingNotifications.set(event.type, emitted)
    }
    try {
      application.getOptional('IpcApiService')?.broadcast('backup.auto_sync_state_changed', emitted)
    } catch (error) {
      logger.warn('Failed to broadcast automatic backup state', { error })
    }
  }

  private recordLastAttemptTime(type: AutoBackupType, timestamp: number): void {
    const cache = application.getOptional('CacheService')
    const previous = (cache?.getPersist(LAST_ATTEMPT_TIMES_KEY) ?? {}) as Record<string, number | null>
    cache?.setPersist(LAST_ATTEMPT_TIMES_KEY, { ...previous, [type]: timestamp })
  }

  private getScheduleSettings(type: 'webdav' | 's3'): ScheduleState {
    const preferences = application.get('PreferenceService')
    const secrets = this.backup.getSecretStatus()
    if (type === 'webdav') {
      return {
        enabled:
          Boolean(preferences.get('data.backup.webdav.auto_sync')) &&
          Boolean(preferences.get('data.backup.webdav.host')) &&
          secrets.webdavPassword,
        intervalMs: preferences.get('data.backup.webdav.sync_interval') * 60_000
      }
    }
    return {
      enabled:
        Boolean(preferences.get('data.backup.s3.auto_sync')) &&
        Boolean(preferences.get('data.backup.s3.endpoint')) &&
        secrets.s3SecretAccessKey,
      intervalMs: preferences.get('data.backup.s3.sync_interval') * 60_000
    }
  }

  private isCurrent(type: 'webdav' | 's3', generation: number): boolean {
    return this.active && this.generations[type] === generation
  }

  private scheduleId(type: 'webdav' | 's3'): string {
    return `${SCHEDULE_PREFIX}${type}`
  }
}
