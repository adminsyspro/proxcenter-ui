import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
// Passes the body through unless a test swaps in a stored key for the mask.
const resolveMaskedAiSecretsMock = vi.fn(async (b: Record<string, unknown>) => b)

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' },
}))
vi.mock('@/lib/ai/storedSecrets', () => ({ resolveMaskedAiSecrets: resolveMaskedAiSecretsMock }))

// The route derives the probe language from the NEXT_LOCALE cookie that
// middleware sets. `cookieLocale` lets each test pretend to be a different
// UI language; `undefined` simulates a request without the cookie.
let cookieLocale: string | undefined
let acceptLanguage: string | undefined

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'NEXT_LOCALE' && cookieLocale !== undefined ? { value: cookieLocale } : undefined,
  }),
  headers: async () => ({
    get: (name: string) =>
      name.toLowerCase() === 'accept-language' && acceptLanguage !== undefined ? acceptLanguage : null,
  }),
}))

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  resolveMaskedAiSecretsMock.mockClear()
  cookieLocale = 'en'
  acceptLanguage = undefined
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

/**
 * Probe calls only: the Ollama branch also POSTs /api/show for the capability
 * check (#459), which carries no prompt and must not shift the indexes below.
 */
function probeCalls() {
  return fetchMock.mock.calls.filter(([url]) => !String(url).endsWith('/api/show'))
}

/** Prompt text actually sent upstream, whatever the provider's body shape. */
function sentPrompt(callIndex = 0): string {
  const body = JSON.parse(probeCalls()[callIndex][1].body as string)

  return body.prompt ?? body.messages[0].content
}

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

