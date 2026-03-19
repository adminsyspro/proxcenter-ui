'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  LinearProgress,
  Tab,
  Tabs,
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

  const primaryColor = theme.palette.primary.main

  // Refresh OVS port map on mount (resolves ifIndex → VMID)
  const [portMapLoaded, setPortMapLoaded] = useState(false)
  useEffect(() => {
    if (portMapLoaded) return
    fetch('/api/v1/orchestrator/sflow/portmap', { method: 'POST' })
      .then(() => setPortMapLoaded(true))
      .catch(() => {}) // Non-critical
  }, [portMapLoaded])

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
                          <TableRow key={talker.vmid} hover sx={{ cursor: 'pointer' }}>
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
                            <TableCell sx={{ py: 0.75, fontSize: '0.8rem' }}>
                              {pair.src_name || `VM ${pair.src_vmid}`}
                            </TableCell>
                            <TableCell sx={{ py: 0.75, textAlign: 'center' }}>
                              <i className="ri-arrow-right-line" style={{ fontSize: 12, opacity: 0.4 }} />
                            </TableCell>
                            <TableCell sx={{ py: 0.75, fontSize: '0.8rem' }}>
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
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {topPorts.map((port) => (
                    <Box key={`${port.protocol}-${port.port}`} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Typography variant="body2" sx={{ minWidth: 140, fontSize: '0.8rem' }}>
                        {port.port}/{port.protocol}
                        {port.service && (
                          <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                            ({port.service})
                          </Typography>
                        )}
                      </Typography>
                      <Box sx={{ flex: 1 }}>
                        <LinearProgress
                          variant="determinate"
                          value={port.percent}
                          sx={{
                            height: 8,
                            borderRadius: 1,
                            bgcolor: 'action.hover',
                            '& .MuiLinearProgress-bar': {
                              borderRadius: 1,
                              bgcolor: primaryColor,
                            }
                          }}
                        />
                      </Box>
                      <Typography variant="caption" sx={{ minWidth: 40, textAlign: 'right', fontFamily: 'monospace' }}>
                        {port.percent.toFixed(0)}%
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 70, textAlign: 'right', fontFamily: 'monospace' }}>
                        {formatBytes(port.bytes)}
                      </Typography>
                    </Box>
                  ))}
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
    </Box>
  )
}
