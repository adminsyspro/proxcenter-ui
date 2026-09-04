import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  checkPermission: vi.fn(async () => null as any),
  getConnectionById: vi.fn(async (id: string) => ({
    id,
    name: 'PVE-DR',
    baseUrl: 'https://10.42.0.111:8006',
    apiToken: 'token',
    insecureDev: true,
    behindProxy: false,
  })),
  getCurrentTenantId: vi.fn(async () => 'default'),
  getTenantInfrastructureScope: vi.fn(async () => null as any),
  maskingScope: vi.fn((scope: any) => scope),
  pveFetch: vi.fn(async (_conn: any, _path: string) => undefined as any),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: h.checkPermission,
  PERMISSIONS: { VM_VIEW: 'vm.view' },
}))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: h.getConnectionById }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: h.getCurrentTenantId }))
vi.mock('@/lib/tenant/infraScope', () => ({
  getTenantInfrastructureScope: h.getTenantInfrastructureScope,
  maskingScope: h.maskingScope,
}))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: h.pveFetch }))

import { POST } from './route'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

const CONN = 'cmtk6hu1r00007zjlo0kto72x'
const NODE = 'pve2-dr'
const KEY = `${CONN}:qemu:${NODE}:100`

const VNETS = [
  { vnet: 'tv1', alias: 'prod-lan', zone: 'tzvl1', tag: 137 },
  { vnet: 'tvx1', alias: 'overlay', zone: 'tzvx1', tag: 4242 },
]
const ZONES = [
  { zone: 'tzvl1', type: 'vlan', bridge: 'vmbr0' },
  { zone: 'tzvx1', type: 'vxlan', peers: '10.42.0.111' },
]
const NODE_NETWORK = [
  { iface: 'vmbr0', type: 'bridge', bridge_ports: 'nic0', active: 1 },
  { iface: 'vmbr1', type: 'bridge', bridge_ports: 'bond0.30', active: 1 },
  { iface: 'bond0.30', type: 'vlan', active: 1 },
]

/** Guest config as PVE returns it: the VNet NIC carries no `tag=`. */
const GUEST_CONFIG: Record<string, unknown> = {
  name: 'Debian13',
  net0: 'virtio=BC:24:11:C0:F0:6F,bridge=tv1',
  net1: 'virtio=BC:24:11:00:00:04,bridge=tvx1',
  net2: 'virtio=BC:24:11:00:00:05,bridge=vmbr0,tag=99',
  net3: 'virtio=BC:24:11:00:00:06,bridge=vmbr1',
  net4: 'virtio=BC:24:11:00:00:07,bridge=vmbr0',
}

type Overrides = {
  vnets?: () => unknown
  zones?: () => unknown
  network?: () => unknown
  config?: () => unknown
}

/** Route pveFetch by path, so a test can make one endpoint fail in isolation. */
function stubPve(over: Overrides = {}) {
  h.pveFetch.mockImplementation(async (_conn: any, path: string) => {
    if (path === '/cluster/sdn/vnets') return (over.vnets ?? (() => VNETS))()
    if (path === '/cluster/sdn/zones') return (over.zones ?? (() => ZONES))()
    if (path.endsWith('/network')) return (over.network ?? (() => NODE_NETWORK))()
    if (path.endsWith('/config')) return (over.config ?? (() => GUEST_CONFIG))()

    throw new Error(`unexpected path ${path}`)
  })
}

const oneVm = { vms: [{ connId: CONN, type: 'qemu', node: NODE, vmid: '100' }] }

type NetworksResponse = { data: Record<string, { networks: any[] }> }

async function post(body: unknown): Promise<NetworksResponse> {
  return (await readJson<NetworksResponse>(await callRoute(POST, { body: body as any })))!
}

/** Segment keys of the response, in NIC order. */
function keysOf(json: NetworksResponse): string[] {
  return (json.data[KEY]?.networks ?? []).map((n: any) => n.segment.key)
}

beforeEach(() => {
  h.checkPermission.mockReset().mockResolvedValue(null)
  h.getCurrentTenantId.mockReset().mockResolvedValue('default')
  h.getTenantInfrastructureScope.mockReset().mockResolvedValue(null)
  h.maskingScope.mockReset().mockImplementation((scope: any) => scope)
  h.getConnectionById.mockClear()
  h.pveFetch.mockReset()
  stubPve()
})

