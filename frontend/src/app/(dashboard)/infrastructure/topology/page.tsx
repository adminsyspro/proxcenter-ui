'use client'

import { useState, useCallback, useEffect } from 'react'

import { Box, Card, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'
import { ReactFlowProvider } from '@xyflow/react'

import { usePageTitle } from '@/contexts/PageTitleContext'

import type { TopologyFilters, SelectedNodeInfo } from './types'
import { useTopologyData } from './hooks/useTopologyData'
import { useTopologyNetworks } from './hooks/useTopologyNetworks'
import TopologyCanvas from './components/TopologyCanvas'
import TopologyToolbar from './components/TopologyToolbar'
import TopologyDetailsSidebar from './components/TopologyDetailsSidebar'

export default function TopologyPage() {
  const t = useTranslations()
  const { setPageInfo } = usePageTitle()

  const [filters, setFilters] = useState<TopologyFilters>({
    vmThreshold: 8,
    vmStatus: 'all',
  })

  const [selectedNode, setSelectedNode] = useState<SelectedNodeInfo | null>(null)

  // First pass: get connections (without networkMap)
  const { connections, isLoading } = useTopologyData(filters)

  // Fetch network/VLAN data when groupByVlan is enabled
  const { networkMap } = useTopologyNetworks(connections, !!filters.groupByVlan)

  // Second pass: build graph with networkMap when available
  const { nodes, edges } = useTopologyData(
    filters,
    filters.groupByVlan ? networkMap : undefined
  )

  // Page title
  useEffect(() => {
    setPageInfo(t('navigation.topology'), t('topology.title'), 'ri-mind-map')

    return () => setPageInfo('', '', '')
  }, [setPageInfo, t])

  const handleNodeSelect = useCallback((node: SelectedNodeInfo | null) => {
    setSelectedNode(node)
  }, [])

  return (
    <Box sx={{ height: 'calc(100vh - 200px)', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant='h5' fontWeight={700}>
          {t('topology.title')}
        </Typography>
      </Box>

      <ReactFlowProvider>
        <TopologyToolbar filters={filters} onChange={setFilters} connections={connections} />

        <Card sx={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <TopologyCanvas
            nodes={nodes}
            edges={edges}
            isLoading={isLoading}
            onNodeSelect={handleNodeSelect}
          />

          {selectedNode && (
            <TopologyDetailsSidebar node={selectedNode} onClose={() => setSelectedNode(null)} connections={connections} />
          )}
        </Card>
      </ReactFlowProvider>
    </Box>
  )
}
