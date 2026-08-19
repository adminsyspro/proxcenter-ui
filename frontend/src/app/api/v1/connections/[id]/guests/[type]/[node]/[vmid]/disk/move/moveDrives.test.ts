/**
 * Task 12: move-disk route hardening (spec §5.3 / §6).
 *  - Preflight: target `storage` must be an authorised storage for iaas
 *    tenants, checked before any PVE call. Node authorisation reuses
 *    resolveVdcForTenant (NODE_NOT_AUTHORIZED -> 403).
 *  - Metering: the live config's `size=` option on the moved disk is read
 *    and passed to checkVdcQuota, keyed by the TARGET storage.
 *    addStorageMb tracks net usage: 0 when deleteSource removes the old
 *    copy, the full size otherwise (both copies briefly coexist).
 *  - Post-move: a dedicated after() block restamps QoS onto the moved
 *    disk once the move task completes (qemu only), since PVE carries over
 *    the OLD storage's QoS options across a move.
 *  - Provider tenants: unchanged behaviour, no vDC guard side effects.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute } from '@/__tests__/setup/route-test'

// Capture the after() callbacks so the test can drive the post-move work.
const h = vi.hoisted(() => ({
  afterCbs: [] as Array<() => Promise<void>>,
}))

vi.mock('next/server', async (io) => {
  const actual = await io<typeof import('next/server')>()
  return { ...actual, after: (fn: () => Promise<void>) => { h.afterCbs.push(fn) } }
})

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const getConnectionByIdMock = vi.fn<(id: string) => Promise<any>>()
const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()
const resolveVdcForTenantMock = vi.fn<(...args: any[]) => Promise<any>>()
const checkVdcQuotaMock = vi.fn<(...args: any[]) => Promise<any>>()
const waitForTaskMock = vi.fn<(...args: any[]) => Promise<any>>()
const getTenantInfrastructureScopeMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  buildVmResourceId: () => 'res',
  PERMISSIONS: { VM_CONFIG: 'vm.config' },
}))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: getConnectionByIdMock }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: async () => 'tenant-1' }))
vi.mock('@/lib/tenant/infraScope', () => ({
  getTenantInfrastructureScope: (...a: any[]) => getTenantInfrastructureScopeMock(...a),
}))
vi.mock('@/lib/vdc/quota', () => ({
  resolveVdcForTenant: resolveVdcForTenantMock,
  checkVdcQuota: checkVdcQuotaMock,
}))
vi.mock('@/lib/proxmox/tasks', () => ({ waitForTask: waitForTaskMock }))
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }))

async function loadPost() {
  const mod = await import('./route')
  return mod.POST as Parameters<typeof callRoute>[0]
}

const baseParams = { id: 'conn-1', type: 'qemu', node: 'pve3', vmid: '100' }

const gold = { policyId: 'p-gold', name: 'Gold', iopsRd: 5000, iopsWr: 4000, mbpsRd: 500, mbpsWr: null }

/** iaas union scope with the given per-connection allowed storages + tier policies. */
function iaasScope(storages: string[], policies: Record<string, typeof gold> = {}) {
  return {
    kind: 'iaas',
    vdcScope: {
      storagesByConnection: new Map([['conn-1', new Set(storages)]]),
      storagePoliciesByConnection: new Map([['conn-1', new Map(Object.entries(policies))]]),
    },
  }
}

beforeEach(() => {
  h.afterCbs.length = 0
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getConnectionByIdMock.mockReset().mockResolvedValue({ id: 'conn-1' })
  resolveVdcForTenantMock.mockReset().mockResolvedValue(null)
  checkVdcQuotaMock.mockReset().mockResolvedValue({ allowed: true })
  waitForTaskMock.mockReset().mockResolvedValue(undefined)
  getTenantInfrastructureScopeMock.mockReset().mockResolvedValue({ kind: 'provider' })
  // Default: config reads return an empty config, move POST returns a UPID.
  pveFetchMock.mockReset().mockImplementation(async (_conn, _path, opts?: any) => {
    if (opts?.method === 'POST') return 'UPID:move:1'
    if (opts?.method === 'PUT') return null
    return {}
  })
})

