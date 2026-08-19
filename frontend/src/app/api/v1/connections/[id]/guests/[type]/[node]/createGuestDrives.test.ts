/**
 * Route-level tests for the disk storage allow-list + storage-policy QoS
 * stamping wired into the direct guest create (Task 9). `driveGuard.ts`
 * itself is NOT mocked here: it runs for real against the mocked
 * `getTenantInfrastructureScope`, the same way the real route will. Unlike
 * the config PUT route, this route forwards the whole body as JSON, so the
 * guard sees (and stamps) the entire create payload.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const getRequestGuestScopePerimeterMock = vi.fn<(...args: any[]) => Promise<any>>()
const getConnectionByIdMock = vi.fn<(id: string) => Promise<any>>()
const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()
const resolveVdcForTenantMock = vi.fn<(...args: any[]) => Promise<any>>()
const checkVdcQuotaMock = vi.fn<(...args: any[]) => Promise<any>>()
const getAllowedNetworksForTenantMock = vi.fn<(...args: any[]) => Promise<any>>()
const getTenantInfrastructureScopeMock = vi.fn<(...args: any[]) => Promise<any>>()
const { checkVmidAgainstTenantRangeMock } = vi.hoisted(() => ({ checkVmidAgainstTenantRangeMock: vi.fn() }))

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  getRequestGuestScopePerimeter: getRequestGuestScopePerimeterMock,
  PERMISSIONS: { VM_CREATE: 'vm.create' },
}))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: getConnectionByIdMock }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: async () => 'tenant-1' }))
vi.mock('@/lib/vdc/quota', () => ({
  resolveVdcForTenant: resolveVdcForTenantMock,
  checkVdcQuota: checkVdcQuotaMock,
}))
vi.mock('@/lib/tenant/infraScope', () => ({
  getTenantInfrastructureScope: getTenantInfrastructureScopeMock,
}))
vi.mock('@/lib/vdc/vnets', async (io) => {
  const actual = await io<typeof import('@/lib/vdc/vnets')>()
  return {
    getAllowedNetworksForTenant: getAllowedNetworksForTenantMock,
    validateNetAgainstScope: actual.validateNetAgainstScope,
    resolveSubnetForBridge: vi.fn(async () => null),
    parseBridgeFromNet: () => null,
  }
})
vi.mock('@/lib/vdc/sdn', () => ({ generatePveMacAddress: () => 'BC:24:11:00:00:01' }))
vi.mock('@/lib/vdc/ipam', () => ({ allocateIp: vi.fn(), releaseIp: vi.fn(), IpamExhaustedError: class extends Error {} }))
vi.mock('@/lib/vdc/network', () => ({ parseCidr: () => null }))
vi.mock('@/lib/tenant/vmidRange', () => ({ checkVmidAgainstTenantRange: (...a: any[]) => checkVmidAgainstTenantRangeMock(...a) }))

async function loadPost() {
  const mod = await import('./route')
  return mod.POST as Parameters<typeof callRoute>[0]
}

const qemuParams = { id: 'conn-1', type: 'qemu', node: 'pve1' }
const lxcParams = { id: 'conn-1', type: 'lxc', node: 'pve1' }

const gold = { policyId: 'p-gold', name: 'Gold', iopsRd: 5000, iopsWr: 4000, mbpsRd: 500, mbpsWr: null }

function iaasInfra(storages: string[], policies: Record<string, typeof gold> = {}) {
  return {
    kind: 'iaas',
    vdcScope: {
      storagesByConnection: new Map([['conn-1', new Set(storages)]]),
      storagePoliciesByConnection: new Map([['conn-1', new Map(Object.entries(policies))]]),
    },
  }
}

/** Pull the JSON body POSTed to the PVE guest-create endpoint. */
function createdBody(node: string, type: string) {
  const call = pveFetchMock.mock.calls.find(
    (c) => c[1] === `/nodes/${node}/${type}` && c[2]?.method === 'POST',
  )
  return call ? JSON.parse(String(call[2].body)) : null
}

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getRequestGuestScopePerimeterMock.mockReset().mockResolvedValue(null)
  getConnectionByIdMock.mockReset().mockResolvedValue({ id: 'conn-1' })
  pveFetchMock.mockReset().mockResolvedValue('UPID:x')
  checkVmidAgainstTenantRangeMock.mockReset().mockResolvedValue({ ok: true })
  getAllowedNetworksForTenantMock.mockReset().mockResolvedValue(null)
  resolveVdcForTenantMock.mockReset().mockResolvedValue(null)
  checkVdcQuotaMock.mockReset().mockResolvedValue({ allowed: true })
  getTenantInfrastructureScopeMock.mockReset().mockResolvedValue({ kind: 'provider' })
})

