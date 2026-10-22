import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

/*
   ui#1164: per-host Ceph noout of a node. Reading is PVE API (cluster status,
   OSD tree, Ceph health), the three commands run over SSH, with the payloads
   measured on the lab (Ceph 20.2.2 / PVE 9.2).
*/

vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: vi.fn<(id: string) => Promise<any>>(),
  isConnectionNotFoundError: (err: unknown) =>
    /connection not found/i.test((err as { message?: string } | null)?.message || ''),
}))

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: vi.fn<(...args: any[]) => Promise<any>>(),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn<(...args: any[]) => Promise<any>>(),
  buildNodeResourceId: vi.fn<(connId: string, node: string) => string>((connId, node) => `${connId}:${node}`),
  PERMISSIONS: { NODE_VIEW: 'node.view', NODE_MANAGE: 'node.manage' },
}))

vi.mock('@/lib/ssh/exec', () => ({
  executeSSH: vi.fn<(...args: any[]) => Promise<any>>(),
}))

vi.mock('@/lib/ssh/node-ip', () => ({
  getNodeIp: vi.fn<(...args: any[]) => Promise<string>>(),
}))
vi.mock('@/lib/ssh/node-endpoint', async () => {
  const nodeIp = await import('@/lib/ssh/node-ip')
  return {
    ...(await import('@/lib/ssh/node-endpoint-core')),
    resolveNodeSshEndpoint: async (conn: any, node: string) =>
      ({ host: await nodeIp.getNodeIp(conn, node), port: 22, source: 'proxmox' }),
  }
})

import { GET, POST, DELETE } from './route'
import { getConnectionById } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'
import { checkPermission } from '@/lib/rbac'
import { executeSSH } from '@/lib/ssh/exec'
import { getNodeIp } from '@/lib/ssh/node-ip'
import { PveLicenseExcludedError } from '@/lib/license/exclusions'

const getConnectionByIdMock = getConnectionById as any
const pveFetchMock = pveFetch as any
const checkPermissionMock = checkPermission as any
const executeSSHMock = executeSSH as any
const getNodeIpMock = getNodeIp as any

const CONN_ID = 'conn-1'
const NODE = 'pve3'
const params = { id: CONN_ID, node: NODE }

const CLUSTER_STATUS = [
  { type: 'cluster', name: 'lab', quorate: 1 },
  { type: 'node', name: 'pve1', online: 1, ip: '10.42.0.101' },
  { type: 'node', name: 'pve2', online: 1, ip: '10.42.0.102' },
  { type: 'node', name: 'pve3', online: 1, ip: '10.42.0.103' },
]

const osdTree = (opts: { flags?: string; pve3Down?: boolean } = {}) => ({
  flags: opts.flags ?? 'sortbitwise,recovery_deletes,purged_snapdirs,pglog_hardlimit',
  root: {
    children: [{
      type: 'root', name: 'default', id: '-1',
      children: [
        { type: 'host', name: 'pve1', id: '-3', children: [{ type: 'osd', id: '0', name: 'osd.0', host: 'pve1', status: 'up', in: 1 }] },
        { type: 'host', name: 'pve2', id: '-5', children: [{ type: 'osd', id: '1', name: 'osd.1', host: 'pve2', status: 'up', in: 1 }] },
        {
          type: 'host', name: 'pve3', id: '-7',
          children: [
            { type: 'osd', id: '2', name: 'osd.2', host: 'pve3', status: 'up', in: 1 },
            { type: 'osd', id: '5', name: 'osd.5', host: 'pve3', status: opts.pve3Down ? 'down' : 'up', in: 1 },
          ],
        },
      ],
    }],
  },
})

const HEALTH_OK = { health: { status: 'HEALTH_OK', checks: {} } }
const HEALTH_FLAGGED = {
  health: {
    status: 'HEALTH_WARN',
    checks: {
      MON_DISK_LOW: { detail: [{ message: 'mon.pve1 has 30% avail' }], severity: 'HEALTH_WARN', summary: { count: 1, message: 'mon pve1 is low on available space' } },
      OSD_FLAGS: {
        detail: [{ message: 'host pve3 has flags noout' }, { message: 'host pve1 has flags noout' }],
        severity: 'HEALTH_WARN',
        summary: { count: 1, message: '1 OSDs or CRUSH {nodes, device-classes} have {NOUP,NODOWN,NOIN,NOOUT} flags set' },
      },
    },
  },
}

