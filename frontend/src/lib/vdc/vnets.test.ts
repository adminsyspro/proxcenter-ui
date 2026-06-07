import { beforeEach, describe, expect, it } from 'vitest'

import { prismaTest, truncate } from '../../__tests__/setup/prisma-test'

import { checkVnetQuota, resolveVdcForVnet } from './vnets'

const TABLES = [
  'vdc_vnets',
  'vdc_quotas',
  'vdcs',
  'provider_connections',
  'Connection',
  'tenants',
]

beforeEach(async () => {
  await truncate(TABLES)

  const now = new Date()
  await prismaTest.tenant.createMany({
    data: [
      { id: 'tenant-a', slug: 'tenant-a', name: 'Tenant A', operatingModel: 'iaas', createdAt: now, updatedAt: now },
      { id: 'tenant-b', slug: 'tenant-b', name: 'Tenant B', operatingModel: 'iaas', createdAt: now, updatedAt: now },
    ],
  })
  // PVE connections used as vdc.connectionId must be provider-owned and pooled.
  // The deferred pool-sync trigger requires both rows in one transaction.
  await prismaTest.$transaction(async (tx) => {
    await tx.connection.create({
      data: {
        id: 'conn-1',
        tenantId: 'default',
        name: 'pve-test',
        baseUrl: 'https://pve.test',
        apiTokenEnc: 'enc',
      },
    })
    await tx.providerConnection.create({ data: { connectionId: 'conn-1' } })
  })
})

interface VdcSeed {
  id?: string
  tenantId: string
  slug?: string
  sdnZoneName?: string | null
  enabled?: boolean
}

async function seedVdc(opts: VdcSeed): Promise<string> {
  const id = opts.id ?? 'vdc-1'
  await prismaTest.vdc.create({
    data: {
      id,
      tenantId: opts.tenantId,
      connectionId: 'conn-1',
      name: id,
      slug: opts.slug ?? id,
      pvePoolName: `pool-${id}`,
      sdnZoneName: opts.sdnZoneName === undefined ? `z${id}` : opts.sdnZoneName,
      enabled: opts.enabled ?? true,
    },
  })
  return id
}

describe('resolveVdcForVnet', () => {
  it('returns vdc when owned by tenant and enabled', async () => {
    await seedVdc({ tenantId: 'tenant-a', slug: 'acme-prod', sdnZoneName: 'zacmeprod' })
    const vdc = await resolveVdcForVnet('vdc-1', 'tenant-a')
    expect(vdc).not.toBeNull()
    expect(vdc?.sdnZoneName).toBe('zacmeprod')
  })

  it('returns null when vdc belongs to different tenant', async () => {
    await seedVdc({ tenantId: 'tenant-a' })
    expect(await resolveVdcForVnet('vdc-1', 'tenant-b')).toBeNull()
  })

  it('returns null when vdc has no SDN zone (pre-Phase-4a vDC)', async () => {
    await seedVdc({ tenantId: 'tenant-a', sdnZoneName: null })
    expect(await resolveVdcForVnet('vdc-1', 'tenant-a')).toBeNull()
  })

  it('returns null when vdc is disabled', async () => {
    await seedVdc({ tenantId: 'tenant-a', enabled: false })
    expect(await resolveVdcForVnet('vdc-1', 'tenant-a')).toBeNull()
  })
})

describe('checkVnetQuota', () => {
  it('allows when quota null (unlimited)', async () => {
    await seedVdc({ tenantId: 'tenant-a' })
    await prismaTest.vdcQuota.create({ data: { id: 'q-vdc-1', vdcId: 'vdc-1', maxVnets: null } })
    expect(await checkVnetQuota('vdc-1')).toEqual({ allowed: true, current: 0, max: null })
  })

  it('allows under limit', async () => {
    await seedVdc({ tenantId: 'tenant-a' })
    await prismaTest.vdcQuota.create({ data: { id: 'q-vdc-1', vdcId: 'vdc-1', maxVnets: 5 } })
    await prismaTest.vdcVnet.create({ data: { id: 'x', vdcId: 'vdc-1', pveName: 'a', vxlanTag: 10000 } })
    await prismaTest.vdcVnet.create({ data: { id: 'y', vdcId: 'vdc-1', pveName: 'b', vxlanTag: 10001 } })
    expect(await checkVnetQuota('vdc-1')).toEqual({ allowed: true, current: 2, max: 5 })
  })

  it('blocks at limit', async () => {
    await seedVdc({ tenantId: 'tenant-a' })
    await prismaTest.vdcQuota.create({ data: { id: 'q-vdc-1', vdcId: 'vdc-1', maxVnets: 2 } })
    await prismaTest.vdcVnet.create({ data: { id: 'x', vdcId: 'vdc-1', pveName: 'a', vxlanTag: 10000 } })
    await prismaTest.vdcVnet.create({ data: { id: 'y', vdcId: 'vdc-1', pveName: 'b', vxlanTag: 10001 } })
    expect(await checkVnetQuota('vdc-1')).toEqual({ allowed: false, current: 2, max: 2 })
  })
})
