// src/lib/microseg/trafficLens.ts
//
// The micro-segmentation lens of the Network flows page (UA35): the sFlow IP
// pairs read through the zones of a connection. Pure functions only, fed with
// data the page already has (the pairs, the draft policy, the pending
// suggestions and the guests with their tags and addresses): no request here.

import { bareIp } from '@/app/(dashboard)/automation/network/components/microseg/zoneGraph'

import type { MicrosegFlow, MicrosegSuggestion, MicrosegZone } from './types'

/** An sFlow IP pair, as /api/v1/orchestrator/sflow?endpoint=ip-pairs answers it. */
export type LensPair = {
  src_ip: string
  dst_ip: string
  src_vmid?: number
  dst_vmid?: number
  bytes: number
  packets: number
  /** "TCP", "UDP", "ICMP", "GRE" or "Other" (the orchestrator's names). */
  protocol: string
  dst_port: number
}

/** A guest of the connection with its tags and known addresses. */
export type LensGuest = { vmid: number; name: string; tags: string[]; ips?: string[] }

/** Where an address sits: a zone member, a guest in no zone, or nothing the connection knows. */
export type LensEndpoint =
  | { kind: 'zone'; zone: MicrosegZone; guest: string }
  | { kind: 'unzoned'; guest: string }
  | { kind: 'external' }

export type Resolver = (ip: string, vmid?: number) => LensEndpoint

export const UNZONED_KEY = 'unzoned'
export const EXTERNAL_KEY = 'external'
export const OTHER_KEY = 'other'
export const zoneKey = (zoneId: string) => `zone:${zoneId}`

/** The colours of the two groups that are not zones, and of the "Other" slice. */
export const GROUP_COLORS = { unzoned: '#9e9e9e', external: '#616161', other: '#bdbdbd', zone: '#64748b' } as const

/** The group an endpoint is drawn in: its zone, "unzoned" or "external". */
export function groupKeyOf(endpoint: LensEndpoint): string {
  if (endpoint.kind === 'zone') return zoneKey(endpoint.zone.id)
  return endpoint.kind === 'unzoned' ? UNZONED_KEY : EXTERNAL_KEY
}

/**
 * Resolves an address to its zone: the guest that carries it (from the guest addresses), else the only guest with
 * the VMID the pair was attributed to, then the zone of that guest from its `<tag_prefix><zone name>` tag. A guest
 * with no zone tag is unzoned; an address no guest carries is external.
 */
export function buildResolver(zones: MicrosegZone[], tagPrefix: string, guests: LensGuest[]): Resolver {
  // PVE lowercases tags: the prefix and the zone names are compared the same way.
  const zoneByTag = new Map(zones.map(z => [`${tagPrefix}${z.name}`.toLowerCase(), z]))
  const endpointOf = (g: LensGuest): LensEndpoint => {
    const zone = g.tags.map(tag => zoneByTag.get(tag.toLowerCase())).find(Boolean)
    return zone ? { kind: 'zone', zone, guest: g.name } : { kind: 'unzoned', guest: g.name }
  }
  const byIp = new Map<string, LensEndpoint>()
  const byVmid = new Map<number, LensEndpoint | null>()
  for (const g of guests) {
    const endpoint = endpointOf(g)
    for (const ip of g.ips ?? []) {
      const key = bareIp(ip)
      if (key && !byIp.has(key)) byIp.set(key, endpoint)
    }
    // Two guests with one VMID (it should not happen in a cluster): the VMID tells nothing.
    byVmid.set(g.vmid, byVmid.has(g.vmid) ? null : endpoint)
  }
  return (ip, vmid) => byIp.get(bareIp(ip)) ?? (vmid ? byVmid.get(vmid) : null) ?? { kind: 'external' }
}

/** True when `port` is in a port list such as "22", "80,443" or "8000:8080". An empty list is every port. */
export function portInSpec(port: number, spec: string): boolean {
  if (!spec.trim()) return true
  return spec.split(',').some(part => {
    const [low, high] = part.split(':').map(s => Number.parseInt(s.trim(), 10))
    return high === undefined ? port === low : port >= low && port <= high
  })
}

