import type { MicrosegEvent, MicrosegFlow, MicrosegSuggestion, MicrosegZone } from '@/lib/microseg/types'

import { onPair, type TrafficPair } from '../postureTimeline'
import { EXTERNAL_ID, OUTSIDE_ID, UNZONED_ID } from './zoneGraph'
import { byText } from './zoneLayout'

/** An end of a pair of the map: a zone, Unknown / External, Outside, the unzoned guests, or an address of the guest view. */
export type PairEnd = { kind: 'zone' | 'external' | 'outside' | 'unzoned' | 'ip'; name: string; zone: MicrosegZone | null }

/** The end a group of the map stands for (a zone circle or box, a boundary box), with the name the map gives it. */
export function pairEndOf(groupId: string, zonesById: ReadonlyMap<string, MicrosegZone>, name: string): PairEnd {
  if (groupId.startsWith('zone:')) {
    const zone = zonesById.get(groupId.slice(5)) ?? null
    return { kind: zone ? 'zone' : 'external', name, zone }
  }
  if (groupId === OUTSIDE_ID) return { kind: 'outside', name, zone: null }
  if (groupId === UNZONED_ID) return { kind: 'unzoned', name, zone: null }
  if (groupId.startsWith('ip:')) return { kind: 'ip', name, zone: null }
  return { kind: groupId === EXTERNAL_ID ? 'external' : 'ip', name, zone: null }
}

/** The pair as the traffic history and the events name it: the zone names, '' for an end in no zone. */
export const trafficPairOf = (src: PairEnd, dst: PairEnd): TrafficPair => ({ emitter: src.zone?.name ?? '', receiver: dst.zone?.name ?? '' })

/** The events of the pair: received by its destination from its source (inbound), or emitted by its source towards it (outbound). */
export function pairEventFilter(pair: TrafficPair): (e: MicrosegEvent) => boolean {
  return e => onPair(pair, 'in', e) || onPair(pair, 'out', e)
}

const busiest = (a: MicrosegSuggestion, b: MicrosegSuggestion) => b.hits - a.hits || byText(a.id, b.id)

/**
 * The pending suggestions of the pair, the busiest first: the observed flows the edge (or the cell) stands for, plus,
 * from a zone to Outside, the pending outbound flows that zone emitted towards no zone (the map draws no edge for them).
 */
export function pairSuggestions(observed: readonly MicrosegSuggestion[], suggestions: readonly MicrosegSuggestion[], src: PairEnd, dst: PairEnd): MicrosegSuggestion[] {
  const byId = new Map(observed.map(s => [s.id, s]))
  if (src.zone && dst.kind === 'outside') {
    const id = src.zone.id
    for (const s of suggestions) {
      if (s.status === 'pending' && s.direction === 'out' && !s.dst_zone_id && (s.src_zone_id || s.src_key) === id) byId.set(s.id, s)
    }
  }
  return [...byId.values()].sort(busiest)
}

/** The source side of a declared flow matches the end (null: the end is no zone, External nor Outside). */
function sideMatches(end: PairEnd, zoneId: string, cidr: string): boolean | null {
  if (end.kind === 'zone') return !cidr && zoneId === end.zone!.id
  if (end.kind === 'external' || end.kind === 'outside') return !!cidr
  return null
}

/**
 * The declared flows of the pair, in id order: from the source zone (or a CIDR for External) to the destination zone (or
 * a CIDR for Outside), whatever the map filters show. Between other ends (unzoned guests, addresses) the edge's own.
 */
export function pairFlows(flows: readonly MicrosegFlow[], src: PairEnd, dst: PairEnd, shown: readonly MicrosegFlow[]): MicrosegFlow[] {
  const kept = flows.filter(f => sideMatches(src, f.src_zone_id, f.src_cidr) && sideMatches(dst, f.dst_zone_id, f.dst_cidr))
  const known = sideMatches(src, '', '') !== null && sideMatches(dst, '', '') !== null
  return [...(known ? kept : shown)].sort((a, b) => byText(a.id, b.id))
}

/** What a new flow of the pair is prefilled with: its zones; null when neither end is a zone. */
export function newPairFlow(src: PairEnd, dst: PairEnd): { src_zone_id?: string; dst_zone_id?: string } | null {
  if (!src.zone && !dst.zone) return null
  return { ...(src.zone ? { src_zone_id: src.zone.id } : {}), ...(dst.zone ? { dst_zone_id: dst.zone.id } : {}) }
}
