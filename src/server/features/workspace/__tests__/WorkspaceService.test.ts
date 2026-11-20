import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { WorkspaceService } from '../WorkspaceService'

const roots: string[] = []

function createService(): { service: WorkspaceService; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'ccw-workspace-'))
  roots.push(root)
  return { service: new WorkspaceService(join(root, 'workspaces')), root: join(root, 'workspaces') }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('WorkspaceService', () => {
  it('creates, lists and deletes a workspace', async () => {
    const { service } = createService()
    const created = await service.create('Notes')

    expect(created).toMatchObject({ name: 'Notes' })
    await expect(service.list()).resolves.toMatchObject([{ id: created.id, name: 'Notes' }])

    await service.delete(created.id)
    await expect(service.list()).resolves.toEqual([])
  })

  it('reads and writes nested text files', async () => {
    const { service } = createService()
    const { id } = await service.create('Notes')

    await service.writeFile(id, 'folder/hello.md', '# hello')
    await expect(service.readFile(id, 'folder/hello.md')).resolves.toMatchObject({
      content: '# hello',
      size: 7
    })
    await expect(service.listFiles(id)).resolves.toMatchObject([{ path: 'folder', name: 'folder', kind: 'directory' }])
    await expect(service.listFiles(id, 'folder')).resolves.toMatchObject([
      { path: 'folder/hello.md', kind: 'file', size: 7 }
    ])

    await service.deleteFile(id, 'folder/hello.md')
    await expect(service.listFiles(id, 'folder')).resolves.toEqual([])
  })

  it('rejects traversal and absolute paths', async () => {
    const { service } = createService()
    const { id } = await service.create('Notes')

    await expect(service.writeFile(id, '../escape.md', 'x')).rejects.toThrow(/Invalid workspace path/)
    await expect(service.writeFile(id, 'folder/../../escape.md', 'x')).rejects.toThrow(/Invalid workspace path/)
    await expect(service.writeFile(id, '/etc/passwd', 'x')).rejects.toThrow(/Invalid workspace path/)
    await expect(service.readFile(id, 'folder\\..\\escape.md')).rejects.toThrow(/Invalid workspace path/)
  })

  it('rejects symlinked files and directories', async () => {
    const { service, root } = createService()
    const { id } = await service.create('Notes')
    const outside = mkdtempSync(join(tmpdir(), 'ccw-outside-'))
    roots.push(outside)
    writeFileSync(join(outside, 'secret.txt'), 'secret')
    symlinkSync(outside, join(root, id, 'linked'))

    await expect(service.readFile(id, 'linked/secret.txt')).rejects.toThrow(/symbolic link/)
    await expect(service.writeFile(id, 'linked/new.txt', 'x')).rejects.toThrow(/symbolic link/)
    await expect(service.listFiles(id)).resolves.toEqual([])
  })

  it('rejects binary and oversized content', async () => {
    const { service, root } = createService()
    const { id } = await service.create('Notes')
    writeFileSync(join(root, id, 'binary.bin'), Buffer.from([0, 1, 2]))

    await expect(service.readFile(id, 'binary.bin')).rejects.toThrow(/Binary files/)
    await expect(service.writeFile(id, 'large.txt', 'x'.repeat(1_000_001))).rejects.toThrow(/workspace limit/)
  })

  it('rejects unknown or malformed workspace ids', async () => {
    const { service } = createService()

    await expect(service.listFiles('../etc')).rejects.toThrow(/Invalid workspace id/)
    await expect(service.readFile('not-a-real-id', 'a.txt')).rejects.toThrow()
  })
})
