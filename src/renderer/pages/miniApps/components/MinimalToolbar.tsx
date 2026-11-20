import { Columns2, Ellipsis, ExternalLink, Info, LayoutGrid, Link, Power, RotateCw, X } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Tooltip
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import MiniAppDetailPanel from '@renderer/components/MiniApp/MiniAppDetailPanel'
import { useExitPresence } from '@renderer/hooks/useExitPresence'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { normalizeWebviewAddress } from '@renderer/utils/normalizeWebviewAddress'
import { isDataApiError, toDataApiError } from '@shared/data/api/errors'
import type { MiniApp } from '@shared/data/types/miniApp'
import { isHttpUrl } from '@shared/utils/url'

const logger = loggerService.withContext('MinimalToolbar')

/** `open` splits the view in two; `close` is the split pane's way back to one. */
export type SplitMode = 'open' | 'close'

interface Props {
  app: MiniApp
  currentUrl: string
  isReady: boolean
  onReload: () => void
  onRestart: () => void
  onNavigate: (url: string) => void
  splitMode: SplitMode
  splitActive?: boolean
  onSplit: () => void
}

/**
 * Web mini app toolbar.
 *
 * The desktop version drove WebView navigation and DevTools. A sandboxed iframe
 * exposes neither cross-origin history nor a debugger, so the toolbar keeps the
 * actions the browser can honour: address, reload, external open, split, pin and
 * the app detail panel.
 */
