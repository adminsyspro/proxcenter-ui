'use client'

import { useCallback, useEffect, useMemo } from 'react'

import {
  ReactFlow,
  Background,
  useReactFlow,
  type Node,
  type Edge,
  type NodeMouseHandler,
  type EdgeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Box, CircularProgress, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { SecurityZoneNode } from './nodes/SecurityZoneNode'
import { InternetNode } from './nodes/InternetNode'
import { ClusterFirewallNode } from './nodes/ClusterFirewallNode'
import type { SelectedMapItem, SecurityZoneNodeData, InternetNodeData, ClusterFirewallNodeData, EdgeFlowData, FlowMatrixData } from './types'

const nodeTypes = {
  securityZone: SecurityZoneNode,
  internet: InternetNode,
  clusterFirewall: ClusterFirewallNode,
}

interface SecurityMapCanvasProps {
  nodes: Node[]
  edges: Edge[]
  isLoading: boolean
  flowMatrix: FlowMatrixData
  onSelect: (item: SelectedMapItem | null) => void
}

export default function SecurityMapCanvas({
  nodes,
  edges,
  isLoading,
  flowMatrix,
  onSelect,
}: SecurityMapCanvasProps) {
  const t = useTranslations('networkPage')
  const { fitView } = useReactFlow()

  useEffect(() => {
    if (nodes.length > 0) {
      const timer = setTimeout(() => {
        fitView({ padding: 0.15, duration: 300, maxZoom: 1 })
      }, 100)

      return () => clearTimeout(timer)
    }
  }, [nodes, fitView])

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      const nodeType = node.type as string

      if (nodeType === 'securityZone') {
        onSelect({ type: 'zone', data: node.data as unknown as SecurityZoneNodeData })
      } else if (nodeType === 'internet') {
        onSelect({ type: 'internet', data: node.data as unknown as InternetNodeData })
      } else if (nodeType === 'clusterFirewall') {
        onSelect({ type: 'clusterFirewall', data: node.data as unknown as ClusterFirewallNodeData })
      }
    },
    [onSelect]
  )

  const onEdgeClick: EdgeMouseHandler = useCallback(
    (_event, edge) => {
      // Parse edge id to find zones
      const parts = edge.id.replace('e-zone-', '').split('-')

      if (parts.length < 2) return

      // Find the matching flow matrix cell
      const sourceZone = parts[0]
      // Edge id format: e-zone-{from}-{to}, but names may contain dashes
      // We need to find the correct split point
      const fromIdx = flowMatrix.labels.indexOf(sourceZone)

      if (fromIdx === -1) {
        // Try progressively longer source names
        for (let i = 1; i < parts.length; i++) {
          const trySource = parts.slice(0, i + 1).join('-')
          const tryTarget = parts.slice(i + 1).join('-')
          const fi = flowMatrix.labels.indexOf(trySource)
          const ti = flowMatrix.labels.indexOf(tryTarget)

          if (fi !== -1 && ti !== -1) {
            const cell = flowMatrix.matrix[fi]?.[ti]

            if (cell) {
              onSelect({
                type: 'edge',
                data: {
                  sourceZone: trySource,
                  targetZone: tryTarget,
                  status: cell.status,
                  rules: cell.rules,
                  protocolSummary: cell.summary,
                },
              })
            }

            return
          }
        }
      } else {
        const targetZone = parts.slice(1).join('-')
        const toIdx = flowMatrix.labels.indexOf(targetZone)

        if (toIdx !== -1) {
          const cell = flowMatrix.matrix[fromIdx]?.[toIdx]

          if (cell) {
            onSelect({
              type: 'edge',
              data: {
                sourceZone,
                targetZone,
                status: cell.status,
                rules: cell.rules,
                protocolSummary: cell.summary,
              },
            })
          }
        }
      }
    },
    [flowMatrix, onSelect]
  )

  const onPaneClick = useCallback(() => {
    onSelect(null)
  }, [onSelect])

  const defaultEdgeOptions = useMemo(
    () => ({ type: 'smoothstep' }),
    []
  )

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <CircularProgress size={32} />
      </Box>
    )
  }

  if (nodes.length === 0) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: 1,
        }}
      >
        <i className='ri-shield-cross-line' style={{ fontSize: 48, opacity: 0.3 }} />
        <Typography variant='h6' color='text.secondary'>
          {t('securityMap.noData')}
        </Typography>
        <Typography variant='body2' color='text.secondary'>
          {t('securityMap.noDataDesc')}
        </Typography>
      </Box>
    )
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={onNodeClick}
      onEdgeClick={onEdgeClick}
      onPaneClick={onPaneClick}
      defaultEdgeOptions={defaultEdgeOptions}
      fitView
      fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
      minZoom={0.1}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={20} size={0} />
    </ReactFlow>
  )
}
