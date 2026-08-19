/**
 * Postgres-backed tests for tenant VNet resolution, quota and creation.
 *
 * `@/lib/proxmox/client` and `@/lib/connections/getConnection` are mocked at
 * module level: `createVnetForTenant` reaches PVE through './sdn' and './vlan',
 * so the SDN calls are asserted on the pveFetch mock rather than by mocking
 * those modules (same stance as vlan.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { prismaTest, truncate } from '../../__tests__/setup/prisma-test'

const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: any[]) => pveFetchMock(...a) }))

const getConnectionByIdMock = vi.fn<(...args: any[]) => Promise<any>>()
vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: (...a: any[]) => getConnectionByIdMock(...a),
}))

import { generateVlanZoneName } from './vlan'
import {
  checkVnetQuota,
  createVnetForTenant,
  getAllowedNetworksForTenant,
  resolveSubnetForBridge,
  resolveVdcForVnet,
  validateNetAgainstScope,
} from './vnets'
import type { AllowedNetwork } from './vnets'

const TABLES = [
  'vdc_ipam_allocations',
  'vdc_subnets',
  'vdc_vnets',
  'vdc_vlan_pools',
  'vdc_shared_bridges',
  'sdn_vlan_zones',
  'vdc_quotas',
  'vdcs',
  'provider_connections',
  'Connection',
  'tenants',
]

beforeEach(async () => {
  await truncate(TABLES)

  pveFetchMock.mockReset()
  // GET endpoints hit by allocateVni / allocateVlanTag return an empty live
  // SDN config; every mutation resolves with no payload.
  pveFetchMock.mockImplementation(async (_conn: any, path: string, opts?: any) => {
    const method = String(opts?.method ?? 'GET').toUpperCase()
    if (method === 'GET') return []
    return undefined
  })
  getConnectionByIdMock.mockReset()
  getConnectionByIdMock.mockResolvedValue({ baseUrl: 'https://pve.test', apiToken: 'tok' })

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

async function addPool(vdcId: string, bridge: string, rangeStart: number, rangeEnd: number): Promise<void> {
  await prismaTest.vdcVlanPool.create({
    data: { id: `${vdcId}-${bridge}-${rangeStart}`, vdcId, bridge, rangeStart, rangeEnd },
  })
}

async function addSharedBridge(vdcId: string, bridge: string): Promise<void> {
  await prismaTest.vdcSharedBridge.create({
    data: { id: `${vdcId}-shared-${bridge}`, vdcId, bridge },
  })
}

/** pveFetch calls matching a method + path (method defaults to GET). */
function pveCalls(method: string, path: string): any[][] {
  return pveFetchMock.mock.calls.filter((c) => {
    const m = String(c[2]?.method ?? 'GET').toUpperCase()
    return m === method.toUpperCase() && c[1] === path
  })
}

const SUBNET = { cidr: '10.42.0.0/24', gateway: '10.42.0.1' }

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

  it('returns the vdc with a null zone when it has no SDN zone (VLAN-only vDC)', async () => {
    // A vDC without an SDN zone can still host VLAN VNets, so the resolver no
    // longer rejects it: the missing zone is only fatal on the VXLAN branch of
    // createVnetForTenant.
    await seedVdc({ tenantId: 'tenant-a', sdnZoneName: null })
    const vdc = await resolveVdcForVnet('vdc-1', 'tenant-a')
    expect(vdc).not.toBeNull()
    expect(vdc?.sdnZoneName).toBeNull()
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
    await prismaTest.vdcVnet.create({ data: { id: 'x', vdcId: 'vdc-1', pveName: 'a', tag: 10000 } })
    await prismaTest.vdcVnet.create({ data: { id: 'y', vdcId: 'vdc-1', pveName: 'b', tag: 10001 } })
    expect(await checkVnetQuota('vdc-1')).toEqual({ allowed: true, current: 2, max: 5 })
  })

  it('blocks at limit', async () => {
    await seedVdc({ tenantId: 'tenant-a' })
    await prismaTest.vdcQuota.create({ data: { id: 'q-vdc-1', vdcId: 'vdc-1', maxVnets: 2 } })
    await prismaTest.vdcVnet.create({ data: { id: 'x', vdcId: 'vdc-1', pveName: 'a', tag: 10000 } })
    await prismaTest.vdcVnet.create({ data: { id: 'y', vdcId: 'vdc-1', pveName: 'b', tag: 10001 } })
    expect(await checkVnetQuota('vdc-1')).toEqual({ allowed: false, current: 2, max: 2 })
  })
})

