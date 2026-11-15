import type { MicrosegDrift } from '@/lib/microseg/types'

import { DRIFT_KINDS } from './driftLabels'

/** The drifts of one kind, a group of the Drifts table. */
export type DriftGroup = { kind: string; drifts: MicrosegDrift[] }

const ORDER = new Map<string, number>(DRIFT_KINDS.map((k, i) => [k, i]))

/** Kinds in the order the sub-tab documents them, then the kinds this version does not know, by name. */
const byKind = (a: string, b: string) => (ORDER.get(a) ?? DRIFT_KINDS.length) - (ORDER.get(b) ?? DRIFT_KINDS.length) || (a < b ? -1 : Number(a > b))

/** How many drifts of each kind, in the order of the groups (only the kinds present). */
export function kindCounts(drifts: readonly MicrosegDrift[]): { kind: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const d of drifts) counts.set(d.kind, (counts.get(d.kind) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => byKind(a[0], b[0])).map(([kind, count]) => ({ kind, count }))
}

/** The drifts grouped by kind (every kind the API returned, none empty), `only` keeping one kind. */
export function groupDrifts(drifts: readonly MicrosegDrift[], only: string | null = null): DriftGroup[] {
  const groups = new Map<string, MicrosegDrift[]>()
  for (const d of drifts) {
    if (only && d.kind !== only) continue
    const list = groups.get(d.kind) ?? []
    list.push(d)
    groups.set(d.kind, list)
  }
  return [...groups.entries()].sort((a, b) => byKind(a[0], b[0])).map(([kind, list]) => ({ kind, drifts: list }))
}
