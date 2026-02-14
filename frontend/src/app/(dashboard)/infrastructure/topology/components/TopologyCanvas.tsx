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
import { VlanGroupNode } from './nodes/VlanGroupNode'
import { ProxCenterNode } from './nodes/ProxCenterNode'
import type { SelectedNodeInfo } from '../types'

const nodeTypes = {
  cluster: ClusterNode,
  host: HostNode,
  vm: VmNode,
  vmSummary: VmSummaryNode,
  vlanGroup: VlanGroupNode,
  proxcenter: ProxCenterNode,
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

  // Fit view when nodes change — zoom to a comfortable level for large infras
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

      if (nodeType === 'cluster' || nodeType === 'host' || nodeType === 'vm' || nodeType === 'vmSummary' || nodeType === 'vlanGroup' || nodeType === 'proxcenter') {
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
        <i className='ri-mind-map' style={{ fontSize: 48, opacity: 0.3 }} />
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
      fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
      minZoom={0.05}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={20} size={0} />
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
            case 'vlanGroup':
              return '#1976d2'
            case 'proxcenter':
              return '#F29221'
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
