import { useMemo } from 'react'

import { useVMFirewallCoverage, type FirewallCoverage } from '@/hooks/useZeroTrust'
import { MAX_POLICY_CONNECTIONS } from '@/lib/microseg/useMicrosegGroup'
import type { MicrosegEvent, MicrosegTraffic, MicrosegVolume } from '@/lib/microseg/types'

import type { TimelineRange } from './postureTimeline'
import { usePostureEvents } from './usePostureEvents'
import { usePostureHistory } from './usePostureHistory'
import { useVolumeHistory } from './useVolumeHistory'

/**
 * The per-cluster reads of the Dashboard of a shared policy, one read per cluster through its own relay, as
 * `useMergedClusters` does: `MAX_POLICY_CONNECTIONS` fixed slots (React needs the same hooks on every render), the
 * unused ones read nothing, and a single cluster issues exactly the request its own hook issues. Each read keeps the
 * cadence of its hook. A failed cluster is in `errors`; the others keep their answers.
 */
export type ClusterReads<T> = {
  byCluster: Record<string, T | undefined>
  errors: Record<string, unknown>
  /** True while one cluster has neither answered nor failed. */
  loading: boolean
}

/** Why a cluster beyond the slots is not read (the backend never links that many). */
const NOT_READ = new Error('more clusters than read slots')

/** The slots' answers by cluster. */
function bySlot<T>(ids: readonly string[], slots: readonly { data?: T; error?: unknown }[]): ClusterReads<T> {
  const byCluster: Record<string, T | undefined> = {}
  const errors: Record<string, unknown> = {}
  let loading = false
  ids.forEach((id, i) => {
    if (i >= MAX_POLICY_CONNECTIONS) {
      errors[id] = NOT_READ
      return
    }
    byCluster[id] = slots[i].data
    if (slots[i].error != null) errors[id] = slots[i].error
    else if (slots[i].data === undefined) loading = true
  })
  return { byCluster, errors, loading }
}

function useIds(clusterIds: readonly string[]) {
  const key = [...new Set(clusterIds.filter(Boolean))].join('\n')
  return useMemo(() => (key ? key.split('\n') : []), [key])
}

/** Coverage reads (they reach Proxmox, through a server cache) that run at the same time at most. */
export const COVERAGE_CONCURRENCY = 2

/**
 * The firewall coverage of each cluster (the guest rows: node, tags, VLANs): one read per cluster when the Dashboard
 * mounts, never on a timer (the hook polls only while the server is still computing), never again for a filter.
 * The route reaches Proxmox through the server's cache, so at most `COVERAGE_CONCURRENCY` clusters are asked at a time:
 * a slot waits until the slot two places before it answered or failed.
 */
export function usePolicyCoverage(clusterIds: readonly string[]): ClusterReads<FirewallCoverage> {
  const ids = useIds(clusterIds)
  const settled = (r: { data?: unknown; error?: unknown }) => r.data !== undefined || r.error != null
  const slot = (i: number, before: { data?: unknown; error?: unknown } | null) => (ids[i] && (!before || settled(before)) ? ids[i] : null)
  // A fixed list of calls, never a loop; each slot past the first two waits for the one two places before.
  const s0 = useVMFirewallCoverage(slot(0, null))
  const s1 = useVMFirewallCoverage(slot(1, null))
  const s2 = useVMFirewallCoverage(slot(2, s0))
  const s3 = useVMFirewallCoverage(slot(3, s1))
  const s4 = useVMFirewallCoverage(slot(4, s2))
  const s5 = useVMFirewallCoverage(slot(5, s3))
  const s6 = useVMFirewallCoverage(slot(6, s4))
  const s7 = useVMFirewallCoverage(slot(7, s5))
  const slots = [s0, s1, s2, s3, s4, s5, s6, s7]
  // Only an answer with figures counts: one still computing without a row yet is not in.
  const data = slots.map(s => (s.data?.computedAt ? s.data : undefined))
  const errors = slots.map(s => s.error)
  const computing = slots.map(s => (s.data && !s.data.computedAt ? 1 : 0)).join('')
  const [d0, d1, d2, d3, d4, d5, d6, d7] = data
  const [e0, e1, e2, e3, e4, e5, e6, e7] = errors
  return useMemo(() => {
    const merged = bySlot(ids, [d0, d1, d2, d3, d4, d5, d6, d7].map((d, i) => ({ data: d, error: [e0, e1, e2, e3, e4, e5, e6, e7][i] })))
    return computing.includes('1') ? { ...merged, loading: true } : merged
  }, [ids, d0, d1, d2, d3, d4, d5, d6, d7, e0, e1, e2, e3, e4, e5, e6, e7, computing])
}

