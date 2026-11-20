import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import type { DropzoneProps } from '@cherrystudio/ui'
import { toast } from '@renderer/services/toast'

type MiniAppPackageDropOptions = Pick<
  DropzoneProps,
  | 'getFilesFromEvent'
  | 'maxFiles'
  | 'multiple'
  | 'noClick'
  | 'noKeyboard'
  | 'validator'
  | 'onDropAccepted'
  | 'onDropRejected'
>

const getFilesFromEvent: NonNullable<DropzoneProps['getFilesFromEvent']> = async (event) =>
  'dataTransfer' in event && event.dataTransfer ? Array.from(event.dataTransfer.files) : []

const validateMiniAppPackage: NonNullable<DropzoneProps['validator']> = (file) =>
  file.name.toLowerCase().endsWith('.miniapp')
    ? null
    : { code: 'file-invalid-type', message: 'Expected a .miniapp package' }

/** Dropping a package uploads it for preview; there is no host path in the browser. */
export function useMiniAppPackageDrop(previewUpload: (file: File) => Promise<void>): MiniAppPackageDropOptions {
  const { t } = useTranslation()

  const previewPackage = useCallback(
    (files: File[]) => {
      const file = files[0]
      if (!file) {
        toast.error(t('miniApp.install.drop_invalid'))
        return
      }
      void previewUpload(file)
    },
    [previewUpload, t]
  )

  const rejectPackage = useCallback(() => toast.error(t('miniApp.install.drop_invalid')), [t])

  return {
    getFilesFromEvent,
    maxFiles: 1,
    multiple: false,
    noClick: true,
    noKeyboard: true,
    validator: validateMiniAppPackage,
    onDropAccepted: previewPackage,
    onDropRejected: rejectPackage
  }
}
