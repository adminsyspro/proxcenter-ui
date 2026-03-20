'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, Cell } from 'recharts'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  LinearProgress,
  Tooltip as MuiTooltip,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  useTheme,
} from '@mui/material'

import { formatBytes } from '@/utils/format'
import dynamic from 'next/dynamic'

const SankeyChart = dynamic(() => import('./SankeyChart'), { ssr: false })
const TimeSeriesChart = dynamic(() => import('./TimeSeriesChart'), { ssr: false })

interface FlowsTabProps {
  connectionId: string
  connectionName?: string
}

interface SFlowStatus {
  enabled: boolean
  listen_address: string
  agents: Array<{ agent_ip: string; node: string; last_seen: string; flow_rate: number; sample_count: number; active: boolean }>
  total_flows: number
  flow_rate: number
  active_vms: number
  uptime_seconds: number
}

interface TopTalker {
  vmid: number
  vm_name: string
  node: string
  bytes_in: number
  bytes_out: number
  packets: number
}

interface TopPair {
  src_vmid: number
  src_name: string
  dst_vmid: number
  dst_name: string
  bytes: number
  protocol: string
  dst_port: number
}

interface TopEndpoint {
  ip: string
  vmid?: number
  vm_name?: string
  bytes: number
  packets: number
  flow_count: number
}

interface TopPort {
  port: number
  protocol: string
  service: string
  bytes: number
  packets: number
  percent: number
}

async function fetchSFlow(endpoint: string, params?: Record<string, string>) {
  const query = new URLSearchParams({ endpoint, ...params })
  const res = await fetch(`/api/v1/orchestrator/sflow?${query}`)
  if (!res.ok) throw new Error(`sFlow API error: ${res.status}`)
  return res.json()
}

