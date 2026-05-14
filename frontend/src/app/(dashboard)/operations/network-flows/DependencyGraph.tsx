'use client'

import { useMemo, useCallback, useEffect, useState } from 'react'

import { useTranslations } from 'next-intl'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import dagre from '@dagrejs/dagre'

import { Box, Chip, CircularProgress, Typography, useTheme } from '@mui/material'

import { formatBytes } from '@/utils/format'

interface IPPair {
  src_ip: string
  dst_ip: string
  bytes: number
  packets: number
  protocol: string
  dst_port: number
}

interface DependencyGraphProps {
  connectionId: string
}

async function fetchIPPairs(): Promise<IPPair[]> {
  const res = await fetch('/api/v1/orchestrator/sflow?endpoint=ip-pairs&n=50')

  if (!res.ok) return []
  const data = await res.json()


return Array.isArray(data) ? data : []
}

// Layout nodes using dagre
function getLayoutedElements(nodes: Node[], edges: Edge[], direction = 'LR') {
  const g = new dagre.graphlib.Graph()

  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: direction, ranksep: 100, nodesep: 60 })

  nodes.forEach((node) => {
    g.setNode(node.id, { width: 150, height: 50 })
  })

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target)
  })

  dagre.layout(g)

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = g.node(node.id)


return {
      ...node,
      position: {
        x: nodeWithPosition.x - 75,
        y: nodeWithPosition.y - 25,
      },
    }
  })

  return { nodes: layoutedNodes, edges }
}

export default function DependencyGraph({ connectionId }: DependencyGraphProps) {
  const t = useTranslations()
  const theme = useTheme()
  const [pairs, setPairs] = useState<IPPair[]>([])
  const [loading, setLoading] = useState(true)

  const primaryColor = theme.palette.primary.main
  const isDark = theme.palette.mode === 'dark'

  useEffect(() => {
    fetchIPPairs().then(data => {
      setPairs(data)
      setLoading(false)
    })

    const interval = setInterval(async () => {
      const data = await fetchIPPairs()

      setPairs(data)
    }, 15000)

    return () => clearInterval(interval)
  }, [])

  // Build nodes and edges from IP pairs
  const { initialNodes, initialEdges } = useMemo(() => {
    if (pairs.length === 0) return { initialNodes: [], initialEdges: [] }

    const ipSet = new Set<string>()
    const ipBytes = new Map<string, number>()

    // Collect unique IPs and total bytes
    for (const pair of pairs) {
      ipSet.add(pair.src_ip)
      ipSet.add(pair.dst_ip)
      ipBytes.set(pair.src_ip, (ipBytes.get(pair.src_ip) || 0) + pair.bytes)
      ipBytes.set(pair.dst_ip, (ipBytes.get(pair.dst_ip) || 0) + pair.bytes)
    }

    // Create nodes
    const nodes: Node[] = Array.from(ipSet).map((ip) => {
      const totalBytes = ipBytes.get(ip) || 0
      const isInfra = ip.startsWith('10.99.99.10') // Node IPs — adjust as needed

      return {
        id: ip,
        data: {
          label: (
            <Box sx={{ textAlign: 'center', p: 0.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, mb: 0.25 }}>
                <i className={isInfra ? 'ri-server-line' : 'ri-computer-line'} style={{ fontSize: 12 }} />
                <Typography variant="caption" fontWeight={600} sx={{ fontSize: '0.7rem' }}>
                  {ip}
                </Typography>
              </Box>
              <Typography variant="caption" sx={{ fontSize: '0.6rem', opacity: 0.7 }}>
                {formatBytes(totalBytes)}
              </Typography>
            </Box>
          ),
        },
        style: {
          background: isDark ? '#1e293b' : '#f8fafc',
          border: `1px solid ${isInfra ? theme.palette.warning.main : primaryColor}`,
          borderRadius: 8,
          padding: 4,
          fontSize: 11,
          width: 150,
        },
        position: { x: 0, y: 0 },
      }
    })

    // Create edges
    const maxBytes = Math.max(...pairs.map(p => p.bytes), 1)

    const edges: Edge[] = pairs.map((pair, idx) => {
      const thickness = Math.max(1, Math.min(6, (pair.bytes / maxBytes) * 6))

      return {
        id: `e-${idx}`,
        source: pair.src_ip,
        target: pair.dst_ip,
        label: formatBytes(pair.bytes),
        labelStyle: { fontSize: 9, fill: theme.palette.text.secondary },
        labelBgStyle: { fill: isDark ? '#0f172a' : '#ffffff', fillOpacity: 0.8 },
        labelBgPadding: [4, 2] as [number, number],
        style: {
          stroke: primaryColor,
          strokeWidth: thickness,
          opacity: 0.6 + (pair.bytes / maxBytes) * 0.4,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 12,
          height: 12,
          color: primaryColor,
        },
        animated: pair.bytes > maxBytes * 0.5,
      }
    })

    // Apply dagre layout
    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(nodes, edges)


return { initialNodes: layoutedNodes, initialEdges: layoutedEdges }
  }, [pairs, primaryColor, isDark, theme])

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  useEffect(() => {
    setNodes(initialNodes)
    setEdges(initialEdges)
  }, [initialNodes, initialEdges, setNodes, setEdges])

  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
        <CircularProgress size={32} />
      </Box>
    )
  }

  if (pairs.length === 0) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
        <Box sx={{ textAlign: 'center', opacity: 0.5 }}>
          <i className="ri-git-branch-line" style={{ fontSize: 48 }} />
          <Typography variant="body2" sx={{ mt: 1 }}>{t('networkFlows.waitingForData')}</Typography>
        </Box>
      </Box>
    )
  }

  return (
    <Box sx={{ flex: 1, minHeight: 500, border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        attributionPosition="bottom-left"
        proOptions={{ hideAttribution: true }}
        style={{ background: isDark ? '#0f172a' : '#fafafa' }}
      >
        <Background color={isDark ? '#1e293b' : '#e2e8f0'} gap={20} />
        <Controls
          style={{ background: isDark ? '#1e293b' : '#ffffff', borderRadius: 8, border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}` }}
        />
        <MiniMap
          nodeColor={primaryColor}
          maskColor={isDark ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.1)'}
          style={{ background: isDark ? '#1e293b' : '#f1f5f9', borderRadius: 8 }}
        />
      </ReactFlow>
    </Box>
  )
}
