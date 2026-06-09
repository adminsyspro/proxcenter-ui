import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mocks for the server deps the helper uses.
const mocks = vi.hoisted(() => ({
  assertReportTypeAllowed: vi.fn(),
  buildScopePayloadForCurrentTenant: vi.fn(),
  getCurrentTenantId: vi.fn(),
  // session prisma findMany (msp + legacy vdc path)
  sessionFindMany: vi.fn(),
  // global prisma findMany (provider path)
  globalFindMany: vi.fn(),
  // getTenantInfrastructureScope returns the infra object
  getTenantInfrastructureScope: vi.fn(),
}))

vi.mock('@/lib/reports/tenantScope', () => ({
  assertReportTypeAllowed: mocks.assertReportTypeAllowed,
  buildScopePayloadForCurrentTenant: mocks.buildScopePayloadForCurrentTenant,
}))

vi.mock('@/lib/tenant', () => ({
  getCurrentTenantId: mocks.getCurrentTenantId,
  getSessionPrisma: async () => ({ connection: { findMany: mocks.sessionFindMany } }),
}))

vi.mock('@/lib/tenant/infraScope', () => ({
  getTenantInfrastructureScope: mocks.getTenantInfrastructureScope,
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: { connection: { findMany: mocks.globalFindMany } },
}))

import { resolveReportConnectionScope, applyReportRequestScope, getTenantPveConnectionIds } from './connectionScope'

// Helper to make a VdcScope-like object for iaas tests.
function makeVdcScope(connIds: string[]): any {
  return { connectionIds: new Set(connIds), pbsConnectionIds: new Set<string>() }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getCurrentTenantId.mockResolvedValue('default')
  mocks.buildScopePayloadForCurrentTenant.mockResolvedValue(null)
  mocks.assertReportTypeAllowed.mockResolvedValue(null)
  // Default: provider with two PVE connections in the global client.
  mocks.getTenantInfrastructureScope.mockResolvedValue({ kind: 'provider' })
  mocks.globalFindMany.mockResolvedValue([{ id: 'pve-1' }, { id: 'pve-2' }])
  mocks.sessionFindMany.mockResolvedValue([{ id: 'pve-1' }, { id: 'pve-2' }])
})

