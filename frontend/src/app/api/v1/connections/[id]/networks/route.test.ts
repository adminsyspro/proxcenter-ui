import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const getConnectionByIdMock = vi.fn<(id: string) => Promise<any>>()
const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()
const getVdcScopeMock = vi.fn<(tenantId?: string) => Promise<any>>()

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { VM_VIEW: 'vm.view' },
}))

vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: getConnectionByIdMock,
}))

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: pveFetchMock,
}))

vi.mock('@/lib/tenant', () => ({
  getCurrentTenantId: async () => 'tenant-1',
}))

vi.mock('@/lib/vdc/scope', () => ({
  getVdcScope: getVdcScopeMock,
}))

// DRO34's node network (discussion #389): one bridge per VLAN over bond
// sub-interfaces, plus a raw-trunk bridge that must stay Untagged.
const HOST_NETWORK = [
  { iface: 'bond0', type: 'bond' },
  { iface: 'bond0.10', type: 'vlan' },
  { iface: 'vmbr0V10', type: 'bridge', bridge_ports: 'bond0.10', bridge_vlan_aware: 1 },
  { iface: 'vmbr0', type: 'bridge', bridge_ports: 'bond0', bridge_vlan_aware: 1 },
]

const RESOURCES = [
  { vmid: 100, node: 'pve1', type: 'qemu', name: 'tagged-nic', status: 'running' },
  { vmid: 101, node: 'pve1', type: 'qemu', name: 'host-vlan', status: 'running' },
  { vmid: 102, node: 'pve1', type: 'qemu', name: 'raw-trunk', status: 'stopped' },
]

const CONFIGS: Record<string, any> = {
  '/nodes/pve1/qemu/100/config': { net0: 'virtio=AA:BB:CC:00:00:01,bridge=vmbrX,tag=200' },
  '/nodes/pve1/qemu/101/config': { net0: 'virtio=AA:BB:CC:00:00:02,bridge=vmbr0V10' },
  '/nodes/pve1/qemu/102/config': { net0: 'virtio=AA:BB:CC:00:00:03,bridge=vmbr0' },
}

function wireProxmox() {
  pveFetchMock.mockImplementation(async (_conn: any, path: string) => {
    if (path === '/cluster/resources?type=vm') return RESOURCES
    if (path === '/cluster/resources?type=node') return [{ node: 'pve1' }]
    if (path === '/nodes/pve1/network') return HOST_NETWORK
    if (path === '/cluster/sdn/vnets') return []
    if (path in CONFIGS) return CONFIGS[path]
    throw new Error(`unexpected pveFetch path: ${path}`)
  })
}

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getConnectionByIdMock.mockReset().mockResolvedValue({ baseUrl: 'https://10.0.0.1:8006', apiToken: 'tok=secret' })
  pveFetchMock.mockReset()
  getVdcScopeMock.mockReset().mockResolvedValue(null)
})

async function importGET() {
  const mod = await import('./route')
  return mod.GET as Parameters<typeof callRoute>[0]
}

function netOf(body: any, vmid: string) {
  const vm = body.data.find((v: any) => String(v.vmid) === vmid)
  return vm.nets[0]
}

