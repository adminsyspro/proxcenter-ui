import { EXTERNAL_KEY, GROUP_COLORS, OTHER_KEY, UNZONED_KEY, buildResolver, groupKeyOf, zoneKey, type LensPair } from '@/lib/microseg/trafficLens'
import type { MicrosegEvent, MicrosegTraffic, MicrosegZone, SuggestionKind } from '@/lib/microseg/types'

import { NO_VLAN_KEY, type GroupBy, type PostureGuest, type PostureSlice } from './dashboardPosture'
import { bareIp } from './microseg/zoneGraph'
import { byText } from './microseg/zoneLayout'

/**
 * The time chart of the Posture Dashboard (UA50), pure: the events of the orchestrator's ring (the flows the engine
 * saw towards zone guests) counted per 5-minute bucket and per group of the donut. No request here.
 */

/** Events per read (the orchestrator's maximum). */
export const EVENTS_PAGE = 500
/** Pages read on the first load: up to 2000 events. */
export const EVENTS_PAGES = 4
export const EVENTS_MAX = EVENTS_PAGE * EVENTS_PAGES
export const BUCKET_MS = 5 * 60_000
/** At most a day of buckets is drawn; older events still count in the covered window. */
export const MAX_BUCKETS = 288

export type TimelineVerdict = 'all' | SuggestionKind

/** The ranges of the chart (UA55): the persisted history serves each one, the events ring only its last hours. */
export type TimelineRange = '1h' | '6h' | '24h' | '7d'
export const TIMELINE_RANGES: readonly TimelineRange[] = ['1h', '6h', '24h', '7d']
export const DEFAULT_RANGE: TimelineRange = '1h'

/** The InfluxDB window sizes the sFlow route accepts (internal/api/sflow.go): a step is a multiple of one of them. */
type SflowGranularity = '5m' | '15m' | '1h'
const GRANULARITY_MS: Record<SflowGranularity, number> = { '5m': 5 * 60_000, '15m': 15 * 60_000, '1h': 60 * 60_000 }

/**
 * Per range: its length, the bucket size of the history route (seconds, a multiple of 300 between 300 and 21600), and the
 * largest InfluxDB window the sFlow route accepts that divides that step (it has no 30 m nor 3 h: summed again here).
 */
export const RANGE_SPEC: Record<TimelineRange, { ms: number; stepSec: number; granularity: SflowGranularity }> = {
  '1h': { ms: 60 * 60_000, stepSec: 300, granularity: '5m' },
  '6h': { ms: 6 * 60 * 60_000, stepSec: 900, granularity: '15m' },
  '24h': { ms: 24 * 60 * 60_000, stepSec: 1800, granularity: '15m' },
  '7d': { ms: 7 * 24 * 60 * 60_000, stepSec: 10_800, granularity: '1h' },
}

export const stepMsOf = (range: TimelineRange) => RANGE_SPEC[range].stepSec * 1000

/** A range read back from storage: anything else is the default. */
export function asRange(value: unknown): TimelineRange {
  return TIMELINE_RANGES.find(r => r === value) ?? DEFAULT_RANGE
}

/**
 * The newest page read on a refresh put on top of the events already held, newest first, the oldest dropped past
 * `max`. Null when the page does not reach down to them (more events came in than a page holds) or the ring started
 * again: read again in full.
 */
export function mergeEvents(held: readonly MicrosegEvent[], fresh: readonly MicrosegEvent[], max = EVENTS_MAX): MicrosegEvent[] | null {
  if (!held.length) return null
  // An empty ring, or one that started again (an orchestrator restart numbers from the start): nothing held applies.
  if (!fresh.length) return []
  if (fresh[0].seq < held[0].seq) return null
  const cut = fresh.at(-1)!.seq
  if (cut > held[0].seq + 1) return null
  return [...fresh, ...held.filter(e => e.seq < cut)].slice(0, max)
}

/** One series of the chart: a group of the donut (its colour), or "Other" for a group the donut does not show. */
export type TimelineSeries = Pick<PostureSlice, 'key' | 'kind' | 'name' | 'color'>

export type TimelineBucket = { start: number; total: number; counts: Record<string, number> }

export type PostureTimeline = {
  /** The width of a bucket, in ms. */
  stepMs: number
  /** Set when the persisted history is the source (the range it covers); absent for the orchestrator's memory. */
  range?: TimelineRange
  series: TimelineSeries[]
  buckets: TimelineBucket[]
  /** The largest bucket, for the scale. */
  max: number
  /** Events counted (after the verdict filter). */
  total: number
  /** Minutes from the oldest event read to now, null without an event. */
  windowMinutes: number | null
}

