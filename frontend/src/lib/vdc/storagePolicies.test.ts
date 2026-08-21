/**
 * Postgres-backed tests for the storage policy domain library: input
 * validation, CRUD (with the P2002 -> friendly-message mapping), the
 * delete-in-use guard, the vDC assignment validator, and the PVE-backed
 * unassign-safety guard (fail-open on cluster errors).
 *
 * `@/lib/proxmox/client` is mocked at module level: `assertPolicyStorageValid`
 * and `assertPolicyUnassignSafe` both call `pveFetch` directly.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { prismaTest, truncate } from '../../__tests__/setup/prisma-test'

const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: any[]) => pveFetchMock(...a) }))

import {
  validateStoragePolicyInput, assertPolicyStorageValid, listStoragePolicies,
  createStoragePolicy, updateStoragePolicy, deleteStoragePolicy,
  validateVdcPolicyAssignments, assertPolicyUnassignSafe, clearScopeCacheForPolicy,
  type StoragePolicyInput,
} from './storagePolicies'

const TABLES = [
  'vdc_storage_policies', 'storage_policies', 'vdc_nodes', 'vdcs',
  'provider_connections', 'Connection', 'tenants',
]

const fakeConn = { baseUrl: 'https://pve1', apiToken: 't' } as any

function validInput(overrides: Partial<StoragePolicyInput> = {}): StoragePolicyInput {
  return { name: 'gold', storageId: 'ceph-nvme', ...overrides }
}

beforeEach(async () => {
  pveFetchMock.mockReset()
  await truncate(TABLES)

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

interface VdcOpts {
  id: string
  connectionId: string
  tenantId?: string
  slug?: string
  name?: string
  pvePoolName?: string
}

async function addVdc(opts: VdcOpts): Promise<void> {
  await prismaTest.vdc.create({
    data: {
      id: opts.id,
      tenantId: opts.tenantId ?? 'tenant-1',
      connectionId: opts.connectionId,
      name: opts.name ?? opts.id,
      slug: opts.slug ?? opts.id,
      pvePoolName: opts.pvePoolName ?? `pool-${opts.id}`,
    },
  })
}

async function addNode(vdcId: string, nodeName: string): Promise<void> {
  await prismaTest.vdcNode.create({ data: { id: `${vdcId}-${nodeName}`, vdcId, nodeName } })
}

async function addPolicy(opts: {
  id: string; connectionId: string; name?: string; storageId?: string
}): Promise<void> {
  const now = new Date()
  await prismaTest.storagePolicy.create({
    data: {
      id: opts.id,
      connectionId: opts.connectionId,
      name: opts.name ?? opts.id,
      storageId: opts.storageId ?? `storage-${opts.id}`,
      createdAt: now,
      updatedAt: now,
    },
  })
}

async function assignPolicy(vdcId: string, policyId: string, quotaMb: number | null = null): Promise<void> {
  await prismaTest.vdcStoragePolicy.create({
    data: { id: `${vdcId}-${policyId}`, vdcId, policyId, quotaMb },
  })
}

describe('validateStoragePolicyInput', () => {
  it('rejects an empty name', () => {
    expect(() => validateStoragePolicyInput(validInput({ name: '' })))
      .toThrow('Storage policy name is required (1-64 characters)')
  })

  it('rejects a name longer than 64 characters', () => {
    expect(() => validateStoragePolicyInput(validInput({ name: 'a'.repeat(65) })))
      .toThrow('Storage policy name is required (1-64 characters)')
  })

  it('rejects a missing storageId', () => {
    expect(() => validateStoragePolicyInput(validInput({ storageId: '' })))
      .toThrow('Storage policy storageId is required')
  })

  it('rejects a zero cap', () => {
    expect(() => validateStoragePolicyInput(validInput({ iopsRd: 0 })))
      .toThrow('Storage policy iopsRd must be a positive integer or null')
  })

  it('rejects a negative cap', () => {
    expect(() => validateStoragePolicyInput(validInput({ mbpsWr: -10 })))
      .toThrow('Storage policy mbpsWr must be a positive integer or null')
  })

  it('rejects a non-integer cap', () => {
    expect(() => validateStoragePolicyInput(validInput({ iopsWr: 12.5 })))
      .toThrow('Storage policy iopsWr must be a positive integer or null')
  })

  it('accepts a purely declarative policy (all caps null)', () => {
    expect(() => validateStoragePolicyInput(validInput({
      iopsRd: null, iopsWr: null, mbpsRd: null, mbpsWr: null,
    }))).not.toThrow()
  })
})

describe('assertPolicyStorageValid', () => {
  it('throws when the storage is not found on the connection', async () => {
    pveFetchMock.mockRejectedValue(new Error('500 no such storage'))
    await expect(assertPolicyStorageValid(fakeConn, 'ceph-nvme'))
      .rejects.toThrow('Storage policy storage "ceph-nvme" not found on this connection')
  })

  it('throws when the storage is not shared', async () => {
    pveFetchMock.mockResolvedValue({ shared: 0, content: 'images,rootdir' })
    await expect(assertPolicyStorageValid(fakeConn, 'local-lvm'))
      .rejects.toThrow('Storage policy storage "local-lvm" must be a shared storage')
  })

  it('throws when the storage advertises neither images nor rootdir content', async () => {
    pveFetchMock.mockResolvedValue({ shared: 1, content: 'backup,iso' })
    await expect(assertPolicyStorageValid(fakeConn, 'ceph-backup'))
      .rejects.toThrow('Storage policy storage "ceph-backup" must advertise images or rootdir content')
  })

  it('accepts a shared storage advertising images content', async () => {
    pveFetchMock.mockResolvedValue({ shared: 1, content: 'images,iso' })
    await expect(assertPolicyStorageValid(fakeConn, 'ceph-nvme')).resolves.toBeUndefined()
  })
})

describe('createStoragePolicy / listStoragePolicies', () => {
  it('creates a policy and relists it', async () => {
    const created = await createStoragePolicy('conn1', validInput({
      name: 'gold', storageId: 'ceph-nvme', iopsRd: 5000, iopsWr: 3000, mbpsRd: 500, mbpsWr: 300,
    }))
    expect(created.name).toBe('gold')
    expect(created.connectionId).toBe('conn1')
    expect(created.iopsRd).toBe(5000)

    const list = await listStoragePolicies('conn1')
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(created.id)
    expect(list[0].storageId).toBe('ceph-nvme')
  })

  it('rejects a duplicate name on the same connection', async () => {
    await createStoragePolicy('conn1', validInput({ name: 'gold', storageId: 'ceph-nvme' }))
    await expect(createStoragePolicy('conn1', validInput({ name: 'gold', storageId: 'ceph-hdd' })))
      .rejects.toThrow('already')
  })

  it('rejects a duplicate storage on the same connection', async () => {
    await createStoragePolicy('conn1', validInput({ name: 'gold', storageId: 'ceph-nvme' }))
    await expect(createStoragePolicy('conn1', validInput({ name: 'silver', storageId: 'ceph-nvme' })))
      .rejects.toThrow('already')
  })

  it('allows the same name on a different connection', async () => {
    await createStoragePolicy('conn1', validInput({ name: 'gold', storageId: 'ceph-nvme' }))
    await expect(createStoragePolicy('conn-2', validInput({ name: 'gold', storageId: 'ceph-nvme' })))
      .resolves.toMatchObject({ name: 'gold', connectionId: 'conn-2' })
  })
})

describe('updateStoragePolicy', () => {
  it('updates fields and bumps updatedAt', async () => {
    const created = await createStoragePolicy('conn1', validInput({ name: 'gold', storageId: 'ceph-nvme' }))
    const updated = await updateStoragePolicy(created.id, validInput({
      name: 'gold-plus', storageId: 'ceph-nvme', iopsRd: 8000,
    }))
    expect(updated.name).toBe('gold-plus')
    expect(updated.iopsRd).toBe(8000)
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(created.updatedAt).getTime())
  })

  it('rejects a rename colliding with another policy on the same connection', async () => {
    await createStoragePolicy('conn1', validInput({ name: 'gold', storageId: 'ceph-nvme' }))
    const silver = await createStoragePolicy('conn1', validInput({ name: 'silver', storageId: 'ceph-hdd' }))
    await expect(updateStoragePolicy(silver.id, validInput({ name: 'gold', storageId: 'ceph-hdd' })))
      .rejects.toThrow('already')
  })

  it('rejects changing storageId while the policy is assigned to a vDC, naming it (Finding I3, spec §10)', async () => {
    await addVdc({ id: 'vdc-1', connectionId: 'conn1', name: 'Acme' })
    const policy = await createStoragePolicy('conn1', validInput({ name: 'gold', storageId: 'ceph-nvme' }))
    await assignPolicy('vdc-1', policy.id)

    await expect(
      updateStoragePolicy(policy.id, validInput({ name: 'gold', storageId: 'ceph-hdd' })),
    ).rejects.toThrow('Storage policy storage cannot be changed while assigned to vDCs: "Acme"')
  })

  it('allows a caps-only edit (same storageId) of a policy assigned to a vDC', async () => {
    await addVdc({ id: 'vdc-1', connectionId: 'conn1', name: 'Acme' })
    const policy = await createStoragePolicy('conn1', validInput({ name: 'gold', storageId: 'ceph-nvme' }))
    await assignPolicy('vdc-1', policy.id)

    const updated = await updateStoragePolicy(policy.id, validInput({
      name: 'gold', storageId: 'ceph-nvme', iopsRd: 9000,
    }))
    expect(updated.iopsRd).toBe(9000)
    expect(updated.storageId).toBe('ceph-nvme')
  })

  it('allows changing storageId when the policy has no vDC assignments', async () => {
    const policy = await createStoragePolicy('conn1', validInput({ name: 'gold', storageId: 'ceph-nvme' }))
    const updated = await updateStoragePolicy(policy.id, validInput({ name: 'gold', storageId: 'ceph-hdd' }))
    expect(updated.storageId).toBe('ceph-hdd')
  })
})

describe('deleteStoragePolicy', () => {
  it('rejects deleting a policy in use by a vDC, naming it', async () => {
    await addVdc({ id: 'vdc-1', connectionId: 'conn1', name: 'Acme' })
    const policy = await createStoragePolicy('conn1', validInput({ name: 'gold', storageId: 'ceph-nvme' }))
    await assignPolicy('vdc-1', policy.id)

    await expect(deleteStoragePolicy(policy.id)).rejects.toThrow('is in use by vDC "Acme"')
  })

  it('deletes an unassigned policy', async () => {
    const policy = await createStoragePolicy('conn1', validInput({ name: 'gold', storageId: 'ceph-nvme' }))
    await expect(deleteStoragePolicy(policy.id)).resolves.toBeUndefined()
    expect(await prismaTest.storagePolicy.findUnique({ where: { id: policy.id } })).toBeNull()
  })
})

describe('validateVdcPolicyAssignments', () => {
  it('rejects a policy belonging to another connection', async () => {
    await addPolicy({ id: 'policy-2', connectionId: 'conn-2' })
    await expect(validateVdcPolicyAssignments('conn1', [{ policyId: 'policy-2', quotaMb: null }]))
      .rejects.toThrow('Storage policy policy-2 does not belong to this connection')
  })

  it('rejects a zero quota', async () => {
    await addPolicy({ id: 'policy-1', connectionId: 'conn1' })
    await expect(validateVdcPolicyAssignments('conn1', [{ policyId: 'policy-1', quotaMb: 0 }]))
      .rejects.toThrow('Storage policy quota must be a positive integer (MB) or null')
  })

  it('rejects a negative quota', async () => {
    await addPolicy({ id: 'policy-1', connectionId: 'conn1' })
    await expect(validateVdcPolicyAssignments('conn1', [{ policyId: 'policy-1', quotaMb: -5 }]))
      .rejects.toThrow('Storage policy quota must be a positive integer (MB) or null')
  })

  it('accepts a null quota', async () => {
    await addPolicy({ id: 'policy-1', connectionId: 'conn1' })
    await expect(validateVdcPolicyAssignments('conn1', [{ policyId: 'policy-1', quotaMb: null }]))
      .resolves.toBeUndefined()
  })

  it('rejects a policyId duplicated in the payload', async () => {
    await addPolicy({ id: 'policy-1', connectionId: 'conn1' })
    await expect(validateVdcPolicyAssignments('conn1', [
      { policyId: 'policy-1', quotaMb: null },
      { policyId: 'policy-1', quotaMb: 100 },
    ])).rejects.toThrow('Storage policy policy-1 is listed twice')
  })
})

describe('assertPolicyUnassignSafe', () => {
  it('throws listing the VMID still holding a volume on the removed storage', async () => {
    await addVdc({ id: 'vdc-1', connectionId: 'conn1', pvePoolName: 'pool-vdc-1' })
    await addNode('vdc-1', 'node1')
    await addPolicy({ id: 'policy-1', connectionId: 'conn1', name: 'gold', storageId: 'ceph-nvme' })
    await assignPolicy('vdc-1', 'policy-1')

    pveFetchMock.mockImplementation(async (_conn: any, path: string) => {
      if (path === '/nodes/node1/storage/ceph-nvme/content') {
        return [{ vmid: 100, content: 'images', size: 1073741824 }]
      }
      if (path === '/pools/pool-vdc-1') {
        return { members: [{ vmid: 100, type: 'qemu', node: 'node1' }] }
      }
      return []
    })

    await expect(assertPolicyUnassignSafe('vdc-1', new Set(), fakeConn))
      .rejects.toThrow('Cannot remove storage policy "gold": VMs 100 still hold volumes on "ceph-nvme"')
  })

  it('resolves when the removed storage has no images/rootdir volumes', async () => {
    await addVdc({ id: 'vdc-1', connectionId: 'conn1', pvePoolName: 'pool-vdc-1' })
    await addNode('vdc-1', 'node1')
    await addPolicy({ id: 'policy-1', connectionId: 'conn1', name: 'gold', storageId: 'ceph-nvme' })
    await assignPolicy('vdc-1', 'policy-1')

    pveFetchMock.mockResolvedValue([])

    await expect(assertPolicyUnassignSafe('vdc-1', new Set(), fakeConn)).resolves.toBeUndefined()
  })

  it('is fail-open on a PVE error (does not block the admin on an unreachable cluster)', async () => {
    await addVdc({ id: 'vdc-1', connectionId: 'conn1', pvePoolName: 'pool-vdc-1' })
    await addNode('vdc-1', 'node1')
    await addPolicy({ id: 'policy-1', connectionId: 'conn1', name: 'gold', storageId: 'ceph-nvme' })
    await assignPolicy('vdc-1', 'policy-1')

    pveFetchMock.mockRejectedValue(new Error('500 connection refused'))

    await expect(assertPolicyUnassignSafe('vdc-1', new Set(), fakeConn)).resolves.toBeUndefined()
  })

  it('does not check storages for policies still kept', async () => {
    await addVdc({ id: 'vdc-1', connectionId: 'conn1', pvePoolName: 'pool-vdc-1' })
    await addNode('vdc-1', 'node1')
    await addPolicy({ id: 'policy-1', connectionId: 'conn1', name: 'gold', storageId: 'ceph-nvme' })
    await assignPolicy('vdc-1', 'policy-1')

    await expect(assertPolicyUnassignSafe('vdc-1', new Set(['policy-1']), fakeConn)).resolves.toBeUndefined()
    expect(pveFetchMock).not.toHaveBeenCalled()
  })
})

describe('clearScopeCacheForPolicy', () => {
  it('resolves without throwing for a policy assigned to a vDC', async () => {
    await addVdc({ id: 'vdc-1', connectionId: 'conn1' })
    await addPolicy({ id: 'policy-1', connectionId: 'conn1' })
    await assignPolicy('vdc-1', 'policy-1')

    await expect(clearScopeCacheForPolicy('policy-1')).resolves.toBeUndefined()
  })

  it('resolves for an unassigned policy', async () => {
    await addPolicy({ id: 'policy-1', connectionId: 'conn1' })
    await expect(clearScopeCacheForPolicy('policy-1')).resolves.toBeUndefined()
  })
})