describe('POST disk/move: target storage scope (spec §6)', () => {
  it('403: an out-of-scope target storage never reaches the PVE move call', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasScope(['ceph-nvme', 'ceph-hdd']))
    const POST = await loadPost()
    const res = await callRoute(POST, {
      params: baseParams,
      body: { disk: 'scsi0', storage: 'local-lvm', deleteSource: true },
    })
    expect(res.status).toBe(403)
    const json = (await res.json()) as { error: string }
    expect(json.error).toContain('local-lvm')
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('403: node not authorised for the vDC (NODE_NOT_AUTHORIZED)', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasScope(['ceph-nvme']))
    resolveVdcForTenantMock.mockRejectedValue(new Error('NODE_NOT_AUTHORIZED'))
    const POST = await loadPost()
    const res = await callRoute(POST, {
      params: baseParams,
      body: { disk: 'scsi0', storage: 'ceph-nvme', deleteSource: true },
    })
    expect(res.status).toBe(403)
    const json = (await res.json()) as { error: string }
    expect(json.error).toMatch(/not authorized/i)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })
})

describe('POST disk/move: tier metering (spec §6)', () => {
  const liveConfig = { scsi0: 'ceph-hdd:vm-100-disk-0,size=32G' }

  it('deleteSource true: addStorageMb is 0 (net usage), addStorageMbByStorage keyed by target', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasScope(['ceph-nvme', 'ceph-hdd']))
    resolveVdcForTenantMock.mockResolvedValue({ poolName: 'pool-x', quota: null, storagePolicies: [] })
    pveFetchMock.mockImplementation(async (_conn, path: string, opts?: any) => {
      if (opts?.method === 'POST') return 'UPID:move:1'
      if (opts?.method === 'PUT') return null
      if (String(path).endsWith('/qemu/100/config')) return liveConfig
      return {}
    })

    const POST = await loadPost()
    const res = await callRoute(POST, {
      params: baseParams,
      body: { disk: 'scsi0', storage: 'ceph-nvme', deleteSource: true },
    })
    expect(res.status).toBe(200)

    expect(checkVdcQuotaMock).toHaveBeenCalled()
    const operation = checkVdcQuotaMock.mock.calls[0][3]
    expect(operation.addStorageMb).toBe(0)
    expect(operation.addStorageMbByStorage).toEqual({ 'ceph-nvme': 32768 })
  })

  it('deleteSource false: addStorageMb equals the disk size (both copies briefly coexist)', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasScope(['ceph-nvme', 'ceph-hdd']))
    resolveVdcForTenantMock.mockResolvedValue({ poolName: 'pool-x', quota: null, storagePolicies: [] })
    pveFetchMock.mockImplementation(async (_conn, path: string, opts?: any) => {
      if (opts?.method === 'POST') return 'UPID:move:1'
      if (opts?.method === 'PUT') return null
      if (String(path).endsWith('/qemu/100/config')) return liveConfig
      return {}
    })

    const POST = await loadPost()
    const res = await callRoute(POST, {
      params: baseParams,
      body: { disk: 'scsi0', storage: 'ceph-nvme', deleteSource: false },
    })
    expect(res.status).toBe(200)

    const operation = checkVdcQuotaMock.mock.calls[0][3]
    expect(operation.addStorageMb).toBe(32768)
    expect(operation.addStorageMbByStorage).toEqual({ 'ceph-nvme': 32768 })
  })

  it('409: quota exceeded on the target tier blocks the move (no PVE move POST)', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasScope(['ceph-nvme', 'ceph-hdd']))
    resolveVdcForTenantMock.mockResolvedValue({ poolName: 'pool-x', quota: null, storagePolicies: [] })
    checkVdcQuotaMock.mockResolvedValue({ allowed: false, violations: ['ceph-nvme tier full'] })
    pveFetchMock.mockImplementation(async (_conn, path: string, opts?: any) => {
      if (opts?.method === 'POST') return 'UPID:move:1'
      if (opts?.method === 'PUT') return null
      if (String(path).endsWith('/qemu/100/config')) return liveConfig
      return {}
    })

    const POST = await loadPost()
    const res = await callRoute(POST, {
      params: baseParams,
      body: { disk: 'scsi0', storage: 'ceph-nvme', deleteSource: true },
    })
    expect(res.status).toBe(409)
    const moveCall = pveFetchMock.mock.calls.find((c) => String(c[1]).endsWith('/move_disk'))
    expect(moveCall).toBeUndefined()
  })
})

