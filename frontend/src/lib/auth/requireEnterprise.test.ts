import { describe, it, expect, vi, beforeEach } from 'vitest'

// Per-test module isolation via vi.resetModules() + dynamic import so each
// test case gets a clean module registry and mock state.

describe('requireEnterprise', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('returns 403 when not enterprise', async () => {
    const mod = await import('./requireEnterprise')
    vi.spyOn(mod._impl, 'getServerLicense').mockResolvedValue({
      enterprise: false,
      edition: 'community',
      licensed: false,
      features: [],
    })
    const res = await mod.requireEnterprise()
    expect(res?.status).toBe(403)
    const body = await res?.json()
    expect(body?.error).toBe('Enterprise feature')
  })

  it('returns null when enterprise', async () => {
    const mod = await import('./requireEnterprise')
    vi.spyOn(mod._impl, 'getServerLicense').mockResolvedValue({
      enterprise: true,
      edition: 'enterprise',
      licensed: true,
      features: [],
    })
    const result = await mod.requireEnterprise()
    expect(result).toBeNull()
  })

  it('returns null when enterprise_plus + licensed', async () => {
    const mod = await import('./requireEnterprise')
    vi.spyOn(mod._impl, 'getServerLicense').mockResolvedValue({
      enterprise: true,
      edition: 'enterprise_plus',
      licensed: true,
      features: [],
    })
    const result = await mod.requireEnterprise()
    expect(result).toBeNull()
  })

  it('fail-closed: getServerLicense returns enterprise:false when fetch rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('ECONNREFUSED connect ECONNREFUSED 127.0.0.1:8080'))
    )
    const { getServerLicense } = await import('./requireEnterprise')
    const lic = await getServerLicense()
    expect(lic.enterprise).toBe(false)
    expect(lic.edition).toBe('community')
    expect(lic.licensed).toBe(false)
    expect(lic.features).toEqual([])
  })

  it('getServerLicense returns community fallback when orchestrator returns non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Service Unavailable', { status: 503 }))
    )
    const { getServerLicense } = await import('./requireEnterprise')
    const lic = await getServerLicense()
    expect(lic.enterprise).toBe(false)
    expect(lic.edition).toBe('community')
    expect(lic.licensed).toBe(false)
  })

  it('getServerLicense parses enterprise edition and returns enterprise:true', async () => {
    const payload = { licensed: true, edition: 'enterprise', features: ['reports'] }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
      )
    )
    const { getServerLicense } = await import('./requireEnterprise')
    const lic = await getServerLicense()
    expect(lic.enterprise).toBe(true)
    expect(lic.edition).toBe('enterprise')
    expect(lic.licensed).toBe(true)
    expect(lic.features).toEqual(['reports'])
  })

  it('getServerLicense parses enterprise_plus edition and returns enterprise:true', async () => {
    const payload = { licensed: true, edition: 'enterprise_plus', features: [] }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
      )
    )
    const { getServerLicense } = await import('./requireEnterprise')
    const lic = await getServerLicense()
    expect(lic.enterprise).toBe(true)
    expect(lic.edition).toBe('enterprise_plus')
  })

  it('getServerLicense returns enterprise:false for licensed community edition', async () => {
    const payload = { licensed: true, edition: 'community', features: [] }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
      )
    )
    const { getServerLicense } = await import('./requireEnterprise')
    const lic = await getServerLicense()
    expect(lic.enterprise).toBe(false)
    expect(lic.edition).toBe('community')
    expect(lic.licensed).toBe(true)
  })

  it('getServerLicense uses defaults when JSON fields are missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
      )
    )
    const { getServerLicense } = await import('./requireEnterprise')
    const lic = await getServerLicense()
    expect(lic.enterprise).toBe(false)
    expect(lic.edition).toBe('community')
    expect(lic.licensed).toBe(false)
    expect(lic.features).toEqual([])
  })
})
