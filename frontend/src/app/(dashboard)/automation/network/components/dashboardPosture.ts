import type { FirewallCoverage } from '@/hooks/useZeroTrust'
import { EXTERNAL_KEY, GROUP_COLORS, OTHER_KEY, UNZONED_KEY, zoneKey } from '@/lib/microseg/trafficLens'
import type { MicrosegFlow, MicrosegStatus, MicrosegSuggestion, MicrosegZone } from '@/lib/microseg/types'
import { serviceTokenLabel } from '@/lib/network/serviceNames'

import { flowService } from './microseg/FlowSummary'
import { objectColour } from './microseg/objectColour'
import { bareIp } from './microseg/zoneGraph'
import { byText } from './microseg/zoneLayout'
import { guestKey, type PolicyGuest } from './microseg/zoneModel'

/**
 * The "Posture" Dashboard of /automation/network (UA50), pure: the observed traffic of the pending flows (the
 * orchestrator's memory) read per zone, VLAN or node, its distribution, the top services, and the figures of the
 * header chips. No request here.
 */

/** Pending observed flows the Dashboard reads, the same page as the zone map (one SWR key for both). */
export const POSTURE_SUGGESTIONS_LIMIT = 200
/** Slices of the donut before "Other". */
export const MAX_SLICES = 8
/** Chords drawn inside the donut. */
export const MAX_CHORDS = 6
/** Rows of the top services table. */
export const MAX_SERVICES = 8

/**
 * How the observed traffic is grouped: by the zone that EMITS it (`zone`, the source zone), by the zone that RECEIVES
 * it (`dstzone`, the zone of the guest that logged it), or by the VLAN / node of the destination guest.
 */
export type GroupBy = 'zone' | 'dstzone' | 'vlan' | 'node'
export const GROUP_BYS: readonly GroupBy[] = ['zone', 'dstzone', 'vlan', 'node']

/** A grouping on zones (source or destination): the history carries it, the guest list is not needed. */
export const isZoneGrouping = (g: GroupBy) => g === 'zone' || g === 'dstzone'

export const NO_VLAN_KEY = 'vlan:none'
const vlanKey = (vlan: number) => `vlan:${vlan}`
const nodeKey = (node: string) => `node:${node}`

/** A guest as the Dashboard reads it: the coverage row (tags, node, VLANs) and, once read, its addresses. */
export type PostureGuest = { key: string; node: string; tags: string[]; vlans: number[]; ips: string[] }

/**
 * The guests of the connection: the rows of the coverage route (node, tags, VLANs, no address) joined by type and
 * VMID with the guest list when it was read (its addresses put an observed flow on a guest). Either may be missing.
 */
export function postureGuests(rows: FirewallCoverage['guests'] | undefined, guests: readonly PolicyGuest[] | null): PostureGuest[] {
  const byKey = new Map<string, PostureGuest>()
  for (const r of rows ?? []) {
    const key = guestKey({ type: r.type, vmid: Number(r.vmid) })
    byKey.set(key, { key, node: r.node, tags: r.tags ?? [], vlans: r.vlans ?? [], ips: [] })
  }
  for (const g of guests ?? []) {
    const key = guestKey(g)
    const known = byKey.get(key)
    if (known) known.ips = g.ips ?? []
    else byKey.set(key, { key, node: g.node, tags: g.tags, vlans: [], ips: g.ips ?? [] })
  }
  return [...byKey.values()]
}

export type SliceKind = 'zone' | 'unzoned' | 'external' | 'other' | 'vlan' | 'novlan' | 'node'

/** One slice of the donut: a group, its hits, and how many guests it holds (null when that cannot be told). */
export type PostureSlice = {
  key: string
  kind: SliceKind
  /** The zone or node name, the VLAN tag as text; empty for the groups named by the page. */
  name: string
  zone?: MicrosegZone
  hits: number
  percent: number
  members: number | null
  color: string
  /** Angles in radians, clockwise from twelve o'clock. */
  start: number
  end: number
}

export type PostureChord = { source: string; target: string; hits: number; color: string }

type Lookup = {
  zonesById: ReadonlyMap<string, MicrosegZone>
  /** The zone of a guest from its `<tag_prefix><zone name>` tag. */
  zoneOfGuest: (g: PostureGuest) => MicrosegZone | undefined
  /** The guest that carries an address, null when no guest list was read. */
  guestOf: ((ip: string) => PostureGuest | undefined) | null
}

