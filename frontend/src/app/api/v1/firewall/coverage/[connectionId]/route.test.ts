/**
 * GET /api/v1/firewall/coverage/[connectionId] (UA44): the Dashboard's guest firewall coverage, computed on the
 * server once per connection, with one row per guest for the Firewalling and Security Groups tabs. The guarantees on
 * the Proxmox load are what is tested here: one options call per guest, one config call more only for a guest whose
 * options are on and whose NICs the inventory has not read (UA46), never a rules call, never more than 4 in flight
 * nor 2 per node, 200 guests at most, and the cache in front of all of it.
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
  /** Configs Proxmox answers, by type/vmid; absent: a container NIC with firewall=1. */
  configs: new Map<string, Record<string, string>>(),
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
  peekGuestNet: (_conn: string, type: string, vmid: string) => {
    const nic = h.nic.get(`${type}/${vmid}`)
    return nic === undefined ? undefined : { nicFirewall: nic, vlans: nic ? [20] : [] }
  },
  // What the real one does that matters here: the config read is kept, the next peek sees it.
  rememberGuestConfig: (_conn: string, type: string, vmid: string, config: Record<string, string>) => {
    const nicFirewall = Object.entries(config).some(([k, v]) => /^net\d+$/.test(k) && /(^|,)firewall=1(,|$)/.test(v))
    h.nic.set(`${type}/${vmid}`, nicFirewall)
    return { nicFirewall, vlans: nicFirewall ? [20] : [] }
  },
}))

import { setCachedInventory, invalidateInventoryCache } from '@/lib/cache/inventoryCache'
import { forgetGuestCoverage, resetGuestCoverage, sampleGuests } from '@/lib/firewall/guestCoverage'

import { GET } from './route'

type Guest = { vmid: number; node: string; type: 'qemu' | 'lxc'; template?: number }

function guests(count: number, nodes = ['pve1', 'pve2', 'pve3']): Guest[] {
  return Array.from({ length: count }, (_, i) => ({ vmid: 100 + i, node: nodes[i % nodes.length], type: 'qemu' }))
}

/** The connection's guests and nodes as /cluster/resources gives them (cold inventory). */
function onPve(list: Guest[], offlineNodes: string[] = []) {
  const nodes = [...new Set(list.map(g => g.node))].map(node => ({ type: 'node', node, status: offlineNodes.includes(node) ? 'offline' : 'online' }))
  h.pveFetch.mockImplementation(async (_conn: unknown, path: string) => {
    if (path === '/cluster/resources') return [...nodes, ...list]
    const config = /^\/nodes\/[^/]+\/(qemu|lxc)\/(\d+)\/config$/.exec(path)
    if (config) return h.configs.get(`${config[1]}/${config[2]}`) ?? { rootfs: 'local:subvol,size=8G', net0: 'name=eth0,bridge=vmbr0,firewall=1,type=veth' }
    throw new Error(`unexpected PVE call ${path}`)
  })
}

