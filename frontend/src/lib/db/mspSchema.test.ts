import { beforeEach, describe, expect, it } from 'vitest'

import { prismaTest, truncate } from '../../__tests__/setup/prisma-test'

const TABLES = ['license_mappings', 'licenses', 'provider_connections', 'vdcs', 'Connection', 'tenants']

async function seedDefaultTenant() {
  const now = new Date()
  await prismaTest.tenant.create({
    data: { id: 'default', slug: 'default', name: 'Provider', createdAt: now, updatedAt: now },
  })
}

beforeEach(async () => {
  await truncate(TABLES)
  await seedDefaultTenant()
})

describe('msp alpha-1 schema', () => {
  it('default tenant keeps operating_model NULL (CHECK allows it)', async () => {
    const t = await prismaTest.tenant.findUnique({ where: { id: 'default' } })
    expect(t?.operatingModel).toBeNull()
  })

  it('rejects a non-default tenant with NULL operating_model (CHECK tenant_default_has_no_model)', async () => {
    const now = new Date()
    await expect(
      prismaTest.tenant.create({
        data: { id: 't-bad', slug: 't-bad', name: 'bad', createdAt: now, updatedAt: now },
      }),
    ).rejects.toThrow()
  })

  it('a default-tenant PVE connection can be added to the provider pool', async () => {
    // The pool-sync deferred trigger fires at commit: Connection + ProviderConnection
    // must land in the same transaction so the invariant holds at commit time.
    await prismaTest.$transaction([
      prismaTest.connection.create({
        data: { id: 'pve-1', tenantId: 'default', type: 'pve', name: 'c1', baseUrl: 'https://x', apiTokenEnc: 'e' },
      }),
      prismaTest.providerConnection.create({ data: { connectionId: 'pve-1' } }),
    ])
    const pc = await prismaTest.providerConnection.findUnique({ where: { connectionId: 'pve-1' } })
    expect(pc).not.toBeNull()
  })

  it('a vDC cannot reference a connection that is NOT in the provider pool (FK restrict)', async () => {
    // A PBS connection is never auto-added to provider_connections (trigger skips non-PVE),
    // so it sits in Connection but not in provider_connections — the FK vdcs->provider_connections
    // should reject the vDC creation.
    await prismaTest.connection.create({
      data: { id: 'pbs-1', tenantId: 'default', type: 'pbs', name: 'pbs', baseUrl: 'https://x', apiTokenEnc: 'e' },
    })
    const now = new Date()
    await prismaTest.tenant.create({
      data: { id: 't-iaas', slug: 't-iaas', name: 'iaas', operatingModel: 'iaas', createdAt: now, updatedAt: now },
    })
    await expect(
      prismaTest.vdc.create({
        data: { id: 'v1', tenantId: 't-iaas', connectionId: 'pbs-1', name: 'V', slug: 'v', pvePoolName: 'p' },
      }),
    ).rejects.toThrow()
  })

  it('cannot remove a pool connection while a vDC references it (ON DELETE RESTRICT)', async () => {
    await prismaTest.$transaction([
      prismaTest.connection.create({
        data: { id: 'pve-3', tenantId: 'default', type: 'pve', name: 'c3', baseUrl: 'https://x', apiTokenEnc: 'e' },
      }),
      prismaTest.providerConnection.create({ data: { connectionId: 'pve-3' } }),
    ])
    const now = new Date()
    await prismaTest.tenant.create({
      data: { id: 't-iaas2', slug: 't-iaas2', name: 'iaas2', operatingModel: 'iaas', createdAt: now, updatedAt: now },
    })
    await prismaTest.vdc.create({
      data: { id: 'v2', tenantId: 't-iaas2', connectionId: 'pve-3', name: 'V', slug: 'v', pvePoolName: 'p' },
    })
    await expect(prismaTest.providerConnection.delete({ where: { connectionId: 'pve-3' } })).rejects.toThrow()
  })

  it('Connection.type is immutable post-create (trigger)', async () => {
    await prismaTest.$transaction([
      prismaTest.connection.create({
        data: { id: 'pve-4', tenantId: 'default', type: 'pve', name: 'c4', baseUrl: 'https://x', apiTokenEnc: 'e' },
      }),
      prismaTest.providerConnection.create({ data: { connectionId: 'pve-4' } }),
    ])
    await expect(
      prismaTest.connection.update({ where: { id: 'pve-4' }, data: { type: 'pbs' } }),
    ).rejects.toThrow(/immutable/)
  })

  it('an iaas tenant cannot directly own a connection (trigger connection_tenant_model_check)', async () => {
    const now = new Date()
    await prismaTest.tenant.create({
      data: { id: 't-iaas3', slug: 't-iaas3', name: 'iaas3', operatingModel: 'iaas', createdAt: now, updatedAt: now },
    })
    await expect(
      prismaTest.connection.create({
        data: { id: 'pve-5', tenantId: 't-iaas3', type: 'pve', name: 'c5', baseUrl: 'https://x', apiTokenEnc: 'e' },
      }),
    ).rejects.toThrow()
  })

  it('only one active primary license is allowed (partial unique index)', async () => {
    const now = new Date()
    const mk = (id: string) => ({
      id, licenseId: id, blob: 'b', edition: 'enterprise', maxNodes: 10,
      expiresAt: now, isPrimary: true, installFingerprint: 'fp', state: 'active',
    })
    await prismaTest.license.create({ data: mk('lic-1') })
    await expect(prismaTest.license.create({ data: mk('lic-2') })).rejects.toThrow()
  })
})
