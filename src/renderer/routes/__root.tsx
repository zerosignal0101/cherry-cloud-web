import { createRootRoute, Outlet } from '@tanstack/react-router'

/**
 * The URL-backed tabs shim lives above `RouterProvider` (see `MainApp`), not
 * here: window-scoped hosts outside the route tree also call `useTabs()`.
 */
export const Route = createRootRoute({
  component: () => <Outlet />
})
