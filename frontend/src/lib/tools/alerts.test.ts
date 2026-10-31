/**
 * Alerts handed to the assistant (#459). The table is per tenant only, so
 * these tests pin the two gates that keep a scoped user's assistant from
 * reading the rest of the estate: the alerts permission and the snapshot.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import type { InventorySnapshot } from './snapshot'
import type { ToolContext } from './types'

const h = vi.hoisted(() => ({
  denied: false,
  rows: [] as unknown[],
  findMany: vi.fn(),
}))

vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { ALERTS_VIEW: 'alerts.view' },
  checkPermission: async () => (h.denied ? { status: 403 } : null),
}))
vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: async () => ({ alert: { findMany: h.findMany } }),
}))

import { alertInSnapshot, listAlertsTool, loadScopedAlerts } from './alerts'

const snapshot = (restricted: boolean): InventorySnapshot => ({
  clusters: [{ id: 'c1', name: 'PVE-PROD', nodeCount: 1, guestCount: 1 }],
  nodes: [{ connId: 'c1', cluster: 'PVE-PROD', name: 'pve2', status: 'online', cpuPct: 1, memPct: 80, memUsedGb: 19, memTotalGb: 23.5 }],
  guests: [
    {
      connId: 'c1', cluster: 'PVE-PROD', vmid: '101', name: 'db-01', type: 'VM', kind: 'qemu', status: 'running', node: 'pve2',
      cpuPct: 1, memPct: 1, memUsedGb: 1, memTotalGb: 4, template: false,
    },
  ],
  summary: { totalGuests: 1, runningGuests: 1, stoppedGuests: 0, totalNodes: 1, onlineNodes: 1 },
  cached: false,
  restricted,
})

const alert = (over: Record<string, unknown>) => ({
  severity: 'warn',
  message: 'm',
  source: 'PVE-PROD',
  entityType: 'node',
  entityId: 'pve2',
  entityName: 'pve2',
  metric: 'memory',
  currentValue: 80.6,
  threshold: 80,
  status: 'active',
  firstSeenAt: new Date('2026-10-30T08:00:00Z'),
  lastSeenAt: new Date('2026-10-30T15:00:00Z'),
  ...over,
})

const ROWS = [
  alert({}),
  // A host of another cluster the caller cannot see.
  alert({ source: 'PVE-OTHER', entityId: 'pve9', entityName: 'pve9', severity: 'crit', message: 'other tenant host' }),
  alert({ entityType: 'cluster', entityId: 'c1', entityName: 'PVE-PROD', severity: 'crit', message: 'Ceph HEALTH_ERR' }),
  alert({ entityType: 'cluster', entityId: 'c9', entityName: 'PVE-OTHER', severity: 'crit', message: 'other cluster' }),
  alert({ entityType: 'vm', entityId: '101', entityName: 'db-01', message: 'db-01 RAM' }),
  alert({ entityType: 'server', entityId: 'pbs-1', entityName: 'PBS', source: 'PBS', message: 'PBS datastore full' }),
]

beforeEach(() => {
  h.denied = false
  h.findMany.mockReset().mockResolvedValue(ROWS)
})

describe('alertInSnapshot', () => {
  it('places host, cluster and guest alerts on the snapshot', () => {
    const s = snapshot(true)

    expect(ROWS.map(a => alertInSnapshot(a, s))).toEqual([true, false, true, false, true, false])
  })

  it('keeps an alert it cannot place only for a caller nothing restricts', () => {
    expect(alertInSnapshot(ROWS[5], snapshot(false))).toBe(true)
    expect(alertInSnapshot(ROWS[5], { ...snapshot(false), restricted: undefined })).toBe(false)
  })
})

describe('loadScopedAlerts', () => {
  it('returns nothing without the alerts permission, and never reads the table', async () => {
    h.denied = true

    expect(await loadScopedAlerts(snapshot(false))).toEqual([])
    expect(h.findMany).not.toHaveBeenCalled()
  })

  it('drops the alerts outside the caller scope before the limit', async () => {
    const alerts = await loadScopedAlerts(snapshot(true), { limit: 2 })

    expect(alerts.map(a => a.message)).toEqual(['m', 'Ceph HEALTH_ERR'])
  })

  it('swallows a database failure into an empty list', async () => {
    h.findMany.mockRejectedValueOnce(new Error('db down'))

    expect(await loadScopedAlerts(snapshot(true))).toEqual([])
  })
})

describe('list_alerts', () => {
  const ctx = (): ToolContext => ({ snapshot: snapshot(true), tenantId: 't', locale: 'en' })

  it('filters on severity and counts per severity', async () => {
    const res = (await listAlertsTool.execute({ severity: 'crit' }, ctx())) as any

    expect(res.total).toBe(1)
    expect(res.alerts[0]).toMatchObject({ severity: 'crit', message: 'Ceph HEALTH_ERR', cluster: 'PVE-PROD', sinceUtc: '2026-10-30 08:00' })
    expect(res.bySeverity).toEqual({ crit: 1, warn: 0, info: 0 })
  })

  it('narrows to one host resolved on the snapshot', async () => {
    const res = (await listAlertsTool.execute({ node: 'pve2' }, ctx())) as any

    expect(res.alerts.map((a: any) => a.message)).toEqual(['m'])
  })

  it('asks the table for every status when told to', async () => {
    await listAlertsTool.execute({ status: 'all' }, ctx())

    expect(h.findMany.mock.calls[0][0].where).toEqual({ status: { in: ['active', 'acknowledged', 'resolved'] } })
  })
})