function lookupOf(zones: readonly MicrosegZone[], tagPrefix: string, guests: readonly PostureGuest[], addresses: boolean): Lookup {
  // PVE lowercases tags: the prefix and the zone names are compared the same way.
  const zoneByTag = new Map(zones.map(z => [`${tagPrefix}${z.name}`.toLowerCase(), z]))
  const byIp = new Map<string, PostureGuest>()
  for (const g of guests) for (const ip of g.ips) {
    const bare = bareIp(ip)
    if (bare && !byIp.has(bare)) byIp.set(bare, g)
  }
  return {
    zonesById: new Map(zones.map(z => [z.id, z])),
    zoneOfGuest: g => g.tags.map(tag => zoneByTag.get(tag.toLowerCase())).find(Boolean),
    guestOf: addresses ? (ip: string) => byIp.get(bareIp(ip)) : null,
  }
}

/** The group of one end of an observed flow. Without the guest list, a source in no zone is Unknown / External. */
function groupOf(groupBy: GroupBy, zoneId: string, ip: string, look: Lookup): string {
  if (isZoneGrouping(groupBy)) {
    if (look.zonesById.has(zoneId)) return zoneKey(zoneId)
    return ip && look.guestOf?.(ip) ? UNZONED_KEY : EXTERNAL_KEY
  }
  const guest = ip ? look.guestOf?.(ip) : undefined
  if (!guest) return EXTERNAL_KEY
  if (groupBy === 'node') return nodeKey(guest.node)
  return guest.vlans.length ? vlanKey(guest.vlans[0]) : NO_VLAN_KEY
}

const NAMED_KINDS: Record<string, SliceKind> = { [UNZONED_KEY]: 'unzoned', [EXTERNAL_KEY]: 'external', [OTHER_KEY]: 'other', [NO_VLAN_KEY]: 'novlan' }

function sliceKind(key: string): SliceKind {
  const named = NAMED_KINDS[key]
  if (named) return named
  if (key.startsWith('zone:')) return 'zone'
  return key.startsWith('vlan:') ? 'vlan' : 'node'
}

const NAMED_COLORS: Partial<Record<SliceKind, string>> = {
  unzoned: GROUP_COLORS.unzoned, external: GROUP_COLORS.external, other: GROUP_COLORS.other, novlan: GROUP_COLORS.zone,
}

/** How many guests a group holds: zone members by tag, guests in no zone, per VLAN (first NIC) or node. */
function membersOf(kind: SliceKind, name: string, zone: MicrosegZone | undefined, guests: readonly PostureGuest[], look: Lookup): number | null {
  if (!guests.length || kind === 'external' || kind === 'other') return null
  const counts: Record<Exclude<SliceKind, 'external' | 'other'>, (g: PostureGuest) => boolean> = {
    zone: g => look.zoneOfGuest(g)?.id === zone?.id,
    unzoned: g => !look.zoneOfGuest(g),
    vlan: g => String(g.vlans[0]) === name,
    novlan: g => g.vlans.length === 0,
    node: g => g.node === name,
  }
  return guests.filter(counts[kind]).length
}

export type PostureTraffic = {
  total: number
  slices: PostureSlice[]
  chords: PostureChord[]
}

/**
 * The donut: the hits of the pending observed flows per SOURCE zone (Unzoned and Unknown / External included), or
 * per VLAN / node of the DESTINATION guest; the busiest first, the groups past `MAX_SLICES` in one "Other" slice.
 * The chords join two groups that exchange traffic, the `MAX_CHORDS` busiest pairs, in the colour of the source.
 */
