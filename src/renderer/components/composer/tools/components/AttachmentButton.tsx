import type { Dispatch, FC, SetStateAction } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getQuickPanelSearchAliases } from '@renderer/components/composer/quickPanel'
import { ATTACHMENT_TOOLBAR_MANIFEST } from '@renderer/components/composer/tools/toolbarManifests'
import type { ToolLauncherApi } from '@renderer/components/composer/tools/types'
import { pickBrowserFiles } from '@renderer/ipc/webFile'
import { toast } from '@renderer/services/toast'
import { getFileExtension } from '@renderer/utils/file'
import {
  type ComposerAttachment,
  toComposerAttachmentFromFile
} from '@renderer/utils/message/composerAttachment'

interface Props {
  launcher: ToolLauncherApi
  couldAddImageFile: boolean
  extensions: string[]
  files: ComposerAttachment[]
  setFiles: Dispatch<SetStateAction<ComposerAttachment[]>>
  disabled?: boolean
}

const useAttachmentToolController = ({ launcher, couldAddImageFile, extensions, setFiles, disabled }: Props) => {
  const { t } = useTranslation()
  const [selecting, setSelecting] = useState<boolean>(false)

  const openFileSelectDialog = useCallback(
    async (restoreFocus?: () => void) => {
      if (selecting) {
        return
      }
      // when the number of extensions is greater than 20, use *.* to avoid selecting window lag
      const useAllFiles = extensions.length > 20

      setSelecting(true)
      const _files = await pickBrowserFiles({
        multiple: true,
        accept: useAllFiles ? undefined : extensions.join(',')
      })
      setSelecting(false)
      window.requestAnimationFrame(() => restoreFocus?.())

      if (_files.length > 0) {
        if (useAllFiles) {
          setFiles((currentFiles) => [...currentFiles, ..._files.map((file) => toComposerAttachmentFromFile(file))])
          return
        }
        const supportedFiles = _files.filter((file) => extensions.includes(getFileExtension(file.name)))
        if (supportedFiles.length > 0) {
          setFiles((currentFiles) => [...currentFiles, ...supportedFiles.map((file) => toComposerAttachmentFromFile(file))])
        }

        if (supportedFiles.length !== _files.length) {
          toast.info(
            t('chat.input.file_not_supported_count', {
              count: _files.length - supportedFiles.length
            })
          )
        }
      }
    },
    [extensions, selecting, setFiles, t]
  )

  useEffect(() => {
    const isDocumentOnly = !couldAddImageFile
    const disposeLauncher = launcher.registerLaunchers([
      {
        ...ATTACHMENT_TOOLBAR_MANIFEST.toolbar,
        sources: ['popover'],
        label: t('chat.input.upload.attachment'),
        description: '',
        searchAliases: getQuickPanelSearchAliases(t, 'chat.input.upload.attachment', ['upload attachment']),
        tooltip: isDocumentOnly ? t('chat.input.upload.image_not_supported') : undefined,
        suffix: isDocumentOnly ? t('chat.input.upload.document_only') : undefined,
        disabled,
        action: ({ inputAdapter }) => {
          void openFileSelectDialog(inputAdapter?.focus)
        }
      }
    ])

    return () => {
      disposeLauncher()
    }
  }, [couldAddImageFile, disabled, launcher, openFileSelectDialog, t])
}

export const AttachmentToolRuntime: FC<Props> = (props) => {
  useAttachmentToolController(props)
  return null
}
