/**
 * Tests for POST /api/v1/ai/models, focused on the OpenAI base URL
 * normalisation: trailing slashes are stripped before `/models` is appended.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  validateAIUrl: vi.fn(async (u: string) => u),
}))

vi.mock('@/lib/rbac', () => ({ checkPermission: vi.fn(async () => null), PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' } }))
vi.mock('@/lib/ai/url-guard', () => ({ validateAIUrl: h.validateAIUrl }))

import { POST } from './route'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

const fetchMock = vi.fn()

beforeEach(() => {
  h.validateAIUrl.mockClear()
  fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({
    data: [{ id: 'gpt-4o' }, { id: 'text-embedding-3-small' }, { id: 'gpt-4.1-mini' }, { id: 'whisper-1' }],
  }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('POST /api/v1/ai/models (openai)', () => {
  it('strips trailing slashes from a custom base URL and filters non-chat models', async () => {
    const res = await callRoute(POST, { body: { provider: 'openai', openaiKey: 'sk-test', openaiBaseUrl: 'https://llm.example.com/v1///' } })
    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ models: ['gpt-4.1-mini', 'gpt-4o'] })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://llm.example.com/v1/models')
    expect(init.headers).toEqual({ Authorization: 'Bearer sk-test' })
  })

  it('strips a single trailing slash', async () => {
    await callRoute(POST, { body: { provider: 'openai', openaiKey: 'k', openaiBaseUrl: 'http://10.0.0.5:8000/v1/' } })
    expect(fetchMock.mock.calls[0][0]).toBe('http://10.0.0.5:8000/v1/models')
  })

  it('uses the default OpenAI base when none is given', async () => {
    await callRoute(POST, { body: { provider: 'openai', openaiKey: 'k' } })
    expect(h.validateAIUrl).toHaveBeenCalledWith('https://api.openai.com/v1')
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.openai.com/v1/models')
  })
})
