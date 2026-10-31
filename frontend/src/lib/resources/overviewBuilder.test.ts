import { beforeEach, describe, expect, it, vi } from 'vitest'

const { pveFetchMock, upsertMock, historyMock, getSettingMock } = vi.hoisted(() => ({
  pveFetchMock: vi.fn(),
  upsertMock: vi.fn(),
  historyMock: vi.fn(),
  getSettingMock: vi.fn(),
}))

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: unknown[]) => pveFetchMock(...a) }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: async (id: string) => ({ id }) }))
vi.mock('@/lib/db/prisma', () => ({
  prisma: { healthScoreHistory: { upsert: (...a: unknown[]) => upsertMock(...a), findMany: (...a: unknown[]) => historyMock(...a) } },
}))
vi.mock('@/lib/db/settings', () => ({ getSetting: (...a: unknown[]) => getSettingMock(...a) }))
vi.mock('@/lib/db/datacenters', () => ({
  ensureDefaultDatacenter: async () => ({
    pue: 1.5, electricityPrice: 0.2, currency: 'EUR', co2Factor: 0.05, co2CountryPreset: null,
    tdpPerCoreW: 10, wattsPerGbRam: 0.4, overheadPerNodeW: 50,
  }),
}))

import { getResourcesOverview, type OverviewRequest } from './overviewBuilder'

const GiB = 1024 ** 3
const DAY = 86_400

// 40 days of node history, RAM rising from 40 % to 59.5 %.
const nodeRrd = (maxmem: number) => Array.from({ length: 40 }, (_, i) => ({
  time: Math.floor(Date.now() / 1000) - (39 - i) * DAY,
  cpu: 0.2,
  memused: maxmem * (0.4 + i * 0.005),
  memtotal: maxmem,
  netin: 1000,
  netout: 2000,
}))
const storageRrd = (total: number, pct: number) => Array.from({ length: 40 }, (_, i) => ({
  time: Math.floor(Date.now() / 1000) - (39 - i) * DAY,
  used: total * pct,
  total,
}))

const PVE: Record<string, Record<string, unknown>> = {
  prod: {
    '/nodes': [
      { node: 'pve1', status: 'online', cpu: 0.2, maxcpu: 16, mem: 40 * GiB, maxmem: 64 * GiB },
      { node: 'pve2', status: 'online', cpu: 0.1, maxcpu: 16, mem: 20 * GiB, maxmem: 64 * GiB },
      { node: 'pve3', status: 'offline', maxcpu: 16, maxmem: 64 * GiB },
    ],
    '/cluster/resources?type=vm': [
      { vmid: 101, name: 'web', node: 'pve1', type: 'qemu', status: 'running', cpu: 0.01, maxcpu: 8, mem: 1 * GiB, maxmem: 16 * GiB, maxdisk: 10 * GiB },
      { vmid: 102, name: 'db', node: 'pve2', type: 'lxc', status: 'running', cpu: 0.5, maxcpu: 2, mem: 3 * GiB, maxmem: 4 * GiB, maxdisk: 10 * GiB },
      { vmid: 200, name: 'old-erp', node: 'pve2', type: 'qemu', status: 'stopped', maxcpu: 4, maxmem: 48 * GiB, maxdisk: 100 * GiB },
      { vmid: 201, name: 'small', node: 'pve1', type: 'qemu', status: 'stopped', maxcpu: 1, maxmem: 2 * GiB, maxdisk: 10 * GiB },
      { vmid: 9000, name: 'tpl', node: 'pve1', type: 'qemu', status: 'stopped', template: 1, maxcpu: 2, maxmem: 64 * GiB, maxdisk: 10 * GiB },
    ],
    '/cluster/resources?type=storage': [
      { storage: 'ceph', node: 'pve1', status: 'available', shared: 1, disk: 500 * GiB, maxdisk: 1000 * GiB, plugintype: 'rbd' },
      { storage: 'ceph', node: 'pve2', status: 'available', shared: 1, disk: 500 * GiB, maxdisk: 1000 * GiB, plugintype: 'rbd' },
      { storage: 'local', node: 'pve1', status: 'available', shared: 0, disk: 10 * GiB, maxdisk: 100 * GiB, plugintype: 'dir' },
      { storage: 'local', node: 'pve2', status: 'available', shared: 0, disk: 90 * GiB, maxdisk: 100 * GiB, plugintype: 'dir' },
    ],
  },
  dr: {
    '/nodes': [{ node: 'pve1', status: 'online', cpu: 0.05, maxcpu: 8, mem: 8 * GiB, maxmem: 32 * GiB }],
    '/cluster/resources?type=vm': [
      { vmid: 300, name: 'replica', node: 'pve1', type: 'qemu', status: 'running', cpu: 0.02, maxcpu: 4, mem: 2 * GiB, maxmem: 8 * GiB, maxdisk: 10 * GiB },
    ],
    '/cluster/resources?type=storage': [
      { storage: 'local', node: 'pve1', status: 'available', shared: 0, disk: 20 * GiB, maxdisk: 100 * GiB, plugintype: 'dir' },
    ],
  },
}

function fakePve(conn: { id: string }, path: string) {
  const fixed = PVE[conn.id]?.[path]
  if (fixed) return Promise.resolve(fixed)

  const node = /^\/nodes\/([^/]+)\/rrddata/.exec(path)
  if (node) return Promise.resolve(nodeRrd((PVE[conn.id]['/nodes'] as Array<{ node: string; maxmem: number }>).find(n => n.node === node[1])!.maxmem))

  const storage = /^\/nodes\/([^/]+)\/storage\/([^/]+)\/rrddata/.exec(path)
  if (storage) return Promise.resolve(storageRrd(storage[2] === 'ceph' ? 1000 * GiB : 100 * GiB, 0.5))

  return Promise.reject(new Error(`unexpected ${path}`))
}