const configCalls = () => h.pveFetch.mock.calls.filter(([, path]) => String(path).endsWith('/config'))

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
  h.configs.clear()
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
  it('counts a guest as filtered only with its options and a NIC on, one options call per guest and nothing else', async () => {
    const list: Guest[] = [
      { vmid: 101, node: 'pve1', type: 'qemu', name: 'web-1', tags: 'zone-web;prod' } as any,
      { vmid: 102, node: 'pve1', type: 'qemu' },
      { vmid: 103, node: 'pve2', type: 'lxc' },
      { vmid: 104, node: 'pve2', type: 'qemu' },
      { vmid: 900, node: 'pve2', type: 'qemu', template: 1 },
    ]
    onPve(list)
    h.nic.set('qemu/101', true)
    h.nic.set('qemu/102', true)
    h.nic.set('lxc/103', false)
    // qemu/104: the inventory has not read its config yet, Proxmox has no firewall on its NIC.
    h.configs.set('qemu/104', { scsi0: 'local:vm-104-disk-0,size=1G', net0: 'virtio=AA:BB:CC:DD:EE:04,bridge=vmbr0' })
    const stats = options(vmid => vmid !== 102)

    const res = await get()
    const body = await readJson<any>(res)

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ total: 4, measured: 4, enabled: 1, disabled: 3, unknown: 0, sampled: false, partial: false, computing: false })
    expect(typeof body.computedAt).toBe('string')
    // One options call per guest, no rules call; one config call, for the one guest the inventory had not read.
    expect(stats.calls).toBe(4)
    expect(h.orchGet.mock.calls.every(([p]) => String(p).endsWith('/options'))).toBe(true)
    expect(configCalls().map(([, p]) => p)).toEqual(['/nodes/pve2/qemu/104/config'])
    expect(configCalls()[0][3]).toEqual({ slowRead: true })
    expect(h.pveFetch).toHaveBeenCalledTimes(2)
    // One row per guest for the Firewalling and Security Groups tabs, without the rules.
    expect(body.guests).toHaveLength(4)
    expect(body.guests[0]).toEqual({
      type: 'lxc', node: 'pve2', vmid: '103', name: 'lxc/103', status: 'unknown', tags: [],
      enabled: false, optionsEnabled: true, nicFirewall: false, options: { enable: 1 }, vlans: [],
    })
    expect(body.guests.find((r: any) => r.vmid === '101')).toMatchObject({ name: 'web-1', tags: ['zone-web', 'prod'], enabled: true, vlans: [20] })
    expect(body.guests.find((r: any) => r.vmid === '104')).toMatchObject({ enabled: false, nicFirewall: false, optionsEnabled: true })
    expect(body.guests.some((r: any) => 'rules' in r)).toBe(false)
  })

  it('serves the new names, states and tags of the same guests from the cache, with no options call', async () => {
    onPve([{ vmid: 101, node: 'pve1', type: 'qemu', name: 'a', tags: 'zone-web' } as any])
    h.nic.set('qemu/101', true)
    const stats = options(() => true)
    await get()

    onPve([{ vmid: 101, node: 'pve1', type: 'qemu', name: 'b', tags: 'zone-db' } as any])
    const body = await readJson<any>(await get())

    expect(stats.calls).toBe(1)
    expect(body.guests[0]).toMatchObject({ name: 'b', tags: ['zone-db'] })
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

describe('GET /api/v1/firewall/coverage/[connectionId]: containers the inventory has not read (UA46)', () => {
  const containers = (count: number) => guests(count).map(g => ({ ...g, type: 'lxc' as const }))

  it('36 containers with their firewall on: 36 options + 36 config calls once, then none for 10 minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const list = containers(36)
    onPve(list)
    const stats = options(() => true, 0)

    const first = await readJson<any>(await get())
    expect(first).toMatchObject({ total: 36, enabled: 36, unknown: 0 })
    expect(stats.calls).toBe(36)
    expect(configCalls()).toHaveLength(36)

    vi.setSystemTime(Date.now() + 9 * 60_000)
    const second = await readJson<any>(await get())
    expect(second).toMatchObject({ enabled: 36, unknown: 0 })
    expect(stats.calls).toBe(36)
    expect(configCalls()).toHaveLength(36)
  })

  it('past the 10 minutes, reads the options again but not the configs it kept', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const list = containers(36)
    onPve(list)
    const stats = options(() => true, 0)
    await get()

    vi.setSystemTime(Date.now() + 10 * 60_000 + 1)
    const body = await readJson<any>(await get())

    expect(body).toMatchObject({ enabled: 36, unknown: 0 })
    expect(stats.calls).toBe(72)
    expect(configCalls()).toHaveLength(36)
  })

  it('a guest written by ProxCenter is read alone: its options, and no config (now kept)', async () => {
    const list = containers(36)
    onPve(list)
    const stats = options(() => true, 0)
    await get()

    forgetGuestCoverage('conn-1', { type: 'lxc', vmid: '105' })
    await get()

    expect(stats.calls).toBe(37)
    expect(configCalls()).toHaveLength(36)
  })

  it('reads no config for a container whose options are off', async () => {
    const list = containers(10)
    onPve(list)
    options(() => false, 0)

    const body = await readJson<any>(await get())

    expect(body).toMatchObject({ disabled: 10, unknown: 0 })
    expect(configCalls()).toHaveLength(0)
  })

  it('keeps the pool with the config calls: 4 in flight at most, 2 per node', async () => {
    const list = containers(36)
    onPve(list)
    let inFlight = 0
    let maxInFlight = 0
    const perNode = new Map<string, number>()
    let maxPerNode = 0
    const enter = async (node: string) => {
      inFlight++
      perNode.set(node, (perNode.get(node) ?? 0) + 1)
      maxInFlight = Math.max(maxInFlight, inFlight)
      maxPerNode = Math.max(maxPerNode, perNode.get(node)!)
      await new Promise(resolve => setTimeout(resolve, 2))
      inFlight--
      perNode.set(node, perNode.get(node)! - 1)
    }
    h.orchGet.mockImplementation(async (path: string) => {
      await enter(path.split('/')[4])
      return { data: { enable: 1 } }
    })
    h.pveFetch.mockImplementation(async (_conn: unknown, path: string) => {
      if (path === '/cluster/resources') return list
      await enter(path.split('/')[2])
      return { rootfs: 'local:subvol,size=8G', net0: 'name=eth0,bridge=vmbr0,firewall=1' }
    })

    const body = await readJson<any>(await get())

    expect(body.enabled).toBe(36)
    expect(maxInFlight).toBeLessThanOrEqual(4)
    expect(maxPerNode).toBeLessThanOrEqual(2)
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

  it('reads only the guest added when the guest list changed, not the others again', async () => {
    const list = guests(6)
    onPve(list)
    nicOn(list)
    const stats = options(() => true)
    await get()

    const grown = guests(7)
    onPve(grown)
    nicOn(grown)
    const body = await readJson<any>(await get())

    expect(stats.calls).toBe(7)
    expect(h.orchGet.mock.calls.at(-1)?.[0]).toBe('/firewall/vms/conn-1/pve1/qemu/106/options')
    expect(body).toMatchObject({ total: 7, enabled: 7 })
  })

  it('reads a guest moved to another node again, alone', async () => {
    onPve([{ vmid: 1, node: 'pve1', type: 'qemu' }, { vmid: 2, node: 'pve1', type: 'qemu' }])
    h.nic.set('qemu/1', true)
    h.nic.set('qemu/2', true)
    const stats = options(() => true)
    await get()

    onPve([{ vmid: 1, node: 'pve1', type: 'qemu' }, { vmid: 2, node: 'pve2', type: 'qemu' }])
    await get()

    expect(stats.calls).toBe(3)
    expect(h.orchGet.mock.calls.at(-1)?.[0]).toBe('/firewall/vms/conn-1/pve2/qemu/2/options')
  })

  it('shows a NIC toggle at once from the inventory cache, with no call', async () => {
    onPve([{ vmid: 1, node: 'pve1', type: 'qemu' }])
    h.nic.set('qemu/1', false)
    const stats = options(() => true)
    expect((await readJson<any>(await get())).enabled).toBe(0)

    h.nic.set('qemu/1', true)
    const body = await readJson<any>(await get())

    expect(stats.calls).toBe(1)
    expect(body.enabled).toBe(1)
  })

  it('reads one guest again after ProxCenter wrote its options, and only that one', async () => {
    const list = guests(5)
    onPve(list)
    nicOn(list)
    let on = false
    const stats = options(vmid => vmid !== 102 || on)
    expect((await readJson<any>(await get())).enabled).toBe(4)

    on = true
    forgetGuestCoverage('conn-1', { type: 'qemu', vmid: 102 })
    const body = await readJson<any>(await get())

    expect(stats.calls).toBe(6)
    expect(body.enabled).toBe(5)
  })

  it('never caches what a read saw before a write made during it', async () => {
    onPve([{ vmid: 1, node: 'pve1', type: 'qemu' }])
    h.nic.set('qemu/1', true)
    let enable = 0
    h.orchGet.mockImplementation(async () => {
      const seen = enable
      // ProxCenter writes the options while this read is in flight.
      forgetGuestCoverage('conn-1', { type: 'qemu', vmid: 1 })
      enable = 1
      return { data: { enable: seen } }
    })
    expect((await readJson<any>(await get())).enabled).toBe(0)

    h.orchGet.mockImplementation(async () => ({ data: { enable } }))
    const body = await readJson<any>(await get())

    expect(h.orchGet).toHaveBeenCalledTimes(2)
    expect(body.enabled).toBe(1)
  })

  it('asks no guest of an offline node, and lists it as unknown', async () => {
    const list: Guest[] = [{ vmid: 1, node: 'pve1', type: 'qemu' }, { vmid: 2, node: 'pve9', type: 'qemu' }]
    onPve(list, ['pve9'])
    nicOn(list)
    const stats = options(() => true)

    const body = await readJson<any>(await get())

    expect(stats.calls).toBe(1)
    expect(body).toMatchObject({ enabled: 1, unknown: 1 })
    expect(body.guests.find((r: any) => r.vmid === '2')).toMatchObject({ enabled: null, options: null })
  })

  it('falls back to Proxmox with the long read budget when the orchestrator is unavailable', async () => {
    onPve([{ vmid: 1, node: 'pve1', type: 'qemu' }])
    h.nic.set('qemu/1', true)
    h.orchGet.mockRejectedValue(Object.assign(new Error('down'), { code: 'ORCHESTRATOR_UNAVAILABLE' }))
    const listing = h.pveFetch.getMockImplementation()!
    h.pveFetch.mockImplementation(async (conn: unknown, path: string, init?: unknown, opts?: unknown) =>
      (path.endsWith('/firewall/options') ? { enable: 1 } : listing(conn, path, init, opts)))
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const body = await readJson<any>(await get())

    expect(body.enabled).toBe(1)
    expect(h.pveFetch).toHaveBeenCalledWith({ id: 'conn-1' }, '/nodes/pve1/qemu/1/firewall/options', {}, { slowRead: true })
  })

  it('stops starting calls once one timed out, and keeps that partial answer', async () => {
    const list = guests(12, ['pve1'])
    onPve(list)
    nicOn(list)
    h.orchGet.mockRejectedValue(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }))

    const body = await readJson<any>(await get())
    expect(h.orchGet.mock.calls.length).toBeLessThanOrEqual(2)
    expect(body).toMatchObject({ total: 12, unknown: 12, partial: true })

    // The unknown guests are not asked again on the next answer (no hammering a slow Proxmox).
    await get()
    expect(h.orchGet.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('reads one guest when one is added above 200 guests: the sample is stable', async () => {
    const list = guests(230)
    onPve(list)
    nicOn(list)
    const stats = options(() => true, 0)
    await get()
    expect(stats.calls).toBe(200)

    // A guest that lands in the sample (found by the same rank as the server's): read alone, the one it pushes out
    // becomes a listed unknown row with no call.
    let vmid = 9000
    while (!sampleGuests([...list, { vmid: vmid, node: 'pve1', type: 'qemu' }].map(x => ({ ...x, vmid: String(x.vmid) })) as any)
      .some(x => x.vmid === String(vmid))) vmid++
    const grown = [...list, { vmid, node: 'pve1', type: 'qemu' } as Guest]
    onPve(grown)
    nicOn(grown)
    const body = await readJson<any>(await get())

    expect(stats.calls).toBe(201)
    expect(body).toMatchObject({ total: 231, measured: 200 })
  })

  it('keeps the time of the figures when an answer made no call', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    onPve([{ vmid: 1, node: 'pve1', type: 'qemu' }])
    h.nic.set('qemu/1', true)
    options(() => true)
    const first = await readJson<any>(await get())

    vi.setSystemTime(Date.now() + 60_000)
    onPve([{ vmid: 1, node: 'pve1', type: 'qemu' }, { vmid: 2, node: 'pve9', type: 'qemu' }], ['pve9'])
    const second = await readJson<any>(await get())

    expect(second.total).toBe(2)
    expect(second.computedAt).toBe(first.computedAt)
  })

  it('lists the guests left out above 200 as unknown, without asking them', async () => {
    const list = guests(230)
    onPve(list)
    nicOn(list)
    const stats = options(() => true, 0)

    const body = await readJson<any>(await get())

    expect(stats.calls).toBe(200)
    expect(body.guests).toHaveLength(230)
    expect(body.guests.filter((r: any) => r.sampledOut)).toHaveLength(30)
    expect(body.guests.filter((r: any) => r.sampledOut).every((r: any) => r.options === null)).toBe(true)
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
