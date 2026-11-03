/**
 * GET /api/v1/firewall/coverage/[connectionId] (UA44): the Dashboard's guest firewall coverage, computed on the
 * server once per connection. The guarantees on the Proxmox load are what is tested here: one options call per
 * guest at most, none for a guest whose NICs carry no firewall flag, never more than 4 in flight nor 2 per node,
 * 200 guests at most, and the cache in front of all of it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const h = vi.hoisted(() => ({
  ownership: vi.fn<(id: string) => Promise<Response | null>>(),
  permission: vi.fn<(...a: any[]) => Promise<Response | null>>(),
  infra: vi.fn<(...a: any[]) => Promise<any>>(),
  orchGet: vi.fn<(path: string) => Promise<any>>(),
  pveFetch: vi.fn<(...a: any[]) => Promise<any>>(),
  nic: new Map<string, boolean>(),
}))

vi.mock('@/lib/tenant', () => ({
  verifyConnectionOwnership: (id: string) => h.ownership(id),
  getCurrentTenantId: async () => 'default',
}))
vi.mock('@/lib/tenant/infraScope', () => ({ getTenantInfrastructureScope: (...a: any[]) => h.infra(...a) }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: any[]) => h.permission(...a),
  PERMISSIONS: { NODE_VIEW: 'node.view' },
}))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: async () => ({ id: 'conn-1' }) }))
vi.mock('@/lib/orchestrator/client', () => ({ getOrchestratorClient: () => ({ get: (p: string) => h.orchGet(p) }) }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: any[]) => h.pveFetch(...a) }))
vi.mock('@/lib/inventory/guestDiskTotals', () => ({
  peekGuestNicFirewall: (_conn: string, type: string, vmid: string) => h.nic.get(`${type}/${vmid}`),
}))

import { setCachedInventory, invalidateInventoryCache } from '@/lib/cache/inventoryCache'
import { resetGuestCoverage } from '@/lib/firewall/guestCoverage'

import { GET } from './route'

type Guest = { vmid: number; node: string; type: 'qemu' | 'lxc'; template?: number }

function guests(count: number, nodes = ['pve1', 'pve2', 'pve3']): Guest[] {
  return Array.from({ length: count }, (_, i) => ({ vmid: 100 + i, node: nodes[i % nodes.length], type: 'qemu' }))
}

/** The connection's guests as /cluster/resources gives them (cold inventory). */
function onPve(list: Guest[]) {
  h.pveFetch.mockImplementation(async (_conn: unknown, path: string) => {
    if (path === '/cluster/resources?type=vm') return list
    throw new Error(`unexpected PVE call ${path}`)
  })
}

/** Every guest has a NIC with firewall=1 in the inventory's config cache. */
function nicOn(list: Guest[]) {
  for (const g of list) h.nic.set(`${g.type}/${g.vmid}`, true)
}

/** The options answer: enable for the listed vmids; counts the calls in flight, overall and per node. */
function options(enabled: (vmid: number) => boolean, delayMs = 5) {
  const stats = { calls: 0, inFlight: 0, maxInFlight: 0, perNode: new Map<string, number>(), maxPerNode: 0 }
  h.orchGet.mockImplementation(async (path: string) => {
    const m = /^\/firewall\/vms\/conn-1\/([^/]+)\/(qemu|lxc)\/(\d+)\/options$/.exec(path)
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

    return { data: { enable: enabled(Number(m[3])) ? 1 : 0 } }
  })

  return stats
}

const get = (searchParams?: Record<string, string>) => callRoute(GET, { params: { connectionId: 'conn-1' }, searchParams })

