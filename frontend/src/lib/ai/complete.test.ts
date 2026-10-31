import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getSettingMock, hasFeatureMock, validateMock } = vi.hoisted(() => ({
  getSettingMock: vi.fn(),
  hasFeatureMock: vi.fn(),
  validateMock: vi.fn(),
}))

vi.mock('@/lib/db/settings', () => ({ getSetting: (...a: unknown[]) => getSettingMock(...a) }))
vi.mock('@/lib/auth/requireEnterprise', () => ({ hasServerFeature: (...a: unknown[]) => hasFeatureMock(...a) }))
vi.mock('./settingsSecrets', () => ({ openAiSecrets: (s: Record<string, unknown>) => s }))
vi.mock('./url-guard', () => ({ validateAIUrl: (...a: unknown[]) => validateMock(...a) }))

import { aiTargetId, completeText, extractJsonObject, resolveAiTarget, type AiTarget } from './complete'

const fetchMock = vi.fn()

beforeEach(() => {
  getSettingMock.mockReset()
  hasFeatureMock.mockReset().mockResolvedValue(true)
  validateMock.mockReset().mockImplementation(async (url: string) => url)
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const reply = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body })

describe('aiTargetId', () => {
  it('names the provider and model, or the rules without one', () => {
    expect(aiTargetId({ provider: 'ollama', model: 'llama3.1:8b', baseUrl: 'http://x' })).toBe('ollama:llama3.1:8b')
    expect(aiTargetId(null)).toBe('basic')
  })
})

describe('resolveAiTarget', () => {
  it('returns no model when the stored AI setting is switched off', async () => {
    getSettingMock.mockResolvedValue({ enabled: false, provider: 'ollama', ollamaUrl: 'http://o', ollamaModel: 'm' })

    await expect(resolveAiTarget('t1')).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns no model when the AI feature is not licensed', async () => {
    getSettingMock.mockResolvedValue({ enabled: true, provider: 'ollama', ollamaUrl: 'http://o', ollamaModel: 'm' })
    hasFeatureMock.mockResolvedValue(false)

    await expect(resolveAiTarget('t1')).resolves.toBeNull()
  })

  it('uses the configured Ollama, its URL checked and trailing slashes removed', async () => {
    getSettingMock.mockResolvedValue({ enabled: true, provider: 'ollama', ollamaUrl: 'http://gpu:11434//', ollamaModel: 'qwen' })

    await expect(resolveAiTarget('t1')).resolves.toEqual({ provider: 'ollama', model: 'qwen', baseUrl: 'http://gpu:11434' })
    expect(validateMock).toHaveBeenCalledWith('http://gpu:11434//')
  })

  it('needs both an Ollama URL and model', async () => {
    getSettingMock.mockResolvedValue({ enabled: true, provider: 'ollama', ollamaUrl: '', ollamaModel: 'qwen' })

    await expect(resolveAiTarget('t1')).resolves.toBeNull()
  })

  it('uses OpenAI with its default endpoint, or a checked custom one', async () => {
    getSettingMock.mockResolvedValue({ enabled: true, provider: 'openai', openaiKey: 'k', openaiModel: 'gpt' })
    await expect(resolveAiTarget('t1')).resolves.toEqual({ provider: 'openai', model: 'gpt', baseUrl: 'https://api.openai.com/v1', apiKey: 'k' })

    getSettingMock.mockResolvedValue({ enabled: true, provider: 'openai', openaiKey: 'k', openaiModel: 'gpt', openaiBaseUrl: 'https://proxy/v1/' })
    await expect(resolveAiTarget('t1')).resolves.toMatchObject({ baseUrl: 'https://proxy/v1' })

    getSettingMock.mockResolvedValue({ enabled: true, provider: 'openai', openaiModel: 'gpt' })
    await expect(resolveAiTarget('t1')).resolves.toBeNull()
  })

  it('uses Anthropic only with a key and a model', async () => {
    getSettingMock.mockResolvedValue({ enabled: true, provider: 'anthropic', anthropicKey: 'k', anthropicModel: 'claude' })
    await expect(resolveAiTarget('t1')).resolves.toEqual({ provider: 'anthropic', model: 'claude', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'k' })

    getSettingMock.mockResolvedValue({ enabled: true, provider: 'anthropic', anthropicKey: 'k' })
    await expect(resolveAiTarget('t1')).resolves.toBeNull()
  })

  it('falls back to the Ollama of the environment when nothing is stored and it answers', async () => {
    getSettingMock.mockRejectedValue(new Error('db down'))
    vi.stubEnv('OLLAMA_URL', 'http://env-ollama:11434/')
    vi.stubEnv('OLLAMA_MODEL', 'env-model')
    fetchMock.mockResolvedValue(reply({ models: [] }))

    await expect(resolveAiTarget('t1')).resolves.toEqual({ provider: 'ollama', model: 'env-model', baseUrl: 'http://env-ollama:11434' })
    expect(fetchMock.mock.calls[0][0]).toBe('http://env-ollama:11434/api/tags')
  })

  it('returns no model when the fallback Ollama does not answer', async () => {
    getSettingMock.mockResolvedValue(null)
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(resolveAiTarget('t1')).resolves.toBeNull()

    fetchMock.mockResolvedValue(reply({}, false, 502))
    await expect(resolveAiTarget('t1')).resolves.toBeNull()
  })
})

