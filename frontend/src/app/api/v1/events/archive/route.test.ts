import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '@/__tests__/setup/route-test'
import { nodeScope } from '@/__tests__/setup/rbacScope'

// #1225: the archive reads every node's task history with the same perimeter
// as the live Events feed (vDC nodes and pools, RBAC infra scope).

const { getInfraMock, globalFindMany, sessionFindMany, pveFetchMock, rbacScopeMock, vdcVmidsMock, findInitiatorsMock, deniedPermissions, storedMock } =
  vi.hoisted(() => ({
    storedMock: vi.fn(),
    getInfraMock: vi.fn(),
    globalFindMany: vi.fn(),
    sessionFindMany: vi.fn(),
    pveFetchMock: vi.fn(),
    rbacScopeMock: vi.fn(),
    vdcVmidsMock: vi.fn(),
    findInitiatorsMock: vi.fn(),
    deniedPermissions: new Set<string>(),
  }))

vi.mock('@/lib/tenant/infraScope', async orig => ({
  ...(await orig<typeof import('@/lib/tenant/infraScope')>()),
  getTenantInfrastructureScope: (...a: any[]) => getInfraMock(...a),
}))
vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: async () => ({ connection: { findMany: sessionFindMany } }),
  getCurrentTenantId: async () => 'default',
}))
vi.mock('@/lib/db/prisma', () => ({ prisma: { connection: { findMany: globalFindMany } } }))
vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: vi.fn(async (id: string) => ({ id, baseUrl: 'https://pve', apiToken: 't' })),
}))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn(async (perm: string) => (deniedPermissions.has(perm) ? new Response(null, { status: 403 }) : null)),
  getCurrentRbacInfraScope: rbacScopeMock,
  PERMISSIONS: { CONNECTION_VIEW: 'connection.view', ADMIN_AUDIT: 'admin.audit' },
}))
vi.mock('@/lib/auth/principal', () => ({ getPrincipal: async () => ({ ok: true, principal: { kind: 'session', userId: 'u-self' } }) }))
vi.mock('@/lib/alerts/vdcVmids', () => ({ getVdcVmidsByConnection: (...a: any[]) => vdcVmidsMock(...a) }))
vi.mock('@/lib/audit/taskInitiators', () => ({ findTaskInitiators: (...a: any[]) => findInitiatorsMock(...a) }))
vi.mock('@/lib/tasks/history', async orig => ({
  ...(await orig<typeof import('@/lib/tasks/history')>()),
  fetchStoredTasks: (...a: any[]) => storedMock(...a),
}))

const NOW = Math.floor(Date.now() / 1000)

function upid(node: string, n: number, type: string, vmid = '') {
  return `UPID:${node}:0000000${n}:0000000${n}:00000000:${type}:${vmid}:root@pam:`
}

const TASKS: Record<string, any[]> = {
  n1: [
    { upid: upid('n1', 1, 'qmstart', '100'), node: 'n1', type: 'qmstart', id: '100', user: 'root@pam', starttime: NOW - 600, endtime: NOW - 590, status: 'OK' },
    { upid: upid('n1', 2, 'vzdump', '100'), node: 'n1', type: 'vzdump', id: '100', user: 'root@pam', starttime: NOW - 300, endtime: NOW - 240, status: 'job errors' },
    { upid: upid('n1', 3, 'aptupdate'), node: 'n1', type: 'aptupdate', id: '', user: 'root@pam', starttime: NOW - 200, endtime: NOW - 190, status: 'WARNINGS: 1' },
  ],
  n2: [
    { upid: upid('n2', 4, 'qmigrate', '200'), node: 'n2', type: 'qmigrate', id: '200', user: 'root@pam', starttime: NOW - 100, endtime: NOW - 40, status: 'OK' },
  ],
}

let nodes: { node: string; status?: string }[]

