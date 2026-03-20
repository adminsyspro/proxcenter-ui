'use client'

import { useState, useEffect, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, CartesianGrid, Cell,
  PieChart, Pie, Legend,
} from 'recharts'

import {
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  LinearProgress,
  Typography,
  useTheme,
} from '@mui/material'

import { formatBytes } from '@/utils/format'

interface TopTalker {
  vmid: number
  vm_name: string
  node: string
  bytes_in: number
  bytes_out: number
  packets: number
}

interface TopPort {
  port: number
  protocol: string
  service: string
  bytes: number
  packets: number
  percent: number
}

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

async function fetchSFlow(endpoint: string, params?: Record<string, string>) {
  const query = new URLSearchParams({ endpoint, ...params })
  const res = await fetch(`/api/v1/orchestrator/sflow?${query}`)
  if (!res.ok) return null
  return res.json()
}

const NODE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6']
const SERVICE_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#6366f1']

export default function InfrastructureTab() {
  const t = useTranslations()
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'

  const [talkers, setTalkers] = useState<TopTalker[]>([])
  const [ports, setPorts] = useState<TopPort[]>([])
  const [nodeConnectionMap, setNodeConnectionMap] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetchSFlow('top-talkers', { n: '50' }),
      fetchSFlow('top-ports', { n: '15' }),
      fetch('/api/v1/orchestrator/sflow/agents').then(r => r.ok ? r.json() : { data: [] }),
    ]).then(([talkersData, portsData, agentsData]) => {
      setTalkers(Array.isArray(talkersData) ? talkersData : [])
      setPorts(Array.isArray(portsData) ? portsData : [])
      // Build node→connectionName mapping
      const map = new Map<string, string>()
      for (const a of (agentsData?.data || [])) {
        if (a.node && a.connectionName) map.set(a.node, a.connectionName)
      }
      setNodeConnectionMap(map)
    }).finally(() => setLoading(false))

    const interval = setInterval(() => {
      Promise.all([
        fetchSFlow('top-talkers', { n: '50' }),
        fetchSFlow('top-ports', { n: '15' }),
      ]).then(([talkersData, portsData]) => {
        setTalkers(Array.isArray(talkersData) ? talkersData : [])
        setPorts(Array.isArray(portsData) ? portsData : [])
      })
    }, 15000)
    return () => clearInterval(interval)
  }, [])

  // Traffic per node
  const nodeTraffic = useMemo(() => {
    const nodeMap = new Map<string, { node: string; bytesIn: number; bytesOut: number; vmCount: number }>()
    for (const t of talkers) {
      const node = t.node || 'Unknown'
      const entry = nodeMap.get(node) || { node, bytesIn: 0, bytesOut: 0, vmCount: 0 }
      entry.bytesIn += t.bytes_in
      entry.bytesOut += t.bytes_out
      entry.vmCount++
      nodeMap.set(node, entry)
    }
    return Array.from(nodeMap.values()).sort((a, b) => (b.bytesIn + b.bytesOut) - (a.bytesIn + a.bytesOut))
  }, [talkers])

  // Service distribution
  const serviceDist = useMemo(() => {
    return ports.slice(0, 8).map(p => ({
      name: portToService(p.port, p.protocol),
      bytes: p.bytes,
    }))
  }, [ports])

  // Top VMs grouped by connection → node
  const vmsByConnection = useMemo(() => {
    // Group talkers by connection name (via node mapping)
    const grouped = new Map<string, Map<string, TopTalker[]>>()
    for (const t of talkers) {
      const node = t.node || 'Unknown'
      const conn = nodeConnectionMap.get(node) || 'Unknown'
      if (!grouped.has(conn)) grouped.set(conn, new Map())
      const nodeMap = grouped.get(conn)!
      if (!nodeMap.has(node)) nodeMap.set(node, [])
      nodeMap.get(node)!.push(t)
    }
    // Sort VMs within each node
    for (const nodes of grouped.values()) {
      for (const vms of nodes.values()) {
        vms.sort((a, b) => (b.bytes_in + b.bytes_out) - (a.bytes_in + a.bytes_out))
      }
    }
    return grouped
  }, [talkers, nodeConnectionMap])

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress size={32} /></Box>
  }

  if (talkers.length === 0) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400, opacity: 0.5 }}>
        <Box sx={{ textAlign: 'center' }}>
          <i className="ri-server-line" style={{ fontSize: 48 }} />
          <Typography variant="body2" sx={{ mt: 1 }}>{t('networkFlows.waitingForData')}</Typography>
        </Box>
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>

      {/* Traffic per Node + Service Distribution */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' }, gap: 2 }}>
        <Card variant="outlined" sx={{ borderRadius: 2 }}>
          <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>
              <img src={isDark ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" style={{ width: 16, height: 16, marginRight: 6, verticalAlign: 'middle' }} />
              Traffic per Node
            </Typography>
            <Box sx={{ height: Math.max(200, nodeTraffic.length * 40 + 40) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={nodeTraffic} layout="vertical" margin={{ top: 5, right: 60, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} horizontal={false} />
                  <XAxis type="number" tickFormatter={(v) => formatBytes(v)} tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="node" tick={{ fontSize: 11 }} width={120} />
                  <RechartsTooltip
                    cursor={{ fill: theme.palette.action.hover }}
                    formatter={(v: number, name: string) => [formatBytes(v), name === 'bytesIn' ? '↓ Inbound' : '↑ Outbound']}
                    contentStyle={{ fontSize: 12, borderRadius: 8, backgroundColor: theme.palette.background.paper, borderColor: theme.palette.divider, color: theme.palette.text.primary }}
                  />
                  <Bar dataKey="bytesIn" name="bytesIn" stackId="a" fill={theme.palette.success.main} maxBarSize={18} />
                  <Bar dataKey="bytesOut" name="bytesOut" stackId="a" fill={theme.palette.warning.main} radius={[0, 4, 4, 0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </Box>
          </CardContent>
        </Card>

        <Card variant="outlined" sx={{ borderRadius: 2 }}>
          <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>
              <i className="ri-apps-line" style={{ fontSize: 16, marginRight: 6 }} />
              Service Distribution
            </Typography>
            <Box sx={{ height: Math.max(200, nodeTraffic.length * 40 + 40) }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={serviceDist} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="bytes" nameKey="name" strokeWidth={2} stroke={isDark ? '#0f172a' : '#ffffff'}>
                    {serviceDist.map((_, idx) => <Cell key={idx} fill={SERVICE_COLORS[idx % SERVICE_COLORS.length]} />)}
                  </Pie>
                  <RechartsTooltip
                    formatter={(v: number, name: string) => [formatBytes(v), name]}
                    contentStyle={{ backgroundColor: theme.palette.background.paper, borderColor: theme.palette.divider, color: theme.palette.text.primary, fontSize: 12, borderRadius: 8 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                </PieChart>
              </ResponsiveContainer>
            </Box>
          </CardContent>
        </Card>
      </Box>

      {/* Top VMs per Node — grouped by connection */}
      {vmsByConnection.size > 0 && (
        <Card variant="outlined" sx={{ borderRadius: 2 }}>
          <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>
              <i className="ri-computer-line" style={{ fontSize: 16, marginRight: 6 }} />
              Top VMs per Node
            </Typography>
            {Array.from(vmsByConnection.entries()).map(([connName, nodesMap]) => (
              <Box key={connName} sx={{ mb: 2, '&:last-child': { mb: 0 } }}>
                {/* Connection header */}
                {vmsByConnection.size > 1 && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, px: 0.5, py: 0.5, borderRadius: 1, bgcolor: 'action.hover' }}>
                    <i className="ri-database-2-line" style={{ fontSize: 14, opacity: 0.6 }} />
                    <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      {connName}
                    </Typography>
                    <Chip label={`${nodesMap.size} nodes`} size="small" variant="outlined" sx={{ height: 18, fontSize: '0.6rem' }} />
                  </Box>
                )}
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: `repeat(${Math.min(nodesMap.size, 3)}, 1fr)` }, gap: 2 }}>
                  {Array.from(nodesMap.entries()).map(([node, vms], nodeIdx) => {
                    const nodeTotal = vms.reduce((s, v) => s + v.bytes_in + v.bytes_out, 0)
                    return (
                      <Box key={node}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                          <img src={isDark ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" style={{ width: 14, height: 14 }} />
                          <Typography variant="caption" fontWeight={700} sx={{ textTransform: 'uppercase' }}>{node}</Typography>
                          <Chip label={`${vms.length} VMs`} size="small" variant="outlined" sx={{ height: 18, fontSize: '0.6rem' }} />
                        </Box>
                        {vms.slice(0, 5).map((vm) => {
                          const vmTotal = vm.bytes_in + vm.bytes_out
                          const pct = nodeTotal > 0 ? (vmTotal / nodeTotal) * 100 : 0
                          return (
                            <Box key={vm.vmid} sx={{ mb: 0.75 }}>
                              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
                                <Typography variant="caption" fontSize="0.7rem" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                  <i className="ri-computer-line" style={{ fontSize: 10, opacity: 0.5 }} />
                                  {vm.vm_name || `VM ${vm.vmid}`}
                                </Typography>
                                <Typography variant="caption" fontFamily="JetBrains Mono, monospace" fontSize="0.65rem" color="text.secondary">
                                  {formatBytes(vmTotal)}
                                </Typography>
                              </Box>
                              <LinearProgress variant="determinate" value={pct} sx={{ height: 5, borderRadius: 3, bgcolor: 'action.hover', '& .MuiLinearProgress-bar': { borderRadius: 3, bgcolor: NODE_COLORS[nodeIdx % NODE_COLORS.length] } }} />
                            </Box>
                          )
                        })}
                        {vms.length > 5 && <Typography variant="caption" color="text.secondary">+{vms.length - 5} more</Typography>}
                      </Box>
                    )
                  })}
                </Box>
              </Box>
            ))}
          </CardContent>
        </Card>
      )}

    </Box>
  )
}