const sameProto = (rule: string, pair: string) => rule === 'any' || rule.toLowerCase() === pair.toLowerCase()

/** The ports only count for TCP and UDP: an ICMP flow covers every ICMP packet. */
function servicePorts(proto: string, port: number, spec: string): boolean {
  const p = proto.toLowerCase()
  return p === 'tcp' || p === 'udp' ? portInSpec(port, spec) : true
}

/** A flow of the draft that lets this zone pair talk on this service (zone to zone flows only). */
export function coveringFlow(flows: MicrosegFlow[], srcZoneId: string, dstZoneId: string, protocol: string, port: number): MicrosegFlow | undefined {
  return flows.find(f => f.src_zone_id === srcZoneId && f.dst_zone_id === dstZoneId && !f.src_cidr && !f.dst_cidr
    && sameProto(f.proto, protocol) && servicePorts(protocol, port, f.dport))
}

/** A pending suggestion the engine logged for this pair and service. */
export function matchingSuggestion(
  suggestions: MicrosegSuggestion[], pair: LensPair, srcZoneId: string, dstZoneId: string, kind: MicrosegSuggestion['kind'],
): MicrosegSuggestion | undefined {
  const src = bareIp(pair.src_ip)
  const dst = bareIp(pair.dst_ip)
  return suggestions.find(s => s.status === 'pending' && s.kind === kind
    && (s.src_ip ? bareIp(s.src_ip) === src : s.src_zone_id === srcZoneId)
    && (s.dst_ip ? bareIp(s.dst_ip) === dst : s.dst_zone_id === dstZoneId)
    && sameProto(s.proto, pair.protocol) && servicePorts(pair.protocol, pair.dst_port, s.dport))
}

export type LensStatus = 'allowed' | 'not_covered' | 'blocked' | 'unknown'

export type PairVerdict = {
  status: LensStatus
  src: LensEndpoint
  dst: LensEndpoint
  /** The flow that allows the pair. */
  flow?: MicrosegFlow
  /** Allowed because both ends are in the same zone, which does not isolate its members. */
  intraZone?: boolean
  /** The pending suggestion of the pair: blocked, or would be blocked. */
  suggestion?: MicrosegSuggestion
}

/**
 * The status of a pair and service against the draft: allowed (a zone to zone flow covers it, or both ends are in
 * one zone that does not isolate its members), blocked (a pending blocked suggestion matches it), not covered (no
 * flow; a would-block suggestion may be attached), unknown (an end is in no zone).
 */
export function pairVerdict(pair: LensPair, resolve: Resolver, flows: MicrosegFlow[], suggestions: MicrosegSuggestion[]): PairVerdict {
  const src = resolve(pair.src_ip, pair.src_vmid)
  const dst = resolve(pair.dst_ip, pair.dst_vmid)
  if (src.kind !== 'zone' || dst.kind !== 'zone') return { status: 'unknown', src, dst }
  const flow = coveringFlow(flows, src.zone.id, dst.zone.id, pair.protocol, pair.dst_port)
  if (flow) return { status: 'allowed', src, dst, flow }
  if (src.zone.id === dst.zone.id && !src.zone.isolate_members) return { status: 'allowed', src, dst, intraZone: true }
  const blocked = matchingSuggestion(suggestions, pair, src.zone.id, dst.zone.id, 'blocked')
  if (blocked) return { status: 'blocked', src, dst, suggestion: blocked }
  const wouldBlock = matchingSuggestion(suggestions, pair, src.zone.id, dst.zone.id, 'would_block')
  return { status: 'not_covered', src, dst, suggestion: wouldBlock }
}

/** The pairs with their ends replaced by their group key, summed per source, destination, protocol and port. */
export function aggregateByGroup(pairs: LensPair[], resolve: Resolver): LensPair[] {
  const sums = new Map<string, LensPair>()
  for (const p of pairs) {
    const src = groupKeyOf(resolve(p.src_ip, p.src_vmid))
    const dst = groupKeyOf(resolve(p.dst_ip, p.dst_vmid))
    const key = `${src}|${dst}|${p.protocol}|${p.dst_port}`
    const sum = sums.get(key)
    if (sum) {
      sum.bytes += p.bytes
      sum.packets += p.packets
    } else {
      sums.set(key, { src_ip: src, dst_ip: dst, bytes: p.bytes, packets: p.packets, protocol: p.protocol, dst_port: p.dst_port })
    }
  }
  return [...sums.values()].sort((a, b) => b.bytes - a.bytes)
}