beforeEach(() => {
  vi.clearAllMocks()
  deniedPermissions.clear()
  nodes = [{ node: 'n1', status: 'online' }, { node: 'n2', status: 'online' }]
  getInfraMock.mockResolvedValue({ kind: 'provider' })
  globalFindMany.mockResolvedValue([{ id: 'p1', name: 'PVE 1', tenantId: null }])
  sessionFindMany.mockResolvedValue([])
  rbacScopeMock.mockResolvedValue(null)
  vdcVmidsMock.mockResolvedValue(null)
  findInitiatorsMock.mockResolvedValue(new Map())
  storedMock.mockResolvedValue({ tasks: [], truncated: false })
  pveFetchMock.mockImplementation(async (_c: any, path: string) => {
    if (path === '/nodes') return nodes
    if (path === '/cluster/resources?type=vm') {
      return [{ vmid: 100, name: 'web-01', type: 'qemu', status: 'running' }, { vmid: 200, name: 'db-01', type: 'lxc', status: 'stopped' }]
    }
    const m = /^\/nodes\/([^/]+)\/tasks\?/.exec(path)

    return m ? TASKS[decodeURIComponent(m[1])] ?? [] : []
  })
})

async function get(searchParams: Record<string, string> = {}) {
  const { GET } = await import('./route')
  const res = await callRoute(GET, { method: 'GET', searchParams })

  return { status: res.status, body: res.status === 403 ? null : await res.json() }
}