describe('completeText', () => {
  const request = { system: 'be brief', user: 'hello', maxTokens: 100, timeoutMs: 1000 }
  const bodyOf = () => JSON.parse(fetchMock.mock.calls[0][1].body as string)

  it('asks Ollama for JSON without thinking and returns the message', async () => {
    const target: AiTarget = { provider: 'ollama', model: 'llama', baseUrl: 'http://o' }
    fetchMock.mockResolvedValue(reply({ message: { content: '{"a":1}' } }))

    await expect(completeText(target, request)).resolves.toBe('{"a":1}')
    expect(fetchMock.mock.calls[0][0]).toBe('http://o/api/chat')
    expect(bodyOf()).toMatchObject({
      model: 'llama',
      format: 'json',
      think: false,
      stream: false,
      messages: [{ role: 'system', content: 'be brief' }, { role: 'user', content: 'hello' }],
      options: { num_predict: 100 },
    })
  })

  it('puts the whole instruction in the user message when there is no system prompt', async () => {
    fetchMock.mockResolvedValue(reply({}))

    await expect(completeText({ provider: 'ollama', model: 'm', baseUrl: 'http://o' }, { ...request, system: '' })).resolves.toBe('')
    expect(bodyOf().messages).toEqual([{ role: 'user', content: 'hello' }])
  })

  it('calls OpenAI with a bearer key', async () => {
    fetchMock.mockResolvedValue(reply({ choices: [{ message: { content: 'hi' } }] }))

    await expect(completeText({ provider: 'openai', model: 'gpt', baseUrl: 'https://api', apiKey: 'k' }, request)).resolves.toBe('hi')
    expect(fetchMock.mock.calls[0][0]).toBe('https://api/chat/completions')
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer k')
    expect(bodyOf()).toMatchObject({ model: 'gpt', max_tokens: 100 })
  })

  it('calls Anthropic with the system apart and joins the text blocks', async () => {
    fetchMock.mockResolvedValue(reply({ content: [{ type: 'text', text: 'a' }, { type: 'tool_use' }, { type: 'text', text: 'b' }] }))

    await expect(completeText({ provider: 'anthropic', model: 'c', baseUrl: 'https://anth', apiKey: 'k' }, request)).resolves.toBe('ab')
    expect(fetchMock.mock.calls[0][1].headers['x-api-key']).toBe('k')
    expect(bodyOf()).toMatchObject({ system: 'be brief', messages: [{ role: 'user', content: 'hello' }] })
  })

  it('throws on an HTTP error from any provider', async () => {
    fetchMock.mockResolvedValue(reply({}, false, 500))

    await expect(completeText({ provider: 'ollama', model: 'm', baseUrl: 'http://o' }, request)).rejects.toThrow('Ollama error 500')
    await expect(completeText({ provider: 'openai', model: 'm', baseUrl: 'http://o' }, request)).rejects.toThrow('OpenAI error 500')
    await expect(completeText({ provider: 'anthropic', model: 'm', baseUrl: 'http://o' }, request)).rejects.toThrow('Anthropic error 500')
  })
})

describe('extractJsonObject', () => {
  it('finds the object inside fences and chatter', () => {
    expect(extractJsonObject('Sure!\n```json\n{"risk":"high"}\n```\nDone')).toEqual({ risk: 'high' })
  })

  it('returns null without an object or on broken JSON', () => {
    expect(extractJsonObject('no json here')).toBeNull()
    expect(extractJsonObject('{"a": }')).toBeNull()
  })
})
