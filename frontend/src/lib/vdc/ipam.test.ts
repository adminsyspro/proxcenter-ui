import { beforeEach, describe, expect, it } from 'vitest'

import { prismaTest, truncate } from '../../__tests__/setup/prisma-test'

import {
  allocateIp,
  bindVmidToAllocation,
  findAllocationByIp,
  findAllocationByMac,
  IpamExhaustedError,
  IpamHintUnavailableError,
  listAllocationsForSubnet,
  listAllocationsForVdc,
  releaseAllocationsForVm,
  releaseByMac,
  releaseIp,
} from './ipam'

// CASCADE on the FK chain handles the dependent rows; we list the parents
// explicitly because TRUNCATE doesn't recurse without RESTART IDENTITY
// CASCADE (see truncate() impl). Order is irrelevant under CASCADE.
const VDC_TABLES = [
  'vdc_ipam_allocations',
  'vdc_subnets',
  'vdc_vnets',
  'vdcs',
  'provider_connections',
  'Connection',
  'tenants',
]

beforeEach(() => truncate(VDC_TABLES))

interface SeedIds {
  vdcId: string
  vnetId: string
  subnetId: string
  connectionId: string
}

async function seed(args: { cidr: string; gateway: string }): Promise<SeedIds> {
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
  // PVE connections used as vdc.connectionId must be provider-owned and pooled.
  // The deferred pool-sync trigger requires both rows in one transaction.
  await prismaTest.$transaction(async (tx) => {
    await tx.connection.create({
      data: {
        id: 'conn-1',
        tenantId: 'default',
        name: 'pve-test',
        baseUrl: 'https://pve.test',
        apiTokenEnc: 'encrypted-fake',
      },
    })
    await tx.providerConnection.create({ data: { connectionId: 'conn-1' } })
  })
  await prismaTest.vdc.create({
    data: {
      id: 'vdc-1',
      tenantId: 'tenant-1',
      connectionId: 'conn-1',
      name: 'vdc-1',
      slug: 'vdc-1',
      pvePoolName: 'vdc-1',
    },
  })
  await prismaTest.vdcVnet.create({
    data: {
      id: 'vnet-1',
      vdcId: 'vdc-1',
      pveName: 'znet-test',
      vxlanTag: 100,
    },
  })
  await prismaTest.vdcSubnet.create({
    data: {
      id: 'subnet-1',
      vnetId: 'vnet-1',
      cidr: args.cidr,
      gateway: args.gateway,
    },
  })

  return { vdcId: 'vdc-1', vnetId: 'vnet-1', subnetId: 'subnet-1', connectionId: 'conn-1' }
}

describe('allocateIp', () => {
  it('returns the first usable IP in a /24, skipping the gateway at .254', async () => {
    const ids = await seed({ cidr: '10.42.0.0/24', gateway: '10.42.0.254' })
    const a = await allocateIp({ ...ids, mac: 'BC:24:11:00:00:01' })
    expect(a.ip).toBe('10.42.0.1')
  })

  it('walks forward when earlier IPs are taken', async () => {
    const ids = await seed({ cidr: '10.42.0.0/24', gateway: '10.42.0.254' })
    await allocateIp({ ...ids, mac: 'AA:00:00:00:00:01' })
    await allocateIp({ ...ids, mac: 'AA:00:00:00:00:02' })
    const third = await allocateIp({ ...ids, mac: 'AA:00:00:00:00:03' })
    expect(third.ip).toBe('10.42.0.3')
  })

  it('skips the gateway when it lands inside the usable range', async () => {
    const ids = await seed({ cidr: '10.42.0.0/24', gateway: '10.42.0.1' })
    const a = await allocateIp({ ...ids, mac: 'AA:00:00:00:00:01' })
    expect(a.ip).toBe('10.42.0.2')
  })

  it('is idempotent on repeated calls with the same MAC', async () => {
    const ids = await seed({ cidr: '10.42.0.0/24', gateway: '10.42.0.254' })
    const first = await allocateIp({ ...ids, mac: 'BC:24:11:00:00:01', hostname: 'web' })
    const second = await allocateIp({ ...ids, mac: 'BC:24:11:00:00:01', hostname: 'ignored' })
    expect(second.ip).toBe(first.ip)
    expect(second.id).toBe(first.id)
    expect(second.hostname).toBe('web')
  })

  it('normalises MAC casing for idempotency', async () => {
    const ids = await seed({ cidr: '10.42.0.0/24', gateway: '10.42.0.254' })
    const first = await allocateIp({ ...ids, mac: 'bc:24:11:aa:bb:cc' })
    const second = await allocateIp({ ...ids, mac: 'BC:24:11:AA:BB:CC' })
    expect(second.id).toBe(first.id)
  })

  it('honours an in-range hint', async () => {
    const ids = await seed({ cidr: '10.42.0.0/24', gateway: '10.42.0.254' })
    const a = await allocateIp({ ...ids, mac: 'AA:00:00:00:00:01', hint: '10.42.0.42' })
    expect(a.ip).toBe('10.42.0.42')
  })

  it('rejects a hint equal to the gateway', async () => {
    const ids = await seed({ cidr: '10.42.0.0/24', gateway: '10.42.0.254' })
    await expect(
      allocateIp({ ...ids, mac: 'AA:00:00:00:00:01', hint: '10.42.0.254' }),
    ).rejects.toBeInstanceOf(IpamHintUnavailableError)
  })

  it('rejects a hint outside the CIDR', async () => {
    const ids = await seed({ cidr: '10.42.0.0/24', gateway: '10.42.0.254' })
    await expect(
      allocateIp({ ...ids, mac: 'AA:00:00:00:00:01', hint: '10.43.0.5' }),
    ).rejects.toBeInstanceOf(IpamHintUnavailableError)
  })

  it('throws IpamExhaustedError when the CIDR is full', async () => {
    const ids = await seed({ cidr: '10.42.0.0/30', gateway: '10.42.0.1' })
    await allocateIp({ ...ids, mac: 'AA:00:00:00:00:01' })
    await expect(
      allocateIp({ ...ids, mac: 'AA:00:00:00:00:02' }),
    ).rejects.toBeInstanceOf(IpamExhaustedError)
  })

  it('handles /31 RFC 3021 — both IPs usable', async () => {
    const ids = await seed({ cidr: '10.42.0.0/31', gateway: '10.42.0.0' })
    const a = await allocateIp({ ...ids, mac: 'AA:00:00:00:00:01' })
    expect(a.ip).toBe('10.42.0.1')
    await expect(
      allocateIp({ ...ids, mac: 'AA:00:00:00:00:02' }),
    ).rejects.toBeInstanceOf(IpamExhaustedError)
  })

  it('handles /32 — single host equals gateway → exhausted', async () => {
    const ids = await seed({ cidr: '10.42.0.0/32', gateway: '10.42.0.0' })
    await expect(
      allocateIp({ ...ids, mac: 'AA:00:00:00:00:01' }),
    ).rejects.toBeInstanceOf(IpamExhaustedError)
  })
})

