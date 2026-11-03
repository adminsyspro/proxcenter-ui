import { describe, expect, it } from 'vitest'

import type { LensPair } from '@/lib/microseg/trafficLens'
import type { MicrosegEvent, MicrosegTraffic, MicrosegZone } from '@/lib/microseg/types'

import type { PostureGuest } from './dashboardPosture'
import {
  BUCKET_MS, MAX_BUCKETS, MAX_VOLUME_VMIDS, RANGE_SPEC, TIMELINE_RANGES, accumulateVmids, areaPaths, asRange, bucketXs, busiestVmids, historyWindow, mergeEvents, nearestBucket, postureHistory, postureTimeline, postureVolume, stepMsOf, volumeWindow, type TimelineRange, type TimelineSeries, type VmSeries,
} from './postureTimeline'

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

  it('counts an event stamped less than 5 minutes ahead of the clock in the last bucket, not one further ahead', () => {
    const t = run({ events: [event({ ts: at(1) }), event({ ts: new Date(NOW + 4 * 60_000).toISOString() }), event({ ts: new Date(NOW + 9 * 60_000).toISOString() })] })
    expect(t.buckets.at(-1)!.total).toBe(2)
    expect(t.total).toBe(2)
  })

  it('has no bucket and no window without an event', () => {
    expect(run()).toEqual({ stepMs: BUCKET_MS, series: [], buckets: [], max: 0, total: 0, windowMinutes: null })
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
    const node = run({ groupBy: 'node', events, slices: [slice('node:pve2', 'node', '#333333', 'pve2'), slice('external', 'external', '#616161')] })
    // A guest the connection does not list is Unknown by node as by VLAN, whatever node the event names.
    expect(node.buckets.at(-1)!.counts).toEqual({ 'node:pve2': 2, external: 1 })
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

describe('sFlow volume', () => {
  const { from, to } = volumeWindow(NOW, '1h')
  /** A point as InfluxDB's aggregateWindow stamps it: at the END of its 5-minute window, `ago` windows before the last. */
  const point = (ago: number, bytes_in: number, bytes_out: number) => ({ time: (to - ago * BUCKET_MS) / 1000, bytes_in, bytes_out })
  const SERIES: VmSeries[] = [
    { vmid: 101, points: [point(0, 10, 1000), point(1, 20, 2000)] },
    { vmid: 102, points: [point(0, 500, 5)] },
    { vmid: 104, points: [point(0, 30, 300)] },
    { vmid: 999, points: [point(0, 1, 7)] },
  ]
  const vol = (over: Partial<Parameters<typeof postureVolume>[0]> = {}) => postureVolume({
    series: SERIES, groupBy: 'zone', zones: ZONES, tagPrefix: 'zone-', guests: GUESTS, slices: [...ZONE_SLICES, slice('zone:zdb', 'zone', '#444444', 'db')], range: '1h', from, to, ...over,
  })

  it('reads the range, ending on the edge of the InfluxDB window of that range and starting on the step grid', () => {
    expect(to - from).toBe(RANGE_SPEC['1h'].ms)
    expect(to % BUCKET_MS).toBe(0)
    expect(to).toBeGreaterThan(NOW)
    for (const range of TIMELINE_RANGES) {
      const w = volumeWindow(NOW, range)
      const granularity = { '5m': 300_000, '15m': 900_000, '1h': 3_600_000 }[RANGE_SPEC[range].granularity]
      expect(w.to % granularity, range).toBe(0)
      expect(w.to, range).toBeGreaterThan(NOW)
      expect(w.to - w.from, range).toBeLessThanOrEqual(RANGE_SPEC[range].ms)
      expect(w.to - w.from, range).toBeGreaterThan(RANGE_SPEC[range].ms - stepMsOf(range))
      expect(w.from % stepMsOf(range), range).toBe(0)
    }
  })

  it('puts a point in the window it closes: the one stamped with the window end is the last bucket, none is dropped', () => {
    const v = vol({ series: [{ vmid: 101, points: [point(0, 0, 1), point(11, 0, 2), point(12, 0, 4)] }] })
    // point(0) closes the last bucket; point(11) closes the first; point(12) closes the window before `from`.
    expect(v.buckets.at(-1)!.total).toBe(1)
    expect(v.buckets[0].total).toBe(2)
    expect(v.total).toBe(3)
  })

  it('stacks by zone the bytes the members sent, per 5-minute bucket, a VM the connection does not hold as Unknown', () => {
    const v = vol()
    expect(v.buckets).toHaveLength(RANGE_SPEC['1h'].ms / BUCKET_MS)
    expect(v.buckets.at(-1)!.counts).toEqual({ 'zone:zweb': 1000, 'zone:zdb': 5, unzoned: 300, external: 7 })
    expect(v.buckets.at(-2)!.counts).toEqual({ 'zone:zweb': 2000 })
    expect(v.series.map(s => s.key)).toEqual(['zone:zweb', 'external', 'unzoned', 'zone:zdb'])
    expect(v.total).toBe(3312)
  })

  it('stacks by VLAN or node the bytes the guests received', () => {
    const slices = [slice('vlan:10', 'vlan', '#1', '10'), slice('vlan:20', 'vlan', '#2', '20'), slice('vlan:none', 'novlan', '#3'), slice('external', 'external', '#4')]
    expect(vol({ groupBy: 'vlan', slices }).buckets.at(-1)!.counts).toEqual({ 'vlan:10': 10, 'vlan:20': 500, 'vlan:none': 30, external: 1 })
    expect(vol({ groupBy: 'node', slices: [slice('node:pve2', 'node', '#5', 'pve2')] }).buckets.at(-1)!.counts).toEqual({ 'node:pve2': 530, other: 11 })
  })

  it('leaves out the points outside the window', () => {
    expect(vol({ series: [{ vmid: 101, points: [point(13, 1, 1)] }, { vmid: 102, points: null }] }).total).toBe(0)
  })
})

describe('sFlow volume over a long range', () => {
  const HOUR = 3_600_000
  const w = volumeWindow(NOW, '7d')
  const vol = (range: TimelineRange, series: VmSeries[]) => {
    const win = volumeWindow(NOW, range)
    return postureVolume({ series, groupBy: 'zone', zones: ZONES, tagPrefix: 'zone-', guests: GUESTS, slices: ZONE_SLICES, range, ...win })
  }

  it('sums the 1-hour windows into the 3-hour buckets of a week, by the window each one closes', () => {
    // Windows closing at w.to, w.to - 1 h, w.to - 2 h are one bucket when they share the same 3-hour step (to is an hour edge).
    const stepStart = Math.floor((w.to - 1) / (3 * HOUR)) * 3 * HOUR
    const closes = [w.to, w.to - HOUR].filter(t => t - HOUR >= stepStart)
    const v = vol('7d', [{ vmid: 101, points: [...closes.map(t => ({ time: t / 1000, bytes_in: 0, bytes_out: 10 })), { time: (stepStart) / 1000, bytes_in: 0, bytes_out: 5 }] }])
    expect(v.stepMs).toBe(3 * HOUR)
    expect(v.buckets.every((b, i) => i === 0 || b.start - v.buckets[i - 1].start === 3 * HOUR)).toBe(true)
    expect(v.buckets.at(-1)!.start).toBe(stepStart)
    expect(v.buckets.at(-1)!.total).toBe(closes.length * 10)
    // The window closing at stepStart belongs to the previous bucket.
    expect(v.buckets.at(-2)!.total).toBe(5)
    expect(v.windowMinutes).toBe(7 * 24 * 60)
  })

  it('draws 12 buckets for an hour and 56 or 57 for a week', () => {
    expect(vol('1h', []).buckets).toHaveLength(12)
    expect([56, 57]).toContain(vol('7d', []).buckets.length)
    expect(vol('24h', []).buckets).toHaveLength(48)
    expect(vol('6h', []).buckets).toHaveLength(24)
  })
})

describe('the persisted history (UA55)', () => {
  const win = (range: TimelineRange) => historyWindow(NOW, range)
  const at = (ms: number) => new Date(ms).toISOString()
  const row = (ms: number, over: Partial<MicrosegTraffic['buckets'][number]> = {}) => ({ at: at(ms), zone: 'db', src_zone: 'web', verdict: 'would_block', hits: 1, ...over })
  const answer = (range: TimelineRange, buckets: MicrosegTraffic['buckets']): MicrosegTraffic => {
    const { from, to } = win(range)
    return { step: RANGE_SPEC[range].stepSec, from: at(from), to: at(to), buckets }
  }
  const run = (range: TimelineRange, buckets: MicrosegTraffic['buckets'], over: Partial<Parameters<typeof postureHistory>[0]> = {}) =>
    postureHistory({ history: answer(range, buckets), range, verdict: 'all', zones: ZONES, slices: ZONE_SLICES, ...over })

  it('asks the range up to the next 5-minute edge, starting on the step grid within the range', () => {
    for (const range of TIMELINE_RANGES) {
      const { from, to } = win(range)
      expect(to).toBe(Date.parse('2026-11-03T10:05:00Z'))
      expect(from % stepMsOf(range), range).toBe(0)
      expect(to - from, range).toBeLessThanOrEqual(RANGE_SPEC[range].ms)
      expect(to - from, range).toBeGreaterThan(RANGE_SPEC[range].ms - stepMsOf(range))
    }
    expect(RANGE_SPEC['1h'].stepSec).toBe(300)
    expect(RANGE_SPEC['6h'].stepSec).toBe(900)
    expect(RANGE_SPEC['24h'].stepSec).toBe(1800)
    expect(RANGE_SPEC['7d'].stepSec).toBe(10_800)
    expect(Object.values(RANGE_SPEC).every(r => r.stepSec % 300 === 0 && r.stepSec >= 300 && r.stepSec <= 21_600)).toBe(true)
    expect(Object.values(RANGE_SPEC).every(r => r.stepSec * 1000 % { '5m': 300_000, '15m': 900_000, '1h': 3_600_000 }[r.granularity] === 0)).toBe(true)
  })

  it('stacks the hits per 5-minute bucket by source zone, in the donut order and colours', () => {
    const last = win('1h').to - 300_000
    const t = run('1h', [
      row(last, { hits: 3 }), row(last, { hits: 2, zone: 'web', verdict: 'blocked' }),
      row(last - 300_000, { src_zone: '', hits: 4 }), row(last - 600_000, { src_zone: 'old-name', hits: 1 }),
    ])
    expect(t.range).toBe('1h')
    expect(t.stepMs).toBe(300_000)
    expect(t.buckets).toHaveLength(12)
    expect(t.buckets.at(-1)!.counts).toEqual({ 'zone:zweb': 5 })
    expect(t.buckets.at(-2)!.counts).toEqual({ external: 4 })
    expect(t.buckets.at(-3)!.counts).toEqual({ other: 1 })
    expect(t.series.map(s => s.key)).toEqual(['zone:zweb', 'external', 'other'])
    expect(t).toMatchObject({ total: 10, max: 5, windowMinutes: 60 })
  })

  it('sums the buckets that fall in the same 3-hour step of a week, and leaves out what is outside the range', () => {
    const { from, to } = win('7d')
    const lastStep = Math.floor((to - 1) / 10_800_000) * 10_800_000
    const t = run('7d', [
      row(lastStep, { hits: 10 }), row(lastStep, { hits: 5, src_zone: '' }), row(lastStep - 10_800_000, { hits: 7 }),
      row(from - 10_800_000, { hits: 100 }), row(to + 10_800_000, { hits: 100 }),
    ])
    expect(t.stepMs).toBe(10_800_000)
    expect(t.buckets[0].start).toBe(from)
    expect(t.buckets.at(-1)!.start).toBe(lastStep)
    expect(t.buckets.at(-1)!.counts).toEqual({ 'zone:zweb': 10, external: 5 })
    expect(t.buckets.at(-2)!.total).toBe(7)
    expect(t.total).toBe(22)
    expect(t.windowMinutes).toBe(7 * 24 * 60)
  })

  it('keeps the would-be-blocked or the blocked rows only from the verdict', () => {
    const last = win('1h').to - 300_000
    const rows = [row(last, { hits: 3 }), row(last, { hits: 2, verdict: 'blocked' })]
    expect(run('1h', rows, { verdict: 'blocked' }).total).toBe(2)
    expect(run('1h', rows, { verdict: 'would_block' }).total).toBe(3)
    expect(run('1h', rows).total).toBe(5)
  })

  it('has its buckets and no hit for an empty answer', () => {
    expect(run('6h', [])).toMatchObject({ total: 0, max: 0, series: [], range: '6h' })
    expect(run('6h', []).buckets).toHaveLength(24)
  })

  it('reads a range back from storage, the default for anything else', () => {
    expect(TIMELINE_RANGES.map(asRange)).toEqual(['1h', '6h', '24h', '7d'])
    expect(asRange('30d')).toBe('1h')
    expect(asRange(null)).toBe('1h')
  })
})

describe('the VMIDs of the volume read', () => {
  const pair = (over: Partial<LensPair>): LensPair => ({ src_ip: '10.0.0.1', dst_ip: '10.0.0.2', src_vmid: 101, dst_vmid: 102, bytes: 100, packets: 1, protocol: 'TCP', dst_port: 22, ...over })
  const NO_IPS = GUESTS.map(g => ({ ...g, ips: [] }))

  it('takes the guests of the connection the pairs name, either end, with the most bytes seen', () => {
    const seen = accumulateVmids(new Map(), [pair({}), pair({ src_vmid: 999, src_ip: '10.9.9.9', bytes: 300 })], GUESTS)
    expect([...seen.keys()]).toEqual([101, 102])
    expect(seen.get(102)!.bytes).toBe(300)
    expect(busiestVmids(seen, GUESTS)).toEqual([101, 102])
  })

  it('takes a VMID for a guest only when a pair carried one of its addresses, once they are known', () => {
    // Another connection's VM 101 at 172.16.0.1: not this connection's web1 (10.0.0.1).
    const other = accumulateVmids(new Map(), [pair({ src_ip: '172.16.0.1', dst_vmid: undefined })], NO_IPS)
    // Without addresses (guest list not read), the VMID alone; once they are read, it no longer counts.
    expect(busiestVmids(other, NO_IPS)).toEqual([101])
    expect(busiestVmids(other, GUESTS)).toEqual([])
  })

  it('keeps every VMID seen so far (the read keeps its key), and asks the busiest 100 in number order', () => {
    const first = accumulateVmids(new Map(), [pair({})], GUESTS)
    const next = accumulateVmids(first, [pair({ src_vmid: 104, src_ip: '10.0.0.4', dst_vmid: undefined })], GUESTS)
    expect(busiestVmids(next, GUESTS)).toEqual([101, 102, 104])
    const guests = Array.from({ length: 150 }, (_, i) => ({ key: `qemu/${1000 + i}`, node: 'pve1', tags: [], vlans: [], ips: [] }))
    const many = new Map(guests.map((g, i) => [1000 + i, { bytes: i, ips: new Set<string>() }] as const))
    const ids = busiestVmids(many, guests)
    expect(ids).toHaveLength(MAX_VOLUME_VMIDS)
    expect(ids[0]).toBe(1050)
    expect(ids.at(-1)).toBe(1149)
  })
})

describe('stacked areas', () => {
  const box = { left: 0, width: 100, top: 0, height: 10 }
  const bucket = (start: number, counts: Record<string, number>) => ({ start, total: Object.values(counts).reduce((a, b) => a + b, 0), counts })
  const series = [slice('a', 'zone', '#1', 'a'), slice('b', 'zone', '#2', 'b')]

  it('puts each bucket at its middle, a single bucket across the plot', () => {
    expect(bucketXs(4, box)).toEqual([12.5, 37.5, 62.5, 87.5])
    expect(bucketXs(1, box)).toEqual([0, 100])
  })

  it('stacks one band per series in order, the first on the axis, a line on top of each', () => {
    const paths = areaPaths({ series, max: 4, buckets: [bucket(0, { a: 2, b: 2 }), bucket(1, { a: 1 })] }, box)
    expect(paths.map(p => p.key)).toEqual(['a', 'b'])
    expect(paths[0]).toEqual({ key: 'a', line: 'M 25 5 L 75 7.5', area: 'M 25 5 L 75 7.5 L 75 10 L 25 10 Z' })
    expect(paths[1]).toEqual({ key: 'b', line: 'M 25 0 L 75 7.5', area: 'M 25 0 L 75 7.5 L 75 7.5 L 25 5 Z' })
  })

  it('draws nothing without a value, a single bucket as a flat band', () => {
    expect(areaPaths({ series, max: 0, buckets: [] }, box)).toEqual([])
    expect(areaPaths({ series: series.slice(0, 1), max: 2, buckets: [bucket(0, { a: 2 })] }, box)[0].line).toBe('M 0 0 L 100 0')
  })

  it('finds the bucket nearest to the pointer, clamped to the plot', () => {
    expect(nearestBucket(40, 4, box)).toBe(1)
    expect(nearestBucket(-50, 4, box)).toBe(0)
    expect(nearestBucket(10_000, 4, box)).toBe(3)
    expect(nearestBucket(5, 1, box)).toBe(0)
  })
})