// ---------------------------------------------------------------------------
// getTenantPveConnectionIds
// ---------------------------------------------------------------------------
describe('getTenantPveConnectionIds', () => {
  it('provider uses the GLOBAL client (all PVE connections)', async () => {
    mocks.getTenantInfrastructureScope.mockResolvedValue({ kind: 'provider' })
    mocks.globalFindMany.mockResolvedValue([{ id: 'pve-A' }, { id: 'pve-B' }])
    const ids = await getTenantPveConnectionIds()
    expect(ids).toEqual(['pve-A', 'pve-B'])
    expect(mocks.globalFindMany).toHaveBeenCalledOnce()
    expect(mocks.sessionFindMany).not.toHaveBeenCalled()
  })

  it('msp uses the SESSION client (tenant-owned rows)', async () => {
    mocks.getTenantInfrastructureScope.mockResolvedValue({
      kind: 'msp',
      connectionIds: new Set(['msp-pve-1', 'msp-pve-2']),
    })
    mocks.sessionFindMany.mockResolvedValue([{ id: 'msp-pve-1' }, { id: 'msp-pve-2' }])
    const ids = await getTenantPveConnectionIds()
    expect(ids).toEqual(['msp-pve-1', 'msp-pve-2'])
    expect(mocks.sessionFindMany).toHaveBeenCalledOnce()
    expect(mocks.globalFindMany).not.toHaveBeenCalled()
  })

  it('iaas returns vdcScope.connectionIds (no DB call)', async () => {
    mocks.getTenantInfrastructureScope.mockResolvedValue({
      kind: 'iaas',
      vdcScope: makeVdcScope(['pve-9']),
    })
    const ids = await getTenantPveConnectionIds()
    expect(ids).toEqual(['pve-9'])
    expect(mocks.sessionFindMany).not.toHaveBeenCalled()
    expect(mocks.globalFindMany).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// resolveReportConnectionScope -- shared / type=vdc
// ---------------------------------------------------------------------------
describe('resolveReportConnectionScope', () => {
  it('clears connection_ids for type vdc regardless of body', async () => {
    const body: any = { type: 'vdc', connection_ids: ['pve-1'] }
    expect(await resolveReportConnectionScope(body)).toBeNull()
    expect(body.connection_ids).toBeUndefined()
  })

  // -------------------------------------------------------------------------
  // provider branch
  // -------------------------------------------------------------------------
  describe('provider tenant', () => {
    beforeEach(() => {
      mocks.getTenantInfrastructureScope.mockResolvedValue({ kind: 'provider' })
      mocks.globalFindMany.mockResolvedValue([{ id: 'pve-1' }, { id: 'pve-2' }])
    })

    it('empty selection stays empty (= all)', async () => {
      const body: any = { type: 'backup' }
      expect(await resolveReportConnectionScope(body)).toBeNull()
      expect(body.connection_ids).toEqual([])
    })

    it('keeps the valid PVE intersection', async () => {
      const body: any = { type: 'backup', connection_ids: ['pve-1', 'ghost'] }
      expect(await resolveReportConnectionScope(body)).toBeNull()
      expect(body.connection_ids).toEqual(['pve-1'])
    })

    it('non-empty but all-invalid selection is rejected 400', async () => {
      const body: any = { type: 'backup', connection_ids: ['ghost'] }
      const res = await resolveReportConnectionScope(body)
      expect(res?.status).toBe(400)
    })

    it('can scope to an MSP-owned id because global client sees all connections', async () => {
      mocks.globalFindMany.mockResolvedValue([{ id: 'pve-1' }, { id: 'msp-pve-99' }])
      const body: any = { type: 'backup', connection_ids: ['msp-pve-99'] }
      expect(await resolveReportConnectionScope(body)).toBeNull()
      expect(body.connection_ids).toEqual(['msp-pve-99'])
    })
  })

  // -------------------------------------------------------------------------
  // iaas (vDC) branch
  // -------------------------------------------------------------------------
  describe('iaas (vDC) tenant', () => {
    beforeEach(() => {
      mocks.getTenantInfrastructureScope.mockResolvedValue({
        kind: 'iaas',
        vdcScope: makeVdcScope(['pve-9']),
      })
    })

    it('is forced to its PVE slice, ignoring requested ids', async () => {
      const body: any = { type: 'inventory', connection_ids: ['pve-1'] }
      expect(await resolveReportConnectionScope(body)).toBeNull()
      expect(body.connection_ids).toEqual(['pve-9'])
    })

    it('with no PVE connection is rejected 422', async () => {
      mocks.getTenantInfrastructureScope.mockResolvedValue({
        kind: 'iaas',
        vdcScope: makeVdcScope([]),
      })
      const body: any = { type: 'inventory' }
      const res = await resolveReportConnectionScope(body)
      expect(res?.status).toBe(422)
    })

    it('applies the node/vmid/storage scope payload when present', async () => {
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

  // -------------------------------------------------------------------------
  // msp branch
  // -------------------------------------------------------------------------
  describe('msp tenant', () => {
    beforeEach(() => {
      // infra kind = msp; getTenantPveConnectionIds uses session client
      mocks.getTenantInfrastructureScope.mockResolvedValue({
        kind: 'msp',
        connectionIds: new Set(['msp-pve-1', 'msp-pve-2']),
      })
      mocks.sessionFindMany.mockResolvedValue([{ id: 'msp-pve-1' }, { id: 'msp-pve-2' }])
    })

    it('empty selection is forced to all owned PVE connections', async () => {
      const body: any = { type: 'backup' }
      expect(await resolveReportConnectionScope(body)).toBeNull()
      expect(body.connection_ids).toEqual(['msp-pve-1', 'msp-pve-2'])
    })

    it('a selection of an owned id is kept', async () => {
      const body: any = { type: 'backup', connection_ids: ['msp-pve-1'] }
      expect(await resolveReportConnectionScope(body)).toBeNull()
      expect(body.connection_ids).toEqual(['msp-pve-1'])
    })

    it('a selection of a non-owned id is rejected 400', async () => {
      const body: any = { type: 'backup', connection_ids: ['pve-foreign'] }
      const res = await resolveReportConnectionScope(body)
      expect(res?.status).toBe(400)
    })

    it('a mixed selection keeps only owned ids', async () => {
      const body: any = { type: 'backup', connection_ids: ['msp-pve-1', 'pve-foreign'] }
      expect(await resolveReportConnectionScope(body)).toBeNull()
      expect(body.connection_ids).toEqual(['msp-pve-1'])
    })

    it('no owned PVE connections yields 422', async () => {
      mocks.sessionFindMany.mockResolvedValue([])
      const body: any = { type: 'backup' }
      const res = await resolveReportConnectionScope(body)
      expect(res?.status).toBe(422)
    })

    it('does NOT set node_filter / vmid_filter / storage_filter (no intra-cluster mask)', async () => {
      const body: any = { type: 'backup' }
      expect(await resolveReportConnectionScope(body)).toBeNull()
      expect(body.node_filter).toBeUndefined()
      expect(body.vmid_filter).toBeUndefined()
      expect(body.storage_filter).toBeUndefined()
    })

    it('does NOT call buildScopePayloadForCurrentTenant', async () => {
      const body: any = { type: 'backup' }
      await resolveReportConnectionScope(body)
      expect(mocks.buildScopePayloadForCurrentTenant).not.toHaveBeenCalled()
    })

    it('does NOT fall into provider empty=all path (no whole-fleet leak)', async () => {
      // Verify that body.connection_ids is always set (never stays [] for msp)
      const body: any = { type: 'backup' }
      await resolveReportConnectionScope(body)
      expect(body.connection_ids).not.toEqual([])
      expect(Array.isArray(body.connection_ids)).toBe(true)
      expect((body.connection_ids as string[]).length).toBeGreaterThan(0)
    })
  })
})

// ---------------------------------------------------------------------------
// applyReportRequestScope
// ---------------------------------------------------------------------------
describe('applyReportRequestScope', () => {
  it('short-circuits when the report type is denied', async () => {
    const { NextResponse } = await import('next/server')
    mocks.assertReportTypeAllowed.mockResolvedValue(NextResponse.json({ error: 'forbidden' }, { status: 403 }))
    const res = await applyReportRequestScope({ type: 'vdc' })
    expect(res?.status).toBe(403)
  })

  it('resolves the connection scope when the type is allowed (provider)', async () => {
    mocks.assertReportTypeAllowed.mockResolvedValue(null)
    mocks.getTenantInfrastructureScope.mockResolvedValue({ kind: 'provider' })
    mocks.globalFindMany.mockResolvedValue([{ id: 'pve-1' }, { id: 'pve-2' }])
    const body: any = { type: 'backup', connection_ids: ['pve-1', 'ghost'] }
    expect(await applyReportRequestScope(body)).toBeNull()
    expect(body.connection_ids).toEqual(['pve-1'])
  })

  it('resolves the connection scope when the type is allowed (msp)', async () => {
    mocks.assertReportTypeAllowed.mockResolvedValue(null)
    mocks.getTenantInfrastructureScope.mockResolvedValue({
      kind: 'msp',
      connectionIds: new Set(['msp-pve-1']),
    })
    mocks.sessionFindMany.mockResolvedValue([{ id: 'msp-pve-1' }])
    const body: any = { type: 'backup' }
    expect(await applyReportRequestScope(body)).toBeNull()
    expect(body.connection_ids).toEqual(['msp-pve-1'])
  })
})
