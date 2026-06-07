import crypto from 'crypto'
import { beforeEach, describe, expect, it } from 'vitest'

import { prismaTest, truncate } from '../../__tests__/setup/prisma-test'

import { allocateVni, generatePveVnetId, generateZoneName } from './sdn'

const TABLES = ['vdc_vnets', 'vdcs', 'provider_connections', 'Connection', 'tenants']

beforeEach(async () => {
  await truncate(TABLES)

  const now = new Date()
  await prismaTest.tenant.create({
    data: { id: 'tenant-1', slug: 'tenant-1', name: 'Test', operatingModel: 'iaas', createdAt: now, updatedAt: now },
  })
  // PVE connections used as vdc.connectionId must be provider-owned and pooled.
  // The deferred pool-sync trigger requires connection + pool row in one transaction.
  await prismaTest.$transaction(async (tx) => {
    await tx.connection.createMany({
      data: [
        { id: 'conn1', tenantId: 'default', name: 'pve-1', baseUrl: 'https://pve1', apiTokenEnc: 'enc' },
        { id: 'conn-A', tenantId: 'default', name: 'pve-A', baseUrl: 'https://pveA', apiTokenEnc: 'enc' },
        { id: 'conn-B', tenantId: 'default', name: 'pve-B', baseUrl: 'https://pveB', apiTokenEnc: 'enc' },
        { id: 'conn-shared', tenantId: 'default', name: 'pve-shared', baseUrl: 'https://pves', apiTokenEnc: 'enc' },
      ],
    })
    await tx.providerConnection.createMany({
      data: [
        { connectionId: 'conn1' },
        { connectionId: 'conn-A' },
        { connectionId: 'conn-B' },
        { connectionId: 'conn-shared' },
      ],
    })
  })
})

interface VdcOpts {
  id: string
  connectionId: string
  slug?: string
  sdnZoneName?: string | null
}

async function addVdc(opts: VdcOpts): Promise<void> {
  await prismaTest.vdc.create({
    data: {
      id: opts.id,
      tenantId: 'tenant-1',
      connectionId: opts.connectionId,
      name: opts.id,
      slug: opts.slug ?? opts.id,
      pvePoolName: `pool-${opts.id}`,
      sdnZoneName: opts.sdnZoneName ?? null,
    },
  })
}

async function addVnet(vdcId: string, pveName: string, vxlanTag: number): Promise<void> {
  await prismaTest.vdcVnet.create({
    data: { id: `${vdcId}-${pveName}`, vdcId, pveName, vxlanTag },
  })
}

describe('generateZoneName', () => {
  it('strips hyphens, prefixes with z, caps at 8 chars total', async () => {
    const name = await generateZoneName('conn1', { id: 'vdc-1', slug: 'acme-prod' })
    expect(name).toBe('zacmepro')
    expect(name.length).toBe(8)
  })

  it('truncates long slugs to fit within the 8-char ceiling', async () => {
    const name = await generateZoneName('conn1', { id: 'vdc-2', slug: 'very-long-slug-name' })
    expect(name).toBe('zverylon')
    expect(name.length).toBe(8)
  })

  it('collision suffix: sha1(vdc.id)[:2] + 5-char slug stub', async () => {
    await addVdc({ id: 'other-vdc', connectionId: 'conn1', slug: 'acme-prod', sdnZoneName: 'zacmepro' })

    const name = await generateZoneName('conn1', { id: 'vdc-3', slug: 'acme-prod' })
    const hash = crypto.createHash('sha1').update('vdc-3').digest('hex').slice(0, 2)
    expect(name).toBe('zacmep' + hash) // 'z' + 5 slug + 2 hash = 8
    expect(name.length).toBe(8)
  })

  it('throws on double collision', async () => {
    const hash = crypto.createHash('sha1').update('vdc-4').digest('hex').slice(0, 2)
    await addVdc({ id: 'other-1', connectionId: 'conn1', slug: 'acme-prod', sdnZoneName: 'zacmepro' })
    await addVdc({ id: 'other-2', connectionId: 'conn1', slug: 'acme-prod-2', sdnZoneName: 'zacmep' + hash })
    await expect(
      generateZoneName('conn1', { id: 'vdc-4', slug: 'acme-prod' }),
    ).rejects.toThrow('Cannot generate unique SDN zone name')
  })
})

