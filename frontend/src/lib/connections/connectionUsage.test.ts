import { beforeEach, describe, expect, it, vi } from 'vitest'

const { db, orch, orchestratorFetchMock } = vi.hoisted(() => ({
  db: {
    tenant: { findMany: vi.fn() },
    connection: { findMany: vi.fn() },
    vdc: { findMany: vi.fn() },
    vdcPbsNamespace: { findMany: vi.fn() },
    migrationJob: { findMany: vi.fn() },
    vdcMove: { findMany: vi.fn() },
    complianceProfile: { findMany: vi.fn() },
    slaMaintenanceWindow: { findMany: vi.fn() },
    apiToken: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
  orch: {
    getReplicationJobs: vi.fn(),
    getRecoveryPlans: vi.fn(),
    listRestoreDrillSchedules: vi.fn(),
  },
  orchestratorFetchMock: vi.fn(),
}))

vi.mock('@/lib/db/prisma', () => ({ prisma: db }))
vi.mock('@/lib/orchestrator/client', () => ({
  getOrchestratorClient: () => orch,
  orchestratorFetch: (...args: unknown[]) => orchestratorFetchMock(...args),
  orchestratorPath: (s: TemplateStringsArray, ...v: unknown[]) => s.reduce((out, part, i) => out + part + (i < v.length ? String(v[i]) : ''), ''),
}))

import { connectionUsage, isBlocked } from './connectionUsage'

const PVE = { type: 'pve', tenantId: 'default' }

function empty() {
  for (const [name, table] of Object.entries(db)) if (name !== '$queryRaw') (table as any).findMany.mockResolvedValue([])
  db.$queryRaw.mockResolvedValue([])
  orch.getReplicationJobs.mockResolvedValue({ data: [] })
  orch.getRecoveryPlans.mockResolvedValue({ data: [] })
  orch.listRestoreDrillSchedules.mockResolvedValue({ data: { data: [], total: 0 } })
  orchestratorFetchMock.mockResolvedValue({ clusters: [{ policy_id: '', connection_id: 'dr', active: true }] })
}

beforeEach(() => {
  vi.clearAllMocks()
  empty()
})

describe('connectionUsage', () => {
  it('finds nothing on an unused connection', async () => {
    const usage = await connectionUsage('dr', PVE, { callerTenantId: 'default' })

    expect(usage).toEqual({ blocking: {}, apiTokens: [] })
    expect(isBlocked(usage)).toBe(false)
  })

  it('names the vDCs on the connection with their tenant', async () => {
    db.vdc.findMany.mockResolvedValue([{ name: 'MSP-DR', tenantId: 'msp' }])
    db.tenant.findMany.mockResolvedValue([{ id: 'msp', name: 'MSP' }])

    const usage = await connectionUsage('dr', PVE, { callerTenantId: 'default' })

    expect(usage.blocking.vdcs).toEqual(['MSP-DR (MSP)'])
    expect(isBlocked(usage)).toBe(true)
  })

  it('names the tenant that owns the connection when the provider deletes it', async () => {
    db.tenant.findMany.mockResolvedValue([{ id: 'msp', name: 'MSP' }])

    const usage = await connectionUsage('dr', { type: 'pve', tenantId: 'msp' }, { callerTenantId: 'default' })

    expect(usage.blocking.tenantOwner).toEqual(['MSP'])
  })

  it('lets a tenant delete its own connection without naming itself', async () => {
    const usage = await connectionUsage('dr', { type: 'pve', tenantId: 'msp' }, { callerTenantId: 'msp' })

    expect(usage.blocking.tenantOwner).toBeUndefined()
  })

  it('lists the Site Recovery jobs and plans, DRS rules and restore test schedules on it', async () => {
    orch.getReplicationJobs.mockResolvedValue({ data: [{ id: 'j1', name: 'Web', source_cluster: 'prod', target_cluster: 'dr' }] })
    orch.getRecoveryPlans.mockResolvedValue({ data: [{ id: 'p1', name: 'Critical', source_cluster: 'prod', target_cluster: 'dr' }] })
    db.$queryRaw.mockResolvedValue([{ id: 'r1', name: 'Keep apart' }])
    orch.listRestoreDrillSchedules.mockResolvedValue({ data: { data: [{ id: 's1', name: 'Nightly', connection_id: 'dr' }], total: 1 } })

    const { blocking } = await connectionUsage('dr', PVE, { callerTenantId: 'default' })

    expect(blocking).toMatchObject({
      replicationJobs: ['Web'],
      recoveryPlans: ['Critical'],
      drsRules: ['Keep apart'],
      restoreDrillSchedules: ['Nightly'],
    })
  })

  it('blocks on a micro-segmentation policy applied on the cluster or shared with others, by cluster name', async () => {
    db.connection.findMany.mockResolvedValue([{ id: 'dr', name: 'PVE-DR' }, { id: 'prod', name: 'PVE-PROD' }])
    orchestratorFetchMock.mockResolvedValue({ clusters: [
      { policy_id: 'pol', connection_id: 'dr', active: false },
      { policy_id: 'pol', connection_id: 'prod', active: true },
    ] })

    const { blocking } = await connectionUsage('dr', PVE, { callerTenantId: 'default' })

    expect(blocking.microseg).toEqual(['PVE-DR', 'PVE-PROD'])
    expect(orchestratorFetchMock).toHaveBeenCalledWith('/microseg/dr/clusters', expect.anything())
  })

  it('does not block on a policy left inactive on its single cluster: it cannot leave it', async () => {
    orchestratorFetchMock.mockResolvedValue({ clusters: [{ policy_id: 'pol', connection_id: 'dr', active: false }] })

    expect((await connectionUsage('dr', PVE, { callerTenantId: 'default' })).blocking.microseg).toBeUndefined()
  })

  it('skips what only the orchestrator knows when it cannot answer, or its table is absent', async () => {
    orch.getReplicationJobs.mockRejectedValue(new Error('down'))
    db.$queryRaw.mockRejectedValue(new Error('relation "affinity_rule_records" does not exist'))
    orch.listRestoreDrillSchedules.mockRejectedValue(new Error('down'))
    orchestratorFetchMock.mockRejectedValue(new Error('down'))
    db.vdc.findMany.mockResolvedValue([{ name: 'MSP-DR', tenantId: 'default' }])

    const usage = await connectionUsage('dr', PVE, { callerTenantId: 'default' })

    expect(usage.blocking).toEqual({ vdcs: ['MSP-DR'] })
  })

  it('lists migrations and vDC moves still running, compliance profiles and coming SLA windows', async () => {
    db.migrationJob.findMany.mockResolvedValue([{ sourceVmName: 'web-01', sourceVmId: 'vm-1' }, { sourceVmName: null, sourceVmId: 'vm-2' }])
    db.vdcMove.findMany.mockResolvedValue([{ guestName: null, vmid: 104 }])
    db.complianceProfile.findMany.mockResolvedValue([{ name: 'CIS' }])
    db.slaMaintenanceWindow.findMany.mockResolvedValue([{ reason: 'Patch', startsAt: new Date('2026-12-01T10:00:00Z') }])

    const { blocking } = await connectionUsage('dr', PVE, { callerTenantId: 'default' })

    expect(blocking).toMatchObject({
      migrations: ['web-01', 'vm-2'],
      vdcMoves: ['104'],
      complianceProfiles: ['CIS'],
      slaWindows: ['Patch (2026-12-01)'],
    })
    expect(db.migrationJob.findMany.mock.calls[0][0].where).toMatchObject({ status: { notIn: ['completed', 'failed', 'cancelled'] } })
    expect(db.vdcMove.findMany.mock.calls[0][0].where).toMatchObject({ status: { in: ['queued', 'copying', 'finalizing'] } })
    expect(db.slaMaintenanceWindow.findMany.mock.calls[0][0].where.endsAt.gt).toBeInstanceOf(Date)
  })

  it('names the vDCs backing up to a PBS connection, and asks nothing of Site Recovery for it', async () => {
    db.vdcPbsNamespace.findMany.mockResolvedValue([{ vdc: { name: 'MSP-vDC', tenantId: 'msp' } }, { vdc: { name: 'MSP-vDC', tenantId: 'msp' } }])
    db.tenant.findMany.mockResolvedValue([{ id: 'msp', name: 'MSP' }])

    const { blocking } = await connectionUsage('pbs', { type: 'pbs', tenantId: 'default' }, { callerTenantId: 'default' })

    expect(blocking.pbsVdcs).toEqual(['MSP-vDC (MSP)'])
    expect(orch.getReplicationJobs).not.toHaveBeenCalled()
    expect(orchestratorFetchMock).not.toHaveBeenCalled()
    expect(db.vdc.findMany).not.toHaveBeenCalled()
  })

  it('warns, without blocking, about the API tokens limited to the connection', async () => {
    db.apiToken.findMany.mockResolvedValue([{ name: 'ci' }])

    const usage = await connectionUsage('dr', PVE, { callerTenantId: 'default' })

    expect(usage.apiTokens).toEqual(['ci'])
    expect(isBlocked(usage)).toBe(false)
    expect(db.apiToken.findMany.mock.calls[0][0].where).toMatchObject({ connectionIds: { array_contains: ['dr'] }, revokedAt: null })
  })
})
