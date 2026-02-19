'use client'

import { useEffect, useState, useCallback } from 'react'

import type {
  KpiData, ResourceTrend, TopVm, GreenMetrics,
  OverprovisioningData, AiAnalysis, ResourceThresholds,
  StoragePool, NetworkMetrics, HealthScoreHistoryEntry, ConnectionInfo,
  VmTrendPoint,
} from '../types'
import { parseResourceVmId } from '../helpers'
import { DEFAULT_THRESHOLDS } from '../constants'

export function useResourceData(connectionId?: string) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [kpis, setKpis] = useState<KpiData | null>(null)
  const [trends, setTrends] = useState<ResourceTrend[]>([])
  const [trendsPeriod, setTrendsPeriod] = useState<{ start: string | null; end: string | null; daysCount: number } | null>(null)
  const [topCpuVms, setTopCpuVms] = useState<TopVm[]>([])
  const [topRamVms, setTopRamVms] = useState<TopVm[]>([])
  const [green, setGreen] = useState<GreenMetrics | null>(null)
  const [overprovisioning, setOverprovisioning] = useState<OverprovisioningData | null>(null)
  const [thresholds, setThresholds] = useState<ResourceThresholds>(DEFAULT_THRESHOLDS)
  const [storagePools, setStoragePools] = useState<StoragePool[]>([])
  const [networkMetrics, setNetworkMetrics] = useState<NetworkMetrics | null>(null)
  const [healthScoreHistory, setHealthScoreHistory] = useState<HealthScoreHistoryEntry[]>([])
  const [connections, setConnections] = useState<ConnectionInfo[]>([])
  const [aiAnalysis, setAiAnalysis] = useState<AiAnalysis>({ summary: '', recommendations: [], loading: false })
  const [vmTrends, setVmTrends] = useState<Record<string, VmTrendPoint[]>>({})
  const [vmTrendsLoading, setVmTrendsLoading] = useState(false)

  // Reset AI analysis and VM trends when connection changes so auto-run re-triggers
  useEffect(() => {
    setAiAnalysis({ summary: '', recommendations: [], loading: false })
    setVmTrends({})
  }, [connectionId])

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams()
      if (connectionId) params.set('connectionId', connectionId)
      const qs = params.toString() ? `?${params.toString()}` : ''

      const res = await fetch(`/api/v1/resources/overview${qs}`)
      if (!res.ok) throw new Error('Erreur lors du chargement')
      const json = await res.json()

      setKpis(json.data.kpis)
      setTrends(json.data.trends || [])
      setTrendsPeriod(json.data.trendsPeriod || null)
      setTopCpuVms(json.data.topCpuVms || [])
      setTopRamVms(json.data.topRamVms || [])
      setGreen(json.data.green || null)
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

      if (!res.ok) throw new Error('Erreur d\'analyse')
      const json = await res.json()

      setAiAnalysis({ summary: json.data?.summary || '', recommendations: json.data?.recommendations || [], loading: false, provider: json.data?.provider })
    } catch (e: any) {
      setAiAnalysis(prev => ({ ...prev, loading: false, error: e.message }))
    }
  }

  const fetchVmTrends = useCallback(async (vmIds: string[], timeframe: string = 'hour') => {
    if (vmIds.length === 0) return
    setVmTrendsLoading(true)
    try {
      // Group VMs by connId
      const byConn: Record<string, { type: string; node: string; vmid: string; origId: string }[]> = {}
      for (const id of vmIds) {
        const parsed = parseResourceVmId(id)
        if (!parsed.connId) continue
        if (!byConn[parsed.connId]) byConn[parsed.connId] = []
        byConn[parsed.connId].push({ ...parsed, origId: id })
      }

      // Batch POST per connection in parallel
      const results = await Promise.all(
        Object.entries(byConn).map(async ([connId, vms]) => {
          const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/guests/trends`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              items: vms.map(v => ({ type: v.type, node: v.node, vmid: v.vmid })),
              timeframe,
            }),
          })
          if (!res.ok) return {}
          const json = await res.json()
          // Map back from API keys (type:node:vmid) to our resource IDs (connId:node:type:vmid)
          const mapped: Record<string, VmTrendPoint[]> = {}
          for (const vm of vms) {
            const apiKey = `${vm.type}:${vm.node}:${vm.vmid}`
            if (json.data?.[apiKey]) {
              mapped[vm.origId] = json.data[apiKey]
            }
          }
          return mapped
        })
      )

      const merged: Record<string, VmTrendPoint[]> = {}
      for (const r of results) Object.assign(merged, r)
      setVmTrends(merged)
    } catch (e) {
      console.error('Failed to fetch VM trends:', e)
    } finally {
      setVmTrendsLoading(false)
    }
  }, [])

  return {
    loading,
    error,
    kpis,
    trends,
    trendsPeriod,
    topCpuVms,
    topRamVms,
    green,
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
    vmTrends,
    vmTrendsLoading,
    fetchVmTrends,
  }
}
