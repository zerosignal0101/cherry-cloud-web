import { describe, expect, it } from 'vitest'

import { WebAttachmentPresenceService, WebClaudeCodeBinaryService, WebKnowledgeService } from '../webServices'

describe('web service stubs', () => {
  it('reports no pending remote attachment selections', async () => {
    await expect(new WebAttachmentPresenceService().list('session-a')).resolves.toEqual([])
  })

  it('reports the Claude Code binary as unsupported without downloading it', async () => {
    const service = new WebClaudeCodeBinaryService()

    expect(service.getStatus()).toEqual({ version: '', phase: 'error', receivedBytes: 0, error: 'unsupported' })
    expect(service.ensure(true)).toEqual(service.getStatus())
    await expect(service.ensureExecutable()).rejects.toThrow('not available in the web build')
    expect(() => service.requireExecutable()).toThrow('not available in the web build')
  })

  it('has no knowledge bases', () => {
    expect(new WebKnowledgeService().hasAnyBase()).toBe(false)
  })
})
