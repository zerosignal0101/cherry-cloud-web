import { useMemo } from 'react'

import { useCache, useSharedCacheSelector } from '@renderer/data/hooks/useCache'
import { useQuery } from '@renderer/data/hooks/useDataApi'
import { useOptionalTabsContext } from '@renderer/hooks/tab'
import { toTransientMiniApp } from '@renderer/utils/miniAppDescriptor'
import { miniAppIdFromTabUrl } from '@renderer/utils/miniAppKeepAlive'

function useMiniAppDescriptors(appIds: string[]) {
  const { data: apps } = useQuery('/mini-apps')
  const descriptors = useSharedCacheSelector(
    appIds.map((id) => `mini_app.transient_descriptor.${id}` as const),
    (values) => values
  )
  const byId = useMemo(
    () =>
      new Map(
        appIds.map((id, index) => {
          const descriptor = descriptors[index]
          return [
            id,
            apps?.find((app) => app.appId === id) ?? (descriptor ? toTransientMiniApp(descriptor) : undefined)
          ]
        })
      ),
    [appIds, apps, descriptors]
  )
  return { apps, byId }
}

function useMiniAppLayout() {
  const tabs = useOptionalTabsContext()
  const [split, setSplit] = useCache('mini_app.split')
  const currentMiniAppId = miniAppIdFromTabUrl(tabs?.activeTab?.url) ?? ''
  const splitOpen = !!currentMiniAppId && !!split && split.appId !== currentMiniAppId
  const splitMiniAppId = splitOpen ? (split.appId ?? '') : ''
  const appIds = useMemo(
    () => [
      ...new Set([
        ...(tabs?.tabs.flatMap((tab) => {
          const id = miniAppIdFromTabUrl(tab.url)
          return id ? [id] : []
        }) ?? []),
        ...(splitMiniAppId ? [splitMiniAppId] : [])
      ])
    ],
    [tabs?.tabs, splitMiniAppId]
  )
  return {
    split,
    setSplit,
    currentMiniAppId,
    splitOpen,
    splitMiniAppId,
    appIds
  }
}

export function useMiniAppRuntime() {
  const layout = useMiniAppLayout()
  const { byId } = useMiniAppDescriptors(layout.appIds)
  // There is no webview pool in the web build: "opened" means "referenced by a
  // tab or the split pane", and each pane owns its sandboxed iframe.
  const openedKeepAliveMiniApps = useMemo(
    () =>
      layout.appIds.flatMap((appId) => {
        const app = byId.get(appId)
        return app ? [app] : []
      }),
    [byId, layout.appIds]
  )
  return {
    openedKeepAliveMiniApps,
    currentMiniAppId: layout.currentMiniAppId,
    miniAppShow: !!layout.currentMiniAppId,
    splitOpen: layout.splitOpen,
    splitMiniAppId: layout.splitMiniAppId
  }
}
