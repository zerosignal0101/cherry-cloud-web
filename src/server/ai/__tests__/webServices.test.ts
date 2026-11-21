import { describe, expect, it } from 'vitest'

import { WebAttachmentPresenceService, WebKnowledgeService } from '../webServices'

describe('web service stubs', () => {
  it('reports no pending remote attachment selections', async () => {
    await expect(new WebAttachmentPresenceService().list('session-a')).resolves.toEqual([])
  })

  it('has no knowledge bases', () => {
    expect(new WebKnowledgeService().hasAnyBase()).toBe(false)
  })
})