export type TrafficShare = { bytes: number; percent: number }

export type TrafficDistribution = {
  total: number
  /** Both ends in the same zone. */
  intra: TrafficShare
  /** Between two zones, or with a guest in no zone. */
  between: TrafficShare
  /** From a guest of the connection to an address it does not know. */
  toOutside: TrafficShare
  /** From an address the connection does not know. */
  fromUnknown: TrafficShare
}

const share = (bytes: number, total: number): TrafficShare => ({ bytes, percent: total > 0 ? (bytes / total) * 100 : 0 })

/** How the bytes split: inside a zone, between zones, to the outside, from an unknown source. */
export function trafficDistribution(pairs: LensPair[], resolve: Resolver): TrafficDistribution {
  let intra = 0
  let between = 0
  let toOutside = 0
  let fromUnknown = 0
  for (const p of pairs) {
    const src = resolve(p.src_ip, p.src_vmid)
    const dst = resolve(p.dst_ip, p.dst_vmid)
    if (src.kind === 'external') fromUnknown += p.bytes
    else if (dst.kind === 'external') toOutside += p.bytes
    else if (src.kind === 'zone' && dst.kind === 'zone' && src.zone.id === dst.zone.id) intra += p.bytes
    else between += p.bytes
  }
  const total = intra + between + toOutside + fromUnknown
  return {
    total,
    intra: share(intra, total),
    between: share(between, total),
    toOutside: share(toOutside, total),
    fromUnknown: share(fromUnknown, total),
  }
}

export type ZoneSlice = { key: string; bytes: number; percent: number; zone?: MicrosegZone }

/** The bytes per source group, busiest first, the groups beyond `max` summed in one "other" slice. */
export function sourceZoneSlices(pairs: LensPair[], resolve: Resolver, max = 10): ZoneSlice[] {
  const sums = new Map<string, ZoneSlice>()
  let total = 0
  for (const p of pairs) {
    const src = resolve(p.src_ip, p.src_vmid)
    const key = groupKeyOf(src)
    const slice = sums.get(key) ?? { key, bytes: 0, percent: 0, zone: src.kind === 'zone' ? src.zone : undefined }
    slice.bytes += p.bytes
    sums.set(key, slice)
    total += p.bytes
  }
  const sorted = [...sums.values()].filter(s => s.bytes > 0).sort((a, b) => b.bytes - a.bytes || a.key.localeCompare(b.key))
  const kept = sorted.slice(0, max)
  const rest = sorted.slice(max).reduce((sum, s) => sum + s.bytes, 0)
  if (rest > 0) kept.push({ key: OTHER_KEY, bytes: rest, percent: 0 })
  return kept.map(s => ({ ...s, percent: total > 0 ? (s.bytes / total) * 100 : 0 }))
}

/** The colour of a group: its zone colour, or the grey of the unzoned, external and other groups. */
export function groupColor(key: string, zonesById: ReadonlyMap<string, MicrosegZone>): string {
  if (key === UNZONED_KEY) return GROUP_COLORS.unzoned
  if (key === EXTERNAL_KEY) return GROUP_COLORS.external
  if (key === OTHER_KEY) return GROUP_COLORS.other
  return zonesById.get(key.replace(/^zone:/, ''))?.color || GROUP_COLORS.zone
}

/** What the Create flow window starts from: the two zones and the service of the pair. */
export function flowDraftOf(pair: LensPair, srcZoneId: string, dstZoneId: string) {
  const proto = pair.protocol.toLowerCase()
  const known = proto === 'tcp' || proto === 'udp' || proto === 'icmp'
  return {
    src_zone_id: srcZoneId,
    dst_zone_id: dstZoneId,
    proto: known ? proto : 'any',
    dport: (proto === 'tcp' || proto === 'udp') && pair.dst_port > 0 ? String(pair.dst_port) : '',
  }
}
