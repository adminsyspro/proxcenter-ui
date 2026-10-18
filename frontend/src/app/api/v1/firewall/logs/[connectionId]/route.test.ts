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

// The assembly itself (which lines, inference, warnings) is covered by
// lib/firewall/logs.test.ts: here only the wiring of each source.
const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()
const getVMFirewallLogMock = vi.fn<(...args: any[]) => Promise<any>>()
const getNodeFirewallLogMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))
vi.mock('@/lib/firewall/pveDirect', () => ({
  getVMFirewallLog: getVMFirewallLogMock,
  getNodeFirewallLog: getNodeFirewallLogMock,
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

beforeEach(() => {
  resetFirewallRouteMocks()
  pveFetchMock.mockReset()
  getVMFirewallLogMock.mockReset()
  getNodeFirewallLogMock.mockReset()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => vi.useRealTimers())

describe('GET /api/v1/firewall/logs/[connectionId]', () => {
  it('reads the guest log and its node log over the window, limit 0', async () => {
    orchestrator.get.mockImplementation(async (path: string) => {
      if (path.includes('/firewall/vms/')) return { data: [{ n: 1, t: VM_LINE }] }
      if (path.includes('/firewall/nodes/')) return { data: [{ n: 1, t: GROUP_LINE }] }
      if (path.includes('/firewall/groups/')) return { data: [{ group: 'r1114', rules: [{ pos: 0, type: 'in', action: 'DROP', proto: 'tcp', log: 'info', enable: 1 }] }] }

      return { data: [] }
    })

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { params: { connectionId: 'conn-1' }, searchParams: { scope: 'vm', node: 'pve1', vmType: 'lxc', vmid: '101' } })
    const body = await readJson<any>(res)

    expect(res.status).toBe(200)
    expect(orchestrator.get).toHaveBeenCalledWith(`/firewall/vms/conn-1/pve1/lxc/101/log?limit=0&since=${SINCE}`)
    expect(orchestrator.get).toHaveBeenCalledWith(`/firewall/nodes/conn-1/pve1/log?limit=0&since=${SINCE}`)
    expect(body.rows.map((r: any) => [r.origin, r.action, r.dport])).toEqual([['guest', 'ACCEPT', 22], ['group', 'DROP', 9999]])
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('reads every node for a group, and falls back to PVE without an orchestrator', async () => {
    orchestrator.get.mockRejectedValue(unavailable())
    pveFetchMock.mockResolvedValueOnce([{ node: 'pve1', status: 'online' }])
    getNodeFirewallLogMock.mockResolvedValueOnce([{ n: 1, t: GROUP_LINE }])

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { params: { connectionId: 'conn-1' }, searchParams: { scope: 'group', group: 'r1114', window: '86400' } })

    expect(res.status).toBe(200)
    expect(pveFetchMock).toHaveBeenCalledWith(CONN, '/nodes')
    expect(getNodeFirewallLogMock).toHaveBeenCalledWith(CONN, 'pve1', 0, { since: NOW / 1000 - 86400 })
    expect((await readJson<any>(res)).rows).toHaveLength(1)
  })

  it('reads one node log for a node, every node log for the cluster', async () => {
    orchestrator.get.mockResolvedValue({ data: [] })
    pveFetchMock.mockResolvedValue([{ node: 'pve1', status: 'online' }, { node: 'pve2', status: 'online' }])

    const { GET } = handlersOf(await import('./route'))
    let res = await callRoute(GET, { params: { connectionId: 'conn-1' }, searchParams: { scope: 'node', node: 'pve2' } })

    expect(res.status).toBe(200)
    expect(orchestrator.get).toHaveBeenCalledTimes(1)
    expect(orchestrator.get).toHaveBeenCalledWith(`/firewall/nodes/conn-1/pve2/log?limit=0&since=${SINCE}`)
    expect(pveFetchMock).not.toHaveBeenCalled()

    orchestrator.get.mockClear()
    res = await callRoute(GET, { params: { connectionId: 'conn-1' }, searchParams: { scope: 'cluster' } })

    expect(res.status).toBe(200)
    expect(pveFetchMock).toHaveBeenCalledWith(CONN, '/nodes')
    expect(orchestrator.get).toHaveBeenCalledWith(`/firewall/nodes/conn-1/pve1/log?limit=0&since=${SINCE}`)
    expect(orchestrator.get).toHaveBeenCalledWith(`/firewall/nodes/conn-1/pve2/log?limit=0&since=${SINCE}`)
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