const OK_TO_STOP = '{"ok_to_stop":true,"osds":[2,5],"num_ok_pgs":6,"num_not_ok_pgs":0,"ok_become_degraded":["1.0"]}\n'
const NOT_OK_TO_STOP = '{"ok_to_stop":false,"osds":[2,5],"num_ok_pgs":0,"num_not_ok_pgs":33,"bad_become_inactive":["1.0"]}\n'

/** PVE answers per path; a missing path rejects like a PVE error would. */
function seedPve(answers: Record<string, any>) {
  pveFetchMock.mockImplementation(async (_conn: any, path: string) => {
    if (path in answers) {
      const v = answers[path]
      if (v instanceof Error) throw v
      return v
    }
    throw new Error(`unexpected PVE path ${path}`)
  })
}

// The OSD tree is read through the node itself while it is online, through
// the first online node (pve1) for a node the cluster does not list.
const healthy = (tree = osdTree()) => ({
  '/cluster/status': CLUSTER_STATUS,
  '/nodes/pve3/ceph/osd': tree,
  '/nodes/pve1/ceph/osd': tree,
  '/cluster/ceph/status': HEALTH_OK,
})

const sshCalls = () => executeSSHMock.mock.calls.map((c: any[]) => c[2])

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  getConnectionByIdMock.mockResolvedValue({ id: CONN_ID })
  getNodeIpMock.mockImplementation(async (_c: any, node: string) => `10.42.0.${node === 'pve1' ? 101 : node === 'pve2' ? 102 : 103}`)
  executeSSHMock.mockResolvedValue({ success: true, output: '' })
  seedPve(healthy())
})

