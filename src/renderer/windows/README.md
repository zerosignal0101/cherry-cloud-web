# Renderer Windows

The Web build has **one** browser window entry plus the unauthenticated login entry. Desktop-only windows (quick assistant, screenshot, selection assistant, sub-window, data relocation, legacy upgrade) were removed in M16.

## Entries

| Entry | Bootstrap | Responsibility |
|---|---|---|
| `main` | `main/entryPoint.tsx` | Authenticated SPA: load styles, `installWebApi()`, check `/api/auth/status`, then `prepareWindow({ preference: 'all' })` and render `MainApp`. |
| `login` | `windows/login/LoginApp.tsx` | Public password gate. Deliberately does not touch preference/IPC or the lazy i18n catalogs; it uses a local zh/en dictionary, the public auth endpoints, and `/api/ui/bootstrap` for the configured theme/language. |

Both entries are served from `src/renderer/index.html`; the URL decides which branch renders. There is no second HTML document or memory router per tab — the URL is the page.

## prepareWindow

`prepareWindow.ts` initializes i18n and warms the preference cache before the first authenticated render, avoiding a theme/language flash. It must run after `installWebApi()` because `preferenceService` reads `window.api` when constructed.

## Removed desktop runtime

- `<webview>` hosts, annotation preloads, screenshot/selection windows and window tear-off are gone.
- `window.electron` is an inert compatibility object installed by `installWebApi()` (`platform: 'web'`, no-op IPC channels). It is not Electron and must not be used for new capabilities.
- Agent browsing runs on the server through Playwright; the browser UI is the sandboxed iframe at `/app/browser`.
