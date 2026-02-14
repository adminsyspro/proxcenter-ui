'use client'

import { useCallback, useEffect, useMemo } from 'react'

import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  type Node,
  type Edge,
  type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Box, CircularProgress, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { ClusterNode } from './nodes/ClusterNode'
import { HostNode } from './nodes/HostNode'
import { VmNode } from './nodes/VmNode'
import { VmSummaryNode } from './nodes/VmSummaryNode'
import type { SelectedNodeInfo } from '../types'

const nodeTypes = {
  cluster: ClusterNode,
  host: HostNode,
  vm: VmNode,
  vmSummary: VmSummaryNode,
}

interface TopologyCanvasProps {
  nodes: Node[]
  edges: Edge[]
  isLoading: boolean
  onNodeSelect: (node: SelectedNodeInfo | null) => void
}

export default function TopologyCanvas({ nodes, edges, isLoading, onNodeSelect }: TopologyCanvasProps) {
  const t = useTranslations('topology')
  const { fitView } = useReactFlow()

  // Fit view when nodes change
  useEffect(() => {
    if (nodes.length > 0) {
      // Small delay to ensure DOM is ready
      const timer = setTimeout(() => {
        fitView({ padding: 0.2, duration: 300 })
      }, 100)

      return () => clearTimeout(timer)
    }
  }, [nodes, fitView])

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      const nodeType = node.type as string

      if (nodeType === 'cluster' || nodeType === 'host' || nodeType === 'vm' || nodeType === 'vmSummary') {
        onNodeSelect({ type: nodeType, data: node.data as any })
      }
    },
    [onNodeSelect]
  )

  const onPaneClick = useCallback(() => {
    onNodeSelect(null)
  }, [onNodeSelect])

  const defaultEdgeOptions = useMemo(
    () => ({
      type: 'smoothstep',
      animated: false,
    }),
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
        <i className='ri-mind-map-line' style={{ fontSize: 48, opacity: 0.3 }} />
        <Typography variant='h6' color='text.secondary'>
          {t('noData')}
        </Typography>
        <Typography variant='body2' color='text.secondary'>
          {t('noDataDesc')}
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
      onPaneClick={onPaneClick}
      defaultEdgeOptions={defaultEdgeOptions}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.1}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={20} size={1} />
      <Controls position='bottom-left' />
      <MiniMap
        position='bottom-right'
        nodeColor={(node) => {
          switch (node.type) {
            case 'cluster':
              return '#1976d2'
            case 'host':
              return '#388e3c'
            case 'vm':
              return '#f57c00'
            case 'vmSummary':
              return '#9e9e9e'
            default:
              return '#666'
          }
        }}
        maskColor='rgba(0,0,0,0.1)'
        style={{ borderRadius: 8 }}
      />
    </ReactFlow>
  )
}