describe('GET /api/v1/connections/[id]/nodes/[node]/ceph/noout', () => {
  it('describes the CRUSH host, the OSDs, the flags and the health, without SSH', async () => {
    seedPve({ ...healthy(), '/cluster/ceph/status': HEALTH_FLAGGED })
    const res = await callRoute(GET, { params })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data).toEqual({
      hasCeph: true,
      crushHost: 'pve3',
      osds: [{ id: 2, status: 'up', in: true }, { id: 5, status: 'up', in: true }],
      noout: true,
      hostFlags: ['noout'],
      globalNoout: false,
      health: {
        status: 'HEALTH_WARN',
        checks: [
          { code: 'MON_DISK_LOW', severity: 'HEALTH_WARN', message: 'mon pve1 is low on available space' },
          { code: 'OSD_FLAGS', severity: 'HEALTH_WARN', message: '1 OSDs or CRUSH {nodes, device-classes} have {NOUP,NODOWN,NOIN,NOOUT} flags set' },
        ],
      },
      otherHostsWithNoout: ['pve1'],
    })
    expect(executeSSHMock).not.toHaveBeenCalled()
    expect(checkPermissionMock).toHaveBeenCalledWith('node.view', 'node', `${CONN_ID}:${NODE}`)
  })

  it('reports the global noout from the OSD tree flags and no host flag on a clean cluster', async () => {
    seedPve(healthy(osdTree({ flags: 'sortbitwise,noout' })))
    const body = await readJson<any>(await callRoute(GET, { params }))
    expect(body.data).toMatchObject({ noout: false, globalNoout: true, otherHostsWithNoout: [], health: { status: 'HEALTH_OK', checks: [] } })
  })

  it('answers hasCeph=false when the OSD tree cannot be read (Ceph not installed)', async () => {
    seedPve({ '/cluster/status': CLUSTER_STATUS, '/nodes/pve3/ceph/osd': new Error('binary not installed: /usr/bin/ceph-osd') })
    const res = await callRoute(GET, { params, searchParams: { precheck: '1' } })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data).toEqual({ hasCeph: false, crushHost: null, osds: [], noout: false, hostFlags: [], globalNoout: false, health: null, otherHostsWithNoout: [] })
    expect(executeSSHMock).not.toHaveBeenCalled()
  })

  it('answers no CRUSH host and no OSD, with no precheck, for a node hosting none', async () => {
    const res = await callRoute(GET, { params: { id: CONN_ID, node: 'pve9' }, searchParams: { precheck: '1' } })
    const body = await readJson<any>(res)
    expect(body.data).toMatchObject({ hasCeph: true, crushHost: null, osds: [] })
    expect(body.data.okToStop).toBeUndefined()
    expect(executeSSHMock).not.toHaveBeenCalled()
  })

  it('reads the OSD tree through another online node while the node is down', async () => {
    seedPve({
      '/cluster/status': CLUSTER_STATUS.map(r => (r.name === 'pve3' ? { ...r, online: 0 } : r)),
      '/nodes/pve1/ceph/osd': osdTree({ pve3Down: true }),
      '/cluster/ceph/status': HEALTH_FLAGGED,
    })
    const body = await readJson<any>(await callRoute(GET, { params }))
    expect(body.data).toMatchObject({ crushHost: 'pve3', noout: true, osds: [{ id: 2, status: 'up' }, { id: 5, status: 'down' }] })
  })

  it('?precheck=1 runs ok-to-stop over SSH as a read-only command and reads the stdout JSON', async () => {
    executeSSHMock.mockResolvedValue({ success: true, output: OK_TO_STOP })
    const body = await readJson<any>(await callRoute(GET, { params, searchParams: { precheck: '1' } }))
    expect(body.data.okToStop).toEqual({ ok: true, osds: [2, 5], numOkPgs: 6, numNotOkPgs: 0, message: null })
    expect(executeSSHMock).toHaveBeenCalledWith(
      CONN_ID,
      expect.objectContaining({ host: '10.42.0.103' }),
      'ceph osd ok-to-stop 2 5 -f json 2>/dev/null; true',
      30_000,
      { readOnly: true },
    )
  })

  it('?precheck=1 reports the unsafe verdict with the PG count', async () => {
    executeSSHMock.mockResolvedValue({ success: true, output: NOT_OK_TO_STOP })
    const body = await readJson<any>(await callRoute(GET, { params, searchParams: { precheck: '1' } }))
    expect(body.data.okToStop).toEqual({ ok: false, osds: [2, 5], numOkPgs: 0, numNotOkPgs: 33, message: null })
  })

  it('?precheck=1 never turns an SSH failure or an empty answer into a safe verdict', async () => {
    executeSSHMock.mockResolvedValueOnce({ success: false, error: 'ssh: connect refused' })
    let body = await readJson<any>(await callRoute(GET, { params, searchParams: { precheck: '1' } }))
    expect(body.data.okToStop).toEqual({ ok: false, osds: [2, 5], numOkPgs: 0, numNotOkPgs: 0, message: 'ssh: connect refused' })

    executeSSHMock.mockResolvedValueOnce({ success: true, output: '' })
    body = await readJson<any>(await callRoute(GET, { params, searchParams: { precheck: '1' } }))
    expect(body.data.okToStop).toMatchObject({ ok: false, message: 'ceph osd ok-to-stop returned no verdict' })

    executeSSHMock.mockRejectedValueOnce(new Error('No SSH credentials'))
    body = await readJson<any>(await callRoute(GET, { params, searchParams: { precheck: '1' } }))
    expect(body.data.okToStop).toMatchObject({ ok: false, message: 'No SSH credentials' })
  })

  it('400 on a node name outside the hostname grammar, 403 without node.view, 404 and 500 on connection errors', async () => {
    expect((await callRoute(GET, { params: { id: CONN_ID, node: 'pve3; id' } })).status).toBe(400)

    checkPermissionMock.mockResolvedValueOnce(new Response('{}', { status: 403 }))
    expect((await callRoute(GET, { params })).status).toBe(403)

    getConnectionByIdMock.mockRejectedValueOnce(new Error('Connection not found: conn-1'))
    expect((await callRoute(GET, { params })).status).toBe(404)

    getConnectionByIdMock.mockRejectedValueOnce(new Error('DB error'))
    const res = await callRoute(GET, { params })
    expect(res.status).toBe(500)
    expect((await readJson<any>(res)).error).toBe('DB error')
  })
})

