import { describe, expect, it, vi, beforeEach } from 'vitest'

const { resolvePublicRequestScopeMock, getInventorySWRMock, getTenantInfrastructureScopeMock } = vi.hoisted(() => ({
  resolvePublicRequestScopeMock: vi.fn<(p?: any) => Promise<any>>(),
  getInventorySWRMock: vi.fn<(...args: any[]) => Promise<any>>(),
  getTenantInfrastructureScopeMock: vi.fn<(t: string) => Promise<any>>(),
}))

// The entire fetchRawInventory module is replaced with ONLY the cache
// wrapper below: fetchRawInventory/blockingFetch/triggerBackgroundRevalidation
// (the functions that actually call pveFetch/pbsFetch against the
// hypervisor) are not exported by this mock at all. If loadPublicFleetView
// ever called any of them directly, that call would hit `undefined` and
// throw, not silently succeed — that is the mechanism this file relies on
// to prove property 1 (no hypervisor call at scrape time, D12).
vi.mock('./scope', () => ({ resolvePublicRequestScope: resolvePublicRequestScopeMock }))
vi.mock('@/lib/inventory/fetchRawInventory', () => ({ getInventorySWR: getInventorySWRMock }))
vi.mock('@/lib/tenant/infraScope', () => ({
  getTenantInfrastructureScope: getTenantInfrastructureScopeMock,
}))

import { loadPublicFleetView } from './publicData'

const RAW = {
  clusters: [
    {
      id: 'pve-1',
      name: 'PVE One',
      nodes: [
        {
          node: 'n1',
          status: 'online',
          cpu: 0.25,
          mem: 1000,
          maxmem: 4000,
          disk: 3000,
          maxdisk: 10000,
          uptime: 86400,
          maintenance: 'migrate',
          loadavg: [1.3, 1.27, 1.23],
          iowait: 0.02,
          swapUsed: 28672,
          swapTotal: 2550132736,
          rootfsUsed: 7818567680,
          rootfsTotal: 17983504384,
          cores: 8,
          pveVersion: 'pve-manager/9.2.11/f6997e698c7933ea',
          kernel: '7.0.2-6-pve',
          guests: [
            { vmid: 100, name: 'web', type: 'qemu', status: 'running', cpu: 0.5, mem: 500, maxmem: 2000, maxdisk: 32000, uptime: 3600, hastate: 'started', agentEnabled: true, netin: 292131298, netout: 3046818, diskread: 154857472, diskwrite: 639959040, cores: 2, memhost: 700 },
            { vmid: 900, name: 'tpl', type: 'qemu', status: 'stopped', template: 1 },
          ],
        },
        { node: 'n2', status: 'offline', guests: [] },
      ],
    },
    { id: 'pve-hidden', name: 'Hidden', nodes: [{ node: 'x', status: 'online', guests: [{ vmid: 5, type: 'qemu', status: 'running' }] }] },
  ],
  storages: [
    {
      connId: 'pve-1', connName: 'PVE One', storage: 'CephPool', type: 'rbd', shared: true,
      used: 100, total: 1000, enabled: true,
      nodeBreakdown: [{ node: 'n1', used: 100, total: 1000 }],
    },
    {
      connId: 'pve-1', connName: 'PVE One', storage: 'local', type: 'dir', shared: false,
      used: 30, total: 90, enabled: true,
      nodeBreakdown: [{ node: 'n1', used: 10, total: 30 }, { node: 'n2', used: 20, total: 60 }],
    },
    {
      connId: 'pve-hidden', connName: 'Hidden', storage: 'secret', type: 'dir', shared: false,
      used: 1, total: 2, enabled: true, nodeBreakdown: [{ node: 'x', used: 1, total: 2 }],
    },
  ],
  pbsServers: [
    {
      id: 'pbs-1', name: 'PBS One', type: 'pbs', status: 'online', version: '4.2.1',
      datastores: [
        { name: 'S3manu', total: 0, used: 4096, available: 0, usagePercent: 12.5, backupCount: 7, vmCount: 3, ctCount: 1, hostCount: 0 },
      ],
      stats: { totalSize: 0, totalUsed: 4096, datastoreCount: 1, backupCount: 7 },
    },
    {
      id: 'pbs-hidden', name: 'PBS Hidden', type: 'pbs', status: 'online', version: '4.2.1',
      datastores: [{ name: 'secret', total: 10, used: 1, available: 9, usagePercent: 10, backupCount: 1, vmCount: 1, ctCount: 0, hostCount: 0 }],
      stats: { totalSize: 10, totalUsed: 1, datastoreCount: 1, backupCount: 1 },
    },
  ],
  externalHypervisors: [],
  stats: {
    totalClusters: 2, totalNodes: 3, totalGuests: 2, onlineNodes: 2,
    runningGuests: 1, totalPbsServers: 0, totalDatastores: 0, totalBackups: 0,
  },
}

