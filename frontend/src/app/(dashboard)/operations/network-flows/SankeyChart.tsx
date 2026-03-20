'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { sankey, sankeyLinkHorizontal, SankeyNode, SankeyLink } from 'd3-sankey'

import {
  Box,
  Card,
  CardContent,
  CircularProgress,
  Typography,
  useTheme,
} from '@mui/material'

import { formatBytes } from '@/utils/format'

interface IPPair {
  src_ip: string
  dst_ip: string
  bytes: number
  packets: number
  protocol: string
  dst_port: number
}

interface SankeyNodeData {
  name: string
  category: 'source' | 'service' | 'destination'
}

interface SankeyLinkData {
  source: number
  target: number
  value: number
  protocol: string
  port: number
}

// Well-known port → service name
function portToService(port: number, protocol: string): string {
  const services: Record<number, string> = {
    22: 'SSH', 53: 'DNS', 80: 'HTTP', 443: 'HTTPS', 3306: 'MySQL',
    5432: 'PostgreSQL', 6379: 'Redis', 8006: 'PVE API', 8080: 'HTTP-Alt',
    25: 'SMTP', 110: 'POP3', 143: 'IMAP', 3389: 'RDP', 5900: 'VNC',
    6789: 'Ceph MON', 3300: 'Ceph MON', 2049: 'NFS', 445: 'SMB',
    9090: 'Prometheus', 9100: 'Node Exp', 5044: 'Logstash',
  }
  return services[port] || `${port}/${protocol}`
}

// Color palette for flows
const FLOW_COLORS = [
  '#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#6366f1',
  '#84cc16', '#e11d48', '#0ea5e9', '#d946ef', '#22d3ee',
]