describe('POST /api/v1/connections/[id]/nodes/[node]/ceph/noout', () => {
  it('runs ok-to-stop then set-group noout on the CRUSH host when stopping is safe', async () => {
    executeSSHMock
      .mockResolvedValueOnce({ success: true, output: OK_TO_STOP })
      .mockResolvedValueOnce({ success: true, output: '' })
    const res = await callRoute(POST, { params, method: 'POST', body: {} })
    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ success: true, crushHost: 'pve3', osds: [2, 5], output: '', forced: false })
    expect(sshCalls()).toEqual(['ceph osd ok-to-stop 2 5 -f json 2>/dev/null; true', 'ceph osd set-group noout pve3'])
    // The write is not read-only: it must be refused on a cluster outside the license.
    expect(executeSSHMock.mock.calls[1]).toHaveLength(3)
    expect(checkPermissionMock).toHaveBeenCalledWith('node.manage', 'node', `${CONN_ID}:${NODE}`)
  })

  it('409 not_ok_to_stop and nothing set when PGs would go offline', async () => {
    executeSSHMock.mockResolvedValueOnce({ success: true, output: NOT_OK_TO_STOP })
    const res = await callRoute(POST, { params, method: 'POST', body: {} })
    expect(res.status).toBe(409)
    const body = await readJson<any>(res)
    expect(body).toMatchObject({ code: 'not_ok_to_stop', okToStop: { ok: false, numNotOkPgs: 33 } })
    expect(body.error).toMatch(/33 PG/)
    expect(sshCalls()).toEqual(['ceph osd ok-to-stop 2 5 -f json 2>/dev/null; true'])
  })

  it('409 not_ok_to_stop when the verdict cannot be obtained', async () => {
    executeSSHMock.mockResolvedValueOnce({ success: false, error: 'ssh timeout' })
    const res = await callRoute(POST, { params, method: 'POST', body: {} })
    expect(res.status).toBe(409)
    expect(await readJson<any>(res)).toMatchObject({ code: 'not_ok_to_stop', error: 'ssh timeout' })
  })

  it('force: true skips the precheck and sets the flag', async () => {
    const res = await callRoute(POST, { params, method: 'POST', body: { force: true } })
    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toMatchObject({ success: true, forced: true })
    expect(sshCalls()).toEqual(['ceph osd set-group noout pve3'])
  })

  it('409 no_osds for a node without OSDs or without Ceph, before any SSH', async () => {
    let res = await callRoute(POST, { params: { id: CONN_ID, node: 'pve9' }, method: 'POST', body: { force: true } })
    expect(res.status).toBe(409)
    expect(await readJson<any>(res)).toMatchObject({ code: 'no_osds' })

    seedPve({ '/cluster/status': CLUSTER_STATUS, '/nodes/pve3/ceph/osd': new Error('not installed') })
    res = await callRoute(POST, { params, method: 'POST', body: { force: true } })
    expect(res.status).toBe(409)
    expect(executeSSHMock).not.toHaveBeenCalled()
  })

  it('400 when the CRUSH host Ceph reports is outside the hostname grammar', async () => {
    // A bucket that still matches the node on its first label, but carries
    // characters the grammar refuses: never interpolated into a command.
    const tree = osdTree()
    tree.root.children[0].children[2].name = 'pve3.lab$(id)'
    seedPve(healthy(tree))
    const res = await callRoute(POST, { params, method: 'POST', body: { force: true } })
    expect(res.status).toBe(400)
    expect(executeSSHMock).not.toHaveBeenCalled()
  })

  it('500 with a manual hint when set-group fails, 403 with its code outside the license', async () => {
    executeSSHMock.mockResolvedValueOnce({ success: false, error: 'Error EINVAL: unable to parse osd id or crush node' })
    let res = await callRoute(POST, { params, method: 'POST', body: { force: true } })
    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toMatchObject({ error: expect.stringMatching(/EINVAL/), hint: 'Run manually on a PVE node: ceph osd set-group noout pve3' })

    executeSSHMock.mockRejectedValueOnce(new PveLicenseExcludedError(CONN_ID))
    res = await callRoute(POST, { params, method: 'POST', body: { force: true } })
    expect(res.status).toBe(403)
    expect(await readJson<any>(res)).toMatchObject({ code: 'CONNECTION_LICENSE_EXCLUDED' })
  })

  it('400 on a bad node name and 403 without node.manage, never running SSH', async () => {
    expect((await callRoute(POST, { params: { id: CONN_ID, node: 'a\nb' }, method: 'POST', body: {} })).status).toBe(400)
    checkPermissionMock.mockResolvedValueOnce(new Response('{}', { status: 403 }))
    expect((await callRoute(POST, { params, method: 'POST', body: {} })).status).toBe(403)
    expect(executeSSHMock).not.toHaveBeenCalled()
    expect(pveFetchMock).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/v1/connections/[id]/nodes/[node]/ceph/noout', () => {
  it('runs unset-group noout on the CRUSH host when every OSD is up', async () => {
    const res = await callRoute(DELETE, { params, method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ success: true, crushHost: 'pve3', osds: [2, 5], output: '', forced: false, osdsDown: [] })
    expect(sshCalls()).toEqual(['ceph osd unset-group noout pve3'])
  })

  it('409 osds_down and the flag kept while an OSD of the node is not up', async () => {
    seedPve(healthy(osdTree({ pve3Down: true })))
    const res = await callRoute(DELETE, { params, method: 'DELETE' })
    expect(res.status).toBe(409)
    expect(await readJson<any>(res)).toMatchObject({ code: 'osds_down', osds: [5], error: expect.stringMatching(/osd\.5/) })
    expect(executeSSHMock).not.toHaveBeenCalled()
  })

  it('?force=1 lifts the flag although an OSD is down, through another online node', async () => {
    seedPve({
      '/cluster/status': CLUSTER_STATUS.map(r => (r.name === 'pve3' ? { ...r, online: 0 } : r)),
      '/nodes/pve1/ceph/osd': osdTree({ pve3Down: true }),
      '/cluster/ceph/status': HEALTH_FLAGGED,
    })
    const res = await callRoute(DELETE, { params, method: 'DELETE', searchParams: { force: '1' } })
    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toMatchObject({ success: true, forced: true, osdsDown: [5] })
    expect(executeSSHMock).toHaveBeenCalledWith(CONN_ID, expect.objectContaining({ host: '10.42.0.101' }), 'ceph osd unset-group noout pve3')
  })

  it('409 no_osds without a CRUSH host, 500 with a hint when unset-group fails', async () => {
    let res = await callRoute(DELETE, { params: { id: CONN_ID, node: 'pve9' }, method: 'DELETE' })
    expect(res.status).toBe(409)
    expect(await readJson<any>(res)).toMatchObject({ code: 'no_osds' })

    executeSSHMock.mockResolvedValueOnce({ success: false, error: 'boom' })
    res = await callRoute(DELETE, { params, method: 'DELETE' })
    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toMatchObject({ error: 'boom', hint: 'Run manually on a PVE node: ceph osd unset-group noout pve3' })
  })

  it('400 on a bad node name, 403 without node.manage, 404 and 500 on connection errors', async () => {
    expect((await callRoute(DELETE, { params: { id: CONN_ID, node: '-x' }, method: 'DELETE' })).status).toBe(400)
    checkPermissionMock.mockResolvedValueOnce(new Response('{}', { status: 403 }))
    expect((await callRoute(DELETE, { params, method: 'DELETE' })).status).toBe(403)
    getConnectionByIdMock.mockRejectedValueOnce(new Error('Connection not found: conn-1'))
    expect((await callRoute(DELETE, { params, method: 'DELETE' })).status).toBe(404)
    getConnectionByIdMock.mockRejectedValueOnce(new Error('DB error'))
    expect((await callRoute(DELETE, { params, method: 'DELETE' })).status).toBe(500)
    expect(executeSSHMock).not.toHaveBeenCalled()
  })
})
