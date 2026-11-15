import { isAggregateDst, type FlowDirection, type MicrosegSuggestion, type SuggestionKind } from '@/lib/microseg/types'
import { serviceTokenLabel } from '@/lib/network/serviceNames'

import { flowService } from './microseg/FlowSummary'
import type { ObservationFocus } from './microseg/microsegTabTypes'
import { byText } from './microseg/zoneLayout'

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
}

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
 * The pending observed flows grouped by source, destination and way, the busiest first (ties by key), with how many
 * there are in all. A pair's services sum the hits of their ports ("tcp/22" and "udp/22" are both SSH).
 */
export function topConversations(suggestions: readonly MicrosegSuggestion[], max = MAX_CONVERSATIONS): { rows: Conversation[]; total: number } {
  const pairs = new Map<string, Building>()
  for (const s of suggestions) {
    if (s.status !== 'pending') continue
    const direction: FlowDirection = s.direction === 'out' ? 'out' : 'in'
    const key = `${direction}|${sourceOf(s)}|${destinationOf(s)}`
    let pair = pairs.get(key)
    if (!pair) {
      pair = { key, direction, sample: s, services: [], flows: 0, hits: 0, parts: [], focus: focusOf(s), byService: new Map() }
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