export default function FlowsTab({ connectionId, connectionName }: FlowsTabProps) {
  const t = useTranslations()
  const theme = useTheme()
  const [subTab, setSubTab] = useState(0)

  const [status, setStatus] = useState<SFlowStatus | null>(null)
  const [topTalkers, setTopTalkers] = useState<TopTalker[]>([])
  const [topPairs, setTopPairs] = useState<TopPair[]>([])
  const [topSources, setTopSources] = useState<TopEndpoint[]>([])
  const [topDestinations, setTopDestinations] = useState<TopEndpoint[]>([])
  const [topPorts, setTopPorts] = useState<TopPort[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Node sFlow agent status
  const [nodeAgents, setNodeAgents] = useState<Array<{
    node: string; ip: string; connectionId: string; connectionName: string;
    online: boolean; hasOvs: boolean; ovsVersion: string; sflowConfigured: boolean; sflowTarget: string; bridges: string[]
  }>>([])
  const [agentsLoading, setAgentsLoading] = useState(true)
  const [agentsExpanded, setAgentsExpanded] = useState(true)
  const [configuringNodes, setConfiguringNodes] = useState(false)
  const [configDialogOpen, setConfigDialogOpen] = useState(false)
  const [collectorTarget, setCollectorTarget] = useState('')
  const [configSingleNode, setConfigSingleNode] = useState<typeof nodeAgents[0] | null>(null)

  // VM detail modal
  const [selectedVM, setSelectedVM] = useState<TopTalker | null>(null)

  // Port detail modal
  const [selectedPort, setSelectedPort] = useState<TopPort | null>(null)
  const [portPairs, setPortPairs] = useState<Array<{ src_ip: string; dst_ip: string; bytes: number; packets: number; protocol: string; dst_port: number }>>([])
  const [portPairsLoading, setPortPairsLoading] = useState(false)

  // Search filters
  const [talkerSearch, setTalkerSearch] = useState('')
  const [srcSearch, setSrcSearch] = useState('')
  const [dstSearch, setDstSearch] = useState('')

  const primaryColor = theme.palette.primary.main

  // Fetch connection's hosts to get node names for filtering
  const [connectionNodeNames, setConnectionNodeNames] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!connectionId) return
    fetch(`/api/v1/hosts?connId=${connectionId}`)
      .then(r => r.ok ? r.json() : { data: { hosts: [] } })
      .then(json => {
        const hosts = json.data?.hosts || json.data || []
        const names = new Set<string>(hosts.map((h: any) => h.node).filter(Boolean))
        setConnectionNodeNames(names)
      })
      .catch(() => {})
  }, [connectionId])

  // Also derive from agents as fallback
  const connectionNodes = useMemo(() => {
    const agents = nodeAgents.filter(n => n.connectionId === connectionId)
    const names = new Set(agents.map(a => a.node))
    // Merge with hosts data
    for (const n of connectionNodeNames) names.add(n)
    return {
      names,
      ips: new Set(agents.map(a => a.ip)),
    }
  }, [nodeAgents, connectionId, connectionNodeNames])

  // Filter Top Talkers & Pairs by connection nodes (only these have node/vmid info)
  const canFilterByNode = useMemo(() => {
    if (connectionNodes.names.size === 0) return false
    return topTalkers.some(t => !!t.node)
  }, [topTalkers, connectionNodes])

  const filteredTalkers = useMemo(() => {
    if (!canFilterByNode) return topTalkers
    return topTalkers.filter(t => connectionNodes.names.has(t.node))
  }, [topTalkers, connectionNodes, canFilterByNode])

  const filteredPairs = useMemo(() => {
    if (!canFilterByNode) return topPairs
    const vmids = new Set(filteredTalkers.map(t => t.vmid))
    return topPairs.filter(p => vmids.has(p.src_vmid) || vmids.has(p.dst_vmid))
  }, [topPairs, filteredTalkers, canFilterByNode])

  // Handle port bar click
  const handlePortClick = useCallback(async (port: TopPort) => {
    setSelectedPort(port)
    setPortPairs([])
    setPortPairsLoading(true)
    try {
      const data = await fetchSFlow('ip-pairs', { n: '200' })
      const pairs = Array.isArray(data) ? data : []
      const filtered = pairs.filter((p: any) => p.dst_port === port.port && p.protocol === port.protocol)
      filtered.sort((a: any, b: any) => b.bytes - a.bytes)
      setPortPairs(filtered)
    } catch {
      setPortPairs([])
    } finally {
      setPortPairsLoading(false)
    }
  }, [])

  // Load node agent status
  const loadAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/orchestrator/sflow/agents')
      if (res.ok) {
        const json = await res.json()
        setNodeAgents(json.data || [])
      }
    } catch {} finally {
      setAgentsLoading(false)
    }
  }, [])

  useEffect(() => { loadAgents() }, [loadAgents])

  // Refresh OVS port map on mount (resolves ifIndex → VMID)
  const [portMapLoaded, setPortMapLoaded] = useState(false)
  useEffect(() => {
    if (portMapLoaded) return
    fetch('/api/v1/orchestrator/sflow/portmap', { method: 'POST' })
      .then(() => setPortMapLoaded(true))
      .catch(() => {}) // Non-critical
  }, [portMapLoaded])

  // Open configure dialog (all unconfigured nodes)
  const handleOpenConfigDialog = () => {
    setConfigSingleNode(null)
    if (!collectorTarget) {
      setCollectorTarget(`${window.location.hostname}:6343`)
    }
    setConfigDialogOpen(true)
  }

  // Configure sFlow on nodes
  const handleConfigureNodes = async () => {
    if (!collectorTarget) return

    // If configuring a single node, use that; otherwise configure all unconfigured
    const nodesToConfigure = configSingleNode
      ? [configSingleNode]
      : nodeAgents.filter(n => n.connectionId === connectionId && n.hasOvs && !n.sflowConfigured)

    if (nodesToConfigure.length === 0) return

    setConfigDialogOpen(false)
    setConfigSingleNode(null)
    setConfiguringNodes(true)
    try {
      const res = await fetch('/api/v1/orchestrator/sflow/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodes: nodesToConfigure.map(n => ({ node: n.node, ip: n.ip, connectionId: n.connectionId })),
          collectorTarget,
        }),
      })
      if (res.ok) {
        // Refresh agent list
        await loadAgents()
      }
    } catch {} finally {
      setConfiguringNodes(false)
    }
  }

  const loadData = useCallback(async () => {
    try {
      setError(null)
      const [statusData, talkersData, pairsData, portsData, srcData, dstData] = await Promise.all([
        fetchSFlow('status'),
        fetchSFlow('top-talkers', { n: '10' }),
        fetchSFlow('top-pairs', { n: '20' }),
        fetchSFlow('top-ports', { n: '10' }),
        fetchSFlow('top-sources', { n: '10' }),
        fetchSFlow('top-destinations', { n: '10' }),
      ])
      setStatus(statusData)
      setTopTalkers(Array.isArray(talkersData) ? talkersData : [])
      setTopPairs(Array.isArray(pairsData) ? pairsData : [])
      setTopPorts(Array.isArray(portsData) ? portsData : [])
      setTopSources(Array.isArray(srcData) ? srcData : [])
      setTopDestinations(Array.isArray(dstData) ? dstData : [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 10000) // Refresh every 10s
    return () => clearInterval(interval)
  }, [loadData])

  // ── Loading state ──
  if (loading && !status) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <CircularProgress size={32} />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          {t('common.loading')}
        </Typography>
      </Box>
    )
  }

  // ── sFlow not enabled ──
  if (status && !status.enabled) {
    return (
      <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, gap: 3 }}>
        <Box sx={{
          width: 80, height: 80, borderRadius: '50%',
          bgcolor: `${primaryColor}14`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <i className="ri-flow-chart" style={{ fontSize: 36, color: primaryColor }} />
        </Box>
        <Box sx={{ textAlign: 'center', maxWidth: 500 }}>
          <Typography variant="h6" fontWeight={700} sx={{ mb: 1 }}>
            {t('networkFlows.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            {t('networkFlows.setupDescription')}
          </Typography>
        </Box>
        <Alert severity="info" sx={{ maxWidth: 500 }}>
          <Typography variant="caption">
            {t('networkFlows.requiresOvs')}
          </Typography>
        </Alert>
      </Box>
    )
  }

  // ── sFlow active — show flow data ──
  const activeAgents = status?.agents?.filter(a => a.active).length || 0
  const totalAgents = status?.agents?.length || 0

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2, height: '100%' }}>

      {error && <Alert severity="warning" sx={{ mb: 1 }}>{error}</Alert>}

      {/* Sub-tabs */}
      <Tabs
        value={subTab}
        onChange={(_, v) => setSubTab(v)}
        sx={{ borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab
          icon={<i className="ri-dashboard-line" style={{ fontSize: 16 }} />}
          iconPosition="start"
          label={t('networkFlows.overview')}
          sx={{ textTransform: 'none', fontSize: 13 }}
        />
        <Tab
          icon={<i className="ri-git-branch-line" style={{ fontSize: 16 }} />}
          iconPosition="start"
          label={t('networkFlows.flowDiagram')}
          sx={{ textTransform: 'none', fontSize: 13 }}
        />
        <Tab
          icon={<i className="ri-line-chart-line" style={{ fontSize: 16 }} />}
          iconPosition="start"
          label={t('networkFlows.timeSeries')}
          sx={{ textTransform: 'none', fontSize: 13 }}
        />
        <Tab
          icon={<i className="ri-shield-cross-line" style={{ fontSize: 16 }} />}
          iconPosition="start"
          label={t('networkFlows.security')}
          sx={{ textTransform: 'none', fontSize: 13 }}
        />
        <Tab
          icon={<i className="ri-server-line" style={{ fontSize: 16 }} />}
          iconPosition="start"
          label={t('networkFlows.infrastructure')}
          sx={{ textTransform: 'none', fontSize: 13 }}
        />
      </Tabs>

      {/* Overview sub-tab */}
      {subTab === 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>

          {/* sFlow Agents Status */}
          {!agentsLoading && nodeAgents.filter(n => n.connectionId === connectionId).length > 0 && (
            <Card variant="outlined" sx={{ borderRadius: 2 }}>
              <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                <Box
                  sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1.5, cursor: 'pointer', userSelect: 'none', '&:hover': { bgcolor: 'action.hover' } }}
                  onClick={() => setAgentsExpanded(prev => !prev)}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <i className="ri-radar-line" style={{ fontSize: 16 }} />
                    <Typography variant="subtitle2" fontWeight={700}>
                      {t('networkFlows.sflowAgents')}
                    </Typography>
                    <Chip
                      label={nodeAgents.filter(n => n.connectionId === connectionId).length}
                      size="small"
                      sx={{ height: 20, fontSize: '0.65rem', fontWeight: 700 }}
                    />
                    <i className={agentsExpanded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} style={{ fontSize: 18, opacity: 0.5 }} />
                  </Box>
                  {nodeAgents.filter(n => n.connectionId === connectionId).some(n => n.hasOvs && !n.sflowConfigured) && (
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={configuringNodes ? <CircularProgress size={16} color="inherit" /> : <i className="ri-settings-3-line" style={{ fontSize: 14 }} />}
                      disabled={configuringNodes}
                      onClick={(e) => { e.stopPropagation(); handleOpenConfigDialog() }}
                    >
                      {t('networkFlows.configureAll')}
                    </Button>
                  )}
                </Box>
                <Collapse in={agentsExpanded}>
                  <TableContainer sx={{ px: 1, pb: 1.5 }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', py: 0.5 }}>Node</TableCell>
                          <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', py: 0.5 }}>IP</TableCell>
                          <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', py: 0.5 }}>OVS</TableCell>
                          <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', py: 0.5 }}>sFlow</TableCell>
                          <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', py: 0.5 }}>Target</TableCell>
                          <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', py: 0.5 }}></TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {nodeAgents.filter(n => n.connectionId === connectionId).map((agent) => (
                          <TableRow key={agent.ip}>
                            <TableCell sx={{ py: 0.75, fontSize: '0.8rem' }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                <i className="ri-server-line" style={{ fontSize: 14, opacity: 0.5 }} />
                                {agent.node}
                              </Box>
                            </TableCell>
                            <TableCell sx={{ py: 0.75, fontSize: '0.8rem', fontFamily: 'monospace' }}>
                              {agent.ip}
                            </TableCell>
                            <TableCell sx={{ py: 0.75 }}>
                              {agent.hasOvs ? (
                                <MuiTooltip title={agent.ovsVersion ? `Open vSwitch ${agent.ovsVersion}` : 'Open vSwitch'}>
                                  <Chip
                                    label={agent.ovsVersion ? `OVS ${agent.ovsVersion}` : 'OVS'}
                                    size="small"
                                    color="success"
                                    variant="outlined"
                                    sx={{ height: 20, fontSize: '0.65rem' }}
                                  />
                                </MuiTooltip>
                              ) : (
                                <Chip label="No OVS" size="small" color="default" variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />
                              )}
                            </TableCell>
                            <TableCell sx={{ py: 0.75 }}>
                              {agent.sflowConfigured ? (
                                <Chip label={t('networkFlows.active')} size="small" color="success" sx={{ height: 20, fontSize: '0.65rem' }} />
                              ) : agent.hasOvs ? (
                                <Chip label={t('networkFlows.notConfigured')} size="small" color="warning" variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />
                              ) : (
                                <Chip label="—" size="small" color="default" variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />
                              )}
                            </TableCell>
                            <TableCell sx={{ py: 0.75, fontSize: '0.75rem', fontFamily: 'monospace', color: 'text.secondary' }}>
                              {agent.sflowTarget || '—'}
                            </TableCell>
                            <TableCell sx={{ py: 0.75 }}>
                              {agent.hasOvs && (
                                <MuiTooltip title={agent.sflowConfigured ? t('networkFlows.reconfigure') : t('networkFlows.configure')}>
                                  <IconButton
                                    size="small"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setConfigSingleNode(agent)
                                      if (!collectorTarget) setCollectorTarget(`${window.location.hostname}:6343`)
                                      setConfigDialogOpen(true)
                                    }}
                                    sx={{ color: agent.sflowConfigured ? 'text.secondary' : 'warning.main' }}
                                  >
                                    <i className={agent.sflowConfigured ? 'ri-refresh-line' : 'ri-play-circle-line'} style={{ fontSize: 16 }} />
                                  </IconButton>
                                </MuiTooltip>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Collapse>
              </CardContent>
            </Card>
          )}

          {/* KPI Cards */}
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 2 }}>
            <Card variant="outlined" sx={{ borderRadius: 2 }}>
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 }, textAlign: 'center' }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>{t('networkFlows.flowRate')}</Typography>
                <Typography variant="h5" fontWeight={800} color="primary">
                  {status?.flow_rate ? status.flow_rate.toFixed(1) : '0'}
                </Typography>
                <Typography variant="caption" color="text.secondary">{t('networkFlows.flowsPerSecond')}</Typography>
              </CardContent>
            </Card>
            <Card variant="outlined" sx={{ borderRadius: 2 }}>
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 }, textAlign: 'center' }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>{t('networkFlows.activeVms')}</Typography>
                <Typography variant="h5" fontWeight={800} color="primary">
                  {filteredTalkers.length || status?.active_vms || 0}
                </Typography>
                <Typography variant="caption" color="text.secondary">{t('networkFlows.withTraffic')}</Typography>
              </CardContent>
            </Card>
            <Card variant="outlined" sx={{ borderRadius: 2 }}>
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 }, textAlign: 'center' }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>{t('networkFlows.totalBandwidth')}</Typography>
                <Typography variant="h5" fontWeight={800} color="primary">
                  {filteredTalkers.length > 0 ? formatBytes(filteredTalkers.reduce((sum, t) => sum + t.bytes_in + t.bytes_out, 0)) : '0 B'}
                </Typography>
                <Typography variant="caption" color="text.secondary">{t('networkFlows.currentWindow')}</Typography>
              </CardContent>
            </Card>
            <Card variant="outlined" sx={{ borderRadius: 2 }}>
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 }, textAlign: 'center' }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>{t('networkFlows.agents')}</Typography>
                <Typography variant="h5" fontWeight={800} color={activeAgents > 0 ? 'success.main' : 'text.secondary'}>
                  {activeAgents}/{totalAgents}
                </Typography>
                <Typography variant="caption" color="text.secondary">{t('networkFlows.sflowAgents')}</Typography>
              </CardContent>
            </Card>
          </Box>

          {/* Top Talkers + Top Sources/Destinations */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>

            {/* Top Talkers */}
            <Card variant="outlined" sx={{ borderRadius: 2 }}>
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="subtitle2" fontWeight={700}>
                    <i className="ri-bar-chart-horizontal-line" style={{ fontSize: 16, marginRight: 6 }} />
                    {t('networkFlows.topTalkers')}
                  </Typography>
                  <Chip label={`${status?.total_flows || 0} flows`} size="small" variant="outlined" sx={{ height: 22, fontSize: '0.7rem' }} />
                </Box>
                <TextField
                  size="small"
                  placeholder={t('common.search')}
                  value={talkerSearch}
                  onChange={(e) => setTalkerSearch(e.target.value)}
                  sx={{ mb: 1 }}
                  fullWidth
                  InputProps={{
                    startAdornment: <InputAdornment position="start"><i className="ri-search-line" style={{ fontSize: 14, opacity: 0.5 }} /></InputAdornment>,
                    sx: { fontSize: '0.8rem', height: 32 }
                  }}
                />
                {filteredTalkers.length === 0 ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, py: 4, opacity: 0.5 }}>
                    <CircularProgress size={16} />
                    <Typography variant="body2">{t('networkFlows.waitingForData')}</Typography>
                  </Box>
                ) : (
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', py: 0.5 }}>VM</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600, fontSize: '0.75rem', py: 0.5 }}>In</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600, fontSize: '0.75rem', py: 0.5 }}>Out</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {filteredTalkers.filter(t => !talkerSearch || (t.vm_name || `VM ${t.vmid}`).toLowerCase().includes(talkerSearch.toLowerCase()) || String(t.vmid).includes(talkerSearch)).map((talker) => (
                          <TableRow key={talker.vmid} hover sx={{ cursor: 'pointer' }} onClick={() => setSelectedVM(talker)}>
                            <TableCell sx={{ py: 0.75, fontSize: '0.8rem' }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                <i className="ri-computer-line" style={{ fontSize: 14, opacity: 0.5 }} />
                                <Typography variant="body2" fontWeight={500} sx={{ fontSize: '0.8rem' }}>
                                  {talker.vm_name || `VM ${talker.vmid}`}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  ({talker.vmid})
                                </Typography>
                              </Box>
                            </TableCell>
                            <TableCell align="right" sx={{ py: 0.75, fontSize: '0.8rem', fontFamily: 'monospace', color: 'success.main' }}>
                              {formatBytes(talker.bytes_in)}
                            </TableCell>
                            <TableCell align="right" sx={{ py: 0.75, fontSize: '0.8rem', fontFamily: 'monospace', color: 'warning.main' }}>
                              {formatBytes(talker.bytes_out)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </CardContent>
            </Card>

            {/* Top Sources + Top Destinations stacked */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {/* Top Sources */}
              <Card variant="outlined" sx={{ borderRadius: 2 }}>
                <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                    <i className="ri-upload-2-line" style={{ fontSize: 16, marginRight: 6, color: theme.palette.warning.main }} />
                    {t('networkFlows.topSources')}
                  </Typography>
                  <TextField
                    size="small"
                    placeholder={t('common.search')}
                    value={srcSearch}
                    onChange={(e) => setSrcSearch(e.target.value)}
                    sx={{ mb: 1 }}
                    fullWidth
                    InputProps={{
                      startAdornment: <InputAdornment position="start"><i className="ri-search-line" style={{ fontSize: 14, opacity: 0.5 }} /></InputAdornment>,
                      sx: { fontSize: '0.8rem', height: 32 }
                    }}
                  />
                  {topSources.length === 0 ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, py: 3, opacity: 0.5 }}>
                      <CircularProgress size={16} />
                      <Typography variant="body2">{t('networkFlows.waitingForData')}</Typography>
                    </Box>
                  ) : (
                    <TableContainer>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', py: 0.5 }}>IP</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 600, fontSize: '0.75rem', py: 0.5 }}>Bytes</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 600, fontSize: '0.75rem', py: 0.5 }}>Flows</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {topSources.filter(s => !srcSearch || s.ip.includes(srcSearch)).map((src) => (
                            <TableRow key={src.ip} hover>
                              <TableCell sx={{ py: 0.5, fontFamily: 'monospace', fontSize: '0.8rem' }}>{src.ip}</TableCell>
                              <TableCell align="right" sx={{ py: 0.5, fontFamily: 'monospace', fontSize: '0.8rem' }}>{formatBytes(src.bytes)}</TableCell>
                              <TableCell align="right" sx={{ py: 0.5, fontSize: '0.8rem', color: 'text.secondary' }}>{src.flow_count}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}
                </CardContent>
              </Card>

              {/* Top Destinations */}
              <Card variant="outlined" sx={{ borderRadius: 2 }}>
                <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                    <i className="ri-download-2-line" style={{ fontSize: 16, marginRight: 6, color: theme.palette.success.main }} />
                    {t('networkFlows.topDestinations')}
                  </Typography>
                  <TextField
                    size="small"
                    placeholder={t('common.search')}
                    value={dstSearch}
                    onChange={(e) => setDstSearch(e.target.value)}
                    sx={{ mb: 1 }}
                    fullWidth
                    InputProps={{
                      startAdornment: <InputAdornment position="start"><i className="ri-search-line" style={{ fontSize: 14, opacity: 0.5 }} /></InputAdornment>,
                      sx: { fontSize: '0.8rem', height: 32 }
                    }}
                  />
                  {topDestinations.length === 0 ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, py: 3, opacity: 0.5 }}>
                      <CircularProgress size={16} />
                      <Typography variant="body2">{t('networkFlows.waitingForData')}</Typography>
                    </Box>
                  ) : (
                    <TableContainer>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', py: 0.5 }}>IP</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 600, fontSize: '0.75rem', py: 0.5 }}>Bytes</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 600, fontSize: '0.75rem', py: 0.5 }}>Flows</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {topDestinations.filter(d => !dstSearch || d.ip.includes(dstSearch)).map((dst) => (
                            <TableRow key={dst.ip} hover>
                              <TableCell sx={{ py: 0.5, fontFamily: 'monospace', fontSize: '0.8rem' }}>{dst.ip}</TableCell>
                              <TableCell align="right" sx={{ py: 0.5, fontFamily: 'monospace', fontSize: '0.8rem' }}>{formatBytes(dst.bytes)}</TableCell>
                              <TableCell align="right" sx={{ py: 0.5, fontSize: '0.8rem', color: 'text.secondary' }}>{dst.flow_count}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}
                </CardContent>
              </Card>
            </Box>
          </Box>

          {/* Top Ports */}
          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                <Typography variant="subtitle2" fontWeight={700}>
                  <i className="ri-router-line" style={{ fontSize: 16, marginRight: 6 }} />
                  {t('networkFlows.topPorts')}
                </Typography>
              </Box>
              {topPorts.length === 0 ? (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4, opacity: 0.4 }}>
                  <Typography variant="body2">{t('networkFlows.waitingForData')}</Typography>
                </Box>
              ) : (
                <Box sx={{ height: Math.max(200, topPorts.length * 32 + 40) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={topPorts.map(p => ({
                        name: `${p.port}/${p.protocol}${p.service ? ` (${p.service})` : ''}`,
                        bytes: p.bytes,
                        percent: p.percent,
                      }))}
                      layout="vertical"
                      margin={{ top: 5, right: 60, left: 10, bottom: 5 }}
                    >
                      <XAxis type="number" tickFormatter={(v) => formatBytes(v)} tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={140} />
                      <RechartsTooltip
                        formatter={(value: number) => [formatBytes(value), 'Traffic']}
                        contentStyle={{
                          fontSize: 12,
                          borderRadius: 8,
                          backgroundColor: theme.palette.background.paper,
                          borderColor: theme.palette.divider,
                          color: theme.palette.text.primary,
                        }}
                      />
                      <Bar dataKey="bytes" radius={[0, 4, 4, 0]} maxBarSize={20} onClick={(_data: any, idx: number) => handlePortClick(topPorts[idx])} style={{ cursor: 'pointer' }}>
                        {topPorts.map((_, idx) => (
                          <Cell key={idx} fill={idx === 0 ? primaryColor : `${primaryColor}${Math.max(30, 90 - idx * 8).toString(16)}`} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </Box>
              )}
            </CardContent>
          </Card>
        </Box>
      )}

      {/* Sankey Flow Diagram sub-tab */}
      {subTab === 1 && (
        <SankeyChart connectionId={connectionId} />
      )}

      {/* Time Series sub-tab */}
      {subTab === 2 && (
        <TimeSeriesChart connectionId={connectionId} />
      )}

      {/* Security sub-tab */}
      {subTab === 3 && (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
          <Box sx={{ textAlign: 'center', opacity: 0.5 }}>
            <i className="ri-shield-cross-line" style={{ fontSize: 48 }} />
            <Typography variant="body2" sx={{ mt: 1 }}>{t('networkFlows.securityComingSoon')}</Typography>
          </Box>
        </Box>
      )}

      {/* Infrastructure sub-tab */}
      {subTab === 4 && (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
          <Box sx={{ textAlign: 'center', opacity: 0.5 }}>
            <i className="ri-server-line" style={{ fontSize: 48 }} />
            <Typography variant="body2" sx={{ mt: 1 }}>{t('networkFlows.infraComingSoon')}</Typography>
          </Box>
        </Box>
      )}

      {/* VM Detail Dialog */}
      <Dialog open={!!selectedVM} onClose={() => setSelectedVM(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className="ri-computer-line" style={{ fontSize: 20 }} />
            {selectedVM?.vm_name || `VM ${selectedVM?.vmid}`}
            <Chip label={`ID ${selectedVM?.vmid}`} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />
          </Box>
          <IconButton size="small" onClick={() => setSelectedVM(null)}>
            <i className="ri-close-line" />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          {selectedVM && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {/* Traffic summary */}
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                <Card variant="outlined" sx={{ borderRadius: 2 }}>
                  <CardContent sx={{ p: 2, '&:last-child': { pb: 2 }, textAlign: 'center' }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600}>
                      <i className="ri-arrow-down-line" style={{ fontSize: 12, color: theme.palette.success.main }} /> Inbound
                    </Typography>
                    <Typography variant="h6" fontWeight={800} color="success.main">
                      {formatBytes(selectedVM.bytes_in)}
                    </Typography>
                  </CardContent>
                </Card>
                <Card variant="outlined" sx={{ borderRadius: 2 }}>
                  <CardContent sx={{ p: 2, '&:last-child': { pb: 2 }, textAlign: 'center' }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600}>
                      <i className="ri-arrow-up-line" style={{ fontSize: 12, color: theme.palette.warning.main }} /> Outbound
                    </Typography>
                    <Typography variant="h6" fontWeight={800} color="warning.main">
                      {formatBytes(selectedVM.bytes_out)}
                    </Typography>
                  </CardContent>
                </Card>
              </Box>

              {/* Related pairs */}
              {filteredPairs.filter(p => p.src_vmid === selectedVM.vmid || p.dst_vmid === selectedVM.vmid).length > 0 && (
                <Box>
                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                    <i className="ri-arrow-left-right-line" style={{ fontSize: 14, marginRight: 6 }} />
                    {t('networkFlows.communications')}
                  </Typography>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', py: 0.5 }}>{t('networkFlows.peer')}</TableCell>
                          <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', py: 0.5 }}>{t('networkFlows.direction')}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600, fontSize: '0.75rem', py: 0.5 }}>Bytes</TableCell>
                          <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', py: 0.5 }}>Proto</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {topPairs
                          .filter(p => p.src_vmid === selectedVM.vmid || p.dst_vmid === selectedVM.vmid)
                          .map((pair, idx) => {
                            const isSource = pair.src_vmid === selectedVM.vmid
                            const peerName = isSource ? (pair.dst_name || `VM ${pair.dst_vmid}`) : (pair.src_name || `VM ${pair.src_vmid}`)
                            return (
                              <TableRow key={idx}>
                                <TableCell sx={{ py: 0.75, fontSize: '0.8rem' }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <i className="ri-computer-line" style={{ fontSize: 12, opacity: 0.5 }} />
                                    {peerName}
                                  </Box>
                                </TableCell>
                                <TableCell sx={{ py: 0.75 }}>
                                  <Chip
                                    label={isSource ? '→ OUT' : '← IN'}
                                    size="small"
                                    color={isSource ? 'warning' : 'success'}
                                    variant="outlined"
                                    sx={{ height: 20, fontSize: '0.65rem' }}
                                  />
                                </TableCell>
                                <TableCell align="right" sx={{ py: 0.75, fontSize: '0.8rem', fontFamily: 'monospace' }}>
                                  {formatBytes(pair.bytes)}
                                </TableCell>
                                <TableCell sx={{ py: 0.75 }}>
                                  <Chip
                                    label={`${pair.protocol}/${pair.dst_port}`}
                                    size="small"
                                    variant="outlined"
                                    sx={{ height: 20, fontSize: '0.65rem' }}
                                  />
                                </TableCell>
                              </TableRow>
                            )
                          })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Box>
              )}

              {/* Info note */}
              <Alert severity="info" icon={<i className="ri-information-line" />}>
                <Typography variant="caption">
                  {t('networkFlows.vmDetailNote')}
                </Typography>
              </Alert>
            </Box>
          )}
        </DialogContent>
      </Dialog>

      {/* Port Detail Dialog */}
      <Dialog open={!!selectedPort} onClose={() => setSelectedPort(null)} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: 2 } }}>
        {selectedPort && (
          <>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <i className="ri-router-line" style={{ fontSize: 20, color: primaryColor }} />
                <Typography variant="h6" fontSize={16} fontWeight={700}>
                  {selectedPort.service || `${selectedPort.port}/${selectedPort.protocol}`}
                </Typography>
                <Chip
                  label={`${selectedPort.port}/${selectedPort.protocol.toUpperCase()}`}
                  size="small"
                  variant="outlined"
                  sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}
                />
              </Box>
              <IconButton size="small" onClick={() => setSelectedPort(null)}>
                <i className="ri-close-line" />
              </IconButton>
            </DialogTitle>
            <DialogContent>
              {/* KPI summary */}
              <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                <Box sx={{ flex: 1, p: 1.5, borderRadius: 1.5, bgcolor: theme.palette.action.hover }}>
                  <Typography variant="caption" color="text.secondary">{t('networkFlows.totalTraffic')}</Typography>
                  <Typography variant="h6" fontWeight={700} fontSize={16}>{formatBytes(selectedPort.bytes)}</Typography>
                </Box>
                <Box sx={{ flex: 1, p: 1.5, borderRadius: 1.5, bgcolor: theme.palette.action.hover }}>
                  <Typography variant="caption" color="text.secondary">{t('networkFlows.packets')}</Typography>
                  <Typography variant="h6" fontWeight={700} fontSize={16}>{selectedPort.packets.toLocaleString()}</Typography>
                </Box>
                <Box sx={{ flex: 1, p: 1.5, borderRadius: 1.5, bgcolor: theme.palette.action.hover }}>
                  <Typography variant="caption" color="text.secondary">{t('networkFlows.shareOfTotal')}</Typography>
                  <Typography variant="h6" fontWeight={700} fontSize={16}>{selectedPort.percent.toFixed(1)}%</Typography>
                </Box>
              </Box>

              {/* IP pairs using this port */}
              <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
                <i className="ri-arrow-left-right-line" style={{ fontSize: 14, marginRight: 6 }} />
                {t('networkFlows.communications')}
              </Typography>
              {portPairsLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                  <CircularProgress size={24} />
                </Box>
              ) : portPairs.length === 0 ? (
                <Box sx={{ textAlign: 'center', py: 3, opacity: 0.5 }}>
                  <Typography variant="body2">{t('networkFlows.waitingForData')}</Typography>
                </Box>
              ) : (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>{t('networkFlows.source')}</TableCell>
                        <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>{t('networkFlows.destination')}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600, fontSize: 12 }}>{t('networkFlows.volume')}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600, fontSize: 12 }}>%</TableCell>
                        <TableCell sx={{ fontWeight: 600, fontSize: 12, width: 100 }}></TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {portPairs.slice(0, 20).map((pair, i) => {
                        const pct = selectedPort.bytes > 0 ? (pair.bytes / selectedPort.bytes) * 100 : 0
                        return (
                          <TableRow key={i} hover>
                            <TableCell>
                              <Typography variant="body2" fontFamily="JetBrains Mono, monospace" fontSize={12}>
                                {pair.src_ip}
                              </Typography>
                            </TableCell>
                            <TableCell>
                              <Typography variant="body2" fontFamily="JetBrains Mono, monospace" fontSize={12}>
                                {pair.dst_ip}
                              </Typography>
                            </TableCell>
                            <TableCell align="right">
                              <Typography variant="body2" fontWeight={600} fontSize={12}>
                                {formatBytes(pair.bytes)}
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
                                value={Math.min(100, pct)}
                                sx={{
                                  height: 6,
                                  borderRadius: 3,
                                  bgcolor: theme.palette.action.hover,
                                  '& .MuiLinearProgress-bar': { borderRadius: 3 },
                                }}
                              />
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </DialogContent>
          </>
        )}
      </Dialog>

      {/* Configure sFlow Dialog */}
      <Dialog open={configDialogOpen} onClose={() => setConfigDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-settings-3-line" style={{ fontSize: 20 }} />
          {t('networkFlows.configureSflowTitle')}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('networkFlows.configureSflowDesc')}
          </Typography>
          <TextField
            fullWidth
            size="small"
            label={t('networkFlows.collectorTarget')}
            value={collectorTarget}
            onChange={(e) => setCollectorTarget(e.target.value)}
            placeholder="10.0.0.1:6343"
            helperText={t('networkFlows.collectorTargetHelp')}
            InputProps={{ sx: { fontFamily: 'monospace' } }}
          />
          <Box sx={{ mt: 2 }}>
            <Typography variant="caption" fontWeight={600} sx={{ mb: 0.5, display: 'block' }}>
              {t('networkFlows.nodesToConfigure')}
            </Typography>
            {configSingleNode ? (
              <Chip
                label={`${configSingleNode.node} (${configSingleNode.ip})`}
                size="small"
                color="primary"
                variant="outlined"
                sx={{ height: 24, fontSize: '0.75rem' }}
              />
            ) : (
              nodeAgents.filter(n => n.connectionId === connectionId && n.hasOvs && !n.sflowConfigured).map(n => (
                <Chip
                  key={n.ip}
                  label={`${n.node} (${n.ip})`}
                  size="small"
                  variant="outlined"
                  sx={{ mr: 0.5, mb: 0.5, height: 24, fontSize: '0.75rem' }}
                />
              ))
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfigDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            disabled={!collectorTarget || configuringNodes}
            startIcon={configuringNodes ? <CircularProgress size={16} color="inherit" /> : <i className="ri-play-circle-line" />}
            onClick={handleConfigureNodes}
          >
            {t('networkFlows.configureAll')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