describe('createVnetForTenant (VXLAN)', () => {
  it('keeps the VXLAN path on the vDC zone with a null bridge', async () => {
    await seedVdc({ tenantId: 'tenant-a', sdnZoneName: 'zacme' })

    const vnet = await createVnetForTenant({
      vdcId: 'vdc-1', tenantId: 'tenant-a', displayName: 'lan',
      subnet: SUBNET, createdBy: 'user-1',
    })

    expect(vnet.type).toBe('vxlan')
    expect(vnet.bridge).toBeNull()
    expect(vnet.zoneName).toBe('zacme')
    expect(vnet.tag).toBe(10000)

    const row = await prismaTest.vdcVnet.findUnique({ where: { id: vnet.id } })
    expect(row?.type).toBe('vxlan')
    expect(row?.bridge).toBeNull()
    expect(row?.zoneName).toBe('zacme')

    const posts = pveCalls('POST', '/cluster/sdn/vnets')
    expect(posts).toHaveLength(1)
    expect((posts[0][2].body as URLSearchParams).get('zone')).toBe('zacme')
    // No VLAN zone is provisioned on the VXLAN path.
    expect(pveCalls('POST', '/cluster/sdn/zones')).toHaveLength(0)
    expect(await prismaTest.sdnVlanZone.count()).toBe(0)
  })

  it('refuses a VXLAN VNet on a vDC without an SDN zone', async () => {
    await seedVdc({ tenantId: 'tenant-a', sdnZoneName: null })

    await expect(createVnetForTenant({
      vdcId: 'vdc-1', tenantId: 'tenant-a', displayName: 'lan',
      subnet: SUBNET, createdBy: null,
    })).rejects.toThrow(/vDC has no SDN zone - VXLAN networks are unavailable/)

    expect(pveCalls('POST', '/cluster/sdn/vnets')).toHaveLength(0)
  })
})