describe('GET /api/v1/events/archive', () => {
  it('reads the archive of every node, newest first, with guests and summary', async () => {
    const { status, body } = await get()

    expect(status).toBe(200)
    expect(body.data.map((t: any) => t.type)).toEqual(['qmigrate', 'aptupdate', 'vzdump', 'qmstart'])
    expect(body.data[0]).toMatchObject({ guestName: 'db-01', guestType: 'lxc', family: 'migration', connectionName: 'PVE 1', duration: '1m 0s' })
    expect(body.meta).toMatchObject({ total: 4, page: 0, truncated: false, unavailable: [], summary: { total: 4, ok: 2, warning: 1, error: 1 } })
    expect(body.meta.nodes.map((n: any) => n.node)).toEqual(['n1', 'n2'])
    expect(body.meta.connections).toEqual([{ id: 'p1', name: 'PVE 1' }])

    const taskPath = pveFetchMock.mock.calls.map(c => c[1]).find((p: string) => p.startsWith('/nodes/n1/tasks'))

    expect(taskPath).toContain('source=all')
    expect(taskPath).toContain('limit=5000')
  })

  it('filters on node, vmid, family and search, and passes the vmid to Proxmox', async () => {
    expect((await get({ node: 'n2' })).body.data.map((t: any) => t.node)).toEqual(['n2'])
    expect((await get({ families: 'backup' })).body.data.map((t: any) => t.type)).toEqual(['vzdump'])
    expect((await get({ q: 'web-01' })).body.data.map((t: any) => t.type)).toEqual(['vzdump', 'qmstart'])

    pveFetchMock.mockClear()
    await get({ vmid: '100' })
    expect(pveFetchMock.mock.calls.some(c => String(c[1]).includes('vmid=100'))).toBe(true)
  })

  it('filters on status after the summary, so the counters keep the whole window', async () => {
    const { body } = await get({ status: 'error' })

    expect(body.data.map((t: any) => t.type)).toEqual(['vzdump'])
    expect(body.meta.total).toBe(1)
    expect(body.meta.summary.total).toBe(4)
  })

  it('pages and clamps a page past the end', async () => {
    TASKS.big = Array.from({ length: 25 }, (_, i) => ({
      upid: upid('big', i, 'qmstart', '100'), node: 'big', type: 'qmstart', id: '100', user: 'root@pam', starttime: NOW - 1000 + i, endtime: NOW - 900, status: 'OK',
    }))
    nodes = [{ node: 'big', status: 'online' }]

    const second = await get({ pageSize: '20', page: '1' })

    expect(second.body.data).toHaveLength(5)
    expect(second.body.meta).toMatchObject({ total: 25, page: 1, pageSize: 20 })
    expect((await get({ pageSize: '20', page: '9' })).body.meta.page).toBe(1)
    delete TASKS.big
  })

  it('reports offline and failing nodes, and a node that hit the read limit', async () => {
    nodes = [{ node: 'n1', status: 'offline' }, { node: 'n2', status: 'online' }, { node: 'n3', status: 'online' }]
    TASKS.n3 = Array.from({ length: 5000 }, (_, i) => ({
      upid: upid('n3', i, 'vncproxy', '100'), node: 'n3', type: 'vncproxy', id: '100', user: 'root@pam', starttime: NOW - 5000 + i, endtime: NOW - 10, status: 'OK',
    }))
    const base = pveFetchMock.getMockImplementation()!

    pveFetchMock.mockImplementation(async (c: any, path: string) => {
      if (path.startsWith('/nodes/n2/tasks')) throw new Error('timeout')

      return base(c, path)
    })

    const { body } = await get({ pageSize: '20' })

    expect(body.meta.unavailable).toEqual([{ connectionName: 'PVE 1', node: 'n1' }, { connectionName: 'PVE 1', node: 'n2' }])
    expect(body.meta.truncated).toBe(true)
    delete TASKS.n3
  })

  it('marks a connection that cannot be reached at all', async () => {
    pveFetchMock.mockRejectedValue(new Error('down'))

    const { status, body } = await get()

    expect(status).toBe(200)
    expect(body.data).toEqual([])
    expect(body.meta.unavailable).toEqual([{ connectionName: 'PVE 1', node: '' }])
  })

  it('keeps an RBAC user to the granted node, even when another node is asked for', async () => {
    rbacScopeMock.mockResolvedValue(nodeScope('p1', 'n1'))

    const { body } = await get()

    expect(new Set(body.data.map((t: any) => t.node))).toEqual(new Set(['n1']))
    expect(body.meta.nodes.map((n: any) => n.node)).toEqual(['n1'])
    expect((await get({ node: 'n2' })).body.data).toEqual([])
  })

  it('never names an offline node outside the RBAC grant', async () => {
    rbacScopeMock.mockResolvedValue(nodeScope('p1', 'n1'))
    nodes = [{ node: 'n1', status: 'offline' }, { node: 'n2', status: 'offline' }]

    expect((await get()).body.meta.unavailable).toEqual([{ connectionName: 'PVE 1', node: 'n1' }])
  })

  it('keeps a vDC tenant to its nodes and its pool guests', async () => {
    getInfraMock.mockResolvedValue({
      kind: 'iaas',
      vdcScope: {
        connectionIds: new Set(['p1']),
        pbsConnectionIds: new Set<string>(),
        nodesByConnection: new Map([['p1', new Set(['n1'])]]),
        poolsByConnection: new Map([['p1', new Set(['pool-a'])]]),
      },
    })
    vdcVmidsMock.mockResolvedValue(new Map([['p1', new Set(['100'])]]))

    const { body } = await get()

    expect(body.data.map((t: any) => t.type)).toEqual(['vzdump', 'qmstart'])
    expect(body.meta.nodes.map((n: any) => n.node)).toEqual(['n1'])
    expect(pveFetchMock.mock.calls.some(c => String(c[1]).startsWith('/nodes/n2/tasks'))).toBe(false)
  })

  it('refuses a caller without connection.view', async () => {
    deniedPermissions.add('connection.view')

    expect((await get()).status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('attaches initiators of the page, limited to the caller without admin.audit', async () => {
    findInitiatorsMock.mockResolvedValue(new Map([[upid('n2', 4, 'qmigrate', '200'), { email: 'me@example.com', apiTokenId: null }]]))

    const admin = await get()

    expect(admin.body.data[0].initiatedBy).toEqual({ email: 'me@example.com', apiTokenId: null })
    expect(findInitiatorsMock.mock.calls[0][1].onlyFor).toBeUndefined()

    deniedPermissions.add('admin.audit')
    await get()
    expect(findInitiatorsMock.mock.calls[1][1].onlyFor).toEqual({ userId: 'u-self', apiTokenId: undefined })
  })

  it('still answers when the attribution lookup fails', async () => {
    findInitiatorsMock.mockRejectedValue(new Error('db'))

    const { status, body } = await get()

    expect(status).toBe(200)
    expect(body.data).toHaveLength(4)
  })

  it('answers 500 when the scope cannot be read', async () => {
    getInfraMock.mockRejectedValue(new Error('boom'))

    const { status, body } = await get()

    expect(status).toBe(500)
    expect(body.error).toBe('boom')
  })
})

function storedRow(e: any, connectionId = 'p1') {
  return {
    upid: e.upid,
    connectionId,
    startTime: new Date(e.starttime * 1000).toISOString(),
    endTime: e.endtime ? new Date(e.endtime * 1000).toISOString() : null,
    node: e.node,
    type: e.type,
    guestId: e.id,
    user: e.user,
    status: e.status ?? '',
  }
}

describe('GET /api/v1/events/archive with ProxCenter\'s copy', () => {
  const dead = { upid: upid('n3', 7, 'qmstart', '100'), node: 'n3', type: 'qmstart', id: '100', user: 'root@pam', starttime: NOW - 50, endtime: NOW - 45, status: 'OK' }

  it('asks the copy for the readable connections and the window', async () => {
    const { body } = await get({ node: 'n1', vmid: '100' })

    expect(storedMock).toHaveBeenCalledWith(expect.objectContaining({ connectionIds: ['p1'], nodes: ['n1'], vmid: '100' }))
    expect(body.meta.history).toBe(true)
  })

  it('shows the tasks of a node that is down from the copy, marked as such', async () => {
    nodes = [{ node: 'n1', status: 'online' }, { node: 'n2', status: 'online' }, { node: 'n3', status: 'offline' }]
    storedMock.mockResolvedValue({ tasks: [storedRow(dead)], truncated: false })

    const { body } = await get()
    const row = body.data.find((t: any) => t.node === 'n3')

    expect(row).toMatchObject({ id: dead.upid, fromHistory: true, guestName: 'web-01', family: 'power' })
    expect(body.data.filter((t: any) => t.fromHistory)).toHaveLength(1)
    expect(body.meta.unavailable).toEqual([{ connectionName: 'PVE 1', node: 'n3' }])
  })

  it('prefers what the node serves over the copy for the same task', async () => {
    const live = TASKS.n1[1]

    storedMock.mockResolvedValue({ tasks: [storedRow({ ...live, status: '', endtime: undefined })], truncated: false })

    const { body } = await get()
    const row = body.data.find((t: any) => t.id === live.upid)

    expect(row.status).toBe('job errors')
    expect(row.fromHistory).toBeUndefined()
    expect(body.meta.total).toBe(4)
  })

  it('keeps the copy when the whole cluster cannot be reached', async () => {
    pveFetchMock.mockRejectedValue(new Error('down'))
    storedMock.mockResolvedValue({ tasks: [storedRow(dead)], truncated: true })

    const { body } = await get()

    expect(body.data.map((t: any) => t.id)).toEqual([dead.upid])
    expect(body.meta.unavailable).toEqual([{ connectionName: 'PVE 1', node: '' }])
    expect(body.meta.truncated).toBe(true)
  })

  it('applies the RBAC scope to the copy too', async () => {
    rbacScopeMock.mockResolvedValue(nodeScope('p1', 'n1'))
    storedMock.mockResolvedValue({ tasks: [storedRow(dead)], truncated: false })

    const { body } = await get()

    expect(body.data.some((t: any) => t.node === 'n3')).toBe(false)
  })

  it('reads the nodes alone when the copy cannot be read', async () => {
    storedMock.mockResolvedValue(null)

    const { body } = await get()

    expect(body.meta.history).toBe(false)
    expect(body.data).toHaveLength(4)
  })
})