/** The group of an event, as the donut groups: its source zone, or the VLAN / node of the guest it reached. */
function groupOfEvent(
  e: MicrosegEvent, groupBy: GroupBy, zoneByName: ReadonlyMap<string, MicrosegZone>, guestByKey: ReadonlyMap<string, PostureGuest>, guestIps: ReadonlySet<string> | null,
): string {
  if (groupBy === 'dstzone') {
    // The zone that received it: the zone of the guest that logged it.
    const zone = zoneByName.get(e.zone.toLowerCase())
    return zone ? zoneKey(zone.id) : OTHER_KEY
  }
  if (groupBy !== 'zone') {
    // A guest the connection does not list (deleted since, another connection): Unknown, by node as by VLAN.
    const guest = guestByKey.get(`${e.type}/${e.vmid}`)
    if (!guest) return EXTERNAL_KEY
    if (groupBy === 'node') return `node:${e.node}`
    return guest.vlans.length ? `vlan:${guest.vlans[0]}` : NO_VLAN_KEY
  }
  if (e.src_zone) {
    const zone = zoneByName.get(e.src_zone.toLowerCase())
    // A zone renamed or deleted since the event: no slice of the donut is it.
    return zone ? zoneKey(zone.id) : OTHER_KEY
  }
  return guestIps?.has(bareIp(e.src_ip)) ? UNZONED_KEY : EXTERNAL_KEY
}

/**
 * The events per 5-minute bucket, from the oldest read to `now`, one series per group shown by the donut (in its
 * order and colours), the other groups in "Other". `verdict` keeps the would-be-blocked or the blocked ones only.
 */
export function postureTimeline(input: {
  events: readonly MicrosegEvent[]
  groupBy: GroupBy
  verdict: TimelineVerdict
  zones: readonly MicrosegZone[]
  guests: readonly PostureGuest[]
  /** The guest addresses are in (an unzoned source is told from an unknown one). */
  addresses: boolean
  /** The slices of the donut: their keys, names and colours. */
  slices: readonly TimelineSeries[]
  now: number
  /** Only these events (a guest of the map panel); the window is the one of what is kept. */
  keep?: ((e: MicrosegEvent) => boolean) | null
}): PostureTimeline {
  const { groupBy, verdict, slices, now, keep } = input
  const events = keep ? input.events.filter(keep) : input.events
  const zoneByName = new Map(input.zones.map(z => [z.name.toLowerCase(), z]))
  const guestByKey = new Map(input.guests.map(g => [g.key, g]))
  const guestIps = input.addresses ? new Set(input.guests.flatMap(g => g.ips.map(bareIp))) : null

  const times = events.map(e => Date.parse(e.ts)).filter(t => Number.isFinite(t))
  const oldest = times.length ? Math.min(...times) : null
  const windowMinutes = oldest === null ? null : Math.max(1, Math.round((now - oldest) / 60_000))

  const kept = events.filter(e => verdict === 'all' || e.verdict === verdict)
  if (oldest === null || kept.length === 0) return { stepMs: BUCKET_MS, series: [], buckets: [], max: 0, total: 0, windowMinutes }

  const last = Math.floor(now / BUCKET_MS) * BUCKET_MS
  const first = Math.max(Math.floor(oldest / BUCKET_MS) * BUCKET_MS, last - (MAX_BUCKETS - 1) * BUCKET_MS)
  // An event stamped a little ahead of this clock (node clocks drift) counts in the last bucket.
  const clamp = (at: number) => (at >= last + BUCKET_MS && at < now + BUCKET_MS ? last : at)
  const items = kept.map(e => ({ at: clamp(Date.parse(e.ts)), group: groupOfEvent(e, groupBy, zoneByName, guestByKey, guestIps), value: 1 }))
  return { ...stack(first, last, items, slices, BUCKET_MS), windowMinutes }
}

/**
 * The window asked of the history route: up to the next 5-minute edge (the last bucket is in progress), back by the
 * range, the start on the step grid so the first bucket is whole and the range never reaches past what was asked.
 */
export function historyWindow(now: number, range: TimelineRange): { from: number; to: number } {
  const to = Math.floor(now / BUCKET_MS) * BUCKET_MS + BUCKET_MS
  const step = stepMsOf(range)
  return { from: Math.ceil((to - RANGE_SPEC[range].ms) / step) * step, to }
}

