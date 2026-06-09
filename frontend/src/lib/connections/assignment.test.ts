import { beforeEach, describe, expect, it, vi } from 'vitest'

import { prismaTest, truncate } from '../../__tests__/setup/prisma-test'

// Wire the module-under-test to use the test-schema Prisma client instead of
// the production singleton. This must happen before any import of assignment.ts.
vi.mock('@/lib/db/prisma', () => ({ prisma: prismaTest }))

// Import AFTER the mock is registered
const { assignConnectionToMspTenant, releaseConnectionToProviderPool } = await import('./assignment')

const TABLES = ['license_mappings', 'licenses', 'vdc_pbs_namespaces', 'provider_connections', 'vdcs', 'ManagedHost', 'Connection', 'tenants']

async function seedDefault() {
  const now = new Date()
  await prismaTest.tenant.upsert({
    where: { id: 'default' },
    create: { id: 'default', slug: 'default', name: 'Provider', createdAt: now, updatedAt: now },
    update: {},
  })
}

async function seedMspTenant(id: string) {
  const now = new Date()
  await prismaTest.tenant.create({
    data: { id, slug: id, name: id, operatingModel: 'msp', createdAt: now, updatedAt: now },
  })
}

async function seedIaasTenant(id: string) {
  const now = new Date()
  await prismaTest.tenant.create({
    data: { id, slug: id, name: id, operatingModel: 'iaas', createdAt: now, updatedAt: now },
  })
}

/**
 * Seed a PVE connection + its provider_connections row in one transaction so
 * the deferred pool-sync trigger is satisfied at COMMIT time.
 */
async function seedDefaultPveConnection(id: string) {
  await prismaTest.$transaction([
    prismaTest.connection.create({
      data: { id, tenantId: 'default', type: 'pve', name: id, baseUrl: 'https://x', apiTokenEnc: 'e' },
    }),
    prismaTest.providerConnection.create({ data: { connectionId: id } }),
  ])
}

async function seedPbsConnection(id: string, tenantId = 'default') {
  await prismaTest.connection.create({
    data: { id, tenantId, type: 'pbs', name: id, baseUrl: 'https://x', apiTokenEnc: 'e' },
  })
}

beforeEach(async () => {
  await truncate(TABLES)
  await seedDefault()
})

describe('assignConnectionToMspTenant', () => {
  it('assigns a pooled PVE connection to an MSP tenant: tenant_id changes and pool row is removed', async () => {
    await seedDefaultPveConnection('pve-1')
    await seedMspTenant('msp-1')

    await assignConnectionToMspTenant('pve-1', 'msp-1')

    const conn = await prismaTest.connection.findUnique({ where: { id: 'pve-1' }, select: { tenantId: true } })
    expect(conn?.tenantId).toBe('msp-1')

    const pc = await prismaTest.providerConnection.findUnique({ where: { connectionId: 'pve-1' } })
    expect(pc).toBeNull()
  })

  it('assigns a PBS connection (no pool row) to an MSP tenant', async () => {
    await seedPbsConnection('pbs-1')
    await seedMspTenant('msp-2')

    await assignConnectionToMspTenant('pbs-1', 'msp-2')

    const conn = await prismaTest.connection.findUnique({ where: { id: 'pbs-1' }, select: { tenantId: true } })
    expect(conn?.tenantId).toBe('msp-2')

    // No pool row should exist (PBS connections are never pooled)
    const pc = await prismaTest.providerConnection.findUnique({ where: { connectionId: 'pbs-1' } })
    expect(pc).toBeNull()
  })

  it('throws when trying to assign a PVE connection that a vDC references (FK RESTRICT on pool row)', async () => {
    await seedDefaultPveConnection('pve-vdc')
    await seedIaasTenant('iaas-1')
    await prismaTest.vdc.create({
      data: { id: 'vdc-1', tenantId: 'iaas-1', connectionId: 'pve-vdc', name: 'V', slug: 'v', pvePoolName: 'p' },
    })
    await seedMspTenant('msp-3')

    await expect(assignConnectionToMspTenant('pve-vdc', 'msp-3')).rejects.toThrow()

    // Connection must still be owned by default
    const conn = await prismaTest.connection.findUnique({ where: { id: 'pve-vdc' }, select: { tenantId: true } })
    expect(conn?.tenantId).toBe('default')
  })

  it('throws when assigning a PBS connection that has vDC namespace bindings (tenant-isolation guard)', async () => {
    // Seed a PBS connection in the provider pool
    await seedPbsConnection('pbs-bound')
    // Seed an IaaS tenant + a PVE connection it owns (needed to create the vDC)
    await seedIaasTenant('iaas-pbs')
    await seedDefaultPveConnection('pve-for-iaas-pbs')
    // The vDC must be owned by the IaaS tenant and reference the PVE connection
    await prismaTest.vdc.create({
      data: { id: 'vdc-pbs-1', tenantId: 'iaas-pbs', connectionId: 'pve-for-iaas-pbs', name: 'V', slug: 'vdc-pbs-1', pvePoolName: 'p' },
    })
    // Seed the VdcPbsNamespace row binding this IaaS vDC to the PBS connection
    await prismaTest.vdcPbsNamespace.create({
      data: {
        id: 'vpn-1',
        vdcId: 'vdc-pbs-1',
        pbsConnectionId: 'pbs-bound',
        datastore: 'backup',
        namespace: 'ns1',
      },
    })
    await seedMspTenant('msp-pbs-1')

    await expect(assignConnectionToMspTenant('pbs-bound', 'msp-pbs-1')).rejects.toThrow(
      /vDC PBS namespace bindings/
    )

    // Connection must still be owned by the provider pool
    const conn = await prismaTest.connection.findUnique({ where: { id: 'pbs-bound' }, select: { tenantId: true } })
    expect(conn?.tenantId).toBe('default')
  })

  it('assigns a PBS connection with no vDC namespace bindings to an MSP tenant', async () => {
    await seedPbsConnection('pbs-free')
    await seedMspTenant('msp-pbs-2')

    await assignConnectionToMspTenant('pbs-free', 'msp-pbs-2')

    const conn = await prismaTest.connection.findUnique({ where: { id: 'pbs-free' }, select: { tenantId: true } })
    expect(conn?.tenantId).toBe('msp-pbs-2')
  })

  it('throws when assigning to an iaas tenant (connection_tenant_model_check trigger)', async () => {
    await seedDefaultPveConnection('pve-iaas')
    await seedIaasTenant('iaas-2')

    await expect(assignConnectionToMspTenant('pve-iaas', 'iaas-2')).rejects.toThrow()

    const conn = await prismaTest.connection.findUnique({ where: { id: 'pve-iaas' }, select: { tenantId: true } })
    expect(conn?.tenantId).toBe('default')
  })
})

