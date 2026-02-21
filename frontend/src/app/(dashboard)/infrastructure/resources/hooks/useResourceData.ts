'use client'

import { useEffect, useState, useCallback } from 'react'

import { useTranslations } from 'next-intl'

import type {
  KpiData, ResourceTrend, TopVm, GreenMetrics,
  OverprovisioningData, AiAnalysis, ResourceThresholds,
  StoragePool, NetworkMetrics, HealthScoreHistoryEntry, ConnectionInfo,
} from '../types'
import { DEFAULT_THRESHOLDS } from '../constants'

export function useResourceData(connectionId?: string) {
  const t = useTranslations()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [kpis, setKpis] = useState<KpiData | null>(null)
  const [trends, setTrends] = useState<ResourceTrend[]>([])
  const [trendsPeriod, setTrendsPeriod] = useState<{ start: string | null; end: string | null; daysCount: number } | null>(null)
  const [topCpuVms, setTopCpuVms] = useState<TopVm[]>([])
  const [topRamVms, setTopRamVms] = useState<TopVm[]>([])
  const [green, setGreen] = useState<GreenMetrics | null>(null)
  const [greenConfigured, setGreenConfigured] = useState(true)
  const [overprovisioning, setOverprovisioning] = useState<OverprovisioningData | null>(null)
  const [thresholds, setThresholds] = useState<ResourceThresholds>(DEFAULT_THRESHOLDS)
  const [storagePools, setStoragePools] = useState<StoragePool[]>([])
  const [networkMetrics, setNetworkMetrics] = useState<NetworkMetrics | null>(null)
  const [healthScoreHistory, setHealthScoreHistory] = useState<HealthScoreHistoryEntry[]>([])
  const [connections, setConnections] = useState<ConnectionInfo[]>([])
  const [aiAnalysis, setAiAnalysis] = useState<AiAnalysis>({ summary: '', recommendations: [], loading: false })

  // Reset AI analysis when connection changes so auto-run re-triggers
  useEffect(() => {
    setAiAnalysis({ summary: '', recommendations: [], loading: false })
  }, [connectionId])

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams()
      if (connectionId) params.set('connectionId', connectionId)
      const qs = params.toString() ? `?${params.toString()}` : ''

      const res = await fetch(`/api/v1/resources/overview${qs}`)
      if (!res.ok) throw new Error(t('resources.loadError'))
      const json = await res.json()

      setKpis(json.data.kpis)
      setTrends(json.data.trends || [])
      setTrendsPeriod(json.data.trendsPeriod || null)
      setTopCpuVms(json.data.topCpuVms || [])
      setTopRamVms(json.data.topRamVms || [])
      setGreen(json.data.green || null)
      setGreenConfigured(json.data.greenConfigured !== false)
      setOverprovisioning(json.data.overprovisioning || null)
      setThresholds(json.data.thresholds || DEFAULT_THRESHOLDS)
      setStoragePools(json.data.storagePools || [])
      setNetworkMetrics(json.data.networkMetrics || null)
      setHealthScoreHistory(json.data.healthScoreHistory || [])
      setConnections(json.data.connections || [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [connectionId])

  useEffect(() => { loadData() }, [loadData])

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
    loading,
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
