import { and, eq, isNull } from 'drizzle-orm'

import { assistantTable } from '@data/db/schemas/assistant'
import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { messageService } from '@data/services/MessageService'
import { insertWithOrderKey } from '@data/services/utils/orderKey'
import type { DbType, ISeeder } from '@data/db/types'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import { getDefaultAssistantNameForLocale } from '@shared/data/presets/defaultAssistant'

/**
 * Upstream's `DefaultAssistantSeeder` seeds a CherryIN model into
 * `assistant.modelId`, so it fails the user_model foreign key in this build
 * (there is no Cherry cloud and no seeded model row). The Web deployment still
 * wants a usable first conversation, so this copy seeds the same assistant and
 * empty topic with `modelId: null` — the schema documents null as "no model
 * selected yet", and the composer lets the user pick one from the providers
 * they configure.
 */
export class WebDefaultAssistantSeeder implements ISeeder {
  readonly name = 'web-default-assistant'
  readonly description = 'Insert a model-less default assistant and an empty topic on a fresh database'
  readonly executionPolicy = 'bootstrap-only' as const
  readonly version = '1'

  run(db: DbType): void {
    db.transaction((tx) => {
      if (!this.isFreshUserDatabase(tx)) return

      const assistant = insertWithOrderKey(
        tx,
        assistantTable,
        {
          name: getDefaultAssistantNameForLocale(this.preferredLocale()),
          emoji: '😀',
          prompt: '',
          description: '',
          modelId: null,
          settings: { ...DEFAULT_ASSISTANT_SETTINGS }
        },
        { pkColumn: assistantTable.id, scope: isNull(assistantTable.deletedAt) }
      )

      const topic = insertWithOrderKey(
        tx,
        topicTable,
        { name: '', assistantId: assistant.id as string, activeNodeId: null },
        { pkColumn: topicTable.id, scope: isNull(topicTable.deletedAt) }
      )

      messageService.createRootMessageTx(tx, topic.id as string)
    })
  }

  /** The platform shim's locale source, without importing `electron` here. */
  private preferredLocale(): string | undefined {
    return process.env.LC_ALL ?? process.env.LC_CTYPE ?? process.env.LANG
  }

  private isFreshUserDatabase(tx: Pick<DbType, 'select'>): boolean {
    const [assistant] = tx
      .select({ id: assistantTable.id })
      .from(assistantTable)
      .where(isNull(assistantTable.deletedAt))
      .limit(1)
      .all()
    if (assistant) return false

    const [topic] = tx.select({ id: topicTable.id }).from(topicTable).where(isNull(topicTable.deletedAt)).limit(1).all()
    if (topic) return false

    const [message] = tx
      .select({ id: messageTable.id })
      .from(messageTable)
      .leftJoin(topicTable, eq(messageTable.topicId, topicTable.id))
      .where(and(isNull(messageTable.deletedAt), isNull(topicTable.deletedAt)))
      .limit(1)
      .all()
    return !message
  }
}
