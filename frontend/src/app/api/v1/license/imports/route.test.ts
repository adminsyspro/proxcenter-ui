import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

const requireProviderTenantMock = vi.fn<() => Promise<Response | null>>()
const checkPermissionMock = vi.fn<(...a: any[]) => Promise<Response | null>>()
const fetchMock = vi.fn()

vi.mock('@/lib/tenant', () => ({ requireProviderTenant: requireProviderTenantMock }))
vi.mock('@/lib/rbac', () => ({ checkPermission: checkPermissionMock, PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' } }))
vi.mock('@/lib/orchestrator/headers', () => ({ orchestratorHeaders: () => ({}) }))

async function importGET() { const mod = await import('./route'); return mod.GET as Parameters<typeof callRoute>[0] }

beforeEach(() => {
  requireProviderTenantMock.mockReset().mockResolvedValue(null)
  checkPermissionMock.mockReset().mockResolvedValue(null)
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('GET /api/v1/license/imports', () => {
  it('403s for a non-provider tenant', async () => {
    const { NextResponse } = await import('next/server')
    requireProviderTenantMock.mockResolvedValue(NextResponse.json({ error: 'x' }, { status: 403 }))
    const res = await callRoute(await importGET(), {})
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('forwards the orchestrator imports list', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ imports: [{ id: 'i1' }] }) })
    const res = await callRoute(await importGET(), {})
    expect(res.status).toBe(200)
    expect((await readJson(res)).imports).toHaveLength(1)
  })
  it('passes through a 404 when the feature is off (route not registered)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => { throw new Error('not json') } })
    const res = await callRoute(await importGET(), {})
    expect(res.status).toBe(404)
  })
  it('returns 503 ORCHESTRATOR_UNAVAILABLE when the orchestrator is down', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed: ECONNREFUSED'))
    const res = await callRoute(await importGET(), {})
    expect(res.status).toBe(503)
    expect((await readJson(res)).code).toBe('ORCHESTRATOR_UNAVAILABLE')
  })
})
