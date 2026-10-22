/**
 * MOCK-based tests for the blank VM switch of a vDC (#1171): stored only when
 * the PUT carries it, read back as a strict boolean.
 * Run with the unit config (no Postgres):
 *   npx vitest run --config vitest.unit.config.ts src/lib/vdc/index.allowBlankVms.test.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  prismaMock, pveFetchMock, getConnectionByIdMock,
  updateZoneMock, listClusterNodeIpsMock, applySdnMock,
} = vi.hoisted(() => ({
  prismaMock: {
    tenant: { findUnique: vi.fn() },
    vdc: { findFirst: vi.fn(), findUnique: vi.fn() },
    vdcVnet: { findMany: vi.fn() },
    vdcVlanPool: { findMany: vi.fn() },
    connection: { findUnique: vi.fn(), findMany: vi.fn() },
    providerConnection: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  } as any,
  pveFetchMock: vi.fn(),
  getConnectionByIdMock: vi.fn(),
  updateZoneMock: vi.fn(),
  listClusterNodeIpsMock: vi.fn(),
  applySdnMock: vi.fn(),
}))

vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))
vi.mock('@/lib/proxmox/pbs-client', () => ({ pbsFetch: vi.fn() }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: getConnectionByIdMock }))
vi.mock('@/lib/crypto/secret', () => ({ decryptSecret: vi.fn() }))
vi.mock('@/lib/tenant', () => ({ DEFAULT_TENANT_ID: 'default' }))
vi.mock('./sdn', () => ({
  generateZoneName: vi.fn(),
  createZone: vi.fn(),
  deleteZone: vi.fn(),
  deleteVnetPve: vi.fn(),
  applySdn: applySdnMock,
  updateZone: updateZoneMock,
  listClusterNodeIps: listClusterNodeIpsMock,
}))
vi.mock('./scope', () => ({ clearVdcScopeCache: vi.fn() }))
vi.mock('./tenantNetworkMembers', () => ({ syncNetworksOfVdc: vi.fn().mockResolvedValue([]) }))
vi.mock('./stretchPeers', async (importOriginal) => ({ ...(await importOriginal<any>()), memberPeersForVdc: vi.fn().mockResolvedValue([]) }))

import { getVdcById, updateVdc } from './index'

const conn = { id: 'conn-2' }

// What updateVdc selects first.
const existing = {
  id: 'v1', tenantId: 't1', connectionId: 'conn-2', sdnZoneName: 'zacme',
  cpuModelMode: 'unrestricted', cpuAllowedModels: [], cpuDefaultModel: null, cpuAdvancedSettings: true,
  vxlanTransportMode: 'cluster', vxlanPeers: [], vxlanMtu: null,
  transportVlanId: null, transportDevice: null, transportCidr: null, transportNodeAddresses: null,
}

// What getVdcById reads at the end.
const fullRow = {
  id: 'v1', tenantId: 't1', connectionId: 'conn-2', name: 'ACME', slug: 'acme',
  description: null, pvePoolName: 'vdc-acme-acme', enabled: true, primaryStorage: null,
  sdnZoneName: 'zacme', createdBy: null, createdAt: new Date(), updatedAt: new Date(),
  nodes: [], storages: [], quota: null, usageCache: null,
  sharedBridges: [], vnets: [], pbsNamespaces: [],
}

const txModel = () => ({
  create: vi.fn(async () => ({})), createMany: vi.fn(async () => ({})),
  update: vi.fn(async () => ({})), upsert: vi.fn(async () => ({})),
  delete: vi.fn(async () => ({})), deleteMany: vi.fn(async () => ({})),
  findMany: vi.fn(async () => []),
})

function trackedTx() {
  const models: Record<string, ReturnType<typeof txModel>> = {}
  const proxy = new Proxy({} as any, {
    get: (_t, prop: string) => (models[prop] ??= txModel()),
  })
  return { proxy, models }
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.connection.findUnique.mockResolvedValue({ tenantId: 'default' })
  prismaMock.connection.findMany.mockResolvedValue([])
  prismaMock.vdcVlanPool.findMany.mockResolvedValue([])
  prismaMock.vdcVnet.findMany.mockResolvedValue([])
  prismaMock.vdc.findUnique
    .mockResolvedValueOnce(existing)
    .mockResolvedValueOnce(fullRow)
  getConnectionByIdMock.mockResolvedValue(conn)
  listClusterNodeIpsMock.mockResolvedValue(['10.42.0.101', '10.42.0.102'])
  updateZoneMock.mockResolvedValue(undefined)
  applySdnMock.mockResolvedValue(undefined)
})

describe('vDC blank VM switch (#1171)', () => {
  it('stores the switch when the PUT carries it', async () => {
    const tx = trackedTx()
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(tx.proxy))

    await updateVdc('v1', { allowBlankVms: true })

    expect(tx.models.vdc.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ allowBlankVms: true }),
    }))
  })

  it('leaves the stored value alone when the PUT does not carry it', async () => {
    const tx = trackedTx()
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(tx.proxy))

    await updateVdc('v1', { name: 'ACME 2' })

    const data = tx.models.vdc.update.mock.calls[0][0].data
    expect(data).not.toHaveProperty('allowBlankVms')
  })

  it('reads the switch back as a strict boolean', async () => {
    prismaMock.vdc.findUnique.mockReset()
    prismaMock.vdc.findUnique.mockResolvedValueOnce({ ...fullRow, allowBlankVms: true })
    expect((await getVdcById('v1'))?.allowBlankVms).toBe(true)

    prismaMock.vdc.findUnique.mockResolvedValueOnce({ ...fullRow, allowBlankVms: null })
    expect((await getVdcById('v1'))?.allowBlankVms).toBe(false)
  })
})
