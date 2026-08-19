/**
 * Postgres-backed tests for the `storagePolicies` assignment payload on
 * createVdc/updateVdc/getVdcById (index.ts): the create-time validation runs
 * BEFORE any PVE side effect (pool/zone creation), the DTO read-back exposes
 * the joined policy fields, and update honours the `[]` purge vs. absent-key
 * untouched contract (exact vlanPools pattern) plus the unassign-safety guard.
 *
 * `@/lib/connections/getConnection` is mocked because the real
 * `getConnectionById` decrypts `apiTokenEnc` and would throw on the fake
 * "enc" value used by the fixtures. `@/lib/proxmox/client` is mocked so pool
 * creation, zone creation and applySdn are no-ops (and so their absence can
 * be asserted on the cross-connection-policy rejection test).
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

import { createVdc, updateVdc, getVdcById } from './index'
import type { CreateVdcInput } from './types'

const TABLES = [
  'vdc_storage_policies', 'storage_policies', 'vdc_usage_cache', 'vdc_shared_bridges',
  'vdc_vlan_pools', 'vdc_nodes', 'vdc_vnets', 'vdcs',
  'provider_connections', 'Connection', 'tenants',
]

beforeEach(async () => {
  pveFetchMock.mockReset()
  getConnectionByIdMock.mockClear()
  await truncate(TABLES)

  // Every PVE call (pool create, zone create, applySdn) succeeds. Most GET
  // endpoints touched by the create path expect an array response
  // (/cluster/status peers lookup inside createZone, /content listings);
  // only the pool-members lookup returns an object shape.
  pveFetchMock.mockImplementation(async (_conn: any, path: string, init: any = {}) => {
    const method = String(init?.method || 'GET').toUpperCase()
    if (method === 'GET' && path.startsWith('/pools/')) return { members: [] }
    if (method === 'GET') return []
    return {}
  })

  const now = new Date()
  await prismaTest.tenant.create({
    data: { id: 'tenant-1', slug: 'tenant-1', name: 'Test', operatingModel: 'iaas', createdAt: now, updatedAt: now },
  })
  await prismaTest.$transaction(async (tx) => {
    await tx.connection.createMany({
      data: [
        { id: 'conn1', tenantId: 'default', name: 'pve-1', baseUrl: 'https://pve1', apiTokenEnc: 'enc' },
        { id: 'conn-2', tenantId: 'default', name: 'pve-2', baseUrl: 'https://pve2', apiTokenEnc: 'enc' },
      ],
    })
    await tx.providerConnection.createMany({
      data: [{ connectionId: 'conn1' }, { connectionId: 'conn-2' }],
    })
  })
})

async function addPolicy(opts: {
  id: string; connectionId: string; name?: string; storageId?: string
  iopsRd?: number | null; iopsWr?: number | null; mbpsRd?: number | null; mbpsWr?: number | null
}): Promise<void> {
  const now = new Date()
  await prismaTest.storagePolicy.create({
    data: {
      id: opts.id,
      connectionId: opts.connectionId,
      name: opts.name ?? opts.id,
      storageId: opts.storageId ?? `storage-${opts.id}`,
      iopsRd: opts.iopsRd ?? null,
      iopsWr: opts.iopsWr ?? null,
      mbpsRd: opts.mbpsRd ?? null,
      mbpsWr: opts.mbpsWr ?? null,
      createdAt: now,
      updatedAt: now,
    },
  })
}

const baseInput: CreateVdcInput = {
  tenantId: 'tenant-1',
  connectionId: 'conn1',
  name: 'ACME',
  slug: 'acme',
  nodes: ['node1'],
  primaryStorage: 'ceph-hdd',
}

describe('createVdc: storagePolicies', () => {
  it('creates the assignment; read-back exposes the joined policy fields', async () => {
    await addPolicy({
      id: 'policy-gold', connectionId: 'conn1', name: 'Gold', storageId: 'ceph-nvme',
      iopsRd: 5000, iopsWr: 3000, mbpsRd: 500, mbpsWr: 300,
    })

    const vdc = await createVdc(
      { ...baseInput, storagePolicies: [{ policyId: 'policy-gold', quotaMb: 102400 }] },
      null,
    )

    expect(vdc.storagePolicies).toEqual([
      {
        policyId: 'policy-gold',
        name: 'Gold',
        storageId: 'ceph-nvme',
        iopsRd: 5000,
        iopsWr: 3000,
        mbpsRd: 500,
        mbpsWr: 300,
        quotaMb: 102400,
      },
    ])

    // Independent read confirms the DTO shape survives a fresh fetch too.
    const reread = await getVdcById(vdc.id)
    expect(reread?.storagePolicies).toEqual(vdc.storagePolicies)
  })

  it('rejects a policy belonging to another connection, before any PVE side effect', async () => {
    await addPolicy({ id: 'policy-foreign', connectionId: 'conn-2' })

    await expect(
      createVdc(
        { ...baseInput, storagePolicies: [{ policyId: 'policy-foreign', quotaMb: null }] },
        null,
      ),
    ).rejects.toThrow('Storage policy policy-foreign does not belong to this connection')

    // Pool creation / zone creation / getConnectionById never ran.
    expect(pveFetchMock).not.toHaveBeenCalled()
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
    expect(await prismaTest.vdc.count()).toBe(0)
  })

  it('does not touch vdc_storage_policies when storagePolicies is omitted', async () => {
    const vdc = await createVdc(baseInput, null)
    expect(vdc.storagePolicies).toEqual([])
  })
})

describe('updateVdc: storagePolicies', () => {
  it('purges every assignment when storagePolicies is an empty array', async () => {
    await addPolicy({ id: 'policy-gold', connectionId: 'conn1', name: 'Gold', storageId: 'ceph-nvme' })
    const vdc = await createVdc(
      { ...baseInput, storagePolicies: [{ policyId: 'policy-gold', quotaMb: null }] },
      null,
    )
    expect(vdc.storagePolicies).toHaveLength(1)

    const updated = await updateVdc(vdc.id, { storagePolicies: [] })
    expect(updated.storagePolicies).toEqual([])
  })

  it('leaves vdc_storage_policies untouched when storagePolicies is not part of the update', async () => {
    await addPolicy({ id: 'policy-gold', connectionId: 'conn1', name: 'Gold', storageId: 'ceph-nvme' })
    const vdc = await createVdc(
      { ...baseInput, storagePolicies: [{ policyId: 'policy-gold', quotaMb: 2048 }] },
      null,
    )

    const updated = await updateVdc(vdc.id, { name: 'ACME Renamed' })
    expect(updated.storagePolicies).toEqual(vdc.storagePolicies)
  })

  it('rejects removing a policy whose storage still holds volumes on the vDC pool', async () => {
    await addPolicy({ id: 'policy-gold', connectionId: 'conn1', name: 'Gold', storageId: 'ceph-nvme' })
    const vdc = await createVdc(
      { ...baseInput, storagePolicies: [{ policyId: 'policy-gold', quotaMb: null }] },
      null,
    )

    pveFetchMock.mockImplementation(async (_conn: any, path: string) => {
      if (path === '/nodes/node1/storage/ceph-nvme/content') {
        return [{ vmid: 100, content: 'images', size: 1073741824 }]
      }
      if (path === `/pools/${vdc.pvePoolName}`) {
        return { members: [{ vmid: 100, type: 'qemu', node: 'node1' }] }
      }
      return []
    })

    await expect(updateVdc(vdc.id, { storagePolicies: [] }))
      .rejects.toThrow('Cannot remove storage policy "Gold": VMs 100 still hold volumes on "ceph-nvme"')

    // The rejected guard must not have purged the assignment.
    const stillThere = await getVdcById(vdc.id)
    expect(stillThere?.storagePolicies).toHaveLength(1)
  })

  it('rejects assigning a policy from another connection on update', async () => {
    await addPolicy({ id: 'policy-foreign', connectionId: 'conn-2' })
    const vdc = await createVdc(baseInput, null)

    await expect(
      updateVdc(vdc.id, { storagePolicies: [{ policyId: 'policy-foreign', quotaMb: null }] }),
    ).rejects.toThrow('Storage policy policy-foreign does not belong to this connection')
  })
})
