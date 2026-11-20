import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { NotesStorage } from '../NotesStorage'

const roots: string[] = []

function storage(): NotesStorage {
  const root = mkdtempSync(join(tmpdir(), 'ccw-notes-'))
  roots.push(root)
  return new NotesStorage(root)
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('NotesStorage', () => {
  it('creates folders and notes inside the logical namespace', async () => {
    const notes = storage()
    await notes.mkdir('/notes/daily')
    await notes.write('/notes/daily/today.md', '# today')

    await expect(notes.read('/notes/daily/today.md')).resolves.toMatchObject({ content: '# today' })
    await expect(notes.list('/notes', true)).resolves.toEqual([
      expect.objectContaining({ path: '/notes/daily', kind: 'directory' }),
      expect.objectContaining({ path: '/notes/daily/today.md', name: 'today', kind: 'file' })
    ])
  })

  it('sanitizes names and reports collisions', async () => {
    const notes = storage()
    const first = await notes.checkName('/notes', 'a/b', true)
    expect(first).toEqual({ safeName: 'a_b', exists: false })
    await notes.write('/notes/a_b.md', '')
    await expect(notes.checkName('/notes', 'a/b', true)).resolves.toEqual({ safeName: 'a_b', exists: true })
    await expect(notes.checkName('/notes', 'a/b.md', true)).resolves.toEqual({ safeName: 'a_b', exists: true })
  })

  it('renames and moves entries without changing the logical root', async () => {
    const notes = storage()
    await notes.mkdir('/notes/inbox')
    await notes.write('/notes/inbox/old.md', 'body')

    await expect(notes.rename('/notes/inbox/old.md', 'new')).resolves.toEqual({
      path: '/notes/inbox/new.md',
      name: 'new'
    })
    await notes.mkdir('/notes/archive')
    await expect(notes.move('/notes/inbox/new.md', '/notes/archive/new.md')).resolves.toEqual({
      path: '/notes/archive/new.md'
    })
    await expect(notes.read('/notes/archive/new.md')).resolves.toMatchObject({ content: 'body' })
  })

  it('deletes recursively only when asked', async () => {
    const notes = storage()
    await notes.mkdir('/notes/folder')
    await notes.write('/notes/folder/note.md', 'x')
    await expect(notes.delete('/notes/folder', false)).rejects.toThrow()
    await notes.delete('/notes/folder', true)
    await expect(notes.list('/notes')).resolves.toEqual([])
  })

  it('rejects traversal, absolute escapes and symlinked components', async () => {
    const notes = storage()
    const outside = mkdtempSync(join(tmpdir(), 'ccw-notes-outside-'))
    roots.push(outside)
    writeFileSync(join(outside, 'secret.md'), 'secret')
    symlinkSync(outside, join(notes.physicalRoot, 'link'))

    await expect(notes.read('/notes/../secret.md')).rejects.toThrow()
    await expect(notes.write('/notes/..\\secret.md', 'x')).rejects.toThrow()
    await expect(notes.read('/notes/link/secret.md')).rejects.toThrow(/symbolic link/)
    await expect(notes.write('/etc/notes.md', 'x')).rejects.toThrow()
  })

  it('searches file names and contents server-side', async () => {
    const notes = storage()
    await notes.write('/notes/alpha.md', 'first beta line\nsecond line')
    await notes.write('/notes/beta.md', 'nothing here')

    const results = await notes.search({ keyword: 'beta' })
    expect(results.map((result) => result.path)).toEqual(expect.arrayContaining(['/notes/alpha.md', '/notes/beta.md']))
    const alpha = results.find((result) => result.path === '/notes/alpha.md')
    expect(alpha).toMatchObject({ matchType: 'content', name: 'alpha' })
    expect(alpha?.matches[0]).toMatchObject({ lineNumber: 1, lineContent: 'first beta line' })
    expect(alpha?.treePath).toBe('/alpha')
    expect(results.find((result) => result.path === '/notes/beta.md')).toMatchObject({
      matchType: 'filename',
      name: 'beta'
    })
  })
})