describe('createVnetForTenant (VLAN)', () => {
  it('allocates the first pool tag and lands the VNet in the shared VLAN zone', async () => {
    await seedVdc({ tenantId: 'tenant-a', sdnZoneName: 'zacme' })
    await addPool('vdc-1', 'vmbr0', 100, 199)

    const vnet = await createVnetForTenant({
      vdcId: 'vdc-1', tenantId: 'tenant-a', displayName: 'lan',
      type: 'vlan', bridge: 'vmbr0',
      subnet: SUBNET, createdBy: 'user-1',
    })

    const sharedZone = generateVlanZoneName('conn-1', 'vmbr0')
    expect(vnet.type).toBe('vlan')
    expect(vnet.bridge).toBe('vmbr0')
    expect(vnet.tag).toBe(100)
    expect(vnet.zoneName).toBe(sharedZone)

    const row = await prismaTest.vdcVnet.findUnique({ where: { id: vnet.id } })
    expect(row?.type).toBe('vlan')
    expect(row?.bridge).toBe('vmbr0')
    expect(row?.tag).toBe(100)
    expect(row?.zoneName).toBe(sharedZone)

    // The PVE VNet goes to the shared per-(connection, bridge) zone, not the
    // vDC's own VXLAN zone.
    const posts = pveCalls('POST', '/cluster/sdn/vnets')
    expect(posts).toHaveLength(1)
    const body = posts[0][2].body as URLSearchParams
    expect(body.get('zone')).toBe(sharedZone)
    expect(body.get('tag')).toBe('100')

    const zonePosts = pveCalls('POST', '/cluster/sdn/zones')
    expect(zonePosts).toHaveLength(1)
    const zoneBody = zonePosts[0][2].body as URLSearchParams
    expect(zoneBody.get('type')).toBe('vlan')
    expect(zoneBody.get('bridge')).toBe('vmbr0')
    expect(zoneBody.get('zone')).toBe(sharedZone)

    const zoneRow = await prismaTest.sdnVlanZone.findUnique({
      where: { connectionId_bridge: { connectionId: 'conn-1', bridge: 'vmbr0' } },
    })
    expect(zoneRow?.zoneName).toBe(sharedZone)
  })

  it('honours an explicit in-pool vlanTag', async () => {
    await seedVdc({ tenantId: 'tenant-a' })
    await addPool('vdc-1', 'vmbr0', 100, 199)

    const vnet = await createVnetForTenant({
      vdcId: 'vdc-1', tenantId: 'tenant-a', displayName: 'lan',
      type: 'vlan', bridge: 'vmbr0', vlanTag: 150,
      subnet: SUBNET, createdBy: null,
    })

    expect(vnet.tag).toBe(150)
    expect((pveCalls('POST', '/cluster/sdn/vnets')[0][2].body as URLSearchParams).get('tag')).toBe('150')
  })

  it('rejects a vlanTag outside the vDC pools', async () => {
    await seedVdc({ tenantId: 'tenant-a' })
    await addPool('vdc-1', 'vmbr0', 100, 199)

    await expect(createVnetForTenant({
      vdcId: 'vdc-1', tenantId: 'tenant-a', displayName: 'lan',
      type: 'vlan', bridge: 'vmbr0', vlanTag: 500,
      subnet: SUBNET, createdBy: null,
    })).rejects.toThrow(/outside the vDC pools/)

    expect(await prismaTest.vdcVnet.count()).toBe(0)
  })

  it('rejects a bridge with no VLAN pool before provisioning any zone', async () => {
    await seedVdc({ tenantId: 'tenant-a' })
    await addPool('vdc-1', 'vmbr0', 100, 199)

    await expect(createVnetForTenant({
      vdcId: 'vdc-1', tenantId: 'tenant-a', displayName: 'lan',
      type: 'vlan', bridge: 'vmbr9',
      subnet: SUBNET, createdBy: null,
    })).rejects.toThrow(/has no VLAN pool/)

    // Allocation runs before ensureVlanZone: a rejected create leaves no
    // orphan zone behind, neither on PVE nor in our DB.
    expect(pveCalls('POST', '/cluster/sdn/zones')).toHaveLength(0)
    expect(await prismaTest.sdnVlanZone.count()).toBe(0)
  })

  it('rejects a VLAN VNet without a bridge', async () => {
    await seedVdc({ tenantId: 'tenant-a' })

    await expect(createVnetForTenant({
      vdcId: 'vdc-1', tenantId: 'tenant-a', displayName: 'lan',
      type: 'vlan',
      subnet: SUBNET, createdBy: null,
    })).rejects.toThrow(/bridge is required/)
  })

  it('creates a VLAN VNet on a vDC that has no SDN zone at all', async () => {
    await seedVdc({ tenantId: 'tenant-a', sdnZoneName: null })
    await addPool('vdc-1', 'vmbr0', 100, 199)

    const vnet = await createVnetForTenant({
      vdcId: 'vdc-1', tenantId: 'tenant-a', displayName: 'lan',
      type: 'vlan', bridge: 'vmbr0',
      subnet: SUBNET, createdBy: null,
    })

    expect(vnet.zoneName).toBe(generateVlanZoneName('conn-1', 'vmbr0'))

    // The IPAM lookup falls back to the VNet's own zone when the vDC has none.
    const resolved = await resolveSubnetForBridge('conn-1', vnet.pveName)
    expect(resolved?.sdnZoneName).toBe(generateVlanZoneName('conn-1', 'vmbr0'))
  })
})

describe('createVnetForTenant (externalAddressing)', () => {
  it('stores the subnet with ipamEnabled=false and hides it from the IPAM lookup', async () => {
    await seedVdc({ tenantId: 'tenant-a' })
    await addPool('vdc-1', 'vmbr0', 100, 199)

    const vnet = await createVnetForTenant({
      vdcId: 'vdc-1', tenantId: 'tenant-a', displayName: 'lan',
      type: 'vlan', bridge: 'vmbr0', externalAddressing: true,
      subnet: SUBNET, createdBy: null,
    })

    const subnet = await prismaTest.vdcSubnet.findUnique({ where: { vnetId: vnet.id } })
    expect(subnet?.ipamEnabled).toBe(false)
    expect(vnet.subnet.ipamEnabled).toBe(false)

    expect(await resolveSubnetForBridge('conn-1', vnet.pveName)).toBeNull()
  })

  it('keeps ipamEnabled=true when externalAddressing is absent', async () => {
    await seedVdc({ tenantId: 'tenant-a', sdnZoneName: 'zacme' })

    const vnet = await createVnetForTenant({
      vdcId: 'vdc-1', tenantId: 'tenant-a', displayName: 'lan',
      subnet: SUBNET, createdBy: null,
    })

    const subnet = await prismaTest.vdcSubnet.findUnique({ where: { vnetId: vnet.id } })
    expect(subnet?.ipamEnabled).toBe(true)
    expect(await resolveSubnetForBridge('conn-1', vnet.pveName)).not.toBeNull()
  })
})

