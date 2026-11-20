# Routing System

The Web build uses **TanStack Router with one URL-backed router**. A URL is the page: `/app/*` and `/settings/*` live inside the shared navigation shell, browser back/forward works, and a reload restores the page.

The desktop app's per-tab `MemoryRouter` and webview tabs were removed in M16. The `TabsContext` shim above the router still exposes the subset of the tab API that upstream components call (`openTab`, `closeTab`, active tab), but each tab is a URL route, not an independent router.

## Adding a Page

Create a file under `src/renderer/routes/`. The path becomes the URL.

```tsx
// src/renderer/routes/app/notes.tsx
import { createFileRoute } from '@tanstack/react-router'
import NotesPage from '@renderer/pages/notes/NotesPage'

export const Route = createFileRoute('/app/notes')({
  component: NotesPage
})
```

Run `pnpm dev` (or any Vite build); the router plugin regenerates `routeTree.gen.ts`. Do not edit the generated file by hand.

## Navigation

Inside a page, use TanStack Router:

```tsx
const navigate = useNavigate()
navigate({ to: '/settings/provider' })
navigate({ to: '/app/mini-app/$appId', params: { appId } })
```

From non-route runtime code (popups, message actions), use `openTab`/`openSettingsTab` from the renderer services. These ultimately change the URL; `forceNew` is only meaningful for detached desktop windows and is not used by the Web shell.

## Layout

- `src/renderer/routes/app.tsx` wraps `/app/*` in `WebShell`.
- `src/renderer/routes/settings.tsx` wraps `/settings/*` in the same shell.
- Desktop shows a 56px icon rail; phones show a bottom bar and a settings drawer.
- Only Web-scoped routes are registered. Removed desktop pages (knowledge, paintings, launchpad, subscription, channels, selection/quick assistant, screenshot, shortcuts, local models, dependencies and device pairing) are not in the tree and are rejected by `isKnownNavigationPath`.

## Generated Tree

`routeTree.gen.ts` is produced by `@tanstack/router-plugin` from the files under `src/renderer/routes/`. Adding or deleting a route file requires a Vite dev run or build so the tree and type registrations stay in sync.
