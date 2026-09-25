import { afterEach, describe, expect, it, vi } from 'vitest'

import { GET } from './route'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('GET /api/v1/license/status carries the offline flag', () => {
  it('merges offline=true into the orchestrator payload', async () => {
    vi.stubEnv('PROXCENTER_OFFLINE', '1')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ licensed: true, edition: 'enterprise' }), { status: 200 })))
    const body = await (await GET()).json()
    expect(body).toMatchObject({ licensed: true, edition: 'enterprise', offline: true })
  })

  it('carries offline=false on the community fallback when the orchestrator is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch failed')))
    const body = await (await GET()).json()
    expect(body).toMatchObject({ edition: 'community', offline: false })
  })
})
