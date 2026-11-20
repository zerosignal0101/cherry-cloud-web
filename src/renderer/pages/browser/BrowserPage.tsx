import { useNavigate } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { IframeBrowser } from '@renderer/components/IframeBrowser'
import { useTabSelfVisuals } from '@renderer/hooks/tab'
import { getBrowserStartPageUrl, rememberBrowserPageUrl } from '@renderer/services/browserStartPage'

const START_PAGE_CONTEXT = 'standalone:persist:agent-browser'

/**
 * The standalone browser tab.
 *
 * Remote pages run in a sandboxed iframe. The desktop app could read guest
 * titles and history through Chromium; here the address is the only reliable
 * navigation fact, so it also becomes the tab title and the history entry.
 */
export function BrowserPage({ initialUrl }: { initialUrl?: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate({ from: '/app/browser' })
  const [title, setTitle] = useState(initialUrl || t('settings.browser.title'))
  const startUrl = initialUrl && initialUrl !== 'about:blank' ? initialUrl : getBrowserStartPageUrl(START_PAGE_CONTEXT)
  useTabSelfVisuals({ title: title || t('settings.browser.title'), icon: undefined, routePrefix: '/app/browser' })

  const handleUrlChange = useCallback(
    (url: string) => {
      if (url !== initialUrl) void navigate({ search: { url }, replace: true })
      rememberBrowserPageUrl(START_PAGE_CONTEXT, url)
    },
    [initialUrl, navigate]
  )

  if (startUrl.startsWith('file:')) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-muted-foreground text-sm">
        {t('webview.navigation.load_failed')}
      </div>
    )
  }

  return <IframeBrowser initialUrl={startUrl} onUrlChange={handleUrlChange} onTitleChange={setTitle} />
}
