/**
 * Postgres-backed tests for the per-vDC VLAN pools, tag allocation and the
 * shared per-(connection, bridge) VLAN zone.
 *
 * `@/lib/proxmox/client` is mocked at module level: `ensureVlanZone` reaches
 * PVE through `createZone` from './sdn', so the zone-creation POST is asserted
 * on the pveFetch mock rather than by mocking './sdn' itself.
 */
import crypto from 'crypto'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { prismaTest, truncate } from '../../__tests__/setup/prisma-test'

const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: any[]) => pveFetchMock(...a) }))

import {
  validateVlanPoolsInput, assertNoCrossVdcOverlap, assertPoolShrinkSafe,
  generateVlanZoneName, ensureVlanZone, allocateVlanTag,
} from './vlan'

const TABLES = [
  'sdn_vlan_zones', 'vdc_vlan_pools', 'vdc_vnets', 'vdcs',
  'provider_connections', 'Connection', 'tenants',
]

const fakeConn = { baseUrl: 'https://pve1', apiToken: 't' } as any

beforeEach(async () => {
  pveFetchMock.mockReset()
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
  tenantId?: string
  slug?: string
  name?: string
}

// The (tenant_id, connection_id) unique constraint means two vDCs on the
// same connection must belong to different tenants.
async function addTenant(id: string): Promise<void> {
  const now = new Date()
  await prismaTest.tenant.create({
    data: { id, slug: id, name: id, operatingModel: 'iaas', createdAt: now, updatedAt: now },
  })
}

async function addVdc(opts: VdcOpts): Promise<void> {
  await prismaTest.vdc.create({
    data: {
      id: opts.id,
      tenantId: opts.tenantId ?? 'tenant-1',
      connectionId: opts.connectionId,
      name: opts.name ?? opts.id,
      slug: opts.slug ?? opts.id,
      pvePoolName: `pool-${opts.id}`,
    },
  })
}

async function addPool(vdcId: string, bridge: string, rangeStart: number, rangeEnd: number): Promise<void> {
  await prismaTest.vdcVlanPool.create({
    data: { id: `${vdcId}-${bridge}-${rangeStart}`, vdcId, bridge, rangeStart, rangeEnd },
  })
}

async function addVlanVnet(vdcId: string, pveName: string, bridge: string, tag: number): Promise<void> {
  await prismaTest.vdcVnet.create({
    data: { id: `${vdcId}-${pveName}`, vdcId, pveName, displayName: pveName, type: 'vlan', bridge, tag },
  })
}

describe('validateVlanPoolsInput', () => {
  it('rejects a range starting at 0 (802.1Q reserved)', () => {
    expect(() => validateVlanPoolsInput([{ bridge: 'vmbr0', rangeStart: 0, rangeEnd: 100 }]))
      .toThrow('VLAN pool range 0-100 is invalid (bounds 1-4094, start <= end)')
  })

  it('rejects a range ending at 4095 (802.1Q reserved)', () => {
    expect(() => validateVlanPoolsInput([{ bridge: 'vmbr0', rangeStart: 4000, rangeEnd: 4095 }]))
      .toThrow('VLAN pool range 4000-4095 is invalid (bounds 1-4094, start <= end)')
  })

  it('rejects start > end', () => {
    expect(() => validateVlanPoolsInput([{ bridge: 'vmbr0', rangeStart: 300, rangeEnd: 200 }]))
      .toThrow('VLAN pool range 300-200 is invalid (bounds 1-4094, start <= end)')
  })

  it('rejects two overlapping ranges on the same bridge', () => {
    expect(() => validateVlanPoolsInput([
      { bridge: 'vmbr0', rangeStart: 100, rangeEnd: 200 },
      { bridge: 'vmbr0', rangeStart: 200, rangeEnd: 300 },
    ])).toThrow('VLAN pool ranges 100-200 and 200-300 overlap on bridge "vmbr0"')
  })

  it('accepts identical ranges on two different bridges', () => {
    expect(() => validateVlanPoolsInput([
      { bridge: 'vmbr0', rangeStart: 100, rangeEnd: 200 },
      { bridge: 'vmbr1', rangeStart: 100, rangeEnd: 200 },
    ])).not.toThrow()
  })
})

describe('assertNoCrossVdcOverlap', () => {
  it('rejects an overlap with another vDC on the same connection and names it', async () => {
    await addTenant('tenant-2')
    await addVdc({ id: 'vdc-A', connectionId: 'conn-shared', name: 'Acme' })
    await addVdc({ id: 'vdc-B', connectionId: 'conn-shared', tenantId: 'tenant-2', name: 'Globex' })
    await addPool('vdc-A', 'vmbr0', 100, 200)

    await expect(
      assertNoCrossVdcOverlap('conn-shared', 'vdc-B', [{ bridge: 'vmbr0', rangeStart: 150, rangeEnd: 250 }]),
    ).rejects.toThrow('VLAN pool 150-250 on bridge "vmbr0" overlaps vDC "Acme" (100-200)')
  })

  it('accepts the same range when the other vDC lives on another connection', async () => {
    await addVdc({ id: 'vdc-A', connectionId: 'conn-A', name: 'Acme' })
    await addVdc({ id: 'vdc-B', connectionId: 'conn-B', name: 'Globex' })
    await addPool('vdc-A', 'vmbr0', 100, 200)

    await expect(
      assertNoCrossVdcOverlap('conn-B', 'vdc-B', [{ bridge: 'vmbr0', rangeStart: 100, rangeEnd: 200 }]),
    ).resolves.toBeUndefined()
  })

  it('excludes the edited vDC from the comparison (it never overlaps itself)', async () => {
    await addVdc({ id: 'vdc-A', connectionId: 'conn-A', name: 'Acme' })
    await addPool('vdc-A', 'vmbr0', 100, 200)

    await expect(
      assertNoCrossVdcOverlap('conn-A', 'vdc-A', [{ bridge: 'vmbr0', rangeStart: 100, rangeEnd: 200 }]),
    ).resolves.toBeUndefined()
  })
})

describe('assertPoolShrinkSafe', () => {
  it('rejects a pool set that strands an existing VLAN VNet', async () => {
    await addVdc({ id: 'vdc-1', connectionId: 'conn-A' })
    await addVlanVnet('vdc-1', 'prod-lan', 'vmbr0', 150)

    await expect(
      assertPoolShrinkSafe('vdc-1', [{ bridge: 'vmbr0', rangeStart: 200, rangeEnd: 300 }]),
    ).rejects.toThrow('Cannot shrink VLAN pools: VNet "prod-lan" uses tag 150 on bridge "vmbr0"')
  })

  it('accepts a pool set that still covers every VLAN VNet', async () => {
    await addVdc({ id: 'vdc-1', connectionId: 'conn-A' })
    await addVlanVnet('vdc-1', 'prod-lan', 'vmbr0', 150)

    await expect(
      assertPoolShrinkSafe('vdc-1', [{ bridge: 'vmbr0', rangeStart: 100, rangeEnd: 200 }]),
    ).resolves.toBeUndefined()
  })

  it('ignores VXLAN VNets (their VNI is not a VLAN tag)', async () => {
    await addVdc({ id: 'vdc-1', connectionId: 'conn-A' })
    await prismaTest.vdcVnet.create({
      data: { id: 'vdc-1-vx', vdcId: 'vdc-1', pveName: 'vxlan1', displayName: 'vxlan1', tag: 10000 },
    })

    await expect(
      assertPoolShrinkSafe('vdc-1', [{ bridge: 'vmbr0', rangeStart: 200, rangeEnd: 300 }]),
    ).resolves.toBeUndefined()
  })
})

describe('generateVlanZoneName', () => {
  it('produces an 8-char name (PVE zone id ceiling)', () => {
    expect(generateVlanZoneName('conn1', 'vmbr0')).toHaveLength(8)
  })

  it('prefixes the name with vl', () => {
    const expected = 'vl' + crypto.createHash('sha1').update('conn1:vmbr0').digest('hex').slice(0, 6)
    const name = generateVlanZoneName('conn1', 'vmbr0')
    expect(name.startsWith('vl')).toBe(true)
    expect(name).toBe(expected)
  })

  it('is deterministic for the same (connection, bridge)', () => {
    expect(generateVlanZoneName('conn1', 'vmbr0')).toBe(generateVlanZoneName('conn1', 'vmbr0'))
  })

  it('differs for two bridges on the same connection', () => {
    expect(generateVlanZoneName('conn1', 'vmbr0')).not.toBe(generateVlanZoneName('conn1', 'vmbr1'))
  })
})

describe('ensureVlanZone', () => {
  it('creates the DB row and the VLAN zone on PVE', async () => {
    pveFetchMock.mockResolvedValue(undefined)

    const zoneName = await ensureVlanZone(fakeConn, 'conn1', 'vmbr0')
    expect(zoneName).toBe(generateVlanZoneName('conn1', 'vmbr0'))

    const row = await prismaTest.sdnVlanZone.findUnique({
      where: { connectionId_bridge: { connectionId: 'conn1', bridge: 'vmbr0' } },
    })
    expect(row?.zoneName).toBe(zoneName)

    const call = pveFetchMock.mock.calls.find((c) => c[1] === '/cluster/sdn/zones')
    expect(call).toBeDefined()
    expect(call?.[2]?.method).toBe('POST')
    const body = call?.[2]?.body as URLSearchParams
    expect(body.get('type')).toBe('vlan')
    expect(body.get('bridge')).toBe('vmbr0')
    expect(body.get('zone')).toBe(zoneName)
  })

  it('second call returns the same name without contacting PVE again', async () => {
    pveFetchMock.mockResolvedValue(undefined)
    const first = await ensureVlanZone(fakeConn, 'conn1', 'vmbr0')

    pveFetchMock.mockClear()
    const second = await ensureVlanZone(fakeConn, 'conn1', 'vmbr0')

    expect(second).toBe(first)
    expect(pveFetchMock).not.toHaveBeenCalled()
    expect(await prismaTest.sdnVlanZone.count({ where: { connectionId: 'conn1' } })).toBe(1)
  })
})

describe('allocateVlanTag', () => {
  it('auto-allocates the first free tag of the lowest pool', async () => {
    await addVdc({ id: 'vdc-1', connectionId: 'conn-A' })
    await addPool('vdc-1', 'vmbr0', 300, 310)
    await addPool('vdc-1', 'vmbr0', 100, 110)
    await addVlanVnet('vdc-1', 'lan', 'vmbr0', 100)
    await addVlanVnet('vdc-1', 'dmz', 'vmbr0', 101)

    expect(await allocateVlanTag({ vdcId: 'vdc-1', connectionId: 'conn-A', bridge: 'vmbr0' })).toBe(102)
  })

  it('skips tags held by another tenant on the same (connection, bridge)', async () => {
    await addTenant('tenant-2')
    await addVdc({ id: 'vdc-A', connectionId: 'conn-shared' })
    await addVdc({ id: 'vdc-B', connectionId: 'conn-shared', tenantId: 'tenant-2' })
    await addPool('vdc-A', 'vmbr0', 100, 110)
    await addVlanVnet('vdc-B', 'other-lan', 'vmbr0', 100)

    expect(await allocateVlanTag({ vdcId: 'vdc-A', connectionId: 'conn-shared', bridge: 'vmbr0' })).toBe(101)
  })

  it('skips tags PVE already carries on the bridge through a foreign zone', async () => {
    await addVdc({ id: 'vdc-1', connectionId: 'conn-A' })
    await addPool('vdc-1', 'vmbr0', 100, 110)

    pveFetchMock.mockImplementation(async (_conn: any, path: string) => {
      if (path === '/cluster/sdn/zones') {
        return [
          { zone: 'provider1', type: 'vlan', bridge: 'vmbr0' },
          { zone: 'elsewhere', type: 'vlan', bridge: 'vmbr9' },
          { zone: 'vxzone', type: 'vxlan' },
        ]
      }
      if (path === '/cluster/sdn/vnets') {
        return [
          { vnet: 'foreign1', zone: 'provider1', tag: 100 },
          { vnet: 'faraway', zone: 'elsewhere', tag: 101 },
        ]
      }
      return []
    })

    const tag = await allocateVlanTag({
      vdcId: 'vdc-1', connectionId: 'conn-A', bridge: 'vmbr0', conn: fakeConn,
    })
    // 100 is taken by the foreign zone on vmbr0; 101 lives on another bridge.
    expect(tag).toBe(101)
  })

  it('falls back to DB-only allocation when the SDN endpoint fails', async () => {
    await addVdc({ id: 'vdc-1', connectionId: 'conn-A' })
    await addPool('vdc-1', 'vmbr0', 100, 110)
    await addVlanVnet('vdc-1', 'lan', 'vmbr0', 100)

    pveFetchMock.mockRejectedValue(new Error('500 connection refused'))

    expect(await allocateVlanTag({
      vdcId: 'vdc-1', connectionId: 'conn-A', bridge: 'vmbr0', conn: fakeConn,
    })).toBe(101)
  })

  it('rejects a requested tag outside the vDC pools', async () => {
    await addVdc({ id: 'vdc-1', connectionId: 'conn-A' })
    await addPool('vdc-1', 'vmbr0', 100, 110)

    await expect(allocateVlanTag({
      vdcId: 'vdc-1', connectionId: 'conn-A', bridge: 'vmbr0', requestedTag: 200,
    })).rejects.toThrow('VLAN tag 200 is outside the vDC pools for bridge "vmbr0"')
  })

  it('rejects a requested tag that is already in use', async () => {
    await addVdc({ id: 'vdc-1', connectionId: 'conn-A' })
    await addPool('vdc-1', 'vmbr0', 100, 110)
    await addVlanVnet('vdc-1', 'lan', 'vmbr0', 105)

    await expect(allocateVlanTag({
      vdcId: 'vdc-1', connectionId: 'conn-A', bridge: 'vmbr0', requestedTag: 105,
    })).rejects.toThrow('VLAN tag 105 is already in use on bridge "vmbr0"')
  })

  it('throws when every tag of every pool is taken', async () => {
    await addVdc({ id: 'vdc-1', connectionId: 'conn-A' })
    await addPool('vdc-1', 'vmbr0', 100, 101)
    await addVlanVnet('vdc-1', 'lan', 'vmbr0', 100)
    await addVlanVnet('vdc-1', 'dmz', 'vmbr0', 101)

    await expect(allocateVlanTag({ vdcId: 'vdc-1', connectionId: 'conn-A', bridge: 'vmbr0' }))
      .rejects.toThrow('No free VLAN tag left in the vDC pools for bridge "vmbr0"')
  })

  it('throws when the bridge has no pool in this vDC', async () => {
    await addVdc({ id: 'vdc-1', connectionId: 'conn-A' })
    await addPool('vdc-1', 'vmbr0', 100, 110)

    await expect(allocateVlanTag({ vdcId: 'vdc-1', connectionId: 'conn-A', bridge: 'vmbr1' }))
      .rejects.toThrow('Bridge "vmbr1" has no VLAN pool in this vDC')
  })

  it('reuses a freed tag (VLAN tags are a scarce, provider-bounded resource)', async () => {
    await addVdc({ id: 'vdc-1', connectionId: 'conn-A' })
    await addPool('vdc-1', 'vmbr0', 100, 110)
    await addVlanVnet('vdc-1', 'lan', 'vmbr0', 100)
    await addVlanVnet('vdc-1', 'dmz', 'vmbr0', 101)
    expect(await allocateVlanTag({ vdcId: 'vdc-1', connectionId: 'conn-A', bridge: 'vmbr0' })).toBe(102)

    await prismaTest.vdcVnet.delete({ where: { id: 'vdc-1-lan' } })
    expect(await allocateVlanTag({ vdcId: 'vdc-1', connectionId: 'conn-A', bridge: 'vmbr0' })).toBe(100)
  })
})
