import { describe, it, expect, vi } from 'vitest'

import { pveFirewallLog } from '@/__tests__/setup/pveFirewallLog'

import { collectFirewallLog, MAX_LOG_ROWS, MAX_SCAN_LINES } from './logs'

import type { FirewallLogSources } from './logs'

// Lab lines (ui#1114): CT 101 on pve1, group r1114 dropping TCP 9999.
const GROUP_9999 = '0 6 GROUP-r1114-IN 15/Oct/2026:22:59:42 +0200 IN=fwbr101i0 OUT=fwbr101i0 PHYSIN=fwln101i0 PHYSOUT=veth101i0 SRC=10.42.0.101 DST=10.42.0.249 PROTO=TCP SPT=44876 DPT=9999 SYN '
const VM_22 = '101 6 veth101i0-IN 15/Oct/2026:22:59:45 +0200 ACCEPT: IN=fwbr101i0 OUT=fwbr101i0 PHYSIN=fwln101i0 PHYSOUT=veth101i0 SRC=10.42.0.101 DST=10.42.0.249 PROTO=TCP SPT=56950 DPT=22 SYN '
const OTHER_GUEST_GROUP = '0 6 GROUP-r1114-IN 15/Oct/2026:22:59:50 +0200 IN=fwbr102i0 OUT=fwbr102i0 PHYSIN=fwln102i0 PHYSOUT=tap102i0 SRC=10.42.0.101 DST=10.42.0.250 PROTO=TCP SPT=1 DPT=9999 SYN '
const OTHER_GROUP = '0 6 GROUP-web-IN 15/Oct/2026:22:59:51 +0200 IN=fwbr101i0 OUT=fwbr101i0 PHYSIN=fwln101i0 PHYSOUT=veth101i0 SRC=10.42.0.101 DST=10.42.0.249 PROTO=TCP SPT=2 DPT=80 SYN '
const LOGGER = '0 5 - 15/Oct/2026:22:59:28 +0200 starting pvefw logger'
// A cluster rule on pve1's host firewall (TCP 9997 DROP), as logged on the lab.
const HOST_9997 = '0 6 PVEFW-HOST-IN 15/Oct/2026:22:59:55 +0200 DROP: IN=vmbr0 PHYSIN=nic0 SRC=10.42.0.102 DST=10.42.0.101 PROTO=TCP SPT=52374 DPT=9997 SYN '

// The current file of a node, as PVE pages it.
const file = (...lines: string[]) => pveFirewallLog([lines])
const refused = (message: string) => () => { throw new Error(message) }

function sources(over: Partial<FirewallLogSources> = {}): FirewallLogSources {
  return {
    vmLog: vi.fn(() => file(VM_22)),
    nodeLog: vi.fn(() => file(LOGGER, GROUP_9999, VM_22, OTHER_GUEST_GROUP, OTHER_GROUP)),
    nodes: vi.fn(async () => [{ node: 'pve1', status: 'online' }]),
    groups: vi.fn(async () => [{ group: 'r1114', rules: [
      { pos: 0, type: 'in', action: 'ACCEPT', proto: 'icmp', log: 'info', enable: 1 },
      { pos: 1, type: 'in', action: 'DROP', proto: 'tcp', dport: '9999', log: 'info', enable: 1 },
    ] }]),
    vmRules: vi.fn(async () => [
      { pos: 0, type: 'group', action: 'r1114', enable: 1 },
      { pos: 1, type: 'in', action: 'ACCEPT', proto: 'tcp', dport: '22', log: 'info', enable: 1 },
    ]),
    addressBook: vi.fn(async () => ({ aliases: [], ipsets: [] })),
    ...over,
  }
}

// From the logger start on: the current file covers the window.
const WINDOW = { since: 1792097968 }

