import { describe, expect, it } from 'vitest'

import type { MicrosegEvent, MicrosegSuggestion } from '@/lib/microseg/types'

import { eventOfFlow, flowTrafficSeries } from './observedFlowModel'

const traffic = (buckets: { at: string; zone: string; src_zone: string; verdict: string; hits: number }[]) => ({
  step: 3600, from: '2026-11-03T12:00:00Z', to: '2026-11-04T12:00:00Z', buckets,
})

describe('flowTrafficSeries', () => {
  it('keeps the buckets from the source zone into the destination zone with the verdict, case ignored', () => {
    const s = flowTrafficSeries(traffic([
      { at: '2026-11-03T12:00:00Z', zone: 'DB', src_zone: 'web', verdict: 'blocked', hits: 4 },
      { at: '2026-11-03T12:00:00Z', zone: 'db', src_zone: 'Web', verdict: 'blocked', hits: 1 },
      { at: '2026-11-04T11:00:00Z', zone: 'db', src_zone: 'web', verdict: 'blocked', hits: 2 },
      { at: '2026-11-04T11:00:00Z', zone: 'db', src_zone: 'web', verdict: 'would_block', hits: 9 },
      { at: '2026-11-04T11:00:00Z', zone: 'db', src_zone: 'app', verdict: 'blocked', hits: 9 },
      { at: '2026-11-04T11:00:00Z', zone: 'web', src_zone: 'db', verdict: 'blocked', hits: 9 },
      { at: '2026-11-03T11:00:00Z', zone: 'db', src_zone: 'web', verdict: 'blocked', hits: 9 },
    ]), 'db', 'web', 'blocked')
    expect(s).toHaveLength(24)
    expect(s[0]).toBe(5)
    expect(s[23]).toBe(2)
    expect(s.reduce((a, b) => a + b, 0)).toBe(7)
  })

  it('reads a zone-less source as the empty source zone', () => {
    const s = flowTrafficSeries(traffic([{ at: '2026-11-03T13:00:00Z', zone: 'db', src_zone: '', verdict: 'would_block', hits: 3 }]), 'db', '', 'would_block')
    expect(s[1]).toBe(3)
  })
})

describe('eventOfFlow', () => {
  const s: MicrosegSuggestion = {
    id: 's', policy_id: 'p', kind: 'would_block', src_key: 'k', src_ip: '', src_zone_id: 'zw', dst_ip: '10.0.0.9', dst_zone_id: 'zd',
    proto: 'tcp', dport: '443', hits: 1, first_seen: '', last_seen: '', status: 'pending',
  }
  const e = (over: Partial<MicrosegEvent> = {}): MicrosegEvent => ({
    seq: 1, ts: '', node: 'n', vmid: 1, type: 'lxc', guest: 'g', zone: 'db', src_zone: 'web', src_ip: '10.0.0.5', dst_ip: '10.0.0.9',
    proto: 'TCP', dport: 443, verdict: 'would_block', ...over,
  })

  it('matches the verdict, protocol, port, destination zone and source zone', () => {
    expect(eventOfFlow(e(), s, 'web', 'db')).toBe(true)
    expect(eventOfFlow(e({ dport: '443' }), s, 'Web', 'DB')).toBe(true)
    expect(eventOfFlow(e({ verdict: 'blocked' }), s, 'web', 'db')).toBe(false)
    expect(eventOfFlow(e({ proto: 'udp' }), s, 'web', 'db')).toBe(false)
    expect(eventOfFlow(e({ dport: 4430 }), s, 'web', 'db')).toBe(false)
    expect(eventOfFlow(e({ zone: 'app' }), s, 'web', 'db')).toBe(false)
    expect(eventOfFlow(e({ src_zone: 'app' }), s, 'web', 'db')).toBe(false)
  })

  it('matches a zone-less source by its address', () => {
    const z = { ...s, src_zone_id: '', src_ip: '192.168.1.50' }
    expect(eventOfFlow(e({ src_zone: '', src_ip: '192.168.1.50' }), z, '', 'db')).toBe(true)
    expect(eventOfFlow(e({ src_zone: '', src_ip: '192.168.1.51' }), z, '', 'db')).toBe(false)
    expect(eventOfFlow(e({ src_zone: 'web', src_ip: '192.168.1.50' }), z, '', 'db')).toBe(false)
  })
})
