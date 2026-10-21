import { describe, it, expect, vi } from 'vitest'

import { fetchOllamaCapabilities, ollamaThread } from './ollama'

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
