'use client'

import { useCallback, useMemo } from 'react'

import { useLocale } from 'next-intl'

import { useSWRFetch } from '@/hooks/useSWRFetch'

import type {
  KpiData, TopVm, GreenMetrics,
  OverprovisioningData, ResourceThresholds,
  StoragePool, NetworkMetrics, HealthScoreHistoryEntry, ConnectionInfo,
  ClusterCapacity, NodeCapacity, StoppedAllocation,
} from '../types'
import { DEFAULT_THRESHOLDS } from '../constants'
import { DEFAULT_HISTORY_WINDOW_DAYS, sliceTrendsToWindow } from '../algorithms/historyWindow'

// The overview carries up to a year of daily trends; each caller picks how much of
// it feeds the forecast, from the same cached response (no extra Proxmox call).
// Stable empty list, so memoised consumers do not recompute on every render.
const EMPTY: never[] = []

export function useResourceData(connectionId?: string, historyDays: number = DEFAULT_HISTORY_WINDOW_DAYS) {
  const locale = useLocale()

  // Build SWR key from connectionId + locale (server pre-formats date labels per locale)
  const swrKey = useMemo(() => {
    const params = new URLSearchParams()
    if (connectionId) params.set('connectionId', connectionId)
    const qs = params.toString() ? `?${params.toString()}` : ''
    return `/api/v1/resources/overview${qs}#${locale}`
  }, [connectionId, locale])

  const { data: json, error: swrError, isLoading, mutate } = useSWRFetch(swrKey, {
    revalidateOnFocus: false,
  })

  // Derive state from SWR data
  const kpis: KpiData | null = json?.data?.kpis ?? null
  const historyAvailableDays: number = json?.data?.trends?.length ?? 0
  const { trends, period: trendsPeriod } = useMemo(
    () => sliceTrendsToWindow(json?.data?.trends ?? [], json?.data?.trendsPeriod ?? null, historyDays),
    [json, historyDays],
  )
  const topCpuVms: TopVm[] = json?.data?.topCpuVms ?? EMPTY
  const topRamVms: TopVm[] = json?.data?.topRamVms ?? EMPTY
  const green: GreenMetrics | null = json?.data?.green ?? null
  const greenConfigured: boolean = json?.data?.greenConfigured !== false
  const overprovisioning: OverprovisioningData | null = json?.data?.overprovisioning ?? null
  const thresholds: ResourceThresholds = json?.data?.thresholds ?? DEFAULT_THRESHOLDS
  const storagePools: StoragePool[] = json?.data?.storagePools ?? EMPTY
  const networkMetrics: NetworkMetrics | null = json?.data?.networkMetrics ?? null
  const healthScoreHistory: HealthScoreHistoryEntry[] = json?.data?.healthScoreHistory ?? EMPTY
  const connections: ConnectionInfo[] = json?.data?.connections ?? []
  const clusters: ClusterCapacity[] = json?.data?.clusters ?? EMPTY
  const nodes: NodeCapacity[] = json?.data?.nodes ?? EMPTY
  const stoppedAllocation: StoppedAllocation | null = json?.data?.stoppedAllocation ?? null

  const error = swrError ? swrError.message : null

  const loadData = useCallback(() => { void mutate() }, [mutate])

  return {
    loading: isLoading,
    error,
    kpis,
    trends,
    trendsPeriod,
    historyAvailableDays,
    topCpuVms,
    topRamVms,
    green,
    greenConfigured,
    overprovisioning,
    thresholds,
    storagePools,
    networkMetrics,
    healthScoreHistory,
    connections,
    clusters,
    nodes,
    stoppedAllocation,
    loadData,
  }
}
