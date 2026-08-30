/**
 * Tests for the model listing route.
 *
 * The Ollama branch does more than list: the assistant is agentic (#459) and a
 * model without the "tools" capability silently degrades to a snapshot-only
 * answer, so the route probes /api/show for every model and reports the result
 * next to the list. A failed probe must never fail the listing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()

// Passes the body through unless a test swaps in a stored key for the mask.
const resolveMaskedAiSecretsMock = vi.fn<(b: Record<string, unknown>) => Promise<Record<string, unknown>>>()

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' },
}))

vi.mock('@/lib/ai/url-guard', () => ({
  validateAIUrl: async (url: string) => url,
}))

vi.mock('@/lib/ai/storedSecrets', () => ({
  resolveMaskedAiSecrets: resolveMaskedAiSecretsMock,
}))

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  resolveMaskedAiSecretsMock.mockReset().mockImplementation(async (b: Record<string, unknown>) => b)
  checkPermissionMock.mockReset().mockResolvedValue(null)
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

async function importHandler() {
  const mod = await import('./route')

  return mod.POST
}

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

const TAGS = { models: [{ name: 'llama3.1:8b' }, { name: 'ministral:14b' }] }

/**
 * Route the fetch mock by URL: /api/tags lists the models, /api/show answers
 * per model from `show` (a Response, or a thrown error when the value is an
 * Error instance).
 */
function routeOllama(show: Record<string, Response | Error>) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/api/tags')) return jsonOk(TAGS)

    if (url.endsWith('/api/show')) {
      const { model } = JSON.parse(init?.body as string)
      const answer = show[model]

      if (answer instanceof Error) throw answer

      return answer ?? new Response('not found', { status: 404 })
    }

    throw new Error(`unexpected fetch ${url}`)
  })
}