describe('GET /api/v1/connections/[id]/networks — effectiveTag', () => {
  it('keeps the per-NIC tag as the effective VLAN', async () => {
    wireProxmox()
    const res = await callRoute(await importGET(), { params: { id: 'c1' } })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    const net = netOf(body, '100')
    expect(net.tag).toBe(200)
    expect(net.effectiveTag).toBe(200)
  })

  it('resolves an untagged guest VLAN from its host bridge sub-interface', async () => {
    wireProxmox()
    const body = await readJson<any>(await callRoute(await importGET(), { params: { id: 'c1' } }))
    const net = netOf(body, '101')
    expect(net.tag).toBeUndefined()
    expect(net.effectiveTag).toBe(10)
  })

  it('leaves an untagged guest on a raw-trunk bridge as untagged', async () => {
    wireProxmox()
    const body = await readJson<any>(await callRoute(await importGET(), { params: { id: 'c1' } }))
    const net = netOf(body, '102')
    expect(net.tag).toBeUndefined()
    expect(net.effectiveTag).toBeUndefined()
  })

  it('still succeeds when a node network fetch fails (no effectiveTag enrichment)', async () => {
    pveFetchMock.mockImplementation(async (_conn: any, path: string) => {
      if (path === '/cluster/resources?type=vm') return RESOURCES
      if (path === '/cluster/resources?type=node') return [{ node: 'pve1' }]
      if (path === '/nodes/pve1/network') throw new Error('network unreachable')
      if (path in CONFIGS) return CONFIGS[path]
      throw new Error(`unexpected pveFetch path: ${path}`)
    })
    const res = await callRoute(await importGET(), { params: { id: 'c1' } })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    // NIC tag still resolves; host-VLAN guest falls back to undefined.
    expect(netOf(body, '100').effectiveTag).toBe(200)
    expect(netOf(body, '101').effectiveTag).toBeUndefined()
  })

  it('returns 400 when the connection id is missing', async () => {
    const res = await callRoute(await importGET(), { params: { id: '' } })
    expect(res.status).toBe(400)
  })

  it('propagates an RBAC denial', async () => {
    checkPermissionMock.mockResolvedValue(new Response('forbidden', { status: 403 }))
    const res = await callRoute(await importGET(), { params: { id: 'c1' } })
    expect(res.status).toBe(403)
  })
})

describe('parseNetString', () => {
  it('parses model, mac, bridge, tag, firewall and rate from a net string', async () => {
    const { parseNetString } = await import('./route')
    const iface = parseNetString('net0', 'virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0,tag=100,firewall=1,rate=10')
    expect(iface).toMatchObject({
      id: 'net0',
      model: 'virtio',
      macaddr: 'AA:BB:CC:DD:EE:FF',
      bridge: 'vmbr0',
      tag: 100,
      firewall: true,
      rate: 10,
    })
  })

  it('handles an explicit macaddr= and a missing tag', async () => {
    const { parseNetString } = await import('./route')
    const iface = parseNetString('net1', 'e1000=00:11:22:33:44:55,bridge=vmbr1')
    expect(iface.model).toBe('e1000')
    expect(iface.macaddr).toBe('00:11:22:33:44:55')
    expect(iface.bridge).toBe('vmbr1')
    expect(iface.tag).toBeUndefined()
    expect(iface.firewall).toBeUndefined()
  })
})

describe('GET /api/v1/connections/[id]/networks — host bridges', () => {
  const NODE_NETWORK = [
    { iface: 'bond0', type: 'bond' },
    { iface: 'bond0.10', type: 'vlan' },
    { iface: 'vmbr0V10', type: 'bridge', bridge_ports: 'bond0.10', bridge_vlan_aware: 1 },
    { iface: 'vmbr0', type: 'bridge', bridge_ports: 'bond0', bridge_vlan_aware: 1 },
  ]

  it('returns bridges populated from cluster nodes when VM list is empty (provider scope)', async () => {
    pveFetchMock.mockImplementation(async (_conn: any, path: string) => {
      if (path === '/cluster/resources?type=vm') return []
      if (path === '/cluster/resources?type=node') return [{ node: 'pve1' }, { node: 'pve2' }]
      if (path === '/nodes/pve1/network') return NODE_NETWORK
      if (path === '/nodes/pve2/network') return NODE_NETWORK
      if (path === '/cluster/sdn/vnets') return []
      throw new Error(`unexpected pveFetch path: ${path}`)
    })
    getVdcScopeMock.mockResolvedValue(null)

    const res = await callRoute(await importGET(), { params: { id: 'c1' } })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)

    expect(body.data).toEqual([])
    expect(Array.isArray(body.bridges)).toBe(true)
    expect(body.bridges.length).toBeGreaterThan(0)

    const bridge = body.bridges.find((b: any) => b.iface === 'vmbr0V10' && b.node === 'pve1')
    expect(bridge).toBeDefined()
    expect(bridge.type).toBe('bridge')
    expect(bridge.tag).toBe(10)
  })

  it('returns bridges with entries for each node in the cluster', async () => {
    pveFetchMock.mockImplementation(async (_conn: any, path: string) => {
      if (path === '/cluster/resources?type=vm') return []
      if (path === '/cluster/resources?type=node') return [{ node: 'pve1' }, { node: 'pve2' }]
      if (path === '/nodes/pve1/network') return NODE_NETWORK
      if (path === '/nodes/pve2/network') return NODE_NETWORK
      if (path === '/cluster/sdn/vnets') return []
      throw new Error(`unexpected pveFetch path: ${path}`)
    })
    getVdcScopeMock.mockResolvedValue(null)

    const body = await readJson<any>(await callRoute(await importGET(), { params: { id: 'c1' } }))
    const nodes = [...new Set(body.bridges.map((b: any) => b.node))]
    expect(nodes).toContain('pve1')
    expect(nodes).toContain('pve2')
  })

  it('returns bridges: [] for tenant (vDC) scope even when host networks exist', async () => {
    pveFetchMock.mockImplementation(async (_conn: any, path: string) => {
      if (path === '/cluster/resources?type=vm') return []
      if (path === '/cluster/resources?type=node') return [{ node: 'pve1' }]
      if (path === '/nodes/pve1/network') return NODE_NETWORK
      throw new Error(`unexpected pveFetch path: ${path}`)
    })
    // Truthy vdcScope = iaas tenant (vdcScope returned from getVdcScope is truthy)
    getVdcScopeMock.mockResolvedValue({
      connectionIds: new Set(['c1']),
      poolsByConnection: new Map([['c1', new Set(['pool1'])]]),
      vdcIds: new Set(),
      vdcNames: new Set(),
    })

    const body = await readJson<any>(await callRoute(await importGET(), { params: { id: 'c1' } }))
    expect(body.bridges).toEqual([])
    expect(pveFetchMock).not.toHaveBeenCalledWith(expect.anything(), '/cluster/resources?type=node')
  })
})

