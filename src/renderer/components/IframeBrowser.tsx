import { ExternalLink, RotateCw, ShieldAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Input, Tooltip } from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import { normalizeWebviewAddress } from '@renderer/utils/normalizeWebviewAddress'
import { normalizeBrowserUrl, sanitizeBrowserVisitUrl } from '@shared/utils/browserUrl'

interface Props {
  initialUrl: string
  onUrlChange?: (url: string) => void
  onTitleChange?: (title: string) => void
  onReadyStateChange?: (ready: boolean) => void
}

function displayNameOf(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

/**
 * Standalone browser for the web build.
 *
 * It is deliberately an iframe, not a `<webview>`: the server has no Chromium
 * guest to attach to the renderer. Cross-origin pages cannot expose their title,
 * favicon or history, so the toolbar shows the submitted address and offers
 * "open externally" for sites that refuse frame embedding.
 */
export function IframeBrowser({ initialUrl, onUrlChange, onTitleChange, onReadyStateChange }: Props) {
  const { t } = useTranslation()
  const [url, setUrl] = useState(initialUrl)
  const [address, setAddress] = useState(initialUrl)
  const [editing, setEditing] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [ready, setReady] = useState(false)
  const [invalid, setInvalid] = useState<string | null>(null)
  const [embedTimedOut, setEmbedTimedOut] = useState(false)

  useEffect(() => {
    setUrl(initialUrl)
    if (!editing) setAddress(initialUrl)
    setInvalid(null)
  }, [initialUrl, editing])

  useEffect(() => {
    onReadyStateChange?.(ready)
  }, [onReadyStateChange, ready])

  useEffect(() => {
    onTitleChange?.(displayNameOf(url))
  }, [onTitleChange, url])

  useEffect(() => {
    if (ready) {
      setEmbedTimedOut(false)
      return
    }
    const timer = setTimeout(() => setEmbedTimedOut(true), 12_000)
    return () => clearTimeout(timer)
  }, [ready, reloadKey, url])

  const navigate = useCallback(
    (next: string) => {
      try {
        const normalized = normalizeBrowserUrl(next)
        setUrl(normalized)
        setAddress(normalized)
        setInvalid(null)
        setReady(false)
        setReloadKey((key) => key + 1)
        onUrlChange?.(normalized)
      } catch {
        setInvalid(t('webview.browser.load_failed'))
      }
    },
    [onUrlChange, t]
  )

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalized = normalizeWebviewAddress(address)
    if (!normalized) {
      setInvalid(t('webview.browser.load_failed'))
      return
    }
    navigate(normalized)
    setEditing(false)
  }

  const openExternal = () => {
    void ipcApi.request('system.shell.open_external_website', url)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center gap-2 border-border border-b px-3 py-1.5">
        <Tooltip content={t('miniApp.popup.refresh')} placement="bottom">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('miniApp.popup.refresh')}
            onClick={() => {
              setReady(false)
              setReloadKey((key) => key + 1)
            }}>
            <RotateCw size={14} />
          </Button>
        </Tooltip>
        <form className="min-w-0 flex-1" onSubmit={submit}>
          <Input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            onFocus={(event) => {
              setEditing(true)
              event.currentTarget.select()
            }}
            onBlur={() => {
              setEditing(false)
              setAddress(url)
            }}
            aria-label={t('settings.browser.address')}
            placeholder="https://"
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="h-7 text-xs"
          />
        </form>
        <Tooltip content={t('miniApp.popup.openExternal')} placement="bottom">
          <Button variant="ghost" size="icon-sm" aria-label={t('miniApp.popup.openExternal')} onClick={openExternal}>
            <ExternalLink size={14} />
          </Button>
        </Tooltip>
      </div>
      {invalid && (
        <div
          role="alert"
          className="flex items-center gap-2 bg-warning-subtle px-3 py-2 text-warning-subtle-foreground text-xs">
          <ShieldAlert className="size-4 shrink-0" aria-hidden />
          {invalid}
        </div>
      )}
      <div className="relative min-h-0 flex-1 bg-white">
        <iframe
          key={`${url}:${reloadKey}`}
          src={url}
          title={displayNameOf(url)}
          data-testid="browser-iframe"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
          allow="fullscreen"
          referrerPolicy="no-referrer"
          className="h-full w-full border-0 bg-white"
          onLoad={() => {
            setReady(true)
            const visit = sanitizeBrowserVisitUrl(url)
            if (visit) {
              void ipcApi.request('browser.visit.record', {
                url: visit,
                title: displayNameOf(url),
                visitedAt: Date.now()
              })
            }
          }}
        />
        {!ready && (
          <div
            role="status"
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background px-6 text-center text-muted-foreground text-sm">
            {embedTimedOut ? (
              <>
                <ShieldAlert className="size-5" aria-hidden />
                <p>{t('webview.browser.load_failed')}</p>
                <Button variant="outline" size="sm" onClick={openExternal}>
                  {t('miniApp.popup.openExternal')}
                </Button>
              </>
            ) : (
              t('common.loading')
            )}
          </div>
        )}
      </div>
    </div>
  )
}