describe('getAllowedNetworksForTenant', () => {
  it('returns null when the tenant has no vDC on this connection', async () => {
    await seedVdc({ tenantId: 'tenant-a' })
    expect(await getAllowedNetworksForTenant('tenant-b', 'conn-1')).toBeNull()
  })

  it('lists SDN vnets as kind vnet and shared bridges as kind shared', async () => {
    await seedVdc({ tenantId: 'tenant-a' })
    await prismaTest.vdcVnet.create({ data: { id: 'v1', vdcId: 'vdc-1', pveName: 'vnetacme', tag: 10000 } })
    await addSharedBridge('vdc-1', 'vmbr0')

    const networks = await getAllowedNetworksForTenant('tenant-a', 'conn-1')
    expect(networks).not.toBeNull()
    expect(networks?.get('vnetacme')).toEqual({ kind: 'vnet', vlanRanges: [] })
    expect(networks?.get('vmbr0')).toEqual({ kind: 'shared', vlanRanges: [] })
  })

  it('feeds vlanRanges from the vDC pools bound to a shared bridge', async () => {
    await seedVdc({ tenantId: 'tenant-a' })
    await addSharedBridge('vdc-1', 'vmbr0')
    await addPool('vdc-1', 'vmbr0', 100, 199)
    await addPool('vdc-1', 'vmbr0', 300, 310)

    const networks = await getAllowedNetworksForTenant('tenant-a', 'conn-1')
    expect(networks?.get('vmbr0')?.vlanRanges).toEqual(
      expect.arrayContaining([{ start: 100, end: 199 }, { start: 300, end: 310 }]),
    )
    expect(networks?.get('vmbr0')?.vlanRanges).toHaveLength(2)
  })

  it('does not open a bridge that only carries a pool and is not shared', async () => {
    await seedVdc({ tenantId: 'tenant-a' })
    await addPool('vdc-1', 'vmbr9', 100, 199)

    const networks = await getAllowedNetworksForTenant('tenant-a', 'conn-1')
    expect(networks).not.toBeNull()
    expect(networks?.has('vmbr9')).toBe(false)
  })

  it('ignores disabled vDCs and vDCs on another connection', async () => {
    await seedVdc({ id: 'vdc-off', tenantId: 'tenant-a', slug: 'off', enabled: false })
    await addSharedBridge('vdc-off', 'vmbr7')
    expect(await getAllowedNetworksForTenant('tenant-a', 'conn-1')).toBeNull()
  })
})

