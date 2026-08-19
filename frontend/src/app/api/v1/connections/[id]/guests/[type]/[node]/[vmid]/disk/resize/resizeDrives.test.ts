/**
 * Task 12: resize route hardening (spec §6).
 *  - Storage-tier scope: a disk resolved (from the live config) onto a
 *    storage that has since dropped out of the tenant's union scope is
 *    refused outright (403), independent of the requested delta.
 *  - Metering: checkVdcQuota gains addStorageMbByStorage keyed by the
 *    disk's own storage, alongside storagePolicies + node, so per-tier
 *    quota rows are enforced (not just the global VdcQuota row).
 *  - Provider tenants: unchanged. resolveVdcForTenant returns null for the
 *    default tenant, so the whole guard block (including the new storage
 *    scope check) is skipped, no extra fetch of any kind.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const getConnectionByIdMock = vi.fn<(id: string) => Promise<any>>()
const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()
const resolveVdcForTenantMock = vi.fn<(...args: any[]) => Promise<any>>()
const checkVdcQuotaMock = vi.fn<(...args: any[]) => Promise<any>>()
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
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }))

async function loadPost() {
  const mod = await import('./route')
  return mod.POST as Parameters<typeof callRoute>[0]
}

const baseParams = { id: 'conn-1', type: 'qemu', node: 'pve3', vmid: '100' }

function iaasScope(storages: string[]) {
  return {
    kind: 'iaas',
    vdcScope: {
      storagesByConnection: new Map([['conn-1', new Set(storages)]]),
    },
  }
}

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getConnectionByIdMock.mockReset().mockResolvedValue({ id: 'conn-1' })
  resolveVdcForTenantMock.mockReset().mockResolvedValue(null)
  checkVdcQuotaMock.mockReset().mockResolvedValue({ allowed: true })
  getTenantInfrastructureScopeMock.mockReset().mockResolvedValue({ kind: 'provider' })
  pveFetchMock.mockReset().mockImplementation(async (_conn, _path, opts?: any) => {
    if (opts?.method === 'PUT') return 'UPID:resize:1'
    return {}
  })
})

describe('POST disk/resize: storage-tier scope (spec §6)', () => {
  it('403: disk lives on a storage that dropped out of scope, no PVE resize call', async () => {
    resolveVdcForTenantMock.mockResolvedValue({ poolName: 'pool-x', quota: null, storagePolicies: [] })
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasScope(['ceph-nvme']))
    pveFetchMock.mockImplementation(async (_conn, path: string, opts?: any) => {
      if (opts?.method === 'PUT' && String(path).endsWith('/resize')) return 'UPID:resize:1'
      if (String(path).endsWith('/qemu/100/config')) return { scsi0: 'local-lvm:vm-100-disk-0,size=32G' }
      return {}
    })

    const POST = await loadPost()
    const res = await callRoute(POST, {
      params: baseParams,
      body: { disk: 'scsi0', size: '+10G' },
    })
    expect(res.status).toBe(403)
    const json = (await res.json()) as { error: string }
    expect(json.error).toContain('local-lvm')
    const resizeCall = pveFetchMock.mock.calls.find(
      (c) => String(c[1]).endsWith('/resize') && c[2]?.method === 'PUT',
    )
    expect(resizeCall).toBeUndefined()
  })

  it('200: disk on an in-scope storage passes the guard, quota metered per-tier', async () => {
    resolveVdcForTenantMock.mockResolvedValue({ poolName: 'pool-x', quota: null, storagePolicies: [] })
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasScope(['ceph-nvme']))
    pveFetchMock.mockImplementation(async (_conn, path: string, opts?: any) => {
      if (opts?.method === 'PUT' && String(path).endsWith('/resize')) return 'UPID:resize:1'
      if (String(path).endsWith('/qemu/100/config')) return { scsi0: 'ceph-nvme:vm-100-disk-0,size=32G' }
      return {}
    })

    const POST = await loadPost()
    const res = await callRoute(POST, {
      params: baseParams,
      body: { disk: 'scsi0', size: '+10G' },
    })
    expect(res.status).toBe(200)

    expect(checkVdcQuotaMock).toHaveBeenCalled()
    const [, , , operation, storagePolicies, node] = checkVdcQuotaMock.mock.calls[0]
    expect(operation.addStorageMbByStorage).toEqual({ 'ceph-nvme': 10240 })
    expect(storagePolicies).toEqual([])
    expect(node).toBe('pve3')
  })
})

describe('POST disk/resize: tier quota (spec §6)', () => {
  it('409: tier-full quota violation names the policy, no PVE resize call', async () => {
    resolveVdcForTenantMock.mockResolvedValue({
      poolName: 'pool-x',
      quota: null,
      storagePolicies: [{ policyId: 'p-gold', name: 'Gold', storageId: 'ceph-nvme', quotaMb: 1024 }],
    })
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasScope(['ceph-nvme']))
    checkVdcQuotaMock.mockResolvedValue({ allowed: false, violations: ['Gold: 1024/1024 MB, +10240 MB exceeds tier quota'] })
    pveFetchMock.mockImplementation(async (_conn, path: string, opts?: any) => {
      if (opts?.method === 'PUT' && String(path).endsWith('/resize')) return 'UPID:resize:1'
      if (String(path).endsWith('/qemu/100/config')) return { scsi0: 'ceph-nvme:vm-100-disk-0,size=32G' }
      return {}
    })

    const POST = await loadPost()
    const res = await callRoute(POST, {
      params: baseParams,
      body: { disk: 'scsi0', size: '+10G' },
    })
    expect(res.status).toBe(409)
    const json = (await res.json()) as { violations: string[] }
    expect(json.violations.some((v) => v.includes('Gold'))).toBe(true)
    const resizeCall = pveFetchMock.mock.calls.find(
      (c) => String(c[1]).endsWith('/resize') && c[2]?.method === 'PUT',
    )
    expect(resizeCall).toBeUndefined()
  })
})

describe('POST disk/resize: provider tenant (unchanged)', () => {
  it('200: provider tenant has no vDC, the whole guard block is a no-op', async () => {
    resolveVdcForTenantMock.mockResolvedValue(null) // DEFAULT_TENANT_ID short-circuit
    const POST = await loadPost()
    const res = await callRoute(POST, {
      params: baseParams,
      body: { disk: 'scsi0', size: '+10G' },
    })
    expect(res.status).toBe(200)
    expect(getTenantInfrastructureScopeMock).not.toHaveBeenCalled()
    expect(checkVdcQuotaMock).not.toHaveBeenCalled()
  })
})
