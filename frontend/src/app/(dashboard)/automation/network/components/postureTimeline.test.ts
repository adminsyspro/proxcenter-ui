import { describe, expect, it } from 'vitest'

import type { MicrosegEvent, MicrosegZone } from '@/lib/microseg/types'

import type { PostureGuest } from './dashboardPosture'
import {
  BUCKET_MS, MAX_BUCKETS, VOLUME_WINDOW_MS, connectionVmids, mergeEvents, postureTimeline, postureVolume, volumeWindow, type TimelineSeries, type VmSeries,
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

describe('sFlow volume', () => {
  const { from, to } = volumeWindow(NOW)
  const point = (minutesAgo: number, bytes_in: number, bytes_out: number) => ({ time: Math.floor((NOW - minutesAgo * 60_000) / 1000), bytes_in, bytes_out })
  const SERIES: VmSeries[] = [
    { vmid: 101, points: [point(1, 10, 1000), point(7, 20, 2000)] },
    { vmid: 102, points: [point(1, 500, 5)] },
    { vmid: 104, points: [point(1, 30, 300)] },
    { vmid: 999, points: [point(1, 1, 7)] },
  ]
  const vol = (over: Partial<Parameters<typeof postureVolume>[0]> = {}) => postureVolume({
    series: SERIES, groupBy: 'zone', zones: ZONES, tagPrefix: 'zone-', guests: GUESTS, slices: [...ZONE_SLICES, slice('zone:zdb', 'zone', '#444444', 'db')], from, to, ...over,
  })

  it('reads the last 2 hours on 5-minute edges', () => {
    expect(to - from).toBe(VOLUME_WINDOW_MS)
    expect(to % BUCKET_MS).toBe(0)
    expect(to).toBeGreaterThan(NOW)
  })

  it('takes the guests of the connection the sFlow pairs name, either end', () => {
    const pairs = [
      { src_ip: 'a', dst_ip: 'b', src_vmid: 101, dst_vmid: 999, bytes: 1, packets: 1, protocol: 'TCP', dst_port: 22 },
      { src_ip: 'c', dst_ip: 'd', dst_vmid: 104, bytes: 1, packets: 1, protocol: 'TCP', dst_port: 22 },
    ]
    expect(connectionVmids(pairs, GUESTS)).toEqual([101, 104])
    expect(connectionVmids(pairs.slice(0, 0), GUESTS)).toEqual([])
  })

  it('stacks by zone the bytes the members sent, per 5-minute bucket, a VM the connection does not hold as Unknown', () => {
    const v = vol()
    expect(v.buckets).toHaveLength(VOLUME_WINDOW_MS / BUCKET_MS)
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
    expect(vol({ series: [{ vmid: 101, points: [point(3 * 60, 1, 1)] }, { vmid: 102, points: null }] }).total).toBe(0)
  })
})
