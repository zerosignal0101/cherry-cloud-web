/**
 * DeepSeek's Responses API only runs the OpenAI-shaped `{"type":"web_search"}` tool on
 * `deepseek-v4-pro`; every other model silently ignores it (api-docs.deepseek.com/guides/responses_api).
 * Those models serve DeepSeek's own server tool instead — `deepseek_web_search` — which the V4.1
 * Flash line needs, otherwise the request carries no search capability at all and the model falls
 * back to fetching URLs by hand.
 *
 * `@ai-sdk/openai` drops tool ids outside its allowlist, so the swap has to happen on the
 * serialized body rather than through a provider-tool factory. `web_search` and
 * `deepseek_web_search` cannot be declared together (400), so this replaces, never appends.
 */

/** Models documented to run the plain Responses `web_search` tool. */
const NATIVE_WEB_SEARCH_MODEL = /^deepseek-v4-pro(?:[-.]|$)/

export function rewriteDeepSeekWebSearchBody(body: BodyInit | null | undefined): BodyInit | null | undefined {
  if (typeof body !== 'string') return body

  let json: Record<string, unknown>
  try {
    json = JSON.parse(body) as Record<string, unknown>
  } catch {
    return body
  }

  if (!Array.isArray(json.tools)) return body
  // deepseek-v4-pro runs the plain web_search tool; leave it untouched.
  if (typeof json.model === 'string' && NATIVE_WEB_SEARCH_MODEL.test(json.model)) return body

  const tools = json.tools as Array<{ type?: string }>
  if (!tools.some((tool) => tool?.type === 'web_search')) return body

  return JSON.stringify({
    ...json,
    tools: tools.map((tool) => (tool?.type === 'web_search' ? { type: 'deepseek_web_search' } : tool))
  })
}
