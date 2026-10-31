import { beforeEach, describe, it, expect, vi } from 'vitest'

import { clearOllamaThinkingCache, fetchOllamaCapabilities, ollamaCanThink, OllamaProbeTimeoutError, ollamaThread, probeOllamaModel } from './ollama'

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('fetchOllamaCapabilities', () => {
  it('reports tool calling when /api/show lists the "tools" capability', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk({ capabilities: ['completion', 'tools', 'thinking'] }))

    const result = await fetchOllamaCapabilities('http://localhost:11434', 'llama3.1:8b', fetchMock as any)

    expect(result).toEqual({ capabilities: ['completion', 'tools', 'thinking'], toolCalling: true })
  })

  it('reports false when the capability list is present but lacks "tools"', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk({ capabilities: ['completion', 'vision'] }))

    const result = await fetchOllamaCapabilities('http://localhost:11434', 'ministral:14b', fetchMock as any)

    expect(result).toEqual({ capabilities: ['completion', 'vision'], toolCalling: false })
  })

  // Ollama before 0.6 has no `capabilities` field at all: unknown, not false,
  // otherwise every model on an older server would be flagged.
  it('reports null when the server does not return a capability list', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk({ modelfile: 'FROM llama3', details: {} }))

    const result = await fetchOllamaCapabilities('http://localhost:11434', 'llama3', fetchMock as any)

    expect(result).toEqual({ capabilities: null, toolCalling: null })
  })

  it('reports null on an HTTP error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }))

    const result = await fetchOllamaCapabilities('http://localhost:11434', 'llama3.1:8b', fetchMock as any)

    expect(result).toEqual({ capabilities: null, toolCalling: null })
  })

  it('reports null when fetch rejects', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'))

    const result = await fetchOllamaCapabilities('http://localhost:11434', 'llama3.1:8b', fetchMock as any)

    expect(result).toEqual({ capabilities: null, toolCalling: null })
  })

  it('POSTs { model } to <base>/api/show and trims a trailing slash', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk({ capabilities: ['completion', 'tools'] }))

    await fetchOllamaCapabilities('http://localhost:11434/', 'llama3.1:8b', fetchMock as any)

    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0]

    expect(url).toBe('http://localhost:11434/api/show')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ model: 'llama3.1:8b' })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('ollamaThread', () => {
  it('sends the prompt as a system message and the conversation untouched', () => {
    const thread = ollamaThread('PROMPT', [
      { role: 'user', content: 'Are there any improvements to Ceph?' },
      { role: 'assistant', content: 'Remove the noout flag.' },
      { role: 'user', content: 'Can you do that?' },
    ], 'Answer in English.')

    // The follow-up sits right after the answer it refers to (#459), and the
    // language instruction closes the system message (#686).
    expect(thread).toEqual([
      { role: 'system', content: 'PROMPT\n\nAnswer in English.' },
      { role: 'user', content: 'Are there any improvements to Ceph?' },
      { role: 'assistant', content: 'Remove the noout flag.' },
      { role: 'user', content: 'Can you do that?' },
    ])
  })

  it('sends the prompt alone for an empty conversation', () => {
    expect(ollamaThread('PROMPT', [], 'x')).toEqual([{ role: 'system', content: 'PROMPT\n\nx' }])
  })
})

