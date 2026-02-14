'use client'

import { useState, useEffect, useMemo } from 'react'

interface CephPerfPoint {
  time: number
  read_bytes_sec: number
  write_bytes_sec: number
  read_op_per_sec: number
  write_op_per_sec: number
}

type Trend = 'stable' | 'up' | 'down'

interface CephTrends {
  read_bytes: Trend
  write_bytes: Trend
  read_iops: Trend
  write_iops: Trend
}

interface UseCephPerfResult {
  clusterCephPerf: any
  clusterCephPerfFiltered: CephPerfPoint[]
  cephTrends: CephTrends
}

export function useCephPerf(
  selectionType: string | undefined,
  selectionId: string | undefined,
  clusterTab: number,
  clusterCephData: any,
  clusterCephTimeframe: number,
): UseCephPerfResult {
  const [clusterCephPerf, setClusterCephPerf] = useState<any>(null)
  const [clusterCephPerfHistory, setClusterCephPerfHistory] = useState<CephPerfPoint[]>([])

  const active = selectionType === 'cluster' && clusterTab === 7 && !!clusterCephData

  // Reset history when selection changes or becomes inactive
  useEffect(() => {
    if (!active) {
      setClusterCephPerf(null)
      setClusterCephPerfHistory([])
    }
  }, [active, selectionId])

  // Poll Ceph perf every 2s
  useEffect(() => {
    if (!active) return

    const connId = selectionId?.split(':')[0] || ''

    const fetchCephPerf = async () => {
      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/ceph/status`, { cache: 'no-store' })
        const json = await res.json()

        if (json.data?.pgmap) {
          const now = Date.now()
          const perfData: CephPerfPoint = {
            time: now,
            read_bytes_sec: json.data.pgmap.read_bytes_sec || 0,
            write_bytes_sec: json.data.pgmap.write_bytes_sec || 0,
            read_op_per_sec: json.data.pgmap.read_op_per_sec || 0,
            write_op_per_sec: json.data.pgmap.write_op_per_sec || 0,
          }

          setClusterCephPerf(perfData)

          setClusterCephPerfHistory(prev => {
            const newHistory = [...prev, perfData]
            const cutoff = now - 3600000
            return newHistory.filter(p => p.time > cutoff)
          })
        }
      } catch (e) {
        console.error('Error fetching Ceph perf:', e)
      }
    }

    fetchCephPerf()
    const interval = setInterval(fetchCephPerf, 2000)
    return () => clearInterval(interval)
  }, [active, selectionId])

  // Compute trends from history
  const cephTrends = useMemo((): CephTrends => {
    if (clusterCephPerfHistory.length < 5) {
      return { read_bytes: 'stable', write_bytes: 'stable', read_iops: 'stable', write_iops: 'stable' }
    }

    const recentCount = Math.min(10, Math.floor(clusterCephPerfHistory.length / 2))
    const recent = clusterCephPerfHistory.slice(-recentCount)
    const older = clusterCephPerfHistory.slice(-recentCount * 2, -recentCount)

    if (older.length === 0) {
      return { read_bytes: 'stable', write_bytes: 'stable', read_iops: 'stable', write_iops: 'stable' }
    }

    const avgRecent = {
      read_bytes: recent.reduce((sum, p) => sum + (p.read_bytes_sec || 0), 0) / recent.length,
      write_bytes: recent.reduce((sum, p) => sum + (p.write_bytes_sec || 0), 0) / recent.length,
      read_iops: recent.reduce((sum, p) => sum + (p.read_op_per_sec || 0), 0) / recent.length,
      write_iops: recent.reduce((sum, p) => sum + (p.write_op_per_sec || 0), 0) / recent.length,
    }

    const avgOlder = {
      read_bytes: older.reduce((sum, p) => sum + (p.read_bytes_sec || 0), 0) / older.length,
      write_bytes: older.reduce((sum, p) => sum + (p.write_bytes_sec || 0), 0) / older.length,
      read_iops: older.reduce((sum, p) => sum + (p.read_op_per_sec || 0), 0) / older.length,
      write_iops: older.reduce((sum, p) => sum + (p.write_op_per_sec || 0), 0) / older.length,
    }

    const getTrend = (r: number, o: number): Trend => {
      if (o === 0) return r > 0 ? 'up' : 'stable'
      const change = ((r - o) / o) * 100
      if (change > 10) return 'up'
      if (change < -10) return 'down'
      return 'stable'
    }

    return {
      read_bytes: getTrend(avgRecent.read_bytes, avgOlder.read_bytes),
      write_bytes: getTrend(avgRecent.write_bytes, avgOlder.write_bytes),
      read_iops: getTrend(avgRecent.read_iops, avgOlder.read_iops),
      write_iops: getTrend(avgRecent.write_iops, avgOlder.write_iops),
    }
  }, [clusterCephPerfHistory])

  // Filter by timeframe
  const clusterCephPerfFiltered = useMemo(() => {
    const now = Date.now()
    const cutoff = now - (clusterCephTimeframe * 1000)
    return clusterCephPerfHistory.filter(p => p.time > cutoff)
  }, [clusterCephPerfHistory, clusterCephTimeframe])

  return { clusterCephPerf, clusterCephPerfFiltered, cephTrends }
}
