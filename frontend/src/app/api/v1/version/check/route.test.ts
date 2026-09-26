import { afterEach, describe, expect, it, vi } from 'vitest'

import { GET } from './route'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('GET /api/v1/version/check in air-gapped mode', () => {
  it('answers without calling GitHub and says why', async () => {
    vi.stubEnv('PROXCENTER_OFFLINE', 'true')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const body = await (await GET()).json()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(body).toMatchObject({ updateAvailable: false, latestVersion: null, error: 'offline' })
    expect(typeof body.currentVersion).toBe('string')
  })

  it('asks GitHub for the latest release when the instance is not air-gapped', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ tag_name: 'v99.0.0', html_url: 'https://example.test/v99', body: 'notes', published_at: '2026-09-01T00:00:00Z' }),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const body = await (await GET()).json()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/releases/latest')
    expect(body).toMatchObject({ latestVersion: '99.0.0', updateAvailable: true, releaseUrl: 'https://example.test/v99', error: null })
  })

  it('reports a failed check, not an offline one, when GitHub is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND api.github.com')))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const body = await (await GET()).json()

    expect(body).toMatchObject({ latestVersion: null, updateAvailable: false, error: 'Failed to check for updates' })
  })
})