describe('probeOllamaModel', () => {
  /** /api/chat answers `chat`, /api/ps answers `ps` (or fails when it is an Error). */
  function routeFetch(chat: Response, ps: Response | Error) {
    return vi.fn(async (url: string) => {
      if (url.endsWith('/api/chat')) return chat
      if (url.endsWith('/api/ps')) {
        if (ps instanceof Error) throw ps

        return ps
      }

      throw new Error(`unexpected fetch ${url}`)
    })
  }

  const reply = () => jsonOk({ message: { content: 'Yes, I am functional.' }, eval_count: 90, eval_duration: 3e9 })

  it('loads the model with the chat options and measures speed and GPU share', async () => {
    const fetchMock = routeFetch(reply(), jsonOk({
      models: [
        { name: 'llama3.1:8b', model: 'llama3.1:8b', size: 7e9, size_vram: 7e9 },
        { name: 'qwen3.5:9b', model: 'qwen3.5:9b', size: 6.15e9, size_vram: 5e9 },
      ],
    }))

    const result = await probeOllamaModel('http://localhost:11434/', 'qwen3.5:9b', 'Are you functional?', {
      thinking: false,
      fetchImpl: fetchMock as any,
    })

    expect(result).toEqual({
      response: 'Yes, I am functional.',
      measure: { model: 'qwen3.5:9b', sizeBytes: 6.15e9, sizeVramBytes: 5e9, tokensPerSecond: 30 },
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(init.body as string)

    expect(url).toBe('http://localhost:11434/api/chat')
    expect(body).toMatchObject({
      model: 'qwen3.5:9b',
      stream: false,
      messages: [{ role: 'user', content: 'Are you functional?' }],
      options: { num_ctx: 16384, num_predict: 150 },
    })
    expect(body).not.toHaveProperty('think')
  })

  it('turns thinking off for a thinking model', async () => {
    const fetchMock = routeFetch(reply(), jsonOk({ models: [] }))

    await probeOllamaModel('http://localhost:11434', 'qwen3.5:9b', 'x', { thinking: true, fetchImpl: fetchMock as any })

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]

    expect(JSON.parse(init.body as string).think).toBe(false)
  })

  it('reports unknown measures when /api/ps fails or no longer lists the model', async () => {
    for (const ps of [new TypeError('fetch failed'), jsonOk({ models: [] }), new Response('', { status: 500 })]) {
      const result = await probeOllamaModel('http://localhost:11434', 'qwen3.5:9b', 'x', {
        thinking: false,
        fetchImpl: routeFetch(jsonOk({ message: { content: 'ok' } }), ps) as any,
      })

      expect(result.measure).toEqual({ model: 'qwen3.5:9b', sizeBytes: null, sizeVramBytes: null, tokensPerSecond: null })
    }
  })

  it('throws the upstream body on an Ollama error', async () => {
    const fetchMock = routeFetch(new Response('model "nope" not found', { status: 404 }), jsonOk({ models: [] }))

    await expect(probeOllamaModel('http://localhost:11434', 'nope', 'x', { thinking: false, fetchImpl: fetchMock as any }))
      .rejects.toThrow('Ollama error: model "nope" not found')
  })

  it('gives up with a timeout error when the model does not answer in time', async () => {
    const hanging = vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))

    await expect(probeOllamaModel('http://localhost:11434', 'qwen3.6:35b-a3b', 'x', {
      thinking: false,
      fetchImpl: hanging as any,
      timeoutMs: 20,
    })).rejects.toBeInstanceOf(OllamaProbeTimeoutError)
  })

  it('keeps a network failure as such, not as a timeout', async () => {
    const failing = vi.fn().mockRejectedValue(new TypeError('fetch failed'))

    await expect(probeOllamaModel('http://localhost:11434', 'qwen3.5:9b', 'x', { thinking: false, fetchImpl: failing as any }))
      .rejects.toThrow('fetch failed')
  })
})

describe('ollamaCanThink', () => {
  const show = (capabilities: string[]) => vi.fn().mockResolvedValue(new Response(JSON.stringify({ capabilities }), { status: 200 }))

  beforeEach(() => clearOllamaThinkingCache())

  it('is true only for a model that declares a thinking channel', async () => {
    expect(await ollamaCanThink('http://localhost:11434', 'qwen3.5:9b', show(['completion', 'tools', 'thinking']) as any)).toBe(true)
    expect(await ollamaCanThink('http://localhost:11434', 'llama3.1:8b', show(['completion', 'tools']) as any)).toBe(false)
  })

  it('is false when the server cannot say', async () => {
    const down = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))

    expect(await ollamaCanThink('http://localhost:11434', 'qwen3.5:9b', down as any)).toBe(false)
  })

  it('asks the server once per model, not once per empty turn', async () => {
    const fetchMock = show(['thinking'])

    await ollamaCanThink('http://localhost:11434/', 'qwen3.5:9b', fetchMock as any)
    await ollamaCanThink('http://localhost:11434', 'qwen3.5:9b', fetchMock as any)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
