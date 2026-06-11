import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

const requireProviderTenantMock = vi.fn<() => Promise<Response | null>>()
const checkPermissionMock = vi.fn<(...a: any[]) => Promise<Response | null>>()
const fetchMock = vi.fn()

vi.mock('@/lib/tenant', () => ({ requireProviderTenant: requireProviderTenantMock }))
vi.mock('@/lib/rbac', () => ({ checkPermission: checkPermissionMock, PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' } }))
vi.mock('@/lib/orchestrator/headers', () => ({ orchestratorHeaders: (x: any) => ({ ...x }) }))

async function importPOST() { const mod = await import('./route'); return mod.POST as Parameters<typeof callRoute>[0] }

beforeEach(() => {
  requireProviderTenantMock.mockReset().mockResolvedValue(null)
  checkPermissionMock.mockReset().mockResolvedValue(null)
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('POST /api/v1/license/import', () => {
  it('403s for a non-provider tenant', async () => {
    const { NextResponse } = await import('next/server')
    requireProviderTenantMock.mockResolvedValue(NextResponse.json({ error: 'x' }, { status: 403 }))
    const res = await callRoute(await importPOST(), { body: { license: 'BLOB' } })
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('400s when the license blob is missing', async () => {
    const res = await callRoute(await importPOST(), { body: {} })
    expect(res.status).toBe(400)
  })
  it('forwards a successful import + maps connection_id', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'imp-1', license_id: 'LIC-1' }) })
    const res = await callRoute(await importPOST(), { body: { license: 'BLOB', connection_id: 'c-a' } })
    expect(res.status).toBe(200)
    expect((await readJson(res)).id).toBe('imp-1')
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(sent).toEqual({ license: 'BLOB', connection_id: 'c-a' })
  })
  it('passes through a 409 duplicate', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'license already imported' }) })
    const res = await callRoute(await importPOST(), { body: { license: 'BLOB' } })
    expect(res.status).toBe(409)
  })
  it('returns 503 when the orchestrator is down', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed'))
    const res = await callRoute(await importPOST(), { body: { license: 'BLOB' } })
    expect(res.status).toBe(503)
  })
})
