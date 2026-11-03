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
  if (groupBy === 'node') return `node:${e.node}`
  if (groupBy === 'vlan') {
    const guest = guestByKey.get(`${e.type}/${e.vmid}`)
    if (!guest) return EXTERNAL_KEY
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
  const items = kept.map(e => ({ at: Date.parse(e.ts), group: groupOfEvent(e, groupBy, zoneByName, guestByKey, guestIps), value: 1 }))
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

/** The guests of the connection the sFlow pairs name (by VMID, either end), sorted: none means no sFlow data for it. */
export function connectionVmids(pairs: readonly LensPair[], guests: readonly PostureGuest[]): number[] {
  const mine = new Set(guests.map(vmidOf))
  const seen = new Set<number>()
  for (const p of pairs) for (const vmid of [p.src_vmid, p.dst_vmid]) if (vmid && mine.has(vmid)) seen.add(vmid)
  return [...seen].sort((a, b) => a - b)
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
    return (vm.points ?? []).map(p => ({ at: p.time * 1000, group, value: groupBy === 'zone' ? p.bytes_out : p.bytes_in }))
  })
  return { ...stack(input.from, input.to - BUCKET_MS, items, input.slices), windowMinutes: VOLUME_WINDOW_MS / 60_000 }
}
