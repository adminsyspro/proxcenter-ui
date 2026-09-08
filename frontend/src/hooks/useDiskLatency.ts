'use client'

import { useMemo } from 'react'

import { useLicense } from '@/contexts/LicenseContext'
import type { ClusterMetrics, DiskLatency, StorageLatency } from '@/lib/orchestrator/client'

import { useSWRFetch } from './useSWRFetch'
import { useRefreshInterval } from './useRefreshInterval'

export type GuestLatency = { latencyMs: number; windowMaxMs: number; disks: DiskLatency[] }

export interface DiskLatencyIndex {
  /** Keyed `${connectionId}:${vmid}`. */
  guests: Map<string, GuestLatency>
  /** Keyed `${connectionId}:${storage}`. */
  storages: Map<string, StorageLatency>
  /** Length of the sliding window behind the window_* fields, in minutes. */
  windowMinutes: number
  /** True once at least one guest or storage reports a latency. */
  available: boolean
}

const DEFAULT_WINDOW_MINUTES = 5
const EMPTY: DiskLatencyIndex = { guests: new Map(), storages: new Map(), windowMinutes: DEFAULT_WINDOW_MINUTES, available: false }

/**
 * Guest disk latency for every connection the caller can see (#881), indexed
 * for the list and storage views. The orchestrator derives it from QEMU block
 * statistics and publishes it in its cluster metrics, an Enterprise feature:
 * Community callers get an empty, never-fetching index so the columns hide.
 */
export function useDiskLatency(): DiskLatencyIndex {
  const { isEnterprise } = useLicense()
  const refreshInterval = useRefreshInterval(60000)
  const { data } = useSWRFetch<Record<string, ClusterMetrics> | ClusterMetrics[]>(
    isEnterprise ? '/api/v1/orchestrator/metrics' : null,
    { refreshInterval, revalidateOnFocus: false },
  )

  return useMemo(() => {
    if (!data) return EMPTY

    // The proxy route returns a record keyed by connection id; an array is
    // tolerated so a shape change upstream degrades to a lookup miss, not a crash.
    const all: ClusterMetrics[] = Array.isArray(data)
      ? data
      : Object.values(data).filter((m): m is ClusterMetrics => Boolean(m) && typeof m === 'object')

    const guests = new Map<string, GuestLatency>()
    const storages = new Map<string, StorageLatency>()
    let windowMinutes = DEFAULT_WINDOW_MINUTES

    for (const m of all) {
      const connId = m.connection_id
      if (!connId) continue
      if (typeof m.disk_latency_window_minutes === 'number' && m.disk_latency_window_minutes > 0) {
        windowMinutes = m.disk_latency_window_minutes
      }
      for (const vm of m.vms || []) {
        if (typeof vm.disk_latency_ms !== 'number' || !Array.isArray(vm.disk_latency) || vm.disk_latency.length === 0) continue
        guests.set(`${connId}:${vm.vmid}`, {
          latencyMs: vm.disk_latency_ms,
          windowMaxMs: typeof vm.disk_latency_window_max_ms === 'number' ? vm.disk_latency_window_max_ms : vm.disk_latency_ms,
          disks: vm.disk_latency,
        })
      }
      for (const s of m.storages || []) {
        if (!s?.storage || typeof s.latency_ms !== 'number' || s.measured === false) continue
        storages.set(`${connId}:${s.storage}`, s)
      }
    }

    return { guests, storages, windowMinutes, available: guests.size > 0 || storages.size > 0 }
  }, [data])
}