beforeEach(() => {
  vi.clearAllMocks()
  resetGuestCoverage()
  invalidateInventoryCache()
  h.nic.clear()
  h.ownership.mockResolvedValue(null)
  h.permission.mockResolvedValue(null)
  h.infra.mockResolvedValue({ kind: 'provider' })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GET /api/v1/firewall/coverage/[connectionId]: access', () => {
  it('answers the ownership refusal and asks nothing', async () => {
    h.ownership.mockResolvedValue(new Response(JSON.stringify({ error: 'no' }), { status: 404 }))

    const res = await get()

    expect(res.status).toBe(404)
    expect(h.pveFetch).not.toHaveBeenCalled()
    expect(h.orchGet).not.toHaveBeenCalled()
  })

  it('checks node.view on the connection', async () => {
    h.permission.mockResolvedValue(new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }))

    const res = await get()

    expect(res.status).toBe(403)
    expect(h.permission).toHaveBeenCalledWith('node.view', 'connection', 'conn-1')
    expect(h.orchGet).not.toHaveBeenCalled()
  })

  it('refuses a vDC tenant: a connection-wide count is not for it', async () => {
    h.infra.mockResolvedValue({ kind: 'iaas' })

    const res = await get()

    expect(res.status).toBe(403)
    expect(h.pveFetch).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/firewall/coverage/[connectionId]: figures and load', () => {
  it('counts a guest as filtered only with its options and a NIC on, with no call for a guest whose NICs have no flag', async () => {
    const list: Guest[] = [
      { vmid: 101, node: 'pve1', type: 'qemu' },
      { vmid: 102, node: 'pve1', type: 'qemu' },
      { vmid: 103, node: 'pve2', type: 'lxc' },
      { vmid: 104, node: 'pve2', type: 'qemu' },
      { vmid: 900, node: 'pve2', type: 'qemu', template: 1 },
    ]
    onPve(list)
    h.nic.set('qemu/101', true)
    h.nic.set('qemu/102', true)
    h.nic.set('lxc/103', false)
    // qemu/104: the inventory has not read its config yet.
    const stats = options(vmid => vmid !== 102)

    const res = await get()
    const body = await readJson<any>(res)

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ total: 4, measured: 4, enabled: 1, disabled: 2, unknown: 1, sampled: false, partial: true, computing: false })
    expect(typeof body.computedAt).toBe('string')
    // 103 needed no call; no rules call, no config call ever.
    expect(stats.calls).toBe(3)
    expect(h.orchGet.mock.calls.every(([p]) => String(p).endsWith('/options'))).toBe(true)
    expect(h.pveFetch).toHaveBeenCalledTimes(1)
  })

  it('reads the guest list from the inventory cache when it is warm: no Proxmox call but the options', async () => {
    setCachedInventory({
      clusters: [{ id: 'conn-1', nodes: [{ node: 'pve1', guests: [{ vmid: 101, type: 'qemu', node: 'pve1' }, { vmid: 102, type: 'lxc', node: 'pve1' }] }] }],
      pbsServers: [], externalHypervisors: [], stats: {} as any,
    }, 'default', null)
    h.nic.set('qemu/101', true)
    h.nic.set('lxc/102', true)
    options(() => true)

    const body = await readJson<any>(await get())

    expect(body).toMatchObject({ total: 2, enabled: 2, partial: false })
    expect(h.pveFetch).not.toHaveBeenCalled()
  })

  it('never has more than 4 options calls in flight, nor more than 2 on one node', async () => {
    const list = guests(36)
    onPve(list)
    nicOn(list)
    const stats = options(() => true)

    const body = await readJson<any>(await get())

    expect(body.enabled).toBe(36)
    expect(stats.calls).toBe(36)
    expect(stats.maxInFlight).toBeLessThanOrEqual(4)
    expect(stats.maxPerNode).toBeLessThanOrEqual(2)
    // Spread over three nodes, the pool is used in full.
    expect(stats.maxInFlight).toBe(4)
  })

  it('holds 2 at a time when every guest sits on one node', async () => {
    const list = guests(10, ['pve1'])
    onPve(list)
    nicOn(list)
    const stats = options(() => true)

    await get()

    expect(stats.maxInFlight).toBe(2)
  })

  it('asks 200 guests at most and says the figures are a sample', async () => {
    const list = guests(450)
    onPve(list)
    nicOn(list)
    const stats = options(() => true, 0)

    const body = await readJson<any>(await get())

    expect(stats.calls).toBe(200)
    expect(body).toMatchObject({ total: 450, measured: 200, enabled: 200, sampled: true, partial: true })
  })
})

describe('GET /api/v1/firewall/coverage/[connectionId]: cache', () => {
  it('serves the same guest list from the cache, with no options call', async () => {
    const list = guests(6)
    onPve(list)
    nicOn(list)
    const stats = options(() => true)

    const first = await readJson<any>(await get())
    const second = await readJson<any>(await get())

    expect(stats.calls).toBe(6)
    expect(second.computedAt).toBe(first.computedAt)
  })

  it('computes again when the guest list changed', async () => {
    const list = guests(6)
    onPve(list)
    nicOn(list)
    const stats = options(() => true)
    await get()

    const grown = guests(7)
    onPve(grown)
    nicOn(grown)
    const body = await readJson<any>(await get())

    expect(stats.calls).toBe(13)
    expect(body.total).toBe(7)
  })

  it('computes again past 10 minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const list = guests(3)
    onPve(list)
    nicOn(list)
    const stats = options(() => true, 0)
    await get()

    vi.setSystemTime(Date.now() + 10 * 60_000 + 1)
    await get()

    expect(stats.calls).toBe(6)
  })

  it('takes a forced refresh only 30 s after the last figures', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const list = guests(3)
    onPve(list)
    nicOn(list)
    const stats = options(() => true, 0)
    await get()

    await get({ refresh: '1' })
    expect(stats.calls).toBe(3)

    vi.setSystemTime(Date.now() + 30_001)
    await get({ refresh: '1' })
    expect(stats.calls).toBe(6)
  })

  it('runs one computation for concurrent viewers', async () => {
    const list = guests(8)
    onPve(list)
    nicOn(list)
    const stats = options(() => true)

    const answers = await Promise.all([get(), get(), get()].map(async p => readJson<any>(await p)))

    expect(stats.calls).toBe(8)
    expect(answers.every(a => a.enabled === 8)).toBe(true)
  })

  it('answers 500 when the guest list cannot be read', async () => {
    h.pveFetch.mockRejectedValue(new Error('HTTP 595'))

    const res = await get()

    expect(res.status).toBe(500)
    expect(h.orchGet).not.toHaveBeenCalled()
  })
})
