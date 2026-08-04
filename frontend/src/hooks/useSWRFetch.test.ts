/**
 * Tests for useSWRFetch's fetcher: the 401 → immediate redirect-to-login path.
 *
 * Environment: node (no jsdom, no React rendering — `fetcher` is a plain
 * function), hence a .test.ts lane run via vitest.unit.config.ts, not
 * .test.tsx/jsdom. `window` doesn't exist in this environment by default, so
 * each test stubs a minimal fake (`location.pathname` + `location.replace`)
 * to exercise the browser-only code path.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

function fakeResponse(status: number, body: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response
}

function stubWindow(pathname: string) {
  const replace = vi.fn()
  vi.stubGlobal('window', { location: { pathname, replace } })
  return replace
}

describe('useSWRFetch fetcher', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('a 401 triggers exactly one redirect to /login with the current path as callbackUrl', async () => {
    const replace = stubWindow('/infrastructure/inventory')
    fetchMock.mockResolvedValue(fakeResponse(401))
    const { fetcher } = await import('./useSWRFetch')

    await expect(fetcher('/api/v1/whatever')).rejects.toThrow('API error: 401')

    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledWith('/login?callbackUrl=%2Finfrastructure%2Finventory')
  })

  it('a 403 triggers no redirect', async () => {
    const replace = stubWindow('/infrastructure/inventory')
    fetchMock.mockResolvedValue(fakeResponse(403))
    const { fetcher } = await import('./useSWRFetch')

    await expect(fetcher('/api/v1/whatever')).rejects.toThrow('API error: 403')

    expect(replace).not.toHaveBeenCalled()
  })

  it('a 500 triggers no redirect', async () => {
    const replace = stubWindow('/infrastructure/inventory')
    fetchMock.mockResolvedValue(fakeResponse(500))
    const { fetcher } = await import('./useSWRFetch')

    await expect(fetcher('/api/v1/whatever')).rejects.toThrow('API error: 500')

    expect(replace).not.toHaveBeenCalled()
  })

  it('two 401s in quick succession trigger only one redirect', async () => {
    const replace = stubWindow('/infrastructure/inventory')
    fetchMock.mockResolvedValue(fakeResponse(401))
    const { fetcher } = await import('./useSWRFetch')

    await expect(fetcher('/api/v1/a')).rejects.toThrow('API error: 401')
    await expect(fetcher('/api/v1/b')).rejects.toThrow('API error: 401')

    expect(replace).toHaveBeenCalledTimes(1)
  })

  it('does not redirect when already on /login (avoids a redirect loop)', async () => {
    const replace = stubWindow('/login')
    fetchMock.mockResolvedValue(fakeResponse(401))
    const { fetcher } = await import('./useSWRFetch')

    await expect(fetcher('/api/v1/whatever')).rejects.toThrow('API error: 401')

    expect(replace).not.toHaveBeenCalled()
  })

  it('throws the same "API error: <status>" message for 401, 403 and 500 alike', async () => {
    for (const status of [401, 403, 500]) {
      vi.resetModules()
      stubWindow('/infrastructure/inventory')
      fetchMock.mockResolvedValue(fakeResponse(status))
      const { fetcher } = await import('./useSWRFetch')

      await expect(fetcher('/api/v1/whatever')).rejects.toThrow(`API error: ${status}`)
    }
  })

  it('still throws on invalid JSON for an ok response, without touching navigation', async () => {
    const replace = stubWindow('/infrastructure/inventory')
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'not json',
    } as Response)
    const { fetcher } = await import('./useSWRFetch')

    await expect(fetcher('/api/v1/whatever')).rejects.toThrow('Invalid JSON response from /api/v1/whatever')
    expect(replace).not.toHaveBeenCalled()
  })
})
