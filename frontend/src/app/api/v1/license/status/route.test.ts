import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { checkPermissionMock, requireProviderTenantMock } = vi.hoisted(() => ({
  checkPermissionMock: vi.fn<(...a: any[]) => Promise<Response | null>>(),
  requireProviderTenantMock: vi.fn<() => Promise<Response | null>>(),
}))

vi.mock('@/lib/rbac', () => ({ checkPermission: checkPermissionMock, PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' } }))
vi.mock('@/lib/tenant', () => ({ requireProviderTenant: requireProviderTenantMock }))

import { GET } from './route'

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  requireProviderTenantMock.mockReset().mockResolvedValue(null)
})

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

  it('falls back to the HTTP status when the orchestrator error carries no message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 502 })))
    const res = await GET()
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'HTTP 502', offline: false })
  })

  it('names the failure itself when the thrown error has no message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue({}))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await GET()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to fetch license status', offline: false })
  })
})

describe('GET /api/v1/license/status hides the pairing secrets from non-admins', () => {
  const connection = {
    available: true, status: 'pairing', portal_url: 'https://proxcenter.io',
    instance_id: 'inst-1', instance_name: 'lab', customer_name: 'ACME',
    user_code: 'ABCD-2345', verification_url: 'https://proxcenter.io/connect', pairing_expires_at: '2026-09-28T12:00:00Z',
    consecutive_failures: 0, lease_days_remaining: 29, held: [{ license_id: 'L1', lost: false }],
  }
  const upstream = { licensed: true, edition: 'enterprise', license_id: 'L1', lease_until: '2026-10-28T00:00:00Z', connection }
  const forbidden = () => Response.json({ error: 'forbidden' }, { status: 403 })

  function stubUpstream() {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(upstream), { status: 200 })))
  }

  function stripped() {
    const { user_code: _u, verification_url: _v, pairing_expires_at: _p, customer_name: _c, instance_id: _i, ...rest } = connection
    return rest
  }

  it('keeps the whole connection for a provider-tenant admin', async () => {
    stubUpstream()
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ...upstream, offline: false })
    expect(checkPermissionMock).toHaveBeenCalledWith('admin.settings')
  })

  it('strips the secrets, and only them, when admin.settings is missing, without a 403', async () => {
    checkPermissionMock.mockImplementation(async () => forbidden())
    stubUpstream()
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ...upstream, connection: stripped(), offline: false })
  })

  it('strips the secrets outside the provider tenant', async () => {
    requireProviderTenantMock.mockImplementation(async () => forbidden())
    stubUpstream()
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ...upstream, connection: stripped(), offline: false })
  })

  it('strips the secrets when the permission check itself throws', async () => {
    checkPermissionMock.mockRejectedValue(new Error('db down'))
    stubUpstream()
    const res = await GET()
    expect(res.status).toBe(200)
    expect((await res.json()).connection).toEqual(stripped())
  })

  it('does not check permissions when the answer carries no connection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ licensed: false }), { status: 200 })))
    expect(await (await GET()).json()).toEqual({ licensed: false, offline: false })
    expect(checkPermissionMock).not.toHaveBeenCalled()
  })
})
