'use client'

import { useMemo } from 'react'

import { useLicense } from '@/contexts/LicenseContext'
import { inferStepSeconds, mergeLatencySeries, seriesBounds, type MergedLatencySeries } from '@/lib/metrics/latencySeries'
import type { DiskLatencySeries } from '@/lib/orchestrator/client'

import { useRefreshInterval } from './useRefreshInterval'
import { useSWRFetch } from './useSWRFetch'

interface Args<T extends { t: number }> {
  connId: string
  node: string
  vmid: string | number
  type: string
  /** The RRD series of the Performance card; the latency is fetched over its range and at its resolution. */
  series: ReadonlyArray<T>
}

/**
 * The guest's disk latency history joined onto its RRD series, for the Disk
 * I/O chart (#881). Enterprise and QEMU only: elsewhere the hook fetches
 * nothing and hands the series back untouched, so the chart is what it was.
 */
export function useVmDiskLatencySeries<T extends { t: number }>({ connId, node, vmid, type, series }: Args<T>): MergedLatencySeries<T> {
  const { isEnterprise } = useLicense()
  const refreshInterval = useRefreshInterval(60000)

  const stepSec = useMemo(() => inferStepSeconds(series), [series])
  const bounds = useMemo(() => seriesBounds(series, stepSec), [series, stepSec])

  const enabled = isEnterprise && type === 'qemu' && Boolean(connId && node && vmid && bounds)
  const key = enabled && bounds
    ? `/api/v1/orchestrator/metrics/${encodeURIComponent(connId)}/vms/${encodeURIComponent(String(vmid))}/disk-latency` +
      `?node=${encodeURIComponent(node)}&from=${new Date(bounds.fromSec * 1000).toISOString()}&to=${new Date(bounds.toSec * 1000).toISOString()}&step=${stepSec}`
    : null

  const { data } = useSWRFetch<DiskLatencySeries>(key, { refreshInterval, revalidateOnFocus: false })

  return useMemo(() => mergeLatencySeries(series, data?.points ?? [], stepSec), [series, data, stepSec])
}
