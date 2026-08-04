/**
 * Tests for useSWRFetch's fetcher: the 401 → immediate session recheck path.
 *
 * Environment: node (no React rendering — `fetcher` is a plain function),
 * hence a .test.ts lane run via vitest.unit.config.ts, not .test.tsx/jsdom.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const mockGetSession = vi.fn()

vi.mock('next-auth/react', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}))

function fakeResponse(status: number, body: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response
}

describe('useSWRFetch fetcher', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    mockGetSession.mockReset()
    mockGetSession.mockResolvedValue(null)
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('a 401 triggers exactly one session re-check', async () => {
    fetchMock.mockResolvedValue(fakeResponse(401))
    const { fetcher } = await import('./useSWRFetch')

    await expect(fetcher('/api/v1/whatever')).rejects.toThrow('API error: 401')

    expect(mockGetSession).toHaveBeenCalledTimes(1)
  })

  it('a 403 triggers no session re-check', async () => {
    fetchMock.mockResolvedValue(fakeResponse(403))
    const { fetcher } = await import('./useSWRFetch')

    await expect(fetcher('/api/v1/whatever')).rejects.toThrow('API error: 403')

    expect(mockGetSession).not.toHaveBeenCalled()
  })

  it('a 500 triggers no session re-check', async () => {
    fetchMock.mockResolvedValue(fakeResponse(500))
    const { fetcher } = await import('./useSWRFetch')

    await expect(fetcher('/api/v1/whatever')).rejects.toThrow('API error: 500')

    expect(mockGetSession).not.toHaveBeenCalled()
  })

  it('two 401s in quick succession trigger only one session re-check', async () => {
    fetchMock.mockResolvedValue(fakeResponse(401))
    const { fetcher } = await import('./useSWRFetch')

    await expect(fetcher('/api/v1/a')).rejects.toThrow('API error: 401')
    await expect(fetcher('/api/v1/b')).rejects.toThrow('API error: 401')

    expect(mockGetSession).toHaveBeenCalledTimes(1)
  })

  it('throws the same "API error: <status>" message for 401, 403 and 500 alike', async () => {
    for (const status of [401, 403, 500]) {
      vi.resetModules()
      fetchMock.mockResolvedValue(fakeResponse(status))
      const { fetcher } = await import('./useSWRFetch')

      await expect(fetcher('/api/v1/whatever')).rejects.toThrow(`API error: ${status}`)
    }
  })

  it('still throws on invalid JSON for an ok response, without touching the session', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'not json',
    } as Response)
    const { fetcher } = await import('./useSWRFetch')

    await expect(fetcher('/api/v1/whatever')).rejects.toThrow('Invalid JSON response from /api/v1/whatever')
    expect(mockGetSession).not.toHaveBeenCalled()
  })
})
