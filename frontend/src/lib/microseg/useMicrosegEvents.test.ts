import { describe, expect, it } from 'vitest'

import type { MicrosegEvent, MicrosegEventList } from './types'
import { EVENTS_LIMIT, mergeFresh } from './useMicrosegEvents'

const ev = (second: number): MicrosegEvent => ({
  seq: second, ts: new Date(Date.UTC(2026, 10, 3, 10, 0, second)).toISOString(), node: 'pve1', vmid: 101, type: 'qemu', guest: 'g', zone: 'web', src_zone: '',
  src_ip: '10.0.0.1', dst_ip: '10.0.0.2', proto: 'tcp', dport: 22, verdict: 'blocked',
})

const list = (seconds: number[], truncated = false): MicrosegEventList => {
  const events = seconds.map(ev)

  return { events, truncated, oldest: events.length ? events[events.length - 1].ts : null }
}

describe('mergeFresh', () => {
  it('takes the page as it is when nothing older was loaded', () => {
    const page = list([30, 20, 10], true)

    expect(mergeFresh(null, 'k', page)).toEqual({ key: 'k', rows: page.events, loadedOlder: false, more: true, truncated: true })
    expect(mergeFresh(null, 'k', list([30]))).toMatchObject({ more: false, truncated: false })
    // A full page may have older events behind it even when the orchestrator did not flag it.
    expect(mergeFresh(null, 'k', list(Array.from({ length: EVENTS_LIMIT }, (_, i) => 500 - i)))).toMatchObject({ more: true, truncated: false })
  })

  it('keeps the loaded older pages under a refreshed newest page, without a gap or a duplicate', () => {
    const before = { key: 'k', rows: list([30, 20, 10, 5, 4]).events, loadedOlder: true, more: true, truncated: true }
    // 2 new events, the page now stops at 20: 30, 20 are in the new page, 10..4 stay, the new ones are on top.
    const merged = mergeFresh(before, 'k', list([50, 40, 30, 20], true))

    expect(merged.rows.map(e => Date.parse(e.ts) / 1000 % 60)).toEqual([50, 40, 30, 20, 10, 5, 4])
    expect(merged).toMatchObject({ loadedOlder: true, more: true, truncated: true })
  })

  it('starts again from the page when the filters changed or the ring is no longer truncated', () => {
    const before = { key: 'k', rows: list([30, 20, 10]).events, loadedOlder: true, more: true, truncated: true }

    expect(mergeFresh(before, 'other', list([40, 30], true)).rows).toHaveLength(2)
    expect(mergeFresh(before, 'k', list([40, 30, 20, 10])).loadedOlder).toBe(false)
  })
})
