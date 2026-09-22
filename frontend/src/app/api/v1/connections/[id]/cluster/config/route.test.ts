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

  it('rejects a call without a connection id', async () => {
    const GET = await importGET()
    const res = await callRoute(GET, { params: {} })

    expect(res.status).toBe(400)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('takes the fingerprint from the join data first, then from the preferred node, then from corosync.conf', async () => {
    const GET = await importGET()

    answerByPath({ '/cluster/config/join': () => ({ ...joinData, fingerprint: 'FP:TOP' }) })
    expect((await readJson<any>(await callRoute(GET, { params: { id: 'c1' } }))).data.joinInfo.fingerprint).toBe('FP:TOP')

    // No fingerprint on the nodelist entry: corosync.conf carries one for that node.
    answerByPath({
      '/cluster/config/join': () => ({ preferred_node: 'pve1', nodelist: [{ name: 'pve1', pve_addr: '172.16.253.1', ring0_addr: '10.10.10.1' }], totem: {} }),
      '/cluster/config/nodes': () => [{ name: 'pve1', quorum_votes: '1', ring0_addr: '10.10.10.1', pve_fp: 'FP:CFG1' }],
    })
    expect((await readJson<any>(await callRoute(GET, { params: { id: 'c1' } }))).data.joinInfo.fingerprint).toBe('FP:CFG1')

    // Nothing anywhere: an empty fingerprint, not a made-up one.
    answerByPath({
      '/cluster/config/join': () => ({ preferred_node: 'pve1', nodelist: [{ name: 'pve1', pve_addr: '172.16.253.1' }], totem: {} }),
      '/cluster/config/nodes': () => [{ name: 'pve1', quorum_votes: '1' }],
    })
    expect((await readJson<any>(await callRoute(GET, { params: { id: 'c1' } }))).data.joinInfo.fingerprint).toBe('')
  })

  it('falls back to the local node, then to the first nodelist entry, when the preferred node is not listed', async () => {
    const GET = await importGET()

    answerByPath({ '/cluster/config/join': () => ({ ...joinData, preferred_node: 'pve9' }) })
    let join = (await readJson<any>(await callRoute(GET, { params: { id: 'c1' } }))).data.joinInfo
    expect(join.ipAddress).toBe('172.16.253.1')
    expect(join.fingerprint).toBe('FP:PVE1')

    answerByPath({ '/cluster/config/join': () => ({ ...joinData, preferred_node: 'pve9', nodelist: [joinData.nodelist[0]] }) })
    join = (await readJson<any>(await callRoute(GET, { params: { id: 'c1' } }))).data.joinInfo
    expect(join.ipAddress).toBe('172.16.253.2')
    expect(join.fingerprint).toBe('FP:PVE2')
    expect(join.corosyncLinks).toEqual(['10.10.10.2', '10.10.11.2'])

    // A nodelist that is not a list, and no totem: the local node's management IP is the
    // only address left for the join, its corosync IP the only ring address.
    answerByPath({ '/cluster/config/join': () => ({ preferred_node: 'pve9', nodelist: 'garbage' }) })
    join = (await readJson<any>(await callRoute(GET, { params: { id: 'c1' } }))).data.joinInfo
    expect(join.ipAddress).toBe('172.16.253.1')
    expect(join.fingerprint).toBe('')
    expect(join.corosyncLinks).toEqual([])
    expect(decodeJoin(join.encoded)).toMatchObject({ peerLinks: {}, ring_addr: ['10.10.10.1'], totem: {} })
  })

  it('addresses the join to the management IP, then the corosync IP, when the nodelist entry has no pve_addr', async () => {
    const GET = await importGET()
    const bareNodelist = () => ({ preferred_node: 'pve1', nodelist: [{ name: 'pve1', pve_fp: 'FP:PVE1' }], totem: {} })

    answerByPath({ '/cluster/config/join': bareNodelist })
    expect((await readJson<any>(await callRoute(GET, { params: { id: 'c1' } }))).data.joinInfo.ipAddress).toBe('172.16.253.1')

    answerByPath({ '/cluster/config/join': bareNodelist, '/nodes/pve1/network': () => { throw new Error('timeout') } })
    expect((await readJson<any>(await callRoute(GET, { params: { id: 'c1' } }))).data.joinInfo.ipAddress).toBe('10.10.10.1')

    // No management IP and no corosync IP either: the join carries no address at all.
    answerByPath({
      '/cluster/config/join': bareNodelist,
      '/nodes/pve1/network': () => [],
      '/cluster/status': () => [clusterStatus[0], { id: 'node/pve1', type: 'node', name: 'pve1', nodeid: 1, online: 1, local: 1 }],
    })
    const body = await readJson<any>(await callRoute(GET, { params: { id: 'c1' } }))
    expect(body.data.nodes[0]).toMatchObject({ managementIp: null, corosyncIp: null, ip: null })
    expect(body.data.joinInfo.ipAddress).toBe('')
    expect(decodeJoin(body.data.joinInfo.encoded).ring_addr).toEqual([])
  })

  it('skips malformed rows in the cluster status, the resources and corosync.conf', async () => {
    answerByPath({
      '/cluster/status': () => [
        null,
        { id: 'cluster', type: 'cluster', quorate: 0 },
        { id: 'node/pve1', type: 'node', name: 'pve1', nodeid: 1, online: 1, local: 1 },
        { id: 'node/pve2', type: 'node', name: 'pve2', nodeid: 2, ip: '10.10.10.2', online: 0, local: 0 },
      ],
      '/cluster/config/nodes': () => [null, {}, { node: 'pve1', quorum_votes: 'abc', ring0_addr: '10.10.10.1' }, { name: 'pve2', quorum_votes: '1' }],
      '/cluster/resources?type=node': () => [null, { node: 'pve1' }, { node: 'pve2', hastate: 'online' }, { hastate: 'maintenance' }],
    })
    const GET = await importGET()
    const body = await readJson<any>(await callRoute(GET, { params: { id: 'c1' } }))

    expect(body.data.isCluster).toBe(true)
    expect(body.data.clusterName).toBe('')
    expect(body.data.clusterStatus).toMatchObject({ quorate: false })
    const byName = Object.fromEntries(body.data.nodes.map((n: any) => [n.name, n]))
    // Named by its `node` key, votes unreadable, links from corosync.conf.
    expect(byName.pve1).toMatchObject({ votes: null, corosyncIp: null, corosyncLinks: ['10.10.10.1'], maintenance: false })
    // No link in corosync.conf: the /cluster/status address stands in.
    expect(byName.pve2).toMatchObject({ votes: 1, corosyncLinks: ['10.10.10.2'], online: false, maintenance: false })
  })

  it('treats an empty corosync.conf answer like an unreadable one', async () => {
    answerByPath({ '/cluster/config/nodes': () => null })
    const GET = await importGET()
    const body = await readJson<any>(await callRoute(GET, { params: { id: 'c1' } }))

    for (const n of body.data.nodes) {
      expect(n.votes).toBeNull()
      expect(n.corosyncLinks).toEqual([n.corosyncIp])
    }
  })

  it('reports no cluster when /cluster/status itself fails', async () => {
    answerByPath({
      '/cluster/status': () => { throw new Error('501') },
      '/nodes': () => [{ node: 'solo' }],
      '/nodes/solo/network': () => [{ iface: 'vmbr0', type: 'bridge', address: '192.168.1.10', gateway: '192.168.1.1', active: 1 }],
    })
    const GET = await importGET()
    const body = await readJson<any>(await callRoute(GET, { params: { id: 'c1' } }))

    expect(body.data).toMatchObject({ isCluster: false, clusterName: '', clusterStatus: null, nodes: [], joinInfo: null })
    expect(body.data.networks).toEqual([{ iface: 'vmbr0', address: '192.168.1.10', cidr: '192.168.1.10/24', type: 'bridge', active: 1, comments: '' }])
    expect(pveFetchMock).not.toHaveBeenCalledWith(expect.anything(), '/cluster/config/nodes')
  })

  it('lists only the active, addressed bridge, ethernet, bond and VLAN interfaces for cluster creation', async () => {
    const GET = await importGET()

    answerByPath({
      '/nodes': () => [{ node: 'pve1' }],
      '/nodes/pve1/network': () => [
        { iface: 'vmbr0', type: 'bridge', address: '172.16.253.1', cidr: '172.16.253.1/24', gateway: '172.16.253.254', active: 1, comments: 'mgmt' },
        { iface: 'eno1', type: 'eth', active: 1 },
        { iface: 'bond0', type: 'bond', address: '10.10.10.1', netmask: '16', active: 1 },
        { iface: 'bond0.20', type: 'vlan', address: '10.10.11.1', active: 1 },
        { iface: 'vmbr1', type: 'OVSBridge', address: '10.20.0.1', active: 1 },
        { iface: 'vmbr2', type: 'bridge', address: '10.30.0.1', active: 0 },
      ],
    })
    let body = await readJson<any>(await callRoute(GET, { params: { id: 'c1' } }))
    expect(body.data.networks).toEqual([
      { iface: 'vmbr0', address: '172.16.253.1', cidr: '172.16.253.1/24', type: 'bridge', active: 1, comments: 'mgmt' },
      { iface: 'bond0', address: '10.10.10.1', cidr: '10.10.10.1/16', type: 'bond', active: 1, comments: '' },
      { iface: 'bond0.20', address: '10.10.11.1', cidr: '10.10.11.1/24', type: 'vlan', active: 1, comments: '' },
    ])

    answerByPath({ '/nodes': () => [] })
    body = await readJson<any>(await callRoute(GET, { params: { id: 'c1' } }))
    expect(body.data.networks).toEqual([])

    answerByPath({ '/nodes': () => [{ node: 'pve1' }], '/nodes/pve1/network': () => null })
    body = await readJson<any>(await callRoute(GET, { params: { id: 'c1' } }))
    expect(body.data.networks).toEqual([])

    answerByPath({ '/nodes': () => { throw new Error('503') } })
    body = await readJson<any>(await callRoute(GET, { params: { id: 'c1' } }))
    expect(body.data.networks).toEqual([])
  })

  it('answers 500 with the error message, or its string form', async () => {
    const GET = await importGET()

    getConnectionByIdMock.mockRejectedValue(new Error('db down'))
    let res = await callRoute(GET, { params: { id: 'c1' } })
    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'db down' })

    getConnectionByIdMock.mockRejectedValue('boom')
    res = await callRoute(GET, { params: { id: 'c1' } })
    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'boom' })
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
