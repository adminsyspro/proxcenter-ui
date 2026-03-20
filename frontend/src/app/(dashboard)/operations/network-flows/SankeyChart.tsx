'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { sankey, sankeyLinkHorizontal } from 'd3-sankey'

import {
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  LinearProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
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
  packets?: number
  srcIP?: string
  dstIP?: string
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

// Detail info for the modal
interface NodeDetail {
  type: 'node'
  name: string
  category: 'source' | 'service' | 'destination'
  totalBytes: number
  totalPackets: number
  connections: Array<{ name: string; bytes: number; packets: number; direction: 'in' | 'out'; protocol?: string; port?: number }>
}

interface LinkDetail {
  type: 'link'
  sourceName: string
  targetName: string
  srcIP: string
  service: string
  dstIP: string
  bytes: number
  packets: number
  protocol: string
  port: number
  totalBytes: number
}

type DetailData = NodeDetail | LinkDetail

export default function SankeyChart({ connectionId }: { connectionId?: string }) {
  const t = useTranslations()
  const theme = useTheme()
  const containerRef = useRef<HTMLDivElement>(null)

  const [pairs, setPairs] = useState<IPPair[]>([])
  const [loading, setLoading] = useState(true)
  const [hoveredLink, setHoveredLink] = useState<number | null>(null)
  const [hoveredNode, setHoveredNode] = useState<number | null>(null)
  const [containerWidth, setContainerWidth] = useState(typeof window !== 'undefined' ? window.innerWidth - 300 : 900)
  const [detail, setDetail] = useState<DetailData | null>(null)

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

  // Track container width
  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setContainerWidth(Math.max(400, Math.floor(entry.contentRect.width)))
      }
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  // SVG dimensions: full width, height = fill remaining viewport
  const svgWidth = containerWidth || 900
  const svgHeight = useMemo(() => {
    // Viewport height - page header(64) - tabs(48) - card header(40) - paddings(48)
    const available = typeof window !== 'undefined' ? window.innerHeight - 200 : 500
    return Math.max(350, available)
  }, [containerWidth]) // recalc when width changes (orientation change)

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
    const aggregated = new Map<string, { bytes: number; packets: number; protocol: string; port: number; srcIP: string; dstIP: string }>()

    for (const pair of pairs) {
      const service = portToService(pair.dst_port, pair.protocol)
      const key = `${pair.src_ip}|${service}|${pair.dst_ip}`

      const existing = aggregated.get(key)
      if (existing) {
        existing.bytes += pair.bytes
        existing.packets += pair.packets
      } else {
        aggregated.set(key, {
          bytes: pair.bytes,
          packets: pair.packets,
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
      links.push({ source: srcIdx, target: svcIdx, value: flow.bytes, protocol: flow.protocol, port: flow.port, packets: flow.packets, srcIP: flow.srcIP, dstIP: flow.dstIP })
      // service → dst
      links.push({ source: svcIdx, target: dstIdx, value: flow.bytes, protocol: flow.protocol, port: flow.port, packets: flow.packets, srcIP: flow.srcIP, dstIP: flow.dstIP })
    }

    if (nodes.length === 0 || links.length === 0) return null

    return { nodes, links }
  }, [pairs])

  // Compute Sankey layout
  const layout = useMemo(() => {
    if (!sankeyData) return null

    const margin = { top: 30, right: 120, bottom: 10, left: 120 }
    const width = svgWidth - margin.left - margin.right
    const height = svgHeight - margin.top - margin.bottom

    try {
      const sankeyGenerator = sankey<SankeyNodeData, SankeyLinkData>()
        .nodeWidth(20)
        .nodePadding(12)
        .extent([[0, 0], [width, height]])
        .nodeSort((a, b) => {
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
  }, [sankeyData, svgWidth, svgHeight])

  // Total bytes for percentage calculations
  const totalBytes = useMemo(() => {
    if (!layout) return 0
    // Sum only source→service links (half the links) to avoid double counting
    return layout.links.reduce((sum: number, l: any, i: number) => i % 2 === 0 ? sum + (l.value || 0) : sum, 0)
  }, [layout])

  // Build detail data for a node click
  const handleNodeClick = (node: any, nodeIdx: number) => {
    if (!layout) return
    const connections: NodeDetail['connections'] = []
    let totalNodeBytes = 0
    let totalNodePackets = 0

    for (const link of layout.links as any[]) {
      if ((link.source as any).index === nodeIdx) {
        connections.push({
          name: (link.target as any).name,
          bytes: link.value,
          packets: link.packets || 0,
          direction: 'out',
          protocol: link.protocol,
          port: link.port,
        })
        totalNodeBytes += link.value
        totalNodePackets += link.packets || 0
      }
      if ((link.target as any).index === nodeIdx) {
        connections.push({
          name: (link.source as any).name,
          bytes: link.value,
          packets: link.packets || 0,
          direction: 'in',
          protocol: link.protocol,
          port: link.port,
        })
        totalNodeBytes += link.value
        totalNodePackets += link.packets || 0
      }
    }

    connections.sort((a, b) => b.bytes - a.bytes)

    setDetail({
      type: 'node',
      name: node.name,
      category: node.category,
      totalBytes: totalNodeBytes,
      totalPackets: totalNodePackets,
      connections,
    })
  }

  // Build detail data for a link click — reconstruct full path src → service → dst
  const handleLinkClick = (link: any, linkIdx: number) => {
    const srcNode = link.source as any
    const tgtNode = link.target as any

    // Links come in pairs: even=src→service, odd=service→dst
    // Find the sibling link to reconstruct the full path
    let srcIP = link.srcIP || ''
    let service = ''
    let dstIP = link.dstIP || ''

    if (srcNode.category === 'source' && tgtNode.category === 'service') {
      // This is src→service, the next link is service→dst
      srcIP = srcNode.name
      service = tgtNode.name
      const siblingLink = (layout?.links as any[])?.[linkIdx + 1]
      if (siblingLink) dstIP = (siblingLink.target as any)?.name || dstIP
    } else if (srcNode.category === 'service' && tgtNode.category === 'destination') {
      // This is service→dst, the previous link is src→service
      service = srcNode.name
      dstIP = tgtNode.name
      const siblingLink = (layout?.links as any[])?.[linkIdx - 1]
      if (siblingLink) srcIP = (siblingLink.source as any)?.name || srcIP
    } else {
      srcIP = srcNode.name
      dstIP = tgtNode.name
    }

    setDetail({
      type: 'link',
      sourceName: srcNode.name,
      targetName: tgtNode.name,
      srcIP,
      service: service || portToService(link.port, link.protocol),
      dstIP,
      bytes: link.value,
      packets: link.packets || 0,
      protocol: link.protocol,
      port: link.port,
      totalBytes,
    })
  }

  // Check if a node's links are hovered
  const isNodeHighlighted = (nodeIdx: number): boolean => {
    if (hoveredNode === nodeIdx) return true
    if (hoveredLink === null) return false
    const link = (layout?.links as any[])?.[hoveredLink]
    if (!link) return false
    return (link.source as any).index === nodeIdx || (link.target as any).index === nodeIdx
  }

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
    { label: t('networkFlows.source'), x: margin.left },
    { label: t('networkFlows.application'), x: svgWidth / 2 - 30 },
    { label: t('networkFlows.destination'), x: svgWidth - margin.right - 60 },
  ]

  const categoryColors: Record<string, string> = {
    source: theme.palette.warning.main,
    service: theme.palette.primary.main,
    destination: theme.palette.success.main,
  }

  const categoryLabels: Record<string, string> = {
    source: t('networkFlows.source'),
    service: t('networkFlows.application'),
    destination: t('networkFlows.destination'),
  }

  return (
    <>
      <Card variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden', width: '100%' }}>
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
            <i className="ri-flow-chart" style={{ fontSize: 16, marginRight: 6 }} />
            {t('networkFlows.flowDiagram')}
          </Typography>

          <Box ref={containerRef} sx={{ width: '100%', minWidth: 0, overflow: 'hidden', minHeight: 100 }}>
            <svg
              width={svgWidth}
              height={svgHeight}
              style={{ display: 'block', maxWidth: '100%' }}
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
                      strokeOpacity={hoveredLink === null && hoveredNode === null ? 0.4 : isHovered ? 0.7 : 0.1}
                      onMouseEnter={() => setHoveredLink(idx)}
                      onMouseLeave={() => setHoveredLink(null)}
                      onClick={() => handleLinkClick(link, idx)}
                      style={{ cursor: 'pointer', transition: 'stroke-opacity 0.2s' }}
                    >
                      <title>
                        {`${(link.source as any).name} → ${(link.target as any).name}\n${formatBytes(link.value)} · ${(link.packets || 0).toLocaleString()} pkts`}
                      </title>
                    </path>
                  )
                })}

                {/* Nodes */}
                {layoutNodes.map((node: any, idx: number) => {
                  const nodeHeight = Math.max(4, (node.y1 || 0) - (node.y0 || 0))
                  const color = categoryColors[node.category] || theme.palette.primary.main
                  const highlighted = isNodeHighlighted(idx)

                  return (
                    <g
                      key={idx}
                      onClick={() => handleNodeClick(node, idx)}
                      onMouseEnter={() => setHoveredNode(idx)}
                      onMouseLeave={() => setHoveredNode(null)}
                      style={{ cursor: 'pointer' }}
                    >
                      <rect
                        x={node.x0}
                        y={node.y0}
                        width={(node.x1 || 0) - (node.x0 || 0)}
                        height={nodeHeight}
                        fill={color}
                        rx={3}
                        opacity={hoveredNode === null && hoveredLink === null ? 0.9 : highlighted ? 1 : 0.3}
                        style={{ transition: 'opacity 0.2s' }}
                      />
                      <text
                        x={node.category === 'destination' ? (node.x0 || 0) - 6 : (node.x1 || 0) + 6}
                        y={(node.y0 || 0) + nodeHeight / 2}
                        dy="0.35em"
                        textAnchor={node.category === 'destination' ? 'end' : 'start'}
                        fill={theme.palette.text.primary}
                        fontSize={11}
                        fontFamily="JetBrains Mono, monospace"
                        opacity={hoveredNode === null && hoveredLink === null ? 1 : highlighted ? 1 : 0.3}
                        style={{ transition: 'opacity 0.2s' }}
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

      {/* Detail Modal */}
      <Dialog
        open={detail !== null}
        onClose={() => setDetail(null)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { borderRadius: 2 } }}
      >
        {detail?.type === 'node' && (
          <>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: categoryColors[detail.category] }} />
                <Typography variant="h6" fontFamily="JetBrains Mono, monospace" fontSize={16}>
                  {detail.name}
                </Typography>
                <Chip
                  label={categoryLabels[detail.category]}
                  size="small"
                  sx={{
                    bgcolor: `${categoryColors[detail.category]}20`,
                    color: categoryColors[detail.category],
                    fontWeight: 600,
                    fontSize: 11,
                  }}
                />
              </Box>
              <IconButton size="small" onClick={() => setDetail(null)}>
                <i className="ri-close-line" />
              </IconButton>
            </DialogTitle>
            <DialogContent>
              {/* KPI summary */}
              <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                <Box sx={{ flex: 1, p: 1.5, borderRadius: 1.5, bgcolor: theme.palette.action.hover }}>
                  <Typography variant="caption" color="text.secondary">{t('networkFlows.totalTraffic')}</Typography>
                  <Typography variant="h6" fontWeight={700} fontSize={16}>{formatBytes(detail.totalBytes)}</Typography>
                </Box>
                <Box sx={{ flex: 1, p: 1.5, borderRadius: 1.5, bgcolor: theme.palette.action.hover }}>
                  <Typography variant="caption" color="text.secondary">{t('networkFlows.packets')}</Typography>
                  <Typography variant="h6" fontWeight={700} fontSize={16}>{detail.totalPackets.toLocaleString()}</Typography>
                </Box>
                <Box sx={{ flex: 1, p: 1.5, borderRadius: 1.5, bgcolor: theme.palette.action.hover }}>
                  <Typography variant="caption" color="text.secondary">{t('networkFlows.connections')}</Typography>
                  <Typography variant="h6" fontWeight={700} fontSize={16}>{detail.connections.length}</Typography>
                </Box>
              </Box>

              <Divider sx={{ mb: 2 }} />

              {/* Connection breakdown */}
              <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
                {t('networkFlows.trafficBreakdown')}
              </Typography>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>{t('networkFlows.direction')}</TableCell>
                      <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>{t('networkFlows.peer')}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600, fontSize: 12 }}>{t('networkFlows.volume')}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600, fontSize: 12 }}>%</TableCell>
                      <TableCell sx={{ fontWeight: 600, fontSize: 12, width: 120 }}></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {detail.connections.map((conn, i) => {
                      const pct = detail.totalBytes > 0 ? (conn.bytes / detail.totalBytes) * 100 : 0
                      return (
                        <TableRow key={i} hover>
                          <TableCell>
                            <Chip
                              label={conn.direction === 'out' ? '→ OUT' : '← IN'}
                              size="small"
                              sx={{
                                fontSize: 10,
                                fontWeight: 700,
                                fontFamily: 'JetBrains Mono, monospace',
                                bgcolor: conn.direction === 'out' ? `${theme.palette.info.main}18` : `${theme.palette.success.main}18`,
                                color: conn.direction === 'out' ? theme.palette.info.main : theme.palette.success.main,
                              }}
                            />
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" fontFamily="JetBrains Mono, monospace" fontSize={12}>
                              {conn.name}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Typography variant="body2" fontWeight={600} fontSize={12}>
                              {formatBytes(conn.bytes)}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Typography variant="body2" fontSize={12} color="text.secondary">
                              {pct.toFixed(1)}%
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <LinearProgress
                              variant="determinate"
                              value={pct}
                              sx={{
                                height: 6,
                                borderRadius: 3,
                                bgcolor: theme.palette.action.hover,
                                '& .MuiLinearProgress-bar': {
                                  borderRadius: 3,
                                  bgcolor: conn.direction === 'out' ? theme.palette.info.main : theme.palette.success.main,
                                },
                              }}
                            />
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </DialogContent>
          </>
        )}

        {detail?.type === 'link' && (
          <>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className="ri-route-line" style={{ fontSize: 20 }} />
                <Typography variant="h6" fontSize={16}>{t('networkFlows.flowDetails')}</Typography>
              </Box>
              <IconButton size="small" onClick={() => setDetail(null)}>
                <i className="ri-close-line" />
              </IconButton>
            </DialogTitle>
            <DialogContent>
              {/* Full flow path: Source IP → Service → Destination IP */}
              <Box sx={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, p: 2, mb: 2,
                borderRadius: 1.5, bgcolor: theme.palette.action.hover,
              }}>
                <Box sx={{ textAlign: 'center' }}>
                  <Typography variant="caption" color="text.secondary" display="block">{t('networkFlows.source')}</Typography>
                  <Typography fontFamily="JetBrains Mono, monospace" fontWeight={700} fontSize={13} color="warning.main">
                    {detail.srcIP}
                  </Typography>
                </Box>
                <i className="ri-arrow-right-line" style={{ fontSize: 18, color: theme.palette.text.secondary }} />
                <Box sx={{ textAlign: 'center' }}>
                  <Typography variant="caption" color="text.secondary" display="block">{t('networkFlows.application')}</Typography>
                  <Chip
                    label={detail.service}
                    size="small"
                    color="primary"
                    sx={{ fontWeight: 700, fontSize: 12, fontFamily: 'JetBrains Mono, monospace' }}
                  />
                </Box>
                <i className="ri-arrow-right-line" style={{ fontSize: 18, color: theme.palette.text.secondary }} />
                <Box sx={{ textAlign: 'center' }}>
                  <Typography variant="caption" color="text.secondary" display="block">{t('networkFlows.destination')}</Typography>
                  <Typography fontFamily="JetBrains Mono, monospace" fontWeight={700} fontSize={13} color="success.main">
                    {detail.dstIP}
                  </Typography>
                </Box>
              </Box>

              {/* Flow metrics */}
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mb: 2 }}>
                <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: theme.palette.action.hover }}>
                  <Typography variant="caption" color="text.secondary">{t('networkFlows.volume')}</Typography>
                  <Typography variant="h6" fontWeight={700} fontSize={16}>{formatBytes(detail.bytes)}</Typography>
                </Box>
                <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: theme.palette.action.hover }}>
                  <Typography variant="caption" color="text.secondary">{t('networkFlows.packets')}</Typography>
                  <Typography variant="h6" fontWeight={700} fontSize={16}>{detail.packets.toLocaleString()}</Typography>
                </Box>
                <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: theme.palette.action.hover }}>
                  <Typography variant="caption" color="text.secondary">{t('networkFlows.protocol')}</Typography>
                  <Typography variant="h6" fontWeight={700} fontSize={16}>
                    {detail.protocol.toUpperCase()}
                  </Typography>
                </Box>
                <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: theme.palette.action.hover }}>
                  <Typography variant="caption" color="text.secondary">{t('networkFlows.port')}</Typography>
                  <Typography variant="h6" fontWeight={700} fontSize={16}>
                    {detail.port}
                  </Typography>
                </Box>
              </Box>

              {/* Share of total */}
              {detail.totalBytes > 0 && (
                <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: theme.palette.action.hover }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="caption" color="text.secondary">{t('networkFlows.shareOfTotal')}</Typography>
                    <Typography variant="caption" fontWeight={700}>
                      {((detail.bytes / detail.totalBytes) * 100).toFixed(1)}%
                    </Typography>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={(detail.bytes / detail.totalBytes) * 100}
                    sx={{
                      height: 8,
                      borderRadius: 4,
                      bgcolor: theme.palette.action.hover,
                      '& .MuiLinearProgress-bar': { borderRadius: 4 },
                    }}
                  />
                </Box>
              )}
            </DialogContent>
          </>
        )}
      </Dialog>
    </>
  )
}
