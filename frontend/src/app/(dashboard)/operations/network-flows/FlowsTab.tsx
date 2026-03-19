'use client'

import { useState, useEffect, useCallback } from 'react'
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
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
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
  const [topPorts, setTopPorts] = useState<TopPort[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Node sFlow agent status
  const [nodeAgents, setNodeAgents] = useState<Array<{
    node: string; ip: string; connectionId: string; connectionName: string;
    online: boolean; hasOvs: boolean; sflowConfigured: boolean; sflowTarget: string; bridges: string[]
  }>>([])
  const [agentsLoading, setAgentsLoading] = useState(true)
  const [configuringNodes, setConfiguringNodes] = useState(false)
  const [configDialogOpen, setConfigDialogOpen] = useState(false)
  const [collectorTarget, setCollectorTarget] = useState('')
  const [configSingleNode, setConfigSingleNode] = useState<typeof nodeAgents[0] | null>(null)

  // VM detail modal
  const [selectedVM, setSelectedVM] = useState<TopTalker | null>(null)

  const primaryColor = theme.palette.primary.main

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
      : nodeAgents.filter(n => n.hasOvs && !n.sflowConfigured)

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
      const [statusData, talkersData, pairsData, portsData] = await Promise.all([
        fetchSFlow('status'),
        fetchSFlow('top-talkers', { n: '10' }),
        fetchSFlow('top-pairs', { n: '20' }),
        fetchSFlow('top-ports', { n: '10' }),
      ])
      setStatus(statusData)
      setTopTalkers(Array.isArray(talkersData) ? talkersData : [])
      setTopPairs(Array.isArray(pairsData) ? pairsData : [])
      setTopPorts(Array.isArray(portsData) ? portsData : [])
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
          label={t('networkFlows.dependencyGraph')}
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
          {!agentsLoading && nodeAgents.length > 0 && (
            <Card variant="outlined" sx={{ borderRadius: 2 }}>
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                  <Typography variant="subtitle2" fontWeight={700}>
                    <i className="ri-radar-line" style={{ fontSize: 16, marginRight: 6 }} />
                    {t('networkFlows.sflowAgents')}
                  </Typography>
                  {nodeAgents.some(n => n.hasOvs && !n.sflowConfigured) && (
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={configuringNodes ? <CircularProgress size={16} color="inherit" /> : <i className="ri-settings-3-line" style={{ fontSize: 14 }} />}
                      disabled={configuringNodes}
                      onClick={handleOpenConfigDialog}
                    >
                      {t('networkFlows.configureAll')}
                    </Button>
                  )}
                </Box>
                <TableContainer>
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
                      {nodeAgents.map((agent) => (
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
                              <Chip label="OVS" size="small" color="success" variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />
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
                                  onClick={() => {
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
                  {status?.active_vms || topTalkers.length}
                </Typography>
                <Typography variant="caption" color="text.secondary">{t('networkFlows.withTraffic')}</Typography>
              </CardContent>
            </Card>
            <Card variant="outlined" sx={{ borderRadius: 2 }}>
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 }, textAlign: 'center' }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>{t('networkFlows.totalBandwidth')}</Typography>
                <Typography variant="h5" fontWeight={800} color="primary">
                  {topTalkers.length > 0 ? formatBytes(topTalkers.reduce((sum, t) => sum + t.bytes_in + t.bytes_out, 0)) : '0 B'}
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

          {/* Top Talkers + Top Pairs side by side */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>

            {/* Top Talkers */}
            <Card variant="outlined" sx={{ borderRadius: 2 }}>
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                  <Typography variant="subtitle2" fontWeight={700}>
                    <i className="ri-bar-chart-horizontal-line" style={{ fontSize: 16, marginRight: 6 }} />
                    {t('networkFlows.topTalkers')}
                  </Typography>
                  <Chip label={`${status?.total_flows || 0} flows`} size="small" variant="outlined" sx={{ height: 22, fontSize: '0.7rem' }} />
                </Box>
                {topTalkers.length === 0 ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4, opacity: 0.4 }}>
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
                        {topTalkers.map((talker) => (
                          <TableRow key={talker.vmid} hover sx={{ cursor: 'pointer' }} onClick={() => setSelectedVM(talker)}>
                            <TableCell sx={{ py: 0.75, fontSize: '0.8rem' }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                <i className="ri-computer-line" style={{ fontSize: 14, opacity: 0.5 }} />
                                <Box>
                                  <Typography variant="body2" fontWeight={500} sx={{ fontSize: '0.8rem' }}>
                                    {talker.vm_name || `VM ${talker.vmid}`}
                                  </Typography>
                                  <Typography variant="caption" color="text.secondary">
                                    ID {talker.vmid}
                                  </Typography>
                                </Box>
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

            {/* Top Pairs */}
            <Card variant="outlined" sx={{ borderRadius: 2 }}>
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                  <Typography variant="subtitle2" fontWeight={700}>
                    <i className="ri-arrow-left-right-line" style={{ fontSize: 16, marginRight: 6 }} />
                    {t('networkFlows.topPairs')}
                  </Typography>
                </Box>
                {topPairs.length === 0 ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4, opacity: 0.4 }}>
                    <Typography variant="body2">{t('networkFlows.waitingForData')}</Typography>
                  </Box>
                ) : (
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', py: 0.5 }}>Source</TableCell>
                          <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', py: 0.5 }}></TableCell>
                          <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', py: 0.5 }}>Dest</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600, fontSize: '0.75rem', py: 0.5 }}>Bytes</TableCell>
                          <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', py: 0.5 }}>Proto</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {topPairs.slice(0, 10).map((pair, idx) => (
                          <TableRow key={idx} hover>
                            <TableCell sx={{ py: 0.75, fontSize: '0.8rem', cursor: 'pointer', '&:hover': { color: 'primary.main' } }}
                              onClick={() => setSelectedVM({ vmid: pair.src_vmid, vm_name: pair.src_name, node: '', bytes_in: pair.bytes, bytes_out: 0, packets: 0 })}
                            >
                              {pair.src_name || `VM ${pair.src_vmid}`}
                            </TableCell>
                            <TableCell sx={{ py: 0.75, textAlign: 'center' }}>
                              <i className="ri-arrow-right-line" style={{ fontSize: 12, opacity: 0.4 }} />
                            </TableCell>
                            <TableCell sx={{ py: 0.75, fontSize: '0.8rem', cursor: 'pointer', '&:hover': { color: 'primary.main' } }}
                              onClick={() => setSelectedVM({ vmid: pair.dst_vmid, vm_name: pair.dst_name, node: '', bytes_in: 0, bytes_out: pair.bytes, packets: 0 })}
                            >
                              {pair.dst_name || `VM ${pair.dst_vmid}`}
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
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </CardContent>
            </Card>
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
                        contentStyle={{ fontSize: 12, borderRadius: 8 }}
                      />
                      <Bar dataKey="bytes" radius={[0, 4, 4, 0]} maxBarSize={20}>
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

      {/* Dependency Graph sub-tab */}
      {subTab === 1 && (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
          <Box sx={{ textAlign: 'center', opacity: 0.5 }}>
            <i className="ri-git-branch-line" style={{ fontSize: 48 }} />
            <Typography variant="body2" sx={{ mt: 1 }}>{t('networkFlows.graphComingSoon')}</Typography>
          </Box>
        </Box>
      )}

      {/* Time Series sub-tab */}
      {subTab === 2 && (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
          <Box sx={{ textAlign: 'center', opacity: 0.5 }}>
            <i className="ri-line-chart-line" style={{ fontSize: 48 }} />
            <Typography variant="body2" sx={{ mt: 1 }}>{t('networkFlows.timeSeriesComingSoon')}</Typography>
          </Box>
        </Box>
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
              {topPairs.filter(p => p.src_vmid === selectedVM.vmid || p.dst_vmid === selectedVM.vmid).length > 0 && (
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
              nodeAgents.filter(n => n.hasOvs && !n.sflowConfigured).map(n => (
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