describe('POST /api/v1/ai/models', () => {
  it('honours an RBAC denial from checkPermission', async () => {
    const denied = new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })

    checkPermissionMock.mockResolvedValueOnce(denied as any)

    const handler = await importHandler()
    const res = await callRoute(handler, { body: { provider: 'ollama', ollamaUrl: 'http://localhost:11434' } })

    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  describe('ollama provider', () => {
    it('lists the models and reports tool calling per model from /api/show', async () => {
      routeOllama({
        'llama3.1:8b': jsonOk({ capabilities: ['completion', 'tools'] }),
        'ministral:14b': jsonOk({ capabilities: ['completion', 'vision'] }),
      })

      const handler = await importHandler()
      const res = await callRoute(handler, { body: { provider: 'ollama', ollamaUrl: 'http://localhost:11434' } })

      expect(res.status).toBe(200)

      const json = await readJson<any>(res)

      expect(json.models).toEqual(['llama3.1:8b', 'ministral:14b'])
      expect(json.toolCalling).toEqual({ 'llama3.1:8b': true, 'ministral:14b': false })

      const showCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/show'))

      expect(showCalls).toHaveLength(2)
      expect(showCalls.map(([, init]) => JSON.parse(init.body as string))).toEqual([
        { model: 'llama3.1:8b' },
        { model: 'ministral:14b' },
      ])
    })

    it('reports null for a model whose probe fails and still lists every model', async () => {
      routeOllama({
        'llama3.1:8b': jsonOk({ capabilities: ['completion', 'tools'] }),
        'ministral:14b': new TypeError('fetch failed'),
      })

      const handler = await importHandler()
      const res = await callRoute(handler, { body: { provider: 'ollama', ollamaUrl: 'http://localhost:11434' } })

      expect(res.status).toBe(200)

      const json = await readJson<any>(res)

      expect(json.models).toEqual(['llama3.1:8b', 'ministral:14b'])
      expect(json.toolCalling).toEqual({ 'llama3.1:8b': true, 'ministral:14b': null })
    })

    it('reports null when /api/show answers without a capability list (older Ollama)', async () => {
      routeOllama({
        'llama3.1:8b': jsonOk({ modelfile: 'FROM llama3' }),
        'ministral:14b': new Response('boom', { status: 500 }),
      })

      const handler = await importHandler()
      const res = await callRoute(handler, { body: { provider: 'ollama', ollamaUrl: 'http://localhost:11434' } })

      const json = await readJson<any>(res)

      expect(json.toolCalling).toEqual({ 'llama3.1:8b': null, 'ministral:14b': null })
    })

    it('fails the listing when /api/tags itself is unreachable', async () => {
      fetchMock.mockResolvedValue(new Response('down', { status: 502 }))

      const handler = await importHandler()
      const res = await callRoute(handler, { body: { provider: 'ollama', ollamaUrl: 'http://localhost:11434' } })

      expect(res.status).toBe(500)
      expect(await readJson<any>(res)).toMatchObject({ models: [], error: 'Ollama error: 502' })
    })
  })

  describe('other providers', () => {
    it('lists OpenAI models without a toolCalling field and filters non-chat models', async () => {
      fetchMock.mockResolvedValue(
        jsonOk({ data: [{ id: 'gpt-4.1-nano' }, { id: 'text-embedding-3-small' }, { id: 'whisper-1' }] })
      )

      const handler = await importHandler()
      const res = await callRoute(handler, { body: { provider: 'openai', openaiKey: 'sk-test' } })

      expect(res.status).toBe(200)

      const json = await readJson<any>(res)

      expect(json).toEqual({ models: ['gpt-4.1-nano'] })
      expect(json).not.toHaveProperty('toolCalling')
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls[0][0]).toBe('https://api.openai.com/v1/models')
    })

    it('lists Anthropic models without a toolCalling field', async () => {
      fetchMock.mockResolvedValue(jsonOk({ data: [{ id: 'claude-sonnet-4-5' }, { id: 'claude-opus-4-7' }] }))

      const handler = await importHandler()
      const res = await callRoute(handler, { body: { provider: 'anthropic', anthropicKey: 'sk-ant-test' } })

      expect(res.status).toBe(200)
      expect(await readJson<any>(res)).toEqual({ models: ['claude-opus-4-7', 'claude-sonnet-4-5'] })
    })

    it('returns 500 for an unknown provider', async () => {
      const handler = await importHandler()
      const res = await callRoute(handler, { body: { provider: 'bedrock' } })

      expect(res.status).toBe(500)
      expect((await readJson<any>(res)).error).toMatch(/Unknown provider: bedrock/)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('openai base URL', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue(jsonOk({
        data: [{ id: 'gpt-4o' }, { id: 'text-embedding-3-small' }, { id: 'gpt-4.1-mini' }, { id: 'whisper-1' }],
      }))
    })

    it('strips trailing slashes from a custom base URL and filters non-chat models', async () => {
      const POST = await importHandler()
      const res = await callRoute(POST, { body: { provider: 'openai', openaiKey: 'sk-test', openaiBaseUrl: 'https://llm.example.com/v1///' } })

      expect(res.status).toBe(200)
      expect(await readJson<any>(res)).toEqual({ models: ['gpt-4.1-mini', 'gpt-4o'] })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]

      expect(url).toBe('https://llm.example.com/v1/models')
      expect(init.headers).toEqual({ Authorization: 'Bearer sk-test' })
    })

    it('strips a single trailing slash', async () => {
      const POST = await importHandler()

      await callRoute(POST, { body: { provider: 'openai', openaiKey: 'k', openaiBaseUrl: 'http://10.0.0.5:8000/v1/' } })
      expect(fetchMock.mock.calls[0][0]).toBe('http://10.0.0.5:8000/v1/models')
    })

    it('uses the default OpenAI base when none is given', async () => {
      const POST = await importHandler()

      await callRoute(POST, { body: { provider: 'openai', openaiKey: 'k' } })
      expect(fetchMock.mock.calls[0][0]).toBe('https://api.openai.com/v1/models')
    })
  })
})

describe('POST /api/v1/ai/models (stored key)', () => {
  it('queries the provider with the stored key when the form sends the mask back', async () => {
    fetchMock.mockResolvedValue(jsonOk({ data: [{ id: 'gpt-4o' }] }))
    resolveMaskedAiSecretsMock.mockImplementationOnce(async (b: Record<string, unknown>) => ({ ...b, openaiKey: 'sk-stored' }))

    const POST = await importHandler()
    const res = await callRoute(POST, { body: { provider: 'openai', openaiKey: '••••••••' } })

    expect(res.status).toBe(200)
    expect(resolveMaskedAiSecretsMock).toHaveBeenCalledWith({ provider: 'openai', openaiKey: '••••••••' })
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer sk-stored' })
  })
})