beforeEach(() => {
  // resetAllMocks (not clearAllMocks): clearAllMocks only wipes call history,
  // it leaves a prior mockImplementation/mockResolvedValue in place, which
  // has already produced a false-green test elsewhere on this chantier.
  // resetAllMocks wipes the implementation too, so every default below is
  // re-established explicitly and nothing bleeds in from another test.
  vi.resetAllMocks()
  resolvePublicRequestScopeMock.mockResolvedValue({ tenantId: 'default', visible: new Set(['pve-1', 'pbs-1']) })
  getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'provider' })
  getInventorySWRMock.mockResolvedValue({ raw: RAW, cached: true })
})

describe('loadPublicFleetView', () => {
  it('filters clusters by the token perimeter and flattens nodes and guests', async () => {
    const view = await loadPublicFleetView({ kind: 'token', tenantId: 'default', connectionIds: ['pve-1'] } as any)
    expect(view.tenantId).toBe('default')
    expect(view.clusters.map(c => c.id)).toEqual(['pve-1'])
    expect(view.nodes).toEqual([
      {
        connId: 'pve-1', connectionName: 'PVE One', node: 'n1', status: 'online', cpu: 0.25, mem: 1000, maxmem: 4000,
        disk: 3000, maxdisk: 10000, uptime: 86400, maintenance: true,
        load1: 1.3, load5: 1.27, load15: 1.23, iowait: 0.02,
        swapUsed: 28672, swapTotal: 2550132736, rootfsUsed: 7818567680, rootfsTotal: 17983504384,
        cores: 8, pveVersion: '9.2.11', kernel: '7.0.2-6-pve',
      },
      {
        connId: 'pve-1', connectionName: 'PVE One', node: 'n2', status: 'offline', cpu: 0, mem: 0, maxmem: 0,
        disk: 0, maxdisk: 0, uptime: 0, maintenance: false,
        load1: 0, load5: 0, load15: 0, iowait: 0,
        swapUsed: 0, swapTotal: 0, rootfsUsed: 0, rootfsTotal: 0,
        cores: 0, pveVersion: null, kernel: null,
      },
    ])
    expect(view.guests).toHaveLength(1)
    expect(view.guests[0]).toEqual({
      connId: 'pve-1', connectionName: 'PVE One', node: 'n1', vmid: '100', name: 'web', type: 'qemu',
      status: 'running', cpu: 0.5, mem: 500, maxmem: 2000, maxdisk: 32000, uptime: 3600, hastate: 'started',
      agentEnabled: true, template: false,
      netIn: 292131298, netOut: 3046818, diskRead: 154857472, diskWritten: 639959040,
      cores: 2, memHost: 700,
    })
    expect(view.cached).toBe(true)
    expect(view.visible).toEqual(new Set(['pve-1', 'pbs-1']))
  })

  it('carries the VM name through: Task 17 must be able to label proxcenter_vm_* series without re-walking clusters', async () => {
    const view = await loadPublicFleetView({ kind: 'token', tenantId: 'default', connectionIds: ['pve-1'] } as any)
    expect(view.guests[0].name).toBe('web')
  })

  it('falls back to type/vmid when a guest has no name, same convention as fetchRawInventory', async () => {
    getInventorySWRMock.mockResolvedValue({
      raw: {
        ...RAW,
        clusters: [
          {
            id: 'pve-1',
            name: 'PVE One',
            nodes: [{ node: 'n1', status: 'online', guests: [{ vmid: 42, type: 'lxc', status: 'running' }] }],
          },
        ],
      },
      cached: true,
    })
    const view = await loadPublicFleetView({ kind: 'token', tenantId: 'default', connectionIds: ['pve-1'] } as any)
    expect(view.guests[0].name).toBe('lxc/42')
  })

  it('reports agentEnabled as null (unknown), never a fabricated false, when the source data carries no flag at all', async () => {
    getInventorySWRMock.mockResolvedValue({
      raw: {
        ...RAW,
        clusters: [
          {
            id: 'pve-1',
            name: 'PVE One',
            // No `agentEnabled` key at all: the realistic shape from
            // fetchRawInventory, which reads /cluster/resources and never
            // sets this field (fetchRawInventory.ts:270-285).
            nodes: [{ node: 'n1', status: 'online', guests: [{ vmid: 7, type: 'qemu', status: 'running', name: 'noflag' }] }],
          },
        ],
      },
      cached: true,
    })
    const view = await loadPublicFleetView({ kind: 'token', tenantId: 'default', connectionIds: ['pve-1'] } as any)
    expect(view.guests[0].agentEnabled).toBeNull()
  })

  it('reports agentEnabled as a genuine false when the source data explicitly says so, distinct from unknown', async () => {
    getInventorySWRMock.mockResolvedValue({
      raw: {
        ...RAW,
        clusters: [
          {
            id: 'pve-1',
            name: 'PVE One',
            nodes: [{ node: 'n1', status: 'online', guests: [{ vmid: 8, type: 'qemu', status: 'running', name: 'off', agentEnabled: false }] }],
          },
        ],
      },
      cached: true,
    })
    const view = await loadPublicFleetView({ kind: 'token', tenantId: 'default', connectionIds: ['pve-1'] } as any)
    expect(view.guests[0].agentEnabled).toBe(false)
  })

  it('never calls the hypervisor: it only reads the inventory cache wrapper, without forcing a refresh, and never blocks a scrape on a cold cache (D12)', async () => {
    await loadPublicFleetView({ kind: 'token', tenantId: 'default', connectionIds: null } as any)
    // Exact-arity match: forceRefresh (3rd arg) MUST be false — `true`
    // would defeat the whole point of the cache wrapper and hammer the
    // hypervisor on every 15s scrape. nonBlocking (4th arg) MUST be true —
    // D12: a scrape must also never wait on a cold-cache fan-out. vdcContext
    // (5th arg) MUST be null — the token path always reads the union cache
    // key, never a view-context-narrowed one.
    // toHaveBeenCalledWith fails on any extra, missing, or wrong argument.
    expect(getInventorySWRMock).toHaveBeenCalledWith('default', { kind: 'provider' }, false, true, null)
    expect(getInventorySWRMock).toHaveBeenCalledTimes(1)
    // Union infra, never the view context, for an API-token caller.
    expect(getTenantInfrastructureScopeMock).toHaveBeenCalledWith('default', { ignoreVdcContext: true })
  })

  it('works for a session caller with no principal', async () => {
    resolvePublicRequestScopeMock.mockResolvedValue({ tenantId: 'default', visible: new Set(['pve-1', 'pve-hidden']) })
    const view = await loadPublicFleetView(undefined)
    expect(view.clusters).toHaveLength(2)
  })

  it('drops every cluster when the visible set is empty: the filter is load-bearing, not decorative', async () => {
    resolvePublicRequestScopeMock.mockResolvedValue({ tenantId: 'default', visible: new Set() })
    const view = await loadPublicFleetView({ kind: 'token', tenantId: 'default', connectionIds: [] } as any)
    expect(view.clusters).toEqual([])
    expect(view.nodes).toEqual([])
    expect(view.guests).toEqual([])
  })

  it('excludes a template guest even when it is alone on its node: guests end up empty, not just short one entry', async () => {
    getInventorySWRMock.mockResolvedValue({
      raw: {
        ...RAW,
        clusters: [
          {
            id: 'pve-1',
            name: 'PVE One',
            nodes: [{ node: 'n1', status: 'online', guests: [{ vmid: 900, type: 'qemu', status: 'stopped', template: true }] }],
          },
        ],
      },
      cached: false,
    })
    const view = await loadPublicFleetView({ kind: 'token', tenantId: 'default', connectionIds: ['pve-1'] } as any)
    expect(view.guests).toEqual([])
    expect(view.nodes).toHaveLength(1)
  })

  it('passes through cached:false unchanged', async () => {
    getInventorySWRMock.mockResolvedValue({ raw: RAW, cached: false })
    const view = await loadPublicFleetView({ kind: 'token', tenantId: 'default', connectionIds: ['pve-1'] } as any)
    expect(view.cached).toBe(false)
  })
})

