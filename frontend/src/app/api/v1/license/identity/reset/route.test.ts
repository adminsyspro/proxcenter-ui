import { describe, it, expect, vi, beforeEach } from 'vitest'

const checkPermissionMock = vi.fn<(...a: any[]) => Promise<Response | null>>()
const requireProviderTenantMock = vi.fn<() => Promise<Response | null>>()
const fetchMock = vi.fn()

vi.mock('@/lib/rbac', () => ({ checkPermission: checkPermissionMock, PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' } }))
vi.mock('@/lib/tenant', () => ({ requireProviderTenant: requireProviderTenantMock }))
vi.mock('@/lib/orchestrator/headers', () => ({ orchestratorHeaders: (x: any) => ({ ...x }) }))

async function resetPOST() { const mod = await import('./route'); return mod.POST }

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  requireProviderTenantMock.mockReset().mockResolvedValue(null)
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('POST /api/v1/license/identity/reset', () => {
  it('403s outside the provider tenant without reaching the orchestrator', async () => {
    const { NextResponse } = await import('next/server')
    requireProviderTenantMock.mockResolvedValue(NextResponse.json({ error: 'This operation is only available from the provider tenant' }, { status: 403 }))
    const res = await (await resetPOST())()
    expect(res.status).toBe(403)
    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('403s when the caller lacks admin.settings', async () => {
    const { NextResponse } = await import('next/server')
    checkPermissionMock.mockResolvedValue(NextResponse.json({ error: 'forbidden' }, { status: 403 }))
    const res = await (await resetPOST())()
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('forwards the orchestrator answer as-is on success', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true, install: { fingerprint: 'new', can_sign: true }, status: { licensed: false } }), { status: 200 }))
    const res = await (await resetPOST())()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, install: { fingerprint: 'new' } })
    expect(fetchMock.mock.calls[0][1].method).toBe('POST')
  })

  it('forwards an orchestrator error and code with its status', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'boom', code: 'IDENTITY_SIGNING_UNAVAILABLE' }), { status: 409 }))
    const res = await (await resetPOST())()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ success: false, error: 'boom', code: 'IDENTITY_SIGNING_UNAVAILABLE' })
  })

  it('forwards an orchestrator error without a code', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'boom' }), { status: 500 }))
    const res = await (await resetPOST())()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ success: false, error: 'boom' })
  })

  it('503s with ORCHESTRATOR_UNAVAILABLE when the orchestrator is down', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await (await resetPOST())()
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('ORCHESTRATOR_UNAVAILABLE')
  })

  it('reports HTTP status when the orchestrator error is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 }))
    const res = await (await resetPOST())()
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ success: false, error: 'HTTP 502' })
  })

  it.each(['connect ECONNREFUSED 127.0.0.1:8080', 'getaddrinfo ENOTFOUND orchestrator'])('503s on %s', async message => {
    fetchMock.mockRejectedValue(new Error(message))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await (await resetPOST())()
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('ORCHESTRATOR_UNAVAILABLE')
  })

  it('500s with the error message on any other failure', async () => {
    fetchMock.mockRejectedValue(new Error('socket hang up'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await (await resetPOST())()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ success: false, error: 'socket hang up' })
  })

  it('500s with a default message when the error has none', async () => {
    fetchMock.mockRejectedValue({})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await (await resetPOST())()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ success: false, error: 'Failed to reset the install identity' })
  })
})
