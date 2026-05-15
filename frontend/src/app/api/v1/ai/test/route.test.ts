import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' },
}))

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
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
    expect((await readJson<any>(res)).error).toMatch(/Provider inconnu: bedrock/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
