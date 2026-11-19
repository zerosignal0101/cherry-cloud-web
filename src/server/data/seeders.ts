import type { ISeeder } from '@data/db/types'
import { ConversationListSortSeeder } from '@data/db/seeding/seeders/conversationListSortSeeder'
import { KnowledgeBaseOrderSeeder } from '@data/db/seeding/seeders/knowledgeBaseOrderSeeder'
import { PreferenceSeeder } from '@data/db/seeding/seeders/preferenceSeeder'
import { PresetProviderSeeder } from '@data/db/seeding/seeders/presetProviderSeeder'
import { TranslateLanguageSeeder } from '@data/db/seeding/seeders/translateLanguageSeeder'

/**
 * Seeders the server runs on a fresh database.
 *
 * Upstream's `seederRegistry` includes the desktop feature set (Mini Apps, local
 * models, the Cherry-branded assistants, selection/sidebar shortcuts). Those
 * tables still exist in the shared schema, but the rows would seed features this
 * build does not ship, so the web registry stays a deliberate subset:
 *
 * - `KnowledgeBaseOrderSeeder`  — keeps the knowledge list order invariant.
 * - `PresetProviderSeeder`      — the provider rows the model list and chat need.
 *                                 Catalog data comes from the
 *                                 `@cherrystudio/provider-registry` package.
 * - `ConversationListSortSeeder`— keeps the conversation list order invariant.
 * - `PreferenceSeeder`          — default preferences every page reads on first load.
 * - `TranslateLanguageSeeder`   — built-in language pairs for the translate API.
 *
 * Deliberately not seeded yet:
 * - `DefaultAssistantSeeder` pulls the agent/session service graph, which arrives
 *   with the agents milestone.
 * - `CherryAiDefaultModelSeeder` and the Cherry-branded assistants belong to the
 *   cloud features this build removes.
 */
export const webSeeders: ISeeder[] = [
  new KnowledgeBaseOrderSeeder(),
  new PresetProviderSeeder(),
  new ConversationListSortSeeder(),
  new PreferenceSeeder(),
  new TranslateLanguageSeeder()
]
