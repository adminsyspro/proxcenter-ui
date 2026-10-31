import { describe, it, expect, vi, beforeEach } from 'vitest'

// Host and storage permissions (#459): allowed unless a test says otherwise.
const perms = vi.hoisted(() => ({
  denied: new Set<string>(),
  hiddenStorages: new Set<string>(),
}))

vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { NODE_VIEW: 'node.view', NODE_NETWORK: 'node.network' },
  buildNodeResourceId: (connId: string, node: string) => `${connId}:${node}`,
  checkPermission: async (permission: string, type?: string, id?: string) =>
    perms.denied.has(`${permission}|${type ?? ''}|${id ?? ''}`) ? { status: 403 } : null,
}))
vi.mock('@/lib/storage/storageVisibility', () => ({
  resolveStorageCaller: async () => ({ allowed: true, denied: null, perimeter: null, infraScope: null, partial: false }),
  storageVisibilityFilter: async () => (row: { storage: string }) => !perms.hiddenStorages.has(row.storage),
}))

import { chartFromToolResult } from '@/lib/ai/charts'
import { invokeTool } from './invoke'
import type { ToolContext } from './types'

const pveFetch = vi.fn()

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...args: unknown[]) => pveFetch(...args) }))
vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: async (id: string) => ({ id, name: id, baseUrl: 'https://pve:8006', apiToken: 't' }),
}))

import { clearForecastCache, forecastCapacityTool, linearTrend, simulateMigrationTool } from './forecast'
import { clearHistoryCache } from './history'

const node = (name: string, memUsedGb: number, over: Record<string, unknown> = {}) => ({
  connId: 'c1', cluster: 'PVE-PROD', name, status: 'online', cpuPct: 5, cores: 8, memPct: Math.round((memUsedGb / 32) * 1000) / 10,
  memUsedGb, memTotalGb: 32, ...over,
})

const ctx = (): ToolContext => ({
  snapshot: {
    clusters: [{ id: 'c1', name: 'PVE-PROD', nodeCount: 3, guestCount: 2 }],
    nodes: [node('pve1', 10), node('pve2', 26), node('pve3', 4, { maintenance: 'maintenance' })],
    guests: [
      { connId: 'c1', cluster: 'PVE-PROD', vmid: '101', name: 'db-01', type: 'VM', kind: 'qemu', status: 'running', node: 'pve1', cpuPct: 1, vcpus: 4, memPct: 1, memUsedGb: 1, memTotalGb: 8, template: false },
      { connId: 'c1', cluster: 'PVE-PROD', vmid: '102', name: 'web-01', type: 'VM', kind: 'qemu', status: 'running', node: 'pve2', cpuPct: 1, vcpus: 8, memPct: 1, memUsedGb: 1, memTotalGb: 4, template: false },
    ],
    summary: { totalGuests: 2, runningGuests: 2, stoppedGuests: 0, totalNodes: 3, onlineNodes: 3 },
    cached: false,
  },
  tenantId: 't',
  locale: 'en',
  timeZone: 'UTC',
  usage: { historyLookups: 0 },
})

const now = Math.floor(Date.now() / 1000)

/** 30 days, 1 point per 30 min, from 50 % to 80 %: 1 point a day. */
const month = Array.from({ length: 1440 }, (_, i) => ({ time: now - (1440 - i) * 1800, used: 50 + (i / 1440) * 30, total: 100, memused: 16, memtotal: 32 }))

beforeEach(() => {
  perms.denied.clear()
  perms.hiddenStorages.clear()
  clearForecastCache()
  clearHistoryCache()
  pveFetch.mockReset().mockImplementation(async (_conn: unknown, path: string) => {
    if (path === '/cluster/resources?type=storage') {
      return [
        { storage: 'ZFS-Pool', node: 'pve1', shared: 0 },
        { storage: 'ZFS-Pool', node: 'pve2', shared: 0 },
        { storage: 'CephStoragePool', node: 'pve1', shared: 1 },
        { storage: 'CephStoragePool', node: 'pve9', shared: 1 },
      ]
    }

    return month
  })
})

describe('linearTrend', () => {
  it('gives the slope per day of a straight line', () => {
    const points = [0, 1, 2, 3].map(d => ({ time: d * 86_400, value: 10 + 2 * d }))

    expect(linearTrend(points).slopePerDay).toBeCloseTo(2, 6)
    expect(linearTrend(points).fittedNow).toBeCloseTo(16, 6)
  })
})