describe('GET /api/v1/connections/[id]/networks — host VLANs (#542)', () => {
  // VLAN-aware-bridge layout: many VLAN sub-interfaces over few bridges, and
  // none of the VLANs has an attached VM. Previously none would surface.
  const NODE_NETWORK = [
    { iface: 'bond0', type: 'bond' },
    { iface: 'vmbr0', type: 'bridge', bridge_ports: 'bond0', bridge_vlan_aware: 1 },
    { iface: 'vmbr0.10', type: 'vlan' },
    { iface: 'vmbr0.20', type: 'vlan' },
    { iface: 'vmbr0.30', type: 'vlan' },
  ]

  it('returns host VLANs even when no VM is attached (provider scope)', async () => {
    pveFetchMock.mockImplementation(async (_conn: any, path: string) => {
      if (path === '/cluster/resources?type=vm') return []
      if (path === '/cluster/resources?type=node') return [{ node: 'pve1' }]
      if (path === '/nodes/pve1/network') return NODE_NETWORK
      if (path === '/cluster/sdn/vnets') return []
      throw new Error(`unexpected pveFetch path: ${path}`)
    })
    getVdcScopeMock.mockResolvedValue(null)

    const res = await callRoute(await importGET(), { params: { id: 'c1' } })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)

    expect(body.data).toEqual([])
    expect(Array.isArray(body.vlans)).toBe(true)
    expect(body.vlans.map((v: any) => v.tag)).toEqual([10, 20, 30])
    expect(body.vlans.every((v: any) => v.node === 'pve1')).toBe(true)
  })

  it('surfaces VLANs across every node in the cluster', async () => {
    pveFetchMock.mockImplementation(async (_conn: any, path: string) => {
      if (path === '/cluster/resources?type=vm') return []
      if (path === '/cluster/resources?type=node') return [{ node: 'pve1' }, { node: 'pve2' }]
      if (path === '/nodes/pve1/network') return NODE_NETWORK
      if (path === '/nodes/pve2/network') return NODE_NETWORK
      if (path === '/cluster/sdn/vnets') return []
      throw new Error(`unexpected pveFetch path: ${path}`)
    })
    getVdcScopeMock.mockResolvedValue(null)

    const body = await readJson<any>(await callRoute(await importGET(), { params: { id: 'c1' } }))
    const nodes = [...new Set(body.vlans.map((v: any) => v.node))]
    expect(nodes).toContain('pve1')
    expect(nodes).toContain('pve2')
  })

  it('returns empty data/bridges/vlans when the VM resource list is unavailable', async () => {
    pveFetchMock.mockImplementation(async (_conn: any, path: string) => {
      if (path === '/cluster/resources?type=vm') return null
      throw new Error(`unexpected pveFetch path: ${path}`)
    })
    getVdcScopeMock.mockResolvedValue(null)

    const res = await callRoute(await importGET(), { params: { id: 'c1' } })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body).toEqual({ data: [], bridges: [], vlans: [], sdnVnets: [], vnetAliases: {} })
  })

  it('returns vlans: [] for tenant (vDC) scope even when host VLANs exist', async () => {
    pveFetchMock.mockImplementation(async (_conn: any, path: string) => {
      if (path === '/cluster/resources?type=vm') return []
      if (path === '/cluster/resources?type=node') return [{ node: 'pve1' }]
      if (path === '/nodes/pve1/network') return NODE_NETWORK
      throw new Error(`unexpected pveFetch path: ${path}`)
    })
    getVdcScopeMock.mockResolvedValue({
      connectionIds: new Set(['c1']),
      poolsByConnection: new Map([['c1', new Set(['pool1'])]]),
      vdcIds: new Set(),
      vdcNames: new Set(),
    })

    const body = await readJson<any>(await callRoute(await importGET(), { params: { id: 'c1' } }))
    expect(body.vlans).toEqual([])
  })
})

