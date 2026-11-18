import { describe, expect, it, vi } from 'vitest'

import { GUEST_LIST_SETTLE_MS, isRunAffectedKey, refreshZoneGuestsAfterRun, zoneGuestsUrl } from './runRefresh'

describe('isRunAffectedKey', () => {
  const matches = isRunAffectedKey('c 1')
  const base = '/api/v1/firewall/microseg/c%201'

  it('matches what a finished run can make stale on its connection', () => {
    expect(matches(`${base}/status`)).toBe(true)
    expect(matches(`${base}/drifts`)).toBe(true)
    expect(matches([`${base}/runs`, 11, 0])).toBe(true)
    expect(matches(`${base}/runs/r1`)).toBe(true)
    expect(matches(`${base}/revisions?limit=100`)).toBe(true)
    expect(matches(`${base}/revisions?limit=1#rev-2`)).toBe(true)
    expect(matches('/api/v1/vms?connId=c%201')).toBe(true)
  })

  it('leaves the other keys and the other connections alone', () => {
    expect(matches(`${base}/policy`)).toBe(false)
    expect(matches([`${base}/suggestions`, undefined, 'pending'])).toBe(false)
    expect(matches('/api/v1/firewall/microseg/c2/status')).toBe(false)
    expect(matches('/api/v1/vms?connId=c2')).toBe(false)
    expect(matches(null)).toBe(false)
    expect(matches([42])).toBe(false)
  })

  it('accepts a list of connections', () => {
    const both = isRunAffectedKey(['c1', 'c2'])
    expect(both('/api/v1/firewall/microseg/c1/status')).toBe(true)
    expect(both('/api/v1/firewall/microseg/c2/runs/r1')).toBe(true)
    expect(both('/api/v1/vms?connId=c2')).toBe(true)
    expect(both('/api/v1/firewall/microseg/c3/status')).toBe(false)
    expect(isRunAffectedKey([])('/api/v1/firewall/microseg/c1/status')).toBe(false)
  })

  it('builds the inventory read of the zone members', () => {
    expect(zoneGuestsUrl('a/b')).toBe('/api/v1/vms?connId=a%2Fb')
  })
})

describe('the zone members after a run', () => {
  it('asks each connection for a fresh guest list, reads the members again, and once more later', async () => {
    vi.useFakeTimers()
    try {
      const asked: string[] = []
      const read: Array<(key: unknown) => boolean> = []
      refreshZoneGuestsAfterRun(m => { read.push(m) }, ['c1', 'c 2'], async url => { asked.push(url) })
      expect(asked).toEqual(['/api/v1/vms?connId=c1&refresh=list', '/api/v1/vms?connId=c%202&refresh=list'])
      expect(read).toHaveLength(0)
      await vi.advanceTimersByTimeAsync(0)
      expect(read).toHaveLength(1)
      expect(read[0]('/api/v1/vms?connId=c1')).toBe(true)
      expect(read[0](['/api/v1/vms?connId=c%202', 'x'])).toBe(true)
      expect(read[0]('/api/v1/vms?connId=c3')).toBe(false)
      expect(read[0](`${'/api/v1/firewall/microseg/c1'}/status`)).toBe(false)
      await vi.advanceTimersByTimeAsync(GUEST_LIST_SETTLE_MS)
      expect(read).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reads the members again even when the fresh list is refused, and nothing once cancelled', async () => {
    vi.useFakeTimers()
    try {
      const read: unknown[] = []
      refreshZoneGuestsAfterRun(m => { read.push(m) }, ['c1'], async () => { throw new Error('throttled') })
      await vi.advanceTimersByTimeAsync(0)
      expect(read).toHaveLength(1)

      const later: unknown[] = []
      const cancel = refreshZoneGuestsAfterRun(m => { later.push(m) }, ['c1'], async () => undefined)
      cancel()
      await vi.advanceTimersByTimeAsync(GUEST_LIST_SETTLE_MS + 10)
      expect(later).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
