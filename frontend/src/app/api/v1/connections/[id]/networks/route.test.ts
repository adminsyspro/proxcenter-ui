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
    if (path === '/nodes/pve1/network') return HOST_NETWORK
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