describe('GET /api/v1/connections/[id]/networks — SDN VNets', () => {
  const NODE_NETWORK = [
    { iface: 'vmbr0', type: 'bridge', bridge_ports: 'bond0', bridge_vlan_aware: 1 },
  ]
  const ZONES = [{ zone: 'zovhpvec', type: 'vxlan', peers: '10.0.0.1,10.0.0.2' }]
  const VNETS = [{ vnet: 'v42fc503', alias: 'lan', zone: 'zovhpvec', tag: 10000 }]

  it('returns sdnVnets joined with zones for provider scope', async () => {
    pveFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path === '/cluster/resources?type=vm') return [{ vmid: 100, node: 'pve1', type: 'qemu', name: 'u', status: 'running' }]
      if (path === '/cluster/resources?type=node') return [{ node: 'pve1' }]
      if (path === '/nodes/pve1/network') return NODE_NETWORK
      if (path === '/cluster/sdn/vnets') return VNETS
      if (path === '/cluster/sdn/zones') return ZONES
      if (path === '/nodes/pve1/qemu/100/config') return { net0: 'virtio=AA:BB:CC:00:00:01,bridge=v42fc503' }
      throw new Error(`unexpected pveFetch path: ${path}`)
    })
    getVdcScopeMock.mockResolvedValue(null)

    const body = await readJson<any>(await callRoute(await importGET(), { params: { id: 'c1' } }))
    expect(body.sdnVnets).toHaveLength(1)
    expect(body.sdnVnets[0]).toMatchObject({ vnet: 'v42fc503', alias: 'lan', zoneType: 'vxlan', tag: 10000 })
    expect(body.sdnVnets[0].peers).toEqual(['10.0.0.1', '10.0.0.2'])
  })

  it('still returns vnets with zoneType "" when /cluster/sdn/zones fails', async () => {
    pveFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path === '/cluster/resources?type=vm') return []
      if (path === '/cluster/resources?type=node') return [{ node: 'pve1' }]
      if (path === '/nodes/pve1/network') return NODE_NETWORK
      if (path === '/cluster/sdn/vnets') return VNETS
      if (path === '/cluster/sdn/zones') throw new Error('zones unavailable')
      throw new Error(`unexpected pveFetch path: ${path}`)
    })
    getVdcScopeMock.mockResolvedValue(null)

    const body = await readJson<any>(await callRoute(await importGET(), { params: { id: 'c1' } }))
    expect(body.sdnVnets).toHaveLength(1)
    expect(body.sdnVnets[0].zoneType).toBe('')
  })

  it('returns sdnVnets: [] when /cluster/sdn/vnets fails, without failing the request', async () => {
    pveFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path === '/cluster/resources?type=vm') return []
      if (path === '/cluster/resources?type=node') return [{ node: 'pve1' }]
      if (path === '/nodes/pve1/network') return NODE_NETWORK
      if (path === '/cluster/sdn/vnets') throw new Error('sdn unavailable')
      if (path === '/cluster/sdn/zones') return ZONES
      throw new Error(`unexpected pveFetch path: ${path}`)
    })
    getVdcScopeMock.mockResolvedValue(null)

    const res = await callRoute(await importGET(), { params: { id: 'c1' } })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.sdnVnets).toEqual([])
  })

  it('excludes a VNet id from bridges when it also appears as a node bridge', async () => {
    pveFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path === '/cluster/resources?type=vm') return []
      if (path === '/cluster/resources?type=node') return [{ node: 'pve1' }]
      // v42fc503 materialized as a bridge iface on the node:
      if (path === '/nodes/pve1/network') return [...NODE_NETWORK, { iface: 'v42fc503', type: 'bridge' }]
      if (path === '/cluster/sdn/vnets') return VNETS
      if (path === '/cluster/sdn/zones') return ZONES
      throw new Error(`unexpected pveFetch path: ${path}`)
    })
    getVdcScopeMock.mockResolvedValue(null)

    const body = await readJson<any>(await callRoute(await importGET(), { params: { id: 'c1' } }))
    expect(body.bridges.map((b: any) => b.iface)).not.toContain('v42fc503')
    expect(body.sdnVnets.map((v: any) => v.vnet)).toContain('v42fc503')
  })

  it('returns sdnVnets: [] for tenant (vDC) scope', async () => {
    pveFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path === '/cluster/resources?type=vm') return []
      throw new Error(`unexpected pveFetch path: ${path}`)
    })
    getVdcScopeMock.mockResolvedValue({
      connectionIds: new Set(['c1']),
      poolsByConnection: new Map([['c1', new Set(['pool1'])]]),
      vdcIds: new Set(), vdcNames: new Set(),
    })
    const body = await readJson<any>(await callRoute(await importGET(), { params: { id: 'c1' } }))
    expect(body.sdnVnets).toEqual([])
  })
})

