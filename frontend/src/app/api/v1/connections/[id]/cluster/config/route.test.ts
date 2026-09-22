import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const getConnectionByIdMock = vi.fn<(id: string) => Promise<any>>()
const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { CONNECTION_VIEW: 'connection.view', CONNECTION_MANAGE: 'connection.manage' },
}))

vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: getConnectionByIdMock,
}))

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: pveFetchMock,
}))

// A cluster whose management network (172.16.253.0/24, the one with the
// default gateway) is not the corosync network (10.10.10.0/24 on link 0,
// 10.10.11.0/24 on link 1): the shape roadmap#29 was reported on.
const clusterStatus = [
  { id: 'cluster', type: 'cluster', name: 'LAB', nodes: 2, quorate: 1, version: 7 },
  { id: 'node/pve1', type: 'node', name: 'pve1', nodeid: 1, ip: '10.10.10.1', online: 1, local: 1 },
  { id: 'node/pve2', type: 'node', name: 'pve2', nodeid: 2, ip: '10.10.10.2', online: 1, local: 0 },
]

const configNodes = [
  { name: 'pve2', node: 'pve2', nodeid: '2', quorum_votes: '1', ring0_addr: '10.10.10.2', ring1_addr: '10.10.11.2' },
  { name: 'pve1', node: 'pve1', nodeid: '1', quorum_votes: '2', ring0_addr: '10.10.10.1', ring1_addr: '10.10.11.1' },
]

const joinData = {
  config_digest: 'abc',
  preferred_node: 'pve1',
  nodelist: [
    { name: 'pve2', nodeid: '2', quorum_votes: '1', pve_addr: '172.16.253.2', pve_fp: 'FP:PVE2', ring0_addr: '10.10.10.2', ring1_addr: '10.10.11.2' },
    { name: 'pve1', nodeid: '1', quorum_votes: '2', pve_addr: '172.16.253.1', pve_fp: 'FP:PVE1', ring0_addr: '10.10.10.1', ring1_addr: '10.10.11.1' },
  ],
  totem: { cluster_name: 'LAB', config_version: '7', interface: { '0': { linknumber: '0' }, '1': { linknumber: '1' } } },
}

function networksOf(node: string) {
  const last = node === 'pve1' ? 1 : 2
  return [
    { iface: 'lo', type: 'loopback', address: '127.0.0.1', active: 1 },
    { iface: 'vmbr0', type: 'bridge', address: `172.16.253.${last}`, gateway: '172.16.253.254', active: 1 },
    { iface: 'eno1', type: 'eth', address: `10.10.10.${last}`, active: 1 },
    { iface: 'eno2', type: 'eth', address: `10.10.11.${last}`, active: 1 },
  ]
}

function answerByPath(overrides: Record<string, () => any> = {}) {
  pveFetchMock.mockImplementation(async (_conn: any, path: string) => {
    if (overrides[path]) return overrides[path]()
    if (path === '/cluster/status') return clusterStatus
    if (path === '/cluster/config/nodes') return configNodes
    if (path === '/cluster/resources?type=node') return [{ node: 'pve2', hastate: 'maintenance' }]
    if (path === '/cluster/config/join') return joinData
    if (path === '/nodes') return [{ node: 'pve1' }, { node: 'pve2' }]
    const m = path.match(/^\/nodes\/([^/]+)\/network$/)
    if (m) return networksOf(decodeURIComponent(m[1]))
    throw new Error(`unexpected path ${path}`)
  })
}

function decodeJoin(encoded: string) {
  return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
}

async function importGET() {
  const mod = await import('./route')
  return mod.GET as Parameters<typeof callRoute>[0]
}

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getConnectionByIdMock.mockReset().mockResolvedValue({ baseUrl: 'https://172.16.253.1:8006', apiToken: 'tok=secret' })
  pveFetchMock.mockReset()
})

