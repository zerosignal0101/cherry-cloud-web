import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'

import { createDefaultBackupFileName } from '../backupFileName'

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: vi.fn() }
}))

describe('createDefaultBackupFileName', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts independent device metadata reads concurrently', async () => {
    let resolveDeviceType!: (value: string) => void
    let resolveHostname!: (value: string) => void
    const deviceType = new Promise<string>((resolve) => {
      resolveDeviceType = resolve
    })
    const hostname = new Promise<string>((resolve) => {
      resolveHostname = resolve
    })

    vi.mocked(ipcApi.request).mockReturnValue(deviceType as never)
    vi.stubGlobal('window', {
      ...window,
      api: {
        ...window.api,
        system: { ...window.api.system, getHostname: vi.fn(() => hostname) }
      }
    })

    const fileName = createDefaultBackupFileName()

    expect(ipcApi.request).toHaveBeenCalledWith('system.get_device_type')
    expect(window.api.system.getHostname).toHaveBeenCalledOnce()

    resolveHostname('macbook')
    resolveDeviceType('desktop')

    await expect(fileName).resolves.toMatch(/^cherry-studio\.\d{14}\.macbook\.desktop\.zip$/)
  })

  it('falls back to a usable name when the host probes are unavailable', async () => {
    vi.mocked(ipcApi.request).mockRejectedValueOnce(new Error('Unknown IpcApi route'))
    vi.stubGlobal('window', {
      ...window,
      api: { ...window.api, system: undefined }
    })

    await expect(createDefaultBackupFileName()).resolves.toMatch(/^cherry-studio\.\d{14}\.web\.web\.zip$/)
  })
})
