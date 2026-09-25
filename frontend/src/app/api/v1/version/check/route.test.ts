import { afterEach, describe, expect, it, vi } from 'vitest'

import { GET } from './route'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
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
})
