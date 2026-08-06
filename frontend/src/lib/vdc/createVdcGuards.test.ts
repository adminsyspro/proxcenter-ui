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
} = vi.hoisted(() => ({
  prismaMock: {
    tenant: { findUnique: vi.fn() },
    vdc: { findFirst: vi.fn(), findUnique: vi.fn() },
    vdcVnet: { findMany: vi.fn() },
    connection: { findUnique: vi.fn(), findMany: vi.fn() },
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
  createZone: createZoneMock,
  deleteZone: vi.fn(),
  deleteVnetPve: vi.fn(),
  applySdn: applySdnMock,
}))
vi.mock('./scope', () => ({ clearVdcScopeCache: clearVdcScopeCacheMock }))

import { createVdc, updateVdc, deleteVdc } from './index'

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
