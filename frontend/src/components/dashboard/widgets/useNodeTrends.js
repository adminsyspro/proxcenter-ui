'use client'

import { useEffect, useMemo, useState } from 'react'

import { mapTimeRange } from './timeRangeUtils'

/**
 * Loads per-node RRD trends for the dashboard chart widgets.
 *
 * One request per connection, then every node is merged into a single
 * time-indexed series whose keys are `${nodeName}_${metric}`. Slots a node did
 * not report are filled forward then backward, otherwise a node whose RRD lags
 * behind the others cuts its own curve in half.
 *
 * `defaultValue` is what a missing metric becomes: 0 for ratios that are
 * meaningful at zero, null for metrics whose absence must stay distinguishable
 * from a real zero (ZFS ARC on a node without ZFS).
 */
export function useNodeTrends({ data, selectedConnections = [], timeRange, metrics, defaultValue = 0 }) {
  const [trendsData, setTrendsData] = useState(null)
  const [nodeNames, setNodeNames] = useState([])
  const [loading, setLoading] = useState(false)

  // All connections for the filter (clusters first, fallback to the unique
  // connections carried by the nodes themselves)
  const allConnections = useMemo(() => {
    const clusters = (data?.clusters || []).map(c => ({ id: c.id, name: c.name }))

    if (clusters.length > 0) return clusters
    const seen = new Set()

    return (data?.nodes || []).reduce((acc, n) => {
      const id = n.connectionId || n.connId

      if (id && !seen.has(id)) { seen.add(id); acc.push({ id, name: n.connection || id }) }

      return acc
    }, [])
  }, [data?.clusters, data?.nodes])

  // Stable keys for nodes
  const nodesStableKey = (data?.nodes || []).map(n => `${n.connectionId || n.connId}:${n.name}`).join(',')
  const selectedKey = selectedConnections.join(',')
  const metricsKey = metrics.join(',')

  // Group nodes by connection, filtered
  const nodesByConnection = useMemo(() => {
    const nodes = data?.nodes || []
    const grouped = {}
    const validConnIds = new Set(nodes.map(n => n.connectionId || n.connId).filter(Boolean))

    // If selectedConnections references IDs that don't exist, ignore the filter
    const effectiveFilter = selectedConnections.length > 0 && selectedConnections.some(id => validConnIds.has(id))
      ? selectedConnections : []

    nodes.forEach((node) => {
      const connId = node.connectionId || node.connId

      if (!connId) return
      if (effectiveFilter.length > 0 && !effectiveFilter.includes(connId)) return
      if (!grouped[connId]) grouped[connId] = []
      grouped[connId].push({ node: node.node || node.name })
    })

    return grouped
  }, [nodesStableKey, selectedKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch trends
  useEffect(() => {
    const fetchTrends = async () => {
      const connIds = Object.keys(nodesByConnection)

      if (connIds.length === 0) return

      // Only show full loading on first fetch, not on refresh
      if (!trendsData) setLoading(true)

      try {
        const results = await Promise.all(
          connIds.map(async (connId) => {
            const items = nodesByConnection[connId]

            const res = await fetch(`/api/v1/connections/${connId}/nodes/trends`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ items, timeframe: mapTimeRange(timeRange).trendsTimeframe }),
            })

            if (!res.ok) return {}
            const json = await res.json()


return json.data || {}
          })
        )

        const allNodeNames = new Set()
        const timeMap = new Map()

        results.forEach((connData) => {
          Object.entries(connData).forEach(([nodeKey, nodePoints]) => {
            const nodeName = nodeKey.replace(/^node:/, '')

            allNodeNames.add(nodeName)
            if (!Array.isArray(nodePoints)) return
            nodePoints.forEach((point) => {
              const key = point.ts || point.t

              if (!timeMap.has(key)) timeMap.set(key, { ts: point.ts || 0, t: point.t })
              const entry = timeMap.get(key)

              metrics.forEach((m) => { entry[`${nodeName}_${m}`] = point[m] ?? defaultValue })
            })
          })
        })

        const aggregated = Array.from(timeMap.values()).sort((a, b) => a.ts - b.ts)
        const sortedNames = [...allNodeNames].sort((a, b) => a.localeCompare(b))
        const keys = sortedNames.flatMap(name => metrics.map(m => `${name}_${m}`))
        const lastKnown = {}

        for (const slot of aggregated) {
          for (const key of keys) {
            if (slot[key] != null) lastKnown[key] = slot[key]
            else if (lastKnown[key] != null) slot[key] = lastKnown[key]
          }
        }

        const firstKnown = {}

        for (let i = aggregated.length - 1; i >= 0; i--) {
          const slot = aggregated[i]

          for (const key of keys) {
            if (slot[key] != null) firstKnown[key] = slot[key]
            else if (firstKnown[key] != null) slot[key] = firstKnown[key]
          }
        }

        setNodeNames(sortedNames)
        setTrendsData(aggregated)
      } catch (e) {
        console.error('Failed to fetch node trends:', e)
        setTrendsData([])
      } finally {
        setLoading(false)
      }
    }

    fetchTrends()
  }, [nodesStableKey, selectedKey, metricsKey, timeRange]) // eslint-disable-line react-hooks/exhaustive-deps

  return { trendsData, nodeNames, loading, allConnections }
}
