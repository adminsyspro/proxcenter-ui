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

describe('GET /api/v1/version/check on a build that is not a release', () => {
  const latestRelease = (tag: string) =>
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ tag_name: tag, html_url: 'https://example.test/r' }), { status: 200 }))

  const getWithVersion = async (version: string) => {
    vi.resetModules()
    vi.stubEnv('NEXT_PUBLIC_APP_VERSION', version)
    const { GET: get } = await import('./route')

    return (await get()).json()
  }

  it.each(['staging', 'dev'])('announces no update and skips GitHub for a %s build', async (version) => {
    const fetchMock = latestRelease('v1.4.12')
    vi.stubGlobal('fetch', fetchMock)

    const body = await getWithVersion(version)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(body).toMatchObject({ currentVersion: version, updateAvailable: false, latestVersion: null })
  })

  it('compares a pre-release build on its X.Y.Z', async () => {
    vi.stubGlobal('fetch', latestRelease('v1.4.12'))
    expect(await getWithVersion('1.4.13-staging')).toMatchObject({ latestVersion: '1.4.12', updateAvailable: false })

    vi.stubGlobal('fetch', latestRelease('v1.4.14'))
    expect(await getWithVersion('1.4.13-staging')).toMatchObject({ latestVersion: '1.4.14', updateAvailable: true })
  })

  it('announces only a newer release', async () => {
    vi.stubGlobal('fetch', latestRelease('v1.4.12'))
    expect(await getWithVersion('1.4.13')).toMatchObject({ updateAvailable: false })

    vi.stubGlobal('fetch', latestRelease('v1.10.0'))
    expect(await getWithVersion('1.9.3')).toMatchObject({ updateAvailable: true })
  })
})