describe('release / find / list / bind', () => {
  it('releaseIp removes by IP and is idempotent', async () => {
    const ids = await seed({ cidr: '10.42.0.0/24', gateway: '10.42.0.254' })
    await allocateIp({ ...ids, mac: 'AA:00:00:00:00:01' })
    await releaseIp({ subnetId: ids.subnetId, ip: '10.42.0.1' })
    await releaseIp({ subnetId: ids.subnetId, ip: '10.42.0.1' })
    expect(await findAllocationByIp(ids.subnetId, '10.42.0.1')).toBeNull()
  })

  it('releaseByMac removes by MAC', async () => {
    const ids = await seed({ cidr: '10.42.0.0/24', gateway: '10.42.0.254' })
    await allocateIp({ ...ids, mac: 'AA:00:00:00:00:01' })
    await releaseByMac({ subnetId: ids.subnetId, mac: 'aa:00:00:00:00:01' })
    expect(await findAllocationByMac(ids.subnetId, 'AA:00:00:00:00:01')).toBeNull()
  })

  it('releaseAllocationsForVm wipes every NIC of a deleted VM', async () => {
    const ids = await seed({ cidr: '10.42.0.0/24', gateway: '10.42.0.254' })
    const a = await allocateIp({ ...ids, mac: 'AA:00:00:00:00:01', vmid: 100 })
    const b = await allocateIp({ ...ids, mac: 'AA:00:00:00:00:02', vmid: 100 })
    await allocateIp({ ...ids, mac: 'AA:00:00:00:00:03', vmid: 200 })
    const released = await releaseAllocationsForVm(ids.connectionId, 100)
    const cmp = (x: string, y: string) => x.localeCompare(y)
    expect(released.map((r) => r.ip).sort(cmp)).toEqual([a.ip, b.ip].sort(cmp))
    expect(await listAllocationsForSubnet(ids.subnetId)).toHaveLength(1)
  })

  it('bindVmidToAllocation patches the row', async () => {
    const ids = await seed({ cidr: '10.42.0.0/24', gateway: '10.42.0.254' })
    const a = await allocateIp({ ...ids, mac: 'AA:00:00:00:00:01' })
    expect(a.vmid).toBeNull()
    await bindVmidToAllocation({ subnetId: ids.subnetId, ip: a.ip, vmid: 101, hostname: 'web' })
    const after = await findAllocationByIp(ids.subnetId, a.ip)
    expect(after?.vmid).toBe(101)
    expect(after?.hostname).toBe('web')
  })

  it('listAllocationsForVdc returns rows sorted by IP', async () => {
    const ids = await seed({ cidr: '10.42.0.0/24', gateway: '10.42.0.254' })
    await allocateIp({ ...ids, mac: 'AA:00:00:00:00:03', hint: '10.42.0.30' })
    await allocateIp({ ...ids, mac: 'AA:00:00:00:00:01', hint: '10.42.0.10' })
    await allocateIp({ ...ids, mac: 'AA:00:00:00:00:02', hint: '10.42.0.20' })
    expect((await listAllocationsForVdc(ids.vdcId)).map((r) => r.ip)).toEqual([
      '10.42.0.10',
      '10.42.0.20',
      '10.42.0.30',
    ])
  })
})
