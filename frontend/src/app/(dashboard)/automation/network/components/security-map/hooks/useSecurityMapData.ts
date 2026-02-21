import { useState, useEffect, useMemo, useCallback } from 'react'

import type { Node, Edge } from '@xyflow/react'

import type {
  SecurityMapFilters,
  MicrosegAnalysis,
  VMListForSegmentation,
  FlowMatrixData,
} from '../types'
import { deriveFlowMatrix } from '../lib/deriveFlowMatrix'
import { buildSecurityGraph } from '../lib/buildSecurityGraph'
import { layoutGraphLR } from '../lib/layoutGraph'

interface UseSecurityMapDataParams {
  connectionId: string
  securityGroups: { group: string; rules?: any[] }[]
  aliases: { name: string; cidr: string }[]
  clusterOptions: any
  clusterRules: any[]
  filters: SecurityMapFilters
}

interface UseSecurityMapDataReturn {
  nodes: Node[]
  edges: Edge[]
  loading: boolean
  error: string | null
  flowMatrix: FlowMatrixData
  reload: () => void
}

export function useSecurityMapData({
  connectionId,
  securityGroups,
  aliases,
  clusterOptions,
  clusterRules,
  filters,
}: UseSecurityMapDataParams): UseSecurityMapDataReturn {
  const [analysis, setAnalysis] = useState<MicrosegAnalysis | null>(null)
  const [vmList, setVmList] = useState<VMListForSegmentation | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (!connectionId) return

    setLoading(true)
    setError(null)

    try {
      const [analyzeRes, vmsRes] = await Promise.all([
        fetch(`/api/v1/firewall/microseg/${connectionId}/analyze`),
        fetch(`/api/v1/firewall/microseg/${connectionId}/vms`),
      ])

      if (!analyzeRes.ok) throw new Error('Failed to fetch microseg analysis')
      if (!vmsRes.ok) throw new Error('Failed to fetch VM list')

      const analyzeData = await analyzeRes.json()
      const vmsData = await vmsRes.json()

      setAnalysis(analyzeData.data || analyzeData)
      setVmList(vmsData.data || vmsData)
    } catch (err: any) {
      setError(err.message || 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [connectionId])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Derive flow matrix
  const flowMatrix = useMemo<FlowMatrixData>(() => {
    if (!analysis) return { labels: [], matrix: [] }

    return deriveFlowMatrix({
      networks: analysis.networks,
      clusterRules,
      securityGroups,
      aliases,
    })
  }, [analysis, clusterRules, securityGroups, aliases])

  // Build and layout the graph
  const { nodes, edges } = useMemo(() => {
    if (!analysis || !vmList) return { nodes: [], edges: [] }

    const graph = buildSecurityGraph({
      networks: analysis.networks,
      vms: vmList.vms || [],
      clusterOptions,
      clusterRules,
      flowMatrix,
      filters,
    })

    return layoutGraphLR(graph.nodes, graph.edges)
  }, [analysis, vmList, clusterOptions, clusterRules, flowMatrix, filters])

  return { nodes, edges, loading, error, flowMatrix, reload: fetchData }
}
