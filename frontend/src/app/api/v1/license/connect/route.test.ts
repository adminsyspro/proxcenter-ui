import { describe, it, expect, vi, beforeEach } from 'vitest'

const checkPermissionMock = vi.fn<(...a: any[]) => Promise<Response | null>>()
const fetchMock = vi.fn()
const requireProviderTenantMock = vi.fn<() => Promise<Response | null>>()

vi.mock('@/lib/rbac', () => ({ checkPermission: checkPermissionMock, PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' } }))
vi.mock('@/lib/tenant', () => ({ requireProviderTenant: requireProviderTenantMock }))
vi.mock('@/lib/orchestrator/headers', () => ({ orchestratorHeaders: (x: any) => ({ ...x }) }))

async function routes() { const mod = await import('./route'); return { POST: mod.POST, DELETE: mod.DELETE } }

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  requireProviderTenantMock.mockReset().mockResolvedValue(null)
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('/api/v1/license/connect', () => {
  it('403s when the caller lacks admin.settings, on both verbs', async () => {
    const { NextResponse } = await import('next/server')
    checkPermissionMock.mockResolvedValue(NextResponse.json({ error: 'forbidden' }, { status: 403 }))
    const { POST, DELETE } = await routes()
    expect((await POST()).status).toBe(403)
    expect((await DELETE()).status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a caller outside the provider tenant before the permission check, on both verbs', async () => {
    const { NextResponse } = await import('next/server')
    requireProviderTenantMock.mockImplementation(async () => NextResponse.json({ error: 'This operation is only available from the provider tenant' }, { status: 403 }))
    const { POST, DELETE } = await routes()
    for (const res of [await POST(), await DELETE()]) {
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'This operation is only available from the provider tenant' })
    }
    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('POST forwards the pairing answer', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true, connection: { status: 'pairing', user_code: 'ABCD-2345', verification_url: 'https://proxcenter.io/connect' } }), { status: 200 }))
    const { POST } = await routes()
    const res = await POST()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, connection: { status: 'pairing', user_code: 'ABCD-2345' } })
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/v1\/license\/connect$/)
    expect(fetchMock.mock.calls[0][1].method).toBe('POST')
  })

  it('forwards an orchestrator refusal with its code and portal code', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: false, error: 'portal answered 404', code: 'PORTAL_UNREACHABLE', portal_code: '' }), { status: 502 }))
    const { POST } = await routes()
    const res = await POST()
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ success: false, error: 'portal answered 404', code: 'PORTAL_UNREACHABLE' })
  })

  it('DELETE forwards the disconnect', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true, connection: { status: 'none' } }), { status: 200 }))
    const { DELETE } = await routes()
    const res = await DELETE()
    expect(res.status).toBe(200)
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE')
  })

  it('503s with ORCHESTRATOR_UNAVAILABLE when the orchestrator is down', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { POST } = await routes()
    const res = await POST()
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('ORCHESTRATOR_UNAVAILABLE')
  })
})
