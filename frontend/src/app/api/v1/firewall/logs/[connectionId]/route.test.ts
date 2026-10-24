import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  CONN,
  checkPermissionMock,
  denied,
  getConnectionByIdMock,
  handlersOf,
  installFirewallRouteMocks,
  orchestrator,
  resetFirewallRouteMocks,
  unavailable,
} from '@/__tests__/setup/firewall-route-mocks'
import { callRoute, readJson } from '@/__tests__/setup/route-test'
import { pveFirewallLog } from '@/__tests__/setup/pveFirewallLog'

import type { LogPageReader } from '@/lib/firewall/logWindow'

// The assembly itself (which lines, inference, warnings) is covered by
// lib/firewall/logs.test.ts: here only the wiring of each source.
const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()
const getFirewallLogPageMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))
vi.mock('@/lib/firewall/pveDirect', () => ({
  getFirewallLogPage: getFirewallLogPageMock,
  getSecurityGroups: vi.fn(async () => []),
  getVMRules: vi.fn(async () => []),
  getAliases: vi.fn(async () => []),
  getIPSets: vi.fn(async () => []),
}))

installFirewallRouteMocks()

const NOW = Date.UTC(2026, 9, 15, 21, 0, 0)
const SINCE = NOW / 1000 - 3600
const GROUP_LINE = '0 6 GROUP-r1114-IN 15/Oct/2026:22:59:42 +0200 IN=fwbr101i0 PHYSIN=fwln101i0 PHYSOUT=veth101i0 SRC=10.42.0.101 DST=10.42.0.249 PROTO=TCP SPT=44876 DPT=9999 '
const VM_LINE = '101 6 veth101i0-IN 15/Oct/2026:22:59:45 +0200 ACCEPT: IN=fwbr101i0 PHYSIN=fwln101i0 PHYSOUT=veth101i0 SRC=10.42.0.101 DST=10.42.0.249 PROTO=TCP SPT=56950 DPT=22 '
// The current file opens at 18:00 UTC: the last hour is in it, the last day is not.
const LOGGER = '0 5 - 15/Oct/2026:20:00:00 +0200 starting pvefw logger'
const NODE_FILE = [LOGGER, GROUP_LINE, VM_LINE]

/** The orchestrator log endpoints over a fake PVE log, `{ total, lines }` as with withTotal=1. */
function served(logs: Record<string, LogPageReader>) {
  return async (path: string) => {
    const [route, query] = path.split('?')
    const p = new URLSearchParams(query)
    const num = (k: string) => (p.has(k) ? Number(p.get(k)) : undefined)
    const log = Object.entries(logs).find(([prefix]) => route.startsWith(prefix))?.[1]

    if (!log) return { data: [] }

    return { data: await log({ start: num('start'), limit: Number(p.get('limit')), since: num('since'), until: num('until') }) }
  }
}

const page = (start: number, limit: number) => `start=${start}&limit=${limit}&withTotal=1`

