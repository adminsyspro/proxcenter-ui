import { useMemo } from 'react'

import { MAX_POLICY_CONNECTIONS } from '@/lib/microseg/useMicrosegGroup'

import { useZoneGuests } from './useZoneGuests'
import type { PolicyGuest } from './zoneModel'

/** Why a cluster beyond the slots is not read (the backend never links that many). */
const NOT_READ = new Error('more clusters than guest read slots')
/** Why a cluster that answered is counted unread: its guest list could not be read (`useZoneGuests` `unlisted`). */
export const UNLISTED = new Error('the guest list of this cluster could not be read')

/** The status of a cluster says its PVE API cannot be reached (`engine.unreachable_since`). */
export const UNREACHABLE = new Error('the engine cannot reach this cluster')

/**
 * The clusters whose guests are missing on a shared policy: the failed or unlisted reads, plus each visible cluster
 * whose status (already read by the banner) says it cannot be reached and that lists no guest.
 */
export function withUnreachable(
  errors: Readonly<Record<string, unknown>>,
  guests: readonly PolicyGuest[],
  statuses: Readonly<Record<string, { engine: { unreachable_since?: string } } | undefined>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...errors }
  for (const [id, status] of Object.entries(statuses)) {
    if (id in out || !status?.engine.unreachable_since) continue
    if (!guests.some(g => g.connectionId === id)) out[id] = UNREACHABLE
  }
  return out
}

export type GroupGuests = {
  /** The guests of every cluster that answered, each with its `connectionId`, in the order of `clusterIds`. */
  guests: PolicyGuest[]
  /** True until every cluster answered or failed. */
  loading: boolean
  /**
   * The failed reads, by connection ID: those clusters contribute no guest. On a shared policy, a cluster whose guest
   * list could not be read (an empty partial answer, `UNLISTED`) is one of them; a single cluster is read as before.
   */
  errors: Record<string, unknown>
  /** As `useZoneGuests` says it: loading, error when every cluster failed, ready otherwise. */
  status: 'loading' | 'ready' | 'error'
  reload: () => void
}

/**
 * The guests of every cluster sharing a policy: one `useZoneGuests` read per cluster (same SWR key, so the cache is
 * shared with the screens that read one cluster, the same coverage fallback on a 403, no read while the tab is hidden
 * beyond what that hook does). A single cluster issues exactly the request `useZoneGuests` issues. The hook count stays
 * the same whatever the group: `MAX_POLICY_CONNECTIONS` slots, the unused ones read nothing.
 */
export function useGroupGuests(clusterIds: readonly string[]): GroupGuests {
  const idsKey = [...new Set(clusterIds.filter(Boolean))].join('\n')
  const ids = useMemo(() => (idsKey ? idsKey.split('\n') : []), [idsKey])
  const slot = (i: number) => ids[i] ?? null
  // A fixed list of calls, never a loop: React needs the same hooks on every render.
  const slots = [
    useZoneGuests(slot(0)), useZoneGuests(slot(1)), useZoneGuests(slot(2)), useZoneGuests(slot(3)),
    useZoneGuests(slot(4)), useZoneGuests(slot(5)), useZoneGuests(slot(6)), useZoneGuests(slot(7)),
  ]
  const [g0, g1, g2, g3, g4, g5, g6, g7] = slots.map(s => s.guests)
  const states = slots.map(s => s.status).join()
  // A shared policy only: a cluster that answered without its guest list is unread, so no count passes for complete.
  const shared = ids.length > 1
  const failures = slots.map(s => s.error ?? (shared && s.status === 'ready' && s.unlisted ? UNLISTED : undefined))
  const [e0, e1, e2, e3, e4, e5, e6, e7] = failures

  const merged = useMemo(() => {
    const lists = [g0, g1, g2, g3, g4, g5, g6, g7]
    const slotStatus = states.split(',')
    const failed = [e0, e1, e2, e3, e4, e5, e6, e7]
    const guests: PolicyGuest[] = []
    const errors: Record<string, unknown> = {}
    let loading = ids.length === 0
    ids.forEach((id, i) => {
      if (i >= MAX_POLICY_CONNECTIONS) errors[id] = NOT_READ
      else if (slotStatus[i] === 'error') errors[id] = failed[i] ?? true
      else if (slotStatus[i] === 'loading') loading = true
      else if (failed[i] === UNLISTED) errors[id] = UNLISTED
      else guests.push(...lists[i])
    })
    let status: GroupGuests['status'] = 'ready'
    if (loading) status = 'loading'
    else if (Object.keys(errors).length === ids.length) status = 'error'
    return { guests, errors, loading, status }
  }, [ids, g0, g1, g2, g3, g4, g5, g6, g7, states, e0, e1, e2, e3, e4, e5, e6, e7])

  // Each slot's reload is stable while its read does not change: the group's reload and the returned object only
  // change with the clusters or the data.
  const [r0, r1, r2, r3, r4, r5, r6, r7] = slots.map(s => s.reload)
  const reload = useMemo(() => {
    const keys = [r0, r1, r2, r3, r4, r5, r6, r7].slice(0, ids.length)
    return () => { for (const k of keys) void k() }
  }, [ids.length, r0, r1, r2, r3, r4, r5, r6, r7])
  return useMemo(() => ({ ...merged, reload }), [merged, reload])
}

/**
 * The names of clusters as the user sees them; null when one of them has no name the user may see (the lookup gives
 * back the bare ID, or there is no lookup): the caller then says it without naming any.
 */
export function visibleClusterNames(ids: readonly string[], clusterName?: (id: string) => string): string[] | null {
  const names: string[] = []
  for (const id of ids) {
    const name = clusterName?.(id)
    if (!name || name === id) return null
    names.push(name)
  }
  return names
}

/** The names of the clusters whose guests could not be read (see `visibleClusterNames`). */
export function unreadClusterNames(errors: Readonly<Record<string, unknown>>, clusterName?: (id: string) => string): string[] | null {
  return visibleClusterNames(Object.keys(errors), clusterName)
}