describe('POST /api/v1/ai/test', () => {
  it('honours an RBAC denial from checkPermission', async () => {
    const denied = new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })

    checkPermissionMock.mockResolvedValueOnce(denied as any)

    const handler = await importHandler()
    const res = await callRoute(handler, { body: { provider: 'ollama', ollamaUrl: 'http://localhost:11434' } })

    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  describe('ollama provider', () => {
    it('forwards the prompt to /api/generate and returns the model reply', async () => {
      fetchMock.mockResolvedValueOnce(jsonOk({ response: 'Oui, je suis fonctionnel.' }))

      const handler = await importHandler()

      const res = await callRoute(handler, {
        body: { provider: 'ollama', ollamaUrl: 'http://localhost:11434', ollamaModel: 'mistral:7b' },
      })

      expect(res.status).toBe(200)
      const json = await readJson<any>(res)

      expect(json).toMatchObject({
        success: true,
        provider: 'ollama',
        model: 'mistral:7b',
        response: 'Oui, je suis fonctionnel.',
      })

      const [calledUrl, init] = fetchMock.mock.calls[0]

      expect(calledUrl).toBe('http://localhost:11434/api/generate')
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body as string)).toMatchObject({
        model: 'mistral:7b',
        stream: false,
      })
    })

    // Regression: a CodeQL SSRF fix dropped the trailing-slash trim, which
    // turned the default `http://localhost:11434` into `http://localhost:11434/`
    // and the forged URL into `http://localhost:11434//api/generate`. Ollama
    // 301s the double slash, fetch follows as GET, Ollama replies 405.
    it('never produces a double slash even when the base URL has trailing slashes', async () => {
      fetchMock.mockResolvedValueOnce(jsonOk({ response: 'ok' }))

      const handler = await importHandler()

      await callRoute(handler, {
        body: { provider: 'ollama', ollamaUrl: 'http://localhost:11434///', ollamaModel: 'mistral:7b' },
      })

      const [calledUrl] = fetchMock.mock.calls[0]

      expect(calledUrl).toBe('http://localhost:11434/api/generate')
      expect(calledUrl).not.toMatch(/\/\/api\//)
    })

    it('rejects a non-http(s) Ollama URL with a 500 and a descriptive error', async () => {
      const handler = await importHandler()

      const res = await callRoute(handler, {
        body: { provider: 'ollama', ollamaUrl: 'file:///etc/passwd', ollamaModel: 'mistral:7b' },
      })

      expect(res.status).toBe(500)
      expect((await readJson<any>(res)).error).toMatch(/Only http and https/i)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    // #459: the assistant is agentic. A model without the "tools" capability
    // still answers the probe, so "Connected" alone would hide the reason the
    // assistant only sees the live snapshot.
    describe('tool calling capability', () => {
      /** /api/generate answers, then /api/show answers with `show` (or throws when it is an Error). */
      function routeOllama(show: Response | Error) {
        fetchMock.mockImplementation(async (url: string) => {
          if (url.endsWith('/api/generate')) return jsonOk({ response: 'ok' })
          if (url.endsWith('/api/show')) {
            if (show instanceof Error) throw show

            return show
          }

          throw new Error(`unexpected fetch ${url}`)
        })
      }

      const body = { provider: 'ollama', ollamaUrl: 'http://localhost:11434', ollamaModel: 'ministral:14b' }

      it('reports toolCalling: false when /api/show lists capabilities without "tools"', async () => {
        routeOllama(jsonOk({ capabilities: ['completion', 'vision'] }))

        const handler = await importHandler()
        const res = await callRoute(handler, { body })

        expect(res.status).toBe(200)
        expect(await readJson<any>(res)).toMatchObject({ success: true, response: 'ok', toolCalling: false })

        const [showUrl, showInit] = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/show'))!

        expect(showUrl).toBe('http://localhost:11434/api/show')
        expect(JSON.parse(showInit.body as string)).toEqual({ model: 'ministral:14b' })
      })

      it('reports toolCalling: true when the model lists the "tools" capability', async () => {
        routeOllama(jsonOk({ capabilities: ['completion', 'tools', 'thinking'] }))

        const handler = await importHandler()
        const res = await callRoute(handler, { body })

        expect(await readJson<any>(res)).toMatchObject({ success: true, toolCalling: true })
      })

      it('reports toolCalling: null and still succeeds when /api/show fails', async () => {
        routeOllama(new TypeError('fetch failed'))

        const handler = await importHandler()
        const res = await callRoute(handler, { body })

        expect(res.status).toBe(200)
        expect(await readJson<any>(res)).toMatchObject({ success: true, response: 'ok', toolCalling: null })
      })

      it('reports toolCalling: null when the server has no capability list (older Ollama)', async () => {
        routeOllama(jsonOk({ modelfile: 'FROM llama3' }))

        const handler = await importHandler()
        const res = await callRoute(handler, { body })

        expect(await readJson<any>(res)).toMatchObject({ success: true, toolCalling: null })
      })
    })

    it('propagates upstream Ollama errors as a 500 with the response body', async () => {
      fetchMock.mockResolvedValueOnce(new Response('model not found', { status: 404 }))

      const handler = await importHandler()

      const res = await callRoute(handler, {
        body: { provider: 'ollama', ollamaUrl: 'http://localhost:11434', ollamaModel: 'nope:1b' },
      })

      expect(res.status).toBe(500)
      expect((await readJson<any>(res)).error).toMatch(/Ollama error: model not found/)
    })
  })

  describe('openai provider', () => {
    it('calls /chat/completions on the default base URL with a Bearer token', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonOk({ choices: [{ message: { content: 'Yes, I am functional.' } }] }),
      )

      const handler = await importHandler()

      const res = await callRoute(handler, {
        body: { provider: 'openai', openaiKey: 'sk-test', openaiModel: 'gpt-4.1-nano' },
      })

      expect(res.status).toBe(200)
      expect(await readJson<any>(res)).toMatchObject({
        success: true,
        provider: 'openai',
        response: 'Yes, I am functional.',
      })

      const [calledUrl, init] = fetchMock.mock.calls[0]

      expect(calledUrl).toBe('https://api.openai.com/v1/chat/completions')
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
    })

    it('honours a custom openaiBaseUrl', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonOk({ choices: [{ message: { content: 'hi' } }] }),
      )

      const handler = await importHandler()

      await callRoute(handler, {
        body: {
          provider: 'openai',
          openaiKey: 'sk-test',
          openaiModel: 'gpt-4.1-nano',
          openaiBaseUrl: 'https://openai.proxy.lan/v1/',
        },
      })

      expect(fetchMock.mock.calls[0][0]).toBe('https://openai.proxy.lan/v1/chat/completions')
    })

    it('surfaces a structured OpenAI error message when the upstream call fails', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      )

      const handler = await importHandler()

      const res = await callRoute(handler, {
        body: { provider: 'openai', openaiKey: 'bad', openaiModel: 'gpt-4.1-nano' },
      })

      expect(res.status).toBe(500)
      expect((await readJson<any>(res)).error).toBe('Invalid API key')
    })
  })

  describe('anthropic provider', () => {
    it('calls /v1/messages with the x-api-key header', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonOk({ content: [{ text: 'Yes, I am functional.' }] }),
      )

      const handler = await importHandler()

      const res = await callRoute(handler, {
        body: { provider: 'anthropic', anthropicKey: 'sk-ant-test', anthropicModel: 'claude-opus-4-7' },
      })

      expect(res.status).toBe(200)
      expect(await readJson<any>(res)).toMatchObject({
        success: true,
        provider: 'anthropic',
        response: 'Yes, I am functional.',
      })

      const [calledUrl, init] = fetchMock.mock.calls[0]
      const headers = init.headers as Record<string, string>

      expect(calledUrl).toBe('https://api.anthropic.com/v1/messages')
      expect(headers['x-api-key']).toBe('sk-ant-test')
      expect(headers['anthropic-version']).toBe('2023-06-01')
    })
  })

  it('returns 500 for an unknown provider', async () => {
    const handler = await importHandler()

    const res = await callRoute(handler, { body: { provider: 'bedrock' } })

    expect(res.status).toBe(500)
    expect((await readJson<any>(res)).error).toMatch(/Unknown provider: bedrock/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // #686: the probe was hardcoded in French for Ollama and Anthropic and in
  // English for OpenAI, so an Italian customer on the English UI got a French
  // "Connection OK!" reply. One English probe for every provider, plus an
  // explicit instruction to answer in the UI language.
  describe('probe prompt language (#686)', () => {
    const providers: Array<[string, Record<string, unknown>, unknown]> = [
      ['ollama', { provider: 'ollama', ollamaUrl: 'http://localhost:11434', ollamaModel: 'mistral:7b' }, { response: 'ok' }],
      ['openai', { provider: 'openai', openaiKey: 'sk-test', openaiModel: 'gpt-4.1-nano' }, { choices: [{ message: { content: 'ok' } }] }],
      ['anthropic', { provider: 'anthropic', anthropicKey: 'sk-ant-test', anthropicModel: 'claude-opus-4-7' }, { content: [{ text: 'ok' }] }],
    ]

    it.each(providers)('sends the same English probe for %s, never the old French one', async (_name, body, upstream) => {
      fetchMock.mockResolvedValueOnce(jsonOk(upstream))

      const handler = await importHandler()

      await callRoute(handler, { body: body as any })

      const prompt = sentPrompt()

      expect(prompt).toContain('Reply in one sentence: are you functional?')
      expect(prompt).not.toMatch(/Réponds|fonctionnel/)
      expect(prompt).toContain('written in English')
    })

    it.each([
      ['de', 'German'],
      ['es', 'Spanish'],
      ['zh-CN', 'Simplified Chinese'],
      ['ko', 'Korean'],
      ['fr', 'French'],
    ])('asks for the answer in the NEXT_LOCALE language (%s)', async (locale, language) => {
      cookieLocale = locale
      fetchMock.mockResolvedValueOnce(jsonOk({ response: 'ok' }))

      const handler = await importHandler()

      await callRoute(handler, {
        body: { provider: 'ollama', ollamaUrl: 'http://localhost:11434', ollamaModel: 'mistral:7b' },
      })

      expect(sentPrompt()).toContain(`written in ${language}`)
    })

    it('falls back to English when the cookie is absent or unsupported', async () => {
      for (const value of [undefined, 'it']) {
        cookieLocale = value
        fetchMock.mockResolvedValueOnce(jsonOk({ response: 'ok' }))

        const handler = await importHandler()

        await callRoute(handler, {
          body: { provider: 'ollama', ollamaUrl: 'http://localhost:11434', ollamaModel: 'mistral:7b' },
        })

        expect(sentPrompt(probeCalls().length - 1)).toContain('written in English')
      }
    })
  })
})

describe('POST /api/v1/ai/test (stored key)', () => {
  it('probes the provider with the stored key when the form sends the mask back', async () => {
    resolveMaskedAiSecretsMock.mockImplementationOnce(async (b: Record<string, unknown>) => ({ ...b, anthropicKey: 'sk-ant-stored' }))
    fetchMock.mockResolvedValueOnce(jsonOk({ content: [{ text: 'ok' }] }))

    const handler = await importHandler()
    const res = await callRoute(handler, {
      body: { provider: 'anthropic', anthropicKey: '••••••••', anthropicModel: 'claude-opus-4-7' },
    })

    expect(res.status).toBe(200)
    expect(fetchMock.mock.calls[0][1].headers['x-api-key']).toBe('sk-ant-stored')
  })
})
