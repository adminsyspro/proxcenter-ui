/**
 * MOCK-based tests for the VXLAN transport path of updateVdc (#899): the
 * zone is rewritten on Proxmox BEFORE the row is written, and only when the
 * resolved peers or the MTU actually change.
 * Run with the unit config (no Postgres):
 *   npx vitest run --config vitest.unit.config.ts src/lib/vdc/index.transport.test.ts
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

import { updateVdc } from './index'

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

describe('updateVdc VXLAN transport', () => {
  it('a PUT that leaves the transport unchanged never touches the zone', async () => {
    const tx = trackedTx()
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(tx.proxy))

    await updateVdc('v1', { transport: { mode: 'cluster', peers: [], mtu: null } })

    expect(updateZoneMock).not.toHaveBeenCalled()
    expect(applySdnMock).not.toHaveBeenCalled()
    expect(tx.models.vdc.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ vxlanTransportMode: 'cluster', vxlanPeers: [], vxlanMtu: null }),
    }))
  })

  it('switching to a peer list rewrites the zone, then stores the mode, then applies', async () => {
    const order: string[] = []
    updateZoneMock.mockImplementation(async () => { order.push('updateZone') })
    applySdnMock.mockImplementation(async () => { order.push('applySdn') })
    const tx = trackedTx()
    prismaMock.$transaction.mockImplementation(async (fn: any) => { order.push('transaction'); return fn(tx.proxy) })

    await updateVdc('v1', { transport: { mode: 'peers', peers: ['10.0.0.1', '10.0.0.2'], mtu: 1400 } })

    expect(updateZoneMock).toHaveBeenCalledWith(conn, 'zacme', { peers: ['10.0.0.1', '10.0.0.2'], mtu: 1400 })
    expect(order).toEqual(['updateZone', 'transaction', 'applySdn'])
    expect(tx.models.vdc.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        vxlanTransportMode: 'peers', vxlanPeers: ['10.0.0.1', '10.0.0.2'], vxlanMtu: 1400,
        transportVlanId: null, transportDevice: null, transportCidr: null, transportNodeAddresses: {},
      }),
    }))
  })

  it('an MTU-only change in cluster mode keeps the node addresses as peers', async () => {
    const tx = trackedTx()
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(tx.proxy))

    await updateVdc('v1', { transport: { mtu: 1450 } })

    expect(updateZoneMock).toHaveBeenCalledWith(conn, 'zacme', { peers: ['10.42.0.101', '10.42.0.102'], mtu: 1450 })
    expect(applySdnMock).toHaveBeenCalledTimes(1)
  })

  it('a refusal from Proxmox leaves the row untouched', async () => {
    updateZoneMock.mockRejectedValue(new Error('Failed to update SDN zone "zacme": 400 peers: invalid format'))

    await expect(updateVdc('v1', { transport: { mode: 'peers', peers: ['10.0.0.1'] } }))
      .rejects.toThrow(/Failed to update SDN zone/)

    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(applySdnMock).not.toHaveBeenCalled()
  })

  it('an invalid transport is refused before any Proxmox call', async () => {
    await expect(updateVdc('v1', { transport: { mode: 'peers', peers: ['pve2'] } }))
      .rejects.toThrow(/VXLAN transport: "pve2" is not a valid/)

    expect(getConnectionByIdMock).not.toHaveBeenCalled()
    expect(updateZoneMock).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('a vDC without a zone stores the transport without calling Proxmox', async () => {
    prismaMock.vdc.findUnique.mockReset()
    prismaMock.vdc.findUnique
      .mockResolvedValueOnce({ ...existing, sdnZoneName: null })
      .mockResolvedValueOnce({ ...fullRow, sdnZoneName: null })
    const tx = trackedTx()
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(tx.proxy))

    await updateVdc('v1', { transport: { mode: 'peers', peers: ['10.0.0.1'] } })

    expect(updateZoneMock).not.toHaveBeenCalled()
    expect(tx.models.vdc.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ vxlanTransportMode: 'peers', vxlanPeers: ['10.0.0.1'] }),
    }))
  })
})

describe('updateVdc and stretched tenant networks (#901)', () => {
  it('keeps the peers of the other members in the zone, and re-syncs those networks once the zone changed', async () => {
    const { memberPeersForVdc } = await import('./stretchPeers')
    const { syncNetworksOfVdc } = await import('./tenantNetworkMembers')
    vi.mocked(memberPeersForVdc).mockResolvedValueOnce(['203.0.113.50', '10.0.0.1'])
    const tx = trackedTx()
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(tx.proxy))

    await updateVdc('v1', { transport: { mode: 'peers', peers: ['10.0.0.1', '10.0.0.2'] } })

    // Own peers first, the members' peers after, no duplicate.
    expect(updateZoneMock).toHaveBeenCalledWith(conn, 'zacme', { peers: ['10.0.0.1', '10.0.0.2', '203.0.113.50'], mtu: null })
    expect(syncNetworksOfVdc).toHaveBeenCalledWith('v1')
    expect(vi.mocked(syncNetworksOfVdc).mock.invocationCallOrder[0]).toBeGreaterThan(applySdnMock.mock.invocationCallOrder[0])
  })

  it('re-syncs nothing when the zone did not change', async () => {
    const { syncNetworksOfVdc } = await import('./tenantNetworkMembers')
    const tx = trackedTx()
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(tx.proxy))

    await updateVdc('v1', { transport: { mode: 'cluster' } })

    expect(updateZoneMock).not.toHaveBeenCalled()
    expect(syncNetworksOfVdc).not.toHaveBeenCalled()
  })

  it('still stores the transport when the SDN apply fails after the zone rewrite', async () => {
    applySdnMock.mockRejectedValueOnce(new Error('ifreload failed on pve2'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const tx = trackedTx()
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(tx.proxy))

    await updateVdc('v1', { transport: { mode: 'peers', peers: ['10.0.0.1'] } })

    expect(tx.models.vdc.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ vxlanTransportMode: 'peers', vxlanPeers: ['10.0.0.1'] }),
    }))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('applySdn failed after updating zone "zacme"'))
    warn.mockRestore()
  })
})
