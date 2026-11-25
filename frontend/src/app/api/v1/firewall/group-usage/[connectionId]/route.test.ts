/**
 * GET /api/v1/firewall/group-usage/[connectionId]: which guests carry which security group. What is tested here is
 * the access and the Proxmox load: one rules call per guest, never more than 4 in flight nor 2 per node, 200 guests
 * unless every guest is asked, and nothing asked again inside the cache.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const h = vi.hoisted(() => ({
  ownership: vi.fn<(id: string) => Promise<Response | null>>(),
  permission: vi.fn<(...a: any[]) => Promise<Response | null>>(),
  iaasDenied: vi.fn<() => Promise<Response | null>>(),
  orchGet: vi.fn<(path: string) => Promise<any>>(),
  orchFetch: vi.fn<(path: string) => Promise<any>>(),
  pveFetch: vi.fn<(...a: any[]) => Promise<any>>(),
}))

vi.mock('@/lib/tenant', () => ({
  verifyConnectionOwnership: (id: string) => h.ownership(id),
  getCurrentTenantId: async () => 'default',
}))
vi.mock('@/lib/tenant/iaasGuard', () => ({ denyIaasTenant: () => h.iaasDenied() }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: any[]) => h.permission(...a),
  PERMISSIONS: { NODE_VIEW: 'node.view' },
}))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: async () => ({ id: 'conn-1' }) }))
vi.mock('@/lib/orchestrator/client', () => ({
  getOrchestratorClient: () => ({ get: (p: string) => h.orchGet(p) }),
  orchestratorFetch: (p: string) => h.orchFetch(p),
  orchestratorSegment: (v: string) => encodeURIComponent(v),
}))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: any[]) => h.pveFetch(...a) }))

import { invalidateInventoryCache } from '@/lib/cache/inventoryCache'
import { engineWritesMark, resetGroupUsage } from '@/lib/firewall/groupUsage'
import { resetConnectionPools } from '@/lib/inventory/connectionPool'

import { GET } from './route'

type Guest = { vmid: number; node: string; type: 'qemu' | 'lxc'; name?: string; template?: number }

function guests(count: number, nodes = ['pve1', 'pve2', 'pve3']): Guest[] {
  return Array.from({ length: count }, (_, i) => ({ vmid: 100 + i, node: nodes[i % nodes.length], type: 'qemu', name: `vm${100 + i}` }))
}

/** The connection's guests and nodes as /cluster/resources gives them (cold inventory). */
function onPve(list: Guest[], offlineNodes: string[] = []) {
  const nodes = [...new Set(list.map(g => g.node))].map(node => ({ type: 'node', node, status: offlineNodes.includes(node) ? 'offline' : 'online' }))
  h.pveFetch.mockImplementation(async (_conn: unknown, path: string) => {
    if (path === '/cluster/resources') return [...nodes, ...list]
    throw new Error(`unexpected PVE call ${path}`)
  })
}

/** The rules answer of each guest; counts the calls in flight, overall and per node. */
function rules(of: (vmid: number) => Array<{ type: string; action: string }>, delayMs = 2) {
  const stats = { calls: 0, inFlight: 0, maxInFlight: 0, perNode: new Map<string, number>(), maxPerNode: 0 }
  h.orchGet.mockImplementation(async (path: string) => {
    const m = /^\/firewall\/vms\/conn-1\/([^/]+)\/(qemu|lxc)\/(\d+)\/rules$/.exec(path)
    if (!m) throw new Error(`unexpected orchestrator call ${path}`)
    const node = m[1]
    stats.calls++
    stats.inFlight++
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight)
    stats.perNode.set(node, (stats.perNode.get(node) ?? 0) + 1)
    stats.maxPerNode = Math.max(stats.maxPerNode, stats.perNode.get(node)!)
    await new Promise(resolve => setTimeout(resolve, delayMs))
    stats.inFlight--
    stats.perNode.set(node, stats.perNode.get(node)! - 1)

    return { data: of(Number(m[3])) }
  })

  return stats
}

// The route declares a NextRequest where the harness's signature names the plain Request: same call.
const get = (searchParams?: Record<string, string>) => callRoute(GET as Parameters<typeof callRoute>[0], { params: { connectionId: 'conn-1' }, searchParams })

