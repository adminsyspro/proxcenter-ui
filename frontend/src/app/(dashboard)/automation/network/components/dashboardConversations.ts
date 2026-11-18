import { isAggregateDst, type FlowDirection, type MicrosegSuggestion, type MicrosegZone, type SuggestionKind } from '@/lib/microseg/types'
import { serviceTokenLabel } from '@/lib/network/serviceNames'

import { flowService } from './microseg/FlowSummary'
import type { ObservationFocus } from './microseg/microsegTabTypes'
import { bareIp } from './microseg/zoneGraph'
import { byText } from './microseg/zoneLayout'
import type { PolicyGuest } from './microseg/zoneModel'

/** The conversations the Dashboard lists, the busiest. */
export const MAX_CONVERSATIONS = 10

/** What a conversation does under one type of observed flow. */
export type ConversationPart = { kind: SuggestionKind; flows: number; hits: number }

/**
 * One conversation: a source and a destination as the Observation names them (a zone, an address, a guest or many
 * destinations), one way, with the services seen between them, busiest first.
 */
export type Conversation = {
  key: string
  direction: FlowDirection
  /** The busiest flow of the pair: both ends are named from it. */
  sample: MicrosegSuggestion
  services: string[]
  flows: number
  hits: number
  parts: ConversationPart[]
  /** Where the Observation list opens on it: the zone it enters, or leaves when outbound. */
  focus: ObservationFocus
  /** On a shared policy, the end of the pair that is a guest of another cluster (the source inbound, the destination outbound). */
  peer?: RemotePeer
}

/**
 * The end of an observed flow that is a guest of another cluster of a shared policy: the source of an inbound flow or
 * the destination of an outbound one. `cluster` null: a cluster the user cannot see (only "another cluster" is said).
 * `zoneId`: the zone the engine put it in, else the zone of its tag, '' for a guest in no zone (named `guest`).
 */
export type RemotePeer = { end: 'src' | 'dst'; cluster: string | null; zoneId: string; guest?: string }

const sourceOf = (s: MicrosegSuggestion) => s.src_zone_id || (s.direction === 'out' ? s.src_key : '') || `ip:${s.src_ip}`

function destinationOf(s: MicrosegSuggestion): string {
  if (isAggregateDst(s)) return 'many'
  return s.dst_zone_id || `ip:${s.dst_ip || s.dst_key || ''}`
}

function focusOf(s: MicrosegSuggestion): ObservationFocus {
  const zoneId = s.direction === 'out' ? s.src_zone_id || s.src_key : s.dst_zone_id
  if (zoneId) return { zoneId }
  return s.src_zone_id ? {} : { source: 'unknown' }
}

type Building = Conversation & { byService: Map<string, number> }

/**
 * Finds the end of an observed flow that is a guest of another cluster of a shared policy, from the guests read (each
 * with its `connectionId`). An address this cluster's guest carries is that guest's (never a peer); an address two other
 * clusters carry is not guessed: "another cluster" (`cluster` null), with only the engine's zone. With `hiddenClusters`
 * (the policy has a cluster the user cannot see), an address the engine put in a zone that no guest read carries is said
 * to be on another cluster, but only when this cluster's addresses are known (a refused inventory gives none) and no
 * member of that zone here lacks a known address (a guest without agent could be the source).
 */
export function remotePeerOf(o: {
  connectionId: string
  guests: readonly PolicyGuest[]
  zones: readonly MicrosegZone[]
  tagPrefix: string
  hiddenClusters: boolean
}): (s: MicrosegSuggestion) => RemotePeer | null {
  const own = o.guests.filter(g => g.connectionId === o.connectionId)
  const local = new Set<string>()
  for (const g of own) for (const ip of g.ips ?? []) local.add(bareIp(ip))
  // The guest of another cluster on each address; null when two other clusters carry it.
  const remote = new Map<string, PolicyGuest | null>()
  for (const g of o.guests) {
    if (g.connectionId === o.connectionId) continue
    for (const ip of g.ips ?? []) {
      const key = bareIp(ip)
      if (!key || local.has(key)) continue
      const known = remote.get(key)
      if (known === undefined) remote.set(key, g)
      else if (known && known.connectionId !== g.connectionId) remote.set(key, null)
    }
  }
  const localKnown = own.some(g => (g.ips ?? []).length > 0)
  const zonesById = new Map(o.zones.map(z => [z.id, z]))
  // PVE lowercases tags: the prefix and the zone names are compared the same way.
  const zoneByTag = new Map(o.zones.map(z => [`${o.tagPrefix}${z.name}`.toLowerCase(), z.id]))
  const zoneOfGuest = (g: PolicyGuest) => g.tags.map(tag => zoneByTag.get(tag.toLowerCase())).find(Boolean) ?? ''
  // The zones with a member here whose address is not known: an address of theirs may be one of those members.
  const unaddressed = new Set(own.filter(g => (g.ips ?? []).length === 0).map(zoneOfGuest).filter(Boolean))
  return s => {
    const end = s.direction === 'out' ? 'dst' : 'src'
    if (end === 'dst' && isAggregateDst(s)) return null
    const ip = end === 'src' ? s.src_ip : s.dst_ip
    const zoneId = end === 'src' ? s.src_zone_id : s.dst_zone_id
    if (!ip) return null
    const key = bareIp(ip)
    if (local.has(key)) return null
    const guest = remote.get(key)
    if (guest === null) return { end, cluster: null, zoneId }
    if (guest) return { end, cluster: guest.connectionId, zoneId: zoneId || zoneOfGuest(guest), guest: guest.name }
    if (o.hiddenClusters && localKnown && zoneId && zonesById.has(zoneId) && !unaddressed.has(zoneId)) return { end, cluster: null, zoneId }
    return null
  }
}

