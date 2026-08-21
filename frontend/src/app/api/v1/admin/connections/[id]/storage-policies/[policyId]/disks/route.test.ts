/**
 * GET /api/v1/admin/connections/{id}/storage-policies/{policyId}/disks:
 * provider-only read of every existing disk a storage policy currently
 * governs, across every VM in every assigned vDC pool, with a per-disk
 * drift flag. Powers the expandable policy row in
 * StoragePoliciesSection.tsx.
 *
 * enumerateQemuMembers is exercised here through the REAL storagePolicies
 * module (not mocked): only its own pveFetch dependency is stubbed, same as
 * the sibling apply/route.test.ts now does since enumerateQemuMembers moved
 * there.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'
import { callRoute } from '@/__tests__/setup/route-test'

const {
  requireProviderTenantMock,
  checkPermissionMock,
  getServerSessionMock,
  storagePolicyFindUniqueMock,
  vdcStoragePolicyFindManyMock,
  connectionFindUniqueMock,
  getConnectionByIdMock,
  pveFetchMock,
} = vi.hoisted(() => ({
  requireProviderTenantMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  getServerSessionMock: vi.fn(),
  storagePolicyFindUniqueMock: vi.fn(),
  vdcStoragePolicyFindManyMock: vi.fn(),
  connectionFindUniqueMock: vi.fn(),
  getConnectionByIdMock: vi.fn(),
  pveFetchMock: vi.fn(),
}))

vi.mock('@/lib/tenant', () => ({
  requireProviderTenant: (...a: unknown[]) => requireProviderTenantMock(...a),
  DEFAULT_TENANT_ID: 'default',
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: unknown[]) => checkPermissionMock(...a),
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' },
}))

vi.mock('next-auth', () => ({
  getServerSession: (...a: unknown[]) => getServerSessionMock(...a),
}))

vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    storagePolicy: { findUnique: (...a: unknown[]) => storagePolicyFindUniqueMock(...a) },
    vdcStoragePolicy: { findMany: (...a: unknown[]) => vdcStoragePolicyFindManyMock(...a) },
    connection: { findUnique: (...a: unknown[]) => connectionFindUniqueMock(...a) },
  },
}))

vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: (...a: unknown[]) => getConnectionByIdMock(...a),
}))

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: (...a: unknown[]) => pveFetchMock(...a),
}))

import { GET } from './route'

const CONN_ID = 'conn-1'
const POLICY_ID = 'policy-1'

const POLICY_ROW = {
  id: POLICY_ID,
  connectionId: CONN_ID,
  storageId: 'nvme-pool',
  iopsRd: 5000,
  iopsWr: 5000,
  mbpsRd: null,
  mbpsWr: null,
}

const POOL_MEMBERS = [
  { type: 'qemu', vmid: 101, node: 'pve1', name: 'web-01', status: 'running' },
  { type: 'qemu', vmid: 102, node: 'pve1', name: 'web-02', status: 'running' },
  { type: 'qemu', vmid: 103, node: 'pve1', name: 'web-03', status: 'stopped' },
  { type: 'qemu', vmid: 104, node: 'pve1', name: 'web-04', status: 'running' },
]

function configFor(path: string): any {
  if (path.includes('/101/')) {
    // In sync: caps already match the policy's current caps.
    return { // size= after the QoS keys = PVE's alphabetical re-serialization; the
      // in-sync verdict must be semantic, byte comparison would flag drift here.
      scsi0: 'nvme-pool:vm-101-disk-0,iops_rd=5000,iops_wr=5000,size=20G' }
  }
  if (path.includes('/102/')) {
    // Drifted: caps on the live disk no longer match the policy.
    return { scsi0: 'nvme-pool:vm-102-disk-0,iops_rd=1000,iops_wr=1000' }
  }
  if (path.includes('/103/')) {
    // No disk on this policy's storage: VM must be absent from the result.
    return { scsi0: 'other-storage:vm-103-disk-0' }
  }
  throw new Error('should not be reached for vmid 104')
}

beforeEach(() => {
  vi.clearAllMocks()
  requireProviderTenantMock.mockResolvedValue(null)
  checkPermissionMock.mockResolvedValue(null)
  getServerSessionMock.mockResolvedValue({ user: { id: 'admin-1', tenantId: 'default' } })
  storagePolicyFindUniqueMock.mockResolvedValue(POLICY_ROW)
  vdcStoragePolicyFindManyMock.mockResolvedValue([{ vdc: { pvePoolName: 'vdc-acme-prod' } }])
  connectionFindUniqueMock.mockResolvedValue({ tenantId: 'tenant-acme' })
  getConnectionByIdMock.mockResolvedValue({ id: CONN_ID })
  pveFetchMock.mockImplementation(async (_conn: any, path: string) => {
    if (path === '/pools/vdc-acme-prod') return { members: POOL_MEMBERS }
    if (path.includes('/104/')) throw new Error('PVE unreachable')
    return configFor(path)
  })
})

describe('GET .../storage-policies/{policyId}/disks', () => {
  it('returns the guard deny response as-is', async () => {
    checkPermissionMock.mockResolvedValue(NextResponse.json({ error: 'nope' }, { status: 403 }))

    const res = await callRoute(GET as Parameters<typeof callRoute>[0], {
      params: { id: CONN_ID, policyId: POLICY_ID },
    })

    expect(res.status).toBe(403)
    expect(storagePolicyFindUniqueMock).not.toHaveBeenCalled()
  })

  it('404s an unknown or foreign policyId', async () => {
    storagePolicyFindUniqueMock.mockResolvedValue({ ...POLICY_ROW, connectionId: 'other-conn' })

    const res = await callRoute(GET as Parameters<typeof callRoute>[0], {
      params: { id: CONN_ID, policyId: POLICY_ID },
    })

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Storage policy not found' })
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('returns an empty vms list without touching PVE when the policy has no vDC assignments', async () => {
    vdcStoragePolicyFindManyMock.mockResolvedValue([])

    const res = await callRoute(GET as Parameters<typeof callRoute>[0], {
      params: { id: CONN_ID, policyId: POLICY_ID },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { vms: [] } })
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('reports an in-sync disk, a drifted disk, omits the VM with no matching disk, and flags the config-GET failure', async () => {
    const res = await callRoute(GET as Parameters<typeof callRoute>[0], {
      params: { id: CONN_ID, policyId: POLICY_ID },
    })

    expect(res.status).toBe(200)
    expect(getConnectionByIdMock).toHaveBeenCalledWith(CONN_ID, 'tenant-acme')

    const body = await res.json()
    const vms = body.data.vms

    expect(vms).toHaveLength(3)

    const inSyncVm = vms.find((v: any) => v.vmid === 101)
    expect(inSyncVm).toMatchObject({ name: 'web-01', node: 'pve1', vmstatus: 'running' })
    expect(inSyncVm.disks).toEqual([
      { key: 'scsi0', iopsRd: 5000, iopsWr: 5000, mbpsRd: null, mbpsWr: null, inSync: true },
    ])

    const driftedVm = vms.find((v: any) => v.vmid === 102)
    expect(driftedVm.disks).toEqual([
      { key: 'scsi0', iopsRd: 1000, iopsWr: 1000, mbpsRd: null, mbpsWr: null, inSync: false },
    ])

    expect(vms.find((v: any) => v.vmid === 103)).toBeUndefined()

    const erroredVm = vms.find((v: any) => v.vmid === 104)
    expect(erroredVm).toMatchObject({ name: 'web-04', node: 'pve1', vmstatus: 'running', error: true, disks: [] })
  })
})