describe('POST disk/move: post-move QoS restamp (spec §6)', () => {
  it('restamps the moved disk with the TARGET tier caps (PUT captured)', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasScope(['ceph-nvme'], { 'ceph-nvme': gold }))
    resolveVdcForTenantMock.mockResolvedValue(null) // no vDC quota needed for this assertion
    pveFetchMock.mockImplementation(async (_conn, path: string, opts?: any) => {
      if (opts?.method === 'POST') return 'UPID:move:1'
      if (opts?.method === 'PUT') return null
      if (String(path).endsWith('/qemu/100/config')) return { scsi0: 'ceph-nvme:vm-100-disk-0' }
      return {}
    })

    const POST = await loadPost()
    const res = await callRoute(POST, {
      params: baseParams,
      body: { disk: 'scsi0', storage: 'ceph-nvme', deleteSource: true },
    })
    expect(res.status).toBe(200)

    expect(h.afterCbs.length).toBeGreaterThan(0)
    for (const cb of h.afterCbs) await cb()

    expect(waitForTaskMock).toHaveBeenCalledWith({ id: 'conn-1' }, 'pve3', 'UPID:move:1')

    const putCall = pveFetchMock.mock.calls.find(
      (c) => String(c[1]).endsWith('/qemu/100/config') && c[2]?.method === 'PUT',
    )
    expect(putCall).toBeTruthy()
    const patch = new URLSearchParams(String(putCall?.[2]?.body))
    expect(patch.get('scsi0')).toBe('ceph-nvme:vm-100-disk-0,iops_rd=5000,iops_wr=4000,mbps_rd=500')
  })

  it('target storage has no tier policy: no after() scheduled, no extra PUT', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasScope(['ceph-hdd']))
    resolveVdcForTenantMock.mockResolvedValue(null)
    pveFetchMock.mockImplementation(async (_conn, path: string, opts?: any) => {
      if (opts?.method === 'POST') return 'UPID:move:1'
      if (opts?.method === 'PUT') return null
      if (String(path).endsWith('/qemu/100/config')) return { scsi0: 'ceph-hdd:vm-100-disk-0' }
      return {}
    })

    const POST = await loadPost()
    const res = await callRoute(POST, {
      params: baseParams,
      body: { disk: 'scsi0', storage: 'ceph-hdd', deleteSource: true },
    })
    expect(res.status).toBe(200)
    expect(h.afterCbs.length).toBe(0)
  })

  it('lxc move: no restamp after() scheduled even with a tier policy on the target', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasScope(['ceph-nvme'], { 'ceph-nvme': gold }))
    resolveVdcForTenantMock.mockResolvedValue(null)
    pveFetchMock.mockImplementation(async (_conn, _path: string, opts?: any) => {
      if (opts?.method === 'POST') return 'UPID:move:1'
      if (opts?.method === 'PUT') return null
      return {}
    })

    const POST = await loadPost()
    const res = await callRoute(POST, {
      params: { ...baseParams, type: 'lxc' },
      body: { disk: 'rootfs', storage: 'ceph-nvme', deleteSource: true },
    })
    expect(res.status).toBe(200)
    expect(h.afterCbs.length).toBe(0)
  })
})

describe('POST disk/move: provider tenant (unchanged)', () => {
  it('200: provider tenant reaches the move call directly, no vDC guard side effects', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'provider' })
    const POST = await loadPost()
    const res = await callRoute(POST, {
      params: baseParams,
      body: { disk: 'scsi0', storage: 'local-lvm', deleteSource: true },
    })
    expect(res.status).toBe(200)
    // Only the move POST call reaches PVE: no config read, no restamp cfg fetch.
    expect(pveFetchMock).toHaveBeenCalledTimes(1)
    expect(resolveVdcForTenantMock).not.toHaveBeenCalled()
    expect(checkVdcQuotaMock).not.toHaveBeenCalled()
  })
})
