import type { ISeeder } from '@data/db/types'
import { ConversationListSortSeeder } from '@data/db/seeding/seeders/conversationListSortSeeder'
import { KnowledgeBaseOrderSeeder } from '@data/db/seeding/seeders/knowledgeBaseOrderSeeder'
import { PreferenceSeeder } from '@data/db/seeding/seeders/preferenceSeeder'
import { TranslateLanguageSeeder } from '@data/db/seeding/seeders/translateLanguageSeeder'

/**
 * Seeders the server runs on a fresh database.
 *
 * Upstream's `seederRegistry` includes the desktop feature set (Mini Apps, local
 * models, the Cherry-branded assistants, selection/sidebar shortcuts). Those
 * tables still exist in the shared schema, but the rows would seed features this
 * build does not ship, so the web registry stays a deliberate subset:
 *
 * - `PreferenceSeeder`          — default preferences every page reads on first load.
 * - `KnowledgeBaseOrderSeeder`  — keeps the knowledge list order invariant.
 * - `ConversationListSortSeeder`— keeps the conversation list order invariant.
 * - `TranslateLanguageSeeder`   — built-in language pairs for the translate API.
 *
 * Deliberately not seeded yet:
 * - `DefaultAssistantSeeder` pulls the agent/session service graph, which arrives
 *   with the chat milestone.
 * - `PresetProviderSeeder` needs the bundled provider-registry data paths (M6).
 */
export const webSeeders: ISeeder[] = [
  new KnowledgeBaseOrderSeeder(),
  new ConversationListSortSeeder(),
  new PreferenceSeeder(),
  new TranslateLanguageSeeder()
]