beforeEach(() => {
  resetFirewallRouteMocks()
  pveFetchMock.mockReset()
  getFirewallLogPageMock.mockReset()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => vi.useRealTimers())

describe('GET /api/v1/firewall/logs/[connectionId]', () => {
  it('reads the guest log and its node log from the end of the current file, never with since', async () => {
    const groups = { data: [{ group: 'r1114', rules: [{ pos: 0, type: 'in', action: 'DROP', proto: 'tcp', log: 'info', enable: 1 }] }] }
    const serve = served({
      '/firewall/vms/conn-1/pve1/lxc/101/log': pveFirewallLog([NODE_FILE], 101),
      '/firewall/nodes/conn-1/pve1/log': pveFirewallLog([NODE_FILE]),
    })

    orchestrator.get.mockImplementation(async (path: string) => (path.startsWith('/firewall/groups/') ? groups : serve(path)))

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { params: { connectionId: 'conn-1' }, searchParams: { scope: 'vm', node: 'pve1', vmType: 'lxc', vmid: '101' } })
    const body = await readJson<any>(res)

    expect(res.status).toBe(200)
    expect(orchestrator.get).toHaveBeenCalledWith(`/firewall/vms/conn-1/pve1/lxc/101/log?${page(0, 1)}`, undefined)
    expect(orchestrator.get).toHaveBeenCalledWith(`/firewall/nodes/conn-1/pve1/log?${page(0, 20000)}`, undefined)
    expect(orchestrator.get.mock.calls.some(([path]) => String(path).includes('since='))).toBe(false)
    expect(body.rows.map((r: any) => [r.origin, r.action, r.dport])).toEqual([['guest', 'ACCEPT', 22], ['group', 'DROP', 9999]])
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('reads the rotated logs with the long budget, only before the current file', async () => {
    orchestrator.get.mockImplementation(served({ '/firewall/nodes/conn-1/pve2/log': pveFirewallLog([[GROUP_LINE], NODE_FILE]) }))

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { params: { connectionId: 'conn-1' }, searchParams: { scope: 'node', node: 'pve2', window: '86400' } })

    expect(res.status).toBe(200)
    expect(orchestrator.get).toHaveBeenCalledWith(
      `/firewall/nodes/conn-1/pve2/log?start=0&limit=0&withTotal=1&since=${NOW / 1000 - 86400}&until=${Date.UTC(2026, 9, 15, 18) / 1000 - 1}`,
      25_000,
    )
  })

  it('reads every node for a group, and falls back to PVE without an orchestrator', async () => {
    const log = pveFirewallLog([NODE_FILE])

    orchestrator.get.mockRejectedValue(unavailable())
    pveFetchMock.mockResolvedValueOnce([{ node: 'pve1', status: 'online' }])
    getFirewallLogPageMock.mockImplementation((_conn, _node, q) => log(q))

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { params: { connectionId: 'conn-1' }, searchParams: { scope: 'group', group: 'r1114' } })

    expect(res.status).toBe(200)
    expect(pveFetchMock).toHaveBeenCalledWith(CONN, '/nodes')
    expect(getFirewallLogPageMock).toHaveBeenCalledWith(CONN, 'pve1', { start: 0, limit: 1 })
    expect((await readJson<any>(res)).rows).toHaveLength(1)
  })

  it('reads the guest log page through PVE without an orchestrator', async () => {
    const node = pveFirewallLog([NODE_FILE])
    const guest = pveFirewallLog([NODE_FILE], 101)

    orchestrator.get.mockRejectedValue(unavailable())
    getFirewallLogPageMock.mockImplementation((_conn, _node, q, g) => (g ? guest(q) : node(q)))

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { params: { connectionId: 'conn-1' }, searchParams: { scope: 'vm', node: 'pve1', vmType: 'qemu', vmid: '101' } })

    expect(res.status).toBe(200)
    expect(getFirewallLogPageMock).toHaveBeenCalledWith(CONN, 'pve1', { start: 0, limit: 1 }, { vmType: 'qemu', vmid: 101 })
  })

  it('reads one node log for a node, every node log for the cluster', async () => {
    orchestrator.get.mockImplementation(served({ '/firewall/nodes/': pveFirewallLog([NODE_FILE]) }))
    pveFetchMock.mockResolvedValue([{ node: 'pve1', status: 'online' }, { node: 'pve2', status: 'online' }])

    const { GET } = handlersOf(await import('./route'))
    let res = await callRoute(GET, { params: { connectionId: 'conn-1' }, searchParams: { scope: 'node', node: 'pve2' } })

    expect(res.status).toBe(200)
    // The head, read once for the count and the file date, then the end of the file.
    expect(orchestrator.get.mock.calls.map(([path]) => String(path)).filter(path => path.includes('/log?'))).toEqual([
      `/firewall/nodes/conn-1/pve2/log?${page(0, 1)}`,
      `/firewall/nodes/conn-1/pve2/log?${page(0, 20000)}`,
    ])
    expect(pveFetchMock).not.toHaveBeenCalled()

    orchestrator.get.mockClear()
    res = await callRoute(GET, { params: { connectionId: 'conn-1' }, searchParams: { scope: 'cluster' } })

    expect(res.status).toBe(200)
    expect(pveFetchMock).toHaveBeenCalledWith(CONN, '/nodes')
    expect(orchestrator.get).toHaveBeenCalledWith(`/firewall/nodes/conn-1/pve1/log?${page(0, 20000)}`, undefined)
    expect(orchestrator.get).toHaveBeenCalledWith(`/firewall/nodes/conn-1/pve2/log?${page(0, 20000)}`, undefined)
  })

  it.each([
    [{ scope: 'nope' }],
    [{ scope: 'node', node: '../etc' }],
    [{ scope: 'node' }],
    [{ scope: 'group', group: '../x' }],
    [{ scope: 'vm', node: 'pve1/../../x', vmType: 'lxc', vmid: '1' }],
    [{ scope: 'vm', node: 'pve1', vmType: 'docker', vmid: '1' }],
    [{ scope: 'vm', node: 'pve1', vmType: 'lxc', vmid: 'abc' }],
    [{ scope: 'group', group: 'web', window: String(8 * 24 * 3600) }],
  ])('refuses %o with 400 before any read', async (searchParams) => {
    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { params: { connectionId: 'conn-1' }, searchParams })

    expect(res.status).toBe(400)
    expect(orchestrator.get).not.toHaveBeenCalled()
  })

  it('stops at the permission check', async () => {
    checkPermissionMock.mockResolvedValueOnce(denied(403, 'Forbidden'))

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { params: { connectionId: 'conn-1' }, searchParams: { scope: 'group', group: 'web' } })

    expect(res.status).toBe(403)
    expect(orchestrator.get).not.toHaveBeenCalled()
  })
})