/**
 * The persisted history as the time chart: the hits per bucket of the range, by SOURCE or DESTINATION zone as the
 * donut and the events path group them (the route does not carry guests, so it serves the zone groupings only). A
 * source in no zone is "Unknown" (the history does not tell an unzoned guest from a foreign address), a zone renamed or
 * deleted since is "Other". One read serves every direction and every zone: the filters are applied here.
 */
export function postureHistory(input: {
  history: MicrosegTraffic
  range: TimelineRange
  verdict: TimelineVerdict
  zones: readonly MicrosegZone[]
  slices: readonly TimelineSeries[]
  /** `src`: by the zone that emitted the flows (the default); `dst`: by the zone that received them (logged them). */
  by?: 'src' | 'dst'
  /**
   * One zone of the map panel (its name, as the history carries it): grouped by source, the flows it received
   * (inbound); grouped by destination, the flows it emitted (outbound).
   */
  zone?: string | null
}): PostureTimeline {
  const { history, range, verdict, slices, by = 'src' } = input
  const only = input.zone?.toLowerCase() ?? null
  const stepMs = stepMsOf(range)
  const zoneByName = new Map(input.zones.map(z => [z.name.toLowerCase(), z]))
  const groupOf = (name: string) => {
    if (!name) return EXTERNAL_KEY
    const zone = zoneByName.get(name.toLowerCase())
    return zone ? zoneKey(zone.id) : OTHER_KEY
  }
  // The side the chart groups on, and the side one zone is kept on: the other one.
  const grouped = (b: MicrosegTraffic['buckets'][number]) => (by === 'src' ? b.src_zone : b.zone)
  const kept = (b: MicrosegTraffic['buckets'][number]) => (by === 'src' ? b.zone : b.src_zone)
  const items = history.buckets
    .filter(b => (verdict === 'all' || b.verdict === verdict) && (only === null || kept(b).toLowerCase() === only))
    .map(b => ({ at: Date.parse(b.at), group: groupOf(grouped(b)), value: b.hits }))
  const first = Math.ceil(Date.parse(history.from) / stepMs) * stepMs
  const last = Math.floor((Date.parse(history.to) - 1) / stepMs) * stepMs
  return { ...stack(first, last, items, slices, stepMs), stepMs, range, windowMinutes: RANGE_SPEC[range].ms / 60_000 }
}

/**
 * The values per bucket of `stepMs` from `first` to `last` (bucket starts), one series per slice of the donut that has
 * a value (in its order and colour), a group the donut does not show in "Other". Values outside the range are left out.
 */
function stack(first: number, last: number, items: readonly { at: number; group: string; value: number }[], slices: readonly TimelineSeries[], stepMs: number) {
  const shown = new Set(slices.map(s => s.key))
  const buckets: TimelineBucket[] = []
  for (let start = first; start <= last; start += stepMs) buckets.push({ start, total: 0, counts: {} })

  const used = new Set<string>()
  let total = 0
  for (const item of items) {
    if (!Number.isFinite(item.at) || item.at < first || item.at >= last + stepMs || item.value <= 0) continue
    const bucket = buckets[Math.floor((item.at - first) / stepMs)]
    const key = shown.has(item.group) ? item.group : OTHER_KEY
    bucket.counts[key] = (bucket.counts[key] ?? 0) + item.value
    bucket.total += item.value
    used.add(key)
    total += item.value
  }

  const series: TimelineSeries[] = slices.filter(s => used.has(s.key))
  if (used.has(OTHER_KEY) && !shown.has(OTHER_KEY)) series.push({ key: OTHER_KEY, kind: 'other', name: '', color: GROUP_COLORS.other })
  return { stepMs, series, buckets, max: Math.max(0, ...buckets.map(b => b.total)), total }
}

/**
 * The window of the sFlow volume chart: the range, ending on the edge of the InfluxDB window of that range (5 m, 15 m
 * or 1 h, so the last window is whole and stamped on an edge; the read changes at each edge), starting on the step grid.
 */
export function volumeWindow(now: number, range: TimelineRange): { from: number; to: number } {
  const granularity = GRANULARITY_MS[RANGE_SPEC[range].granularity]
  const to = Math.floor(now / granularity) * granularity + granularity
  const step = stepMsOf(range)
  return { from: Math.ceil((to - RANGE_SPEC[range].ms) / step) * step, to }
}

/** The VMID of a guest key ("qemu/101"). */
const vmidOf = (g: PostureGuest) => Number(g.key.slice(g.key.indexOf('/') + 1))

/** The VMIDs of the volume chart at most: the busiest ones, so the series read stays bounded. */
export const MAX_VOLUME_VMIDS = 100

