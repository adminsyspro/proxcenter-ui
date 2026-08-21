/**
 * Postgres-backed tests for the per-tier usage field on `refreshVdcUsage`
 * (index.ts, spec §7): `usedStorageByStorage` is computed with the same
 * content-listing meter as the enforcement path (`getVdcStorageUsedMb`,
 * quota.ts), scoped to the storages of the vDC's assigned storage
 * policies, and persisted as JSON on `vdc_usage_cache` in both the create
 * and the update branch of the upsert.
 *
 * `@/lib/connections/getConnection` is mocked because the real
 * `getConnectionById` decrypts `apiTokenEnc` and would throw on the fake
 * "enc" value used by the fixtures. `@/lib/proxmox/client` is mocked and
 * routed by path so each test controls the pool members, the live-VM
 * cross-reference (ghost filtering) and the per-storage content listing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { prismaTest, truncate } from '../../__tests__/setup/prisma-test'

const { pveFetchMock, getConnectionByIdMock } = vi.hoisted(() => ({
  pveFetchMock: vi.fn<(...args: any[]) => Promise<any>>(),
  getConnectionByIdMock: vi.fn(async () => ({ id: 'conn1' })),
}))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: any[]) => pveFetchMock(...a) }))
vi.mock('@/lib/proxmox/pbs-client', () => ({ pbsFetch: vi.fn() }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: getConnectionByIdMock }))

import { refreshVdcUsage } from './index'

const TABLES = [
  'vdc_storage_policies', 'storage_policies', 'vdc_usage_cache',
  'vdc_pbs_namespaces', 'vdcs', 'provider_connections', 'Connection', 'tenants',
]

beforeEach(async () => {
  pveFetchMock.mockReset()
  getConnectionByIdMock.mockClear()
  await truncate(TABLES)

  const now = new Date()
  await prismaTest.tenant.create({
    data: { id: 'tenant-1', slug: 'tenant-1', name: 'Test', operatingModel: 'iaas', createdAt: now, updatedAt: now },
  })
  await prismaTest.$transaction(async (tx) => {
    await tx.connection.create({
      data: { id: 'conn1', tenantId: 'default', name: 'pve-1', baseUrl: 'https://pve1', apiTokenEnc: 'enc' },
    })
    await tx.providerConnection.create({ data: { connectionId: 'conn1' } })
  })

  await prismaTest.vdc.create({
    data: {
      id: 'vdc-1',
      tenantId: 'tenant-1',
      connectionId: 'conn1',
      name: 'ACME',
      slug: 'acme',
      pvePoolName: 'pool-vdc-1',
    },
  })
})

async function addPolicy(opts: { id: string; storageId: string }): Promise<void> {
  const now = new Date()
  await prismaTest.storagePolicy.create({
    data: {
      id: opts.id, connectionId: 'conn1', name: opts.id, storageId: opts.storageId,
      createdAt: now, updatedAt: now,
    },
  })
  await prismaTest.vdcStoragePolicy.create({
    data: { id: `assign-${opts.id}`, vdcId: 'vdc-1', policyId: opts.id, quotaMb: null },
  })
}

/** Route pveFetch by path/method; unlisted GETs default to `[]`. */
function stubPve(opts: {
  poolMembers?: any[]
  liveResources?: any[]
  contentByStorage?: Record<string, any[] | 'FAIL'>
}): void {
  const poolMembers = opts.poolMembers ?? []
  const liveResources = opts.liveResources ?? poolMembers.map((m) => ({ type: m.type, vmid: m.vmid }))
  const contentByStorage = opts.contentByStorage ?? {}

  pveFetchMock.mockImplementation(async (_conn: any, path: string) => {
    if (path.startsWith('/pools/')) return { members: poolMembers }
    if (path === '/cluster/resources?type=vm') return liveResources
    if (path.endsWith('/snapshot')) return []
    const contentMatch = path.match(/^\/nodes\/[^/]+\/storage\/([^/]+)\/content$/)
    if (contentMatch) {
      const entry = contentByStorage[contentMatch[1]]
      if (entry === 'FAIL') throw new Error('storage content listing failed')
      return entry ?? []
    }
    return []
  })
}

describe('refreshVdcUsage: usedStorageByStorage (Task 14)', () => {
  it('computes the per-tier usage from the content listing and persists it (create branch)', async () => {
    await addPolicy({ id: 'policy-gold', storageId: 'ceph-nvme' })
    stubPve({
      poolMembers: [{ vmid: 100, type: 'qemu', node: 'node1' }],
      contentByStorage: {
        'ceph-nvme': [{ vmid: 100, content: 'images', size: 1073741824 }], // 1024 MiB
      },
    })

    const usage = await refreshVdcUsage('vdc-1')

    expect(usage.usedStorageByStorage).toEqual({ 'ceph-nvme': 1024 })

    const cached = await prismaTest.vdcUsageCache.findUnique({ where: { vdcId: 'vdc-1' } })
    expect(cached?.usedStorageByStorage).toEqual({ 'ceph-nvme': 1024 })
  })

  it('recomputes usedStorageByStorage on a second refresh (update branch)', async () => {
    await addPolicy({ id: 'policy-gold', storageId: 'ceph-nvme' })
    stubPve({
      poolMembers: [{ vmid: 100, type: 'qemu', node: 'node1' }],
      contentByStorage: { 'ceph-nvme': [{ vmid: 100, content: 'images', size: 1073741824 }] },
    })
    const first = await refreshVdcUsage('vdc-1')
    expect(first.usedStorageByStorage).toEqual({ 'ceph-nvme': 1024 })

    stubPve({
      poolMembers: [{ vmid: 100, type: 'qemu', node: 'node1' }],
      contentByStorage: { 'ceph-nvme': [{ vmid: 100, content: 'images', size: 2147483648 }] }, // 2048 MiB
    })
    const second = await refreshVdcUsage('vdc-1')

    expect(second.usedStorageByStorage).toEqual({ 'ceph-nvme': 2048 })
    const cached = await prismaTest.vdcUsageCache.findUnique({ where: { vdcId: 'vdc-1' } })
    expect(cached?.usedStorageByStorage).toEqual({ 'ceph-nvme': 2048 })
  })

  it('leaves usedStorageByStorage empty when the pool has no VM members (no content-listing call)', async () => {
    await addPolicy({ id: 'policy-gold', storageId: 'ceph-nvme' })
    stubPve({ poolMembers: [] })

    const usage = await refreshVdcUsage('vdc-1')

    expect(usage.usedStorageByStorage).toEqual({})
    expect(pveFetchMock.mock.calls.some(([, path]: any[]) => path.includes('/storage/ceph-nvme/content'))).toBe(false)
  })

  it('skips a storage whose content listing fails, keeps the others (fail-open)', async () => {
    await addPolicy({ id: 'policy-gold', storageId: 'ceph-nvme' })
    await addPolicy({ id: 'policy-silver', storageId: 'ceph-hdd' })
    stubPve({
      poolMembers: [{ vmid: 100, type: 'qemu', node: 'node1' }],
      contentByStorage: {
        'ceph-nvme': 'FAIL',
        'ceph-hdd': [{ vmid: 100, content: 'images', size: 1048576 }], // 1 MiB
      },
    })

    const usage = await refreshVdcUsage('vdc-1')

    expect(usage.usedStorageByStorage).toEqual({ 'ceph-hdd': 1 })
  })
})
