import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { Slider, Switch } from '@cherrystudio/ui'
import Selector from '@renderer/components/Selector'
import {
  SettingContainer,
  SettingDivider,
  SettingGroup,
  SettingHelpText,
  SettingRow,
  SettingRowTitle,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import { useTheme } from '@renderer/hooks/useTheme'
import type { EditorView } from '@renderer/types/app'

const NotesSettings: FC = () => {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const { settings, updateSettings } = useNotesSettings()

  return (
    <SettingContainer theme={theme} style={{ background: 'transparent' }}>
      {/* Editor Settings */}
      <SettingGroup theme={theme}>
        <SettingTitle>{t('notes.settings.editor.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('notes.settings.editor.view_mode.title')}</SettingRowTitle>
          <Selector
            options={[
              { label: t('notes.settings.editor.view_mode.edit_mode'), value: 'edit' },
              { label: t('notes.settings.editor.view_mode.read_mode'), value: 'read' }
            ]}
            value={settings.defaultViewMode}
            onChange={(value: 'edit' | 'read') => updateSettings({ defaultViewMode: value })}
          />
        </SettingRow>
        <SettingHelpText>{t('notes.settings.editor.view_mode.description')}</SettingHelpText>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('notes.settings.editor.edit_mode.title')}</SettingRowTitle>
          <Selector
            options={[
              { label: t('notes.settings.editor.edit_mode.preview_mode'), value: 'preview' },
              { label: t('notes.settings.editor.edit_mode.source_mode'), value: 'source' }
            ]}
            value={settings.defaultEditMode}
            onChange={(value: Exclude<EditorView, 'read'>) => updateSettings({ defaultEditMode: value })}
          />
        </SettingRow>
        <SettingHelpText>{t('notes.settings.editor.edit_mode.description')}</SettingHelpText>
      </SettingGroup>

      {/* Display Settings */}
      <SettingGroup theme={theme}>
        <SettingTitle>{t('notes.settings.display.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('notes.settings.display.compress_content')}</SettingRowTitle>
          <Switch
            checked={!settings.isFullWidth}
            onCheckedChange={(checked) => updateSettings({ isFullWidth: !checked })}
          />
        </SettingRow>
        <SettingHelpText>{t('notes.settings.display.compress_content_description')}</SettingHelpText>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('notes.settings.display.font_size')}</SettingRowTitle>
          <div className="flex items-center">
            <Slider
              min={10}
              max={30}
              value={[settings.fontSize]}
              onValueChange={(value) => updateSettings({ fontSize: value[0] ?? settings.fontSize })}
              className="mr-4 w-50"
            />
            <span className="min-w-10 text-sm text-muted-foreground">{settings.fontSize}px</span>
          </div>
        </SettingRow>
        <SettingHelpText>{t('notes.settings.display.font_size_description')}</SettingHelpText>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('notes.settings.display.show_table_of_contents')}</SettingRowTitle>
          <Switch
            checked={settings.showTableOfContents}
            onCheckedChange={(checked) => updateSettings({ showTableOfContents: checked })}
          />
        </SettingRow>
        <SettingHelpText>{t('notes.settings.display.show_table_of_contents_description')}</SettingHelpText>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('notes.settings.display.line_breaks')}</SettingRowTitle>
          <Switch
            checked={settings.lineBreaks}
            onCheckedChange={(checked) => updateSettings({ lineBreaks: checked })}
          />
        </SettingRow>
        <SettingHelpText>{t('notes.settings.display.line_breaks_description')}</SettingHelpText>
      </SettingGroup>
    </SettingContainer>
  )
}

export default NotesSettings
