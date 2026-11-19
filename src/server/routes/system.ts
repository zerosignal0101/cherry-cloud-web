import type { RouteDef } from '@shared/ipc/define'
import { systemRequestSchemas } from '@shared/ipc/schemas/system'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import type { IpcHandlersFor } from '@shared/ipc/types'

import type { RpcRegistry } from '../transport/registry'

/** Routes the Web host serves itself, before business services are ported. */
const webSystemSchemas = {
  'system.ping': systemRequestSchemas['system.ping'],
  'system.get_device_type': systemRequestSchemas['system.get_device_type'],
  'system.get_native_theme': systemRequestSchemas['system.get_native_theme'],
  'system.get_fonts': systemRequestSchemas['system.get_fonts'],
  'system.get_ip_country': systemRequestSchemas['system.get_ip_country']
} satisfies Record<string, RouteDef>

const webSystemHandlers: IpcHandlersFor<typeof webSystemSchemas> = {
  'system.ping': async (input) => ({ echo: input?.echo, serverTime: Date.now(), transport: 'web' }),
  'system.get_device_type': async () => 'web',
  'system.get_native_theme': async () => ThemeMode.light,
  'system.get_fonts': async () => [],
  'system.get_ip_country': async () => ''
}

export function registerSystemRoutes(registry: RpcRegistry): void {
  registry.register(webSystemSchemas, webSystemHandlers)
}
