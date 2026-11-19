import { createFileRoute, Outlet } from '@tanstack/react-router'

import { WebShell } from '@renderer/components/layout/WebShell'

/** `/app/*` renders inside the navigation shell; the page itself is the outlet. */
export const Route = createFileRoute('/app')({
  component: () => (
    <WebShell>
      <Outlet />
    </WebShell>
  )
})
