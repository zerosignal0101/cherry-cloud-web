import { CheckCircle2, CircleAlert, Import, Loader2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, Button, Dialog, DialogContent, Dropzone, DropzoneEmptyState, ScrollArea } from '@cherrystudio/ui'
import { useSkillInstall } from '@renderer/hooks/useSkills'
import { pickBrowserFiles } from '@renderer/ipc/webFile'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { InstalledSkill } from '@shared/types/skill'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type ImportStatus = { kind: 'idle' } | { kind: 'error'; message: string }
type ImportItemStatus = 'pending' | 'installing' | 'success' | 'error'
type ImportItem = {
  id: string
  file: File
  name: string
  status: ImportItemStatus
  skillName?: string
  error?: string
}

/**
 * Skill import dialog for the web build.
 *
 * The desktop version accepted host paths for ZIPs and directories. A browser
 * cannot produce either: the archive is picked or dropped as a `File`, and
 * `useSkillInstall.installFromZip` uploads its bytes to `POST /api/skills/install`.
 * Only ZIP archives are supported here — directory installs are a server-side
 * path operation and have no browser equivalent.
 */
export function ImportSkillDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation()
  const { installFromZip } = useSkillInstall()

  const [status, setStatus] = useState<ImportStatus>({ kind: 'idle' })
  const [installing, setInstalling] = useState(false)
  const [items, setItems] = useState<ImportItem[]>([])

  // Reset transient state on open / close.
  useEffect(() => {
    if (!open) {
      setStatus({ kind: 'idle' })
      setInstalling(false)
      setItems([])
    }
  }, [open])

  const close = () => {
    if (installing) return
    onOpenChange(false)
  }

  const getInstallErrorMessage = useCallback(
    (e: unknown, fallbackName?: string) => {
      const prefix = t('settings.skills.installFailed', { name: fallbackName ?? t('library.type.skill') })
      return e instanceof Error && e.message ? formatErrorMessageWithPrefix(e, prefix) : prefix
    },
    [t]
  )

  const updateItem = useCallback((id: string, patch: Partial<ImportItem>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }, [])

  const runImportQueue = useCallback(
    async (nextItems: ImportItem[]) => {
      if (installing) return
      setInstalling(true)
      setStatus({ kind: 'idle' })
      setItems(nextItems)

      let successCount = 0
      const preErrorCount = nextItems.filter((item) => item.status === 'error').length
      let failedCount = preErrorCount
      let lastSkill: InstalledSkill | null = null

      try {
        for (const item of nextItems) {
          if (item.status === 'error') continue
          updateItem(item.id, { status: 'installing', error: undefined })

          try {
            const skill = await installFromZip(item.file)
            if (!skill) {
              failedCount += 1
              updateItem(item.id, { status: 'error', error: getInstallErrorMessage(undefined, item.name) })
              continue
            }

            lastSkill = skill
            successCount += 1
            updateItem(item.id, { status: 'success', skillName: skill.name })
          } catch (error) {
            failedCount += 1
            updateItem(item.id, { status: 'error', error: getInstallErrorMessage(error, item.name) })
          }
        }

        if (preErrorCount === nextItems.length) return

        if (failedCount > 0) {
          if (nextItems.length > 1) {
            setStatus({
              kind: 'error',
              message: t('settings.skills.batchInstallPartialFailed', {
                failed: failedCount,
                success: successCount,
                total: nextItems.length
              })
            })
          }
          return
        }

        const message =
          nextItems.length === 1 && lastSkill
            ? t('settings.skills.installSuccess', { name: lastSkill.name })
            : t('settings.skills.batchInstallComplete', { count: successCount })
        toast.success(message)
        onOpenChange(false)
      } finally {
        setInstalling(false)
      }
    },
    [getInstallErrorMessage, installFromZip, installing, onOpenChange, t, updateItem]
  )

  const createImportItem = useCallback(
    (file: File, index: number, itemStatus: ImportItemStatus = 'pending'): ImportItem => ({
      id: `${Date.now()}-${index}-${file.name}`,
      file,
      name: file.name,
      status: itemStatus
    }),
    []
  )

  const isZip = (file: File) => file.name.toLowerCase().endsWith('.zip')

  const handleZipPick = async () => {
    if (installing) return
    try {
      const selected = await pickBrowserFiles({ accept: '.zip,application/zip', multiple: true })
      if (selected.length === 0) return
      const zipItems = selected.map((file, index) =>
        isZip(file)
          ? createImportItem(file, index)
          : {
              ...createImportItem(file, index, 'error'),
              error: t('settings.skills.invalidFormat')
            }
      )
      await runImportQueue(zipItems)
    } catch (e) {
      setStatus({ kind: 'error', message: getInstallErrorMessage(e) })
    }
  }

  /**
   * Drag-and-drop accepts ZIP files. Browsers expose dropped directories as
   * zero-entry `File` objects, which cannot be read as an archive, so anything
   * without a `.zip` name is reported as an invalid format instead of being
   * sent to the server.
   */
  const handleDroppedEntries = async (files: File[]) => {
    if (installing) return
    if (files.length === 0) return

    const droppedItems = files.map((file, index) =>
      isZip(file)
        ? createImportItem(file, index)
        : {
            ...createImportItem(file, index, 'error'),
            error: t('settings.skills.invalidFormat')
          }
    )

    await runImportQueue(droppedItems)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !installing) close()
      }}>
      <DialogContent className="overflow-hidden" onPointerDownOutside={(event) => installing && event.preventDefault()}>
        {/* Header */}
        <div>
          <div>
            <h3 className="text-lg leading-none font-semibold text-foreground">
              {t('library.import_skill_dialog.title')}
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">{t('library.import_skill_dialog.subtitle')}</p>
          </div>
        </div>

        {/* Body */}
        <div className="min-w-0">
          <Dropzone
            disabled={installing}
            getFilesFromEvent={async (event) => {
              if ('dataTransfer' in event && event.dataTransfer) {
                return Array.from(event.dataTransfer.files)
              }

              if ('target' in event && event.target && 'files' in event.target) {
                const target = event.target
                return target.files ? Array.from(target.files) : []
              }

              return []
            }}
            maxFiles={0}
            multiple
            onDrop={(files, _rejections, event) => {
              const droppedFiles =
                'dataTransfer' in event && event.dataTransfer ? Array.from(event.dataTransfer.files) : files
              void handleDroppedEntries(droppedFiles)
            }}
            className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border-subtle bg-transparent p-8 text-center whitespace-normal shadow-none transition-colors hover:border-border-strong hover:bg-accent disabled:pointer-events-none disabled:opacity-60">
            <DropzoneEmptyState>
              <Import size={26} strokeWidth={1.2} className="mb-3 text-foreground-tertiary" />
              <p className="mb-1 w-full text-xs whitespace-normal text-wrap break-words text-muted-foreground">
                {t('library.import_skill_dialog.local.drop_hint')}
              </p>
              <p className="w-full text-xs whitespace-normal text-wrap break-words text-muted-foreground">
                {t('library.import_skill_dialog.local.formats')}
              </p>
            </DropzoneEmptyState>
          </Dropzone>

          <div className="mt-4 flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleZipPick()}
              disabled={installing}
              className="shrink-0">
              {installing ? <Loader2 size={12} className="animate-spin" /> : <Import size={12} />}
              <span>{t('settings.skills.installFromZip')}</span>
            </Button>
          </div>

          <ImportResultList items={items} />
          <StatusBanner status={status} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ImportResultList({ items }: { items: ImportItem[] }) {
  const { t } = useTranslation()

  if (items.length === 0) return null

  return (
    <ScrollArea
      viewportProps={{ 'data-testid': 'skill-import-results', className: 'overflow-x-hidden' }}
      className="mt-4 max-h-44 w-full max-w-full min-w-0 rounded-md border border-border-subtle bg-background-subtle/50">
      <div className="min-w-0 divide-y divide-border-subtle">
        {items.map((item) => {
          const displayName = item.status === 'success' ? (item.skillName ?? item.name) : item.name

          return (
            <div key={item.id} className="flex min-w-0 items-start gap-2 px-3 py-2 text-xs">
              <ImportItemStatusIcon status={item.status} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-foreground" title={displayName}>
                  {displayName}
                </div>
                {item.status !== 'success' ? (
                  <div
                    className="mt-0.5 min-w-0 [overflow-wrap:anywhere] break-words whitespace-normal text-foreground-tertiary"
                    title={item.status === 'error' ? item.error : undefined}>
                    {item.status === 'pending' ? t('settings.skills.batchInstallQueued') : null}
                    {item.status === 'installing' ? t('common.loading') : null}
                    {item.status === 'error' ? item.error : null}
                  </div>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </ScrollArea>
  )
}

function ImportItemStatusIcon({ status }: { status: ImportItemStatus }) {
  if (status === 'installing') {
    return <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin text-foreground-tertiary" />
  }
  if (status === 'success') {
    return <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-success" />
  }
  if (status === 'error') {
    return <CircleAlert size={14} className="mt-0.5 shrink-0 text-error" />
  }
  return <span className="mt-1.5 size-2 shrink-0 rounded-full border border-border-strong bg-muted" />
}

function StatusBanner({ status }: { status: ImportStatus }) {
  return (
    <AnimatePresence>
      {status.kind === 'error' && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="mt-4">
          <Alert type="error" showIcon message={status.message} className="rounded-md px-3 py-2 text-xs shadow-none" />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