describe('GET /api/v1/connections/[id]/networks — vnetAliases', () => {
  const NODE_NETWORK = [
    { iface: 'vmbr0', type: 'bridge', bridge_ports: 'bond0', bridge_vlan_aware: 1 },
  ]

  it('populates vnetAliases from /cluster/sdn/vnets for provider scope', async () => {
    pveFetchMock.mockImplementation(async (_conn: any, path: string) => {
      if (path === '/cluster/resources?type=vm') return []
      if (path === '/cluster/resources?type=node') return [{ node: 'pve1' }]
      if (path === '/nodes/pve1/network') return NODE_NETWORK
      if (path === '/cluster/sdn/vnets') return [
        { vnet: 'v42fc503', alias: 'Production LAN', zone: 'zone1' },
        { vnet: 'v99aa001', alias: 'v99aa001', zone: 'zone1' },   // alias === vnet → omit
        { vnet: 'v11bb002', alias: '', zone: 'zone1' },            // blank alias → omit
        { vnet: 'v22cc003', zone: 'zone1' },                       // no alias → omit
        { vnet: 'v33dd004', alias: 'Dev Network', zone: 'zone1' },
      ]
      throw new Error(`unexpected pveFetch path: ${path}`)
    })
    getVdcScopeMock.mockResolvedValue(null)

    const res = await callRoute(await importGET(), { params: { id: 'c1' } })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)

    expect(body.vnetAliases).toEqual({
      v42fc503: 'Production LAN',
      v33dd004: 'Dev Network',
    })
  })

  it('returns vnetAliases: {} for tenant (vDC) scope and does not call /cluster/sdn/vnets', async () => {
    pveFetchMock.mockImplementation(async (_conn: any, path: string) => {
      if (path === '/cluster/resources?type=vm') return []
      throw new Error(`unexpected pveFetch path: ${path}`)
    })
    getVdcScopeMock.mockResolvedValue({
      connectionIds: new Set(['c1']),
      poolsByConnection: new Map([['c1', new Set(['pool1'])]]),
      vdcIds: new Set(),
      vdcNames: new Set(),
    })

    const res = await callRoute(await importGET(), { params: { id: 'c1' } })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)

    expect(body.vnetAliases).toEqual({})
    expect(pveFetchMock).not.toHaveBeenCalledWith(expect.anything(), '/cluster/sdn/vnets')
  })
})