describe('collectFirewallLog, guest scope', () => {
  const scope = { kind: 'vm' as const, node: 'pve1', vmType: 'lxc' as const, vmid: 101 }

  it('adds the node log group hits on the guest interfaces to the guest log, newest first', async () => {
    const res = await collectFirewallLog(scope, WINDOW, sources())

    expect(res.rows.map(r => [r.origin, r.action, r.dport])).toEqual([
      ['group', undefined, 80],    // group "web": no rules loaded for it, stays unknown
      ['guest', 'ACCEPT', 22],
      ['group', 'DROP', 9999],
    ])
    expect(res.rows[2]).toMatchObject({ group: 'r1114', vmid: 101, actionInferred: true, node: 'pve1' })
    expect(res.rows[1]).toMatchObject({ vmid: 101, actionInferred: false })
    expect(res.warnings).toEqual([])
  })

  it('keeps the guest log and warns when the node log is refused (no Sys.Syslog)', async () => {
    const res = await collectFirewallLog(scope, WINDOW, sources({
      nodeLog: vi.fn(() => refused('Orchestrator 500: {"error":"failed to get firewall log: 403 Permission check failed (/nodes/pve1, Sys.Syslog)"}')),
    }))

    expect(res.rows).toHaveLength(1)
    expect(res.warnings).toEqual([{ node: 'pve1', kind: 'permission', message: 'failed to get firewall log: 403 Permission check failed (/nodes/pve1, Sys.Syslog)' }])
  })

  it('fails when the guest log itself fails', async () => {
    await expect(collectFirewallLog(scope, WINDOW, sources({ vmLog: vi.fn(() => refused('boom')) }))).rejects.toThrow('boom')
  })

  it('tells which rule wrote each line: the group rule for a group hit, the guest rule otherwise', async () => {
    const res = await collectFirewallLog(scope, WINDOW, sources())
    const byPort = Object.fromEntries(res.rows.map(r => [r.dport, r.ruleCandidates]))

    expect(byPort[9999]).toEqual([1])
    expect(byPort[22]).toEqual([1])
    expect(byPort[80]).toBeUndefined() // group "web" has no rules loaded
  })

  it('reads the guest rules once, and the group rules only when a group line shows up', async () => {
    const s = sources({ nodeLog: vi.fn(() => file(LOGGER)) })

    await collectFirewallLog(scope, WINDOW, s)
    expect(s.vmRules).toHaveBeenCalledTimes(1)
    expect(s.vmRules).toHaveBeenCalledWith('pve1', 'lxc', 101)
    expect(s.groups).not.toHaveBeenCalled()
  })
})

describe('collectFirewallLog, reading the logs (ui#1190)', () => {
  const scope = { kind: 'vm' as const, node: 'pve1', vmType: 'lxc' as const, vmid: 101 }
  // An hour before the logger start: the window reaches into the rotated logs.
  const EARLIER = { since: WINDOW.since - 3600 }
  const timeout = () => Promise.reject(new Error('Orchestrator request timeout'))

  it('dates the current file by the node log, so a guest window inside it never scans the rotated logs', async () => {
    const own = pveFirewallLog([[VM_22]], 101)
    const node = file(LOGGER, VM_22)

    await collectFirewallLog(scope, WINDOW, sources({ vmLog: vi.fn(() => own), nodeLog: vi.fn(() => node) }))
    expect([...own.calls, ...node.calls].some(q => q.since !== undefined)).toBe(false)
    // The node head is read once, for its lines and for the file date.
    expect(node.calls.filter(q => q.start === 0 && q.limit === 1)).toHaveLength(1)
  })

  it('dates the file by the guest log when the node log is refused', async () => {
    const own = pveFirewallLog([[VM_22]], 101)
    // From the guest's first line on, 17 s after the logger start.
    const res = await collectFirewallLog(scope, { since: WINDOW.since + 17 }, sources({ vmLog: vi.fn(() => own), nodeLog: vi.fn(() => refused('403 Sys.Syslog')) }))

    expect(own.calls.some(q => q.since !== undefined)).toBe(false)
    expect(res.rows).toHaveLength(1)
  })

  it('keeps the current file and warns once per node when its rotated logs time out', async () => {
    const own = file(VM_22)
    const node = file(LOGGER, GROUP_9999)
    const slow = (log: typeof own) => vi.fn(() => (q: { since?: number }) => (q.since ? timeout() : log(q as never)))
    const res = await collectFirewallLog(scope, EARLIER, sources({ vmLog: slow(own), nodeLog: slow(node) }))

    expect(res.rows.map(r => r.dport)).toEqual([22, 9999])
    expect(res.warnings).toEqual([{ node: 'pve1', kind: 'partial', message: 'Orchestrator request timeout', missingBefore: WINDOW.since * 1000 }])
  })
})

