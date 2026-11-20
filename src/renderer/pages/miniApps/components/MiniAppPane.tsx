import type { FC } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BeatLoader } from 'react-spinners'

import { cn } from '@cherrystudio/ui/lib/utils'
import MiniAppLogoAvatar from '@renderer/components/icons/MiniAppLogoAvatar'
import { ipcApi } from '@renderer/ipc'
import type { MiniApp } from '@shared/data/types/miniApp'
import type { BridgeResult, CherryPublicError } from '@shared/ipc/schemas/miniAppBridge'
import { isHttpUrl } from '@shared/utils/url'

import MinimalToolbar, { type SplitMode } from './MinimalToolbar'

const MINI_APP_LOADING_COLOR = 'var(--muted-foreground)'

interface Props {
  app: MiniApp
  splitMode: SplitMode
  splitActive?: boolean
  onSplit: () => void
  hostShortcutEnabled?: boolean
  onActivate?: () => void
  className?: string
}

interface BridgeRequest {
  type: 'cherry:bridge:request'
  appId: string
  requestId: string
  method: string
  params?: unknown
  callId?: string
}

function failure(error: unknown): BridgeResult {
  const name = error instanceof Error && error.name !== 'Error' ? error.name : 'Internal'
  return {
    ok: false,
    error: {
      name: name as CherryPublicError['name'],
      message: error instanceof Error ? error.message : 'Mini app call failed'
    }
  }
}

function base64ToBlob(data: string, type: string): Blob {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type })
}

/**
 * One mini app iframe.
 *
 * Site apps are remote URLs; local apps are served from the signed
 * `/api/miniapps/:id/assets/...` route with an injected bridge script. The pane
 * owns the host half of that bridge: it validates `event.source`, forwards the
 * call over the authenticated RPC channel, and performs the two operations that
 * only a browser can do (clipboard and download).
 */
const MiniAppPane: FC<Props> = ({
  app,
  splitMode,
  splitActive,
  onSplit,
  hostShortcutEnabled: _hostShortcutEnabled,
  onActivate,
  className
}) => {
  const { t } = useTranslation()
  const displayName = app.nameKey ? t(app.nameKey) : app.name
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [src, setSrc] = useState(app.url)
  const [reloadKey, setReloadKey] = useState(0)
  const [isReady, setIsReady] = useState(false)
  const [embedTimedOut, setEmbedTimedOut] = useState(false)
  const onActivateRef = useRef(onActivate)
  onActivateRef.current = onActivate

  useEffect(() => {
    setSrc(app.url)
    setReloadKey((key) => key + 1)
    setIsReady(false)
  }, [app.url])

  useEffect(() => {
    if (isReady) {
      setEmbedTimedOut(false)
      return
    }
    const timer = setTimeout(() => setEmbedTimedOut(true), 12_000)
    return () => clearTimeout(timer)
  }, [isReady, reloadKey, src])

  const reply = useCallback((requestId: string, result: BridgeResult) => {
    iframeRef.current?.contentWindow?.postMessage({ type: 'cherry:bridge:reply', requestId, result }, '*')
  }, [])

  const invoke = useCallback(async (request: BridgeRequest): Promise<BridgeResult> => {
    const result = (await ipcApi.request('mini_app.bridge.invoke', {
      appId: request.appId,
      method: request.method,
      params: request.params,
      requestId: request.requestId,
      ...(request.callId ? { callId: request.callId } : {})
    })) as BridgeResult

    if (!result.ok) return result

    try {
      if (request.method === 'clipboard.read') {
        if (!navigator.clipboard?.readText) {
          return {
            ok: false,
            error: { name: 'Unavailable', message: 'The browser does not expose clipboard reads here' }
          }
        }
        return { ok: true, value: { text: (await navigator.clipboard.readText()).slice(0, 1024 * 1024) } }
      }
      if (request.method === 'clipboard.write') {
        if (!navigator.clipboard?.writeText) {
          return {
            ok: false,
            error: { name: 'Unavailable', message: 'The browser does not expose clipboard writes here' }
          }
        }
        const text = (request.params as { text?: unknown } | undefined)?.text
        if (typeof text !== 'string') {
          return { ok: false, error: { name: 'InvalidArgument', message: 'clipboard.write requires text' } }
        }
        await navigator.clipboard.writeText(text)
        return { ok: true, value: { ok: true } }
      }
      if (request.method === 'file.export') {
        const exported = result.value as { data?: string; suggestedName?: string; name?: string } | undefined
        if (!exported?.data) return { ok: true, value: { saved: false } }
        const blob = base64ToBlob(exported.data, 'application/octet-stream')
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = exported.suggestedName ?? exported.name ?? 'download'
        anchor.rel = 'noopener'
        anchor.click()
        setTimeout(() => URL.revokeObjectURL(url), 0)
        return { ok: true, value: { saved: true } }
      }
      return result
    } catch (error) {
      return failure(error)
    }
  }, [])

  useEffect(() => {
    if (app.kind !== 'app') return
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return
      const data = event.data as Partial<BridgeRequest> | undefined
      if (!data || data.type !== 'cherry:bridge:request') return
      if (data.appId !== app.appId || typeof data.requestId !== 'string' || typeof data.method !== 'string') return
      void invoke(data as BridgeRequest).then((result) => reply(data.requestId!, result))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [app.appId, invoke, reply])

  const handleReload = useCallback(() => {
    setIsReady(false)
    setReloadKey((key) => key + 1)
  }, [])

  const handleRestart = useCallback(() => {
    setSrc(app.url)
    handleReload()
  }, [app.url, handleReload])

  return (
    <div
      className={cn('pointer-events-none relative flex h-full min-h-0 flex-col *:pointer-events-auto', className)}
      onFocusCapture={onActivate}
      onMouseDownCapture={onActivate}>
      <div className="shrink-0">
        <MinimalToolbar
          app={app}
          currentUrl={src}
          isReady={isReady}
          onReload={handleReload}
          onRestart={handleRestart}
          onNavigate={setSrc}
          splitMode={splitMode}
          splitActive={splitActive}
          onSplit={onSplit}
        />
      </div>
      <iframe
        key={`${app.appId}:${reloadKey}`}
        ref={iframeRef}
        src={src}
        title={displayName}
        data-testid="mini-app-iframe"
        sandbox={
          app.kind === 'app'
            ? 'allow-scripts allow-forms allow-modals allow-popups'
            : 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox'
        }
        allow="fullscreen"
        referrerPolicy="no-referrer"
        className="h-full w-full flex-1 border-0 bg-white"
        onLoad={() => setIsReady(true)}
      />
      {!isReady && (
        <div className="absolute inset-x-0 top-8.75 bottom-0 z-4 flex flex-col items-center justify-center gap-3 bg-card px-6 text-center">
          <MiniAppLogoAvatar logo={app.logoSrc ?? app.logo} size={60} alt={displayName} />
          {embedTimedOut ? (
            <>
              <p className="max-w-sm text-muted-foreground text-sm">{t('webview.browser.load_failed')}</p>
              {isHttpUrl(src) && (
                <button
                  type="button"
                  className="cursor-pointer text-primary text-sm underline"
                  onClick={() => void ipcApi.request('system.shell.open_external_website', src)}>
                  {t('miniApp.popup.openExternal')}
                </button>
              )}
            </>
          ) : (
            <BeatLoader color={MINI_APP_LOADING_COLOR} size={8} style={{ marginTop: 12 }} />
          )}
        </div>
      )}
    </div>
  )
}

export default MiniAppPane
