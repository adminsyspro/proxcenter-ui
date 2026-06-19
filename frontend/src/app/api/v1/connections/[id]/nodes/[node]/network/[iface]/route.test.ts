import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn<(...args: any[]) => Promise<Response | null>>(),
  buildNodeResourceId: vi.fn<(connId: string, node: string) => string>(
    (connId, node) => `${connId}:${node}`
  ),
  PERMISSIONS: {
    NODE_NETWORK: 'node.network',
  },
}))

vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: vi.fn<(id: string) => Promise<any>>(),
}))

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: vi.fn<(...args: any[]) => Promise<any>>(),
}))

import { GET, PUT, DELETE } from './route'
import { checkPermission } from '@/lib/rbac'
import { getConnectionById } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'

const checkPermissionMock = checkPermission as any
const getConnectionByIdMock = getConnectionById as any
const pveFetchMock = pveFetch as any

const CONN = { id: 'conn-1' }
const BASE_PARAMS = { id: 'conn-1', node: 'pve-node-01', iface: 'vmbr0' }

const IFACE_DATA = {
  iface: 'vmbr0',
  type: 'bridge',
  address: '192.168.1.10',
  netmask: '255.255.255.0',
  bridge_ports: 'eth0',
}

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  getConnectionByIdMock.mockResolvedValue(CONN)
  pveFetchMock.mockResolvedValue(IFACE_DATA)
})

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

describe('GET /api/v1/connections/[id]/nodes/[node]/network/[iface]', () => {
  it('200 returns interface data', async () => {
    const res = await GET(new Request('http://test.local/_'), {
      params: Promise.resolve(BASE_PARAMS),
    })

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data).toMatchObject({ iface: 'vmbr0', type: 'bridge' })
    expect(pveFetchMock).toHaveBeenCalledWith(CONN, '/nodes/pve-node-01/network/vmbr0')
  })

  it('encodes node and iface in the pveFetch path', async () => {
    pveFetchMock.mockResolvedValue({})

    await GET(new Request('http://test.local/_'), {
      params: Promise.resolve({ id: 'conn-1', node: 'node/x', iface: 'bond:0' }),
    })

    const [, path] = pveFetchMock.mock.calls[0]
    expect(path).toBe('/nodes/node%2Fx/network/bond%3A0')
  })

  it('403 when NODE_NETWORK is denied', async () => {
    const denied = new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })
    checkPermissionMock.mockResolvedValue(denied)

    const res = await GET(new Request('http://test.local/_'), {
      params: Promise.resolve(BASE_PARAMS),
    })

    expect(res.status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('500 on pveFetch throw', async () => {
    pveFetchMock.mockRejectedValue(new Error('network manager down'))

    const res = await GET(new Request('http://test.local/_'), {
      params: Promise.resolve(BASE_PARAMS),
    })

    expect(res.status).toBe(500)
    const body = await readJson<any>(res)
    expect(body.error).toContain('network manager down')
  })
})

// ---------------------------------------------------------------------------
// PUT
// ---------------------------------------------------------------------------

