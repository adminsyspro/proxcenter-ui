import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/scheduler/lease', () => ({ tryAcquireLease: vi.fn(), releaseLease: vi.fn() }))
vi.mock('@/lib/db/settings', () => ({ getSetting: vi.fn(), setSetting: vi.fn() }))

import { billingCsv, buildBillingReport, monthRange, type UsageRow } from './report'
import { runGpuUsagePass, usageIncrements, type GpuUsageSamplerDeps, type UsageIncrement } from './sampler'
import { DEFAULT_GPU_BILLING_SETTINGS, parseGpuBillingSettings } from './settings'

const row = (over: Partial<UsageRow>): UsageRow => ({
  hour: new Date('2026-11-01T10:00:00Z'), connectionId: 'c1', connectionName: 'LAB', node: 'n1', vmid: 9010, vmName: 'ai',
  modelKey: '0x10de:0x2231', modelName: 'RTX A5000', pool: null, vdcId: null, vdcName: null, tenantId: 'default', tenantName: 'Default',
  runningSeconds: 3600, reservedSeconds: 0, ...over,
})

describe('buildBillingReport', () => {
  const prices = [{ modelKey: '0x10de:0x2231', label: 'A5000', runningHourly: 1.2, reservedHourly: 0.3 }]
  const opts = { from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-12-01T00:00:00Z'), currency: 'EUR' }

  it('sums the GPU-hours per owner, model and VM and prices them', () => {
    const r = buildBillingReport([
      row({ vdcId: 'v1', vdcName: 'ml-team', tenantId: 't1', tenantName: 'Acme' }),
      row({ vdcId: 'v1', vdcName: 'ml-team', tenantId: 't1', tenantName: 'Acme', hour: new Date('2026-11-01T11:00:00Z'), runningSeconds: 1800, reservedSeconds: 1800 }),
      row({ tenantId: 't2', tenantName: 'Beta', vmid: 200, vmName: 'render' }),
      row({ vmid: 300, vmName: 'internal' }),
    ], prices, opts)
    expect(r.owners.map(o => [o.kind, o.tenantName, o.vdcName, o.runningHours, o.reservedHours, o.cost])).toEqual([
      ['vdc', 'Acme', 'ml-team', 1.5, 0.5, 1.95],
      ['provider', null, null, 1, 0, 1.2],
      ['tenant', 'Beta', null, 1, 0, 1.2],
    ])
    expect(r.totals).toEqual({ runningHours: 3.5, reservedHours: 0.5, cost: 4.35 })
    expect(r.unpriced).toEqual([])
    expect(r.owners[0].vms[0]).toEqual(expect.objectContaining({ vmid: 9010, runningHours: 1.5, cost: 1.95 }))
  })

  it('sums the rounded VM lines so the totals reconcile with the invoice', () => {
    const r = buildBillingReport([
      row({ runningSeconds: 300 }),
      row({ vmid: 1, vmName: 'a', runningSeconds: 0, reservedSeconds: 300 }),
      row({ vmid: 2, vmName: 'b', runningSeconds: 0, reservedSeconds: 300 }),
    ], [{ modelKey: '0x10de:0x2231', label: '', runningHourly: 1.2, reservedHourly: 0.2 }], opts)
    const vmSum = r.owners[0].vms.reduce((s, v) => s + (v.cost ?? 0), 0)
    expect(r.owners[0].cost).toBe(Math.round(vmSum * 100) / 100)
    expect(r.totals.cost).toBe(r.owners[0].cost)
  })

  it('leaves the cost blank and lists the models without a price', () => {
    const r = buildBillingReport([row({ modelKey: 'name:L40S', modelName: 'L40S' })], prices, opts)
    expect(r.owners[0].cost).toBeNull()
    expect(r.unpriced).toEqual([{ modelKey: 'name:L40S', modelName: 'L40S' }])
    expect(r.totals.cost).toBe(0)
  })

  it('exports one CSV line per owner, VM and model, formula-safe', () => {
    const r = buildBillingReport([row({ vdcId: 'v1', vdcName: '=cmd', tenantId: 't1', tenantName: 'Acme, Inc' })], prices, opts)
    expect(billingCsv(r).split('\n')).toEqual([
      'tenant,vdc,cluster,node,vmid,vm,gpu_model,running_hours,reserved_hours,cost_EUR',
      '"Acme, Inc",\'=cmd,LAB,n1,9010,ai,RTX A5000,1,0,1.2',
      '',
    ])
  })
})

describe('monthRange', () => {
  it('reads a YYYY-MM month in UTC', () => {
    expect(monthRange('2026-12')).toEqual({ from: new Date('2026-12-01T00:00:00Z'), to: new Date('2027-01-01T00:00:00Z') })
    expect(monthRange('2026-13')).toBeNull()
    expect(monthRange('nov')).toBeNull()
  })
})

describe('parseGpuBillingSettings', () => {
  it('gives the defaults for a corrupt row and keeps valid prices', () => {
    expect(parseGpuBillingSettings('garbage')).toEqual(DEFAULT_GPU_BILLING_SETTINGS)
    const s = parseGpuBillingSettings({ currency: 'USD', prices: [{ modelKey: 'k', runningHourly: 2 }] })
    expect(s.currency).toBe('USD')
    expect(s.prices[0]).toEqual({ modelKey: 'k', label: '', runningHourly: 2, reservedHourly: 0 })
    expect(parseGpuBillingSettings({ currency: 'euro' })).toEqual(DEFAULT_GPU_BILLING_SETTINGS)
  })
})

const snapshot = {
  connId: 'c1', connectionName: 'LAB', error: null, nodes: [], configReads: 0, generatedAt: '',
  devices: [
    { key: 'c1:n1:0000:03:00', connId: 'c1', node: 'n1', id: '0000:03:00.0', slot: '0000:03:00', functions: [], displayFunctions: [], vendorId: '0x10de', deviceId: '0x2231', vendorName: 'NVIDIA', deviceName: 'RTX A5000', subsystemName: null, classCode: '0x030000', iommuGroup: 1, iommuIsolated: true, mdev: false, kind: 'gpu', consoleReason: null, mappings: [] },
    { key: 'c1:n1:0000:05:00', connId: 'c1', node: 'n1', id: '0000:05:00.0', slot: '0000:05:00', functions: [], displayFunctions: [], vendorId: '0x102b', deviceId: '0x0532', vendorName: 'Matrox', deviceName: 'G200', subsystemName: null, classCode: '0x030000', iommuGroup: 2, iommuIsolated: true, mdev: false, kind: 'console', consoleReason: 'vendor', mappings: [] },
  ],
  allocations: [
    { deviceKey: 'c1:n1:0000:03:00', connId: 'c1', node: 'n1', vmid: '9010', vmName: 'ai', vmStatus: 'running', template: false, pool: 'vdc-acme', tags: [], hostpci: 'hostpci0', via: 'mapping', mapping: 'm', mdev: null, pooled: false, uptime: 10 },
    { deviceKey: 'c1:n1:0000:03:00', connId: 'c1', node: 'n1', vmid: '9001', vmName: 'spare', vmStatus: 'stopped', template: false, pool: null, tags: [], hostpci: 'hostpci0', via: 'address', mapping: null, mdev: null, pooled: false, uptime: null },
    { deviceKey: 'c1:n1:0000:03:00', connId: 'c1', node: 'n1', vmid: '9003', vmName: 'tpl', vmStatus: 'stopped', template: true, pool: null, tags: [], hostpci: 'hostpci0', via: 'address', mapping: null, mdev: null, pooled: false, uptime: null },
    { deviceKey: 'c1:n1:0000:05:00', connId: 'c1', node: 'n1', vmid: '9020', vmName: 'console', vmStatus: 'running', template: false, pool: null, tags: [], hostpci: 'hostpci0', via: 'address', mapping: null, mdev: null, pooled: false, uptime: 1 },
  ],
} as any

const vdcs = [{ id: 'v1', name: 'ml-team', connectionId: 'c1', pvePoolName: 'vdc-acme', tenantId: 't1', tenantName: 'Acme' }]
const conn = { id: 'c1', name: 'LAB', tenantId: 'default' }

describe('usageIncrements', () => {
  it('credits running time to started VMs and reserved time to stopped ones, never templates nor consoles', () => {
    const hour = new Date('2026-11-01T10:00:00Z')
    const rows = usageIncrements(snapshot, conn, vdcs, new Map([['default', 'Default']]), hour, 300)
    expect(rows.map(r => [r.vmid, r.runningSeconds, r.reservedSeconds, r.vdcName, r.tenantName, r.modelKey])).toEqual([
      [9010, 300, 0, 'ml-team', 'Acme', '0x10de:0x2231'],
      [9001, 0, 300, null, 'Default', '0x10de:0x2231'],
    ])
  })
})

function deps(over: Partial<GpuUsageSamplerDeps> = {}) {
  const added: UsageIncrement[] = []
  const d: GpuUsageSamplerDeps = {
    licensed: async () => true,
    acquireLease: async () => true,
    loadSettings: async () => DEFAULT_GPU_BILLING_SETTINGS,
    loadLastPass: async () => new Date('2026-11-01T10:00:00Z'),
    saveLastPass: vi.fn(async () => {}),
    listConnections: async () => [conn],
    listVdcs: async () => vdcs,
    listTenantNames: async () => new Map(),
    readConnection: async () => snapshot,
    addUsage: async rows => {
      added.push(...rows)
    },
    purge: vi.fn(async () => 0),
    now: () => new Date('2026-11-01T10:05:00Z'),
    ...over,
  }
  return { d, added }
}

describe('runGpuUsagePass', () => {
  it('credits the time elapsed since the last pass into the hour row', async () => {
    const { d, added } = deps()
    const r = await runGpuUsagePass(d)
    expect(r).toEqual(expect.objectContaining({ leader: true, due: true, credited: 300, rows: 2 }))
    expect(added[0].hour.toISOString()).toBe('2026-11-01T10:00:00.000Z')
    expect(d.saveLastPass).toHaveBeenCalled()
  })

  it('caps the credit at two intervals after an outage', async () => {
    const { d, added } = deps({ loadLastPass: async () => new Date('2026-11-01T06:00:00Z') })
    expect((await runGpuUsagePass(d)).credited).toBe(600)
    expect(added[0].runningSeconds).toBe(600)
  })

  it('waits for the interval, skips without licence or lease, purges even when disabled', async () => {
    const early = deps({ now: () => new Date('2026-11-01T10:02:00Z') })
    expect((await runGpuUsagePass(early.d)).due).toBe(false)
    const unlicensed = deps({ licensed: async () => false })
    expect(await runGpuUsagePass(unlicensed.d)).toEqual(expect.objectContaining({ leader: false }))
    expect(unlicensed.d.purge).not.toHaveBeenCalled()
    const follower = deps({ acquireLease: async () => false })
    expect((await runGpuUsagePass(follower.d)).leader).toBe(false)
    const off = deps({ loadSettings: async () => ({ ...DEFAULT_GPU_BILLING_SETTINGS, enabled: false }) })
    const r = await runGpuUsagePass(off.d)
    expect(r.enabled).toBe(false)
    expect(off.d.purge).toHaveBeenCalled()
    expect(off.added).toHaveLength(0)
  })

  it('leaves a gap for an unreachable cluster', async () => {
    const { d, added } = deps({ readConnection: async () => { throw new Error('timeout') } })
    expect((await runGpuUsagePass(d)).failed).toBe(1)
    expect(added).toHaveLength(0)
  })
})
