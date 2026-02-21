import { useState, useEffect, useMemo, useCallback } from 'react'

import type { MicrosegAnalysis, FlowMatrixData } from '../types'
import { deriveFlowMatrix } from '../lib/deriveFlowMatrix'

interface UseSecurityMapDataParams {
  connectionId: string
  securityGroups: { group: string; rules?: any[] }[]
  aliases: { name: string; cidr: string }[]
  clusterRules: any[]
}

interface UseSecurityMapDataReturn {
  loading: boolean
  error: string | null
  flowMatrix: FlowMatrixData
  reload: () => void
}

export function useSecurityMapData({
  connectionId,
  securityGroups,
  aliases,
  clusterRules,
}: UseSecurityMapDataParams): UseSecurityMapDataReturn {
  const [analysis, setAnalysis] = useState<MicrosegAnalysis | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (!connectionId) return

    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/v1/firewall/microseg/${connectionId}/analyze`)

      if (!res.ok) throw new Error('Failed to fetch microseg analysis')

      const data = await res.json()

      setAnalysis(data.data || data)
    } catch (err: any) {
      setError(err.message || 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [connectionId])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const flowMatrix = useMemo<FlowMatrixData>(() => {
    if (!analysis) return { labels: [], matrix: [] }

    return deriveFlowMatrix({
      networks: analysis.networks,
      clusterRules,
      securityGroups,
      aliases,
    })
  }, [analysis, clusterRules, securityGroups, aliases])

  return { loading, error, flowMatrix, reload: fetchData }
}
