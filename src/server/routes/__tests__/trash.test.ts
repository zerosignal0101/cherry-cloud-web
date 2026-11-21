import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock } = vi.hoisted(() => ({ appGetMock: vi.fn() }))
vi.mock('@application', () => ({ application: { get: appGetMock } }))

import { trashRequestSchemas } from '@shared/ipc/schemas/trash'

import { RpcRegistry } from '../../transport/registry'
import { registerTrashRoutes } from '../trash'

const trashService = {
  archiveAssistant: vi.fn(),
  archiveAssistantTopics: vi.fn(),
  archiveTopics: vi.fn(),
  deleteActiveAssistantPermanently: vi.fn(),
  deleteActiveTopicsPermanently: vi.fn(),
  purgeNow: vi.fn()
}

const ctx = { senderId: 'client-1' }

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'TrashService') return trashService
    throw new Error(`Unexpected application.get(${name})`)
  })
})

describe('trash routes', () => {
  it('exposes every recycle-bin route over RPC', () => {
    const registry = new RpcRegistry()
    registerTrashRoutes(registry)

    expect(registry.routeNames()).toEqual(expect.arrayContaining(Object.keys(trashRequestSchemas)))
  })

  it('archives topics through TrashService', async () => {
    trashService.archiveTopics.mockResolvedValue({ deletedIds: ['topic-a'], deletedCount: 1 })
    const registry = new RpcRegistry()
    registerTrashRoutes(registry)

    const result = await registry.dispatch('trash.topic.archive', { topicIds: ['topic-a'] }, ctx)

    expect(result).toEqual({ ok: true, data: { deletedIds: ['topic-a'], deletedCount: 1 } })
    expect(trashService.archiveTopics).toHaveBeenCalledWith(['topic-a'])
  })
})
