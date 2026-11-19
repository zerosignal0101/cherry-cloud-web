import { useCallback, useMemo, useSyncExternalStore } from 'react'

import { TabsContext, type OpenTabOptions, type TabsContextValue } from '@renderer/hooks/tab/useTabsContext'
import { router } from '@renderer/router'
import { getDefaultRouteTitle, isPageTitledRoute } from '@renderer/utils/routeTitle'
import type { Tab } from '@shared/data/cache/cacheValueTypes'

/** Where a closed or unresolvable page lands. */
const HOME_URL = '/app/chat'

const EXTERNAL_URL = /^[a-z][a-z0-9+.-]*:\/\//i

function toTab(href: string): Tab {
  return {
    id: href,
    type: 'route',
    url: href,
    // The page owns its title (topic name, agent name); the route default is the
    // best a URL can supply before that page mounts.
    title: isPageTitledRoute(href) ? '' : getDefaultRouteTitle(href),
    lastAccessTime: Date.now(),
    isDormant: false
  }
}

/**
 * Subscribes to the router singleton instead of `useRouterState`, so the provider
 * can sit above `RouterProvider` (next to the other window-scoped hosts) rather
 * than inside the route tree. `useRouterState` needs a router context; every
 * `useTabs()` caller outside the route tree — navigation bridge, popup hosts —
 * would otherwise throw on mount.
 */
function useCurrentHref(): string {
  return useSyncExternalStore(
    (onStoreChange) => router.subscribe('onResolved', onStoreChange),
    () => router.state.location.href
  )
}

/**
 * `TabsContext` over the URL.
 *
 * The pages, sidebars and command palette were written against `useTabs()`; in
 * the web build a tab *is* a location, so this provider keeps that surface and
 * turns every navigation into a history push. Operations that only exist for
 * window bookkeeping (pin, reorder, detach, LRU hibernation) have no meaning
 * once the browser owns the pages, and are no-ops.
 */
export function UrlTabsProvider({ children }: { children: React.ReactNode }) {
  const href = useCurrentHref()
  const activeTab = useMemo(() => toTab(href), [href])

  const navigate = useCallback(
    (url: string) => {
      if (!url) return
      if (EXTERNAL_URL.test(url)) {
        window.open(url, '_blank', 'noopener,noreferrer')
        return
      }
      if (url === href) return
      void router.history.push(url)
    },
    [href]
  )

  const value = useMemo<TabsContextValue>(() => {
    const noop = () => {}
    return {
      tabs: [activeTab],
      activeTabId: activeTab.id,
      activeTab,
      isLoading: false,

      addTab: (tab) => navigate(tab.url),
      closeTab: (id) => {
        if (id === activeTab.id) navigate(HOME_URL)
      },
      closeTabs: (ids, activateId) => {
        if (!ids.includes(activeTab.id)) return
        navigate(activateId ?? HOME_URL)
      },
      setActiveTab: (id) => navigate(id),
      updateTab: (id, updates) => {
        if (id !== activeTab.id || !updates.url) return
        navigate(updates.url)
      },

      openTab: (url, options?: OpenTabOptions) => {
        // `forceNew` opens another instance of the same page in the desktop
        // tab bar; a URL can only hold one, so the option is ignored.
        void options
        navigate(url)
        return url
      },

      pinTab: noop,
      unpinTab: noop,
      reorderTabs: noop,
      detachTab: noop,
      attachTab: noop
    }
  }, [activeTab, navigate])

  return <TabsContext value={value}>{children}</TabsContext>
}
