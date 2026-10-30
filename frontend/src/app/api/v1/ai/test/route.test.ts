import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
// Passes the body through unless a test swaps in a stored key for the mask.
const resolveMaskedAiSecretsMock = vi.fn(async (b: Record<string, unknown>) => b)

const licence = vi.hoisted(() => ({ ai: true }))

// The assistant is Enterprise (`ai_insights`): the route refuses it otherwise.
vi.mock('@/lib/auth/requireEnterprise', () => ({
  requireFeature: async () => (licence.ai ? null : new Response(JSON.stringify({ error: 'Feature not licensed' }), { status: 403 })),
}))

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

/** Probe calls only: the Ollama side requests below have their own mocks. */
type FetchMock = ReturnType<typeof vi.fn<(...args: any[]) => any>>

let fetchMock: FetchMock
/** Ollama /api/show (capabilities, #459). Unknown by default, as an old server answers. */
let showMock: FetchMock
/** Ollama /api/ps (where the probed model was loaded, #459). Empty by default. */
let psMock: FetchMock

beforeEach(() => {
  licence.ai = true
  checkPermissionMock.mockReset().mockResolvedValue(null)
  resolveMaskedAiSecretsMock.mockClear()
  cookieLocale = 'en'
  acceptLanguage = undefined
  fetchMock = vi.fn<(...args: any[]) => any>()
  showMock = vi.fn<(...args: any[]) => any>(async () => new Response('', { status: 404 }))
  psMock = vi.fn<(...args: any[]) => any>(async () => jsonOk({ models: [] }))
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/api/show')) return showMock(url, init)
    if (String(url).endsWith('/api/ps')) return psMock(url, init)

    return fetchMock(url, init)
  })
})

function probeCalls() {
  return fetchMock.mock.calls
}