describe('loadPublicFleetView, widened projections (#925)', () => {
  it('carries the node capacity, uptime and maintenance fields the exposition needs', async () => {
    const view = await loadPublicFleetView(undefined)
    expect(view.nodes.find(node => node.node === 'n1')).toMatchObject({
      disk: 3000, maxdisk: 10000, uptime: 86400, maintenance: true,
    })
    expect(view.nodes.find(node => node.node === 'n2')).toMatchObject({
      disk: 0, maxdisk: 0, uptime: 0, maintenance: false,
    })
  })

  /**
   * `maintenance` is projected as a BOOLEAN, never the raw string: the raw
   * value is a free-form Proxmox mode name, so letting it through would
   * hand an unbounded label value to `proxcenter_node_maintenance`.
   */
  it('reduces the maintenance mode to a boolean rather than leaking the raw mode name', async () => {
    const view = await loadPublicFleetView(undefined)
    expect(view.nodes.find(node => node.node === 'n1')?.maintenance).toBe(true)
  })

  it('carries the guest capacity, uptime and HA state', async () => {
    const view = await loadPublicFleetView(undefined)
    expect(view.guests[0]).toMatchObject({ maxdisk: 32000, uptime: 3600, hastate: 'started' })
  })

  it('leaves hastate null rather than inventing a state for a guest HA does not manage', async () => {
    getInventorySWRMock.mockResolvedValue({
      raw: {
        ...RAW,
        clusters: [
          {
            id: 'pve-1',
            name: 'PVE One',
            nodes: [{ node: 'n1', status: 'online', guests: [{ vmid: 1, type: 'qemu', status: 'running' }] }],
          },
        ],
      },
      cached: true,
    })
    const view = await loadPublicFleetView(undefined)
    expect(view.guests[0].hastate).toBeNull()
  })

  /**
   * The PBS filter is a TENANT BOUNDARY, not a display filter. A projection
   * that accepts the perimeter and never reads it is exactly the
   * resolveVisibleConnectionIds bug this chantier already shipped once, so
   * `pbs-hidden` sits in the fixture purely to fail that regression.
   */
  it('projects PBS servers and filters them on the tenant perimeter', async () => {
    const view = await loadPublicFleetView(undefined)
    expect(view.pbsServers.map(server => server.connectionName)).toEqual(['PBS One'])
    expect(view.pbsServers[0]).toMatchObject({ connId: 'pbs-1', status: 'online', version: '4.2.1' })
  })

  it('projects every datastore field the PBS families need, including a zero capacity', async () => {
    const view = await loadPublicFleetView(undefined)
    expect(view.pbsServers[0].datastores[0]).toEqual({
      name: 'S3manu', total: 0, used: 4096, available: 0, usagePercent: 12.5,
      backupCount: 7, vmCount: 3, ctCount: 1, hostCount: 0,
    })
  })

  it('reports a version-less PBS server as null rather than an empty string', async () => {
    getInventorySWRMock.mockResolvedValue({
      raw: { ...RAW, pbsServers: [{ id: 'pbs-1', name: 'PBS One', type: 'pbs', status: 'offline', datastores: [] }] },
      cached: true,
    })
    const view = await loadPublicFleetView(undefined)
    expect(view.pbsServers[0].version).toBeNull()
    expect(view.pbsServers[0].datastores).toEqual([])
  })
})

