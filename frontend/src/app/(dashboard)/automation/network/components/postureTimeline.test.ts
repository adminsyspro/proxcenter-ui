import { describe, expect, it } from 'vitest'

import type { MicrosegEvent, MicrosegZone } from '@/lib/microseg/types'

import type { PostureGuest } from './dashboardPosture'
import { BUCKET_MS, MAX_BUCKETS, mergeEvents, postureTimeline, type TimelineSeries } from './postureTimeline'

const NOW = Date.parse('2026-11-03T10:02:00Z')
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString()

let seq = 1000
const event = (over: Partial<MicrosegEvent>): MicrosegEvent => ({
  seq: seq--, ts: at(1), node: 'pve1', vmid: 102, type: 'qemu', guest: 'db1', zone: 'db', src_zone: 'web', src_ip: '10.0.0.1', dst_ip: '10.0.0.2',
  proto: 'tcp', dport: 5432, verdict: 'would_block', ...over,
})

const zone = (id: string, name: string): MicrosegZone => ({
  id, policy_id: 'p1', name, label: '', color: '', enforcement: 'guest', vnet_id: '', state: 'observe', isolate_members: false, observe_since: null,
})
const ZONES = [zone('zweb', 'web'), zone('zdb', 'db')]
const GUESTS: PostureGuest[] = [
  { key: 'qemu/101', node: 'pve1', tags: ['zone-web'], vlans: [10], ips: ['10.0.0.1'] },
  { key: 'qemu/102', node: 'pve2', tags: ['zone-db'], vlans: [20], ips: ['10.0.0.2'] },
  { key: 'qemu/104', node: 'pve2', tags: [], vlans: [], ips: ['10.0.0.4'] },
]
const slice = (key: string, kind: TimelineSeries['kind'], color: string, name = ''): TimelineSeries => ({ key, kind, name, color })
const ZONE_SLICES = [slice('zone:zweb', 'zone', '#111111', 'web'), slice('external', 'external', '#616161'), slice('unzoned', 'unzoned', '#9e9e9e')]

const run = (over: Partial<Parameters<typeof postureTimeline>[0]> = {}) => postureTimeline({
  events: [], groupBy: 'zone', verdict: 'all', zones: ZONES, guests: GUESTS, addresses: true, slices: ZONE_SLICES, now: NOW, ...over,
})

describe('postureTimeline: buckets', () => {
  it('counts the events per 5-minute bucket from the oldest one to now, and says the window covered', () => {
    const t = run({ events: [event({ ts: at(1) }), event({ ts: at(2) }), event({ ts: at(12) })] })
    // 10:02 now: buckets 09:50, 09:55, 10:00.
    expect(t.buckets.map(b => [new Date(b.start).toISOString().slice(11, 16), b.total])).toEqual([['09:50', 1], ['09:55', 0], ['10:00', 2]])
    expect(t.buckets.every((b, i) => i === 0 || b.start - t.buckets[i - 1].start === BUCKET_MS)).toBe(true)
    expect(t).toMatchObject({ total: 3, max: 2, windowMinutes: 12 })
  })

  it('draws a day at most, the window still covering the oldest event', () => {
    const t = run({ events: [event({ ts: at(1) }), event({ ts: at(3 * 24 * 60) })] })
    expect(t.buckets).toHaveLength(MAX_BUCKETS)
    expect(t.total).toBe(1)
    expect(t.windowMinutes).toBe(3 * 24 * 60)
  })

  it('has no bucket and no window without an event', () => {
    expect(run()).toEqual({ series: [], buckets: [], max: 0, total: 0, windowMinutes: null })
  })
})

describe('postureTimeline: grouping', () => {
  it('stacks the events per source zone in the donut order and colours, Unzoned and Unknown / External included', () => {
    const t = run({
      events: [
        event({}), event({}),
        event({ src_zone: '', src_ip: '10.0.0.4' }),
        event({ src_zone: '', src_ip: '203.0.113.9' }),
        // A zone renamed since: Other.
        event({ src_zone: 'old-name' }),
      ],
    })
    expect(t.series.map(s => s.key)).toEqual(['zone:zweb', 'external', 'unzoned', 'other'])
    expect(t.series[0].color).toBe('#111111')
    expect(t.buckets.at(-1)!.counts).toEqual({ 'zone:zweb': 2, unzoned: 1, external: 1, other: 1 })
  })

  it('takes every source in no zone for Unknown / External without the guest addresses', () => {
    const t = run({ addresses: false, events: [event({ src_zone: '', src_ip: '10.0.0.4' })] })
    expect(t.buckets.at(-1)!.counts).toEqual({ external: 1 })
  })

  it('folds a group the donut does not show into Other', () => {
    const t = run({ slices: [slice('zone:zweb', 'zone', '#111111', 'web')], events: [event({}), event({ src_zone: 'db' })] })
    expect(t.series.map(s => s.key)).toEqual(['zone:zweb', 'other'])
  })

  it('groups by the VLAN or the node of the guest the event reached, as the donut does', () => {
    const events = [event({ vmid: 102, node: 'pve2' }), event({ vmid: 104, node: 'pve2' }), event({ vmid: 999, node: 'pve3' })]
    const vlan = run({ groupBy: 'vlan', events, slices: [slice('vlan:20', 'vlan', '#222222', '20'), slice('vlan:none', 'novlan', '#64748b'), slice('external', 'external', '#616161')] })
    expect(vlan.buckets.at(-1)!.counts).toEqual({ 'vlan:20': 1, 'vlan:none': 1, external: 1 })
    const node = run({ groupBy: 'node', events, slices: [slice('node:pve2', 'node', '#333333', 'pve2')] })
    expect(node.buckets.at(-1)!.counts).toEqual({ 'node:pve2': 2, other: 1 })
  })
})

describe('postureTimeline: verdict', () => {
  const events = [event({}), event({ verdict: 'blocked' }), event({ verdict: 'blocked', ts: at(30) })]

  it('keeps the would-be-blocked or the blocked events only, the window staying the one of the memory', () => {
    expect(run({ events, verdict: 'blocked' })).toMatchObject({ total: 2, windowMinutes: 30 })
    expect(run({ events, verdict: 'would_block' })).toMatchObject({ total: 1, windowMinutes: 30 })
    expect(run({ events, verdict: 'all' }).total).toBe(3)
  })

  it('has no bucket when the verdict keeps nothing, but still a window', () => {
    expect(run({ events: [event({})], verdict: 'blocked' })).toMatchObject({ buckets: [], total: 0, windowMinutes: 1 })
  })
})

describe('mergeEvents', () => {
  const e = (s: number) => event({ seq: s })

  it('puts the newest page on top of the events held, without doubles, capped', () => {
    expect(mergeEvents([e(10), e(9), e(8)], [e(12), e(11), e(10)])!.map(x => x.seq)).toEqual([12, 11, 10, 9, 8])
    expect(mergeEvents([e(10), e(9), e(8)], [e(12), e(11)], 4)!.map(x => x.seq)).toEqual([12, 11, 10, 9])
  })

  it('asks for a full read when the page does not reach the events held, the ring started again, or nothing is held', () => {
    expect(mergeEvents([e(10)], [e(20), e(19)])).toBeNull()
    expect(mergeEvents([e(10)], [e(3), e(2)])).toBeNull()
    expect(mergeEvents([], [e(1)])).toBeNull()
    expect(mergeEvents([e(10)], [])).toEqual([])
  })
})
