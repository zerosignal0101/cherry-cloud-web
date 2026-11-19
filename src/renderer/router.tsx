import { createRouter } from '@tanstack/react-router'

import { routeTree } from './routeTree.gen'

/**
 * The single router the browser owns.
 *
 * The desktop build gives every tab its own `MemoryRouter` so background tabs
 * keep their state. A URL is the state here: each page lives at its own path,
 * the browser's back/forward buttons work, and a reload restores the page.
 */
export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  scrollRestoration: true
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