async function fetchIPPairs(): Promise<IPPair[]> {
  const res = await fetch('/api/v1/orchestrator/sflow?endpoint=ip-pairs&n=100')
  if (!res.ok) return []
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

export default function SankeyChart() {
  const t = useTranslations()
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const containerRef = useRef<HTMLDivElement>(null)

  const [pairs, setPairs] = useState<IPPair[]>([])
  const [loading, setLoading] = useState(true)
  const [hoveredLink, setHoveredLink] = useState<number | null>(null)
  const [dimensions, setDimensions] = useState({ width: 900, height: 500 })

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

  // Observe container size
  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setDimensions({
          width: Math.max(600, entry.contentRect.width),
          height: Math.max(400, Math.min(700, entry.contentRect.width * 0.5)),
        })
      }
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  // Build Sankey data
  const sankeyData = useMemo(() => {
    if (pairs.length === 0) return null

    const nodeMap = new Map<string, number>()
    const nodes: SankeyNodeData[] = []
    const links: SankeyLinkData[] = []

    const getOrCreateNode = (name: string, category: SankeyNodeData['category']): number => {
      const key = `${category}:${name}`
      if (nodeMap.has(key)) return nodeMap.get(key)!
      const idx = nodes.length
      nodeMap.set(key, idx)
      nodes.push({ name, category })
      return idx
    }

    // Aggregate by src → service → dst
    const aggregated = new Map<string, { bytes: number; protocol: string; port: number; srcIP: string; dstIP: string }>()

    for (const pair of pairs) {
      const service = portToService(pair.dst_port, pair.protocol)
      const key = `${pair.src_ip}|${service}|${pair.dst_ip}`

      const existing = aggregated.get(key)
      if (existing) {
        existing.bytes += pair.bytes
      } else {
        aggregated.set(key, {
          bytes: pair.bytes,
          protocol: pair.protocol,
          port: pair.dst_port,
          srcIP: pair.src_ip,
          dstIP: pair.dst_ip,
        })
      }
    }

    // Only keep top flows to avoid visual clutter
    const sortedFlows = Array.from(aggregated.values()).sort((a, b) => b.bytes - a.bytes).slice(0, 30)

    for (const flow of sortedFlows) {
      const service = portToService(flow.port, flow.protocol)
      const srcIdx = getOrCreateNode(flow.srcIP, 'source')
      const svcIdx = getOrCreateNode(service, 'service')
      const dstIdx = getOrCreateNode(flow.dstIP, 'destination')

      // src → service
      links.push({ source: srcIdx, target: svcIdx, value: flow.bytes, protocol: flow.protocol, port: flow.port })
      // service → dst
      links.push({ source: svcIdx, target: dstIdx, value: flow.bytes, protocol: flow.protocol, port: flow.port })
    }

    if (nodes.length === 0 || links.length === 0) return null

    return { nodes, links }
  }, [pairs])

  // Compute Sankey layout
  const layout = useMemo(() => {
    if (!sankeyData) return null

    const margin = { top: 30, right: 20, bottom: 10, left: 20 }
    const width = dimensions.width - margin.left - margin.right
    const height = dimensions.height - margin.top - margin.bottom

    try {
      const sankeyGenerator = sankey<SankeyNodeData, SankeyLinkData>()
        .nodeWidth(20)
        .nodePadding(12)
        .extent([[0, 0], [width, height]])
        .nodeSort((a, b) => {
          // Sort by category then by value
          const catOrder = { source: 0, service: 1, destination: 2 }
          return (catOrder[a.category] || 0) - (catOrder[b.category] || 0)
        })

      const result = sankeyGenerator({
        nodes: sankeyData.nodes.map(d => ({ ...d })),
        links: sankeyData.links.map(d => ({ ...d })),
      })

      return { ...result, margin, width, height }
    } catch {
      return null
    }
  }, [sankeyData, dimensions])

  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
        <CircularProgress size={32} />
      </Box>
    )
  }

  if (!layout || pairs.length === 0) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
        <Box sx={{ textAlign: 'center', opacity: 0.5 }}>
          <i className="ri-flow-chart" style={{ fontSize: 48 }} />
          <Typography variant="body2" sx={{ mt: 1 }}>{t('networkFlows.waitingForData')}</Typography>
        </Box>
      </Box>
    )
  }

  const { nodes: layoutNodes, links: layoutLinks, margin } = layout
  const linkPathGenerator = sankeyLinkHorizontal()

  // Category labels
  const categories = [
    { label: 'Source', x: margin.left },
    { label: 'Application', x: dimensions.width / 2 - 30 },
    { label: 'Destination', x: dimensions.width - margin.right - 60 },
  ]

  return (
    <Card variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
          <i className="ri-flow-chart" style={{ fontSize: 16, marginRight: 6 }} />
          {t('networkFlows.flowDiagram')}
        </Typography>

        <Box ref={containerRef} sx={{ width: '100%', overflow: 'hidden' }}>
          <svg
            width={dimensions.width}
            height={dimensions.height}
            style={{ display: 'block' }}
          >
            {/* Column headers */}
            {categories.map((cat, i) => (
              <text
                key={i}
                x={cat.x + margin.left}
                y={16}
                fill={theme.palette.text.secondary}
                fontSize={12}
                fontWeight={600}
                fontFamily="Inter, sans-serif"
              >
                {cat.label}
              </text>
            ))}

            <g transform={`translate(${margin.left},${margin.top})`}>
              {/* Links */}
              {layoutLinks.map((link: any, idx: number) => {
                const path = linkPathGenerator(link)
                if (!path) return null

                const color = FLOW_COLORS[idx % FLOW_COLORS.length]
                const isHovered = hoveredLink === idx || hoveredLink === idx + 1 || hoveredLink === idx - 1

                return (
                  <path
                    key={idx}
                    d={path}
                    fill="none"
                    stroke={color}
                    strokeWidth={Math.max(2, link.width || 1)}
                    strokeOpacity={hoveredLink === null ? 0.4 : isHovered ? 0.7 : 0.1}
                    onMouseEnter={() => setHoveredLink(idx)}
                    onMouseLeave={() => setHoveredLink(null)}
                    style={{ cursor: 'pointer', transition: 'stroke-opacity 0.2s' }}
                  >
                    <title>
                      {`${(link.source as any).name} → ${(link.target as any).name}\n${formatBytes(link.value)}`}
                    </title>
                  </path>
                )
              })}

              {/* Nodes */}
              {layoutNodes.map((node: any, idx: number) => {
                const nodeHeight = Math.max(4, (node.y1 || 0) - (node.y0 || 0))
                const categoryColors = {
                  source: theme.palette.warning.main,
                  service: theme.palette.primary.main,
                  destination: theme.palette.success.main,
                }
                const color = categoryColors[node.category as keyof typeof categoryColors] || theme.palette.primary.main

                return (
                  <g key={idx}>
                    <rect
                      x={node.x0}
                      y={node.y0}
                      width={(node.x1 || 0) - (node.x0 || 0)}
                      height={nodeHeight}
                      fill={color}
                      rx={3}
                      opacity={0.9}
                    />
                    <text
                      x={node.category === 'destination' ? (node.x0 || 0) - 6 : (node.x1 || 0) + 6}
                      y={(node.y0 || 0) + nodeHeight / 2}
                      dy="0.35em"
                      textAnchor={node.category === 'destination' ? 'end' : 'start'}
                      fill={theme.palette.text.primary}
                      fontSize={10}
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {node.name}
                    </text>
                  </g>
                )
              })}
            </g>
          </svg>
        </Box>
      </CardContent>
    </Card>
  )
}