describe('POST /api/v1/vms/networks', () => {
  it('returns the RBAC denial untouched', async () => {
    const denied = new Response('no', { status: 403 })

    h.checkPermission.mockResolvedValue(denied as any)

    const res = await callRoute(POST, { body: oneVm as any })

    expect(res.status).toBe(403)
    expect(h.pveFetch).not.toHaveBeenCalled()
  })

  it('short-circuits on an empty or malformed vms list', async () => {
    expect(await post({ vms: [] })).toEqual({ data: {} })
    expect(await post({})).toEqual({ data: {} })
    expect(await post({ vms: 'nope' })).toEqual({ data: {} })
    expect(h.pveFetch).not.toHaveBeenCalled()
  })

  it('resolves each NIC to its segment, VNets first', async () => {
    const json = await post(oneVm)
    const nets = json.data[KEY].networks

    expect(nets.map((n: any) => n.iface)).toEqual(['net0', 'net1', 'net2', 'net3', 'net4'])
    expect(nets.map((n: any) => [n.segment.key, n.segment.label, n.segment.vlan])).toEqual([
      ['vnet-tv1', 'VLAN 137', 137],
      ['vnet-tvx1', 'VNI 4242', null],
      ['vlan-99', 'VLAN 99', 99],
      ['vlan-30', 'VLAN 30', 30],
      ['no-vlan', 'No VLAN', null],
    ])
    expect(nets[0].vlanTag).toBeNull()
    expect(nets[0].segment.bridgeLabel).toBe('prod-lan')
  })

  it('fetches the SDN and host network context once, not once per guest', async () => {
    await post({
      vms: [
        { connId: CONN, type: 'qemu', node: NODE, vmid: '100' },
        { connId: CONN, type: 'qemu', node: NODE, vmid: '101' },
        { connId: CONN, type: 'lxc', node: NODE, vmid: '102' },
      ],
    })

    const paths = h.pveFetch.mock.calls.map((c: any[]) => c[1])

    expect(paths.filter((p: string) => p === '/cluster/sdn/vnets')).toHaveLength(1)
    expect(paths.filter((p: string) => p === '/cluster/sdn/zones')).toHaveLength(1)
    expect(paths.filter((p: string) => p.endsWith('/network'))).toHaveLength(1)
    expect(paths.filter((p: string) => p.endsWith('/config'))).toHaveLength(3)
    expect(h.getConnectionById).toHaveBeenCalledTimes(1)
  })

  it('skips SDN entirely for a tenant scope, leaving VNet guests untagged', async () => {
    h.maskingScope.mockReturnValue({ poolsByConnection: new Map() } as any)

    const json = await post(oneVm)

    expect(h.pveFetch.mock.calls.map((c: any[]) => c[1])).not.toContain('/cluster/sdn/vnets')
    expect(keysOf(json)).toEqual(['no-vlan', 'no-vlan', 'vlan-99', 'vlan-30', 'no-vlan'])
    expect(json.data[KEY].networks[0].segment.bridgeLabel).toBe('tv1')
  })

  it('degrades to per-NIC tags when the SDN vnets endpoint fails', async () => {
    stubPve({ vnets: () => { throw new Error('501 no such method') } })

    const json = await post(oneVm)

    expect(h.pveFetch.mock.calls.map((c: any[]) => c[1])).not.toContain('/cluster/sdn/zones')
    expect(keysOf(json)).toEqual(['no-vlan', 'no-vlan', 'vlan-99', 'vlan-30', 'no-vlan'])
  })

  it('still groups VNets when only the zones endpoint fails', async () => {
    stubPve({ zones: () => { throw new Error('403') } })

    const json = await post(oneVm)
    const nets = json.data[KEY].networks

    expect(nets[0].segment.key).toBe('vnet-tv1')
    // Without the zone there is no way to say VLAN or VNI, so the alias stands in.
    expect(nets[0].segment.label).toBe('prod-lan')
    expect(nets[0].segment.zoneType).toBe('')
    expect(nets[0].segment.vlan).toBeNull()
  })

  it('falls back to per-NIC tags when a node network is unreadable', async () => {
    stubPve({ network: () => { throw new Error('connection refused') } })

    // vmbr1 loses its bondX.N VLAN, the rest is unaffected.
    expect(keysOf(await post(oneVm))).toEqual(['vnet-tv1', 'vnet-tvx1', 'vlan-99', 'no-vlan', 'no-vlan'])
  })

  it('tolerates non-array SDN and network payloads', async () => {
    stubPve({ vnets: () => null, zones: () => 'nope', network: () => ({}) })

    expect(keysOf(await post(oneVm))).toEqual(['no-vlan', 'no-vlan', 'vlan-99', 'no-vlan', 'no-vlan'])
  })

  it('omits a guest whose config fetch fails, keeping the others', async () => {
    h.pveFetch.mockImplementation(async (_conn: any, path: string) => {
      if (path === '/cluster/sdn/vnets') return VNETS
      if (path === '/cluster/sdn/zones') return ZONES
      if (path.endsWith('/network')) return NODE_NETWORK
      if (path.endsWith('/100/config')) throw new Error('does not exist')

      return GUEST_CONFIG
    })

    const json = await post({
      vms: [
        { connId: CONN, type: 'qemu', node: NODE, vmid: '100' },
        { connId: CONN, type: 'qemu', node: NODE, vmid: '101' },
      ],
    })

    expect(Object.keys(json.data)).toEqual([`${CONN}:qemu:${NODE}:101`])
  })

  it('drops entries missing a field rather than calling PVE for them', async () => {
    const json = await post({
      vms: [
        { type: 'qemu', node: NODE, vmid: '100' },
        { connId: CONN, node: NODE, vmid: '100' },
        { connId: CONN, type: 'qemu', vmid: '100' },
        { connId: CONN, type: 'qemu', node: NODE },
      ],
    })

    expect(json.data).toEqual({})
    expect(h.pveFetch).not.toHaveBeenCalled()
  })

  it('keeps other connections when one cannot be resolved', async () => {
    h.getConnectionById.mockImplementation(async (id: string) => {
      if (id === 'broken') throw new Error('connection not found')

      return { id, name: 'PVE-DR', baseUrl: 'https://10.42.0.111:8006', apiToken: 't', insecureDev: true, behindProxy: false }
    })

    const json = await post({
      vms: [
        { connId: 'broken', type: 'qemu', node: 'pve1', vmid: '1' },
        { connId: CONN, type: 'qemu', node: NODE, vmid: '100' },
      ],
    })

    expect(Object.keys(json.data)).toEqual([KEY])
  })

  it('answers 500 on a malformed request body', async () => {
    const res = await callRoute(POST, {
      method: 'POST',
      body: 'not json' as any,
      headers: { 'Content-Type': 'application/json' },
    })

    expect(res.status).toBe(500)
  })
})
