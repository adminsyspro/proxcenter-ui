import type { MicrosegDrift, MicrosegDriftList } from '@/lib/microseg/types'

import { CLUSTER_DRIFT_KINDS, DRIFT_KINDS, clusterDriftKey, driftKey } from './driftLabels'

/** The drifts of one kind, a group of the Drifts table. */
export type DriftGroup<T extends MicrosegDrift = MicrosegDrift> = { kind: string; drifts: T[] }

/** The drifts about the clusters of a shared policy come first, then the kinds in the order the sub-tab documents them. */
const KNOWN_ORDER: readonly string[] = [...CLUSTER_DRIFT_KINDS, ...DRIFT_KINDS]
const ORDER = new Map<string, number>(KNOWN_ORDER.map((k, i) => [k, i]))

/** Kinds in the order the sub-tab documents them, then the kinds this version does not know, by name. */
const byKind = (a: string, b: string) => (ORDER.get(a) ?? KNOWN_ORDER.length) - (ORDER.get(b) ?? KNOWN_ORDER.length) || (a < b ? -1 : Number(a > b))

/** A drift with the cluster it was read from. */
export type ClusterDrift = MicrosegDrift & { connection_id: string }

/**
 * The drifts of every cluster of a policy in one list, each with the cluster it was read from, in the order of `ids`.
 * `answered`: at least one cluster answered; `computed`: one of them has done its first full run (an empty list of a
 * cluster that has not means nothing yet). A cluster that did not answer adds no row.
 */
export function mergeDrifts(byCluster: Readonly<Record<string, MicrosegDriftList | undefined>>, ids: readonly string[]): { drifts: ClusterDrift[]; computed: boolean; answered: boolean } {
  const drifts: ClusterDrift[] = []
  let computed = false
  let answered = false
  for (const id of ids) {
    const list = byCluster[id]
    if (!list) continue
    answered = true
    if (list.computed) computed = true
    for (const d of list.drifts) drifts.push({ ...d, connection_id: id })
  }
  return { drifts, computed, answered }
}

/** The key of a row (selection, Ignore): today's key on a policy of one cluster, with the cluster on a shared one. */
export function driftRowKey(d: ClusterDrift, shared: boolean): string {
  return shared ? clusterDriftKey(d, d.connection_id) : driftKey(d)
}

/** How many drifts of each kind, in the order of the groups (only the kinds present). */
export function kindCounts(drifts: readonly MicrosegDrift[]): { kind: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const d of drifts) counts.set(d.kind, (counts.get(d.kind) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => byKind(a[0], b[0])).map(([kind, count]) => ({ kind, count }))
}

/** The drifts grouped by kind (every kind the API returned, none empty), `only` keeping one kind. */
export function groupDrifts<T extends MicrosegDrift>(drifts: readonly T[], only: string | null = null): DriftGroup<T>[] {
  const groups = new Map<string, T[]>()
  for (const d of drifts) {
    if (only && d.kind !== only) continue
    const list = groups.get(d.kind) ?? []
    list.push(d)
    groups.set(d.kind, list)
  }
  return [...groups.entries()].sort((a, b) => byKind(a[0], b[0])).map(([kind, list]) => ({ kind, drifts: list }))
}
