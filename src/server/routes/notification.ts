import { application } from '@application'
import { notificationRecordService } from '@data/services/NotificationRecordService'
import { notificationRequestSchemas } from '@shared/ipc/schemas/notification'
import type { IpcHandlersFor } from '@shared/ipc/types'

import type { RpcRegistry } from '../transport/registry'

const notificationRoutes = {
  'notification.send': notificationRequestSchemas['notification.send'],
  'notification.activate': notificationRequestSchemas['notification.activate']
} as const

const notificationHandlers: IpcHandlersFor<typeof notificationRoutes> = {
  'notification.send': async (notification) => {
    await application.get('NotificationService').sendNotification(notification)
  },
  /**
   * The desktop activation path opens tabs and OS windows. In the browser the
   * record already lives in the notification center, so activation marks it read
   * and asks the caller's tab to open the center; the record itself carries the
   * target for the detail view.
   */
  'notification.activate': async ({ id }, { senderId }) => {
    const record = notificationRecordService.getById(id)
    if (!record) throw new Error('Notification target is unavailable')
    notificationRecordService.markRead(id)
    if (senderId) {
      application.get('IpcApiService').send(senderId, 'notification.open', { id })
      return
    }
    application.get('IpcApiService').broadcast('notification.open', { id })
  }
}

export function registerNotificationRoutes(registry: RpcRegistry): void {
  registry.register(notificationRoutes, notificationHandlers)
}
