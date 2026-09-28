import { describe, it, expect, vi, beforeEach } from 'vitest'

const checkPermissionMock = vi.fn<(...a: any[]) => Promise<Response | null>>()
const fetchMock = vi.fn()
const requireProviderTenantMock = vi.fn<() => Promise<Response | null>>()

vi.mock('@/lib/rbac', () => ({ checkPermission: checkPermissionMock, PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' } }))
vi.mock('@/lib/tenant', () => ({ requireProviderTenant: requireProviderTenantMock }))
vi.mock('@/lib/orchestrator/headers', () => ({ orchestratorHeaders: (x: any) => ({ ...x }) }))

async function checkinPOST() { const mod = await import('./route'); return mod.POST }

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  requireProviderTenantMock.mockReset().mockResolvedValue(null)
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('POST /api/v1/license/checkin', () => {
  it('403s when the caller lacks admin.settings', async () => {
    const { NextResponse } = await import('next/server')
    checkPermissionMock.mockResolvedValue(NextResponse.json({ error: 'forbidden' }, { status: 403 }))
    const res = await (await checkinPOST())()
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a caller outside the provider tenant before the permission check', async () => {
    const { NextResponse } = await import('next/server')
    requireProviderTenantMock.mockResolvedValue(NextResponse.json({ error: 'This operation is only available from the provider tenant' }, { status: 403 }))
    const res = await (await checkinPOST())()
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'This operation is only available from the provider tenant' })
    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('names the check-in when an unexpected failure carries no message', async () => {
    fetchMock.mockRejectedValue({})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await (await checkinPOST())()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ success: false, error: 'Failed to check in' })
  })

  it('forwards the queued answer with status 202', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true, queued: true }), { status: 202 }))
    const res = await (await checkinPOST())()
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ success: true, queued: true })
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/v1\/license\/checkin$/)
    expect(fetchMock.mock.calls[0][1].method).toBe('POST')
  })

  it('forwards NOT_CONNECTED with status 409', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: false, error: 'not connected', code: 'NOT_CONNECTED' }), { status: 409 }))
    const res = await (await checkinPOST())()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ success: false, error: 'not connected', code: 'NOT_CONNECTED' })
  })

  it('503s with ORCHESTRATOR_UNAVAILABLE when the orchestrator is down', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await (await checkinPOST())()
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('ORCHESTRATOR_UNAVAILABLE')
  })
})
