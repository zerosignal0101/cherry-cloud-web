import { eq } from 'drizzle-orm'
import { app } from 'electron'

import { application } from '@application'
import { miniAppInstallationTable } from '@data/db/schemas/miniApp'
import { miniAppActivityLog } from '@main/features/miniApp/activityLog'
import { aiCapability } from '@main/features/miniApp/capabilities/ai'
import { fileCapability } from '@main/features/miniApp/capabilities/file'
import { networkCapability } from '@main/features/miniApp/capabilities/network'
import { notificationCapability } from '@main/features/miniApp/capabilities/notification'
import { storageCapability } from '@main/features/miniApp/capabilities/storage'
import { InvalidArgumentError } from '@main/features/miniApp/errors'
import { assertMethodAllowed, listGrants } from '@main/features/miniApp/grants'
import { installationOf } from '@main/features/miniApp/install/installer'
import { publicErrorOf } from '@main/features/miniApp/runtime/bridge'
import { getAppLanguage } from '@main/i18n'
import type { BridgeResult } from '@shared/ipc/schemas/miniAppBridge'
import {
  declaredGrantKeys,
  MINI_APP_METHODS,
  MiniAppManifestSchema,
  type MiniAppMethod
} from '@shared/types/miniAppManifest'

type Emit = (chunk: string) => void

/**
 * A stable fake guest id for one app in this process.
 *
 * Capabilities use it to scope hidden budgets, cancellation and file leases. No
 * Chromium webContents exists, so the id is derived rather than allocated; the
 * WebMiniAppRuntimeService treats every id as visible and alive.
 */
export function webGuestId(appId: string): number {
  let hash = 2166136261
  for (let index = 0; index < appId.length; index += 1) {
    hash ^= appId.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0 || 1
}

function installedVersionOf(appId: string): string {
  return (
    application
      .get('DbService')
      .getDb()
      .select({ version: miniAppInstallationTable.version })
      .from(miniAppInstallationTable)
      .where(eq(miniAppInstallationTable.appId, appId))
      .all()[0]?.version ?? '0.0.0'
  )
}

async function route(
  appId: string,
  method: MiniAppMethod,
  params: unknown,
  emit: Emit,
  callId: string | undefined
): Promise<unknown> {
  const guestId = webGuestId(appId)
  switch (method) {
    case 'app.getInfo':
      return {
        appId,
        version: installedVersionOf(appId),
        hostVersion: app.getVersion(),
        locale: getAppLanguage()
      }
    case 'app.getPermissions': {
      const manifest = MiniAppManifestSchema.parse(installationOf(appId).manifestJson)
      const granted = new Set(listGrants(appId))
      return Object.fromEntries(declaredGrantKeys(manifest).map((key) => [key, granted.has(key)]))
    }
    case 'ai.chat': {
      const chunks: string[] = []
      await aiCapability.chat(
        appId,
        params,
        (chunk) => {
          chunks.push(chunk)
          emit(chunk)
        },
        guestId,
        callId
      )
      return { text: chunks.join('') }
    }
    case 'ai.cancel':
      return aiCapability.cancel(appId, params, guestId)
    case 'ai.getCapabilities':
      return aiCapability.getCapabilities(appId, params)
    case 'storage.get':
      return storageCapability.get(appId, params)
    case 'storage.set':
      return storageCapability.set(appId, params)
    case 'storage.delete':
      return storageCapability.delete(appId, params)
    case 'storage.keys':
      return storageCapability.keys(appId)
    case 'storage.usage':
      return storageCapability.usage(appId)
    case 'file.save':
      return fileCapability.save(appId, params)
    case 'file.load':
      return fileCapability.load(appId, params)
    case 'file.list':
      return fileCapability.list(appId)
    case 'file.delete':
      return fileCapability.delete(appId, params)
    case 'file.usage':
      return fileCapability.usage(appId)
    case 'file.export': {
      // The browser has no native save dialog: return the bytes to the host pane,
      // which turns them into a download and then answers `{ saved: true }`.
      const input = params as { name?: unknown; suggestedName?: unknown } | undefined
      if (typeof input?.name !== 'string') throw new InvalidArgumentError('file.export requires a name')
      const loaded = await fileCapability.load(appId, { name: input.name })
      if (!loaded.data) throw new InvalidArgumentError(`No file named "${input.name}"`)
      return {
        data: loaded.data,
        name: input.name,
        suggestedName: typeof input.suggestedName === 'string' ? input.suggestedName : input.name
      }
    }
    case 'notification.show':
      return notificationCapability.show(appId, params)
    case 'clipboard.read':
      // The server gate has run; the host pane performs the actual read because
      // only the browser has the user's clipboard and focus state.
      return { ok: true }
    case 'clipboard.write':
      return { ok: true }
    case 'network.fetch':
      return networkCapability.fetch(appId, params, guestId)
  }
}

/** One bridge call from a sandboxed iframe; never throws, like the desktop bridge. */
export async function handleWebMiniAppBridge(
  appId: string,
  payload: { method: string; params?: unknown; requestId?: string; callId?: string },
  emit: Emit = () => {}
): Promise<BridgeResult> {
  const started = Date.now()
  try {
    const runtime = application.get('MiniAppRuntimeService')
    runtime.beginCapabilityCall(appId)
    if (!Object.hasOwn(MINI_APP_METHODS, payload.method)) {
      throw new InvalidArgumentError(`Unknown method: ${payload.method}`)
    }
    const method = payload.method as MiniAppMethod
    assertMethodAllowed(appId, method)
    const value = await route(appId, method, payload.params, emit, payload.callId)
    miniAppActivityLog.recordCall(appId, method, 'ok', Date.now() - started, payload.params, value)
    return { ok: true, value }
  } catch (error) {
    const method = Object.hasOwn(MINI_APP_METHODS, payload.method) ? (payload.method as MiniAppMethod) : undefined
    if (method) {
      miniAppActivityLog.recordCall(
        appId,
        method,
        publicErrorOf(error).name,
        Date.now() - started,
        payload.params,
        undefined,
        error instanceof Error ? error.constructor.name.slice(0, 64) : undefined
      )
    }
    return { ok: false, error: publicErrorOf(error) }
  }
}
