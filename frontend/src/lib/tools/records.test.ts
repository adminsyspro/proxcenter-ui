import { describe, it, expect, vi, beforeEach } from 'vitest'

import { invokeTool } from './invoke'
import type { ToolContext } from './types'

const h = vi.hoisted(() => ({
  denied: false,
  migrations: [] as unknown[],
  health: [] as unknown[],
  vdcs: [] as unknown[],
  grants: null as unknown,
  findMigrations: vi.fn(),
}))

vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { VM_MIGRATE: 'vm.migrate', VM_VIEW: 'vm.view' },
  checkPermission: async () => (h.denied ? { status: 403 } : null),
  getRBACContext: async () => ({ isAdmin: false, userId: 'u1', tenantId: 't' }),
  getAccessibleResources: async () => h.grants,
}))
vi.mock('@/lib/rbac/vdcVisibility', () => ({
  filterVisibleVdcs: (vdcs: any[], grants: any) => (grants ? vdcs.filter(v => grants.includes(v.id)) : vdcs),
}))
vi.mock('@/lib/vdc', () => ({ listVdcs: async () => h.vdcs }))
vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: async () => ({
    migrationJob: { findMany: h.findMigrations },
    healthScoreHistory: { findMany: async () => h.health },
  }),
}))

import { getHealthTrendTool, getVdcQuotasTool, listMigrationsTool } from './records'

const ctx = (restricted = true): ToolContext => ({
  snapshot: {
    clusters: [{ id: 'c1', name: 'PVE-PROD', nodeCount: 1, guestCount: 0 }],
    nodes: [{ connId: 'c1', cluster: 'PVE-PROD', name: 'pve1', status: 'online', cpuPct: 1, memPct: 1, memUsedGb: 1, memTotalGb: 8 }],
    guests: [],
    summary: { totalGuests: 0, runningGuests: 0, stoppedGuests: 0, totalNodes: 1, onlineNodes: 1 },
    cached: false,
    restricted,
  },
  tenantId: 't',
  locale: 'en',
  timeZone: 'UTC',
})

const job = (over: Record<string, unknown>) => ({
  sourceVmName: 'w22',
  sourceHost: 'esxi1',
  targetConnectionId: 'c1',
  targetNode: 'pve1',
  targetStorage: 'ceph',
  targetVmid: 120,
  status: 'transferring',
  currentStep: 'disk 1/2',
  progress: 40,
  bytesTransferred: BigInt(10e9),
  totalBytes: BigInt(25e9),
  transferSpeed: '210 MB/s',
  error: null,
  startedAt: new Date('2026-10-30T10:00:00Z'),
  completedAt: null,
  ...over,
})

beforeEach(() => {
  h.denied = false
  h.grants = null
  h.findMigrations.mockReset().mockImplementation(async () => h.migrations)
})

describe('list_migrations', () => {
  it('keeps the jobs landing on a visible cluster and host, with progress and errors', async () => {
    h.migrations = [
      job({}),
      job({ status: 'failed', error: 'NBD device allocation failed', sourceVmName: 'deb13' }),
      job({ targetNode: 'pve9', sourceVmName: 'hidden' }),
      job({ targetConnectionId: 'c9', sourceVmName: 'other-tenant' }),
    ]

    const res = (await listMigrationsTool.execute({}, ctx())) as any

    expect(res).toMatchObject({ total: 2, running: 1, failed: 1, completed: 0 })
    expect(res.jobs[0]).toMatchObject({ guest: 'w22', targetCluster: 'PVE-PROD', progressPct: 40, transferredGb: 10, totalGb: 25, started: '2026-10-30 10:00' })
    expect(res.jobs[1].error).toBe('NBD device allocation failed')
    expect(JSON.stringify(res)).not.toMatch(/hidden|other-tenant/)
  })

  it('asks the table for the state the model named', async () => {
    h.migrations = []
    await listMigrationsTool.execute({ state: 'running' }, ctx())

    expect(h.findMigrations.mock.calls[0][0].where).toEqual({ status: { in: ['pending', 'preflight', 'creating_vm', 'transferring', 'configuring'] } })
  })

  it('refuses without the migrate permission', async () => {
    h.denied = true

    expect(await invokeTool(listMigrationsTool, {}, ctx())).toMatchObject({ ok: false, error: 'out-of-scope' })
    expect(h.findMigrations).not.toHaveBeenCalled()
  })
})

describe('get_vdc_quotas', () => {
  const vdc = (id: string, name: string) => ({
    id,
    name,
    enabled: true,
    connectionName: 'PVE-PROD',
    quota: { maxVcpus: 16, maxRamMb: 32768, maxStorageMb: null, maxVms: 10, maxSnapshots: null, maxBackups: null, maxVnets: null },
    usage: { usedVcpus: 12, usedRamMb: 16384, usedStorageMb: 51200, usedVms: 4, usedSnapshots: 2, usedBackups: 0, lastSyncedAt: '2026-10-30T15:00:00Z' },
  })

  it('gives used, limit and what is left for the vDCs a grant maps to', async () => {
    h.vdcs = [vdc('v1', 'acme'), vdc('v2', 'other')]
    h.grants = ['v1']

    const res = (await getVdcQuotasTool.execute({}, ctx())) as any

    expect(res.vdcs).toHaveLength(1)
    expect(res.vdcs[0]).toMatchObject({
      name: 'acme',
      vcpus: { used: 12, limit: 16, usedPct: 75, left: 4 },
      ramGb: { used: 16, limit: 32, usedPct: 50, left: 16 },
      storageGb: { used: 50, limit: null, usedPct: null, left: null },
      usageAsOf: '2026-10-30 15:00',
    })
  })

  it('says when no vDC is visible', async () => {
    h.vdcs = []

    expect(await getVdcQuotasTool.execute({}, ctx())).toMatchObject({ vdcs: [] })
  })
})

describe('get_health_trend', () => {
  it('reports the change of the score and of storage over the period', async () => {
    h.health = [
      { date: '2026-10-01', score: 95, cpuPct: 3, ramPct: 40, storagePct: 20.5 },
      { date: '2026-10-15', score: 90, cpuPct: 4, ramPct: 50, storagePct: 28 },
      { date: '2026-10-30', score: 100, cpuPct: 5, ramPct: 57, storagePct: 35 },
    ]

    const res = (await getHealthTrendTool.execute({ days: 30 }, ctx(false))) as any

    expect(res).toMatchObject({ points: 3, from: '2026-10-01', to: '2026-10-30', scoreChange: 5, storageChangePoints: 14.5 })
    expect(res.lowest).toMatchObject({ date: '2026-10-15', score: 90 })
  })

  it('is only for a caller who sees the whole infrastructure', async () => {
    expect(await invokeTool(getHealthTrendTool, {}, ctx(true))).toMatchObject({ ok: false, error: 'out-of-scope' })
  })

  it('says when nothing was recorded', async () => {
    h.health = []

    expect(((await getHealthTrendTool.execute({}, ctx(false))) as any).note).toMatch(/No health score/)
  })
})
