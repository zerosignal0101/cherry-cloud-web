import '@renderer/assets/styles/index.css'
import '@renderer/assets/styles/tailwind.css'
import { createRoot } from 'react-dom/client'

import { installWebApi } from '@renderer/ipc/webApi'

/**
 * The transport facade must exist before any application module is evaluated:
 * `preferenceService` and `loggerService` build themselves at module scope and
 * read `window.api` / `window.electron` in their constructors — the desktop
 * equivalent of the preload script running first. Static imports would all be
 * evaluated before the first statement here, so the app modules are imported
 * dynamically after the bridge is installed.
 */
installWebApi()

const root = createRoot(document.getElementById('root') as HTMLElement)

/**
 * The same bundle serves the login gate and the application. Only the
 * authenticated branch may touch preferences/IPC: on `/login` those calls would
 * 401 and bounce the page back to itself.
 */
async function isAuthenticated(): Promise<boolean> {
  try {
    const response = await fetch('/api/auth/status', { credentials: 'same-origin' })
    if (!response.ok) return false
    const body = (await response.json()) as { data?: { authenticated?: unknown } }
    return body.data?.authenticated === true
  } catch {
    return false
  }
}

if (await isAuthenticated()) {
  const { prepareWindow } = await import('@renderer/windows/prepareWindow')
  const { default: MainApp } = await import('./MainApp')
  await prepareWindow({ preference: 'all' })
  root.render(<MainApp />)
} else {
  const { default: LoginApp } = await import('@renderer/windows/login/LoginApp')
  const { prepareLoginPage } = await import('@renderer/windows/login/loginBootstrap')
  const language = await prepareLoginPage()
  root.render(<LoginApp language={language} />)
}
