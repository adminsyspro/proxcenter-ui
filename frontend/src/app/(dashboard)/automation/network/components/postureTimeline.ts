import { EXTERNAL_KEY, GROUP_COLORS, OTHER_KEY, UNZONED_KEY, buildResolver, groupKeyOf, zoneKey, type LensPair } from '@/lib/microseg/trafficLens'
import type { MicrosegEvent, MicrosegZone, SuggestionKind } from '@/lib/microseg/types'

import { NO_VLAN_KEY, type GroupBy, type PostureGuest, type PostureSlice } from './dashboardPosture'
import { bareIp } from './microseg/zoneGraph'

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
}): PostureTimeline {
  const { events, groupBy, verdict, slices, now } = input
  const zoneByName = new Map(input.zones.map(z => [z.name.toLowerCase(), z]))
  const guestByKey = new Map(input.guests.map(g => [g.key, g]))
  const guestIps = input.addresses ? new Set(input.guests.flatMap(g => g.ips.map(bareIp))) : null

  const times = events.map(e => Date.parse(e.ts)).filter(t => Number.isFinite(t))
  const oldest = times.length ? Math.min(...times) : null
  const windowMinutes = oldest === null ? null : Math.max(1, Math.round((now - oldest) / 60_000))

  const kept = events.filter(e => verdict === 'all' || e.verdict === verdict)
  if (oldest === null || kept.length === 0) return { series: [], buckets: [], max: 0, total: 0, windowMinutes }

  const last = Math.floor(now / BUCKET_MS) * BUCKET_MS
  const first = Math.max(Math.floor(oldest / BUCKET_MS) * BUCKET_MS, last - (MAX_BUCKETS - 1) * BUCKET_MS)
  // An event stamped a little ahead of this clock (node clocks drift) counts in the last bucket.
  const clamp = (at: number) => (at >= last + BUCKET_MS && at < now + BUCKET_MS ? last : at)
  const items = kept.map(e => ({ at: clamp(Date.parse(e.ts)), group: groupOfEvent(e, groupBy, zoneByName, guestByKey, guestIps), value: 1 }))
  return { ...stack(first, last, items, slices), windowMinutes }
}

/**
 * The values per 5-minute bucket from `first` to `last` (bucket starts), one series per slice of the donut that has
 * a value (in its order and colour), a group the donut does not show in "Other". Values outside the range are left out.
 */
function stack(first: number, last: number, items: readonly { at: number; group: string; value: number }[], slices: readonly TimelineSeries[]) {
  const shown = new Set(slices.map(s => s.key))
  const buckets: TimelineBucket[] = []
  for (let start = first; start <= last; start += BUCKET_MS) buckets.push({ start, total: 0, counts: {} })

  const used = new Set<string>()
  let total = 0
  for (const item of items) {
    if (!Number.isFinite(item.at) || item.at < first || item.at >= last + BUCKET_MS || item.value <= 0) continue
    const bucket = buckets[Math.floor((item.at - first) / BUCKET_MS)]
    const key = shown.has(item.group) ? item.group : OTHER_KEY
    bucket.counts[key] = (bucket.counts[key] ?? 0) + item.value
    bucket.total += item.value
    used.add(key)
    total += item.value
  }

  const series: TimelineSeries[] = slices.filter(s => used.has(s.key))
  if (used.has(OTHER_KEY) && !shown.has(OTHER_KEY)) series.push({ key: OTHER_KEY, kind: 'other', name: '', color: GROUP_COLORS.other })
  return { series, buckets, max: Math.max(0, ...buckets.map(b => b.total)), total }
}

/** The window of the sFlow volume chart: the last 2 hours, on 5-minute bucket edges (the read changes every 5 minutes). */
export const VOLUME_WINDOW_MS = 2 * 60 * 60_000

export function volumeWindow(now: number): { from: number; to: number } {
  const to = Math.floor(now / BUCKET_MS) * BUCKET_MS + BUCKET_MS
  return { from: to - VOLUME_WINDOW_MS, to }
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
 * donut groups by source zone; the zone from the guest tags, through the lens resolver); by VLAN or node, what the
 * guests RECEIVED (the donut groups by destination). A VM the connection does not hold is Unknown.
 */
export function postureVolume(input: {
  series: readonly VmSeries[]
  groupBy: GroupBy
  zones: readonly MicrosegZone[]
  tagPrefix: string
  guests: readonly PostureGuest[]
  slices: readonly TimelineSeries[]
  from: number
  to: number
}): PostureTimeline {
  const { groupBy, guests } = input
  const byVmid = new Map(guests.map(g => [vmidOf(g), g]))
  const resolve = buildResolver([...input.zones], input.tagPrefix, guests.map(g => ({ vmid: vmidOf(g), name: g.key, tags: g.tags, ips: [] })))
  const groupOfVm = (vmid: number): string => {
    if (groupBy === 'zone') return groupKeyOf(resolve('', vmid))
    const guest = byVmid.get(vmid)
    if (!guest) return EXTERNAL_KEY
    if (groupBy === 'node') return `node:${guest.node}`
    return guest.vlans.length ? `vlan:${guest.vlans[0]}` : NO_VLAN_KEY
  }
  const items = input.series.flatMap(vm => {
    const group = groupOfVm(vm.vmid)
    // InfluxDB's aggregateWindow stamps each sum with the END of its window (internal/sflow/influx.go, the
    // `aggregateWindow(every: ..., fn: sum)` queries): the bucket starts one step before.
    return (vm.points ?? []).map(p => ({ at: p.time * 1000 - BUCKET_MS, group, value: groupBy === 'zone' ? p.bytes_out : p.bytes_in }))
  })
  return { ...stack(input.from, input.to - BUCKET_MS, items, input.slices), windowMinutes: VOLUME_WINDOW_MS / 60_000 }
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
 * The stacked areas of the series, in their order (the first at the bottom): for each, the closed path of its band
 * and the line on top of it, straight segments from bucket to bucket.
 */
export function areaPaths(timeline: Pick<PostureTimeline, 'buckets' | 'series' | 'max'>, box: PlotBox): { key: string; area: string; line: string }[] {
  const { buckets, series, max } = timeline
  if (!buckets.length || max <= 0) return []
  const xs = bucketXs(buckets.length, box)
  const values = buckets.length === 1 ? [buckets[0], buckets[0]] : buckets
  const base = box.top + box.height
  const y = (v: number) => base - (v / max) * box.height
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
