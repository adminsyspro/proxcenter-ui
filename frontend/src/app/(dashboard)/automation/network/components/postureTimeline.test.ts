import { describe, expect, it } from 'vitest'

import type { MicrosegEvent, MicrosegTraffic, MicrosegZone } from '@/lib/microseg/types'

import type { PostureGuest } from './dashboardPosture'
import {
  BUCKET_MS, MAX_BUCKETS, RANGE_SPEC, alignTimelines, TIMELINE_RANGES, areaPaths, asRange, bucketXs, historyWindow, mergeEvents, nearestBucket, postureHistory, postureTimeline, stepMsOf, topSources, volumeTimeline, type TimelineRange, type TimelineSeries,
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

describe('postureTimeline: by destination zone', () => {
  it('groups the events by the zone that logged them', () => {
    const slices = [slice('zone:zweb', 'zone', '#1', 'web'), slice('zone:zdb', 'zone', '#2', 'db')]
    const t = run({ groupBy: 'dstzone', slices, events: [event({}), event({}), event({ zone: 'web', src_zone: 'db' }), event({ zone: 'gone' })] })
    expect(t.buckets.at(-1)!.counts).toEqual({ 'zone:zdb': 2, 'zone:zweb': 1, other: 1 })
  })
})

describe('postureTimeline: one guest (map panel)', () => {
  it('keeps the events of that guest only, the window being the one of what is kept', () => {
    const events = [event({ vmid: 102, ts: at(1) }), event({ vmid: 104, ts: at(30) }), event({ vmid: 102, type: 'lxc', ts: at(40) })]
    const t = run({ events, keep: e => e.vmid === 102 && e.type === 'qemu' })
    expect(t).toMatchObject({ total: 1, windowMinutes: 1 })
    expect(run({ events }).total).toBe(3)
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

describe('sFlow volume (volume route)', () => {
  const window = historyWindow(NOW, '1h')
  const volume = (buckets: Array<{ at: string; src_zone: string; dst_zone: string; bytes: number }>) => ({
    from: new Date(window.from).toISOString(), to: new Date(window.to).toISOString(),
    buckets: buckets.map(b => ({ ...b, proto: '', port: 0, packets: 1 })),
  })
  const DST_SLICES = [slice('zone:zweb', 'zone', '#111111', 'web'), slice('zone:zdb', 'zone', '#222222', 'db'), slice('outside', 'outside', '#333333')]
  const rows = volume([
    { at: at(30), src_zone: 'web', dst_zone: 'db', bytes: 1000 },
    { at: at(30), src_zone: '', dst_zone: 'web', bytes: 200 },
    { at: at(5), src_zone: 'gone', dst_zone: 'web', bytes: 7 },
    { at: at(5), src_zone: 'db', dst_zone: '', bytes: 50 },
    { at: at(90), src_zone: 'web', dst_zone: 'db', bytes: 999 },
  ])

  it('stacks by source zone the bytes per bucket of the range, an end in no zone as Unknown, a zone gone as Other', () => {
    const chart = volumeTimeline({ volume: rows, range: '1h', zones: ZONES, slices: ZONE_SLICES, by: 'src' })
    expect(chart.buckets).toHaveLength(12)
    expect(chart.total).toBe(1257)
    const sum = (key: string) => chart.buckets.reduce((s, b) => s + (b.counts[key] ?? 0), 0)
    expect(sum('zone:zweb')).toBe(1000)
    expect(sum('external')).toBe(200)
    // db is no slice of this donut: Other, with the zone gone.
    expect(sum('other')).toBe(57)
    expect(chart.series.map(s => s.key)).toEqual(['zone:zweb', 'external', 'other'])
    expect(chart.range).toBe('1h')
  })

  it('stacks by destination zone, an end in no zone as Outside', () => {
    const chart = volumeTimeline({ volume: rows, range: '1h', zones: ZONES, slices: DST_SLICES, by: 'dst' })
    const sum = (key: string) => chart.buckets.reduce((s, b) => s + (b.counts[key] ?? 0), 0)
    expect(sum('zone:zdb')).toBe(1000)
    expect(sum('zone:zweb')).toBe(207)
    expect(sum('outside')).toBe(50)
  })

  it('keeps one pair of zones (by name, any case), or the traffic into or out of a zone', () => {
    const pair = volumeTimeline({ volume: rows, range: '1h', zones: ZONES, slices: ZONE_SLICES, by: 'src', pair: { emitter: 'WEB', receiver: 'db' } })
    expect(pair.total).toBe(1000)
    const into = volumeTimeline({ volume: rows, range: '1h', zones: ZONES, slices: ZONE_SLICES, by: 'src', zone: 'web' })
    expect(into.total).toBe(207)
    const out = volumeTimeline({ volume: rows, range: '1h', zones: ZONES, slices: DST_SLICES, by: 'dst', zone: 'db' })
    expect(out.total).toBe(50)
  })

  it('has its buckets and no byte for an empty answer', () => {
    const chart = volumeTimeline({ volume: volume([]), range: '7d', zones: ZONES, slices: ZONE_SLICES, by: 'src' })
    expect(chart.total).toBe(0)
    expect(chart.max).toBe(0)
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
  })

  it('keeps only the flows logged in the zone of a map panel (its name, any case)', () => {
    const last = win('1h').to - 300_000
    const rows = [row(last, { hits: 3 }), row(last, { hits: 2, zone: 'web' }), row(last, { hits: 4, zone: 'DB', src_zone: '' })]
    expect(run('1h', rows, { zone: 'db' }).total).toBe(7)
    expect(run('1h', rows, { zone: 'web' }).total).toBe(2)
    expect(run('1h', rows).total).toBe(9)
  })

  it('reads an outbound bucket (logged by the emitting zone) as the flow it is: emitted by that zone, received by the zone or the outside it names', () => {
    const last = win('1h').to - 300_000
    // web emitted 6 hits to db and 4 to the outside (logged by web), and 3 more to db (logged by db).
    const rows = [
      row(last, { hits: 6, zone: 'web', src_zone: 'db', direction: 'out' }),
      row(last, { hits: 4, zone: 'web', src_zone: '', direction: 'out' }),
      row(last, { hits: 3 }),
    ]
    const outOfWeb = run('1h', rows, { by: 'dst', zone: 'web', slices: [slice('zone:zdb', 'zone', '#2', 'db'), ...ZONE_SLICES] })
    expect(outOfWeb.total).toBe(13)
    expect(outOfWeb.buckets.at(-1)!.counts['zone:zdb']).toBe(9)
    // The 4 hits to an address outside the zones are grouped as "Outside", not as an unknown source.
    const byDst = run('1h', rows, { by: 'dst', zone: 'web', slices: [slice('zone:zdb', 'zone', '#2', 'db'), slice('outside', 'outside', '#616161'), ...ZONE_SLICES] })
    expect(byDst.buckets.at(-1)!.counts).toEqual({ 'zone:zdb': 9, outside: 4 })
    const intoDb = run('1h', rows, { zone: 'db' })
    expect(intoDb.total).toBe(9)
    expect(intoDb.buckets.at(-1)!.counts['zone:zweb']).toBe(9)
  })

  it('groups by the zone that received the flows (destination), and keeps one zone\'s emitted flows for a panel', () => {
    const last = win('1h').to - 300_000
    const rows = [row(last, { hits: 3 }), row(last, { hits: 2, zone: 'web', src_zone: 'db' }), row(last, { hits: 4, zone: 'web', src_zone: '' })]
    const dst = run('1h', rows, { by: 'dst', slices: [slice('zone:zdb', 'zone', '#2', 'db'), ...ZONE_SLICES] })
    expect(dst.buckets.at(-1)!.counts).toEqual({ 'zone:zdb': 3, 'zone:zweb': 6 })
    // Outbound of db: what db emitted, by destination.
    const out = run('1h', rows, { by: 'dst', zone: 'db', slices: [slice('zone:zdb', 'zone', '#2', 'db'), ...ZONE_SLICES] })
    expect(out.buckets.at(-1)!.counts).toEqual({ 'zone:zweb': 2 })
  })

  it('ranks the sources of the range by hits with their share, the 5 busiest', () => {
    const last = win('1h').to - 300_000
    const t = run('1h', [row(last, { hits: 3 }), row(last - 300_000, { hits: 3 }), row(last, { src_zone: '', hits: 2 })])
    expect(topSources(t).map(s => [s.key, s.hits, s.share])).toEqual([['zone:zweb', 6, 75], ['external', 2, 25]])
    const many = { total: 60, series: Array.from({ length: 7 }, (_, i) => slice(`k${i}`, 'zone', '#1', `k${i}`)), buckets: [{ start: 0, total: 60, counts: Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`k${i}`, i + 1])) }] }
    expect(topSources(many).map(s => s.key)).toEqual(['k6', 'k5', 'k4', 'k3', 'k2'])
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
    expect(paths[0]).toMatchObject({ key: 'a', line: 'M 25 5 L 75 7.5', area: 'M 25 5 L 75 7.5 L 75 10 L 25 10 Z' })
    expect(paths[1]).toMatchObject({ key: 'b', line: 'M 25 0 L 75 7.5', area: 'M 25 0 L 75 7.5 L 75 7.5 L 25 5 Z' })
  })

  it('curves smoothly through three buckets or more, never past a value, flat where the traffic rests', () => {
    const paths = areaPaths({ series: series.slice(0, 1), max: 4, buckets: [bucket(0, { a: 0 }), bucket(1, { a: 4 }), bucket(2, { a: 4 }), bucket(3, { a: 2 })] }, box)
    const { line, area, tops } = paths[0]
    expect(tops).toEqual([10, 0, 0, 5])
    expect(line.startsWith('M 12.5 10 C ')).toBe(true)
    expect(line.endsWith(' 87.5 5')).toBe(true)
    // Every control point stays within the box: no overshoot above the top value nor under the axis.
    const ys = line.replace(/^M /, '').split(/ C | /).map(Number).filter((_, i) => i % 2 === 1)
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...ys)).toBeLessThanOrEqual(10)
    // The plateau between the second and third buckets is flat.
    expect(line).toContain('C 45.83 0 54.17 0 62.5 0')
    expect(area.endsWith(' 12.5 10 Z')).toBe(true)
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

describe('mirrored chart', () => {
  const box = { left: 0, width: 100, top: 0, height: 10 }
  const bucket = (start: number, counts: Record<string, number>) => ({ start, total: Object.values(counts).reduce((a, b) => a + b, 0), counts })
  const line = (start: number, counts: Record<string, number>[], series: TimelineSeries[]) => {
    const buckets = counts.map((c, i) => bucket(start + i * BUCKET_MS, c))
    return { stepMs: BUCKET_MS, series, buckets, max: Math.max(...buckets.map(b => b.total)), total: buckets.reduce((a, b) => a + b.total, 0), windowMinutes: null }
  }

  it('stacks the outbound side downwards from the baseline', () => {
    const paths = areaPaths({ series: [slice('a', 'zone', '#1', 'a')], max: 4, buckets: [bucket(0, { a: 2 }), bucket(1, { a: 4 })] }, { ...box, top: 10 }, true)
    // Baseline at y 10, a value of 2 out of 4 goes to y 15, 4 to y 20.
    expect(paths[0]).toMatchObject({ key: 'a', line: 'M 25 15 L 75 20', area: 'M 25 15 L 75 20 L 75 10 L 25 10 Z' })
  })

  it('puts both sides on the same buckets and the same scale', () => {
    const above = line(0, [{ a: 1 }], [slice('a', 'zone', '#1', 'a')])
    const below = line(BUCKET_MS, [{ b: 3 }, { b: 5 }], [slice('b', 'zone', '#2', 'b')])
    const { above: up, below: down } = alignTimelines(above, below)
    expect(up.buckets.map(b => [b.start, b.total])).toEqual([[0, 1], [BUCKET_MS, 0], [2 * BUCKET_MS, 0]])
    expect(down.buckets.map(b => [b.start, b.total])).toEqual([[0, 0], [BUCKET_MS, 3], [2 * BUCKET_MS, 5]])
    expect(up.max).toBe(5)
    expect(down.max).toBe(5)
  })

  it('keeps an empty side empty', () => {
    const above = line(0, [], [])
    const below = line(0, [{ b: 2 }], [slice('b', 'zone', '#2', 'b')])
    const { above: up } = alignTimelines(above, below)
    expect(up.buckets).toHaveLength(1)
    expect(up.total).toBe(0)
  })
})

describe('postureTimeline: outbound events (logged by the emitting zone)', () => {
  const out = (over: Partial<MicrosegEvent> = {}) => event({ direction: 'out', zone: 'web', src_zone: 'db', ...over })
  const dstSlices = [slice('zone:zdb', 'zone', '#222222', 'db'), slice('outside', 'outside', '#616161'), ...ZONE_SLICES]

  it('groups an outbound event by its emitting zone, and by its destination zone or the outside', () => {
    const events = [out({ ts: at(1) }), out({ ts: at(1), src_zone: '' })]
    const bySrc = run({ events })
    expect(bySrc.buckets.at(-1)!.counts).toEqual({ 'zone:zweb': 2 })
    const byDst = run({ events, groupBy: 'dstzone', slices: dstSlices })
    expect(byDst.buckets.at(-1)!.counts).toEqual({ 'zone:zdb': 1, outside: 1 })
  })
})
