/**
 * GET /api/v1/admin/connections/[id]/node-addresses (#899): per node, the
 * addresses its interfaces carry and the interfaces that can host a VLAN,
 * plus the devices every online node has. Feeds the transport section.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

import { callRoute } from '@/__tests__/setup/route-test'

const { requireProviderTenantMock, checkPermissionMock, prismaMock, getConnectionByIdMock, pveFetchMock } = vi.hoisted(() => ({
  requireProviderTenantMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  prismaMock: { connection: { findUnique: vi.fn() } } as any,
  getConnectionByIdMock: vi.fn(),
  pveFetchMock: vi.fn(),
}))

vi.mock('@/lib/tenant', () => ({ requireProviderTenant: (...a: unknown[]) => requireProviderTenantMock(...a) }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: unknown[]) => checkPermissionMock(...a),
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' },
}))
vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: (...a: unknown[]) => getConnectionByIdMock(...a) }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: unknown[]) => pveFetchMock(...a) }))

import { GET } from './route'

const conn = { id: 'c1' }

/** A cluster of two online nodes and one offline, with the usual interface mix. */
function wireCluster(overrides: Record<string, unknown> = {}) {
  pveFetchMock.mockImplementation(async (_c: any, path: string) => {
    if (path in overrides) {
      const v = overrides[path]
      if (v instanceof Error) throw v
      return v
    }
    if (path === '/nodes') return [{ node: 'pve2', status: 'online' }, { node: 'pve1', status: 'online' }, { node: 'pve3', status: 'offline' }]
    if (path === '/cluster/status') return [{ type: 'cluster', name: 'lab' }, { type: 'node', name: 'pve1', ip: '203.0.113.11' }, { type: 'node', name: 'pve2', ip: '203.0.113.12' }, { type: 'node', name: 'pve3', ip: '203.0.113.13' }]
    if (path === '/nodes/pve1/network') return [
      { iface: 'vmbr0', type: 'bridge', cidr: '203.0.113.11/24', mtu: 1500 },
      { iface: 'bond0', type: 'bond', mtu: 9000 },
      { iface: 'lo', type: 'loopback', address: '127.0.0.1' },
      { iface: 'vmbr0.4000', type: 'vlan', cidr: '198.51.100.1/24' },
      { iface: 'eth0', type: 'eth', address6: 'fd00::1/64' },
    ]
    if (path === '/nodes/pve2/network') return [
      { iface: 'vmbr0', type: 'bridge', cidr: '203.0.113.12/24' },
      { iface: 'eth1', type: 'eth' },
    ]
    throw new Error(`unexpected ${path}`)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  requireProviderTenantMock.mockResolvedValue(null)
  checkPermissionMock.mockResolvedValue(null)
  prismaMock.connection.findUnique.mockResolvedValue({ tenantId: 'default' })
  getConnectionByIdMock.mockResolvedValue(conn)
  wireCluster()
})

describe('GET .../node-addresses', () => {
  it('400s without an id, 403s for a non-provider or unpermitted caller, 404s for an unknown connection', async () => {
    expect((await callRoute(GET as any, { params: {} })).status).toBe(400)
    requireProviderTenantMock.mockResolvedValueOnce(NextResponse.json({ error: 'forbidden' }, { status: 403 }))
    expect((await callRoute(GET as any, { params: { id: 'c1' } })).status).toBe(403)
    checkPermissionMock.mockResolvedValueOnce(NextResponse.json({ error: 'denied' }, { status: 403 }))
    expect((await callRoute(GET as any, { params: { id: 'c1' } })).status).toBe(403)
    prismaMock.connection.findUnique.mockResolvedValueOnce(null)
    expect((await callRoute(GET as any, { params: { id: 'c9' } })).status).toBe(404)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('lists nodes sorted, with their corosync address, the addresses of every interface and only the VLAN-capable interfaces', async () => {
    const res = await callRoute(GET as any, { params: { id: 'c1' } })
    expect(res.status).toBe(200)
    expect(getConnectionByIdMock).toHaveBeenCalledWith('c1', 'default')
    const { data } = await res.json()

    expect(data.nodes.map((n: any) => n.name)).toEqual(['pve1', 'pve2', 'pve3'])
    const pve1 = data.nodes[0]
    expect(pve1).toMatchObject({ online: true, clusterIp: '203.0.113.11' })
    // Prefix stripped, loopback and VLAN sub-interfaces still contribute their address.
    expect(pve1.addresses).toEqual(['203.0.113.11', '127.0.0.1', '198.51.100.1', 'fd00::1'])
    // Only eth/bond/bridge kinds can host a VLAN, sorted by name, MTU as a number.
    expect(pve1.ifaces).toEqual([
      { iface: 'bond0', type: 'bond', mtu: 9000, cidr: null },
      { iface: 'eth0', type: 'eth', mtu: null, cidr: null },
      { iface: 'vmbr0', type: 'bridge', mtu: 1500, cidr: '203.0.113.11/24' },
    ])
    // The offline node is listed with nothing to offer and no network call.
    expect(data.nodes[2]).toEqual({ name: 'pve3', online: false, clusterIp: '203.0.113.13', addresses: [], ifaces: [] })
    expect(pveFetchMock).not.toHaveBeenCalledWith(conn, '/nodes/pve3/network')
    // Devices: the interfaces every online node carries.
    expect(data.devices).toEqual(['vmbr0'])
  })

  it('keeps going when the cluster status or one node network is unreachable', async () => {
    wireCluster({ '/cluster/status': new Error('standalone'), '/nodes/pve2/network': new Error('timeout') })
    const res = await callRoute(GET as any, { params: { id: 'c1' } })
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.nodes[0].clusterIp).toBeNull()
    expect(data.nodes[1]).toMatchObject({ name: 'pve2', online: true, addresses: [], ifaces: [] })
    // pve2 offers nothing, so the common devices come from pve1 alone.
    expect(data.devices).toEqual(['bond0', 'eth0', 'vmbr0'])
  })

  it('answers 502 when the node list itself cannot be read', async () => {
    wireCluster({ '/nodes': new Error('ECONNREFUSED') })
    const res = await callRoute(GET as any, { params: { id: 'c1' } })
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('ECONNREFUSED')
  })
})