describe('validateNetAgainstScope', () => {
  const networks = (): Map<string, AllowedNetwork> =>
    new Map<string, AllowedNetwork>([
      ['vnetacme', { kind: 'vnet', vlanRanges: [] }],
      ['vmbr0', { kind: 'shared', vlanRanges: [{ start: 100, end: 199 }, { start: 300, end: 310 }] }],
      ['vmbr1', { kind: 'shared', vlanRanges: [] }],
    ])

  it('refuses a bridge outside the vDC', async () => {
    const v = validateNetAgainstScope('virtio,bridge=vmbr42', networks())
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.error).toContain('is not authorized')
  })

  it('accepts an untagged NIC on an allowed vnet', async () => {
    expect(validateNetAgainstScope('virtio,bridge=vnetacme', networks())).toEqual({ ok: true })
  })

  it('refuses a tag on an SDN vnet', async () => {
    const v = validateNetAgainstScope('virtio,bridge=vnetacme,tag=137', networks())
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.error).toContain('not allowed on SDN network')
  })

  it('refuses trunks on an SDN vnet', async () => {
    expect(validateNetAgainstScope('virtio,bridge=vnetacme,trunks=100', networks()).ok).toBe(false)
  })

  it('accepts a tag inside the shared bridge pools', async () => {
    expect(validateNetAgainstScope('virtio,bridge=vmbr0,tag=150', networks())).toEqual({ ok: true })
    expect(validateNetAgainstScope('virtio,bridge=vmbr0,tag=305', networks())).toEqual({ ok: true })
  })

  it('refuses a tag outside the shared bridge pools', async () => {
    // 250 sits in the gap between the two pools, the neighbour's VLAN.
    const v = validateNetAgainstScope('virtio,bridge=vmbr0,tag=250', networks())
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.error).toContain("outside your vDC's VLAN pools")
    expect(validateNetAgainstScope('virtio,bridge=vmbr0,tag=400', networks()).ok).toBe(false)
  })

  it('refuses an absurd trunks range instead of expanding it', async () => {
    const v = validateNetAgainstScope('virtio,bridge=vmbr0,trunks=1-4294967295', networks())
    expect(v.ok).toBe(false)
  })

  it('refuses a reversed range', async () => {
    expect(validateNetAgainstScope('virtio,bridge=vmbr0,trunks=199-100', networks()).ok).toBe(false)
  })

  it('refuses any tag on a shared bridge without a pool', async () => {
    expect(validateNetAgainstScope('virtio,bridge=vmbr1,tag=100', networks()).ok).toBe(false)
  })

  it('accepts a NIC without a tag on a shared bridge', async () => {
    expect(validateNetAgainstScope('virtio,bridge=vmbr1,firewall=1', networks())).toEqual({ ok: true })
  })

  it('accepts trunks fully inside the pools', async () => {
    expect(validateNetAgainstScope('virtio,bridge=vmbr0,trunks=100;150', networks())).toEqual({ ok: true })
    expect(validateNetAgainstScope('virtio,bridge=vmbr0,trunks=100-120;305', networks())).toEqual({ ok: true })
  })

  it('refuses trunks with one id outside the pools', async () => {
    const v = validateNetAgainstScope('virtio,bridge=vmbr0,trunks=100;500', networks())
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.error).toContain('500')
  })

  it('refuses a malformed tag list', async () => {
    expect(validateNetAgainstScope('virtio,bridge=vmbr0,tag=abc', networks()).ok).toBe(false)
    expect(validateNetAgainstScope('virtio,bridge=vmbr0,trunks=100;oops', networks()).ok).toBe(false)
  })

  it('refuses a second tag= even when the first one is in the pool', async () => {
    // Only checking the first occurrence would let 250 ride in behind 150 and
    // leave the outcome to PVE's property-string parser. A repeated key is now
    // refused outright, so the message names the duplication, not the id.
    const v = validateNetAgainstScope('virtio,bridge=vmbr0,tag=150,tag=250', networks())
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.error).toContain('Duplicate')
  })

  it('refuses a second trunks= even when the first one is in the pool', async () => {
    const v = validateNetAgainstScope('virtio,bridge=vmbr0,trunks=150,trunks=500', networks())
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.error).toContain('Duplicate')
  })

  it('refuses duplicate keys even when every value is in the pool', async () => {
    const v = validateNetAgainstScope('virtio,bridge=vmbr0,tag=150,tag=160', networks())
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.error).toContain('Duplicate')
  })

  it('refuses a repeated key without enumerating every occurrence', async () => {
    // Each occurrence carries its own 4094-id budget, so enumerating them all
    // would be O(N x 4094) on a field with no upstream length limit. Refusing
    // on the second match bounds the work by construction.
    const netStr = 'virtio,bridge=vmbr0' + ',tag=1-4094'.repeat(5000)
    const started = Date.now()
    const v = validateNetAgainstScope(netStr, networks())
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.error).toContain('Duplicate')
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('accepts one tag and one trunks together when both are in the pool', async () => {
    expect(validateNetAgainstScope('virtio,bridge=vmbr0,tag=150,trunks=160;170', networks()))
      .toEqual({ ok: true })
  })

  it('refuses a tag key padded with whitespace', async () => {
    const v = validateNetAgainstScope('virtio,bridge=vmbr0, tag=250', networks())
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.error).toContain('250')
  })

  it('refuses an upper-case tag key', async () => {
    const v = validateNetAgainstScope('virtio,bridge=vmbr0,TAG=250', networks())
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.error).toContain('250')
  })

  it('still accepts a single compliant in-pool tag', async () => {
    expect(validateNetAgainstScope('virtio,bridge=vmbr0,tag=150', networks())).toEqual({ ok: true })
  })

  it('accepts a net string with no bridge= at all (historical behaviour)', async () => {
    expect(validateNetAgainstScope('virtio=BC:24:11:00:00:01', networks())).toEqual({ ok: true })
    expect(validateNetAgainstScope('', networks())).toEqual({ ok: true })
  })

  it('does not mistake a substring key for tag= or trunks=', async () => {
    // "mtag=" must not be read as "tag=": the guard anchors on a comma or the start.
    expect(validateNetAgainstScope('virtio,bridge=vmbr1,mtag=137', networks())).toEqual({ ok: true })
  })
})
