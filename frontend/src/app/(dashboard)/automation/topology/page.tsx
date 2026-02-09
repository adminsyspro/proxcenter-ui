'use client'

import { useEffect, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import useSWR from 'swr'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import {
  Alert,
  Box,
  CircularProgress,
  Typography,
  alpha,
  useTheme,
} from '@mui/material'

import { usePageTitle } from '@/contexts/PageTitleContext'
import ClusterNode from '@/components/automation/topology/ClusterNode'
import ProxmoxNode from '@/components/automation/topology/ProxmoxNode'

interface NodeMetrics {
  node: string
  status: string
  cpu_usage: number
  memory_usage: number
  vm_count: number
  running_vms: number
  in_maintenance?: boolean
}

interface ClusterSummary {
  total_nodes: number
  online_nodes: number
  total_vms: number
  running_vms: number
  avg_cpu_usage: number
  avg_memory_usage: number
}

interface ClusterMetrics {
  connection_id: string
  connection_name?: string
  nodes: NodeMetrics[]
  summary: ClusterSummary
}

interface Connection {
  id: string
  name: string
  type: string
}

const fetcher = (url: string) => fetch(url).then(res => {
  if (!res.ok) throw new Error('Failed to fetch')
  return res.json()
})

function buildGraph(
  metricsData: Record<string, ClusterMetrics>,
  connectionNames: Record<string, string>
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []

  const clusters = Object.entries(metricsData)
    .filter(([, metrics]) => (metrics.nodes?.length || 0) > 0)

  const clusterSpacing = 500
  const nodeSpacing = 230
  const clusterY = 50
  const proxmoxY = 250

  const totalWidth = clusters.length * clusterSpacing
  const startX = -(totalWidth / 2) + clusterSpacing / 2

  clusters.forEach(([connId, metrics], ci) => {
    const clusterX = startX + ci * clusterSpacing
    const clusterName = connectionNames[connId] || metrics.connection_name || connId.slice(0, 12)

    const onlineNodes = metrics.nodes?.filter(n => n.status === 'online').length || 0
    const clusterStatus = onlineNodes === (metrics.nodes?.length || 0)
      ? 'online'
      : onlineNodes > 0
        ? 'warning'
        : 'offline'

    nodes.push({
      id: connId,
      type: 'clusterNode',
      position: { x: clusterX, y: clusterY },
      data: {
        label: clusterName,
        status: clusterStatus,
        nodeCount: metrics.summary?.total_nodes || metrics.nodes?.length || 0,
        onlineNodes: metrics.summary?.online_nodes || onlineNodes,
        totalVMs: metrics.summary?.running_vms || 0,
        avgCpu: metrics.summary?.avg_cpu_usage || 0,
        avgMemory: metrics.summary?.avg_memory_usage || 0,
      },
    })

    const clusterNodes = metrics.nodes || []
    const nodesWidth = clusterNodes.length * nodeSpacing
    const nodesStartX = clusterX - nodesWidth / 2 + nodeSpacing / 2

    clusterNodes.forEach((node, ni) => {
      const nodeId = `${connId}-${node.node}`
      const nodeStatus = node.in_maintenance
        ? 'maintenance'
        : node.status === 'online'
          ? (node.cpu_usage > 90 || node.memory_usage > 90 ? 'warning' : 'online')
          : 'offline'

      nodes.push({
        id: nodeId,
        type: 'proxmoxNode',
        position: { x: nodesStartX + ni * nodeSpacing, y: proxmoxY },
        data: {
          label: node.node,
          status: nodeStatus,
          cpu: node.cpu_usage || 0,
          memory: node.memory_usage || 0,
          vms: node.vm_count || 0,
          runningVms: node.running_vms || 0,
        },
      })

      edges.push({
        id: `edge-${connId}-${node.node}`,
        source: connId,
        target: nodeId,
        animated: node.status === 'online',
        style: {
          stroke: node.status !== 'online' ? '#ef4444' : undefined,
          strokeWidth: 2,
        },
      })
    })
  })

  return { nodes, edges }
}

export default function TopologyPage() {
  const theme = useTheme()
  const t = useTranslations()
  const { setPageInfo } = usePageTitle()

  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[])
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[])

  const nodeTypes = useMemo(
    () => ({ clusterNode: ClusterNode, proxmoxNode: ProxmoxNode }),
    []
  )

  useEffect(() => {
    setPageInfo(t('topology.title'), t('topology.subtitle'), 'ri-mind-map')
    return () => setPageInfo('', '', '')
  }, [setPageInfo, t])

  const { data: metricsData, isLoading: metricsLoading } = useSWR(
    '/api/v1/orchestrator/metrics',
    fetcher,
    { refreshInterval: 30000 }
  )

  const { data: connectionsData } = useSWR<{ data: Connection[] }>(
    '/api/v1/connections?type=pve',
    fetcher
  )

  const connectionNames = useMemo(() => {
    const map: Record<string, string> = {}
    if (connectionsData?.data) {
      connectionsData.data.forEach(c => {
        map[c.id] = c.name
      })
    }
    return map
  }, [connectionsData])

  useEffect(() => {
    if (!metricsData || typeof metricsData !== 'object') return

    const graph = buildGraph(metricsData, connectionNames)
    setNodes(graph.nodes)
    setEdges(graph.edges)
  }, [metricsData, connectionNames, setNodes, setEdges])

  const hasData = nodes.length > 0

  return (
    <Box sx={{ p: 3 }}>
        {metricsLoading ? (
          <Box sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 'calc(100vh - 250px)',
            gap: 2,
          }}>
            <CircularProgress size={40} />
            <Typography variant="body2" sx={{ opacity: 0.5 }}>
              {t('topology.loading')}
            </Typography>
          </Box>
        ) : !hasData ? (
          <Alert severity="info" sx={{ mt: 2 }}>
            {t('topology.noData')}
          </Alert>
        ) : (
          <Box sx={{
            width: '100%',
            height: 'calc(100vh - 200px)',
            minHeight: 500,
            borderRadius: 2,
            border: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.default',
            overflow: 'hidden',
            '& .react-flow__controls': {
              bgcolor: 'background.paper',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
              boxShadow: theme.shadows[4],
            },
            '& .react-flow__controls-button': {
              bgcolor: 'background.paper',
              borderBottom: '1px solid',
              borderColor: 'divider',
              fill: theme.palette.text.secondary,
              '&:hover': {
                bgcolor: 'action.hover',
              },
            },
            '& .react-flow__minimap': {
              bgcolor: `${theme.palette.background.default} !important`,
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
            },
            '& .react-flow__background': {
              bgcolor: `${theme.palette.background.default} !important`,
            },
          }}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.3 }}
              proOptions={{ hideAttribution: true }}
            >
              <Background
                gap={20}
                size={1}
                color={alpha(theme.palette.divider, 0.5)}
              />
              <Controls />
              <MiniMap
                nodeColor={(n) => {
                  if (n.type === 'clusterNode') return theme.palette.info.main
                  return theme.palette.primary.main
                }}
                maskColor={alpha(theme.palette.common.black, 0.6)}
              />
            </ReactFlow>
          </Box>
        )}
      </Box>
  )
}