let tenant = 0
const request = (overrides: Partial<OverviewRequest> = {}): OverviewRequest => ({
  prisma: { connection: { findMany: async () => [{ id: 'prod', name: 'PVE-PROD' }, { id: 'dr', name: 'PVE-DR' }] } },
  // A tenant per test: the overview cache lives at module level.
  tenantId: `tenant-${++tenant}`,
  dateLocale: 'en-US',
  ...overrides,
})

const storageRrdCalls = (conn: string, storage: string) => pveFetchMock.mock.calls
  .filter(([c, path]) => (c as { id: string }).id === conn && String(path).includes(`/storage/${storage}/rrddata`))

beforeEach(() => {
  pveFetchMock.mockReset().mockImplementation(fakePve)
  upsertMock.mockReset().mockResolvedValue({})
  historyMock.mockReset().mockResolvedValue([{ date: '2026-10-30_prod', score: 80, cpuPct: 10, ramPct: 50, storagePct: 40 }])
  getSettingMock.mockReset().mockResolvedValue(null)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('getResourcesOverview', () => {
  it('builds the capacity model of every cluster from one round of reads', async () => {
    const { data } = await getResourcesOverview(request())

    expect(data.clusters.map((c: { name: string }) => c.name)).toEqual(['PVE-DR', 'PVE-PROD'])
    expect(data.nodes.map((n: { connectionId: string; node: string }) => `${n.connectionId}:${n.node}`)).toEqual(['prod:pve1', 'prod:pve2', 'prod:pve3', 'dr:pve1'])
    // A shared storage is read once per cluster, a local one once per node.
    expect(storageRrdCalls('prod', 'ceph')).toHaveLength(1)
    expect(storageRrdCalls('prod', 'local')).toHaveLength(2)
    expect(data.storagePools.filter((p: { name: string }) => p.name === 'ceph')).toHaveLength(1)
    // Every trend point carries its ISO day, cluster trends too.
    expect(data.trends.every((p: { d?: string }) => /^\d{4}-\d{2}-\d{2}$/.test(p.d ?? ''))).toBe(true)
    expect(data.clusters[1].trends.length).toBeGreaterThan(30)
  })

  it('leaves templates out of the guest counts and lists the largest stopped guests', async () => {
    const { data } = await getResourcesOverview(request())

    expect(data.kpis.vms).toEqual({ total: 5, running: 3, stopped: 2 })
    expect(data.stoppedAllocation).toEqual({ count: 2, vcpu: 5, ramBytes: 50 * GiB, diskBytes: 110 * GiB })
    expect(data.largestStopped[0]).toEqual({ id: 'prod:qemu:pve2:200', name: 'old-erp', node: 'pve2', connName: 'PVE-PROD', vcpu: 4, ramBytes: 48 * GiB })
  })

  it('keeps the allocation of two nodes with the same name in two clusters apart', async () => {
    const { data } = await getResourcesOverview(request())
    const pve1 = data.overprovisioning.perNode.filter((n: { name: string }) => n.name === 'pve1')

    expect(pve1.map((n: { connectionId: string; cpuAllocated: number }) => [n.connectionId, n.cpuAllocated]).sort()).toEqual([['dr', 4], ['prod', 8]])
  })

  it('names each oversized guest with its id and cluster', async () => {
    const { data } = await getResourcesOverview(request())
    const web = data.overprovisioning.topOverprovisioned.find((v: { name: string }) => v.name === 'web')

    expect(web).toMatchObject({ id: 'prod:qemu:pve1:101', connName: 'PVE-PROD' })
  })

  it('records the score of the whole estate and of each cluster from the global view', async () => {
    await getResourcesOverview(request({ tenantId: 'tenant-snap' }))
    const dates = upsertMock.mock.calls.map(([args]) => (args as { create: { date: string; connectionId: string | null } }).create)

    expect(dates.map(d => d.connectionId).sort()).toEqual([null, 'dr', 'prod'].sort())
    expect(upsertMock.mock.calls[0][0].where.tenantId_date.tenantId).toBe('tenant-snap')
  })

  it('records only its own score from a cluster view, and returns its history', async () => {
    const { data } = await getResourcesOverview(request({ filterConnectionId: 'prod' }))

    expect(upsertMock).toHaveBeenCalledTimes(1)
    expect(upsertMock.mock.calls[0][0].create).toMatchObject({ connectionId: 'prod' })
    expect(data.clusters.map((c: { id: string }) => c.id)).toEqual(['prod'])
    expect(data.healthScoreHistory).toEqual([{ date: '2026-10-30', score: 80, cpu: 10, ram: 50, storage: 40 }])
  })

  it('answers empty, without a snapshot, for a connection that is not one of the tenant', async () => {
    const { data } = await getResourcesOverview(request({ filterConnectionId: 'someone-else' }))

    expect(data.clusters).toEqual([])
    expect(data.connections).toEqual([{ id: 'prod', name: 'PVE-PROD' }, { id: 'dr', name: 'PVE-DR' }])
    expect(pveFetchMock).not.toHaveBeenCalled()
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('serves the same scope from its cache for a minute', async () => {
    const req = request()

    await getResourcesOverview(req)
    const calls = pveFetchMock.mock.calls.length
    await getResourcesOverview(req)

    expect(pveFetchMock.mock.calls).toHaveLength(calls)
  })

  it('still answers when the score snapshot cannot be written', async () => {
    upsertMock.mockRejectedValue(new Error('db down'))

    const { data } = await getResourcesOverview(request())

    expect(upsertMock).toHaveBeenCalled()
    expect(data.clusters).toHaveLength(2)
  })
})
