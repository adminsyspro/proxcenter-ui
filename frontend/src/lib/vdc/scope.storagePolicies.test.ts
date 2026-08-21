/**
 * Postgres-backed tests for the storage-policy additions to `getVdcScope`:
 * a policy's storage joins the existing `storagesByConnection` Set (visible/
 * authorised storage), and its QoS caps land in a new parallel
 * `storagePoliciesByConnection` map, additive only: the pre-existing Set
 * contract is untouched.
 *
 * `getVdcScope` caches per (tenantId, context) for 5s; each `describe` below
 * uses a distinct tenant id so cases can never read another case's cached
 * scope.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest'

import { prismaTest, truncate } from '../../__tests__/setup/prisma-test'
import { clearVdcScopeCache, getVdcScope } from './scope'

const TABLES = [
  'vdc_storage_policies', 'storage_policies', 'vdc_nodes', 'vdcs',
  'provider_connections', 'Connection', 'tenants',
]

afterEach(async () => {
  clearVdcScopeCache()
  await truncate(TABLES)
})

afterAll(async () => {
  await prismaTest.$disconnect()
})

async function addTenant(id: string): Promise<void> {
  const now = new Date()
  await prismaTest.tenant.create({
    data: { id, slug: id, name: id, operatingModel: 'iaas', createdAt: now, updatedAt: now },
  })
}

async function addConnection(id: string): Promise<void> {
  await prismaTest.$transaction(async (tx) => {
    await tx.connection.create({
      data: { id, tenantId: 'default', name: id, baseUrl: `https://${id}`, apiTokenEnc: 'enc' },
    })
    await tx.providerConnection.create({ data: { connectionId: id } })
  })
}

interface VdcOpts {
  id: string
  connectionId: string
  tenantId: string
  primaryStorage?: string | null
}

async function addVdc(opts: VdcOpts): Promise<void> {
  await prismaTest.vdc.create({
    data: {
      id: opts.id,
      tenantId: opts.tenantId,
      connectionId: opts.connectionId,
      name: opts.id,
      slug: opts.id,
      pvePoolName: `pool-${opts.id}`,
      primaryStorage: opts.primaryStorage ?? null,
    },
  })
}

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

async function assignPolicy(vdcId: string, policyId: string, quotaMb: number | null = null): Promise<void> {
  await prismaTest.vdcStoragePolicy.create({
    data: { id: `${vdcId}-${policyId}`, vdcId, policyId, quotaMb },
  })
}

describe('getVdcScope: storage policies', () => {
  it('adds the policy storage to storagesByConnection alongside the primary storage', async () => {
    const tenantId = 'tenant-scope-sp-1'
    await addTenant(tenantId)
    await addConnection('conn-sp-1')
    await addVdc({ id: 'vdc-sp-1', connectionId: 'conn-sp-1', tenantId, primaryStorage: 'ceph-hdd' })
    await addPolicy({ id: 'policy-gold-1', connectionId: 'conn-sp-1', name: 'Gold', storageId: 'ceph-nvme', iopsRd: 5000 })
    await assignPolicy('vdc-sp-1', 'policy-gold-1', 102400)

    const scope = await getVdcScope(tenantId)
    expect(scope).not.toBeNull()

    const storages = scope!.storagesByConnection.get('conn-sp-1')
    expect(storages).toBeDefined()
    expect(storages!.has('ceph-hdd')).toBe(true)
    expect(storages!.has('ceph-nvme')).toBe(true)
  })

  it('carries the QoS caps for the policy storage in storagePoliciesByConnection', async () => {
    const tenantId = 'tenant-scope-sp-2'
    await addTenant(tenantId)
    await addConnection('conn-sp-2')
    await addVdc({ id: 'vdc-sp-2', connectionId: 'conn-sp-2', tenantId, primaryStorage: 'ceph-hdd' })
    await addPolicy({ id: 'policy-gold-2', connectionId: 'conn-sp-2', name: 'Gold', storageId: 'ceph-nvme', iopsRd: 5000 })
    await assignPolicy('vdc-sp-2', 'policy-gold-2', 102400)

    const scope = await getVdcScope(tenantId)
    expect(scope).not.toBeNull()

    const qos = scope!.storagePoliciesByConnection.get('conn-sp-2')
    expect(qos).toBeDefined()
    expect(qos!.get('ceph-nvme')).toEqual({
      policyId: 'policy-gold-2',
      name: 'Gold',
      iopsRd: 5000,
      iopsWr: null,
      mbpsRd: null,
      mbpsWr: null,
    })
  })

  it('does not list a non-policied storage in the QoS map', async () => {
    const tenantId = 'tenant-scope-sp-3'
    await addTenant(tenantId)
    await addConnection('conn-sp-3')
    await addVdc({ id: 'vdc-sp-3', connectionId: 'conn-sp-3', tenantId, primaryStorage: 'ceph-hdd' })
    await addPolicy({ id: 'policy-gold-3', connectionId: 'conn-sp-3', name: 'Gold', storageId: 'ceph-nvme', iopsRd: 5000 })
    await assignPolicy('vdc-sp-3', 'policy-gold-3', 102400)

    const scope = await getVdcScope(tenantId)
    expect(scope).not.toBeNull()

    const qos = scope!.storagePoliciesByConnection.get('conn-sp-3')
    expect(qos).toBeDefined()
    expect(qos!.has('ceph-hdd')).toBe(false)
  })

  // NOTE: the brief's literal setup ("two vDCs of the same tenant on the
  // same connection") is rejected by Postgres: `Vdc` carries
  // `@@unique([tenantId, connectionId])`, so one tenant can only ever have
  // one vDC per connection. The closest reachable equivalent that still
  // exercises the merge/no-duplicate path: two DIFFERENT tenants each with
  // their own vDC on the SAME connection, both assigned to the SAME shared
  // storage policy. Each tenant's own `buildVdcScope` call (scoped by
  // `where: tenantId`) must still resolve to exactly one entry, proving
  // the other tenant's assignment row to the same policy neither duplicates
  // nor leaks across the tenant boundary.
  it('resolves one entry per tenant when two tenants share a connection and a policy (no cross-tenant duplication)', async () => {
    const tenantA = 'tenant-scope-sp-4a'
    const tenantB = 'tenant-scope-sp-4b'
    await addTenant(tenantA)
    await addTenant(tenantB)
    await addConnection('conn-sp-4')
    await addVdc({ id: 'vdc-sp-4a', connectionId: 'conn-sp-4', tenantId: tenantA, primaryStorage: 'ceph-hdd' })
    await addVdc({ id: 'vdc-sp-4b', connectionId: 'conn-sp-4', tenantId: tenantB, primaryStorage: 'ceph-hdd2' })
    await addPolicy({ id: 'policy-gold-4', connectionId: 'conn-sp-4', name: 'Gold', storageId: 'ceph-nvme', iopsRd: 5000 })
    await assignPolicy('vdc-sp-4a', 'policy-gold-4', 102400)
    await assignPolicy('vdc-sp-4b', 'policy-gold-4', 51200)

    const scopeA = await getVdcScope(tenantA)
    expect(scopeA).not.toBeNull()
    const qosA = scopeA!.storagePoliciesByConnection.get('conn-sp-4')
    expect(qosA).toBeDefined()
    expect(qosA!.size).toBe(1)
    expect(qosA!.get('ceph-nvme')?.policyId).toBe('policy-gold-4')

    const scopeB = await getVdcScope(tenantB)
    expect(scopeB).not.toBeNull()
    const qosB = scopeB!.storagePoliciesByConnection.get('conn-sp-4')
    expect(qosB).toBeDefined()
    expect(qosB!.size).toBe(1)
    expect(qosB!.get('ceph-nvme')?.policyId).toBe('policy-gold-4')
  })

  it('leaves the QoS map empty and the storage Set unchanged for a vDC without a policy', async () => {
    const tenantId = 'tenant-scope-sp-5'
    await addTenant(tenantId)
    await addConnection('conn-sp-5')
    await addVdc({ id: 'vdc-sp-5', connectionId: 'conn-sp-5', tenantId, primaryStorage: 'ceph-hdd' })

    const scope = await getVdcScope(tenantId)
    expect(scope).not.toBeNull()

    const storages = scope!.storagesByConnection.get('conn-sp-5')
    expect(storages).toBeDefined()
    expect(Array.from(storages!)).toEqual(['ceph-hdd'])

    const qos = scope!.storagePoliciesByConnection.get('conn-sp-5')
    expect(qos).toBeDefined()
    expect(qos!.size).toBe(0)
  })
})