describe('POST guests create: disk storage allow-list + storage-policy QoS stamping', () => {
  it('403: an iaas tenant referencing an out-of-scope storage never reaches PVE', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasInfra(['ceph-nvme']))
    const POST = await loadPost()
    const res = await callRoute(POST, {
      params: qemuParams,
      body: { vmid: 105, scsi0: 'local-lvm:10' },
    })
    expect(res.status).toBe(403)
    const json = await readJson<{ error: string }>(res)
    expect(json?.error).toContain('local-lvm')
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('200: an iaas qemu create is stamped with the policy caps before the JSON body reaches PVE', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(
      iaasInfra(['ceph-nvme'], { 'ceph-nvme': gold }),
    )
    const POST = await loadPost()
    const res = await callRoute(POST, {
      params: qemuParams,
      body: { vmid: 105, scsi0: 'ceph-nvme:10,iops=1' },
    })
    expect(res.status).toBe(200)
    const sent = createdBody('pve1', 'qemu')
    expect(sent.scsi0).toBe('ceph-nvme:10,iops_rd=5000,iops_wr=4000,mbps_rd=500')
    expect(sent.scsi0).not.toContain('iops=1')
  })

  it('200: an iaas lxc rootfs is validated and metered but left unstamped', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(
      iaasInfra(['ceph-nvme'], { 'ceph-nvme': gold }),
    )
    resolveVdcForTenantMock.mockResolvedValue({
      poolName: 'pool-1',
      quota: { maxStorageMb: null },
      storagePolicies: [{ policyId: 'p-gold', name: 'Gold', storageId: 'ceph-nvme', quotaMb: null }],
    })
    const POST = await loadPost()
    const res = await callRoute(POST, {
      params: lxcParams,
      body: { vmid: 106, rootfs: 'ceph-nvme:8' },
    })
    expect(res.status).toBe(200)
    const sent = createdBody('pve1', 'lxc')
    expect(sent.rootfs).toBe('ceph-nvme:8')
    expect(checkVdcQuotaMock).toHaveBeenCalled()
    const [, , , operation, storagePolicies, node] = checkVdcQuotaMock.mock.calls[0]
    expect(operation.addStorageMb).toBe(8192)
    expect(operation.addStorageMbByStorage).toEqual({ 'ceph-nvme': 8192 })
    expect(storagePolicies).toEqual([{ policyId: 'p-gold', name: 'Gold', storageId: 'ceph-nvme', quotaMb: null }])
    expect(node).toBe('pve1')
  })

  it('409: a storage-policy tier overflow is surfaced, PVE create never called', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(
      iaasInfra(['ceph-nvme'], { 'ceph-nvme': gold }),
    )
    resolveVdcForTenantMock.mockResolvedValue({
      poolName: 'pool-1',
      quota: { maxStorageMb: null },
      storagePolicies: [{ policyId: 'p-gold', name: 'Gold', storageId: 'ceph-nvme', quotaMb: 1024 }],
    })
    checkVdcQuotaMock.mockResolvedValue({
      allowed: false,
      violations: ['Storage policy "Gold" (ceph-nvme): over quota'],
    })
    const POST = await loadPost()
    const res = await callRoute(POST, {
      params: qemuParams,
      body: { vmid: 105, scsi0: 'ceph-nvme:10' },
    })
    expect(res.status).toBe(409)
    const json = await readJson<{ error: string; violations: string[] }>(res)
    expect(json?.violations).toEqual(['Storage policy "Gold" (ceph-nvme): over quota'])
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('200: a provider create passes disk fields (including tenant-supplied QoS) verbatim', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'provider' })
    const POST = await loadPost()
    const res = await callRoute(POST, {
      params: qemuParams,
      body: { vmid: 105, scsi0: 'local-lvm:10,mbps=999,iops=50' },
    })
    expect(res.status).toBe(200)
    const sent = createdBody('pve1', 'qemu')
    expect(sent.scsi0).toBe('local-lvm:10,mbps=999,iops=50')
  })
})
