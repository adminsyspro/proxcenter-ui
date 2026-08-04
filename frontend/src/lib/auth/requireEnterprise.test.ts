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
      expired: false,
      features: [],
      options: [],
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
      expired: false,
      features: [],
      options: [],
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
      expired: false,
      features: [],
      options: [],
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

describe('resolved marker (issue #633)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('marks a parsed license as resolved', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ licensed: false, edition: 'community' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
    )
    const { getServerLicense } = await import('./requireEnterprise')
    expect((await getServerLicense()).resolved).toBe(true)
  })

  it('does not mark the fallback as resolved when the orchestrator is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    const { getServerLicense } = await import('./requireEnterprise')
    expect((await getServerLicense()).resolved).toBe(false)
  })

  it('does not mark the fallback as resolved on a non-2xx answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Service Unavailable', { status: 503 }))
    )
    const { getServerLicense } = await import('./requireEnterprise')
    expect((await getServerLicense()).resolved).toBe(false)
  })
})

describe('P1: expired handling', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('getServerLicense reports enterprise=false for an expired enterprise license', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      licensed: true, expired: true, edition: 'enterprise', features: [], options: [],
    }))))
    const mod = await import('./requireEnterprise')
    const lic = await mod.getServerLicense()
    expect(lic.enterprise).toBe(false)
    expect(lic.expired).toBe(true)
  })

  it('getServerLicense carries options through', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      licensed: true, expired: false, edition: 'enterprise', options: ['control_plane_ha'],
    }))))
    const mod = await import('./requireEnterprise')
    expect((await mod.getServerLicense()).options).toEqual(['control_plane_ha'])
  })
})

describe('requireFeature', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('grants an edition feature on enterprise', async () => {
    const mod = await import('./requireEnterprise')
    vi.spyOn(mod._impl, 'getServerLicense').mockResolvedValue({
      enterprise: true, licensed: true, expired: false, edition: 'enterprise', features: [], options: [],
    })
    const res = await mod.requireFeature('drs')
    expect(res).toBeNull()
  })

  it('grants control_plane_ha via options', async () => {
    const mod = await import('./requireEnterprise')
    vi.spyOn(mod._impl, 'getServerLicense').mockResolvedValue({
      enterprise: true, licensed: true, expired: false, edition: 'enterprise', features: [], options: ['control_plane_ha'],
    })
    const res = await mod.requireFeature('control_plane_ha')
    expect(res).toBeNull()
  })

  it('denies control_plane_ha without the option', async () => {
    const mod = await import('./requireEnterprise')
    vi.spyOn(mod._impl, 'getServerLicense').mockResolvedValue({
      enterprise: true, licensed: true, expired: false, edition: 'enterprise', features: [], options: [],
    })
    const res = await mod.requireFeature('control_plane_ha')
    expect(res?.status).toBe(403)
    expect(await res!.json()).toEqual({ error: 'Feature not licensed', feature: 'control_plane_ha' })
  })

  it('denies options on community', async () => {
    const mod = await import('./requireEnterprise')
    vi.spyOn(mod._impl, 'getServerLicense').mockResolvedValue({
      enterprise: false, licensed: true, expired: false, edition: 'community', features: [], options: ['control_plane_ha'],
    })
    const res = await mod.requireFeature('control_plane_ha')
    expect(res?.status).toBe(403)
    expect(await res!.json()).toEqual({ error: 'Feature not licensed', feature: 'control_plane_ha' })
  })

  it('denies when expired', async () => {
    const mod = await import('./requireEnterprise')
    vi.spyOn(mod._impl, 'getServerLicense').mockResolvedValue({
      enterprise: false, licensed: true, expired: true, edition: 'enterprise', features: [], options: ['control_plane_ha'],
    })
    const res = await mod.requireFeature('control_plane_ha')
    expect(res?.status).toBe(403)
    expect(await res!.json()).toEqual({ error: 'Feature not licensed', feature: 'control_plane_ha' })
  })

  it('fails closed when the orchestrator is unreachable (requireFeature and hasServerFeature)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    const mod = await import('./requireEnterprise')
    const res = await mod.requireFeature('control_plane_ha')
    expect(res?.status).toBe(403)
    expect(await res!.json()).toEqual({ error: 'Feature not licensed', feature: 'control_plane_ha' })
    expect(await mod.hasServerFeature('control_plane_ha')).toBe(false)
  })

  it('hasServerFeature mirrors requireFeature for a granted feature', async () => {
    const mod = await import('./requireEnterprise')
    vi.spyOn(mod._impl, 'getServerLicense').mockResolvedValue({
      enterprise: true, licensed: true, expired: false, edition: 'enterprise', features: [], options: ['control_plane_ha'],
    })
    expect(await mod.hasServerFeature('control_plane_ha')).toBe(true)
  })
})
