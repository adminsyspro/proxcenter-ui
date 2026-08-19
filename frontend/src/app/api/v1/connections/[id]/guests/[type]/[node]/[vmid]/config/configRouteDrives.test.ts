/**
 * Route-level tests for the disk storage allow-list + storage-policy QoS
 * stamping wired into the config PUT (Task 8). `driveGuard.ts` itself is
 * NOT mocked here: it runs for real against the mocked
 * `getTenantInfrastructureScope`, the same way the real route will.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const getConnectionByIdMock = vi.fn<(id: string) => Promise<any>>()
const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()
const resolveVdcForTenantMock = vi.fn<(...args: any[]) => Promise<any>>()
const checkVdcQuotaMock = vi.fn<(...args: any[]) => Promise<any>>()
const getAllowedNetworksForTenantMock = vi.fn<(...args: any[]) => Promise<any>>()
const syncIpamForVmConfigMock = vi.fn<(...args: any[]) => Promise<any>>()
const getTenantInfrastructureScopeMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  buildVmResourceId: () => 'res',
  PERMISSIONS: { VM_CONFIG: 'vm.config' },
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
  }
})
vi.mock('@/lib/vdc/ipamSync', () => ({
  syncIpamForVmConfig: syncIpamForVmConfigMock,
  IpamHintUnavailableError: class IpamHintUnavailableError extends Error {},
  IpamExhaustedError: class IpamExhaustedError extends Error {},
}))
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }))

async function loadPut() {
  const mod = await import('./route')
  return mod.PUT as Parameters<typeof callRoute>[0]
}

const baseParams = { id: 'conn-1', type: 'qemu', node: 'pve3', vmid: '100' }

/** Pull the URLSearchParams sent to the PVE config PUT. */
function configPutBody() {
  const call = pveFetchMock.mock.calls.find(
    (c) => String(c[1]).endsWith('/config') && c[2]?.method === 'PUT',
  )
  return call ? new URLSearchParams(String(call?.[2]?.body ?? '')) : null
}

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

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getConnectionByIdMock.mockReset().mockResolvedValue({ id: 'conn-1' })
  resolveVdcForTenantMock.mockReset().mockResolvedValue(null)
  checkVdcQuotaMock.mockReset().mockResolvedValue({ allowed: true })
  getAllowedNetworksForTenantMock.mockReset().mockResolvedValue(null)
  syncIpamForVmConfigMock.mockReset().mockResolvedValue({ bodyOverrides: {}, rollback: vi.fn() })
  getTenantInfrastructureScopeMock.mockReset().mockResolvedValue({ kind: 'provider' })
  // Default: config GET reads return an empty config, the config PUT succeeds.
  pveFetchMock.mockReset().mockImplementation(async (_conn, _path, opts?: any) => {
    if (opts?.method === 'PUT') return { data: 'ok' }
    return {}
  })
})

describe('PUT config: disk storage allow-list + storage-policy QoS stamping', () => {
  it('403: an iaas tenant referencing an out-of-scope storage never reaches PVE', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasInfra(['ceph-nvme', 'ceph-hdd']))
    const PUT = await loadPut()
    const res = await callRoute(PUT, {
      method: 'PUT',
      params: baseParams,
      body: { scsi1: 'local-lvm:32' },
    })
    expect(res.status).toBe(403)
    const json = (await res.json()) as { error: string }
    expect(json.error).toContain('local-lvm')
    expect(configPutBody()).toBeNull()
  })

  it('200: a policied storage is stamped with the policy caps, tenant mbps= is stripped', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(
      iaasInfra(['ceph-nvme'], { 'ceph-nvme': gold }),
    )
    const PUT = await loadPut()
    const res = await callRoute(PUT, {
      method: 'PUT',
      params: baseParams,
      body: { scsi1: 'ceph-nvme:32,mbps=9999' },
    })
    expect(res.status).toBe(200)
    const sent = configPutBody()
    expect(sent?.get('scsi1')).toBe('ceph-nvme:32,iops_rd=5000,iops_wr=4000,mbps_rd=500')
    expect(sent?.get('scsi1')).not.toContain('mbps=9999')
  })

  it('409: a storage-policy quota violation is surfaced with violations', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(
      iaasInfra(['ceph-nvme'], { 'ceph-nvme': gold }),
    )
    resolveVdcForTenantMock.mockResolvedValue({
      poolName: 'pool-1',
      quota: { maxStorageMb: null },
      storagePolicies: [{ policyId: 'p-gold', name: 'Gold', storageId: 'ceph-nvme', quotaMb: 1024 }],
    })
    checkVdcQuotaMock.mockResolvedValue({ allowed: false, violations: ['Storage policy "Gold" (ceph-nvme): over quota'] })
    const PUT = await loadPut()
    const res = await callRoute(PUT, {
      method: 'PUT',
      params: baseParams,
      body: { scsi1: 'ceph-nvme:32' },
    })
    expect(res.status).toBe(409)
    const json = (await res.json()) as { error: string; violations: string[] }
    expect(json.violations).toEqual(['Storage policy "Gold" (ceph-nvme): over quota'])
    expect(configPutBody()).toBeNull()
  })

  it('200: a provider passes disk fields verbatim (non-regression)', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'provider' })
    const PUT = await loadPut()
    const res = await callRoute(PUT, {
      method: 'PUT',
      params: baseParams,
      body: { scsi1: 'local-lvm:32,mbps=10' },
    })
    expect(res.status).toBe(200)
    expect(configPutBody()?.get('scsi1')).toBe('local-lvm:32,mbps=10')
  })

  it('403: an iaas tenant reassigning an out-of-scope unused disk is refused', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasInfra(['ceph-nvme']))
    const PUT = await loadPut()
    const res = await callRoute(PUT, {
      method: 'PUT',
      params: baseParams,
      body: { unused0: 'local-lvm:vm-1-disk-9' },
    })
    expect(res.status).toBe(403)
    expect(configPutBody()).toBeNull()
  })
})