const MinimalToolbar: FC<Props> = ({
  app,
  currentUrl,
  isReady,
  onReload,
  onRestart,
  onNavigate,
  splitMode,
  splitActive = false,
  onSplit
}) => {
  const { t } = useTranslation()
  const { pinned, updateAppStatus, allApps } = useMiniApps()
  const [openLinkExternal, setOpenLinkExternal] = usePreference('feature.mini_app.open_link_external')
  const [detailOpen, setDetailOpen] = useState(false)
  const detailDialog = useExitPresence(detailOpen ? true : null)
  const [address, setAddress] = useState(currentUrl)
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!editing) setAddress(currentUrl)
  }, [currentUrl, editing])

  const splitLabelKey = splitMode === 'close' || splitActive ? 'miniApp.split.close' : 'miniApp.split.open'
  const canPinned = allApps.some((item) => item.appId === app.appId)
  const isPinned = pinned.some((item) => item.appId === app.appId)
  const canOpenExternalLink = isHttpUrl(currentUrl)

  const handleTogglePin = useCallback(() => {
    const fallbackKey = isPinned ? 'miniApp.unpin_failed' : 'miniApp.pin_failed'
    updateAppStatus(app.appId, isPinned ? 'enabled' : 'pinned').catch((err) => {
      const e = toDataApiError(err)
      if (isDataApiError(e)) {
        logger.error('togglePin failed', { code: e.code, message: e.message })
        toast.error(e.message || t(fallbackKey))
      } else {
        logger.error('togglePin failed', err as Error)
        toast.error(t(fallbackKey))
      }
    })
  }, [app.appId, isPinned, updateAppStatus, t])

  const handleOpenLink = useCallback(() => {
    void ipcApi.request('system.shell.open_external_website', currentUrl)
  }, [currentUrl])

  const handleAddressSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const normalized = normalizeWebviewAddress(address)
      if (!normalized || !isHttpUrl(normalized)) {
        toast.error(t('settings.miniApps.custom.url_invalid'))
        setAddress(currentUrl)
        return
      }
      setEditing(false)
      inputRef.current?.blur()
      onNavigate(normalized)
    },
    [address, currentUrl, onNavigate, t]
  )

  return (
    <div className="flex h-8.75 shrink-0 items-center gap-2 bg-background px-3">
      {app.kind === 'site' && (
        <form className="mx-1 min-w-0 flex-1" onSubmit={handleAddressSubmit}>
          <Input
            ref={inputRef}
            type="text"
            inputMode="url"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            onFocus={(event) => {
              setEditing(true)
              event.currentTarget.select()
            }}
            onBlur={() => {
              setEditing(false)
              setAddress(currentUrl)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              event.preventDefault()
              setEditing(false)
              setAddress(currentUrl)
              event.currentTarget.blur()
            }}
            disabled={!isReady}
            aria-label={t('settings.miniApps.custom.url')}
            title={currentUrl}
            placeholder={t('settings.miniApps.custom.url_placeholder')}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="text-muted-foreground h-7 rounded-md border-input bg-background px-2.5 text-xs shadow-none focus-visible:text-foreground"
          />
        </form>
      )}

      <div className="ml-auto flex shrink-0 items-center">
        <div className="flex items-center gap-0.5">
          <Tooltip content={t('miniApp.popup.refresh')} placement="bottom">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onReload}
              className={toolbarButtonClassName()}
              aria-label={t('miniApp.popup.refresh')}>
              <RotateCw size={14} />
            </Button>
          </Tooltip>

          <Tooltip content={t(splitLabelKey)} placement="bottom">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onSplit}
              className={toolbarButtonClassName({ active: splitActive })}
              aria-label={t(splitLabelKey)}
              aria-pressed={splitMode === 'open' ? splitActive : undefined}>
              {splitMode === 'open' ? <Columns2 size={14} /> : <X size={14} />}
            </Button>
          </Tooltip>

          {canOpenExternalLink && (
            <Tooltip content={t('miniApp.popup.openExternal')} placement="bottom">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={handleOpenLink}
                className={toolbarButtonClassName()}
                aria-label={t('miniApp.popup.openExternal')}>
                <ExternalLink size={14} />
              </Button>
            </Tooltip>
          )}

          {canPinned && (
            <Tooltip
              content={isPinned ? t('miniApp.remove_from_launchpad') : t('miniApp.add_to_launchpad')}
              placement="bottom">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={handleTogglePin}
                className={toolbarButtonClassName({ active: isPinned })}
                aria-label={isPinned ? t('miniApp.remove_from_launchpad') : t('miniApp.add_to_launchpad')}
                aria-pressed={isPinned}>
                <LayoutGrid size={14} />
              </Button>
            </Tooltip>
          )}

          {app.kind === 'site' && (
            <Tooltip
              content={
                openLinkExternal ? t('miniApp.popup.open_link_external_on') : t('miniApp.popup.open_link_external_off')
              }
              placement="bottom">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => void setOpenLinkExternal(!openLinkExternal)}
                className={toolbarButtonClassName({ active: openLinkExternal })}
                aria-label={
                  openLinkExternal
                    ? t('miniApp.popup.open_link_external_on')
                    : t('miniApp.popup.open_link_external_off')
                }
                aria-pressed={openLinkExternal}>
                <Link size={14} />
              </Button>
            </Tooltip>
          )}

          {app.kind === 'app' && (
            <Tooltip content={t('miniApp.detail.open')} placement="bottom">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setDetailOpen(true)}
                className={toolbarButtonClassName()}
                aria-label={t('miniApp.detail.open')}>
                <Info size={14} />
              </Button>
            </Tooltip>
          )}

          <DropdownMenu>
            <Tooltip content={t('common.more')} placement="bottom">
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className={toolbarButtonClassName()}
                  aria-label={t('common.more')}>
                  <Ellipsis size={14} />
                </Button>
              </DropdownMenuTrigger>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onRestart}>
                <Power />
                {t('miniApp.popup.restart')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {detailDialog.isPresent && (
        <MiniAppDetailPanel open={detailOpen} appId={app.appId} onClose={() => setDetailOpen(false)} />
      )}
    </div>
  )
}

const toolbarButtonClassName = ({ active = false }: { active?: boolean } = {}) =>
  cn(
    'rounded shadow-none active:scale-95',
    active ? 'text-primary hover:text-primary' : 'text-muted-foreground hover:text-foreground'
  )

export default MinimalToolbar
