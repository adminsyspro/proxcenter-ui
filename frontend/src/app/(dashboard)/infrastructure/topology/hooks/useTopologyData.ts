'use client'

import { useMemo } from 'react'

import { useSWRFetch } from '@/hooks/useSWRFetch'

import type { TopologyFilters, InventoryData, InventoryConnection } from '../types'
import { buildTopologyGraph } from '../lib/buildTopologyGraph'
import { layoutGraph } from '../lib/layoutGraph'

export function useTopologyData(filters: TopologyFilters) {
  const { data, isLoading, error } = useSWRFetch<{ data: InventoryData }>('/api/v1/inventory', {
    refreshInterval: 30000,
  })

  const inventoryData = data?.data

  const connections: InventoryConnection[] = useMemo(() => {
    return inventoryData?.connections ?? []
  }, [inventoryData])

  const { nodes, edges } = useMemo(() => {
    if (!inventoryData || !inventoryData.connections?.length) {
      return { nodes: [], edges: [] }
    }

    const graph = buildTopologyGraph(inventoryData, filters)

    if (graph.nodes.length === 0) {
      return { nodes: [], edges: [] }
    }

    return layoutGraph(graph.nodes, graph.edges)
  }, [inventoryData, filters])

  return {
    nodes,
    edges,
    isLoading,
    error,
    connections,
  }
}