describe('forecast_capacity', () => {
  it('forecasts a local storage on the host named, with the dates at 90 and 100 %', async () => {
    const res = (await forecastCapacityTool.execute({ storage: 'zfs-pool', node: 'pve1' }, ctx())) as any

    expect(pveFetch.mock.calls[1][1]).toBe('/nodes/pve1/storage/ZFS-Pool/rrddata?timeframe=month&cf=AVERAGE')
    expect(res).toMatchObject({ target: 'ZFS-Pool (pve1)', metric: 'storage', growing: true, alreadyAbove90Pct: false })
    expect(res.trendPointsPerDay).toBeCloseTo(1, 1)
    expect(res.reaches90PctInDays).toBeGreaterThanOrEqual(10)
    expect(res.reaches100PctInDays).toBeGreaterThan(res.reaches90PctInDays)
    // The month is drawn under the answer.
    expect(chartFromToolResult('forecast_capacity', res)).toMatchObject({ kind: 'history', metric: 'storage', timeframe: 'month', series: ['used'] })
  })

  it('never forecasts a storage the storage list hides, nor the RAM of a host the caller may not view', async () => {
    perms.hiddenStorages.add('CephStoragePool')
    expect(await invokeTool(forecastCapacityTool, { storage: 'CephStoragePool' }, ctx())).toMatchObject({ ok: false, error: 'out-of-scope' })

    perms.denied.add('node.view|node|c1:pve2')
    expect(await invokeTool(forecastCapacityTool, { node: 'pve2' }, ctx())).toMatchObject({ ok: false, error: 'out-of-scope' })
    expect(pveFetch.mock.calls.every(c => c[1] === '/cluster/resources?type=storage')).toBe(true)
  })

  it('asks for the host when a local storage exists on several', async () => {
    expect(await invokeTool(forecastCapacityTool, { storage: 'ZFS-Pool' }, ctx())).toMatchObject({ ok: false, error: 'out-of-scope' })
  })

  it('reads a shared storage through a visible host only', async () => {
    const res = (await forecastCapacityTool.execute({ storage: 'CephStoragePool' }, ctx())) as any

    expect(res.target).toBe('CephStoragePool')
    expect(pveFetch.mock.calls[1][1]).toContain('/nodes/pve1/storage/CephStoragePool/')
  })

  it('forecasts the RAM of a host and says when it does not grow', async () => {
    const res = (await forecastCapacityTool.execute({ node: 'pve2' }, ctx())) as any

    expect(res).toMatchObject({ target: 'pve2', metric: 'memory', growing: false, reaches100PctInDays: null })
  })

  it('declines a trend over too short a history', async () => {
    pveFetch.mockImplementation(async (_c: unknown, path: string) => (path.includes('rrddata') ? month.slice(-48) : []))

    expect(((await forecastCapacityTool.execute({ node: 'pve1' }, ctx())) as any).note).toMatch(/too short/)
  })
})

describe('simulate_migration', () => {
  it('checks a named target against its free RAM after the reserve', async () => {
    const ok = (await simulateMigrationTool.execute({ guest: 'web-01', target: 'pve1' }, ctx())) as any

    expect(ok.target).toMatchObject({ host: 'pve1', fits: true, ramNeededGb: 4, ramFreeAfterReserveGb: 18.8, cpuOvercommitAfter: 1.5 })

    const tight = (await simulateMigrationTool.execute({ guest: 'db-01', target: 'pve2', count: 1 }, ctx())) as any

    expect(tight.target).toMatchObject({ host: 'pve2', fits: false, ramFreeAfterReserveGb: 2.8 })
  })

  it('ranks the possible hosts and leaves one in maintenance out', async () => {
    const res = (await simulateMigrationTool.execute({ guest: 'db-01' }, ctx())) as any

    expect(res.candidates.map((c: any) => c.host)).toEqual(['pve2'])
  })

  it('refuses the current host and calls nothing', async () => {
    expect(await invokeTool(simulateMigrationTool, { guest: 'db-01', target: 'pve1' }, ctx())).toMatchObject({ error: 'bad-argument' })
    expect(pveFetch).not.toHaveBeenCalled()
  })
})