/** What the pairs told of one VMID of the connection: the most bytes a pair of it carried, and the addresses it had. */
export type VmidSeen = { bytes: number; ips: ReadonlySet<string> }

/**
 * The guests of the connection (by VMID) the sFlow pairs name at either end, on top of the ones seen before: the set
 * only grows, so the series read keeps its key.
 */
export function accumulateVmids(seen: ReadonlyMap<number, VmidSeen>, pairs: readonly LensPair[], guests: readonly PostureGuest[]): Map<number, VmidSeen> {
  const mine = new Set(guests.map(vmidOf))
  const next = new Map(seen)
  const take = (vmid: number | undefined, ip: string, bytes: number) => {
    if (!vmid || !mine.has(vmid)) return
    const prev = next.get(vmid)
    next.set(vmid, { bytes: Math.max(prev?.bytes ?? 0, bytes), ips: new Set([...(prev?.ips ?? []), bareIp(ip)]) })
  }
  for (const p of pairs) {
    take(p.src_vmid, p.src_ip, p.bytes)
    take(p.dst_vmid, p.dst_ip, p.bytes)
  }
  return next
}

/**
 * The VMIDs the series read asks: the `max` busiest seen, in number order (a stable key). sFlow names VMs by VMID
 * across the fleet: once a guest's addresses are known, its VMID is only kept when a pair carried one of them (a VM
 * of another connection with the same VMID is not taken for it).
 */
export function busiestVmids(seen: ReadonlyMap<number, VmidSeen>, guests: readonly PostureGuest[], max = MAX_VOLUME_VMIDS): number[] {
  const ipsOf = new Map(guests.map(g => [vmidOf(g), new Set(g.ips.map(bareIp))]))
  const isMine = (vmid: number, s: VmidSeen) => {
    const ips = ipsOf.get(vmid)
    return !!ips && (ips.size === 0 || [...s.ips].some(ip => ips.has(ip)))
  }
  return [...seen.entries()].filter(([vmid, s]) => isMine(vmid, s))
    .sort((a, b) => b[1].bytes - a[1].bytes || a[0] - b[0]).slice(0, max).map(([vmid]) => vmid).sort((a, b) => a - b)
}

/** One VM of /sflow/timeseries/all-vms: its points, `time` in Unix seconds. */
export type VmSeries = { vmid: number; vm_name?: string; points: { time: number; bytes_in: number; bytes_out: number }[] | null }

/**
 * The sFlow bytes per 5-minute bucket of the window, per group of the donut: by zone, what the members SENT (the
 * donut groups by source zone; the zone from the guest tags, through the lens resolver); by destination zone, VLAN or
 * node, what the guests RECEIVED (the donut groups by destination). A VM the connection does not hold is Unknown.
 */
export function postureVolume(input: {
  series: readonly VmSeries[]
  groupBy: GroupBy
  zones: readonly MicrosegZone[]
  tagPrefix: string
  guests: readonly PostureGuest[]
  slices: readonly TimelineSeries[]
  range: TimelineRange
  from: number
  to: number
}): PostureTimeline {
  const { groupBy, guests, range } = input
  const stepMs = stepMsOf(range)
  const granularityMs = GRANULARITY_MS[RANGE_SPEC[range].granularity]
  const byVmid = new Map(guests.map(g => [vmidOf(g), g]))
  const resolve = buildResolver([...input.zones], input.tagPrefix, guests.map(g => ({ vmid: vmidOf(g), name: g.key, tags: g.tags, ips: [] })))
  const groupOfVm = (vmid: number): string => {
    if (groupBy === 'zone' || groupBy === 'dstzone') return groupKeyOf(resolve('', vmid))
    const guest = byVmid.get(vmid)
    if (!guest) return EXTERNAL_KEY
    if (groupBy === 'node') return `node:${guest.node}`
    return guest.vlans.length ? `vlan:${guest.vlans[0]}` : NO_VLAN_KEY
  }
  const items = input.series.flatMap(vm => {
    const group = groupOfVm(vm.vmid)
    // InfluxDB's aggregateWindow stamps each sum with the END of its window (internal/sflow/influx.go, the
    // `aggregateWindow(every: ..., fn: sum)` queries): the window starts one granularity before, and sums with the
    // others of the same step bucket (a 30 m or 3 h step is made of 15 m or 1 h windows).
    return (vm.points ?? []).map(p => ({ at: p.time * 1000 - granularityMs, group, value: groupBy === 'zone' ? p.bytes_out : p.bytes_in }))
  })
  return { ...stack(input.from, Math.floor((input.to - 1) / stepMs) * stepMs, items, input.slices, stepMs), windowMinutes: RANGE_SPEC[range].ms / 60_000 }
}

