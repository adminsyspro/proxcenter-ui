/**
 * MOCK-based tests for the createVdc business guards (one vDC per
 * (tenant, connection), per-tenant slug uniqueness) and for the
 * clearVdcScopeCache invalidation added to the vDC mutations.
 * Run with the unit config (no Postgres):
 *   npx vitest run --config vitest.unit.config.ts src/lib/vdc/createVdcGuards.test.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  prismaMock, clearVdcScopeCacheMock, pveFetchMock,
  getConnectionByIdMock, generateZoneNameMock, createZoneMock, applySdnMock,
  isZoneNameTakenMock, syncNetworksOfVdcMock,
} = vi.hoisted(() => ({
  isZoneNameTakenMock: vi.fn(),
  syncNetworksOfVdcMock: vi.fn(),
  prismaMock: {
    tenant: { findUnique: vi.fn() },
    vdc: { findFirst: vi.fn(), findUnique: vi.fn() },
    vdcVnet: { findMany: vi.fn() },
    vdcVlanPool: { findMany: vi.fn() },
    connection: { findUnique: vi.fn(), findMany: vi.fn() },
    providerConnection: { findUnique: vi.fn() },
    tenantNetworkMember: { findMany: vi.fn() },
    $transaction: vi.fn(),
  } as any,
  clearVdcScopeCacheMock: vi.fn(),
  pveFetchMock: vi.fn(),
  getConnectionByIdMock: vi.fn(),
  generateZoneNameMock: vi.fn(),
  createZoneMock: vi.fn(),
  applySdnMock: vi.fn(),
}))

vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))
vi.mock('@/lib/proxmox/pbs-client', () => ({ pbsFetch: vi.fn() }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: getConnectionByIdMock }))
vi.mock('@/lib/crypto/secret', () => ({ decryptSecret: vi.fn() }))
vi.mock('@/lib/tenant', () => ({ DEFAULT_TENANT_ID: 'default' }))
vi.mock('./sdn', () => ({
  generateZoneName: generateZoneNameMock,
  isZoneNameTaken: isZoneNameTakenMock,
  createZone: createZoneMock,
  deleteZone: vi.fn(),
  deleteVnetPve: vi.fn(),
  applySdn: applySdnMock,
  updateZone: vi.fn(),
  listClusterNodeIps: vi.fn(async () => ['10.0.0.1']),
}))
vi.mock('./scope', () => ({ clearVdcScopeCache: clearVdcScopeCacheMock }))
vi.mock('./tenantNetworkMembers', () => ({ syncNetworksOfVdc: syncNetworksOfVdcMock }))

import { createVdc, updateVdc, deleteVdc, getVdcById } from './index'

const baseInput = {
  tenantId: 't1',
  connectionId: 'conn-2',
  name: 'ACME — Frankfurt',
  slug: 'acme-frankfurt',
  nodes: ['node1'],
  primaryStorage: 'ceph-pool',
} as any

// Shape returned by prisma.vdc.findUnique({ include: … }) — used both by
// getVdcById (end of create/update) and by deleteVdc's initial load.
const fullRow = {
  id: 'v1', tenantId: 't1', connectionId: 'conn-2', name: 'ACME — Frankfurt',
  slug: 'acme-frankfurt', description: null, pvePoolName: 'vdc-acme-acme-frankfurt',
  enabled: true, primaryStorage: null, sdnZoneName: null, createdBy: null,
  createdAt: new Date(), updatedAt: new Date(),
  nodes: [], storages: [], quota: null, usageCache: null,
  sharedBridges: [], vnets: [], pbsNamespaces: [],
}

// Permissive tx stub: resolves any tx.<model>.<method>(...) call —
// createVdc/updateVdc/deleteVdc write several child tables whose calls
// don't matter for these assertions.
const txModel = () => ({
  create: vi.fn(async () => ({})), createMany: vi.fn(async () => ({})),
  update: vi.fn(async () => ({})), upsert: vi.fn(async () => ({})),
  delete: vi.fn(async () => ({})), deleteMany: vi.fn(async () => ({})),
  findMany: vi.fn(async () => []),
})
const permissiveTransaction = async (fn: any) =>
  fn(new Proxy({}, { get: () => txModel() }))

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.tenant.findUnique.mockResolvedValue({ slug: 'acme' })
  prismaMock.vdc.findFirst.mockResolvedValue(null)
  prismaMock.connection.findUnique.mockResolvedValue(null)
  prismaMock.connection.findMany.mockResolvedValue([])
  prismaMock.providerConnection.findUnique.mockResolvedValue({ connectionId: 'conn-2' })
  prismaMock.vdcVlanPool.findMany.mockResolvedValue([])
  prismaMock.vdcVnet.findMany.mockResolvedValue([])
  prismaMock.tenantNetworkMember.findMany.mockResolvedValue([])
})

describe('createVdc guards', () => {
  it('rejects a second vDC on the same (tenant, connection)', async () => {
    prismaMock.vdc.findFirst.mockImplementation(async ({ where }: any) =>
      where.slug === undefined ? { id: 'v1', name: 'ACME — Paris' } : null
    )
    await expect(createVdc(baseInput, null)).rejects.toThrow(
      /already has a vDC on this cluster \("ACME — Paris"\)/
    )
  })

  it('rejects a slug already used by the tenant on ANOTHER connection', async () => {
    // Conflict ONLY for the widened shape { tenantId, slug } WITHOUT
    // connectionId. The legacy per-connection query ({ tenantId,
    // connectionId, slug }) keeps returning null, so this test FAILS as
    // long as the guard hasn't actually been widened tenant-wide.
    prismaMock.vdc.findFirst.mockImplementation(async ({ where }: any) =>
      where.slug !== undefined && where.connectionId === undefined ? { id: 'v1' } : null
    )
    await expect(createVdc(baseInput, null)).rejects.toThrow(/already exists for this tenant/)
    expect(prismaMock.vdc.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 't1', slug: 'acme-frankfurt' } })
    )
  })

  it('passes both guards on a free (connection, slug) pair', async () => {
    // Both guards return null; the next step (step 4, connection lookup)
    // then fails on our null connection mock — reaching that error PROVES
    // the guards let the create through.
    await expect(createVdc(baseInput, null)).rejects.toThrow(/Connection not found/)
  })

  it('still rejects the provider tenant', async () => {
    await expect(createVdc({ ...baseInput, tenantId: 'default' }, null)).rejects.toThrow(
      /provider tenant/
    )
  })

  it('rejects a connection that is not in the provider pool', async () => {
    prismaMock.providerConnection.findUnique.mockResolvedValue(null)
    await expect(createVdc(baseInput, null)).rejects.toThrow(
      /not in the provider pool/
    )
  })
})

describe('vDC mutations invalidate the scope cache', () => {
  it('createVdc calls clearVdcScopeCache on the happy path', async () => {
    prismaMock.connection.findUnique.mockResolvedValue({ tenantId: 'default' })
    getConnectionByIdMock.mockResolvedValue({ id: 'conn-2' })
    pveFetchMock.mockResolvedValue({})            // every PVE call succeeds
    generateZoneNameMock.mockResolvedValue('zacme')
    createZoneMock.mockResolvedValue(undefined)
    applySdnMock.mockResolvedValue(undefined)
    prismaMock.$transaction.mockImplementation(permissiveTransaction)
    prismaMock.vdc.findUnique.mockResolvedValue(fullRow) // getVdcById at the end

    await createVdc(baseInput, null)
    expect(clearVdcScopeCacheMock).toHaveBeenCalledWith('t1')
  })

  it('updateVdc calls clearVdcScopeCache with the vDC tenantId', async () => {
    prismaMock.vdc.findUnique
      .mockResolvedValueOnce({ id: 'v1', tenantId: 't1' }) // existence check
      .mockResolvedValueOnce(fullRow)                      // getVdcById at the end
    prismaMock.$transaction.mockImplementation(permissiveTransaction)

    await updateVdc('v1', { name: 'ACME — Paris 2' } as any)
    expect(clearVdcScopeCacheMock).toHaveBeenCalledWith('t1')
  })

  it('deleteVdc calls clearVdcScopeCache after the delete', async () => {
    // Every PVE-side step of deleteVdc is best-effort (warn + continue),
    // so a rejecting pveFetch exercises the full path without PVE mocks.
    prismaMock.vdc.findUnique.mockResolvedValue(fullRow)
    prismaMock.connection.findUnique.mockResolvedValue({ tenantId: 'default' })
    getConnectionByIdMock.mockResolvedValue({ id: 'conn-2' })
    pveFetchMock.mockRejectedValue(new Error('unreachable'))
    prismaMock.$transaction.mockImplementation(permissiveTransaction)

    await deleteVdc('v1')
    expect(clearVdcScopeCacheMock).toHaveBeenCalledWith('t1')
  })
})

// Tracked (non-permissive) transaction stub: unlike `permissiveTransaction`,
// each table proxy is memoized so the same vi.fn() instance is returned on
// every access: the tests below need to inspect the createMany/deleteMany
// call arguments after the transaction runs, which the shared proxy (a new
// txModel() per property access) does not allow.
function trackedTx() {
  const models: Record<string, ReturnType<typeof txModel>> = {}
  const proxy = new Proxy({} as any, {
    get: (_t, prop: string) => (models[prop] ??= txModel()),
  })
  return { proxy, models }
}

function happyPathPve() {
  prismaMock.connection.findUnique.mockResolvedValue({ tenantId: 'default' })
  getConnectionByIdMock.mockResolvedValue({ id: 'conn-2' })
  pveFetchMock.mockResolvedValue({})
  generateZoneNameMock.mockResolvedValue('zacme')
  createZoneMock.mockResolvedValue(undefined)
  applySdnMock.mockResolvedValue(undefined)
}

describe('createVdc VLAN pools', () => {
  it('rejects an invalid VLAN pool range before touching PVE', async () => {
    await expect(
      createVdc({ ...baseInput, vlanPools: [{ bridge: 'vmbr0', rangeStart: 0, rangeEnd: 100 }] }, null)
    ).rejects.toThrow('VLAN pool range 0-100 is invalid (bounds 1-4094, start <= end)')
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('rejects a VLAN pool that overlaps another vDC on the same connection, before touching PVE', async () => {
    prismaMock.vdcVlanPool.findMany.mockResolvedValue([
      { bridge: 'vmbr0', rangeStart: 100, rangeEnd: 200, vdc: { name: 'Globex' } },
    ])
    await expect(
      createVdc({ ...baseInput, vlanPools: [{ bridge: 'vmbr0', rangeStart: 150, rangeEnd: 250 }] }, null)
    ).rejects.toThrow('VLAN pool 150-250 on bridge "vmbr0" overlaps vDC "Globex" (100-200)')
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('persists the VLAN pool rows inside the create transaction', async () => {
    happyPathPve()
    prismaMock.vdc.findUnique.mockResolvedValue(fullRow)
    const tx = trackedTx()
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(tx.proxy))

    await createVdc({ ...baseInput, vlanPools: [{ bridge: 'vmbr0', rangeStart: 100, rangeEnd: 199 }] }, null)

    expect(tx.models.vdcVlanPool.createMany).toHaveBeenCalledWith({
      data: [
        {
          id: expect.any(String),
          vdcId: expect.any(String),
          bridge: 'vmbr0',
          rangeStart: 100,
          rangeEnd: 199,
          createdAt: expect.any(Date),
        },
      ],
    })
  })

  it('does not touch vdc_vlan_pools when no pools are given', async () => {
    happyPathPve()
    prismaMock.vdc.findUnique.mockResolvedValue(fullRow)
    const tx = trackedTx()
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(tx.proxy))

    await createVdc(baseInput, null)

    expect(tx.models.vdcVlanPool).toBeUndefined()
  })
})

describe('updateVdc VLAN pools', () => {
  it('excludes the edited vDC from the cross-vDC overlap check, using its real connectionId', async () => {
    prismaMock.vdc.findUnique
      .mockResolvedValueOnce({ id: 'v1', tenantId: 't1', connectionId: 'conn-X' }) // existence check
      .mockResolvedValueOnce(fullRow) // getVdcById at the end
    prismaMock.$transaction.mockImplementation(permissiveTransaction)

    await updateVdc('v1', { vlanPools: [{ bridge: 'vmbr0', rangeStart: 100, rangeEnd: 200 }] } as any)

    expect(prismaMock.vdcVlanPool.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { vdc: { connectionId: 'conn-X' }, vdcId: { not: 'v1' } },
      })
    )
  })

  it('rejects an overlap with another vDC on update', async () => {
    prismaMock.vdc.findUnique.mockResolvedValueOnce({ id: 'v1', tenantId: 't1', connectionId: 'conn-X' })
    prismaMock.vdcVlanPool.findMany.mockResolvedValue([
      { bridge: 'vmbr0', rangeStart: 100, rangeEnd: 200, vdc: { name: 'Globex' } },
    ])

    await expect(
      updateVdc('v1', { vlanPools: [{ bridge: 'vmbr0', rangeStart: 150, rangeEnd: 250 }] } as any)
    ).rejects.toThrow('VLAN pool 150-250 on bridge "vmbr0" overlaps vDC "Globex" (100-200)')
  })

  it('rejects a shrink that would strand an existing VLAN VNet', async () => {
    prismaMock.vdc.findUnique.mockResolvedValueOnce({ id: 'v1', tenantId: 't1', connectionId: 'conn-X' })
    prismaMock.vdcVnet.findMany.mockResolvedValue([
      { displayName: 'prod-lan', pveName: 'prod-lan', bridge: 'vmbr0', tag: 250 },
    ])

    await expect(
      updateVdc('v1', { vlanPools: [{ bridge: 'vmbr0', rangeStart: 100, rangeEnd: 200 }] } as any)
    ).rejects.toThrow('Cannot shrink VLAN pools: VNet "prod-lan" uses tag 250 on bridge "vmbr0"')
  })

  it('replaces the VLAN pool rows inside the update transaction', async () => {
    prismaMock.vdc.findUnique
      .mockResolvedValueOnce({ id: 'v1', tenantId: 't1', connectionId: 'conn-X' })
      .mockResolvedValueOnce(fullRow)
    const tx = trackedTx()
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(tx.proxy))

    await updateVdc('v1', { vlanPools: [{ bridge: 'vmbr0', rangeStart: 100, rangeEnd: 200 }] } as any)

    expect(tx.models.vdcVlanPool.deleteMany).toHaveBeenCalledWith({ where: { vdcId: 'v1' } })
    expect(tx.models.vdcVlanPool.createMany).toHaveBeenCalledWith({
      data: [
        {
          id: expect.any(String),
          vdcId: 'v1',
          bridge: 'vmbr0',
          rangeStart: 100,
          rangeEnd: 200,
          createdAt: expect.any(Date),
        },
      ],
    })
  })

  it('clears all VLAN pools when vlanPools is an empty array (no existing VLAN VNet to strand)', async () => {
    prismaMock.vdc.findUnique
      .mockResolvedValueOnce({ id: 'v1', tenantId: 't1', connectionId: 'conn-X' })
      .mockResolvedValueOnce(fullRow)
    const tx = trackedTx()
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(tx.proxy))

    await updateVdc('v1', { vlanPools: [] } as any)

    expect(tx.models.vdcVlanPool.deleteMany).toHaveBeenCalledWith({ where: { vdcId: 'v1' } })
    expect(tx.models.vdcVlanPool.createMany).not.toHaveBeenCalled()
  })

  it('leaves vdc_vlan_pools untouched when vlanPools is not part of the update', async () => {
    prismaMock.vdc.findUnique
      .mockResolvedValueOnce({ id: 'v1', tenantId: 't1', connectionId: 'conn-X' })
      .mockResolvedValueOnce(fullRow)
    const tx = trackedTx()
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(tx.proxy))

    await updateVdc('v1', { name: 'Renamed' } as any)

    expect(tx.models.vdcVlanPool).toBeUndefined()
    expect(prismaMock.vdcVlanPool.findMany).not.toHaveBeenCalled()
  })
})

describe('getVdcById VLAN pools ordering', () => {
  it('requests vlanPools sorted by bridge then rangeStart', async () => {
    prismaMock.vdc.findUnique.mockResolvedValue(fullRow)

    await getVdcById('v1')

    expect(prismaMock.vdc.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          vlanPools: { orderBy: [{ bridge: 'asc' }, { rangeStart: 'asc' }] },
        }),
      })
    )
  })
})

describe('createVdc: custom SDN zone id', () => {
  beforeEach(() => {
    happyPathPve()
    isZoneNameTakenMock.mockResolvedValue(false)
    prismaMock.vdc.findUnique.mockResolvedValue(fullRow)
    prismaMock.$transaction.mockImplementation(permissiveTransaction)
  })

  it('refuses a malformed id before touching Proxmox', async () => {
    await expect(createVdc({ ...baseInput, sdnZoneName: 'Zone-1!' }, null)).rejects.toThrow(/SDN zone ID must be 1-8 lowercase/)
    expect(createZoneMock).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('refuses an id already used on the connection', async () => {
    isZoneNameTakenMock.mockResolvedValue(true)
    await expect(createVdc({ ...baseInput, sdnZoneName: 'zacme' }, null)).rejects.toThrow(/"zacme" is already in use on this connection/)
    expect(isZoneNameTakenMock).toHaveBeenCalledWith('conn-2', 'zacme')
    expect(createZoneMock).not.toHaveBeenCalled()
  })

  it('creates the zone under the custom id, lower-cased, instead of a generated one', async () => {
    await createVdc({ ...baseInput, sdnZoneName: ' ZAcme ' }, null)
    expect(generateZoneNameMock).not.toHaveBeenCalled()
    expect(createZoneMock).toHaveBeenCalledWith({ id: 'conn-2' }, 'zacme', expect.objectContaining({ peers: ['10.0.0.1'] }))
  })
})

describe('createVdc: ISO libraries (#894)', () => {
  const STORAGES = [
    { storage: 'iso-lib', content: 'iso,vztmpl' },
    { storage: 'ceph-pool', content: 'images,rootdir' },
  ]

  beforeEach(() => {
    happyPathPve()
    pveFetchMock.mockImplementation(async (_conn: any, path: string) => (path === '/storage' ? STORAGES : {}))
    generateZoneNameMock.mockResolvedValue('zacme')
    prismaMock.vdc.findUnique.mockResolvedValue(fullRow)
  })

  it('refuses a malformed storage id, and a storage that holds no ISO content, before any zone is created', async () => {
    await expect(createVdc({ ...baseInput, isoLibraries: ['bad id!'] }, null)).rejects.toThrow(/Invalid ISO library storage id "bad id!"/)
    await expect(createVdc({ ...baseInput, isoLibraries: [{ storageId: 'ceph-pool', allowUploads: false }] }, null))
      .rejects.toThrow(/"ceph-pool" does not exist on this cluster or does not hold ISO content/)
    await expect(createVdc({ ...baseInput, isoLibraries: ['nfs-old'] }, null)).rejects.toThrow(/"nfs-old" does not exist/)
    expect(createZoneMock).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('persists the grants inside the create transaction, one row per storage, uploads allowed if any entry says so', async () => {
    const tx = trackedTx()
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(tx.proxy))

    await createVdc({
      ...baseInput,
      isoLibraries: ['iso-lib', { storageId: 'iso-lib', allowUploads: true }, { storageId: '  ', allowUploads: true }],
    }, null)

    expect(tx.models.vdcIsoLibrary.createMany).toHaveBeenCalledTimes(1)
    const { data } = (tx.models.vdcIsoLibrary.createMany.mock.calls[0] as unknown[])[0] as any
    expect(data).toEqual([expect.objectContaining({ storageId: 'iso-lib', allowUploads: true })])
  })

  it('writes no library row when none is granted', async () => {
    const tx = trackedTx()
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(tx.proxy))
    await createVdc({ ...baseInput, isoLibraries: [] }, null)
    expect(tx.models.vdcIsoLibrary).toBeUndefined()
  })
})

describe('updateVdc: ISO libraries (#894)', () => {
  it('replaces the grants when the key is present, validating them against the cluster storages', async () => {
    prismaMock.vdc.findUnique
      .mockResolvedValueOnce({ id: 'v1', tenantId: 't1', connectionId: 'conn-2', sdnZoneName: null })
      .mockResolvedValueOnce(fullRow)
    prismaMock.connection.findUnique.mockResolvedValue({ tenantId: 'default' })
    getConnectionByIdMock.mockResolvedValue({ id: 'conn-2' })
    pveFetchMock.mockImplementation(async (_conn: any, path: string) => (path === '/storage' ? [{ storage: 'iso-lib', content: 'iso' }] : {}))
    const tx = trackedTx()
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(tx.proxy))

    await updateVdc('v1', { isoLibraries: [{ storageId: 'iso-lib', allowUploads: false }] } as any)

    expect(tx.models.vdcIsoLibrary.deleteMany).toHaveBeenCalledWith({ where: { vdcId: 'v1' } })
    expect(tx.models.vdcIsoLibrary.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ vdcId: 'v1', storageId: 'iso-lib', allowUploads: false })],
    })
  })

  it('clears every grant on an empty list, and leaves them alone when the key is absent', async () => {
    prismaMock.vdc.findUnique
      .mockResolvedValueOnce({ id: 'v1', tenantId: 't1', connectionId: 'conn-2', sdnZoneName: null })
      .mockResolvedValueOnce(fullRow)
      .mockResolvedValueOnce({ id: 'v1', tenantId: 't1', connectionId: 'conn-2', sdnZoneName: null })
      .mockResolvedValueOnce(fullRow)
    // An empty list still resolves the connection, but never asks Proxmox for its storages.
    prismaMock.connection.findUnique.mockResolvedValue({ tenantId: 'default' })
    getConnectionByIdMock.mockResolvedValue({ id: 'conn-2' })
    const first = trackedTx()
    prismaMock.$transaction.mockImplementationOnce(async (fn: any) => fn(first.proxy))
    await updateVdc('v1', { isoLibraries: [] } as any)
    expect(first.models.vdcIsoLibrary.deleteMany).toHaveBeenCalledWith({ where: { vdcId: 'v1' } })
    expect(first.models.vdcIsoLibrary.createMany).not.toHaveBeenCalled()
    expect(pveFetchMock).not.toHaveBeenCalled()

    const second = trackedTx()
    prismaMock.$transaction.mockImplementationOnce(async (fn: any) => fn(second.proxy))
    await updateVdc('v1', { name: 'ACME — Paris 2' } as any)
    expect(second.models.vdcIsoLibrary).toBeUndefined()
  })
})

describe('deleteVdc: stretched tenant networks (#901)', () => {
  beforeEach(() => {
    prismaMock.vdc.findUnique.mockReset().mockResolvedValue(fullRow)
    prismaMock.connection.findUnique.mockResolvedValue({ tenantId: 'default' })
    getConnectionByIdMock.mockResolvedValue({ id: 'conn-2' })
    pveFetchMock.mockRejectedValue(new Error('unreachable'))
    prismaMock.$transaction.mockImplementation(permissiveTransaction)
    syncNetworksOfVdcMock.mockResolvedValue([])
  })

  it('re-syncs, after the delete, the networks the vDC carried so the other members drop its peers', async () => {
    prismaMock.tenantNetworkMember.findMany.mockResolvedValue([{ tenantNetworkId: 'n1' }, { tenantNetworkId: 'n2' }])
    await deleteVdc('v1')
    expect(prismaMock.tenantNetworkMember.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { vdcId: 'v1' } }))
    expect(syncNetworksOfVdcMock).toHaveBeenCalledWith('v1', ['n1', 'n2'])
    // The memberships are read before the rows go, the sync runs after.
    expect(prismaMock.tenantNetworkMember.findMany.mock.invocationCallOrder[0]).toBeLessThan(prismaMock.$transaction.mock.invocationCallOrder[0])
    expect(syncNetworksOfVdcMock.mock.invocationCallOrder[0]).toBeGreaterThan(prismaMock.$transaction.mock.invocationCallOrder[0])
  })

  it('touches no network for a vDC that carried none', async () => {
    await deleteVdc('v1')
    expect(syncNetworksOfVdcMock).not.toHaveBeenCalled()
  })
})
