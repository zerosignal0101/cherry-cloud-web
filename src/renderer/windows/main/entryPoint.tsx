import '@renderer/assets/styles/index.css'
import '@renderer/assets/styles/tailwind.css'
import { installWebApi } from '@renderer/ipc/webApi'
import { createRoot } from 'react-dom/client'

/**
 * The transport facade must exist before any application module is evaluated:
 * `preferenceService` and `loggerService` build themselves at module scope and
 * read `window.api` / `window.electron` in their constructors — the desktop
 * equivalent of the preload script running first. Static imports would all be
 * evaluated before the first statement here, so the app modules are imported
 * dynamically after the bridge is installed.
 */
installWebApi()

const { prepareWindow } = await import('@renderer/windows/prepareWindow')
const { default: MainApp } = await import('./MainApp')

await prepareWindow({ preference: 'all' })

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(<MainApp />)
