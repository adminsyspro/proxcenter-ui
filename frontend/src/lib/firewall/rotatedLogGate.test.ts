import { describe, it, expect, beforeEach } from 'vitest'

import { fwLine, pveFirewallLog } from '@/__tests__/setup/pveFirewallLog'

import { ROTATED_COOLDOWN_MS, gateRotatedReads, resetRotatedLogGate } from './rotatedLogGate'

import type { LogPage, LogPageQuery, LogPageReader } from './logWindow'

// Yesterday's file holds one line every 10 minutes; the current file opens at ROTATED.
const ROTATED = 1_792_800_000
const UNTIL = ROTATED - 1
const yesterday = Array.from({ length: 144 }, (_, i) => fwLine(ROTATED - 86_400 + i * 600, 7))
const today = [fwLine(ROTATED + 60)]

const NODE = { node: 'c1/pve2', log: '/firewall/nodes/c1/pve2/log' }
const GUEST = { node: 'c1/pve2', log: '/firewall/vms/c1/pve2/qemu/101/log' }

/** A reader whose rotated reads wait for `release()`, like a slow pvedaemon. */
function slowLog() {
  const log = pveFirewallLog([yesterday, today])
  const waiting: (() => void)[] = []
  const read: LogPageReader & { calls: LogPageQuery[] } = Object.assign(
    (q: LogPageQuery) => (q.since === undefined ? log(q) : new Promise<LogPage>(res => waiting.push(() => res(log(q))))),
    { calls: log.calls },
  )

  return { read, release: () => waiting.splice(0).forEach(go => go()) }
}

const timeout = (): LogPageReader => q => (q.since === undefined ? Promise.resolve({ total: 0, lines: [] }) : Promise.reject(new Error('Orchestrator request timeout')))

beforeEach(() => resetRotatedLogGate())

describe('gateRotatedReads', () => {
  it('passes the current file reads through', async () => {
    const log = pveFirewallLog([yesterday, today])
    const gated = gateRotatedReads(log, NODE, 100)

    await gated({ start: 0, limit: 1 })
    await gated({ start: 0, limit: 1 })
    expect(log.calls).toHaveLength(2)
  })

  it('serves a later window from the rotated read that covered it, without asking PVE again', async () => {
    const log = pveFirewallLog([yesterday, today])
    const gated = gateRotatedReads(log, NODE, 1000)

    const first = await gated({ limit: 0, since: ROTATED - 3600, until: UNTIL })
    const later = await gated({ limit: 0, since: ROTATED - 1800, until: UNTIL })

    expect(first.lines).toHaveLength(6)
    expect(later.lines.map(e => e.t)).toEqual(yesterday.slice(-3))
    expect(later.total).toBe(3)
    expect(log.calls).toHaveLength(1)
  })

  it('reads again once the rotation moved until, or for an older since', async () => {
    const log = pveFirewallLog([yesterday, today])
    const gated = gateRotatedReads(log, NODE, 1000)

    await gated({ limit: 0, since: ROTATED - 1800, until: UNTIL })
    await gated({ limit: 0, since: ROTATED - 3600, until: UNTIL })
    await gated({ limit: 0, since: ROTATED - 1800, until: UNTIL + 86_400 })
    expect(log.calls).toHaveLength(3)
  })

  it('shares a rotated read already running, and refuses another log of the same node meanwhile', async () => {
    const { read, release } = slowLog()
    const gated = gateRotatedReads(read, NODE, 1000)
    const guest = gateRotatedReads(read, GUEST, 1000)

    const first = gated({ limit: 0, since: ROTATED - 3600, until: UNTIL })
    const joined = gated({ limit: 0, since: ROTATED - 3000, until: UNTIL })

    await expect(guest({ limit: 0, since: ROTATED - 3600, until: UNTIL })).rejects.toThrow(/still reading this node's rotated/)
    release()
    expect((await first).lines).toHaveLength(6)
    expect((await joined).lines).toHaveLength(5)
    expect(read.calls).toHaveLength(1)
  })

  it('does not ask a node for its rotated logs again during the cooldown after a failure', async () => {
    let now = 1_000_000
    const read = timeout()
    let calls = 0
    const counted: LogPageReader = q => {
      calls++

      return read(q)
    }
    const gated = gateRotatedReads(counted, NODE, 1000, () => now)
    const guest = gateRotatedReads(counted, GUEST, 1000, () => now)

    await expect(gated({ limit: 0, since: ROTATED - 3600, until: UNTIL })).rejects.toThrow('Orchestrator request timeout')
    await expect(gated({ limit: 0, since: ROTATED - 3600, until: UNTIL })).rejects.toThrow(/^the last read failed, ProxCenter waits 15 min/)
    await expect(guest({ limit: 0, since: ROTATED - 3600, until: UNTIL })).rejects.toThrow(/waits 15 min/)
    expect(calls).toBe(1)

    now += ROTATED_COOLDOWN_MS
    await expect(gated({ limit: 0, since: ROTATED - 3600, until: UNTIL })).rejects.toThrow('Orchestrator request timeout')
    expect(calls).toBe(2)
  })

  it('starts no cooldown on a permission refusal, which costs PVE nothing', async () => {
    let calls = 0
    const denied: LogPageReader = () => {
      calls++

      return Promise.reject(new Error('Orchestrator 403: {"error":"Permission check failed"}'))
    }
    const gated = gateRotatedReads(denied, NODE, 1000)

    await expect(gated({ limit: 0, since: ROTATED - 3600, until: UNTIL })).rejects.toThrow(/403/)
    await expect(gated({ limit: 0, since: ROTATED - 3600, until: UNTIL })).rejects.toThrow(/403/)
    expect(calls).toBe(2)
  })

  it('keeps the newest lines only, and says older ones matched while the window reaches them', async () => {
    const log = pveFirewallLog([yesterday, today])
    const gated = gateRotatedReads(log, NODE, 4)

    const all = await gated({ limit: 0, since: ROTATED - 86_400, until: UNTIL })
    const recent = await gated({ limit: 0, since: ROTATED - 1800, until: UNTIL })

    expect(all.lines.map(e => e.t)).toEqual(yesterday.slice(-4))
    expect(all.total).toBe(144)
    expect(recent.lines).toHaveLength(3)
    expect(recent.total).toBe(3)
  })

  it('leaves out the placeholder PVE answers for an empty window', async () => {
    const log = pveFirewallLog([yesterday, today])
    const gated = gateRotatedReads(log, NODE, 1000)

    expect(await gated({ limit: 0, since: ROTATED + 3600, until: UNTIL })).toEqual({ total: 0, lines: [] })
  })
})
