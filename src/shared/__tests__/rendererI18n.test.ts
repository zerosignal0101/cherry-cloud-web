import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Web-only i18n gate.
 *
 * The renderer is not part of the server vitest project, but translation keys are
 * still a shared contract: a missing key renders the raw dotted path in the UI.
 * This test scans static `t('…')` / `i18n.t('…')` calls in the browser sources and
 * verifies that the two catalogs the deployment actually ships (English fallback
 * and Simplified Chinese) contain every key, including i18next plural variants.
 */

const ROOT = process.cwd()
const SCAN_DIRS = [
  'src/renderer/pages',
  'src/renderer/components',
  'src/renderer/hooks',
  'src/renderer/services',
  'src/renderer/windows/main',
  'src/renderer/windows/login',
  'src/renderer/routes'
]
const PLURAL_SUFFIXES = ['_zero', '_one', '_two', '_few', '_many', '_other'] as const

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'locales') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (/\.(ts|tsx)$/.test(entry.name)) yield full
  }
}

function collectKeys(): Map<string, string> {
  const keys = new Map<string, string>()
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/\b(?:i18n\.)?t\(\s*'([a-zA-Z0-9_.-]+)'/g)) {
        const key = match[1]
        // A trailing dot is a dynamic prefix (`t('marketplace.type.' + type)`);
        // its concrete keys are checked when the literal is complete.
        if (key.endsWith('.')) continue
        if (!keys.has(key)) keys.set(key, relative(ROOT, file))
      }
    }
  }
  return keys
}

function hasKey(catalog: Record<string, string>, key: string): boolean {
  return key in catalog || PLURAL_SUFFIXES.some((suffix) => `${key}${suffix}` in catalog)
}

const keys = collectKeys()
const enUs = JSON.parse(readFileSync(join(ROOT, 'src/renderer/i18n/locales/en-us.json'), 'utf8')) as Record<
  string,
  string
>
const zhCn = JSON.parse(readFileSync(join(ROOT, 'src/renderer/i18n/locales/zh-cn.json'), 'utf8')) as Record<
  string,
  string
>

describe('renderer i18n catalogs', () => {
  it('are flat catalogs (keySeparator=false)', () => {
    for (const [locale, catalog] of [
      ['en-US', enUs],
      ['zh-CN', zhCn]
    ] as const) {
      for (const value of Object.values(catalog)) expect(typeof value, locale).toBe('string')
    }
  })

  it('cover every static translation key used by the browser sources', () => {
    const missingEn = [...keys].filter(([key]) => !hasKey(enUs, key)).map(([key, file]) => `${key} (${file})`)
    const missingZh = [...keys].filter(([key]) => !hasKey(zhCn, key)).map(([key, file]) => `${key} (${file})`)

    expect(missingEn, 'missing en-US keys').toEqual([])
    expect(missingZh, 'missing zh-CN keys').toEqual([])
  })
})
