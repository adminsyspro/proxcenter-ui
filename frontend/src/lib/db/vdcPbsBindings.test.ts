import { randomUUID } from 'crypto'

import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { decryptSecret, encryptSecret } from '@/lib/crypto/secret'

import { prismaTest, truncate } from '../../__tests__/setup/prisma-test'

import {
  deleteBinding,
  deleteBindingIfExists,
  findBindingByTuple,
  insertBinding,
  insertPveStorage,
  isEncryptedPbsTokenSecret,
  listBindingsForTenant,
  listBindingsForVdc,
  listPveStoragesForBinding,
  protectPbsTokenSecret,
  revealPbsTokenSecret,
  updateBindingToken,
} from './vdcPbsBindings'

// The token secret column is encrypted under APP_SECRET, like every other
// credential; vitest does not load .env, so the key is pinned here.
beforeAll(() => {
  process.env.APP_SECRET = 'vdc-pbs-bindings-test-secret'
})

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
  // IaaS tenant (tenant-1) + its vDC
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
  // Provider-pool PBS connection (tenantId = 'default')
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

  // MSP tenant + its dedicated PBS connection (tenantId = 'msp-1')
  await prismaTest.tenant.create({
    data: {
      id: 'msp-1',
      slug: 'msp-1',
      name: 'MSP Tenant',
      operatingModel: 'msp',
      createdAt: now,
      updatedAt: now,
    },
  })
  await prismaTest.connection.create({
    data: {
      id: 'pbs-msp',
      tenantId: 'msp-1',
      type: 'pbs',
      name: 'pbs-msp',
      baseUrl: 'https://pbs-msp.test',
      apiTokenEnc: 'enc',
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

  it('updateBindingToken completes a placeholder and throws once the row is gone', async () => {
    const row = await insertBinding({
      vdcId: 'v1', pbsConnectionId: 'pbs-conn', datastore: 'd2', namespace: 'n2',
      mode: 'auto', pbsTokenId: null, pbsTokenSecret: null,
    })
    expect(row.pbsTokenSecret).toBeNull()

    await updateBindingToken(row.id, 'root@pam!vdc-abc', 'sek')
    const found = await findBindingByTuple('pbs-conn', 'd2', 'n2')
    expect(found?.pbsTokenId).toBe('root@pam!vdc-abc')
    expect(found?.pbsTokenSecret).toBe('sek')

    // The minted secret lands encrypted, never in clear.
    const raw = await prismaTest.vdcPbsNamespace.findUniqueOrThrow({ where: { id: row.id } })
    expect(raw.pbsTokenSecret).not.toBe('sek')
    expect(isEncryptedPbsTokenSecret(raw.pbsTokenSecret as string)).toBe(true)
    expect(decryptSecret(raw.pbsTokenSecret as string)).toBe('sek')

    await deleteBinding(row.id)
    await expect(updateBindingToken(row.id, 'x', 'y')).rejects.toThrow()
  })

  it('stores the token secret encrypted at rest and reveals it on every read path', async () => {
    const row = await insertBinding({
      vdcId: 'v1', pbsConnectionId: 'pbs-conn', datastore: 'd3', namespace: 'n3',
      mode: 'auto', pbsTokenId: 'root@pam!vdc-abc', pbsTokenSecret: 'f2b1c0de-0000-4000-8000-00000000abcd',
    })
    expect(row.pbsTokenSecret).toBe('f2b1c0de-0000-4000-8000-00000000abcd')

    const raw = await prismaTest.vdcPbsNamespace.findUniqueOrThrow({ where: { id: row.id } })
    expect(raw.pbsTokenSecret).not.toContain('f2b1c0de')
    expect(decryptSecret(raw.pbsTokenSecret as string)).toBe('f2b1c0de-0000-4000-8000-00000000abcd')

    expect((await findBindingByTuple('pbs-conn', 'd3', 'n3'))?.pbsTokenSecret).toBe('f2b1c0de-0000-4000-8000-00000000abcd')
    expect((await listBindingsForVdc('v1'))[0].pbsTokenSecret).toBe('f2b1c0de-0000-4000-8000-00000000abcd')
    expect((await listBindingsForTenant('tenant-1'))[0].pbsTokenSecret).toBe('f2b1c0de-0000-4000-8000-00000000abcd')
  })

  it('keeps reading a legacy row whose secret was stored in clear', async () => {
    await prismaTest.vdcPbsNamespace.create({
      data: {
        id: randomUUID(), vdcId: 'v1', pbsConnectionId: 'pbs-conn', datastore: 'd4', namespace: 'n4',
        mode: 'auto', pbsTokenId: 'root@pam!legacy', pbsTokenSecret: 'legacy-plain-secret',
      },
    })
    const found = await findBindingByTuple('pbs-conn', 'd4', 'n4')
    expect(found?.pbsTokenSecret).toBe('legacy-plain-secret')

    // Its next token write re-encrypts it.
    await updateBindingToken(found!.id, 'root@pam!legacy', 'rotated')
    const raw = await prismaTest.vdcPbsNamespace.findUniqueOrThrow({ where: { id: found!.id } })
    expect(isEncryptedPbsTokenSecret(raw.pbsTokenSecret as string)).toBe(true)
    expect((await findBindingByTuple('pbs-conn', 'd4', 'n4'))?.pbsTokenSecret).toBe('rotated')
  })

  it('deleteBindingIfExists is a no-op on a missing row', async () => {
    await expect(deleteBindingIfExists(randomUUID())).resolves.toBeUndefined()
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

  it('rejects insertBinding when the PBS is owned by an MSP tenant', async () => {
    await expect(
      insertBinding({
        vdcId: 'v1',
        pbsConnectionId: 'pbs-msp',
        datastore: 'store1',
        namespace: 'ns1',
        mode: 'auto',
      }),
    ).rejects.toThrow(/can only target provider-pool PBS/)

    // No row must have been created
    const rows = await prismaTest.vdcPbsNamespace.findMany({ where: { pbsConnectionId: 'pbs-msp' } })
    expect(rows).toHaveLength(0)
  })

  it('allows insertBinding when the PBS is provider-pool-owned (tenantId = default)', async () => {
    const row = await insertBinding({
      vdcId: 'v1',
      pbsConnectionId: 'pbs-conn',
      datastore: 'store2',
      namespace: 'ns2',
      mode: 'auto',
    })
    expect(row.pbsConnectionId).toBe('pbs-conn')
    const rows = await prismaTest.vdcPbsNamespace.findMany({ where: { pbsConnectionId: 'pbs-conn' } })
    expect(rows).toHaveLength(1)
  })
})

describe('token secret at rest', () => {
  it('recognises the encryptSecret shape and nothing else', () => {
    expect(isEncryptedPbsTokenSecret(encryptSecret('x'))).toBe(true)
    // A PBS token secret is a UUID: no dots, never mistaken for ciphertext.
    expect(isEncryptedPbsTokenSecret('f2b1c0de-0000-4000-8000-00000000abcd')).toBe(false)
    expect(isEncryptedPbsTokenSecret('a.b.c')).toBe(false)
    expect(isEncryptedPbsTokenSecret('')).toBe(false)
    // Three base64 parts, but not a 12-byte IV and a 16-byte tag.
    expect(isEncryptedPbsTokenSecret('YWJj.YWJj.YWJj')).toBe(false)
  })

  it('protect and reveal round-trip, keep null, and pass a plaintext through', () => {
    expect(protectPbsTokenSecret(null)).toBeNull()
    expect(protectPbsTokenSecret(undefined)).toBeNull()
    expect(revealPbsTokenSecret(null)).toBeNull()
    expect(revealPbsTokenSecret(undefined)).toBeNull()

    const stored = protectPbsTokenSecret('s3cr3t') as string
    expect(stored).not.toBe('s3cr3t')
    expect(revealPbsTokenSecret(stored)).toBe('s3cr3t')
    expect(revealPbsTokenSecret('legacy-plain')).toBe('legacy-plain')
  })
})

describe('DB trigger: vdc_pbs_binding_pool_check (race-proof direction A)', () => {
  // These tests bypass the app-level insertBinding guard and write directly via
  // Prisma, exercising only the DB trigger. A successful RAISE from the trigger
  // is what we want to see.

  it('trigger rejects a direct vdcPbsNamespace create targeting an MSP-owned PBS', async () => {
    // Attempt a raw Prisma create that bypasses insertBinding's app guard.
    await expect(
      prismaTest.vdcPbsNamespace.create({
        data: {
          id: randomUUID(),
          vdcId: 'v1',
          pbsConnectionId: 'pbs-msp', // MSP-owned: tenantId = 'msp-1'
          datastore: 'ds-trigger',
          namespace: 'ns-trigger',
          mode: 'auto',
        },
      }),
    ).rejects.toThrow(/not the provider pool/)

    // Confirm no row was inserted despite the bypass attempt
    const rows = await prismaTest.vdcPbsNamespace.findMany({ where: { pbsConnectionId: 'pbs-msp' } })
    expect(rows).toHaveLength(0)
  })

  it('trigger allows a direct vdcPbsNamespace create targeting a provider-pool PBS', async () => {
    const id = randomUUID()
    await expect(
      prismaTest.vdcPbsNamespace.create({
        data: {
          id,
          vdcId: 'v1',
          pbsConnectionId: 'pbs-conn', // provider-pool: tenantId = 'default'
          datastore: 'ds-trigger-ok',
          namespace: 'ns-trigger-ok',
          mode: 'auto',
        },
      }),
    ).resolves.not.toThrow()
    await prismaTest.vdcPbsNamespace.delete({ where: { id } })
  })

  it('trigger rejects a direct vdcPbsNamespace create targeting a PVE (non-PBS) connection', async () => {
    // pve-conn is type='pve' (default), owned by tenantId='default'.
    // The hardened trigger now checks type='pbs' before owner, so this must raise.
    await expect(
      prismaTest.vdcPbsNamespace.create({
        data: {
          id: randomUUID(),
          vdcId: 'v1',
          pbsConnectionId: 'pve-conn', // PVE, not PBS
          datastore: 'ds-pve-type',
          namespace: 'ns-pve-type',
          mode: 'auto',
        },
      }),
    ).rejects.toThrow(/expected pbs/)

    const rows = await prismaTest.vdcPbsNamespace.findMany({ where: { pbsConnectionId: 'pve-conn' } })
    expect(rows).toHaveLength(0)
  })

  it('trigger rejects a direct vdcPbsNamespace create targeting a non-existent connection id', async () => {
    const ghostId = randomUUID()
    await expect(
      prismaTest.vdcPbsNamespace.create({
        data: {
          id: randomUUID(),
          vdcId: 'v1',
          pbsConnectionId: ghostId, // does not exist in Connection table
          datastore: 'ds-ghost',
          namespace: 'ns-ghost',
          mode: 'auto',
        },
      }),
    ).rejects.toThrow(/does not exist/)

    const rows = await prismaTest.vdcPbsNamespace.findMany({ where: { pbsConnectionId: ghostId } })
    expect(rows).toHaveLength(0)
  })
})

describe('DB trigger: connection_delete_pbs_bindings (orphan-clean on delete)', () => {
  it('deleting a PBS connection removes its vdc_pbs_namespaces bindings and their pve-storage children', async () => {
    // Seed a dedicated PBS connection owned by the provider pool
    const pbsId = randomUUID()
    await prismaTest.connection.create({
      data: {
        id: pbsId,
        tenantId: 'default',
        type: 'pbs',
        name: 'pbs-delete-test',
        baseUrl: 'https://pbs-delete.test',
        apiTokenEnc: 'enc',
      },
    })

    // Bind it to vDC v1
    const binding = await insertBinding({
      vdcId: 'v1',
      pbsConnectionId: pbsId,
      datastore: 'store-del',
      namespace: 'ns-del',
      mode: 'auto',
      pbsTokenId: 'tok',
      pbsTokenSecret: 'sec',
    })

    // Attach a PVE storage child to the binding
    const storage = await insertPveStorage({
      bindingId: binding.id,
      pveConnectionId: 'pve-conn',
      pveStorageName: 'pbs-del-storage',
      managed: true,
    })
    expect(storage.id).toBeTruthy()

    // Delete the PBS connection -- trigger must clean up bindings + cascaded storage rows
    await prismaTest.connection.delete({ where: { id: pbsId } })

    // Binding row must be gone (no orphan)
    const orphanBindings = await prismaTest.vdcPbsNamespace.findMany({
      where: { pbsConnectionId: pbsId },
    })
    expect(orphanBindings).toHaveLength(0)

    // Child PVE storage row must also be gone (cascaded from namespace deletion)
    const orphanStorages = await prismaTest.vdcPbsPveStorage.findMany({
      where: { id: storage.id },
    })
    expect(orphanStorages).toHaveLength(0)
  })

  it('deleting a PBS connection with no bindings succeeds cleanly', async () => {
    const pbsId = randomUUID()
    await prismaTest.connection.create({
      data: {
        id: pbsId,
        tenantId: 'default',
        type: 'pbs',
        name: 'pbs-empty-delete',
        baseUrl: 'https://pbs-empty.test',
        apiTokenEnc: 'enc',
      },
    })
    // No bindings seeded; delete must not raise
    await expect(
      prismaTest.connection.delete({ where: { id: pbsId } }),
    ).resolves.not.toThrow()
  })
})

describe('DB trigger: connection_pbs_binding_check (race-proof direction B)', () => {
  // Tests that a PBS connection cannot be reassigned to a non-default tenant
  // while a vDC namespace binding still references it.

  it('trigger rejects UPDATE tenant_id on PBS that has active vDC bindings', async () => {
    // Insert a valid binding on the provider-pool PBS
    const b = await insertBinding({
      vdcId: 'v1',
      pbsConnectionId: 'pbs-conn',
      datastore: 'ds-b',
      namespace: 'ns-b',
      mode: 'auto',
    })

    // Attempting to move pbs-conn to an MSP tenant must be rejected by the trigger
    await expect(
      prismaTest.connection.update({
        where: { id: 'pbs-conn' },
        data: { tenantId: 'msp-1' },
      }),
    ).rejects.toThrow(/vDC namespace binding/)

    // Confirm the binding still references pbs-conn (no partial state)
    const rows = await prismaTest.vdcPbsNamespace.findMany({ where: { id: b.id } })
    expect(rows).toHaveLength(1)
    expect(rows[0].pbsConnectionId).toBe('pbs-conn')
  })

  it('trigger allows reassigning PBS to non-default tenant when no bindings exist', async () => {
    // Use a dedicated bare PBS connection with no bindings.
    const bareId = randomUUID()
    await prismaTest.connection.create({
      data: {
        id: bareId,
        tenantId: 'default',
        type: 'pbs',
        name: 'pbs-bare',
        baseUrl: 'https://pbs-bare.test',
        apiTokenEnc: 'enc',
      },
    })
    // No bindings on bareId; our trigger (connection_pbs_binding_check) should NOT raise.
    // The update succeeds entirely -- no other trigger blocks a PBS move to an MSP tenant.
    const updated = await prismaTest.connection.update({
      where: { id: bareId },
      data: { tenantId: 'msp-1' },
    })
    expect(updated.tenantId).toBe('msp-1')
  })
})
