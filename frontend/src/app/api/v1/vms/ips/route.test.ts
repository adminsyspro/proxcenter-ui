import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '../../../../../__tests__/setup/route-test'

const { pveFetchMock, rbacCtxMock, filterMock, visibilityMock } = vi.hoisted(() => ({
  pveFetchMock: vi.fn<(conn: any, path: string) => Promise<any>>(),
  rbacCtxMock: vi.fn(),
  filterMock: vi.fn(),
  visibilityMock: vi.fn(),
}))

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))
vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: async (id: string) => ({ id, name: id, baseUrl: `https://${id}`, apiToken: 'x', insecureDev: false, behindProxy: false }),
}))
vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn().mockResolvedValue(null),
  getRBACContext: () => rbacCtxMock(),
  filterVmsByPermission: (...a: any[]) => filterMock(...a),
  PERMISSIONS: { VM_VIEW: 'vm.view' },
}))
vi.mock('@/lib/vdc/guestGuard', async orig => ({
  ...(await orig<typeof import('@/lib/vdc/guestGuard')>()),
  sessionGuestVisibility: (...a: any[]) => visibilityMock(...a),
}))

import { resetDaemonSlots } from '@/lib/proxmox/daemonSlots'
import { resetGuestAgentMutes } from '@/lib/proxmox/guestAgentCall'

import { POST, resetGuestDetailsCache } from './route'

const vm = (vmid: number, extra: Record<string, unknown> = {}) => ({ connId: 'c1', type: 'qemu', node: 'pve1', vmid: String(vmid), status: 'running', ...extra })

type Pve = Record<string, any>

/** Serves PVE answers by path suffix; a function value is called, an Error value is thrown. */
function servePve(answers: (vmid: string) => Pve) {
  pveFetchMock.mockImplementation(async (_conn, path) => {
    const vmid = /\/(?:qemu|lxc)\/(\d+)\//.exec(path)?.[1] ?? ''
    const table = answers(vmid)
    const key = Object.keys(table).find(k => path.endsWith(k))

    if (!key) throw new Error(`unexpected ${path}`)
    const value = typeof table[key] === 'function' ? await table[key]() : table[key]

    if (value instanceof Error) throw value

    return value
  })
}

const calls = (suffix: string) => pveFetchMock.mock.calls.filter(([, p]) => p.endsWith(suffix)).length

const interfaces = (ip: string) => ({ result: [{ name: 'lo', 'ip-addresses': [{ 'ip-address-type': 'ipv4', 'ip-address': '127.0.0.1' }] }, { name: 'eth0', 'ip-addresses': [{ 'ip-address-type': 'ipv4', 'ip-address': ip }] }] })

async function post(vms: unknown[]) {
  const res = await callRoute(POST, { body: { vms } })

  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  vi.clearAllMocks()
  resetDaemonSlots()
  resetGuestAgentMutes()
  resetGuestDetailsCache()
  rbacCtxMock.mockResolvedValue({ isAdmin: true, tenantId: 'default' })
  filterMock.mockImplementation(async (_p: unknown, list: unknown[]) => list)
  visibilityMock.mockResolvedValue({ ok: true, visibility: { all: true, has: () => true } })
})

