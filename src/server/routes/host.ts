import type { RouteDef } from '@shared/ipc/define'
import { appRequestSchemas } from '@shared/ipc/schemas/app'
import { navigationRequestSchemas } from '@shared/ipc/schemas/navigation'
import { windowRequestSchemas } from '@shared/ipc/schemas/window'
import type { IpcHandlersFor } from '@shared/ipc/types'
import { NOTES_ROOT_PATH } from '@shared/types/note'

import type { RpcRegistry } from '../transport/registry'

/**
 * Desktop-only IpcApi routes that the still-shared renderer calls on boot.
 *
 * They describe a host the browser does not have — OS paths, a fullscreen flag on
 * a native window, per-window init data. Answering them with web-neutral values
 * keeps `useWindowRuntime` and the window-scoped hosts from throwing on an
 * unimplemented route; each stub is only valid while the caller tolerates the
 * neutral answer, so extend this list one route at a time.
 */
const hostSchemas = {
  'app.get_info': appRequestSchemas['app.get_info'],
  'window.is_full_screen': windowRequestSchemas['window.is_full_screen'],
  'window.get_init_data': windowRequestSchemas['window.get_init_data'],
  'navigation.protocol_dispatch_ready': navigationRequestSchemas['navigation.protocol_dispatch_ready']
} satisfies Record<string, RouteDef>

const hostHandlers: IpcHandlersFor<typeof hostSchemas> = {
  /**
   * Paths stay empty on purpose: the server's filesystem layout is not the
   * browser's business, and the page only uses these values to shorten inline
   * file paths for display.
   */
  'app.get_info': async () => ({
    version: process.env.APP_VERSION ?? '0.0.0',
    isPackaged: true,
    appPath: '',
    homePath: '',
    // Logical namespace; the server maps it to `DATA_DIR/notes`.
    notesPath: NOTES_ROOT_PATH,
    configPath: '',
    appDataPath: '',
    resourcesPath: '',
    logsPath: '',
    arch: process.arch,
    isPortable: false,
    installPath: ''
  }),

  // Fullscreen belongs to the browser window; the renderer re-reads it itself when
  // the user toggles it. Startup only needs "not fullscreen".
  'window.is_full_screen': async () => false,

  // Windows have no server-side init payload — a tab's state is in its URL.
  'window.get_init_data': async () => null,

  'navigation.protocol_dispatch_ready': async () => {}
}

export function registerHostRoutes(registry: RpcRegistry): void {
  registry.register(hostSchemas, hostHandlers)
}
