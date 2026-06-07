import { beforeEach, describe, expect, it } from 'vitest'

import { prismaTest, truncate } from '../../__tests__/setup/prisma-test'

import {
  deleteBinding,
  findBindingByTuple,
  insertBinding,
  insertPveStorage,
  listBindingsForVdc,
  listPveStoragesForBinding,
} from './vdcPbsBindings'

const TABLES = [
  'vdc_pbs_pve_storages',
  'vdc_pbs_namespaces',
  'vdcs',
  'provider_connections',
  'Connection',
  'tenants',
]

beforeEach(async () => {
  await truncate(TABLES)

  const now = new Date()
  await prismaTest.tenant.create({
    data: {
      id: 'tenant-1',
      slug: 'tenant-1',
      name: 'Test Tenant',
      operatingModel: 'iaas',
      createdAt: now,
      updatedAt: now,
    },
  })
  // PVE connection used as vdc.connectionId must be provider-owned and pooled.
  // The deferred pool-sync trigger requires both rows in one transaction.
  await prismaTest.$transaction(async (tx) => {
    await tx.connection.create({
      data: {
        id: 'pve-conn',
        tenantId: 'default',
        name: 'pve-test',
        baseUrl: 'https://pve.test',
        apiTokenEnc: 'enc',
      },
    })
    await tx.providerConnection.create({ data: { connectionId: 'pve-conn' } })
  })
  // PBS connections are not pooled (trigger skips non-PVE types).
  await prismaTest.connection.create({
    data: {
      id: 'pbs-conn',
      tenantId: 'default',
      type: 'pbs',
      name: 'pbs-test',
      baseUrl: 'https://pbs.test',
      apiTokenEnc: 'enc',
    },
  })
  await prismaTest.vdc.create({
    data: {
      id: 'v1',
      tenantId: 'tenant-1',
      connectionId: 'pve-conn',
      name: 'VDC1',
      slug: 'vdc1',
      pvePoolName: 'pool-vdc1',
    },
  })
})

describe('vdcPbsBindings', () => {
  it('inserts and reads a binding', async () => {
    const row = await insertBinding({
      vdcId: 'v1',
      pbsConnectionId: 'pbs-conn',
      datastore: 'store1',
      namespace: 'tenant-x/vdc-y',
      mode: 'auto',
      pbsTokenId: 'root@pam!vdc-abc',
      pbsTokenSecret: 'sekret',
    })
    expect(row.id).toMatch(/^[a-f0-9-]{36}$/)
    const found = await findBindingByTuple('pbs-conn', 'store1', 'tenant-x/vdc-y')
    expect(found?.id).toBe(row.id)
  })

  it('enforces uniqueness on (pbs, ds, ns)', async () => {
    await insertBinding({
      vdcId: 'v1', pbsConnectionId: 'pbs-conn', datastore: 'd', namespace: 'n',
      mode: 'auto', pbsTokenId: 't', pbsTokenSecret: 's',
    })
    await expect(
      insertBinding({
        vdcId: 'v1', pbsConnectionId: 'pbs-conn', datastore: 'd', namespace: 'n',
        mode: 'auto', pbsTokenId: 't', pbsTokenSecret: 's',
      }),
    ).rejects.toThrow()
  })

  it('lists bindings for a vdc', async () => {
    await insertBinding({
      vdcId: 'v1', pbsConnectionId: 'pbs-conn', datastore: 'd', namespace: 'n1',
      mode: 'auto', pbsTokenId: 't', pbsTokenSecret: 's',
    })
    await insertBinding({
      vdcId: 'v1', pbsConnectionId: 'pbs-conn', datastore: 'd', namespace: 'n2',
      mode: 'auto', pbsTokenId: 't', pbsTokenSecret: 's',
    })
    expect(await listBindingsForVdc('v1')).toHaveLength(2)
  })

  it('cascades PVE storages when binding is deleted', async () => {
    const b = await insertBinding({
      vdcId: 'v1', pbsConnectionId: 'pbs-conn', datastore: 'd', namespace: 'n',
      mode: 'auto', pbsTokenId: 't', pbsTokenSecret: 's',
    })
    await insertPveStorage({
      bindingId: b.id, pveConnectionId: 'pve-conn', pveStorageName: 'pbs-acme-prod', managed: true,
    })
    expect(await listPveStoragesForBinding(b.id)).toHaveLength(1)
    await deleteBinding(b.id)
    expect(await listBindingsForVdc('v1')).toHaveLength(0)
  })
})
