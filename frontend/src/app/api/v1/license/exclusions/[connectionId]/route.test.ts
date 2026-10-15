import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

const requireProviderTenantMock = vi.fn<() => Promise<Response | null>>()
const checkPermissionMock = vi.fn<(...a: any[]) => Promise<Response | null>>()
const fetchMock = vi.fn()
const invalidateMock = vi.fn()

vi.mock('@/lib/tenant', () => ({ requireProviderTenant: requireProviderTenantMock }))
vi.mock('@/lib/rbac', () => ({ checkPermission: checkPermissionMock, PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' } }))
vi.mock('@/lib/orchestrator/headers', () => ({ orchestratorHeaders: () => ({}) }))
vi.mock('@/lib/license/exclusions', () => ({ invalidateLicenseExclusionCache: invalidateMock }))

async function exclusionsPUT() { const mod = await import('./route'); return mod.PUT as Parameters<typeof callRoute>[0] }

beforeEach(() => {
  requireProviderTenantMock.mockReset().mockResolvedValue(null)
  checkPermissionMock.mockReset().mockResolvedValue(null)
  fetchMock.mockReset()
  invalidateMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('PUT /api/v1/license/exclusions/[connectionId]', () => {
  it('403s for a non-provider tenant', async () => {
    const { NextResponse } = await import('next/server')
    requireProviderTenantMock.mockResolvedValue(NextResponse.json({ error: 'x' }, { status: 403 }))
    const res = await callRoute(await exclusionsPUT(), { method: 'PUT', params: { connectionId: 'c-a' }, body: { excluded: true } })
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('needs the same permission as a license import', async () => {
    const { NextResponse } = await import('next/server')
    checkPermissionMock.mockResolvedValue(NextResponse.json({ error: 'denied' }, { status: 403 }))
    const res = await callRoute(await exclusionsPUT(), { method: 'PUT', params: { connectionId: 'c-a' }, body: { excluded: true } })
    expect(res.status).toBe(403)
    expect(checkPermissionMock).toHaveBeenCalledWith('admin.settings')
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('forwards {excluded:true} to the orchestrator, url-encodes the id and drops the local cache', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ connection_id: 'c a', excluded: true }) })
    const res = await callRoute(await exclusionsPUT(), { method: 'PUT', params: { connectionId: 'c a' }, body: { excluded: true } })
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ connection_id: 'c a', excluded: true })
    expect(fetchMock.mock.calls[0][0]).toContain('/api/v1/license/exclusions/c%20a')
    expect(fetchMock.mock.calls[0][1].method).toBe('PUT')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ excluded: true })
    expect(invalidateMock).toHaveBeenCalledWith('c a')
  })
  it('forwards {excluded:false} to include a cluster again', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ connection_id: 'c-a', excluded: false }) })
    const res = await callRoute(await exclusionsPUT(), { method: 'PUT', params: { connectionId: 'c-a' }, body: { excluded: false } })
    expect(res.status).toBe(200)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ excluded: false })
  })
  it('400s when excluded is missing or not a boolean', async () => {
    for (const body of [{}, { excluded: 'yes' }, { excluded: 1 }]) {
      const res = await callRoute(await exclusionsPUT(), { method: 'PUT', params: { connectionId: 'c-a' }, body })
      expect(res.status).toBe(400)
    }
    expect(fetchMock).not.toHaveBeenCalled()
    expect(invalidateMock).not.toHaveBeenCalled()
  })
  it('passes through a 404 (unknown connection) without touching the cache', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: 'connection not found' }) })
    const res = await callRoute(await exclusionsPUT(), { method: 'PUT', params: { connectionId: 'nope' }, body: { excluded: true } })
    expect(res.status).toBe(404)
    expect(await readJson(res)).toEqual({ error: 'connection not found' })
    expect(invalidateMock).not.toHaveBeenCalled()
  })
  it('503s with ORCHESTRATOR_UNAVAILABLE when the orchestrator is down', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed: ECONNREFUSED'))
    const res = await callRoute(await exclusionsPUT(), { method: 'PUT', params: { connectionId: 'c-a' }, body: { excluded: true } })
    expect(res.status).toBe(503)
    expect((await readJson<{ code: string }>(res))?.code).toBe('ORCHESTRATOR_UNAVAILABLE')
  })
})
