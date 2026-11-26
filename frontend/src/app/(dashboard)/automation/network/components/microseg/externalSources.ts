import { createContext } from 'react'

import type { MicrosegSuggestion } from '@/lib/microseg/types'

import { EXTERNAL_ID, bareIp, byGuestPair, type MapEdgeData } from './zoneGraph'

/** The addresses the Unknown / External tooltip lists, the busiest first. */
export const EXTERNAL_TOP = 10

/** One address behind Unknown / External: the hits the map draws from it. */
export type ExternalSource = { ip: string; hits: number }

/** What the Unknown / External box tells on hover: its busiest addresses, and how many there are in all. */
export type ExternalSources = { top: ExternalSource[]; count: number }

/** Null out of a map, or on a map that draws nothing from Unknown / External. */
export const ExternalSourcesContext = createContext<ExternalSources | null>(null)

type EdgeLike = { source: string; data?: unknown }

/**
 * The addresses behind the Unknown / External box: the observed flows of the edges drawn from it, their hits summed per
 * source address. A suggestion keeps its hits by pair of addresses (`suggestions`: the rows as read); every rendering
 * draws a row from External when its source is in no zone, so each row on an edge from it is counted once, from its
 * pairs, without the addresses of the guests in no zone (`guestIps`): those are guests, drawn as such, not unknown.
 */
export function externalSources(edges: readonly EdgeLike[], suggestions: readonly MicrosegSuggestion[], guestIps: ReadonlySet<string>, limit = EXTERNAL_TOP): ExternalSources | null {
  const byId = new Map(suggestions.map(s => [s.id, s]))
  // The rows drawn from External, once each (the guest-to-guest rendering draws one per pair of addresses).
  const rows = new Map<string, MicrosegSuggestion>()
  for (const e of edges) {
    if (e.source !== EXTERNAL_ID) continue
    for (const s of (e.data as Partial<MapEdgeData> | undefined)?.observed ?? []) rows.set(s.id, byId.get(s.id) ?? s)
  }
  const hits = new Map<string, number>()
  for (const pair of byGuestPair([...rows.values()])) {
    const ip = bareIp(pair.src_ip || '')
    if (ip && !guestIps.has(ip)) hits.set(ip, (hits.get(ip) ?? 0) + pair.hits)
  }
  const all = [...hits].map(([ip, n]) => ({ ip, hits: n })).sort((a, b) => b.hits - a.hits || a.ip.localeCompare(b.ip))
  return all.length ? { top: all.slice(0, limit), count: all.length } : null
}
