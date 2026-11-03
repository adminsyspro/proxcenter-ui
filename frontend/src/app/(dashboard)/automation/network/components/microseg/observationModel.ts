/**
 * The bar of the hits column: the share of the busiest flow of the page, in percent. A flow with hits never draws an
 * empty bar (at least 2 %), a page with no hit at all draws none.
 */
export function hitsShare(hits: number, max: number): number {
  if (!Number.isFinite(max) || !Number.isFinite(hits) || max <= 0 || hits <= 0) return 0
  return Math.max(2, Math.round((Math.min(hits, max) / max) * 100))
}

/** The most hits of a flow among `rows` (0 for none). */
export function maxHits(rows: ReadonlyArray<{ hits: number }>): number {
  return rows.reduce((max, r) => Math.max(max, r.hits), 0)
}

/** The observed flows of a page that go to one destination zone ('' = an address in no zone). */
export type ObservationGroup<S> = { key: string; name: string; rows: S[]; hits: number }

/**
 * The flows of a page grouped by destination zone, in the order of the page within a group: the zones with the most
 * hits first (ties by name), the unknown destination last.
 */
export function groupByDestination<S extends { dst_zone_id: string; hits: number }>(rows: readonly S[], nameOf: (zoneId: string) => string): ObservationGroup<S>[] {
  const groups = new Map<string, ObservationGroup<S>>()
  for (const r of rows) {
    let group = groups.get(r.dst_zone_id)
    if (!group) {
      group = { key: r.dst_zone_id, name: nameOf(r.dst_zone_id), rows: [], hits: 0 }
      groups.set(r.dst_zone_id, group)
    }
    group.rows.push(r)
    group.hits += r.hits
  }
  const unknownLast = (g: ObservationGroup<S>) => (g.key === '' ? 1 : 0)
  return [...groups.values()].sort((a, b) => unknownLast(a) - unknownLast(b) || b.hits - a.hits || a.name.localeCompare(b.name))
}

/** The collapsed groups as stored in this browser: a JSON list of zone ids, anything else is none. */
export function decodeCollapsed(raw: string | null): string[] {
  if (!raw) return []
  try {
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

export const encodeCollapsed = (keys: string[]) => JSON.stringify(keys)
