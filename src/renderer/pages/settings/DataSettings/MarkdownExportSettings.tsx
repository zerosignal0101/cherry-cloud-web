import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { Switch, HelpTooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import {
  SettingDivider,
  SettingGroup,
  SettingRow,
  SettingRowTitle,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { useTheme } from '@renderer/hooks/useTheme'

const MarkdownExportSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()

  const [forceDollarMathInMarkdown, setForceDollarMathInMarkdown] = usePreference(
    'data.export.markdown.force_dollar_math'
  )
  const [useTopicNamingForMessageTitle, setUseTopicNamingForMessageTitle] = usePreference(
    'data.export.markdown.use_topic_naming_for_message_title'
  )
  const [showModelNameInExport, setShowModelNameInMarkdown] = usePreference('data.export.markdown.show_model_name')
  const [showModelProviderInMarkdown, setShowModelProviderInMarkdown] = usePreference(
    'data.export.markdown.show_model_provider'
  )
  const [excludeCitationsInExport, setExcludeCitationsInExport] = usePreference(
    'data.export.markdown.exclude_citations'
  )
  const [standardizeCitationsInExport, setStandardizeCitationsInExport] = usePreference(
    'data.export.markdown.standardize_citations'
  )

  const handleToggleForceDollarMath = (checked: boolean) => {
    void setForceDollarMathInMarkdown(checked)
  }

  const handleToggleTopicNaming = (checked: boolean) => {
    void setUseTopicNamingForMessageTitle(checked)
  }

  const handleToggleShowModelName = (checked: boolean) => {
    void setShowModelNameInMarkdown(checked)
  }

  const handleToggleShowModelProvider = (checked: boolean) => {
    void setShowModelProviderInMarkdown(checked)
  }

  const handleToggleExcludeCitations = (checked: boolean) => {
    void setExcludeCitationsInExport(checked)
  }

  const handleToggleStandardizeCitations = (checked: boolean) => {
    void setStandardizeCitationsInExport(checked)
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.data.markdown_export.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle className="flex items-center gap-1.5">
          {t('settings.data.markdown_export.force_dollar_math.title')}{' '}
          <HelpTooltip content={t('settings.data.markdown_export.force_dollar_math.help')} />
        </SettingRowTitle>
        <Switch checked={forceDollarMathInMarkdown} onCheckedChange={handleToggleForceDollarMath} />
      </SettingRow>
      <SettingDivider />
      <SettingRow id="setting-data-markdown-export-topic-naming" className="scroll-mt-6">
        <SettingRowTitle className="flex items-center gap-1.5">
          {t('settings.data.message_title.use_topic_naming.title')}{' '}
          <HelpTooltip content={t('settings.data.message_title.use_topic_naming.help')} />
        </SettingRowTitle>
        <Switch checked={useTopicNamingForMessageTitle} onCheckedChange={handleToggleTopicNaming} />
      </SettingRow>
      <SettingDivider />
      <SettingRow id="setting-data-markdown-export-model-name" className="scroll-mt-6">
        <SettingRowTitle className="flex items-center gap-1.5">
          {t('settings.data.markdown_export.show_model_name.title')}{' '}
          <HelpTooltip content={t('settings.data.markdown_export.show_model_name.help')} />
        </SettingRowTitle>
        <Switch checked={showModelNameInExport} onCheckedChange={handleToggleShowModelName} />
      </SettingRow>
      <SettingDivider />
      <SettingRow id="setting-data-markdown-export-model-provider" className="scroll-mt-6">
        <SettingRowTitle className="flex items-center gap-1.5">
          {t('settings.data.markdown_export.show_model_provider.title')}{' '}
          <HelpTooltip content={t('settings.data.markdown_export.show_model_provider.help')} />
        </SettingRowTitle>
        <Switch checked={showModelProviderInMarkdown} onCheckedChange={handleToggleShowModelProvider} />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle className="flex items-center gap-1.5">
          {t('settings.data.markdown_export.exclude_citations.title')}{' '}
          <HelpTooltip content={t('settings.data.markdown_export.exclude_citations.help')} />
        </SettingRowTitle>
        <Switch checked={excludeCitationsInExport} onCheckedChange={handleToggleExcludeCitations} />
      </SettingRow>
      <SettingDivider />
      <SettingRow id="setting-data-markdown-export-citations" className="scroll-mt-6">
        <SettingRowTitle className="flex items-center gap-1.5">
          {t('settings.data.markdown_export.standardize_citations.title')}{' '}
          <HelpTooltip content={t('settings.data.markdown_export.standardize_citations.help')} />
        </SettingRowTitle>
        <Switch checked={standardizeCitationsInExport} onCheckedChange={handleToggleStandardizeCitations} />
      </SettingRow>
    </SettingGroup>
  )
}

export default MarkdownExportSettings
