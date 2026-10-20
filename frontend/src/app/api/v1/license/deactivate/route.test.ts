import { describe, it, expect, vi, beforeEach } from 'vitest'

const checkPermissionMock = vi.fn<(...a: any[]) => Promise<Response | null>>()
const requireProviderTenantMock = vi.fn<() => Promise<Response | null>>()
const fetchMock = vi.fn()
const auditMock = vi.fn<(...a: any[]) => Promise<string>>()

vi.mock('@/lib/rbac', () => ({ checkPermission: checkPermissionMock, PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' } }))
vi.mock('@/lib/tenant', () => ({ requireProviderTenant: requireProviderTenantMock }))
vi.mock('@/lib/orchestrator/headers', () => ({ orchestratorHeaders: (x: any) => ({ ...x }) }))
vi.mock('@/lib/audit', () => ({ audit: (...a: any[]) => auditMock(...a) }))

// The handler ignores its request, but withAudit() (#1105) reads it.
async function deactivateDELETE() {
  const mod = await import('./route')
  return () => mod.DELETE(new Request('http://test/api/v1/license/deactivate', { method: 'DELETE' }))
}

/** The one row withAudit() writes for this route, the route itself never audits. */
function wrapperRow() {
  expect(auditMock).toHaveBeenCalledTimes(1)
  return auditMock.mock.calls[0][0]
}

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  requireProviderTenantMock.mockReset().mockResolvedValue(null)
  fetchMock.mockReset()
  auditMock.mockReset().mockResolvedValue('audit-id')
  vi.stubGlobal('fetch', fetchMock)
})

describe('DELETE /api/v1/license/deactivate', () => {
  it('403s outside the provider tenant without reaching the orchestrator', async () => {
    const { NextResponse } = await import('next/server')
    requireProviderTenantMock.mockResolvedValue(NextResponse.json({ error: 'This operation is only available from the provider tenant' }, { status: 403 }))
    const res = await (await deactivateDELETE())()
    expect(res.status).toBe(403)
    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapperRow()).toMatchObject({
      category: 'system', action: 'delete', resourceType: 'deactivate', status: 'failure',
      errorMessage: 'This operation is only available from the provider tenant',
      details: expect.objectContaining({ route: '/api/v1/license/deactivate', method: 'DELETE', httpStatus: 403 }),
    })
  })

  it('403s when the caller lacks admin.settings', async () => {
    const { NextResponse } = await import('next/server')
    checkPermissionMock.mockResolvedValue(NextResponse.json({ error: 'forbidden' }, { status: 403 }))
    const res = await (await deactivateDELETE())()
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('forwards the deactivation to the orchestrator', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) })
    const res = await (await deactivateDELETE())()
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/v1/license/deactivate'), expect.objectContaining({ method: 'DELETE' }))
    expect(wrapperRow()).toMatchObject({ category: 'system', action: 'delete', resourceType: 'deactivate', status: 'success', details: expect.objectContaining({ httpStatus: 200 }) })
  })
})
