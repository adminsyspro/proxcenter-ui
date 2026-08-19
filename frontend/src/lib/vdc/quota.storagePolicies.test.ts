// src/lib/vdc/quota.storagePolicies.test.ts
//
// Pure-mock unit tests for the per-storage-policy (tier) quota metering
// added to checkVdcQuota: pveFetch, getConnectionById and prisma are all
// mocked, no Postgres needed. Covers the existing global maxStorageMb
// aggregate (unaffected, tested as a non-regression) plus the new
// per-tier check metered from the storage content listing, filtered to
// the vDC pool's members only.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: vi.fn() }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: vi.fn() }))
vi.mock('@/lib/db/prisma', () => ({
  prisma: { connection: { findUnique: vi.fn() } },
}))

import { getConnectionById } from '@/lib/connections/getConnection'
import { prisma } from '@/lib/db/prisma'
import { pveFetch } from '@/lib/proxmox/client'

import { checkVdcQuota, getVdcStorageUsedMb } from './quota'

const pveFetchMock = vi.mocked(pveFetch)
const getConnectionByIdMock = vi.mocked(getConnectionById)
const findUniqueMock = vi.mocked(prisma.connection.findUnique)

const POOL_NAME = 'pool-acme'
const CONNECTION_ID = 'conn-1'

// 32 GiB member disk, matching the content row below (vmid 100 stays inside
// the pool; vmid 999 does not belong to it and must never be counted).
const POOL_MEMBERS = [
  { type: 'qemu', vmid: 100, node: 'pve1', maxdisk: 32 * 1024 ** 3 },
]

const CONTENT_ROWS = [
  { volid: 'ceph-nvme:vm-100-disk-0', vmid: 100, content: 'images', size: 32 * 1024 ** 3 },
  { volid: 'ceph-nvme:vm-999-disk-0', vmid: 999, content: 'images', size: 8 * 1024 ** 3 },
]

const NO_QUOTA = {
  maxVcpus: null, maxRamMb: null, maxStorageMb: null,
  maxVms: null, maxSnapshots: null, maxBackups: null,
}

let contentResponse: any[] | Error = CONTENT_ROWS

beforeEach(() => {
  contentResponse = CONTENT_ROWS
  findUniqueMock.mockReset().mockResolvedValue({ tenantId: 'tenant-1' } as any)
  getConnectionByIdMock.mockReset().mockResolvedValue({ id: CONNECTION_ID } as any)
  pveFetchMock.mockReset().mockImplementation(async (_conn: any, path: any) => {
    if (path === `/pools/${encodeURIComponent(POOL_NAME)}`) {
      return { members: POOL_MEMBERS }
    }
    if (path === '/nodes/pve1/storage/ceph-nvme/content') {
      if (contentResponse instanceof Error) throw contentResponse
      return contentResponse
    }
    throw new Error(`unexpected pveFetch path: ${path}`)
  })
})

describe('checkVdcQuota: per-storage-policy (tier) metering', () => {
  it('reports a violation naming the policy when the tier is full, excluding the volume outside the pool', async () => {
    const policies = [{ policyId: 'p1', name: 'Gold', storageId: 'ceph-nvme', quotaMb: 40960 }]
    const result = await checkVdcQuota(
      CONNECTION_ID, POOL_NAME, NO_QUOTA,
      { type: 'create', addStorageMbByStorage: { 'ceph-nvme': 10240 } },
      policies,
    )
    expect(result.allowed).toBe(false)
    expect(result.violations).toHaveLength(1)
    expect(result.violations[0]).toContain('Gold')
    // 32.0 GB used proves only the vmid-100 volume was counted: if the
    // vmid-999 volume (outside the pool) leaked in, this would read 40.0 GB.
    expect(result.violations[0]).toContain('32.0 GB')
    expect(result.violations[0]).not.toContain('Storage:')
  })

  it('allows the request when the tier has room', async () => {
    const policies = [{ policyId: 'p1', name: 'Gold', storageId: 'ceph-nvme', quotaMb: 40960 }]
    const result = await checkVdcQuota(
      CONNECTION_ID, POOL_NAME, NO_QUOTA,
      { type: 'create', addStorageMbByStorage: { 'ceph-nvme': 4096 } },
      policies,
    )
    expect(result.allowed).toBe(true)
    expect(result.violations).toHaveLength(0)
  })

  it('ignores a storage present in the request but absent from the policy list', async () => {
    const policies = [{ policyId: 'p1', name: 'Gold', storageId: 'ceph-nvme', quotaMb: 40960 }]
    const result = await checkVdcQuota(
      CONNECTION_ID, POOL_NAME, NO_QUOTA,
      { type: 'create', addStorageMbByStorage: { 'other-storage': 999999 } },
      policies,
    )
    expect(result.allowed).toBe(true)
    expect(result.violations).toHaveLength(0)
    expect(pveFetchMock).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('/other-storage/content'),
    )
  })

  it('never violates when the policy quota is null (unmetered tier)', async () => {
    const policies = [{ policyId: 'p1', name: 'Gold', storageId: 'ceph-nvme', quotaMb: null }]
    const result = await checkVdcQuota(
      CONNECTION_ID, POOL_NAME, NO_QUOTA,
      { type: 'create', addStorageMbByStorage: { 'ceph-nvme': 999999 } },
      policies,
    )
    expect(result.allowed).toBe(true)
    expect(result.violations).toHaveLength(0)
  })

  it('fails open (allowed) and warns when the storage content listing errors', async () => {
    contentResponse = new Error('storage offline')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const policies = [{ policyId: 'p1', name: 'Gold', storageId: 'ceph-nvme', quotaMb: 40960 }]
    const result = await checkVdcQuota(
      CONNECTION_ID, POOL_NAME, NO_QUOTA,
      { type: 'create', addStorageMbByStorage: { 'ceph-nvme': 10240 } },
      policies,
    )
    expect(result.allowed).toBe(true)
    expect(result.violations).toHaveLength(0)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('keeps the global maxStorageMb aggregate check working unchanged when storagePolicies/node are omitted', async () => {
    const quota = { ...NO_QUOTA, maxStorageMb: 40960 }
    const result = await checkVdcQuota(
      CONNECTION_ID, POOL_NAME, quota,
      { type: 'create', addStorageMb: 10240 },
    )
    expect(result.allowed).toBe(false)
    expect(result.violations).toHaveLength(1)
    expect(result.violations[0]).toContain('Storage:')
  })
})

describe('getVdcStorageUsedMb', () => {
  it('sums images/rootdir volumes belonging to the pool members only, in MB', async () => {
    const usedMb = await getVdcStorageUsedMb({ id: CONNECTION_ID }, 'pve1', 'ceph-nvme', new Set([100]))
    expect(usedMb).toBe(32768)
  })

  it('returns null and warns when the content listing fails', async () => {
    contentResponse = new Error('boom')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const usedMb = await getVdcStorageUsedMb({ id: CONNECTION_ID }, 'pve1', 'ceph-nvme', new Set([100]))
    expect(usedMb).toBeNull()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