describe('PUT /api/v1/connections/[id]/nodes/[node]/network/[iface]', () => {
  it('200 happy path: bridge type sends bridge_ports and bridge_vlan_aware', async () => {
    pveFetchMock.mockResolvedValue(null)

    const res = await callRoute(PUT as any, {
      method: 'PUT',
      params: BASE_PARAMS,
      body: {
        type: 'bridge',
        address: '192.168.1.10',
        netmask: '255.255.255.0',
        gateway: '192.168.1.1',
        bridge_ports: 'eth0',
        bridge_vlan_aware: true,
        autostart: true,
        mtu: 1500,
      },
    })

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.success).toBe(true)

    const [, path, opts] = pveFetchMock.mock.calls[0]
    expect(path).toBe('/nodes/pve-node-01/network/vmbr0')
    const params: URLSearchParams = opts.body
    expect(params.get('type')).toBe('bridge')
    expect(params.get('address')).toBe('192.168.1.10')
    expect(params.get('netmask')).toBe('255.255.255.0')
    expect(params.get('gateway')).toBe('192.168.1.1')
    expect(params.get('bridge_ports')).toBe('eth0')
    expect(params.get('bridge_vlan_aware')).toBe('1')
    expect(params.get('autostart')).toBe('1')
    expect(params.get('mtu')).toBe('1500')
  })

  it('converts IPv4 CIDR address to cidr param and removes address+netmask', async () => {
    pveFetchMock.mockResolvedValue(null)

    await callRoute(PUT as any, {
      method: 'PUT',
      params: BASE_PARAMS,
      body: {
        type: 'bridge',
        address: '192.168.1.10/24',
      },
    })

    const [, , opts] = pveFetchMock.mock.calls[0]
    const params: URLSearchParams = opts.body
    expect(params.get('cidr')).toBe('192.168.1.10/24')
    expect(params.get('address')).toBeNull()
    expect(params.get('netmask')).toBeNull()
  })

  it('converts IPv6 CIDR address6 to cidr6 param and removes address6+netmask6', async () => {
    pveFetchMock.mockResolvedValue(null)

    await callRoute(PUT as any, {
      method: 'PUT',
      params: BASE_PARAMS,
      body: {
        type: 'bridge',
        address6: '2001:db8::1/64',
      },
    })

    const [, , opts] = pveFetchMock.mock.calls[0]
    const params: URLSearchParams = opts.body
    expect(params.get('cidr6')).toBe('2001:db8::1/64')
    expect(params.get('address6')).toBeNull()
    expect(params.get('netmask6')).toBeNull()
  })

  it('bond type sends bond_mode, bond-primary, bond_xmit_hash_policy and slaves', async () => {
    pveFetchMock.mockResolvedValue(null)

    await callRoute(PUT as any, {
      method: 'PUT',
      params: BASE_PARAMS,
      body: {
        type: 'bond',
        bond_mode: 'active-backup',
        'bond-primary': 'eth0',
        bond_xmit_hash_policy: 'layer2',
        slaves: 'eth0 eth1',
      },
    })

    const [, , opts] = pveFetchMock.mock.calls[0]
    const params: URLSearchParams = opts.body
    expect(params.get('type')).toBe('bond')
    expect(params.get('bond_mode')).toBe('active-backup')
    expect(params.get('bond-primary')).toBe('eth0')
    expect(params.get('bond_xmit_hash_policy')).toBe('layer2')
    expect(params.get('slaves')).toBe('eth0 eth1')
  })

  it('vlan type sends vlan-id and vlan-raw-device', async () => {
    pveFetchMock.mockResolvedValue(null)

    await callRoute(PUT as any, {
      method: 'PUT',
      params: BASE_PARAMS,
      body: {
        type: 'vlan',
        'vlan-id': '100',
        'vlan-raw-device': 'eth0',
      },
    })

    const [, , opts] = pveFetchMock.mock.calls[0]
    const params: URLSearchParams = opts.body
    expect(params.get('vlan-id')).toBe('100')
    expect(params.get('vlan-raw-device')).toBe('eth0')
  })

  it('OVS type sends ovs_* fields', async () => {
    pveFetchMock.mockResolvedValue(null)

    await callRoute(PUT as any, {
      method: 'PUT',
      params: BASE_PARAMS,
      body: {
        type: 'OVSBridge',
        ovs_ports: 'eth0',
        ovs_tag: '100',
      },
    })

    const [, , opts] = pveFetchMock.mock.calls[0]
    const params: URLSearchParams = opts.body
    expect(params.get('type')).toBe('OVSBridge')
    expect(params.get('ovs_ports')).toBe('eth0')
    expect(params.get('ovs_tag')).toBe('100')
  })

  it('autostart false sends autostart=0', async () => {
    pveFetchMock.mockResolvedValue(null)

    await callRoute(PUT as any, {
      method: 'PUT',
      params: BASE_PARAMS,
      body: { type: 'bridge', autostart: false },
    })

    const [, , opts] = pveFetchMock.mock.calls[0]
    const params: URLSearchParams = opts.body
    expect(params.get('autostart')).toBe('0')
  })

  it('skips fields with empty string values', async () => {
    pveFetchMock.mockResolvedValue(null)

    await callRoute(PUT as any, {
      method: 'PUT',
      params: BASE_PARAMS,
      body: { type: 'bridge', gateway: '', mtu: '' },
    })

    const [, , opts] = pveFetchMock.mock.calls[0]
    const params: URLSearchParams = opts.body
    expect(params.get('gateway')).toBeNull()
    expect(params.get('mtu')).toBeNull()
  })

  it('encodes node and iface in the PUT path', async () => {
    pveFetchMock.mockResolvedValue(null)

    await callRoute(PUT as any, {
      method: 'PUT',
      params: { id: 'conn-1', node: 'node/x', iface: 'eth:0' },
      body: { type: 'eth' },
    })

    const [, path] = pveFetchMock.mock.calls[0]
    expect(path).toBe('/nodes/node%2Fx/network/eth%3A0')
  })

  it('403 when NODE_NETWORK is denied', async () => {
    const denied = new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })
    checkPermissionMock.mockResolvedValue(denied)

    const res = await callRoute(PUT as any, {
      method: 'PUT',
      params: BASE_PARAMS,
      body: { type: 'bridge' },
    })

    expect(res.status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('500 on pveFetch throw', async () => {
    pveFetchMock.mockRejectedValue(new Error('interface in use'))

    const res = await callRoute(PUT as any, {
      method: 'PUT',
      params: BASE_PARAMS,
      body: { type: 'bridge' },
    })

    expect(res.status).toBe(500)
    const body = await readJson<any>(res)
    expect(body.error).toContain('interface in use')
  })
})

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

describe('DELETE /api/v1/connections/[id]/nodes/[node]/network/[iface]', () => {
  it('200 happy path: calls pveFetch DELETE and returns success', async () => {
    pveFetchMock.mockResolvedValue(null)

    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: BASE_PARAMS,
    })

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.success).toBe(true)

    expect(pveFetchMock).toHaveBeenCalledWith(
      CONN,
      '/nodes/pve-node-01/network/vmbr0',
      { method: 'DELETE' },
    )
  })

  it('encodes node and iface in the DELETE path', async () => {
    pveFetchMock.mockResolvedValue(null)

    await callRoute(DELETE as any, {
      method: 'DELETE',
      params: { id: 'conn-1', node: 'node/x', iface: 'eth:0' },
    })

    expect(pveFetchMock).toHaveBeenCalledWith(
      CONN,
      '/nodes/node%2Fx/network/eth%3A0',
      { method: 'DELETE' },
    )
  })

  it('403 when NODE_NETWORK is denied', async () => {
    const denied = new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })
    checkPermissionMock.mockResolvedValue(denied)

    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: BASE_PARAMS,
    })

    expect(res.status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('500 on pveFetch throw', async () => {
    pveFetchMock.mockRejectedValue(new Error('interface not found'))

    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: BASE_PARAMS,
    })

    expect(res.status).toBe(500)
    const body = await readJson<any>(res)
    expect(body.error).toContain('interface not found')
  })
})
