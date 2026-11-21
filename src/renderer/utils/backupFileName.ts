import dayjs from 'dayjs'

import { ipcApi } from '@renderer/ipc'

export async function createDefaultBackupFileName(): Promise<string> {
  // Name generation must never be the reason a backup dialog refuses to open:
  // a host without these probes still gets a usable default.
  const [deviceType, hostname] = await Promise.all([
    ipcApi.request('system.get_device_type').catch(() => 'web'),
    Promise.resolve(window.api.system?.getHostname?.()).catch(() => 'web')
  ])
  const timestamp = dayjs().format('YYYYMMDDHHmmss')

  return `cherry-studio.${timestamp}.${hostname || 'web'}.${deviceType || 'web'}.zip`
}