describe('POST /api/v1/vms/ips', () => {
  it('reads IP, snapshots and OS through the agent, and never status/current', async () => {
    servePve(() => ({
      '/config': { agent: '1' },
      '/snapshot': [{ name: 'before-upgrade' }, { name: 'current' }],
      '/agent/network-get-interfaces': interfaces('10.0.0.5'),
      '/agent/get-osinfo': { result: { id: 'debian', 'pretty-name': 'Debian GNU/Linux 13' } },
    }))

    const { body } = await post([vm(101)])

    expect(body).toEqual({
      data: { 'c1:qemu:pve1:101': { ip: '10.0.0.5', snapshots: 1, osInfo: { type: 'linux', name: 'Debian GNU/Linux 13', version: null, kernel: null } } },
      pending: [],
    })
    expect(calls('/status/current')).toBe(0)
  })

  it('does not ask the agent of a VM whose options do not enable it, and keeps its static address', async () => {
    servePve(() => ({ '/config': { agent: '0', ipconfig0: 'ip=192.168.1.20/24,gw=192.168.1.1' }, '/snapshot': [] }))

    const { body } = await post([vm(101)])

    expect(body.data['c1:qemu:pve1:101']).toEqual({ ip: '192.168.1.20', snapshots: 0, osInfo: null })
    expect(pveFetchMock.mock.calls.some(([, p]) => p.includes('/agent/'))).toBe(false)
  })

  it('leaves alone an agent that did not answer, for the next requests too', async () => {
    servePve(() => ({ '/config': { agent: '1' }, '/snapshot': [], '/agent/network-get-interfaces': new Error('QEMU guest agent is not running') }))

    await post([vm(101)])
    resetGuestDetailsCache()
    const { body } = await post([vm(101)])

    expect(body.data['c1:qemu:pve1:101']).toEqual({ ip: null, snapshots: 0, osInfo: null })
    expect(calls('/agent/network-get-interfaces')).toBe(1)
    expect(calls('/agent/get-osinfo')).toBe(0)
  })

  it('serves a guest asked again within a minute from the cache, and its OS for hours', async () => {
    servePve(() => ({ '/config': { agent: '1' }, '/snapshot': [], '/agent/network-get-interfaces': interfaces('10.0.0.5'), '/agent/get-osinfo': { result: { name: 'Windows' } } }))

    let clock = 1_000_000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock)

    try {
      await post([vm(101)])
      await post([vm(101)])
      expect(pveFetchMock).toHaveBeenCalledTimes(4)

      clock += 61_000
      servePve(() => ({ '/config': { agent: '1' }, '/snapshot': [], '/agent/network-get-interfaces': interfaces('10.0.0.5') }))
      const { body } = await post([vm(101)])

      expect(body.data['c1:qemu:pve1:101'].osInfo).toEqual({ type: 'windows', name: 'Windows', version: null, kernel: null })
      // Still the get-osinfo of the first request.
      expect(calls('/agent/get-osinfo')).toBe(1)
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('keeps at most 2 protected calls in flight on a node, however many guests are asked', async () => {
    let inFlight = 0
    let peak = 0
    const slow = async () => {
      peak = Math.max(peak, ++inFlight)
      await new Promise(resolve => setTimeout(resolve, 5))
      inFlight--

      return []
    }

    servePve(() => ({ '/config': { agent: '0' }, '/snapshot': slow }))

    const { body } = await post(Array.from({ length: 12 }, (_, i) => vm(200 + i)))

    expect(Object.keys(body.data)).toHaveLength(12)
    expect(peak).toBe(2)
  })

  it('returns as pending the guests whose calls could not start within the time budget', async () => {
    let clock = 1_000_000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    const stuck = async () => { await new Promise(resolve => setTimeout(resolve, 5)); clock += 30_000; return [] }

    servePve(() => ({ '/config': { agent: '0' }, '/snapshot': stuck }))

    try {
      const { body } = await post([vm(101), vm(102), vm(103)])

      expect(Object.keys(body.data)).toEqual(['c1:qemu:pve1:101', 'c1:qemu:pve1:102'])
      expect(body.pending).toEqual(['c1:qemu:pve1:103'])
      expect(calls('/snapshot')).toBe(2)
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('reads an LXC address from its interfaces and its OS from the config', async () => {
    servePve(() => ({ '/config': { ostype: 'debian', net0: 'name=eth0,ip=dhcp' }, '/snapshot': [], '/interfaces': [{ name: 'lo', inet: '127.0.0.1/8' }, { name: 'eth0', inet: '10.0.0.9/24' }] }))

    const { body } = await post([vm(301, { type: 'lxc' })])

    expect(body.data['c1:lxc:pve1:301']).toEqual({ ip: '10.0.0.9', snapshots: 0, osInfo: { type: 'linux', name: 'Debian', version: null, kernel: null } })
  })

  it('reads nothing of a guest outside the vDC of the session, nor of one the RBAC hides', async () => {
    const resources = [{ type: 'qemu', vmid: 101, pool: 'web', tags: 'prod' }, { type: 'qemu', vmid: 102, pool: 'db' }]

    servePve(() => ({ '/cluster/resources?type=vm': resources, '/config': { agent: '0' }, '/snapshot': [] }))
    visibilityMock.mockResolvedValue({ ok: true, visibility: { all: false, has: (_t: string, vmid: string) => vmid === '101' } })
    rbacCtxMock.mockResolvedValue({ isAdmin: false, tenantId: 't1', userId: 'u1' })
    filterMock.mockImplementation(async (_p: unknown, list: any[]) => list.filter(g => g.vmid !== '102'))

    // A pool sent in the body is ignored: the grants see the guest's own pool.
    const { body } = await post([vm(101), vm(102, { pool: 'web' }), vm(103)])

    expect(Object.keys(body.data)).toEqual(['c1:qemu:pve1:101'])
    expect(filterMock.mock.calls[0][1].map((g: any) => [g.id, g.pool, g.tags])).toEqual([
      ['c1:qemu:pve1:101', 'web', 'prod'],
      ['c1:qemu:pve1:102', 'db', undefined],
      ['c1:qemu:pve1:103', undefined, undefined],
    ])
    expect(visibilityMock.mock.calls[0][0].resources).toBe(resources)
    expect(pveFetchMock.mock.calls.every(([, p]) => p.includes('/101/') || p.startsWith('/cluster/resources'))).toBe(true)
  })

  it('reads nothing for a scoped user when the guests pools and tags cannot be read', async () => {
    servePve(() => ({ '/cluster/resources?type=vm': new Error('595 no route'), '/config': {}, '/snapshot': [] }))
    rbacCtxMock.mockResolvedValue({ isAdmin: false, tenantId: 't1', userId: 'u1' })

    const { body } = await post([vm(101)])

    expect(body.data).toEqual({})
    expect(filterMock).not.toHaveBeenCalled()
  })

  it('reads nothing of a connection whose vDC scope cannot be verified', async () => {
    visibilityMock.mockResolvedValue({ ok: false })

    const { body } = await post([vm(101)])

    expect(body.data).toEqual({})
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('refuses a body longer than two table pages and skips malformed guests', async () => {
    expect((await post(Array.from({ length: 201 }, (_, i) => vm(i + 100)))).status).toBe(400)

    servePve(() => ({ '/config': {}, '/snapshot': [] }))
    const { body } = await post([vm(101, { node: '../etc' }), vm(102, { type: 'vm' }), { connId: 'c1', type: 'qemu', node: 'pve1', vmid: 'abc' }])

    expect(body).toEqual({ data: {}, pending: [] })
    expect(pveFetchMock).not.toHaveBeenCalled()
  })
})