/**
 * The persisted history of each cluster over the range (orchestrator database, no Proxmox call), at the cadence of
 * `usePostureHistory`. `range` is the one the first answer belongs to (each answer may still be the previous range's).
 */
export function usePolicyHistory(clusterIds: readonly string[], range: TimelineRange): ClusterReads<MicrosegTraffic> & { range: TimelineRange } {
  const ids = useIds(clusterIds)
  const slot = (i: number) => ids[i] ?? null
  const slots = [
    usePostureHistory(slot(0), range), usePostureHistory(slot(1), range), usePostureHistory(slot(2), range), usePostureHistory(slot(3), range),
    usePostureHistory(slot(4), range), usePostureHistory(slot(5), range), usePostureHistory(slot(6), range), usePostureHistory(slot(7), range),
  ]
  const [d0, d1, d2, d3, d4, d5, d6, d7] = slots.map(s => s.history)
  const [e0, e1, e2, e3, e4, e5, e6, e7] = slots.map(s => s.error)
  const shown = slots.find((s, i) => i < ids.length && s.history)?.range ?? range
  return useMemo(() => {
    const data = [d0, d1, d2, d3, d4, d5, d6, d7]
    const failed = [e0, e1, e2, e3, e4, e5, e6, e7]
    return { ...bySlot(ids, data.map((d, i) => ({ data: d, error: failed[i] }))), range: shown }
  }, [ids, d0, d1, d2, d3, d4, d5, d6, d7, e0, e1, e2, e3, e4, e5, e6, e7, shown])
}

/** The sFlow volume of each cluster over the range (orchestrator database, no Proxmox call), at the pace of the history. */
export function usePolicyVolume(clusterIds: readonly string[], range: TimelineRange): ClusterReads<MicrosegVolume> & { range: TimelineRange } {
  const ids = useIds(clusterIds)
  const slot = (i: number) => ids[i] ?? null
  const slots = [
    useVolumeHistory(slot(0), range), useVolumeHistory(slot(1), range), useVolumeHistory(slot(2), range), useVolumeHistory(slot(3), range),
    useVolumeHistory(slot(4), range), useVolumeHistory(slot(5), range), useVolumeHistory(slot(6), range), useVolumeHistory(slot(7), range),
  ]
  const [d0, d1, d2, d3, d4, d5, d6, d7] = slots.map(s => s.volume)
  const [e0, e1, e2, e3, e4, e5, e6, e7] = slots.map(s => s.error)
  const shown = slots.find((s, i) => i < ids.length && s.volume)?.range ?? range
  return useMemo(() => {
    const data = [d0, d1, d2, d3, d4, d5, d6, d7]
    const failed = [e0, e1, e2, e3, e4, e5, e6, e7]
    return { ...bySlot(ids, data.map((d, i) => ({ data: d, error: failed[i] }))), range: shown }
  }, [ids, d0, d1, d2, d3, d4, d5, d6, d7, e0, e1, e2, e3, e4, e5, e6, e7, shown])
}

/** The events of the ring of each cluster (orchestrator memory, no Proxmox call), at the cadence of `usePostureEvents`. */
export function usePolicyEvents(clusterIds: readonly string[], zone?: string): ClusterReads<MicrosegEvent[]> {
  const ids = useIds(clusterIds)
  const slot = (i: number) => ids[i] ?? null
  const slots = [
    usePostureEvents(slot(0), zone), usePostureEvents(slot(1), zone), usePostureEvents(slot(2), zone), usePostureEvents(slot(3), zone),
    usePostureEvents(slot(4), zone), usePostureEvents(slot(5), zone), usePostureEvents(slot(6), zone), usePostureEvents(slot(7), zone),
  ]
  const [d0, d1, d2, d3, d4, d5, d6, d7] = slots.map(s => s.events)
  const [e0, e1, e2, e3, e4, e5, e6, e7] = slots.map(s => s.error)
  return useMemo(() => {
    const data = [d0, d1, d2, d3, d4, d5, d6, d7]
    const failed = [e0, e1, e2, e3, e4, e5, e6, e7]
    return bySlot(ids, data.map((d, i) => ({ data: d, error: failed[i] })))
  }, [ids, d0, d1, d2, d3, d4, d5, d6, d7, e0, e1, e2, e3, e4, e5, e6, e7])
}
