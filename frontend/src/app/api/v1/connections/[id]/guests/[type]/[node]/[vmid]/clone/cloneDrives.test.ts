/**
 * Task 11: clone route hardening (spec §5.3).
 *  - Preflight: `body.storage` must be an authorised storage for iaas
 *    tenants, checked once against the union scope before any PVE call.
 *  - Metering: full clones meter per-disk `size=` against the target
 *    storage (or each disk's own storage when `body.storage` is unset).
 *    PVE forces a full clone for a non-template source regardless of the
 *    `full` param, so that case must still be metered; a genuine linked
 *    clone (template source, `full` falsy) meters zero.
 *  - Post-clone: a dedicated after() block restamps QoS on the clone's DATA
 *    disks whose storage carries a tier policy, gated on a non-empty
 *    policies map, and PUTs only if something actually changed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute } from '@/__tests__/setup/route-test'

// Capture the after() callbacks so the test can drive the post-clone work.
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
const getAllowedNetworksForTenantMock = vi.fn<(...args: any[]) => Promise<any>>()
const resolveSubnetForBridgeMock = vi.fn<(...args: any[]) => Promise<any>>()
const syncIpamForVmConfigMock = vi.fn<(...args: any[]) => Promise<any>>()
const waitForTaskMock = vi.fn<(...args: any[]) => Promise<any>>()
const getTenantInfrastructureScopeMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  buildVmResourceId: () => 'res',
  PERMISSIONS: { VM_CLONE: 'vm.clone' },
}))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: getConnectionByIdMock }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))
vi.mock('@/lib/cache/inventoryCache', () => ({ invalidateInventoryCache: vi.fn() }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: async () => 'tenant-1' }))
vi.mock('@/lib/vdc/quota', () => ({
  resolveVdcForTenant: resolveVdcForTenantMock,
  checkVdcQuota: checkVdcQuotaMock,
}))
vi.mock('@/lib/vdc/vnets', async (io) => {
  const actual = await io<typeof import('@/lib/vdc/vnets')>()
  return {
    getAllowedNetworksForTenant: getAllowedNetworksForTenantMock,
    validateNetAgainstScope: actual.validateNetAgainstScope,
    parseBridgeFromNet: actual.parseBridgeFromNet,
    resolveSubnetForBridge: resolveSubnetForBridgeMock,
  }
})
vi.mock('@/lib/vdc/ipamSync', () => ({ syncIpamForVmConfig: syncIpamForVmConfigMock }))
vi.mock('@/lib/vdc/ipam', () => ({ releaseAllocationsForVm: vi.fn() }))
vi.mock('@/lib/proxmox/tasks', () => ({ waitForTask: waitForTaskMock }))
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }))
vi.mock('@/lib/tenant/infraScope', () => ({
  getTenantInfrastructureScope: (...a: any[]) => getTenantInfrastructureScopeMock(...a),
}))
const { checkVmidAgainstTenantRangeMock } = vi.hoisted(() => ({ checkVmidAgainstTenantRangeMock: vi.fn() }))
vi.mock('@/lib/tenant/vmidRange', () => ({ checkVmidAgainstTenantRange: (...a: any[]) => checkVmidAgainstTenantRangeMock(...a) }))

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

function cloneCallBody() {
  const call = pveFetchMock.mock.calls.find(
    (c) => String(c[1]).endsWith('/clone') && c[2]?.method === 'POST',
  )
  return new URLSearchParams(String(call?.[2]?.body ?? ''))
}

beforeEach(() => {
  h.afterCbs.length = 0
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getConnectionByIdMock.mockReset().mockResolvedValue({ id: 'conn-1' })
  resolveVdcForTenantMock.mockReset().mockResolvedValue(null)
  checkVdcQuotaMock.mockReset().mockResolvedValue({ allowed: true })
  getAllowedNetworksForTenantMock.mockReset().mockResolvedValue(null)
  resolveSubnetForBridgeMock.mockReset().mockResolvedValue(null)
  syncIpamForVmConfigMock.mockReset().mockResolvedValue({ bodyOverrides: {}, rollback: vi.fn() })
  waitForTaskMock.mockReset().mockResolvedValue(undefined)
  checkVmidAgainstTenantRangeMock.mockReset().mockResolvedValue({ ok: true })
  getTenantInfrastructureScopeMock.mockReset().mockResolvedValue({ kind: 'provider' })
  // Default: config reads return an empty config (no disks, no NICs), clone
  // POST returns a UPID.
  pveFetchMock.mockReset().mockImplementation(async (_conn, _path, opts?: any) => {
    if (opts?.method === 'POST') return 'UPID:clone:1'
    if (opts?.method === 'PUT') return null
    return {}
  })
})

describe('POST clone: target storage scope (spec §5.3)', () => {
  it('403: an out-of-scope body.storage never reaches the PVE clone', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasScope(['ceph-nvme', 'ceph-hdd']))
    const POST = await loadPost()
    const res = await callRoute(POST, {
      params: baseParams,
      body: { newid: 101, full: true, storage: 'local-lvm' },
    })
    expect(res.status).toBe(403)
    const json = (await res.json()) as { error: string }
    expect(json.error).toContain('local-lvm')
    // No PVE call at all before the storage check, not merely "no clone POST":
    // the source vmConfig read, the pool listing, none of it should fire.
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('200: an in-scope body.storage is accepted', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasScope(['ceph-nvme', 'ceph-hdd']))
    const POST = await loadPost()
    const res = await callRoute(POST, {
      params: baseParams,
      body: { newid: 101, full: true, storage: 'ceph-nvme' },
    })
    expect(res.status).toBe(200)
  })
})

describe('POST clone: per-tier storage metering (spec §5.3)', () => {
  const sourceConfig = {
    scsi0: 'ceph-hdd:vm-100-disk-0,size=32G',
    ide2: 'local:iso/x.iso,media=cdrom',
  }

  it('full clone WITH body.storage: meters against the target storage, cdrom ignored', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasScope(['ceph-nvme', 'ceph-hdd']))
    resolveVdcForTenantMock.mockResolvedValue({ poolName: 'pool-x', quota: null, storagePolicies: [] })
    pveFetchMock.mockImplementation(async (_conn, path: string, opts?: any) => {
      if (opts?.method === 'POST') return 'UPID:clone:1'
      if (opts?.method === 'PUT') return null
      if (String(path).endsWith('/qemu/100/config')) return sourceConfig
      return {}
    })

    const POST = await loadPost()
    const res = await callRoute(POST, {
      params: baseParams,
      body: { newid: 101, full: true, storage: 'ceph-nvme' },
    })
    expect(res.status).toBe(200)

    expect(checkVdcQuotaMock).toHaveBeenCalled()
    const operation = checkVdcQuotaMock.mock.calls[0][3]
    expect(operation.addStorageMb).toBe(32768)
    expect(operation.addStorageMbByStorage).toEqual({ 'ceph-nvme': 32768 })
  })

  it('full clone WITHOUT body.storage: meters against each disk\'s own storage', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasScope(['ceph-nvme', 'ceph-hdd']))
    resolveVdcForTenantMock.mockResolvedValue({ poolName: 'pool-x', quota: null, storagePolicies: [] })
    pveFetchMock.mockImplementation(async (_conn, path: string, opts?: any) => {
      if (opts?.method === 'POST') return 'UPID:clone:1'
      if (opts?.method === 'PUT') return null
      if (String(path).endsWith('/qemu/100/config')) return sourceConfig
      return {}
    })

    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { newid: 101, full: true } })
    expect(res.status).toBe(200)

    const operation = checkVdcQuotaMock.mock.calls[0][3]
    expect(operation.addStorageMb).toBe(32768)
    expect(operation.addStorageMbByStorage).toEqual({ 'ceph-hdd': 32768 })
  })

  const multiStorageSourceConfig = {
    scsi0: 'ceph-hdd:vm-100-disk-0,size=32G',
    virtio1: 'ceph-nvme:vm-100-disk-1,size=8G',
    ide2: 'local:iso/x.iso,media=cdrom',
  }

  it('full clone WITH body.storage, two disks on DIFFERENT source storages: both meter against the target storage', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasScope(['ceph-nvme', 'ceph-hdd']))
    resolveVdcForTenantMock.mockResolvedValue({ poolName: 'pool-x', quota: null, storagePolicies: [] })
    pveFetchMock.mockImplementation(async (_conn, path: string, opts?: any) => {
      if (opts?.method === 'POST') return 'UPID:clone:1'
      if (opts?.method === 'PUT') return null
      if (String(path).endsWith('/qemu/100/config')) return multiStorageSourceConfig
      return {}
    })

    const POST = await loadPost()
    const res = await callRoute(POST, {
      params: baseParams,
      body: { newid: 101, full: true, storage: 'ceph-nvme' },
    })
    expect(res.status).toBe(200)

    const operation = checkVdcQuotaMock.mock.calls[0][3]
    expect(operation.addStorageMb).toBe(40960)
    expect(operation.addStorageMbByStorage).toEqual({ 'ceph-nvme': 40960 })
  })

  it('full clone WITHOUT body.storage, two disks on DIFFERENT source storages: each meters its own storage', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasScope(['ceph-nvme', 'ceph-hdd']))
    resolveVdcForTenantMock.mockResolvedValue({ poolName: 'pool-x', quota: null, storagePolicies: [] })
    pveFetchMock.mockImplementation(async (_conn, path: string, opts?: any) => {
      if (opts?.method === 'POST') return 'UPID:clone:1'
      if (opts?.method === 'PUT') return null
      if (String(path).endsWith('/qemu/100/config')) return multiStorageSourceConfig
      return {}
    })

    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { newid: 101, full: true } })
    expect(res.status).toBe(200)

    const operation = checkVdcQuotaMock.mock.calls[0][3]
    expect(operation.addStorageMb).toBe(40960)
    expect(operation.addStorageMbByStorage).toEqual({ 'ceph-hdd': 32768, 'ceph-nvme': 8192 })
  })

  it('non-template source without `full`: metered anyway (PVE forces a full clone)', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasScope(['ceph-nvme', 'ceph-hdd']))
    resolveVdcForTenantMock.mockResolvedValue({ poolName: 'pool-x', quota: null, storagePolicies: [] })
    pveFetchMock.mockImplementation(async (_conn, path: string, opts?: any) => {
      if (opts?.method === 'POST') return 'UPID:clone:1'
      if (opts?.method === 'PUT') return null
      // template is absent/0: a real VM, not a template.
      if (String(path).endsWith('/qemu/100/config')) return sourceConfig
      return {}
    })

    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { newid: 101 } })
    expect(res.status).toBe(200)

    const operation = checkVdcQuotaMock.mock.calls[0][3]
    expect(operation.addStorageMb).toBe(32768)
    expect(operation.addStorageMbByStorage).toEqual({ 'ceph-hdd': 32768 })
  })

  it('linked clone (template source, `full` falsy): metering is zero', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasScope(['ceph-nvme', 'ceph-hdd']))
    resolveVdcForTenantMock.mockResolvedValue({ poolName: 'pool-x', quota: null, storagePolicies: [] })
    pveFetchMock.mockImplementation(async (_conn, path: string, opts?: any) => {
      if (opts?.method === 'POST') return 'UPID:clone:1'
      if (opts?.method === 'PUT') return null
      if (String(path).endsWith('/qemu/100/config')) return { ...sourceConfig, template: 1 }
      return {}
    })

    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { newid: 101, full: false } })
    expect(res.status).toBe(200)

    const operation = checkVdcQuotaMock.mock.calls[0][3]
    expect(operation.addStorageMb).toBe(0)
    expect(operation.addStorageMbByStorage).toBeUndefined()
  })
})

describe('POST clone: post-clone QoS restamp (spec §5.3)', () => {
  it('restamps a clone DATA disk whose storage carries a tier policy (PUT captured)', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasScope(['ceph-nvme'], { 'ceph-nvme': gold }))
    resolveVdcForTenantMock.mockResolvedValue(null) // no vDC quota needed for this assertion
    pveFetchMock.mockImplementation(async (_conn, path: string, opts?: any) => {
      if (opts?.method === 'POST') return 'UPID:clone:1'
      if (opts?.method === 'PUT') return null
      if (String(path).endsWith('/qemu/100/config')) return {} // source: irrelevant here
      if (String(path).endsWith('/qemu/101/config')) return { scsi0: 'ceph-nvme:vm-101-disk-0' }
      return {}
    })

    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { newid: 101, full: true } })
    expect(res.status).toBe(200)

    expect(h.afterCbs.length).toBeGreaterThan(0)
    for (const cb of h.afterCbs) await cb()

    expect(waitForTaskMock).toHaveBeenCalledWith({ id: 'conn-1' }, 'pve3', 'UPID:clone:1')

    const putCall = pveFetchMock.mock.calls.find(
      (c) => String(c[1]).endsWith('/qemu/101/config') && c[2]?.method === 'PUT',
    )
    expect(putCall).toBeTruthy()
    const patch = new URLSearchParams(String(putCall?.[2]?.body))
    expect(patch.get('scsi0')).toBe('ceph-nvme:vm-101-disk-0,iops_rd=5000,iops_wr=4000,mbps_rd=500')
  })

  it('no policies on the connection: no restamp after() work scheduled, no extra PUT', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasScope(['ceph-nvme']))
    resolveVdcForTenantMock.mockResolvedValue(null)
    pveFetchMock.mockImplementation(async (_conn, path: string, opts?: any) => {
      if (opts?.method === 'POST') return 'UPID:clone:1'
      if (opts?.method === 'PUT') return null
      if (String(path).endsWith('/qemu/101/config')) return { scsi0: 'ceph-nvme:vm-101-disk-0' }
      return {}
    })

    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { newid: 101, full: true } })
    expect(res.status).toBe(200)
    expect(h.afterCbs.length).toBe(0)

    const putCall = pveFetchMock.mock.calls.find((c) => c[2]?.method === 'PUT')
    expect(putCall).toBeUndefined()
  })
})