export function postureTraffic(input: {
  groupBy: GroupBy
  zones: readonly MicrosegZone[]
  tagPrefix: string
  suggestions: readonly MicrosegSuggestion[]
  guests: readonly PostureGuest[]
  /** The guest list (addresses) was read: observed flows can be put on guests. */
  addresses: boolean
}): PostureTraffic {
  const { groupBy, zones, suggestions, guests } = input
  const look = lookupOf(zones, input.tagPrefix, guests, input.addresses)
  const side = (s: MicrosegSuggestion, end: 'src' | 'dst') => (end === 'src'
    ? groupOf(groupBy, s.src_zone_id, s.src_ip, look)
    : groupOf(groupBy, s.dst_zone_id, s.dst_ip, look))
  const sliceSide = groupBy === 'zone' ? 'src' : 'dst'

  const sums = new Map<string, number>()
  let total = 0
  for (const s of suggestions) {
    const key = side(s, sliceSide)
    sums.set(key, (sums.get(key) ?? 0) + s.hits)
    total += s.hits
  }
  const sorted = [...sums.entries()].filter(([, hits]) => hits > 0).sort((a, b) => b[1] - a[1] || byText(a[0], b[0]))
  const kept = sorted.slice(0, MAX_SLICES)
  const rest = sorted.slice(MAX_SLICES).reduce((sum, [, hits]) => sum + hits, 0)
  if (rest > 0) kept.push([OTHER_KEY, rest])
  const shown = new Set(kept.map(([key]) => key))

  let angle = 0
  const slices: PostureSlice[] = kept.map(([key, hits]) => {
    const kind = sliceKind(key)
    const zone = kind === 'zone' ? look.zonesById.get(key.slice('zone:'.length)) : undefined
    const name = zone?.name ?? (kind === 'vlan' || kind === 'node' ? key.slice(5) : '')
    const sweep = total > 0 ? (hits / total) * 2 * Math.PI : 0
    const slice: PostureSlice = {
      key, kind, name, zone, hits,
      percent: total > 0 ? (hits / total) * 100 : 0,
      members: membersOf(kind, name, zone, guests, look),
      color: NAMED_COLORS[kind] ?? (zone?.color || objectColour(`${kind}:${name}`, zones)),
      start: angle,
      end: angle + sweep,
    }
    angle += sweep
    return slice
  })

  const colorOf = new Map(slices.map(s => [s.key, s.color]))
  const pairs = new Map<string, PostureChord>()
  for (const s of suggestions) {
    const fold = (key: string) => (shown.has(key) ? key : OTHER_KEY)
    const source = fold(side(s, 'src'))
    const target = fold(side(s, 'dst'))
    if (source === target || !shown.has(source) || !shown.has(target)) continue
    const id = `${source}>${target}`
    const pair = pairs.get(id) ?? { source, target, hits: 0, color: colorOf.get(source)! }
    pair.hits += s.hits
    pairs.set(id, pair)
  }
  const chords = [...pairs.values()]
    .sort((a, b) => b.hits - a.hits || byText(a.source, b.source) || byText(a.target, b.target))
    .slice(0, MAX_CHORDS)

  return { total, slices, chords }
}

/** A point of the circle of radius `r` at `angle` (clockwise from twelve o'clock), centre 0,0. */
export function polar(r: number, angle: number): { x: number; y: number } {
  return { x: r * Math.sin(angle), y: -r * Math.cos(angle) }
}

const round = (n: number) => Math.round(n * 100) / 100

/**
 * The SVG path of an arc of the circle of radius `r` from `start` to `end`, drawn as a thick stroke. A full turn is
 * two half arcs (an arc whose ends meet draws nothing).
 */
export function arcPath(r: number, start: number, end: number): string {
  const a = polar(r, start)
  if (end - start >= 2 * Math.PI - 1e-6) {
    const b = polar(r, start + Math.PI)
    return `M ${round(a.x)} ${round(a.y)} A ${r} ${r} 0 0 1 ${round(b.x)} ${round(b.y)} A ${r} ${r} 0 0 1 ${round(a.x)} ${round(a.y)}`
  }
  const b = polar(r, end)
  const large = end - start > Math.PI ? 1 : 0
  return `M ${round(a.x)} ${round(a.y)} A ${r} ${r} 0 ${large} 1 ${round(b.x)} ${round(b.y)}`
}

/** A chord between the middles of two slices, curved through the centre. */
export function chordPath(r: number, from: Pick<PostureSlice, 'start' | 'end'>, to: Pick<PostureSlice, 'start' | 'end'>): string {
  const a = polar(r, (from.start + from.end) / 2)
  const b = polar(r, (to.start + to.end) / 2)
  return `M ${round(a.x)} ${round(a.y)} Q 0 0 ${round(b.x)} ${round(b.y)}`
}

export type Share = { hits: number; percent: number }

export type PostureDistribution = {
  total: number
  /** From a zone or a guest of the connection to a zone. */
  eastWest: Share
  /** From an address in no zone and on no known guest (every source in no zone while the guest list is not read). */
  unknown: Share
  /** Flows of the policy: allowed, never counted. */
  allowed: number
  wouldBlock: number
  blocked: number
  /** Names of the zones the blocked flows were dropped in. */
  blockedZones: string[]
}

const shareOf = (hits: number, total: number): Share => ({ hits, percent: total > 0 ? (hits / total) * 100 : 0 })