describe('collectFirewallLog, group scope', () => {
  const scope = { kind: 'group' as const, group: 'R1114' }

  it('reads every online node and keeps the group lines only, whichever guest', async () => {
    const s = sources({
      nodes: vi.fn(async () => [{ node: 'pve1', status: 'online' }, { node: 'pve2', status: 'online' }, { node: 'pve3', status: 'offline' }]),
      nodeLog: vi.fn((node: string) => (node === 'pve1' ? file(LOGGER, GROUP_9999, VM_22, OTHER_GROUP) : file(LOGGER, OTHER_GUEST_GROUP))),
    })
    const res = await collectFirewallLog(scope, WINDOW, s)

    expect(res.rows.map(r => [r.node, r.vmid, r.action])).toEqual([['pve2', 102, 'DROP'], ['pve1', 101, 'DROP']])
    expect(res.warnings).toEqual([{ node: 'pve3', kind: 'offline', message: 'offline' }])
    expect(s.nodeLog).toHaveBeenCalledTimes(2)
    expect(s.vmLog).not.toHaveBeenCalled()
    expect(s.vmRules).not.toHaveBeenCalled()
  })

  it('parses only the newest lines of a long log, and says so', async () => {
    const old = Array.from({ length: MAX_SCAN_LINES }, () => OTHER_GROUP)
    const res = await collectFirewallLog(scope, WINDOW, sources({ nodeLog: vi.fn(() => file(LOGGER, GROUP_9999, ...old)) }))

    // The only r1114 line is the oldest one, beyond the scan.
    expect(res.rows).toHaveLength(0)
    expect(res.truncated).toBe(true)
  })

  it('caps the rows and says so', async () => {
    const many = Array.from({ length: MAX_LOG_ROWS + 3 }, () => GROUP_9999)
    const res = await collectFirewallLog(scope, WINDOW, sources({ nodeLog: vi.fn(() => file(LOGGER, ...many)) }))

    expect(res.rows).toHaveLength(MAX_LOG_ROWS)
    expect(res.truncated).toBe(true)
  })
})

describe('collectFirewallLog, node scope', () => {
  it('shows the whole node log: host, guest and group lines', async () => {
    const s = sources({ nodeLog: vi.fn(() => file(LOGGER, GROUP_9999, VM_22, HOST_9997)) })
    const res = await collectFirewallLog({ kind: 'node', node: 'pve2' }, WINDOW, s)

    expect(res.rows.map(r => [r.origin, r.action, r.dport, r.vmid])).toEqual([
      ['host', 'DROP', 9997, undefined],
      ['guest', 'ACCEPT', 22, 101],
      ['group', 'DROP', 9999, 101],
    ])
    expect(res.rows.every(r => r.node === 'pve2')).toBe(true)
    expect(s.nodeLog).toHaveBeenCalledWith('pve2')
    expect(s.nodes).not.toHaveBeenCalled()
    expect(s.vmRules).not.toHaveBeenCalled()
  })

  it('fails when the node log itself is refused', async () => {
    const s = sources({ nodeLog: vi.fn(() => refused('403 Permission check failed (/nodes/pve2, Sys.Syslog)')) })

    await expect(collectFirewallLog({ kind: 'node', node: 'pve2' }, WINDOW, s)).rejects.toThrow('Sys.Syslog')
  })
})

describe('collectFirewallLog, cluster scope', () => {
  it('keeps the host chain lines of every online node, never a guest or group line', async () => {
    const s = sources({
      nodes: vi.fn(async () => [{ node: 'pve1', status: 'online' }, { node: 'pve2', status: 'online' }]),
      nodeLog: vi.fn((node: string) => (node === 'pve1' ? file(LOGGER, GROUP_9999, VM_22, HOST_9997) : file(LOGGER))),
    })
    const res = await collectFirewallLog({ kind: 'cluster' }, WINDOW, s)

    expect(res.rows.map(r => [r.node, r.origin, r.action, r.dport, r.direction])).toEqual([['pve1', 'host', 'DROP', 9997, 'in']])
    expect(s.nodeLog).toHaveBeenCalledTimes(2)
    expect(s.groups).not.toHaveBeenCalled()
  })

  it('warns per node it could not read', async () => {
    const s = sources({
      nodes: vi.fn(async () => [{ node: 'pve1', status: 'online' }, { node: 'pve2', status: 'online' }]),
      nodeLog: vi.fn((node: string) => (node === 'pve2' ? refused('403 Permission check failed (/nodes/pve2, Sys.Syslog)') : file(LOGGER, HOST_9997))),
    })
    const res = await collectFirewallLog({ kind: 'cluster' }, WINDOW, s)

    expect(res.rows).toHaveLength(1)
    expect(res.warnings).toEqual([{ node: 'pve2', kind: 'permission', message: '403 Permission check failed (/nodes/pve2, Sys.Syslog)' }])
  })
})
