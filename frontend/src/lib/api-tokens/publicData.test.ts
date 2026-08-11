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
          guests: [
            { vmid: 100, name: 'web', type: 'qemu', status: 'running', cpu: 0.5, mem: 500, maxmem: 2000, agentEnabled: true },
            { vmid: 900, name: 'tpl', type: 'qemu', status: 'stopped', template: 1 },
          ],
        },
        { node: 'n2', status: 'offline', guests: [] },
      ],
    },
    { id: 'pve-hidden', name: 'Hidden', nodes: [{ node: 'x', status: 'online', guests: [{ vmid: 5, type: 'qemu', status: 'running' }] }] },
  ],
  pbsServers: [],
  externalHypervisors: [],
  storages: [],
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
  resolvePublicRequestScopeMock.mockResolvedValue({ tenantId: 'default', visible: new Set(['pve-1']) })
  getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'provider' })
  getInventorySWRMock.mockResolvedValue({ raw: RAW, cached: true })
})

describe('loadPublicFleetView', () => {
  it('filters clusters by the token perimeter and flattens nodes and guests', async () => {
    const view = await loadPublicFleetView({ kind: 'token', tenantId: 'default', connectionIds: ['pve-1'] } as any)
    expect(view.tenantId).toBe('default')
    expect(view.clusters.map(c => c.id)).toEqual(['pve-1'])
    expect(view.nodes).toEqual([
      { connId: 'pve-1', connectionName: 'PVE One', node: 'n1', status: 'online', cpu: 0.25, mem: 1000, maxmem: 4000 },
      { connId: 'pve-1', connectionName: 'PVE One', node: 'n2', status: 'offline', cpu: 0, mem: 0, maxmem: 0 },
    ])
    expect(view.guests).toHaveLength(1)
    expect(view.guests[0]).toEqual({
      connId: 'pve-1', connectionName: 'PVE One', node: 'n1', vmid: '100', name: 'web', type: 'qemu',
      status: 'running', cpu: 0.5, mem: 500, maxmem: 2000, agentEnabled: true, template: false,
    })
    expect(view.cached).toBe(true)
    expect(view.visible).toEqual(new Set(['pve-1']))
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