describe('releaseConnectionToProviderPool', () => {
  it('releases an MSP-owned PVE connection back to the provider pool', async () => {
    await seedMspTenant('msp-r1')
    // Seed as MSP-owned directly (no pool row; the pool-sync deferred trigger
    // only enforces default-tenant PVE connections, not MSP-owned ones)
    await prismaTest.connection.create({
      data: { id: 'pve-r1', tenantId: 'msp-r1', type: 'pve', name: 'pve-r1', baseUrl: 'https://x', apiTokenEnc: 'e' },
    })

    await releaseConnectionToProviderPool('pve-r1')

    const conn = await prismaTest.connection.findUnique({ where: { id: 'pve-r1' }, select: { tenantId: true } })
    expect(conn?.tenantId).toBe('default')

    const pc = await prismaTest.providerConnection.findUnique({ where: { connectionId: 'pve-r1' } })
    expect(pc).not.toBeNull()
  })

  it('is a no-op if the connection is already in the provider pool (tenant_id=default)', async () => {
    await seedDefaultPveConnection('pve-r2')

    // Should not throw and should leave state unchanged
    await expect(releaseConnectionToProviderPool('pve-r2')).resolves.toBeUndefined()

    const conn = await prismaTest.connection.findUnique({ where: { id: 'pve-r2' }, select: { tenantId: true } })
    expect(conn?.tenantId).toBe('default')
  })
})

describe('ManagedHost rows move with the connection', () => {
  it('assign: ManagedHost row moves to the target tenant in the same transaction', async () => {
    await seedDefaultPveConnection('pve-mh1')
    await seedMspTenant('msp-mh1')
    await prismaTest.managedHost.create({
      data: { connectionId: 'pve-mh1', node: 'pve-node-1', tenantId: 'default' },
    })

    await assignConnectionToMspTenant('pve-mh1', 'msp-mh1')

    const host = await prismaTest.managedHost.findFirst({ where: { connectionId: 'pve-mh1' } })
    expect(host?.tenantId).toBe('msp-mh1')
  })

  it('release: ManagedHost row moves back to default in the same transaction', async () => {
    await seedMspTenant('msp-mh2')
    await prismaTest.connection.create({
      data: { id: 'pve-mh2', tenantId: 'msp-mh2', type: 'pve', name: 'pve-mh2', baseUrl: 'https://x', apiTokenEnc: 'e' },
    })
    await prismaTest.managedHost.create({
      data: { connectionId: 'pve-mh2', node: 'pve-node-2', tenantId: 'msp-mh2' },
    })

    await releaseConnectionToProviderPool('pve-mh2')

    const host = await prismaTest.managedHost.findFirst({ where: { connectionId: 'pve-mh2' } })
    expect(host?.tenantId).toBe('default')
  })
})
