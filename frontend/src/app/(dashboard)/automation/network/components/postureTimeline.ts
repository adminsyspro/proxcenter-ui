import { EXTERNAL_KEY, GROUP_COLORS, OTHER_KEY, OUTSIDE_KEY, UNZONED_KEY, zoneKey } from '@/lib/microseg/trafficGroups'
import type { FlowDirection, MicrosegEvent, MicrosegTraffic, MicrosegVolume, MicrosegZone, SuggestionKind } from '@/lib/microseg/types'

import { eventGuestKey, type ClusterEvent } from './dashboardAggregate'
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

/** Per range: its length, and the bucket size of the history and volume routes (seconds, a multiple of 300 between 300 and 21600). */
export const RANGE_SPEC: Record<TimelineRange, { ms: number; stepSec: number }> = {
  '1h': { ms: 60 * 60_000, stepSec: 300 },
  '6h': { ms: 6 * 60 * 60_000, stepSec: 900 },
  '24h': { ms: 24 * 60 * 60_000, stepSec: 1800 },
  '7d': { ms: 7 * 24 * 60 * 60_000, stepSec: 10_800 },
}

export const stepMsOf = (range: TimelineRange) => RANGE_SPEC[range].stepSec * 1000

/** The label of each range (networkPage.dashboard). */
export const RANGE_LABEL: Record<TimelineRange, string> = { '1h': 'postureRange1h', '6h': 'postureRange6h', '24h': 'postureRange24h', '7d': 'postureRange7d' }

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
  e: ClusterEvent, groupBy: GroupBy, zoneByName: ReadonlyMap<string, MicrosegZone>, guestByKey: ReadonlyMap<string, PostureGuest>, guestIps: ReadonlySet<string> | null,
): string {
  // An outbound event is logged by the emitting zone (`zone`) and names the destination in `src_zone`.
  const out = e.direction === 'out'
  if (groupBy === 'dstzone') {
    // The zone that received it: the zone of the guest that logged it, or for an outbound event the destination zone.
    const received = out ? e.src_zone : e.zone
    // An outbound event to an address outside the zones names no zone: "Outside", as on the map.
    if (!received) return OUTSIDE_KEY
    const zone = zoneByName.get(received.toLowerCase())
    return zone ? zoneKey(zone.id) : OTHER_KEY
  }
  if (groupBy !== 'zone') {
    // A guest the connection does not list (deleted since, another connection): Unknown, by node as by VLAN.
    const guest = guestByKey.get(eventGuestKey(e))
    if (!guest) return EXTERNAL_KEY
    if (groupBy === 'node') return `node:${e.node}`
    return guest.vlans.length ? `vlan:${guest.vlans[0]}` : NO_VLAN_KEY
  }
  const emitter = out ? e.zone : e.src_zone
  if (emitter) {
    const zone = zoneByName.get(emitter.toLowerCase())
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
  /** On a shared policy each event carries the cluster it was read from: its guest is looked up there. */
  events: readonly ClusterEvent[]
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

/** One ordered pair of zones of the map (their names as the history and the events carry them, '' for an end in no zone). */
export type TrafficPair = { emitter: string; receiver: string }

type Logged = { direction?: FlowDirection; zone: string; src_zone: string }

/**
 * Who emitted and who received a bucket or an event: an inbound one is logged by the receiving zone (`zone`, the emitter
 * in `src_zone`), an outbound one by the emitting zone (`zone`, the destination in `src_zone`, empty outside the zones).
 */
export function loggedEnds(x: Logged): TrafficPair {
  return x.direction === 'out' ? { emitter: x.zone, receiver: x.src_zone } : { emitter: x.src_zone, receiver: x.zone }
}

/** The bucket or event belongs to the pair and was logged in that direction (inbound by the receiver, outbound by the emitter). */
export function onPair(pair: TrafficPair, direction: FlowDirection, x: Logged): boolean {
  const ends = loggedEnds(x)
  return (x.direction ?? 'in') === direction
    && ends.emitter.toLowerCase() === pair.emitter.toLowerCase() && ends.receiver.toLowerCase() === pair.receiver.toLowerCase()
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
  /** One pair of the map instead of a zone: by source, what its receiver logged (inbound); by destination, what its emitter logged (outbound). */
  pair?: TrafficPair | null
}): PostureTimeline {
  const { history, range, verdict, slices, by = 'src', pair = null } = input
  const only = input.zone?.toLowerCase() ?? null
  const stepMs = stepMsOf(range)
  const zoneByName = new Map(input.zones.map(z => [z.name.toLowerCase(), z]))
  const groupOf = (name: string) => {
    // Grouped by destination, an empty zone is an outbound flow to an address outside the zones.
    if (!name) return by === 'dst' ? OUTSIDE_KEY : EXTERNAL_KEY
    const zone = zoneByName.get(name.toLowerCase())
    return zone ? zoneKey(zone.id) : OTHER_KEY
  }
  // The side the chart groups on, and the side one zone is kept on: the other one.
  const grouped = (b: MicrosegTraffic['buckets'][number]) => (by === 'src' ? loggedEnds(b).emitter : loggedEnds(b).receiver)
  const kept = (b: MicrosegTraffic['buckets'][number]) => (by === 'src' ? loggedEnds(b).receiver : loggedEnds(b).emitter)
  const inScope = (b: MicrosegTraffic['buckets'][number]) => {
    if (pair) return onPair(pair, by === 'src' ? 'in' : 'out', b)
    return only === null || kept(b).toLowerCase() === only
  }
  const items = history.buckets
    .filter(b => (verdict === 'all' || b.verdict === verdict) && inScope(b))
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
    // A window that cannot be read has no bucket: nothing is counted in it.
    if (!bucket) continue
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
 * The sFlow volume as the time chart (the volume route, the window and steps of the history route): the bytes per
 * bucket of the range, by SOURCE zone (`by: 'src'`) or DESTINATION zone, as the donut groups. A source in no zone is
 * "Unknown / External", a destination in none "Outside", a zone renamed or deleted since "Other". `pair` keeps one pair
 * of zones (by name, '' for no zone), `zone` the traffic into a zone (by source) or out of it (by destination).
 */
export function volumeTimeline(input: {
  volume: Pick<MicrosegVolume, 'buckets' | 'from' | 'to'>
  range: TimelineRange
  zones: readonly MicrosegZone[]
  slices: readonly TimelineSeries[]
  by: 'src' | 'dst'
  pair?: TrafficPair | null
  zone?: string | null
}): PostureTimeline {
  const { volume, range, by, pair = null, zone = null } = input
  const stepMs = stepMsOf(range)
  const zoneByName = new Map(input.zones.map(z => [z.name.toLowerCase(), z]))
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
  const groupOf = (name: string): string => {
    if (!name) return by === 'src' ? EXTERNAL_KEY : OUTSIDE_KEY
    const z = zoneByName.get(name.toLowerCase())
    return z ? zoneKey(z.id) : OTHER_KEY
  }
  const items = volume.buckets.flatMap(b => {
    if (pair && !(same(b.src_zone, pair.emitter) && same(b.dst_zone, pair.receiver))) return []
    if (zone !== null && !same(by === 'src' ? b.dst_zone : b.src_zone, zone)) return []
    return [{ at: Date.parse(b.at), group: groupOf(by === 'src' ? b.src_zone : b.dst_zone), value: b.bytes }]
  })
  const from = Date.parse(volume.from)
  const to = Date.parse(volume.to)
  return { ...stack(from, Math.floor((to - 1) / stepMs) * stepMs, items, input.slices, stepMs), range, windowMinutes: RANGE_SPEC[range].ms / 60_000 }
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

type Point = readonly [number, number]

/**
 * The tangents of a monotone cubic through the points (Fritsch-Carlson, as d3's curveMonotoneX the inventory charts
 * draw with): flat where the curve turns or rests, so it never overshoots a bucket's value.
 */
function monotoneTangents(points: readonly Point[]): number[] {
  const n = points.length
  const h = (i: number) => points[i + 1][0] - points[i][0]
  const s = (i: number) => (h(i) ? (points[i + 1][1] - points[i][1]) / h(i) : 0)
  const m = points.map(() => 0)
  for (let i = 1; i < n - 1; i++) {
    const s0 = s(i - 1)
    const s1 = s(i)
    if (s0 * s1 <= 0) continue
    const p = (s0 * h(i) + s1 * h(i - 1)) / (h(i - 1) + h(i))
    m[i] = (Math.sign(s0) + Math.sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p))
  }
  if (n > 2) {
    m[0] = (3 * s(0) - m[1]) / 2
    m[n - 1] = (3 * s(n - 2) - m[n - 2]) / 2
  }
  return m
}

/**
 * The segments of a smooth curve through the points, after its first point (" C ..."; two points are a straight
 * segment). `reverse` draws the same curve from the last point back to the first, to close a band on it.
 */
export function smoothSegments(points: readonly Point[], reverse = false): string {
  if (points.length < 2) return ''
  if (points.length === 2) return ` L ${r2(points[reverse ? 0 : 1][0])} ${r2(points[reverse ? 0 : 1][1])}`
  const m = monotoneTangents(points)
  const segments = points.slice(1).map((end, k) => {
    const start = points[k]
    const third = (end[0] - start[0]) / 3
    const c1: Point = [start[0] + third, start[1] + third * m[k]]
    const c2: Point = [end[0] - third, end[1] - third * m[k + 1]]
    const [a, b, to] = reverse ? [c2, c1, start] : [c1, c2, end]
    return ` C ${r2(a[0])} ${r2(a[1])} ${r2(b[0])} ${r2(b[1])} ${r2(to[0])} ${r2(to[1])}`
  })
  return (reverse ? segments.reverse() : segments).join('')
}

/**
 * The stacked areas of the series, in their order (the first on the baseline): for each, the closed path of its band,
 * the line on its outer edge, a smooth monotone curve through the buckets like the inventory charts, and the y of that
 * edge at each bucket (the hover dots). `invert` stacks downwards from the top of the box (the lower half of a
 * mirrored chart).
 */
export function areaPaths(timeline: Pick<PostureTimeline, 'buckets' | 'series' | 'max'>, box: PlotBox, invert = false): { key: string; area: string; line: string; tops: number[] }[] {
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
    const top = xs.map((x, i): Point => [x, upper[i]])
    const bottom = xs.map((x, i): Point => [x, lower[i]])
    const line = `M ${r2(top[0][0])} ${r2(top[0][1])}${smoothSegments(top)}`
    const last = bottom[bottom.length - 1]
    // The band closes along the edge of the band under it, the same curve drawn backwards.
    const area = `${line} L ${r2(last[0])} ${r2(last[1])}${smoothSegments(bottom, true)} Z`
    return { key: s.key, line, area, tops: upper.map(r2) }
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