/** What Ollama's /api/chat answers to the probe, with the timings the preflight reads. */
function ollamaReply(content: string, timing: { eval_count?: number; eval_duration?: number } = {}) {
  return jsonOk({ message: { role: 'assistant', content }, done: true, ...timing })
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

  it('refuses without the Enterprise licence, before any upstream call', async () => {
    licence.ai = false

    const handler = await importHandler()
    const res = await callRoute(handler, { body: { provider: 'ollama', ollamaUrl: 'http://localhost:11434' } })

    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  describe('ollama provider', () => {
    it('probes /api/chat with the chat options and returns the model reply', async () => {
      fetchMock.mockResolvedValueOnce(ollamaReply('Oui, je suis fonctionnel.'))

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

      expect(calledUrl).toBe('http://localhost:11434/api/chat')
      expect(init.method).toBe('POST')

      const sent = JSON.parse(init.body as string)

      // Same context as the chat routes, so the probe loads the footprint the
      // assistant will run with and the first question starts warm.
      expect(sent).toMatchObject({
        model: 'mistral:7b',
        stream: false,
        options: { num_ctx: 16384, num_predict: 150 },
      })
      expect(sent).not.toHaveProperty('think')
    })

    // Regression: a CodeQL SSRF fix dropped the trailing-slash trim, which
    // turned the default `http://localhost:11434` into `http://localhost:11434/`
    // and the forged URL into `http://localhost:11434//api/generate`. Ollama
    // 301s the double slash, fetch follows as GET, Ollama replies 405.
    it('never produces a double slash even when the base URL has trailing slashes', async () => {
      fetchMock.mockResolvedValueOnce(ollamaReply('ok'))

      const handler = await importHandler()

      await callRoute(handler, {
        body: { provider: 'ollama', ollamaUrl: 'http://localhost:11434///', ollamaModel: 'mistral:7b' },
      })

      const [calledUrl] = fetchMock.mock.calls[0]

      expect(calledUrl).toBe('http://localhost:11434/api/chat')
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
      /** The probe answers "ok", /api/show answers with `show` (or throws when it is an Error). */
      function routeOllama(show: Response | Error) {
        fetchMock.mockResolvedValue(ollamaReply('ok'))
        showMock.mockImplementation(async () => {
          if (show instanceof Error) throw show

          return show
        })
      }

      const body = { provider: 'ollama', ollamaUrl: 'http://localhost:11434', ollamaModel: 'ministral:14b' }

      it('reports toolCalling: false when /api/show lists capabilities without "tools"', async () => {
        routeOllama(jsonOk({ capabilities: ['completion', 'vision'] }))

        const handler = await importHandler()
        const res = await callRoute(handler, { body })

        expect(res.status).toBe(200)
        expect(await readJson<any>(res)).toMatchObject({ success: true, response: 'ok', toolCalling: false })

        const [showUrl, showInit] = showMock.mock.calls[0]

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

    // #459: "Test connection" doubles as a preflight of the Ollama server.
    describe('preflight', () => {
      const body = { provider: 'ollama', ollamaUrl: 'http://localhost:11434', ollamaModel: 'qwen3.5:9b' }

      it('turns thinking off for a thinking model, so one sentence is not spent reasoning', async () => {
        showMock.mockResolvedValue(jsonOk({ capabilities: ['completion', 'tools', 'thinking'] }))
        fetchMock.mockResolvedValueOnce(ollamaReply('ok'))

        const handler = await importHandler()

        await callRoute(handler, { body })

        expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toMatchObject({ think: false })
      })

      it('reports a qualified model loaded whole on the GPU, with its speed, as clean', async () => {
        fetchMock.mockResolvedValueOnce(ollamaReply('ok', { eval_count: 60, eval_duration: 2e9 }))
        psMock.mockResolvedValue(jsonOk({ models: [{ name: 'qwen3.5:9b', model: 'qwen3.5:9b', size: 6.15e9, size_vram: 6.15e9 }] }))

        const handler = await importHandler()
        const res = await callRoute(handler, { body })

        expect(res.status).toBe(200)
        expect((await readJson<any>(res)).preflight).toEqual({
          model: 'qwen3.5:9b',
          qualified: true,
          gpuShare: 1,
          tokensPerSecond: 30,
          issues: [],
          fits: ['qwen3.5:9b'],
        })
      })

      it('flags a model spilling to the CPU and names the qualified ones that fit', async () => {
        fetchMock.mockResolvedValueOnce(ollamaReply('ok', { eval_count: 20, eval_duration: 5e9 }))
        psMock.mockResolvedValue(jsonOk({ models: [{ name: 'gemma4:31b', model: 'gemma4:31b', size: 20e9, size_vram: 8e9 }] }))

        const handler = await importHandler()
        const res = await callRoute(handler, { body: { ...body, ollamaModel: 'gemma4:31b' } })

        expect((await readJson<any>(res)).preflight).toMatchObject({
          qualified: false,
          gpuShare: 0.4,
          issues: ['not-qualified', 'cpu-offload', 'slow'],
          fits: ['qwen3.5:9b'],
        })
      })

      it('says so instead of a 500 when the model does not answer in time', async () => {
        // Only the timeout clock is faked: the route still awaits real I/O
        // (URL guard, request body) before it arms the probe's timer.
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

        try {
          fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
          }))

          const handler = await importHandler()
          const pending = callRoute(handler, { body })

          while (fetchMock.mock.calls.length === 0) await new Promise(resolve => setImmediate(resolve))

          await vi.advanceTimersByTimeAsync(45_000)

          const res = await pending

          expect(res.status).toBe(504)
          expect(await readJson<any>(res)).toMatchObject({ code: 'probe-timeout' })
        } finally {
          vi.useRealTimers()
        }
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
      ['ollama', { provider: 'ollama', ollamaUrl: 'http://localhost:11434', ollamaModel: 'mistral:7b' }, { message: { content: 'ok' } }],
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
      fetchMock.mockResolvedValueOnce(ollamaReply('ok'))

      const handler = await importHandler()

      await callRoute(handler, {
        body: { provider: 'ollama', ollamaUrl: 'http://localhost:11434', ollamaModel: 'mistral:7b' },
      })

      expect(sentPrompt()).toContain(`written in ${language}`)
    })

    it('falls back to English when the cookie is absent or unsupported', async () => {
      for (const value of [undefined, 'it']) {
        cookieLocale = value
        fetchMock.mockResolvedValueOnce(ollamaReply('ok'))

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