/**
 * The peer of each observed flow of a policy shared by several clusters, each flow seen from the cluster that logged it
 * (its `connection_id`, `fallback` for a row that names none): the end that is a guest of another cluster than that one.
 * One `remotePeerOf` per cluster, built on its first flow.
 */
export function policyPeerOf(o: {
  fallback: string
  guests: readonly PolicyGuest[]
  zones: readonly MicrosegZone[]
  tagPrefix: string
  hiddenClusters: boolean
}): (s: MicrosegSuggestion) => RemotePeer | null {
  const byCluster = new Map<string, (s: MicrosegSuggestion) => RemotePeer | null>()
  const of = (connectionId: string) => {
    let peer = byCluster.get(connectionId)
    if (!peer) {
      peer = remotePeerOf({ connectionId, guests: o.guests, zones: o.zones, tagPrefix: o.tagPrefix, hiddenClusters: o.hiddenClusters })
      byCluster.set(connectionId, peer)
    }
    return peer
  }
  return s => of(s.connection_id || o.fallback)(s)
}

/**
 * The pending observed flows grouped by source, destination and way, the busiest first (ties by key), with how many
 * there are in all. A pair's services sum the hits of their ports ("tcp/22" and "udp/22" are both SSH). `peerOf` (a
 * shared policy): the flows whose peer is a guest of another cluster are a pair of their own, per cluster.
 */
export function topConversations(
  suggestions: readonly MicrosegSuggestion[], max = MAX_CONVERSATIONS, peerOf?: (s: MicrosegSuggestion) => RemotePeer | null,
): { rows: Conversation[]; total: number } {
  const pairs = new Map<string, Building>()
  for (const s of suggestions) {
    if (s.status !== 'pending') continue
    const direction: FlowDirection = s.direction === 'out' ? 'out' : 'in'
    const peer = peerOf?.(s) ?? undefined
    const key = `${direction}|${sourceOf(s)}|${destinationOf(s)}${peer ? `|${peer.cluster ?? ''}` : ''}`
    let pair = pairs.get(key)
    if (!pair) {
      pair = { key, direction, sample: s, services: [], flows: 0, hits: 0, parts: [], focus: focusOf(s), byService: new Map() }
      if (peer) pair.peer = peer
      pairs.set(key, pair)
    }
    if (s.hits > pair.sample.hits) pair.sample = s
    pair.flows += 1
    pair.hits += s.hits
    const label = serviceTokenLabel(flowService({ proto: s.proto.toLowerCase(), dport: s.dport }))
    pair.byService.set(label, (pair.byService.get(label) ?? 0) + s.hits)
    let part = pair.parts.find(p => p.kind === s.kind)
    if (!part) {
      part = { kind: s.kind, flows: 0, hits: 0 }
      pair.parts.push(part)
    }
    part.flows += 1
    part.hits += s.hits
  }
  const rows = [...pairs.values()]
    .sort((a, b) => b.hits - a.hits || byText(a.key, b.key))
    .slice(0, max)
    .map(({ byService, ...pair }) => ({
      ...pair,
      services: [...byService.entries()].sort((a, b) => b[1] - a[1] || byText(a[0], b[0])).map(([label]) => label),
      parts: [...pair.parts].sort((a, b) => b.hits - a.hits || byText(a.kind, b.kind)),
    }))
  return { rows, total: pairs.size }
}
