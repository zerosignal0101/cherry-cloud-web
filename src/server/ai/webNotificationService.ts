import { application } from '@application'
import { notificationRecordService, type CreateNotificationRecordInput } from '@data/services/NotificationRecordService'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { t } from '@main/i18n'
import { NotificationTaskResultSchema, type TaskResultNotificationInput } from '@shared/data/types/notification'
import type { ConversationNotification, Notification, NotificationSource } from '@shared/types/notification'
import { redactSecretText, redactSecretTokens } from '@shared/utils/redaction'

const logger = loggerService.withContext('WebNotificationService')

const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000

/**
 * Web replacement for the desktop `NotificationService`.
 *
 * Delivery policy is the same as upstream — preferences gate each category, task
 * results are deduplicated through the consumed-event tombstone, and records are
 * persisted for the notification center — but there is no OS notification. The
 * record is fanned out to every open tab over the existing IpcApi event channel;
 * each tab decides whether to toast (and suppresses it when the matching
 * conversation is already focused).
 *
 * The class is registered under the upstream name `NotificationService` so
 * `AgentJobsService` and the other consumers keep their `@DependsOn` contracts.
 */
@Injectable('NotificationService')
@ServicePhase(Phase.WhenReady)
export class WebNotificationService extends BaseService {
  protected onInit(): void {
    const purge = () => {
      try {
        notificationRecordService.purgeExpired()
      } catch (error) {
        logger.warn('Failed to expire notification history', { error })
      }
    }
    purge()
    this.registerInterval(purge, PURGE_INTERVAL_MS)
  }

  async publish(
    input: CreateNotificationRecordInput,
    options: { source?: NotificationSource; completion?: boolean; recordOnly?: boolean } = {}
  ): Promise<boolean> {
    let committed = false
    try {
      const preferences = application.get('PreferenceService')
      const enabled = preferences.get(`app.notification.center.${input.category}.enabled`)
      if (!enabled) return true

      const result = input.target?.result
      const recordOnly = options.recordOnly === true || result?.status === 'cancelled'
      const initial: CreateNotificationRecordInput = {
        ...input,
        readAt: result && recordOnly ? Date.now() : input.readAt
      }
      const record = result
        ? notificationRecordService.consumeTaskResult(input.eventKey, initial)
        : notificationRecordService.create(initial)
      if (!record) return true
      committed = true
      if (recordOnly) return true

      this.send('notification.present', record)
      if (options.completion && preferences.get('app.notification.completion_sound.enabled')) {
        this.send('notification.completion_sound', { id: record.id })
      }
      return true
    } catch (error) {
      logger.warn('Failed to publish notification', { error, eventKey: input.eventKey })
      return committed
    }
  }

  /** Persists an authoritative outcome through the same delivery policy. */
  async publishTaskResult(input: TaskResultNotificationInput): Promise<boolean> {
    try {
      if (!input.resultId.trim() || !Number.isSafeInteger(input.finishedAt) || input.finishedAt < 0) return false
      const result = NotificationTaskResultSchema.parse(input)
      if (result.errorSummary) {
        result.errorSummary = Array.from(redactSecretTokens(redactSecretText(result.errorSummary)))
          .slice(0, 500)
          .join('')
      }
      return this.publish(
        {
          eventKey: `task-result:${JSON.stringify([result.source, input.resultId])}`,
          category: 'system',
          kind: 'task-result',
          title: {
            succeeded: t('notification.result.succeeded'),
            failed: t('notification.result.failed'),
            interrupted: t('notification.result.interrupted'),
            cancelled: t('notification.result.cancelled')
          }[result.status],
          message: result.errorSummary ? `${result.name}: ${result.errorSummary}` : result.name,
          createdAt: input.finishedAt,
          target: { ...input.target, result }
        },
        { source: 'assistant', completion: result.status === 'succeeded' }
      )
    } catch (error) {
      logger.warn('Invalid task result notification', { error })
      return false
    }
  }

  /**
   * Generic notifications originate from native surfaces upstream. In the web
   * build they still enter the notification center so a caller does not have to
   * know whether an OS notification exists.
   */
  async sendNotification(notification: Notification): Promise<void> {
    try {
      const record = notificationRecordService.create({
        eventKey: `notification:${notification.id}`,
        category: 'system',
        kind: notification.type,
        title: notification.title,
        message: notification.message,
        createdAt: notification.timestamp || Date.now()
      })
      if (record) this.send('notification.present', record)
    } catch (error) {
      logger.warn('Failed to record notification', { error, id: notification.id })
    }
  }

  deliverConversationNotification(notification: ConversationNotification): void {
    this.send('notification.conversation', notification)
  }

  private send(event: string, payload: unknown): void {
    try {
      application.get('IpcApiService').broadcast(event, payload)
    } catch (error) {
      // A notification must never fail the operation that produced it.
      logger.warn('Failed to deliver notification event', { event, error })
    }
  }
}
