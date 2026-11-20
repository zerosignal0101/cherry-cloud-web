import type { SettingsSearchEntry } from '../settingsSearch/types'

// Indexed rows = statically visible actionable rows (D8): conditional rows
// (custom-proxy inputs, developer client id, context-management and retry
// children behind their master switches) stay out — their anchors may not
// exist on jump.
export const route = '/settings/general'

export const entries: SettingsSearchEntry[] = [
  {
    anchorId: 'display-language',
    titleKey: 'settings.general.interface_language',
    groupKey: 'common.language',
    aliases: ['language', '语言']
  },
  {
    anchorId: 'proxy-mode',
    titleKey: 'settings.proxy.mode.title',
    groupKey: 'settings.general.sections.network',
    aliases: ['proxy', '代理']
  },
  {
    anchorId: 'allow-private-network',
    titleKey: 'settings.fetch.allow_private_network',
    groupKey: 'settings.general.sections.network'
  },
  {
    anchorId: 'commit-attribution',
    titleKey: 'settings.general.commit_attribution.title',
    groupKey: 'settings.general.sections.agent',
    descriptionKey: 'settings.general.commit_attribution.description',
    aliases: ['attribution', 'Co-Authored-By', 'Claude Code', '署名', '共同作者']
  },
  {
    anchorId: 'enable-developer-mode',
    titleKey: 'settings.developer.enable_developer_mode',
    groupKey: 'settings.general.sections.developer'
  },
  {
    anchorId: 'context-max-messages',
    titleKey: 'settings.models.context_management.max_messages',
    groupKey: 'settings.models.context_management.title',
    aliases: ['context count', '上下文数量']
  },
  {
    anchorId: 'context-enabled',
    titleKey: 'settings.models.context_management.enabled',
    groupKey: 'settings.models.context_management.title'
  },
  {
    anchorId: 'agent-language',
    titleKey: 'settings.agent.language.label',
    groupKey: 'settings.general.sections.agent',
    descriptionKey: 'settings.agent.language.description',
    aliases: ['language', 'agent language', 'reply language']
  },
  {
    anchorId: 'retry-enabled',
    titleKey: 'settings.general.retry.enabled',
    groupKey: 'settings.general.sections.retry',
    descriptionKey: 'settings.models.retry.description',
    aliases: ['retry', '重试']
  }
]