describe('allocateVni', () => {
  it('first VNet in vDC returns 10000', async () => {
    await addVdc({ id: 'vdc-1', connectionId: 'conn-A' })
    expect(await allocateVni('vdc-1')).toBe(10000)
  })

  it('subsequent VNets increment from max', async () => {
    await addVdc({ id: 'vdc-1', connectionId: 'conn-A' })
    await addVnet('vdc-1', 'prodlan', 10000)
    await addVnet('vdc-1', 'dmz', 10001)
    expect(await allocateVni('vdc-1')).toBe(10002)
  })

  it('skips holes, uses max+1', async () => {
    await addVdc({ id: 'vdc-1', connectionId: 'conn-A' })
    await addVnet('vdc-1', 'prodlan', 10000)
    await addVnet('vdc-1', 'dmz', 10005)
    expect(await allocateVni('vdc-1')).toBe(10006)
  })

  it('VNI is unique across vDCs on the same PVE connection', async () => {
    await addVdc({ id: 'vdc-A', connectionId: 'conn-shared' })
    await addVdc({ id: 'vdc-B', connectionId: 'conn-shared' })
    await addVnet('vdc-A', 'lan', 10000)
    await addVnet('vdc-A', 'dmz', 10001)
    expect(await allocateVni('vdc-B')).toBe(10002)
  })

  it('VNIs reset per connection (separate PVE clusters get their own pool)', async () => {
    await addVdc({ id: 'vdc-A', connectionId: 'conn-A' })
    await addVdc({ id: 'vdc-B', connectionId: 'conn-B' })
    await addVnet('vdc-A', 'lan', 10000)
    expect(await allocateVni('vdc-B')).toBe(10000)
  })
})

describe('generatePveVnetId', () => {
  it('produces an 8-char id starting with a letter', async () => {
    await addVdc({ id: 'vdc-1', connectionId: 'conn-A' })
    const id = await generatePveVnetId('vdc-1', 'lan')
    expect(id).toMatch(/^[a-z][a-z0-9]{7}$/)
    expect(id).toHaveLength(8)
  })

  it('deterministic for same (vdcId, displayName)', async () => {
    await addVdc({ id: 'vdc-1', connectionId: 'conn-A' })
    const id1 = await generatePveVnetId('vdc-1', 'lan')
    const id2 = await generatePveVnetId('vdc-1', 'lan')
    expect(id1).toBe(id2)
  })

  it('different displayName -> different id', async () => {
    await addVdc({ id: 'vdc-1', connectionId: 'conn-A' })
    const id1 = await generatePveVnetId('vdc-1', 'lan')
    const id2 = await generatePveVnetId('vdc-1', 'dmz')
    expect(id1).not.toBe(id2)
  })

  it('same displayName in 2 vDCs -> 2 different ids (MSP requirement)', async () => {
    await addVdc({ id: 'vdc-A', connectionId: 'conn-shared' })
    await addVdc({ id: 'vdc-B', connectionId: 'conn-shared' })
    const idA = await generatePveVnetId('vdc-A', 'lan')
    const idB = await generatePveVnetId('vdc-B', 'lan')
    expect(idA).not.toBe(idB)
  })

  it('collision-resistant via nonce when hash collides', async () => {
    await addVdc({ id: 'vdc-1', connectionId: 'conn-A' })
    const firstTry = await generatePveVnetId('vdc-1', 'lan')
    await prismaTest.vdcVnet.create({ data: { id: 'x', vdcId: 'vdc-1', pveName: firstTry, vxlanTag: 10000 } })

    const next = await generatePveVnetId('vdc-1', 'lan')
    expect(next).not.toBe(firstTry)
    expect(next).toMatch(/^[a-z][a-z0-9]{7}$/)
  })
})
