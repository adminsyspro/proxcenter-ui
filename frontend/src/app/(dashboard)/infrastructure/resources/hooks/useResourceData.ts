'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'

import { useTranslations } from 'next-intl'

import { useSWRFetch } from '@/hooks/useSWRFetch'

import type {
  KpiData, ResourceTrend, TopVm, GreenMetrics,
  OverprovisioningData, AiAnalysis, ResourceThresholds,
  StoragePool, NetworkMetrics, HealthScoreHistoryEntry, ConnectionInfo,
} from '../types'
import { DEFAULT_THRESHOLDS } from '../constants'

export function useResourceData(connectionId?: string) {
  const t = useTranslations()

  // Build SWR key from connectionId
  const swrKey = useMemo(() => {
    const params = new URLSearchParams()
    if (connectionId) params.set('connectionId', connectionId)
    const qs = params.toString() ? `?${params.toString()}` : ''
    return `/api/v1/resources/overview${qs}`
  }, [connectionId])

  const { data: json, error: swrError, isLoading, mutate } = useSWRFetch(swrKey, {
    revalidateOnFocus: false,
  })

  // Derive state from SWR data
  const kpis: KpiData | null = json?.data?.kpis ?? null
  const trends: ResourceTrend[] = json?.data?.trends ?? []
  const trendsPeriod = json?.data?.trendsPeriod ?? null
  const topCpuVms: TopVm[] = json?.data?.topCpuVms ?? []
  const topRamVms: TopVm[] = json?.data?.topRamVms ?? []
  const green: GreenMetrics | null = json?.data?.green ?? null
  const greenConfigured: boolean = json?.data?.greenConfigured !== false
  const overprovisioning: OverprovisioningData | null = json?.data?.overprovisioning ?? null
  const thresholds: ResourceThresholds = json?.data?.thresholds ?? DEFAULT_THRESHOLDS
  const storagePools: StoragePool[] = json?.data?.storagePools ?? []
  const networkMetrics: NetworkMetrics | null = json?.data?.networkMetrics ?? null
  const healthScoreHistory: HealthScoreHistoryEntry[] = json?.data?.healthScoreHistory ?? []
  const connections: ConnectionInfo[] = json?.data?.connections ?? []

  const error = swrError ? swrError.message : null

  // AI analysis state (not part of the overview fetch)
  const [aiAnalysis, setAiAnalysis] = useState<AiAnalysis>({ summary: '', recommendations: [], loading: false })

  // Reset AI analysis when connection changes
  useEffect(() => {
    setAiAnalysis({ summary: '', recommendations: [], loading: false })
  }, [connectionId])

  const loadData = useCallback(() => { mutate() }, [mutate])

  const runAiAnalysis = async () => {
    if (!kpis) return
    setAiAnalysis(prev => ({ ...prev, loading: true, error: undefined }))

    try {
      const res = await fetch('/api/v1/resources/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kpis, topCpuVms, topRamVms }),
      })

      if (!res.ok) throw new Error(t('resources.analysisError'))
      const json = await res.json()

      setAiAnalysis({
        summary: json.data?.summary || '',
        recommendations: json.data?.recommendations || [],
        loading: false,
        provider: json.data?.provider,
        summaryKey: json.data?.summaryKey,
        summaryParams: json.data?.summaryParams,
      })
    } catch (e: any) {
      setAiAnalysis(prev => ({ ...prev, loading: false, error: e.message }))
    }
  }

  return {
    loading: isLoading,
    error,
    kpis,
    trends,
    trendsPeriod,
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
    aiAnalysis,
    loadData,
    runAiAnalysis,
    setAiAnalysis,
  }
}
