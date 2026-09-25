import { afterEach, describe, expect, it, vi } from 'vitest'

import { GET } from './route'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
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

  it('carries offline on the orchestrator error answer', async () => {
    vi.stubEnv('PROXCENTER_OFFLINE', 'true')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })))
    const res = await GET()
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized', offline: true })
  })

  it('carries offline on the 500 answer of an unexpected failure', async () => {
    vi.stubEnv('PROXCENTER_OFFLINE', 'true')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await GET()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'boom', offline: true })
  })
})
