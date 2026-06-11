import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

const requireProviderTenantMock = vi.fn<() => Promise<Response | null>>()
const checkPermissionMock = vi.fn<(...a: any[]) => Promise<Response | null>>()
const fetchMock = vi.fn()

vi.mock('@/lib/tenant', () => ({ requireProviderTenant: requireProviderTenantMock }))
vi.mock('@/lib/rbac', () => ({ checkPermission: checkPermissionMock, PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' } }))
vi.mock('@/lib/orchestrator/headers', () => ({ orchestratorHeaders: () => ({}) }))

async function importDELETE() { const mod = await import('./route'); return mod.DELETE as Parameters<typeof callRoute>[0] }

beforeEach(() => {
  requireProviderTenantMock.mockReset().mockResolvedValue(null)
  checkPermissionMock.mockReset().mockResolvedValue(null)
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('DELETE /api/v1/license/import/[id]', () => {
  it('403s for a non-provider tenant', async () => {
    const { NextResponse } = await import('next/server')
    requireProviderTenantMock.mockResolvedValue(NextResponse.json({ error: 'x' }, { status: 403 }))
    const res = await callRoute(await importDELETE(), { method: 'DELETE', params: { id: 'imp-1' } })
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('forwards the delete + url-encodes the id', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) })
    const res = await callRoute(await importDELETE(), { method: 'DELETE', params: { id: 'imp 1' } })
    expect(res.status).toBe(200)
    expect(fetchMock.mock.calls[0][0]).toContain('/license/import/imp%201')
  })
  it('passes through a 404 not-found', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: 'not found' }) })
    const res = await callRoute(await importDELETE(), { method: 'DELETE', params: { id: 'nope' } })
    expect(res.status).toBe(404)
  })
})

async function importPUT() { const mod = await import('./route'); return mod.PUT as Parameters<typeof callRoute>[0] }

describe('PUT /api/v1/license/import/[id] (mapping)', () => {
  it('403s for a non-provider tenant', async () => {
    const { NextResponse } = await import('next/server')
    requireProviderTenantMock.mockResolvedValue(NextResponse.json({ error: 'x' }, { status: 403 }))
    const res = await callRoute(await importPUT(), { method: 'PUT', params: { id: 'imp-1' }, body: { connection_ids: ['c-a'] } })
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('forwards the connection_ids to the orchestrator', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) })
    const res = await callRoute(await importPUT(), { method: 'PUT', params: { id: 'imp-1' }, body: { connection_ids: ['c-a', 'c-b'] } })
    expect(res.status).toBe(200)
    expect(fetchMock.mock.calls[0][1].method).toBe('PUT')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ connection_ids: ['c-a', 'c-b'] })
  })
  it('passes through a 409 (connection already covered by another license)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'already covered' }) })
    const res = await callRoute(await importPUT(), { method: 'PUT', params: { id: 'imp-1' }, body: { connection_ids: ['c-a'] } })
    expect(res.status).toBe(409)
  })
  it('400s when connection_ids is missing or not an array (no silent clear)', async () => {
    const res = await callRoute(await importPUT(), { method: 'PUT', params: { id: 'imp-1' }, body: {} })
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
