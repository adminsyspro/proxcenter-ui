/**
 * The bar of the hits column: the share of the busiest flow of the page, in percent. A flow with hits never draws an
 * empty bar (at least 2 %), a page with no hit at all draws none.
 */
export function hitsShare(hits: number, max: number): number {
  if (!(max > 0) || !(hits > 0)) return 0
  return Math.max(2, Math.round((Math.min(hits, max) / max) * 100))
}

/** The most hits of a flow among `rows` (0 for none). */
export function maxHits(rows: ReadonlyArray<{ hits: number }>): number {
  return rows.reduce((max, r) => (r.hits > max ? r.hits : max), 0)
}