describe('loadPublicFleetView, node status and guest counters (#925)', () => {
  it('parses the load average, which Proxmox sends as an array of strings', async () => {
    const view = await loadPublicFleetView(undefined)
    const n1 = view.nodes.find(node => node.node === 'n1')
    expect(n1).toMatchObject({ load1: 1.3, load5: 1.27, load15: 1.23 })
    expect(typeof n1?.load1).toBe('number')
  })

  /**
   * The raw value is `pve-manager/9.2.11/<commit>`. Carrying the commit into a
   * metric label would churn it on every point release rebuild, for no gain.
   */
  it('keeps only the version number out of the pve-manager string', async () => {
    const view = await loadPublicFleetView(undefined)
    expect(view.nodes.find(node => node.node === 'n1')?.pveVersion).toBe('9.2.11')
  })

  it('carries the four cumulative counters off cluster/resources', async () => {
    const view = await loadPublicFleetView(undefined)
    expect(view.guests[0]).toMatchObject({
      netIn: 292131298, netOut: 3046818, diskRead: 154857472, diskWritten: 639959040,
    })
  })

  it('defaults every new field to 0 rather than undefined, so a ratio never divides by NaN', async () => {
    const view = await loadPublicFleetView(undefined)
    const n2 = view.nodes.find(node => node.node === 'n2')
    for (const value of [n2?.load1, n2?.iowait, n2?.swapTotal, n2?.rootfsTotal, n2?.cores]) {
      expect(Number.isFinite(value)).toBe(true)
    }
  })
})

describe('loadPublicFleetView, storages (#925)', () => {
  it('projects the aggregated storages and filters them on the tenant perimeter', async () => {
    const view = await loadPublicFleetView(undefined)
    expect(view.storages.map(s => s.storage)).toEqual(['CephPool', 'local'])
  })

  /**
   * The point of reusing aggregateStorage upstream: a shared storage arrives
   * already collapsed to ONE entry, so summing `total` across the view cannot
   * triple an RBD pool that appears once per node in the raw Proxmox data.
   */
  it('carries a shared storage once, with its own capacity, not once per node', async () => {
    const view = await loadPublicFleetView(undefined)
    const ceph = view.storages.find(s => s.storage === 'CephPool')
    expect(ceph).toMatchObject({ shared: true, used: 100, total: 1000 })
    expect(ceph?.nodes).toHaveLength(1)
  })

  it('keeps the per-node breakdown of a local storage, which is where it means something', async () => {
    const view = await loadPublicFleetView(undefined)
    const local = view.storages.find(s => s.storage === 'local')
    expect(local).toMatchObject({ shared: false, used: 30, total: 90 })
    expect(local?.nodes).toEqual([
      { node: 'n1', used: 10, total: 30 },
      { node: 'n2', used: 20, total: 60 },
    ])
  })
})
