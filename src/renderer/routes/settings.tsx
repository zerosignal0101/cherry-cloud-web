import { createFileRoute } from '@tanstack/react-router'

import { WebShell } from '@renderer/components/layout/WebShell'
import SettingsPage from '@renderer/pages/settings/SettingsPage'

// 布局路由：SettingsPage 作为布局组件，使用 Outlet 渲染子路由
// The settings surfaces live inside the same navigation shell as the app pages,
// so the desktop rail and the phone bottom bar stay reachable from settings.
export const Route = createFileRoute('/settings')({
  component: () => (
    <WebShell>
      <SettingsPage />
    </WebShell>
  )
})