describe('GET /api/v1/connections/[id]/cluster/config', () => {
  it('keeps the management IP and the corosync links apart on every node', async () => {
    answerByPath()
    const GET = await importGET()
    const res = await callRoute(GET, { params: { id: 'c1' } })

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    const byName = Object.fromEntries(body.data.nodes.map((n: any) => [n.name, n]))

    expect(byName.pve1).toMatchObject({
      managementIp: '172.16.253.1',
      corosyncIp: '10.10.10.1',
      corosyncLinks: ['10.10.10.1', '10.10.11.1'],
      votes: 2,
      ip: '172.16.253.1',
      local: true,
      maintenance: false,
    })
    expect(byName.pve2).toMatchObject({
      managementIp: '172.16.253.2',
      corosyncLinks: ['10.10.10.2', '10.10.11.2'],
      votes: 1,
      maintenance: true,
    })
    // The corosync column never carries the management address.
    for (const n of body.data.nodes) {
      expect(n.corosyncLinks).not.toContain(n.managementIp)
    }
  })

  it('builds the join information from the preferred node alone: API address, fingerprint and links', async () => {
    answerByPath()
    const GET = await importGET()
    const body = await readJson<any>(await callRoute(GET, { params: { id: 'c1' } }))

    const join = body.data.joinInfo
    expect(join.ipAddress).toBe('172.16.253.1')
    expect(join.fingerprint).toBe('FP:PVE1')
    expect(join.corosyncLinks).toEqual(['10.10.10.1', '10.10.11.1'])

    const decoded = decodeJoin(join.encoded)
    expect(decoded).toMatchObject({
      ipAddress: '172.16.253.1',
      fingerprint: 'FP:PVE1',
      peerLinks: { '0': '10.10.10.1', '1': '10.10.11.1' },
      ring_addr: ['10.10.10.1', '10.10.11.1'],
    })
    expect(decoded.totem.cluster_name).toBe('LAB')
  })

  it('reports an unreadable management IP as absent instead of showing the corosync address in its place', async () => {
    answerByPath({
      '/nodes/pve1/network': () => { throw new Error('timeout') },
    })
    const GET = await importGET()
    const body = await readJson<any>(await callRoute(GET, { params: { id: 'c1' } }))
    const pve1 = body.data.nodes.find((n: any) => n.name === 'pve1')

    expect(pve1.managementIp).toBeNull()
    expect(pve1.corosyncLinks).toEqual(['10.10.10.1', '10.10.11.1'])
    // The legacy field keeps reaching the node the way it always did.
    expect(pve1.ip).toBe('10.10.10.1')
  })

  it('falls back to the corosync IP of /cluster/status when corosync.conf cannot be read', async () => {
    answerByPath({
      '/cluster/config/nodes': () => { throw new Error('403') },
      '/cluster/config/join': () => ({ preferred_node: 'pve1', nodelist: [{ name: 'pve1', pve_addr: '172.16.253.1', pve_fp: 'FP:PVE1' }], totem: {} }),
    })
    const GET = await importGET()
    const body = await readJson<any>(await callRoute(GET, { params: { id: 'c1' } }))
    const pve1 = body.data.nodes.find((n: any) => n.name === 'pve1')

    expect(pve1.corosyncLinks).toEqual(['10.10.10.1'])
    expect(pve1.votes).toBeNull()
    // No link in the nodelist: ring_addr falls back to the corosync IP, never to the API address.
    const decoded = decodeJoin(body.data.joinInfo.encoded)
    expect(decoded.ipAddress).toBe('172.16.253.1')
    expect(decoded.ring_addr).toEqual(['10.10.10.1'])
    expect(decoded.peerLinks).toEqual({})
  })

  it('shows no corosync link and no vote on a standalone node', async () => {
    answerByPath({
      '/cluster/status': () => [{ id: 'node/solo', type: 'node', name: 'solo', nodeid: 1, ip: '192.168.1.10', online: 1, local: 1 }],
      '/nodes/solo/network': () => [{ iface: 'vmbr0', type: 'bridge', address: '192.168.1.10', gateway: '192.168.1.1', active: 1 }],
      '/nodes': () => [{ node: 'solo' }],
    })
    const GET = await importGET()
    const body = await readJson<any>(await callRoute(GET, { params: { id: 'c1' } }))

    expect(body.data.isCluster).toBe(false)
    expect(body.data.joinInfo).toBeNull()
    expect(body.data.nodes).toHaveLength(1)
    expect(body.data.nodes[0]).toMatchObject({
      managementIp: '192.168.1.10',
      corosyncLinks: [],
      votes: null,
    })
    expect(pveFetchMock).not.toHaveBeenCalledWith(expect.anything(), '/cluster/config/nodes')
  })

  it('returns the RBAC denial untouched', async () => {
    const denied = new Response(JSON.stringify({ error: 'Permission denied' }), { status: 403 })
    checkPermissionMock.mockResolvedValue(denied)
    const GET = await importGET()
    const res = await callRoute(GET, { params: { id: 'c1' } })

    expect(res.status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })
})
