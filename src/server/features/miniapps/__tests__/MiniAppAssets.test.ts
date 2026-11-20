import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { MiniAppAssets } from '../MiniAppAssets'

const roots: string[] = []

function assets(): MiniAppAssets {
  const root = mkdtempSync(path.join(tmpdir(), 'ccw-miniapp-assets-'))
  roots.push(root)
  return new MiniAppAssets(root)
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('MiniAppAssets', () => {
  it('mints a stable token per app and rejects another app or a tampered value', () => {
    const signer = assets()
    const token = signer.tokenFor('com.example.app')
    expect(token).toBe(signer.tokenFor('com.example.app'))
    expect(signer.verify('com.example.app', token)).toBe(true)
    expect(signer.verify('com.example.other', token)).toBe(false)
    expect(signer.verify('com.example.app', `${token.slice(0, -1)}A`)).toBe(false)
  })

  it('keeps the key on disk so restored tabs resolve after a restart', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'ccw-miniapp-assets-'))
    roots.push(root)
    const first = new MiniAppAssets(root).tokenFor('com.example.app')
    const second = new MiniAppAssets(root).tokenFor('com.example.app')
    expect(second).toBe(first)
    expect(readFileSync(path.join(root, 'miniapps', 'assets.key'), 'utf8').trim()).not.toBe('')
  })

  it('rewrites the desktop scheme into a signed, encoded asset path', () => {
    const signer = assets()
    const token = signer.tokenFor('com.example.app')
    expect(signer.rewriteValue('cherry-miniapp://com.example.app/dist/index.html')).toBe(
      `/api/miniapps/com.example.app/assets/${token}/dist/index.html`
    )
    expect(signer.rewriteValue('cherry-miniapp://com.example.app/a b/index.html')).toBe(
      `/api/miniapps/com.example.app/assets/${token}/a%20b/index.html`
    )
    expect(signer.rewriteValue('https://example.com/')).toBe('https://example.com/')
  })

  it('walks arrays and DTO objects without touching binary values', () => {
    const signer = assets()
    const bytes = new Uint8Array([1, 2, 3])
    expect(
      signer.rewriteValue({
        apps: [{ url: 'cherry-miniapp://com.example.app/index.html' }],
        bytes
      })
    ).toEqual({
      apps: [{ url: signer.assetUrl('com.example.app', 'index.html') }],
      bytes
    })
  })
})
