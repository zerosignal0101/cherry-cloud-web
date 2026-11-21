import { describe, expect, it } from 'vitest'

import { rewriteDeepSeekWebSearchBody } from '../deepseekWebSearch'

const json = (body: BodyInit | null | undefined) => JSON.parse(String(body))

describe('rewriteDeepSeekWebSearchBody', () => {
  it('swaps the OpenAI web_search tool for deepseek_web_search on the Flash line', () => {
    const body = rewriteDeepSeekWebSearchBody(
      JSON.stringify({
        model: 'deepseek-flash',
        tools: [{ type: 'web_search' }, { type: 'function', name: 'web_fetch' }]
      })
    )

    expect(json(body).tools).toEqual([{ type: 'deepseek_web_search' }, { type: 'function', name: 'web_fetch' }])
  })

  it('keeps the native web_search tool on deepseek-v4-pro, where the API runs it', () => {
    const body = JSON.stringify({ model: 'deepseek-v4-pro', tools: [{ type: 'web_search' }] })
    expect(rewriteDeepSeekWebSearchBody(body)).toBe(body)
  })

  it('leaves bodies without a server web tool untouched', () => {
    const body = JSON.stringify({ model: 'deepseek-flash', tools: [{ type: 'function', name: 'web_fetch' }] })
    expect(rewriteDeepSeekWebSearchBody(body)).toBe(body)
  })

  it('passes non-JSON bodies through unchanged', () => {
    const body = new FormData()
    expect(rewriteDeepSeekWebSearchBody(body)).toBe(body)
    expect(rewriteDeepSeekWebSearchBody('not json')).toBe('not json')
  })
})