/** The drawing box of the time chart: the left edge and width of the plot, its top and height. */
export type PlotBox = { left: number; width: number; top: number; height: number }

/** The x of each bucket: at its middle; a single bucket spans the plot (two points, so its area has a width). */
export function bucketXs(count: number, box: PlotBox): number[] {
  if (count === 1) return [box.left, box.left + box.width]
  const step = box.width / count
  return Array.from({ length: count }, (_, i) => box.left + (i + 0.5) * step)
}

const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * The stacked areas of the series, in their order (the first on the baseline): for each, the closed path of its band
 * and the line on its outer edge, straight segments from bucket to bucket. `invert` stacks downwards from the top of
 * the box (the lower half of a mirrored chart).
 */
export function areaPaths(timeline: Pick<PostureTimeline, 'buckets' | 'series' | 'max'>, box: PlotBox, invert = false): { key: string; area: string; line: string }[] {
  const { buckets, series, max } = timeline
  if (!buckets.length || max <= 0) return []
  const xs = bucketXs(buckets.length, box)
  const values = buckets.length === 1 ? [buckets[0], buckets[0]] : buckets
  // Upright: from the bottom of the box up. Inverted (the outbound side of a mirrored chart): from its top down.
  const base = invert ? box.top : box.top + box.height
  const y = (v: number) => (invert ? base + (v / max) * box.height : base - (v / max) * box.height)
  const below = values.map(() => 0)
  return series.map(s => {
    const lower = below.map(v => y(v))
    values.forEach((b, i) => { below[i] += b.counts[s.key] ?? 0 })
    const upper = below.map(v => y(v))
    const top = xs.map((x, i) => `${r2(x)} ${r2(upper[i])}`)
    const bottom = xs.map((x, i) => `${r2(x)} ${r2(lower[i])}`).reverse()
    return { key: s.key, line: `M ${top.join(' L ')}`, area: `M ${top.join(' L ')} L ${bottom.join(' L ')} Z` }
  })
}

/** The bucket nearest to an x of the plot. */
export function nearestBucket(x: number, count: number, box: PlotBox): number {
  if (count <= 1) return 0
  const i = Math.round((x - box.left) / (box.width / count) - 0.5)
  return Math.min(count - 1, Math.max(0, i))
}

/** A group of the chart with its total over the range and its share of all the hits. */
export type SourceTotal = TimelineSeries & { hits: number; share: number }

/** The groups of a chart by their hits over the whole range, the busiest first (ties by key), `max` at most. */
export function topSources(timeline: Pick<PostureTimeline, 'series' | 'buckets' | 'total'>, max = 5): SourceTotal[] {
  const sums = new Map<string, number>()
  for (const b of timeline.buckets) for (const [key, value] of Object.entries(b.counts)) sums.set(key, (sums.get(key) ?? 0) + value)
  return timeline.series
    .map(s => ({ ...s, hits: sums.get(s.key) ?? 0, share: timeline.total > 0 ? ((sums.get(s.key) ?? 0) / timeline.total) * 100 : 0 }))
    .filter(s => s.hits > 0)
    .sort((a, b) => b.hits - a.hits || byText(a.key, b.key))
    .slice(0, max)
}

/**
 * Two charts of one selection on the same buckets, for a mirrored chart (inbound above the baseline, outbound below):
 * the union of their bucket starts (the events path starts each one at its own oldest event), a missing bucket empty,
 * both on the larger of their two scales so the halves compare.
 */
export function alignTimelines(above: PostureTimeline, below: PostureTimeline): { above: PostureTimeline; below: PostureTimeline } {
  const stepMs = above.buckets.length ? above.stepMs : below.stepMs
  const starts = [...above.buckets, ...below.buckets].map(b => b.start)
  if (!starts.length) return { above, below }
  const first = Math.min(...starts)
  const last = Math.max(...starts)
  const align = (t: PostureTimeline): PostureTimeline => {
    const byStart = new Map(t.buckets.map(b => [b.start, b]))
    const buckets: TimelineBucket[] = []
    for (let start = first; start <= last; start += stepMs) buckets.push(byStart.get(start) ?? { start, total: 0, counts: {} })
    return { ...t, stepMs, buckets }
  }
  const max = Math.max(above.max, below.max)
  return { above: { ...align(above), max }, below: { ...align(below), max } }
}