/** How the observed hits split, and the counts of allowed, would-be-blocked and blocked flows. */
export function postureDistribution(input: {
  zones: readonly MicrosegZone[]
  tagPrefix: string
  flows: readonly MicrosegFlow[]
  suggestions: readonly MicrosegSuggestion[]
  guests: readonly PostureGuest[]
  addresses: boolean
}): PostureDistribution {
  const look = lookupOf(input.zones, input.tagPrefix, input.guests, input.addresses)
  let eastWest = 0
  let unknown = 0
  const blockedZones = new Set<string>()
  for (const s of input.suggestions) {
    // A flow is only logged towards a zone (the outside is not filtered in v1): one to a zone gone since is left out.
    if (!look.zonesById.has(s.dst_zone_id)) continue
    if (groupOf('zone', s.src_zone_id, s.src_ip, look) === EXTERNAL_KEY) unknown += s.hits
    else eastWest += s.hits
    if (s.kind === 'blocked') {
      const zone = look.zonesById.get(s.dst_zone_id)
      if (zone) blockedZones.add(zone.name)
    }
  }
  const total = eastWest + unknown
  return {
    total,
    eastWest: shareOf(eastWest, total),
    unknown: shareOf(unknown, total),
    allowed: input.flows.length,
    wouldBlock: input.suggestions.filter(s => s.kind === 'would_block').length,
    blocked: input.suggestions.filter(s => s.kind === 'blocked').length,
    blockedZones: [...blockedZones].sort(byText),
  }
}

export type ServiceStatus = 'allowed' | 'not_covered' | 'blocked'

/**
 * One row of the top services: a service by its name ("SSH", or the raw "tcp/9999" for a port without one) and status,
 * the protocol/port tokens it was seen or allowed on ("tcp/22", "udp/22"), its flows and hits.
 */
export type ServiceRow = { key: string; label: string; tokens: string[]; flows: number; hits: number | null; status: ServiceStatus }

const tokenOf = (proto: string, dport: string) => flowService({ proto: proto.toLowerCase(), dport })

/** Adds one flow of `token` to the row of its service name and status. */
function addTo(rows: Map<string, ServiceRow>, status: ServiceStatus, token: string, hits: number | null) {
  const label = serviceTokenLabel(token)
  const key = `${status}|${label}`
  const row = rows.get(key) ?? { key, label, tokens: [], flows: 0, hits: hits === null ? null : 0, status }
  if (!row.tokens.includes(token)) row.tokens.push(token)
  row.flows += 1
  if (hits !== null) row.hits = (row.hits ?? 0) + hits
  rows.set(key, row)
}

/**
 * The services by hits, one row per service name and status: the pending observed flows (not covered while observing,
 * blocked while enforcing), the busiest first, then the services the policy allows (its flows, which carry no counter).
 * The tokens of one name ("tcp/22" and "udp/22" are both SSH) sum their flows and hits; the row keeps them for its
 * tooltip.
 */
export function topServices(suggestions: readonly MicrosegSuggestion[], flows: readonly MicrosegFlow[], max = MAX_SERVICES): ServiceRow[] {
  const observed = new Map<string, ServiceRow>()
  for (const s of suggestions) addTo(observed, s.kind === 'blocked' ? 'blocked' : 'not_covered', tokenOf(s.proto, s.dport), s.hits)
  const allowed = new Map<string, ServiceRow>()
  for (const f of flows) addTo(allowed, 'allowed', tokenOf(f.proto, f.dport), null)
  for (const row of [...observed.values(), ...allowed.values()]) row.tokens.sort(byText)
  const busiest = [...observed.values()].sort((a, b) => (b.hits ?? 0) - (a.hits ?? 0) || byText(a.key, b.key))
  const allowedRows = [...allowed.values()].sort((a, b) => b.flows - a.flows || byText(a.key, b.key))
  return [...busiest, ...allowedRows].slice(0, max)
}

/** Zones that enforce, of all the zones; null while the status is not read. */
export function zonesEnforced(status: Pick<MicrosegStatus, 'zones_by_state'> | undefined): { enforced: number; total: number } | null {
  const z = status?.zones_by_state
  if (!z) return null
  return { enforced: z.enforce ?? 0, total: (z.enforce ?? 0) + (z.observe ?? 0) + (z.disabled ?? 0) }
}

/** Running guests filtered by Proxmox, of the running guests; null until the coverage route measured them. */
export function protectedRunning(coverage: Pick<FirewallCoverage, 'computedAt' | 'guests'> | null | undefined): { protected: number; running: number } | null {
  if (!coverage?.computedAt || !coverage.guests) return null
  const running = coverage.guests.filter(r => r.status === 'running')
  return { protected: running.filter(r => r.enabled === true).length, running: running.length }
}

/**
 * The groups of the zone grouping without the donut (the map panel): every zone in its colour (the donut's), then
 * Unknown / External. A chart on them stacks the source zones in the order of the policy.
 */
export function zoneSeries(zones: readonly MicrosegZone[]): Pick<PostureSlice, 'key' | 'kind' | 'name' | 'color'>[] {
  return [
    ...zones.map(z => ({ key: zoneKey(z.id), kind: 'zone' as const, name: z.name, color: z.color || objectColour(`zone:${z.name}`, zones) })),
    { key: EXTERNAL_KEY, kind: 'external' as const, name: '', color: GROUP_COLORS.external },
  ]
}
