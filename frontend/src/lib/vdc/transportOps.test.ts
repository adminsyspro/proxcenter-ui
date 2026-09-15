/**
 * MOCK-based tests for the zone sync and transport provisioning of a vDC (#899).
 * Run with the unit config (no Postgres):
 *   npx vitest run --config vitest.unit.config.ts src/lib/vdc/transportOps.test.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock, pveFetchMock, getConnectionByIdMock } = vi.hoisted(() => ({
  prismaMock: {
    vdc: { findUnique: vi.fn(), findMany: vi.fn() },
    connection: { findUnique: vi.fn() },
  } as any,
  pveFetchMock: vi.fn(),
  getConnectionByIdMock: vi.fn(),
}))

vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: getConnectionByIdMock }))
vi.mock('./stretchPeers', async (importOriginal) => ({ ...(await importOriginal<any>()), memberPeersForVdc: vi.fn().mockResolvedValue([]) }))

import { assertNoTransportConflict, effectiveZoneConfig, getVdcTransportStatus, getVdcZoneStatus, provisionVdcTransport, syncVdcZone } from './transportOps'
import { DEFAULT_TRANSPORT } from './transport'

const conn = { baseUrl: 'https://pve', apiToken: 't' }

const baseRow = {
  id: 'v1', connectionId: 'c1', sdnZoneName: 'zfoo', slug: 'acme',
  vxlanTransportMode: 'cluster', vxlanPeers: [], vxlanMtu: null,
  transportVlanId: null, transportDevice: null, transportCidr: null, transportNodeAddresses: null,
}

function putPaths(): string[] {
  return pveFetchMock.mock.calls.filter((c: any[]) => c[2]?.method === 'PUT').map((c: any[]) => c[1])
}

beforeEach(() => {
  pveFetchMock.mockReset()
  prismaMock.vdc.findUnique.mockReset()
  prismaMock.vdc.findMany.mockReset()
  prismaMock.vdc.findMany.mockResolvedValue([])
  prismaMock.connection.findUnique.mockReset()
  getConnectionByIdMock.mockReset()
  prismaMock.connection.findUnique.mockResolvedValue({ tenantId: 'default' })
  getConnectionByIdMock.mockResolvedValue(conn)
})

describe('effectiveZoneConfig', () => {
  it('prefers staged values and understands a deleted property', () => {
    expect(effectiveZoneConfig({
      type: 'vxlan', peers: ['a'], mtu: 1400, state: 'changed', pending: { peers: 'a,b', mtu: 'deleted' },
    })).toEqual({ peers: ['a', 'b'], mtu: null })
    expect(effectiveZoneConfig({ type: 'vxlan', peers: ['a'], mtu: null, state: null, pending: null }))
      .toEqual({ peers: ['a'], mtu: null })
    expect(effectiveZoneConfig({ type: 'vxlan', peers: ['a'], mtu: null, state: 'changed', pending: { mtu: '1400' } }))
      .toEqual({ peers: ['a'], mtu: 1400 })
  })
})

describe('getVdcZoneStatus / syncVdcZone', () => {
  it('reports a cluster-mode zone in sync when Proxmox carries the node addresses', async () => {
    prismaMock.vdc.findUnique.mockResolvedValue(baseRow)
    pveFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path === '/cluster/status') return [{ type: 'node', ip: '10.42.0.101' }, { type: 'node', ip: '10.42.0.102' }, { type: 'cluster' }]
      if (path === '/cluster/sdn/zones/zfoo?pending=1') return { type: 'vxlan', peers: '10.42.0.102,10.42.0.101' }
      throw new Error(`unexpected ${path}`)
    })

    const status = await getVdcZoneStatus('v1')
    expect(status.inSync).toBe(true)
    expect(status.desired.peers).toEqual(['10.42.0.101', '10.42.0.102'])
    expect(status.live?.peers).toEqual(['10.42.0.102', '10.42.0.101'])

    const result = await syncVdcZone('v1')
    expect(result.changed).toBe(false)
    expect(putPaths()).toEqual([])
  })

  it('pushes the address of a node that joined the cluster, then applies', async () => {
    prismaMock.vdc.findUnique.mockResolvedValue(baseRow)
    let livePeers = '10.42.0.101'
    pveFetchMock.mockImplementation(async (_c: any, path: string, init?: any) => {
      if (path === '/cluster/status') return [{ type: 'node', ip: '10.42.0.101' }, { type: 'node', ip: '10.42.0.103' }]
      if (path === '/cluster/sdn/zones/zfoo?pending=1') return { type: 'vxlan', peers: livePeers }
      if (path === '/cluster/sdn/zones/zfoo' && init?.method === 'PUT') {
        livePeers = (init.body as URLSearchParams).get('peers')!
        return undefined
      }
      if (path === '/cluster/sdn' && init?.method === 'PUT') return undefined
      throw new Error(`unexpected ${path}`)
    })

    const result = await syncVdcZone('v1')
    expect(result.changed).toBe(true)
    expect(result.inSync).toBe(true)
    expect(putPaths()).toEqual(['/cluster/sdn/zones/zfoo', '/cluster/sdn'])
    const put = pveFetchMock.mock.calls.find((c: any[]) => c[1] === '/cluster/sdn/zones/zfoo')!
    const body = put[2].body as URLSearchParams
    expect(body.get('peers')).toBe('10.42.0.101,10.42.0.103')
    expect(body.get('delete')).toBe('mtu')
  })

  it('applies a change that is still staged even when the config already matches', async () => {
    prismaMock.vdc.findUnique.mockResolvedValue({ ...baseRow, vxlanTransportMode: 'peers', vxlanPeers: ['10.0.0.1', '10.0.0.2'] })
    pveFetchMock.mockImplementation(async (_c: any, path: string, init?: any) => {
      if (path === '/cluster/sdn/zones/zfoo?pending=1') {
        return { type: 'vxlan', peers: '10.0.0.1', state: 'changed', pending: { peers: '10.0.0.1,10.0.0.2' } }
      }
      if (path === '/cluster/sdn' && init?.method === 'PUT') return undefined
      throw new Error(`unexpected ${path}`)
    })

    const result = await syncVdcZone('v1')
    expect(result.changed).toBe(true)
    expect(putPaths()).toEqual(['/cluster/sdn'])
  })

  it('recreates a zone that vanished from Proxmox', async () => {
    prismaMock.vdc.findUnique.mockResolvedValue({
      ...baseRow, vxlanTransportMode: 'peers', vxlanPeers: ['10.0.0.1', '10.0.0.2'], vxlanMtu: 1400,
    })
    let exists = false
    pveFetchMock.mockImplementation(async (_c: any, path: string, init?: any) => {
      if (path === '/cluster/sdn/zones/zfoo?pending=1') {
        if (!exists) throw new Error("sdn zone 'zfoo' does not exist")
        return { type: 'vxlan', peers: '10.0.0.1,10.0.0.2', mtu: 1400 }
      }
      if (path === '/cluster/sdn/zones' && init?.method === 'POST') { exists = true; return undefined }
      if (path === '/cluster/sdn' && init?.method === 'PUT') return undefined
      throw new Error(`unexpected ${path}`)
    })

    const result = await syncVdcZone('v1')
    expect(result.changed).toBe(true)
    expect(result.inSync).toBe(true)
    const post = pveFetchMock.mock.calls.find((c: any[]) => c[1] === '/cluster/sdn/zones')!
    const body = post[2].body as URLSearchParams
    expect(body.get('zone')).toBe('zfoo')
    expect(body.get('peers')).toBe('10.0.0.1,10.0.0.2')
    expect(body.get('mtu')).toBe('1400')
    // Peer list mode never reads the cluster addresses.
    expect(pveFetchMock.mock.calls.some((c: any[]) => c[1] === '/cluster/status')).toBe(false)
  })

  it('refuses a vDC without a zone', async () => {
    prismaMock.vdc.findUnique.mockResolvedValue({ ...baseRow, sdnZoneName: null })
    await expect(syncVdcZone('v1')).rejects.toThrow(/has no SDN zone/)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('fails on an unknown vDC before touching Proxmox', async () => {
    prismaMock.vdc.findUnique.mockResolvedValue(null)
    await expect(getVdcZoneStatus('nope')).rejects.toThrow(/vDC not found/)
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })
})

describe('provisionVdcTransport', () => {
  const transportRow = {
    ...baseRow, vxlanTransportMode: 'transport', vxlanMtu: 1450,
    transportVlanId: 4000, transportDevice: 'vmbr0', transportCidr: '10.100.5.0/24',
    transportNodeAddresses: { pve1: '10.100.5.1', pve2: '10.100.5.2', pve3: '10.100.5.3', pve4: '10.100.5.4' },
  }

  it('refuses a vDC that is not in transport mode', async () => {
    prismaMock.vdc.findUnique.mockResolvedValue(baseRow)
    await expect(provisionVdcTransport('v1')).rejects.toThrow(/not in transport network mode/)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('creates, updates, leaves alone and reports per node', async () => {
    prismaMock.vdc.findUnique.mockResolvedValue(transportRow)
    pveFetchMock.mockImplementation(async (_c: any, path: string, init?: any) => {
      if (path === '/cluster/sdn' && init?.method === 'PUT') return undefined
      const m = /^\/nodes\/(pve\d)\/network(?:\/(.+))?$/.exec(path)
      if (!m) throw new Error(`unexpected ${path}`)
      const node = m[1]
      if (!init?.method) {
        if (node === 'pve1') return [{ iface: 'vmbr0', type: 'bridge' }]
        if (node === 'pve2') return [{ iface: 'vmbr0.4000', type: 'vlan', cidr: '10.100.5.2/24', mtu: 1500 }]
        if (node === 'pve3') return [{ iface: 'vmbr0.4000', type: 'vlan', cidr: '10.100.5.9/24', mtu: 1500 }]
        throw new Error('500 connection refused')
      }
      return undefined
    })

    const results = await provisionVdcTransport('v1')
    expect(results).toEqual([
      { node: 'pve1', iface: 'vmbr0.4000', action: 'created' },
      { node: 'pve2', iface: 'vmbr0.4000', action: 'unchanged' },
      { node: 'pve3', iface: 'vmbr0.4000', action: 'updated' },
      { node: 'pve4', iface: 'vmbr0.4000', action: 'error', message: '500 connection refused' },
    ])

    const post = pveFetchMock.mock.calls.find((c: any[]) => c[1] === '/nodes/pve1/network' && c[2]?.method === 'POST')!
    const created = post[2].body as URLSearchParams
    expect(created.get('iface')).toBe('vmbr0.4000')
    expect(created.get('type')).toBe('vlan')
    expect(created.get('cidr')).toBe('10.100.5.1/24')
    expect(created.get('mtu')).toBe('1500')
    expect(created.get('autostart')).toBe('1')
    expect(created.get('comments')).toContain('acme')

    const update = pveFetchMock.mock.calls.find((c: any[]) => c[1] === '/nodes/pve3/network/vmbr0.4000')!
    expect(update[2].method).toBe('PUT')
    const updated = update[2].body as URLSearchParams
    expect(updated.get('cidr')).toBe('10.100.5.3/24')
    expect(updated.has('iface')).toBe(false)

    // The network is reloaded only on the nodes that changed, then the SDN
    // config is re-rendered once so the VXLAN interfaces pick their new
    // local address.
    const reloads = pveFetchMock.mock.calls
      .filter((c: any[]) => c[2]?.method === 'PUT' && /^\/nodes\/pve\d\/network$/.test(c[1]))
      .map((c: any[]) => c[1])
    expect(reloads).toEqual(['/nodes/pve1/network', '/nodes/pve3/network'])
    const applies = pveFetchMock.mock.calls.filter((c: any[]) => c[1] === '/cluster/sdn' && c[2]?.method === 'PUT')
    expect(applies).toHaveLength(1)
    expect(pveFetchMock.mock.calls.at(-1)?.[1]).toBe('/cluster/sdn')
  })

  it('does not touch the SDN config when every node is already provisioned', async () => {
    prismaMock.vdc.findUnique.mockResolvedValue({ ...transportRow, transportNodeAddresses: { pve2: '10.100.5.2' } })
    pveFetchMock.mockImplementation(async (_c: any, path: string, init?: any) => {
      if (path === '/nodes/pve2/network' && !init?.method) {
        return [{ iface: 'vmbr0.4000', type: 'vlan', cidr: '10.100.5.2/24', mtu: 1500 }]
      }
      throw new Error(`unexpected ${path}`)
    })

    expect(await provisionVdcTransport('v1')).toEqual([{ node: 'pve2', iface: 'vmbr0.4000', action: 'unchanged' }])
    expect(pveFetchMock.mock.calls.some((c: any[]) => c[2]?.method === 'PUT')).toBe(false)
  })

  it('reports the state of every node without writing anything', async () => {
    prismaMock.vdc.findUnique.mockResolvedValue(transportRow)
    pveFetchMock.mockImplementation(async (_c: any, path: string, init?: any) => {
      if (init?.method) throw new Error(`unexpected write ${init.method} ${path}`)
      const m = /^\/nodes\/(pve\d)\/network$/.exec(path)
      if (!m) throw new Error(`unexpected ${path}`)
      if (m[1] === 'pve1') return [{ iface: 'vmbr0', type: 'bridge' }]
      if (m[1] === 'pve2') return [{ iface: 'vmbr0.4000', type: 'vlan', cidr: '10.100.5.2/24', mtu: 1500 }]
      if (m[1] === 'pve3') return [{ iface: 'vmbr0.4000', type: 'vlan', cidr: '10.100.5.9/24', mtu: 1500 }]
      throw new Error('500 connection refused')
    })

    expect(await getVdcTransportStatus('v1')).toEqual([
      { node: 'pve1', iface: 'vmbr0.4000', state: 'missing', wanted: '10.100.5.1/24, MTU 1500', found: null },
      { node: 'pve2', iface: 'vmbr0.4000', state: 'provisioned', wanted: '10.100.5.2/24, MTU 1500', found: '10.100.5.2/24, MTU 1500' },
      { node: 'pve3', iface: 'vmbr0.4000', state: 'drift', wanted: '10.100.5.3/24, MTU 1500', found: '10.100.5.9/24, MTU 1500' },
      { node: 'pve4', iface: 'vmbr0.4000', state: 'unreachable', wanted: '10.100.5.4/24, MTU 1500', found: null, message: '500 connection refused' },
    ])
  })

  it('has no node status outside transport mode', async () => {
    prismaMock.vdc.findUnique.mockResolvedValue(baseRow)
    expect(await getVdcTransportStatus('v1')).toEqual([])
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('omits the MTU when the zone leaves it to PVE, and uses cidr6 for IPv6', async () => {
    prismaMock.vdc.findUnique.mockResolvedValue({
      ...transportRow, vxlanMtu: null, transportCidr: 'fd00:5::/64', transportNodeAddresses: { pve1: 'fd00:5::1' },
    })
    pveFetchMock.mockImplementation(async (_c: any, _path: string, init?: any) => (init?.method ? undefined : []))

    const results = await provisionVdcTransport('v1')
    expect(results).toEqual([{ node: 'pve1', iface: 'vmbr0.4000', action: 'created' }])
    const post = pveFetchMock.mock.calls.find((c: any[]) => c[2]?.method === 'POST')!
    const body = post[2].body as URLSearchParams
    expect(body.get('cidr6')).toBe('fd00:5::1/64')
    expect(body.has('cidr')).toBe(false)
    expect(body.has('mtu')).toBe(false)
  })
})

describe('assertNoTransportConflict', () => {
  const transport = {
    ...DEFAULT_TRANSPORT,
    mode: 'transport' as const,
    vlanId: 4000,
    device: 'vmbr0',
    cidr: '10.100.5.0/24',
    nodeAddresses: { pve1: '10.100.5.1' },
  }
  const otherRow = (over: Record<string, unknown> = {}) => ({
    name: 'Acme prod',
    vxlanTransportMode: 'transport', vxlanPeers: [], vxlanMtu: null,
    transportVlanId: 4000, transportDevice: 'vmbr0', transportCidr: '10.100.5.0/24',
    transportNodeAddresses: { pve1: '10.100.5.1' },
    ...over,
  })

  it('only looks at the transport-mode vDCs of the cluster, and never at itself', async () => {
    await assertNoTransportConflict('c1', 'v1', transport)
    expect(prismaMock.vdc.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { connectionId: 'c1', vxlanTransportMode: 'transport', id: { not: 'v1' } },
    }))
  })

  it('reads nothing for a mode that provisions nothing', async () => {
    await assertNoTransportConflict('c1', null, { ...DEFAULT_TRANSPORT })
    expect(prismaMock.vdc.findMany).not.toHaveBeenCalled()
  })

  it('accepts a segment described identically by another vDC', async () => {
    prismaMock.vdc.findMany.mockResolvedValue([otherRow()])
    await expect(assertNoTransportConflict('c1', 'v1', transport)).resolves.toBeUndefined()
  })

  it('refuses a divergent segment, naming the owner, with a message the route maps to 409', async () => {
    prismaMock.vdc.findMany.mockResolvedValue([otherRow({
      transportCidr: '10.100.6.0/24', transportNodeAddresses: { pve1: '10.100.6.1' },
    })])
    await expect(assertNoTransportConflict('c1', 'v1', transport))
      .rejects.toThrow(/VXLAN transport: interface "vmbr0.4000" is in use by vDC "Acme prod" with segment 10.100.6.0\/24/)
  })

  it('refuses an address another vDC gives to another node', async () => {
    prismaMock.vdc.findMany.mockResolvedValue([otherRow({ transportNodeAddresses: { pve2: '10.100.5.1' } })])
    await expect(assertNoTransportConflict('c1', 'v1', transport))
      .rejects.toThrow(/gives the address 10.100.5.1 to node "pve2"/)
  })

  it('refuses one segment carried by two interfaces', async () => {
    prismaMock.vdc.findMany.mockResolvedValue([otherRow({ transportDevice: 'vmbr1' })])
    await expect(assertNoTransportConflict('c1', 'v1', transport))
      .rejects.toThrow(/segment 10.100.5.0\/24 is in use by vDC "Acme prod" on interface "vmbr1.4000"/)
  })
})