beforeEach(() => {
  vi.clearAllMocks()
  resetGroupUsage()
  resetConnectionPools()
  invalidateInventoryCache()
  h.ownership.mockResolvedValue(null)
  h.permission.mockResolvedValue(null)
  h.iaasDenied.mockResolvedValue(null)
  h.orchFetch.mockRejectedValue(new Error('no engine'))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('GET /api/v1/firewall/group-usage/[connectionId]', () => {
  it.each([
    ['a vDC tenant', () => h.iaasDenied.mockResolvedValue(new Response('{}', { status: 404 })), 404],
    ['a connection of another tenant', () => h.ownership.mockResolvedValue(new Response('{}', { status: 404 })), 404],
    ['a user without node.view', () => h.permission.mockResolvedValue(new Response('{}', { status: 403 })), 403],
  ])('refuses %s and asks Proxmox nothing', async (_who, deny, status) => {
    deny()

    const res = await get()

    expect(res.status).toBe(status)
    expect(h.pveFetch).not.toHaveBeenCalled()
    expect(h.orchGet).not.toHaveBeenCalled()
  })

  it('lists the guests carrying each group with one rules call per guest, a template left out', async () => {
    const list = [...guests(4), { vmid: 900, node: 'pve1', type: 'qemu' as const, template: 1 }]
    onPve(list)
    const stats = rules(vmid => (vmid === 100 || vmid === 102 ? [{ type: 'group', action: 'web' }] : [{ type: 'in', action: 'ACCEPT' }]))

    const res = await get()
    const body = await readJson<any>(res)

    expect(res.status).toBe(200)
    expect(stats.calls).toBe(4)
    expect(body).toMatchObject({ total: 4, measured: 4, unread: 0, partial: false, computing: false })
    expect(body.groups).toEqual({
      web: [{ type: 'qemu', vmid: '100', node: 'pve1', name: 'vm100' }, { type: 'qemu', vmid: '102', node: 'pve3', name: 'vm102' }],
    })
  })

  it('never has more than 4 calls in flight nor 2 per node, and asks nothing again inside the cache', async () => {
    onPve(guests(60, ['pve1', 'pve2']))
    const stats = rules(() => [])

    await get()
    expect(stats.calls).toBe(60)
    expect(stats.maxInFlight).toBeLessThanOrEqual(4)
    expect(stats.maxPerNode).toBeLessThanOrEqual(2)

    await get()
    await get({ refresh: '1' })
    expect(stats.calls).toBe(60)
  })

  it('reads 200 guests for the tab and says the rest is unread; every guest for the check before a deletion', async () => {
    onPve(guests(230))
    const stats = rules(() => [], 0)

    const tab = await readJson<any>(await get())
    expect(stats.calls).toBe(200)
    expect(tab).toMatchObject({ total: 230, measured: 200, unread: 30, partial: true })

    const check = await readJson<any>(await get({ all: '1' }))
    expect(stats.calls).toBe(230)
    expect(check).toMatchObject({ measured: 230, unread: 0, partial: false })
  })

  it('leaves the guests of an offline node unread, without a call', async () => {
    onPve(guests(6, ['pve1', 'pve2']), ['pve2'])
    const stats = rules(() => [])

    const body = await readJson<any>(await get({ all: '1' }))

    expect(stats.calls).toBe(3)
    expect(body).toMatchObject({ measured: 3, unread: 3, partial: true })
  })

  it('reads the guests again after the micro-segmentation engine wrote, told by its status alone', async () => {
    onPve(guests(3))
    const stats = rules(() => [])
    const status = (startedAt: string, writes: number) => ({ engine: { last_runs: { apply: { started_at: startedAt, status: 'done', writes }, log: { started_at: 'every minute', status: 'done', writes: 0 } } } })
    h.orchFetch.mockResolvedValue(status('t1', 5))

    await get()
    await get()
    expect(stats.calls).toBe(3)
    expect(h.orchFetch).toHaveBeenCalledWith('/microseg/conn-1/status')

    h.orchFetch.mockResolvedValue(status('t2', 2))
    await get()
    expect(stats.calls).toBe(6)
  })

  it('marks the runs that write guest rules and wrote or still run, not the IP, light and log passes', () => {
    expect(engineWritesMark({ engine: { last_runs: {
      apply: { started_at: 'a', status: 'done', writes: 5 }, full: { started_at: 'f', status: 'running', writes: 0 },
      targeted: { started_at: 't', status: 'done', writes: 2 }, remove: { started_at: 'r', status: 'done', writes: 0 },
      ips: { started_at: 'i', status: 'done', writes: 9 }, light: { started_at: 'x', status: 'done', writes: 3 },
      log: { started_at: 'l', status: 'running', writes: 0 }, plan: { started_at: 'p', status: 'done', writes: 0 },
    } } })).toBe('apply@a:done:5|full@f:running:0|targeted@t:done:2')
    expect(engineWritesMark({ engine: { last_runs: {} } })).toBe('')
    expect(engineWritesMark({})).toBeNull()
    expect(engineWritesMark(null)).toBeNull()
  })

  it('does not read the guests again after a pass that only wrote IP sets', async () => {
    onPve(guests(3))
    const stats = rules(() => [])
    const status = (ipsAt: string) => ({ engine: { last_runs: { apply: { started_at: 't1', status: 'done', writes: 5 }, ips: { started_at: ipsAt, status: 'done', writes: 4 } } } })
    h.orchFetch.mockResolvedValue(status('i1'))
    await get()
    h.orchFetch.mockResolvedValue(status('i2'))
    await get()

    expect(stats.calls).toBe(3)
  })

  it('falls back to Proxmox when the orchestrator is unavailable, and answers 500 when the guest list fails', async () => {
    const list = guests(2)
    const nodes = [{ type: 'node', node: 'pve1', status: 'online' }, { type: 'node', node: 'pve2', status: 'online' }]
    h.orchGet.mockRejectedValue(Object.assign(new Error('down'), { code: 'ORCHESTRATOR_UNAVAILABLE' }))
    h.pveFetch.mockImplementation(async (_conn: unknown, path: string) => {
      if (path === '/cluster/resources') return [...nodes, ...list]
      if (/\/firewall\/rules$/.test(path)) return [{ type: 'group', action: 'base' }]
      throw new Error(`unexpected PVE call ${path}`)
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const body = await readJson<any>(await get())
    expect(body.groups.base).toHaveLength(2)

    resetGroupUsage()
    h.pveFetch.mockRejectedValue(new Error('pve down'))
    const failed = await get()
    expect(failed.status).toBe(500)
  })
})
