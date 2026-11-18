// src/lib/microseg/useMerged.ts

import { useCallback, useEffect, useMemo, useRef } from 'react'

import { MAX_POLICY_CONNECTIONS } from './useMicrosegGroup'

/** What a read of one cluster gives back (the shape of the SWR hooks of this folder). */
export type ClusterRead<T> = { data?: T; error?: unknown; loading: boolean; reload?: () => unknown }

export type MergedClusters<T> = {
  /**
   * The answer of each cluster read, by connection ID; undefined while it loads. A failed read may still hold its
   * previous answer (SWR keeps it): a list of several clusters leaves out the rows of the clusters under `errors`.
   */
  byCluster: Record<string, T | undefined>
  /** The failed reads, by connection ID: those clusters show no row, the others keep theirs. */
  errors: Record<string, unknown>
  /** True while one cluster has neither answered nor failed. */
  loading: boolean
  /** Reads every cluster again. */
  reload: () => void
}

/** Why a cluster beyond the slots is not read (the backend never links that many). */
const NOT_READ = new Error('more clusters than read slots')

/*
 * Which clusters each screen reads, one read per cluster through its own relay:
 * - the group's clusters once it is loaded (clustersToRead): the connection alone for a screen not given the group, or
 *   while it is unknown or its read failed (`clusterIds ?? [connectionId]`), nothing while it is still read;
 * - the status and the check: the visible clusters only (one outside the user's scope is neither read nor asked);
 * - the dashboard: the clusters of the policy that are also among the connections the user sees.
 */

/**
 * The clusters a per-cluster list reads: the connection alone for a screen that is not given the group (a test, an older
 * caller), nothing while the group is still read (`anchor` undefined), then every cluster of the group, whichever
 * cluster the page was opened from.
 */
export function clustersToRead(connectionId: string, group: { anchor?: string; clusterIds?: readonly string[] }): string[] {
  if (!group.clusterIds) return connectionId ? [connectionId] : []
  return group.anchor === undefined ? [] : [...group.clusterIds]
}

/**
 * One read per cluster of a shared policy, merged by connection ID. `useOne` is a hook (an SWR read of one connection,
 * nothing read for `null`): it is called MAX_POLICY_CONNECTIONS times on every render, the unused slots with `null`, so
 * the hook count never changes with the group. A single cluster issues exactly the request `useOne` issues for it.
 * `refreshMs` is handed to every read (its refresh interval); without it each read keeps its own default.
 */
export function useMergedClusters<T>(
  clusterIds: readonly string[],
  useOne: (connId: string | null, refreshMs?: number) => ClusterRead<T>,
  refreshMs?: number,
): MergedClusters<T> {
  const idsKey = [...new Set(clusterIds.filter(Boolean))].join('\n')
  const ids = useMemo(() => (idsKey ? idsKey.split('\n') : []), [idsKey])
  const slot = (i: number) => ids[i] ?? null
  // A fixed list of calls, never a loop: React needs the same hooks on every render.
  const slots = [
    useOne(slot(0), refreshMs), useOne(slot(1), refreshMs), useOne(slot(2), refreshMs), useOne(slot(3), refreshMs),
    useOne(slot(4), refreshMs), useOne(slot(5), refreshMs), useOne(slot(6), refreshMs), useOne(slot(7), refreshMs),
  ]
  const [d0, d1, d2, d3, d4, d5, d6, d7] = slots.map(s => s.data)
  const [e0, e1, e2, e3, e4, e5, e6, e7] = slots.map(s => s.error)
  const loads = slots.map(s => (s.loading ? 1 : 0)).join('')
  // The reload functions of the reads change on every render (they close over SWR's mutate): kept in a ref, so the
  // merged result keeps its identity while the data does not change.
  const reloads = useRef(slots.map(s => s.reload))
  useEffect(() => { reloads.current = slots.map(s => s.reload) })

  const merged = useMemo(() => {
    const data = [d0, d1, d2, d3, d4, d5, d6, d7]
    const failed = [e0, e1, e2, e3, e4, e5, e6, e7]
    const byCluster: Record<string, T | undefined> = {}
    const errors: Record<string, unknown> = {}
    let loading = false
    ids.forEach((id, i) => {
      if (i >= MAX_POLICY_CONNECTIONS) {
        errors[id] = NOT_READ
        return
      }
      byCluster[id] = data[i]
      if (failed[i] != null) errors[id] = failed[i]
      else if (loads[i] === '1' || data[i] === undefined) loading = true
    })
    return { byCluster, errors, loading }
  }, [ids, d0, d1, d2, d3, d4, d5, d6, d7, e0, e1, e2, e3, e4, e5, e6, e7, loads])

  const count = ids.length
  const reload = useCallback(() => {
    for (const r of reloads.current.slice(0, count)) void r?.()
  }, [count])

  return useMemo(() => ({ ...merged, reload }), [merged, reload])
}

/**
 * The answers a list shows: on one cluster every answer (an older one stays on screen under its error, as it always
 * did); on several, only the clusters whose last read worked, so a cluster that cannot be read shows no stale row.
 */
export function shownAnswers<T>(merged: Pick<MergedClusters<T>, 'byCluster' | 'errors'>, shared: boolean): Record<string, T | undefined> {
  if (!shared) return merged.byCluster
  return Object.fromEntries(Object.entries(merged.byCluster).filter(([id]) => !(id in merged.errors)))
}
