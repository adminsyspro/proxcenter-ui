import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mocks for the server deps the helper uses.
const mocks = vi.hoisted(() => ({
  isVdcTenant: vi.fn(),
  buildScopePayloadForCurrentTenant: vi.fn(),
  assertReportTypeAllowed: vi.fn(),
  getCurrentTenantId: vi.fn(),
  getVdcScope: vi.fn(),
  findMany: vi.fn(),
}))

vi.mock('@/lib/reports/tenantScope', () => ({
  isVdcTenant: mocks.isVdcTenant,
  buildScopePayloadForCurrentTenant: mocks.buildScopePayloadForCurrentTenant,
  assertReportTypeAllowed: mocks.assertReportTypeAllowed,
}))
vi.mock('@/lib/tenant', () => ({
  getCurrentTenantId: mocks.getCurrentTenantId,
  getSessionPrisma: async () => ({ connection: { findMany: mocks.findMany } }),
}))
vi.mock('@/lib/vdc/scope', () => ({ getVdcScope: mocks.getVdcScope }))

import { resolveReportConnectionScope, applyReportRequestScope } from './connectionScope'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getCurrentTenantId.mockResolvedValue('default')
  mocks.getVdcScope.mockResolvedValue(null) // provider by default
  mocks.buildScopePayloadForCurrentTenant.mockResolvedValue(null)
  mocks.assertReportTypeAllowed.mockResolvedValue(null) // type allowed by default
  mocks.findMany.mockResolvedValue([{ id: 'pve-1' }, { id: 'pve-2' }])
})

describe('resolveReportConnectionScope', () => {
  it('clears connection_ids for type vdc regardless of body', async () => {
    mocks.isVdcTenant.mockResolvedValue(false)
    const body: any = { type: 'vdc', connection_ids: ['pve-1'] }
    expect(await resolveReportConnectionScope(body)).toBeNull()
    expect(body.connection_ids).toBeUndefined()
  })

  it('provider empty selection stays empty (= all)', async () => {
    mocks.isVdcTenant.mockResolvedValue(false)
    const body: any = { type: 'backup' }
    expect(await resolveReportConnectionScope(body)).toBeNull()
    expect(body.connection_ids).toEqual([])
  })

  it('provider keeps the valid PVE intersection', async () => {
    mocks.isVdcTenant.mockResolvedValue(false)
    const body: any = { type: 'backup', connection_ids: ['pve-1', 'ghost'] }
    expect(await resolveReportConnectionScope(body)).toBeNull()
    expect(body.connection_ids).toEqual(['pve-1'])
  })

  it('provider non-empty but all-invalid selection is rejected 400', async () => {
    mocks.isVdcTenant.mockResolvedValue(false)
    const body: any = { type: 'backup', connection_ids: ['ghost'] }
    const res = await resolveReportConnectionScope(body)
    expect(res?.status).toBe(400)
  })

  it('vDC is forced to its PVE slice', async () => {
    mocks.isVdcTenant.mockResolvedValue(true)
    mocks.getVdcScope.mockResolvedValue({ connectionIds: new Set(['pve-9']), pbsConnectionIds: new Set(['pbs-1']) })
    const body: any = { type: 'inventory', connection_ids: ['pve-1'] } // attempt to pivot
    expect(await resolveReportConnectionScope(body)).toBeNull()
    expect(body.connection_ids).toEqual(['pve-9']) // forced, PBS excluded, no pivot
  })

  it('vDC with no PVE connection is rejected 422 (never empty)', async () => {
    mocks.isVdcTenant.mockResolvedValue(true)
    mocks.getVdcScope.mockResolvedValue({ connectionIds: new Set<string>(), pbsConnectionIds: new Set(['pbs-1']) })
    const body: any = { type: 'inventory' }
    const res = await resolveReportConnectionScope(body)
    expect(res?.status).toBe(422)
  })

  it('vDC applies the node/vmid/storage scope payload when present', async () => {
    mocks.isVdcTenant.mockResolvedValue(true)
    mocks.getVdcScope.mockResolvedValue({ connectionIds: new Set(['pve-9']), pbsConnectionIds: new Set<string>() })
    mocks.buildScopePayloadForCurrentTenant.mockResolvedValue({
      node_filter: { 'pve-9': ['node1'] },
      vmid_filter: { 'pve-9': [100] },
      storage_filter: { 'pve-9': ['local'] },
    })
    const body: any = { type: 'inventory' }
    expect(await resolveReportConnectionScope(body)).toBeNull()
    expect(body.connection_ids).toEqual(['pve-9'])
    expect(body.node_filter).toEqual({ 'pve-9': ['node1'] })
    expect(body.vmid_filter).toEqual({ 'pve-9': [100] })
    expect(body.storage_filter).toEqual({ 'pve-9': ['local'] })
  })
})

describe('applyReportRequestScope', () => {
  it('short-circuits when the report type is denied', async () => {
    const { NextResponse } = await import('next/server')
    mocks.assertReportTypeAllowed.mockResolvedValue(NextResponse.json({ error: 'forbidden' }, { status: 403 }))
    const res = await applyReportRequestScope({ type: 'vdc' })
    expect(res?.status).toBe(403)
  })

  it('resolves the connection scope when the type is allowed', async () => {
    mocks.assertReportTypeAllowed.mockResolvedValue(null)
    mocks.isVdcTenant.mockResolvedValue(false)
    const body: any = { type: 'backup', connection_ids: ['pve-1', 'ghost'] }
    expect(await applyReportRequestScope(body)).toBeNull()
    expect(body.connection_ids).toEqual(['pve-1'])
  })
})
