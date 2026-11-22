'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Alert,
  AlertTitle,
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
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material'

import NumericTextField from '@/components/ui/NumericTextField'
import { NodeGlyph } from '@/components/ui/glyphs'
import { useSWRFetch } from '@/hooks/useSWRFetch'
import { formatElapsed, summarizeTelemetry, telemetryChip, telemetryOf, type TelemetryHealth, type TelemetryState } from '@/lib/sflow/telemetryState'
import { SFLOW_MIN_SAMPLING } from '@/lib/ssh/sudo'

/** What the collector answers: whether it listens, and the agents it hears. */
type SFlowStatus = {
  enabled: boolean
  listen_address: string
  agents: Array<{ agent_ip: string; node: string; last_seen: string; flow_rate: number; sample_count: number; active: boolean; datagram_count?: number; counter_count?: number; source_ip?: string }>
}

/** A node as /api/v1/orchestrator/sflow/agents probes it over SSH. */
export type NodeAgent = {
  node: string
  ip: string
  connectionId: string
  connectionName: string
  online: boolean
  hasOvs: boolean
  ovsVersion: string
  sflowConfigured: boolean
  sflowTarget: string
  sflowSampling: number
  bridges: string[]
  portMapError?: string
}

type ConfigResult = { configured: number; total: number; failures: Array<{ node: string; error?: string }> }

/** The collector's state and the telemetry verdicts live in the orchestrator's memory: read again every 30 s while the tab shows. */
const STATUS_REFRESH_MS = 30_000
const STATUS_OPTIONS = { refreshInterval: STATUS_REFRESH_MS, refreshWhenHidden: false, revalidateOnFocus: false, shouldRetryOnError: false }
const AGENTS_OPTIONS = { refreshInterval: 0, revalidateOnFocus: false, shouldRetryOnError: false }

/** All configured, some, or none. */
function outcomeSeverity(r: ConfigResult): 'success' | 'warning' | 'error' {
  if (r.failures.length === 0) return 'success'
  return r.configured > 0 ? 'warning' : 'error'
}

const SUMMARY_STATES: TelemetryState[] = ['receiving', 'awaiting', 'missing', 'identity_unknown', 'host_offline']

/** One line of the configure dialog: the label on the left, its control on the right. */
function DialogLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '200px minmax(0, 1fr)', alignItems: 'center', gap: 2, py: 0.75 }}>
      <Typography variant='body2' color='text.secondary'>{label}</Typography>
      <Box sx={{ minWidth: 0 }}>{children}</Box>
    </Box>
  )
}

/**
 * Settings > sFlow: the sFlow agents of the Proxmox nodes (Open vSwitch, sampling, collector target, telemetry heard by
 * the collector) and their configuration. The node probe runs over SSH (cached 30 s on the server, it also pushes the
 * port map the volume history needs): read when the tab opens, after a configuration and on "Verify reception". The
 * collector state and the verdicts are the orchestrator's memory. No Proxmox API call.
 */
export default function SFlowSettingsTab() {
  const t = useTranslations()
  const theme = useTheme()
  const dark = theme.palette.mode === 'dark'
  const dotBorder = theme.palette.background.paper
  const status = useSWRFetch<SFlowStatus>('/api/v1/orchestrator/sflow?endpoint=status', STATUS_OPTIONS)
  const healthRead = useSWRFetch<TelemetryHealth>('/api/v1/orchestrator/sflow?endpoint=health', STATUS_OPTIONS)
  const health = healthRead.data && Array.isArray(healthRead.data.agents) ? healthRead.data : null

  // The probe of the nodes runs over SSH: read when the tab opens and on demand, never on a timer nor on focus.
  const agentsRead = useSWRFetch<{ data?: NodeAgent[] }>('/api/v1/orchestrator/sflow/agents', AGENTS_OPTIONS)
  const nodeAgents = Array.isArray(agentsRead.data?.data) ? agentsRead.data.data : []
  const agentsLoading = agentsRead.isLoading || agentsRead.isValidating
  const [configResult, setConfigResult] = useState<ConfigResult | null>(null)
  const [configuring, setConfiguring] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [collectorTarget, setCollectorTarget] = useState('')
  const [samplingRate, setSamplingRate] = useState(512)
  const [singleNode, setSingleNode] = useState<NodeAgent | null>(null)

  const openDialog = (node: NodeAgent | null) => {
    setSingleNode(node)
    if (!collectorTarget) setCollectorTarget(`${window.location.hostname}:6343`)
    setDialogOpen(true)
  }

  const configure = async () => {
    if (!collectorTarget) return
    const nodes = singleNode ? [singleNode] : nodeAgents.filter(n => n.hasOvs && !n.sflowConfigured)
    if (nodes.length === 0) {
      setConfigResult({ configured: 0, total: 0, failures: [{ node: '', error: t('networkFlows.noNodeToConfigure') }] })
      return
    }
    setDialogOpen(false)
    setSingleNode(null)
    setConfiguring(true)
    setConfigResult(null)
    try {
      const res = await fetch('/api/v1/orchestrator/sflow/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes: nodes.map(n => ({ node: n.node, ip: n.ip, connectionId: n.connectionId })), collectorTarget, samplingRate }),
      })
      // The answer carries a per-node outcome: a failure on every node is still a 200.
      const payload = await res.json().catch(() => null)
      const results: Array<{ node: string; success: boolean; error?: string }> = payload?.results ?? []
      setConfigResult({
        configured: payload?.configured ?? 0,
        total: payload?.total ?? nodes.length,
        failures: results.filter(r => !r.success).map(r => ({ node: r.node, error: r.error })),
      })
      await agentsRead.mutate()
      await healthRead.mutate()
    } catch (e) {
      setConfigResult({ configured: 0, total: nodes.length, failures: [{ node: '', error: (e as Error)?.message || t('networkFlows.configureRequestFailed') }] })
    } finally {
      setConfiguring(false)
    }
  }

  const verify = () => {
    void agentsRead.mutate()
    void healthRead.mutate()
    void status.mutate()
  }

  const collector = status.data
  const collectorOff = !!collector && !collector.enabled
  const collectorOn = !!collector?.enabled
  const counts = summarizeTelemetry(health?.agents)
  const summary = SUMMARY_STATES.filter(state => (counts[state] ?? 0) > 0)
  // Agents the collector hears that no node row is keyed on (an agent address other than the node's).
  const unmatched = (collector?.agents ?? []).filter(a => a.active && !nodeAgents.some(n => n.ip === a.agent_ip))
  const missing = (health?.agents ?? []).filter(a => a.state === 'missing')
  const unknown = (health?.agents ?? []).filter(a => a.state === 'identity_unknown')
  const connections = Array.from(new Set(nodeAgents.map(a => a.connectionName)))
  const pending = nodeAgents.filter(n => n.hasOvs && !n.sflowConfigured)

  let agentsBody: React.ReactNode
  if (agentsLoading && nodeAgents.length === 0) {
    agentsBody = (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, pb: 2 }}>
        <CircularProgress size={16} />
        <Typography variant='body2' color='text.secondary'>{t('common.loading')}</Typography>
      </Box>
    )
  } else if (nodeAgents.length === 0) {
    agentsBody = <Typography variant='body2' color='text.secondary' sx={{ px: 2, pb: 2 }} data-testid='sflow-no-node'>{t('settings.sflow.noNode')}</Typography>
  } else {
    agentsBody = (
      <TableContainer sx={{ px: 1, pb: 1.5 }}>
        <Table size='small' data-testid='sflow-agents-table'>
          <TableHead>
            <TableRow>
              {['Node', 'IP', 'OVS', t('networkFlows.telemetryColumn'), t('settings.sflow.target'), t('settings.sflow.sampling'), t('settings.sflow.flowRate'), t('settings.sflow.samples'), t('networkFlows.lastReceived'), ''].map((label, i) => (
                <TableCell key={i} align={i === 6 || i === 7 ? 'right' : 'left'} sx={{ fontWeight: 600, fontSize: '0.75rem', py: 0.5 }}>{label}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {connections.map(connName => {
              const rows = nodeAgents.filter(a => a.connectionName === connName)
              return [
                connections.length > 1 && (
                  <TableRow key={`header-${connName}`}>
                    <TableCell colSpan={10} sx={{ py: 0.5, border: 0, bgcolor: 'action.hover' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <i className='ri-server-line' style={{ fontSize: 13, opacity: 0.6 }} aria-hidden />
                        <Typography variant='caption' fontWeight={700} color='text.secondary' sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>{connName}</Typography>
                        <Chip label={t('settings.sflow.nodes', { count: rows.length })} size='small' variant='outlined' sx={{ height: 18, fontSize: '0.6rem' }} />
                      </Box>
                    </TableCell>
                  </TableRow>
                ),
                ...rows.map(agent => {
                  const verdict = telemetryOf(health, agent)
                  const chip = telemetryChip(agent, verdict, collectorOn)
                  const heard = collector?.agents?.find(a => a.agent_ip === agent.ip)
                  const lastSeen = verdict?.last_seen ?? heard?.last_seen
                  const elapsed = formatElapsed(verdict?.seconds_since_seen)
                  const never = agent.sflowConfigured && verdict ? t('networkFlows.neverReceived') : '-'
                  const datagrams = verdict?.datagram_count ?? heard?.datagram_count
                  return (
                    <TableRow key={agent.ip} data-testid={`sflow-agent-${agent.node}`}>
                      <TableCell sx={{ py: 0.75, fontSize: '0.8rem' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <NodeGlyph status={agent.online ? 'online' : 'offline'} dark={dark} dotBorder={dotBorder} />
                          {agent.node}
                        </Box>
                      </TableCell>
                      <TableCell sx={{ py: 0.75, fontSize: '0.8rem' }}>{agent.ip}</TableCell>
                      <TableCell sx={{ py: 0.75 }}>
                        {agent.hasOvs
                          ? <Chip label={agent.ovsVersion ? `OVS ${agent.ovsVersion}` : 'OVS'} size='small' color='success' variant='outlined' sx={{ height: 20, fontSize: '0.65rem' }} />
                          : <Chip label={t('settings.sflow.noOvs')} size='small' variant='outlined' sx={{ height: 20, fontSize: '0.65rem' }} />}
                      </TableCell>
                      <TableCell sx={{ py: 0.75 }}>
                        <Tooltip title={verdict?.detail || (chip.kind === 'configured' && agent.sflowConfigured ? t('networkFlows.telemetryNotEvaluated') : '')}>
                          <Chip data-testid={`telemetry-${agent.node}`} data-state={chip.kind} label={t(`networkFlows.${chip.labelKey}`)} size='small' color={chip.color} variant={chip.variant} sx={{ height: 20, fontSize: '0.65rem' }} />
                        </Tooltip>
                        {agent.portMapError && <Typography variant='caption' display='block' sx={{ color: 'warning.main', fontSize: '0.65rem', mt: 0.25 }}>{agent.portMapError}</Typography>}
                      </TableCell>
                      <TableCell sx={{ py: 0.75, fontSize: '0.75rem', color: 'text.secondary' }}>{agent.sflowTarget || '-'}</TableCell>
                      <TableCell sx={{ py: 0.75, fontSize: '0.75rem', color: 'text.secondary' }}>{agent.sflowSampling ? `1:${agent.sflowSampling}` : '-'}</TableCell>
                      <TableCell align='right' sx={{ py: 0.75, fontSize: '0.75rem', color: 'text.secondary' }}>{heard ? `${heard.flow_rate.toFixed(1)} f/s` : '-'}</TableCell>
                      <TableCell align='right' sx={{ py: 0.75, fontSize: '0.75rem', color: 'text.secondary', whiteSpace: 'nowrap' }}>
                        {heard ? heard.sample_count.toLocaleString() : '-'}
                        {datagrams != null && datagrams > 0 && <Typography component='span' variant='caption' sx={{ ml: 0.75, color: 'text.disabled' }}>{t('networkFlows.datagramCount', { count: datagrams })}</Typography>}
                      </TableCell>
                      <TableCell sx={{ py: 0.75, fontSize: '0.75rem', color: 'text.secondary', whiteSpace: 'nowrap' }} data-testid={`last-received-${agent.node}`}>
                        {lastSeen ? new Date(lastSeen).toLocaleTimeString() : never}
                        {elapsed && <Typography component='span' variant='caption' sx={{ ml: 0.75, color: verdict?.state === 'missing' ? 'error.main' : 'text.disabled' }}>{t('networkFlows.elapsedAgo', { elapsed })}</Typography>}
                      </TableCell>
                      <TableCell sx={{ py: 0.75 }}>
                        {agent.hasOvs && (
                          <Tooltip title={agent.sflowConfigured ? t('networkFlows.reconfigure') : t('networkFlows.configure')}>
                            <IconButton size='small' aria-label={agent.sflowConfigured ? t('networkFlows.reconfigure') : t('networkFlows.configure')} onClick={() => openDialog(agent)} sx={{ color: agent.sflowConfigured ? 'text.secondary' : 'warning.main' }}>
                              <i className={agent.sflowConfigured ? 'ri-refresh-line' : 'ri-play-circle-line'} style={{ fontSize: 16 }} />
                            </IconButton>
                          </Tooltip>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                }),
              ]
            })}
          </TableBody>
        </Table>
      </TableContainer>
    )
  }

  return (
    <Box data-testid='sflow-settings' sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Typography variant='body2' color='text.secondary'>{t('settings.sflow.description')}</Typography>

      {collectorOff && (
        <Alert severity='warning' data-testid='sflow-collector-off'>
          <AlertTitle sx={{ fontWeight: 700 }}>{t('networkFlows.collectorOffTitle')}</AlertTitle>
          <Typography variant='body2'>{t('networkFlows.collectorOffDesc')}</Typography>
          <Typography variant='caption' color='text.secondary'>{t('networkFlows.collectorOffHint')}</Typography>
        </Alert>
      )}

      <Card variant='outlined' sx={{ borderRadius: 2 }}>
        <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, px: 2, py: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <i className='ri-radar-line' style={{ fontSize: 16 }} aria-hidden />
              <Typography variant='subtitle2' fontWeight={700}>{t('networkFlows.sflowAgents')}</Typography>
              <Chip label={nodeAgents.length} size='small' sx={{ height: 20, fontSize: '0.65rem', fontWeight: 700 }} />
              {collectorOn && summary.map(state => {
                const chip = telemetryChip({ hasOvs: true, sflowConfigured: true }, { state } as Parameters<typeof telemetryChip>[1], true)
                return (
                  <Chip
                    key={state}
                    data-testid={`telemetry-summary-${state}`}
                    label={`${counts[state]} ${t(`networkFlows.${chip.labelKey}`).toLowerCase()}`}
                    size='small'
                    color={chip.color}
                    variant={chip.variant}
                    sx={{ height: 20, fontSize: '0.65rem' }}
                  />
                )
              })}
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {collectorOn && nodeAgents.some(n => n.hasOvs && n.sflowConfigured) && (
                <Tooltip title={t('networkFlows.verifyReceptionHelp')}>
                  <Button size='small' variant='outlined' startIcon={<i className='ri-refresh-line' style={{ fontSize: 14 }} />} onClick={verify}>
                    {t('networkFlows.verifyReception')}
                  </Button>
                </Tooltip>
              )}
              {pending.length > 0 && (
                <Button
                  size='small'
                  variant='contained'
                  startIcon={configuring ? <CircularProgress size={16} color='inherit' /> : <i className='ri-settings-3-line' style={{ fontSize: 14 }} />}
                  disabled={configuring}
                  onClick={() => openDialog(null)}
                >
                  {t('networkFlows.configureAll')}
                </Button>
              )}
            </Box>
          </Box>

          {configResult && (
            <Alert
              severity={outcomeSeverity(configResult)}
              onClose={() => setConfigResult(null)}
              sx={{ mx: 1, mb: 1 }}
            >
              <AlertTitle sx={{ fontSize: '0.85rem' }}>{t('networkFlows.configureOutcome', { configured: configResult.configured, total: configResult.total })}</AlertTitle>
              {configResult.configured > 0 && <Typography variant='body2'>{t('networkFlows.configureAppliedAwaiting')}</Typography>}
              {configResult.failures.map((f, i) => (
                <Typography key={`${f.node}-${i}`} variant='body2'>{f.node ? `${f.node}: ${f.error}` : f.error}</Typography>
              ))}
            </Alert>
          )}
          {collectorOn && (missing.length > 0 || unknown.length > 0) && (
            <Alert severity={missing.length > 0 ? 'error' : 'warning'} sx={{ mx: 1, mb: 1 }} data-testid='telemetry-missing-alert'>
              {missing.length > 0 && <AlertTitle sx={{ fontSize: '0.85rem' }}>{t('networkFlows.telemetryMissingTitle', { count: missing.length })}</AlertTitle>}
              {[...missing, ...unknown].map(a => (
                <Typography key={`${a.connection_id}-${a.node}`} variant='body2' sx={{ mb: 0.5 }}>
                  <strong>{a.node}</strong> ({a.agent_ip}): {a.detail}
                </Typography>
              ))}
              {missing.length > 0 && !health?.alerts_enabled && <Typography variant='caption' color='text.secondary'>{t('networkFlows.telemetryAlertsOff')}</Typography>}
            </Alert>
          )}
          {unmatched.length > 0 && (
            <Alert severity='info' sx={{ mx: 1, mb: 1 }}>
              <AlertTitle sx={{ fontSize: '0.85rem' }}>{t('networkFlows.unmatchedAgentsTitle')}</AlertTitle>
              <Typography variant='body2'>{t('networkFlows.unmatchedAgentsDesc', { agents: unmatched.map(a => a.agent_ip).join(', ') })}</Typography>
            </Alert>
          )}

          {agentsBody}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth='sm' fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className='ri-settings-3-line' style={{ fontSize: 20 }} aria-hidden />
          {t('networkFlows.configureSflowTitle')}
        </DialogTitle>
        <DialogContent>
          <Typography variant='body2' color='text.secondary' sx={{ mb: 1 }}>{t('networkFlows.configureSflowDesc')}</Typography>
          <DialogLine label={t('networkFlows.collectorTarget')}>
            <Tooltip title={t('networkFlows.collectorTargetHelp')} placement='top'>
              <TextField fullWidth size='small' value={collectorTarget} onChange={e => setCollectorTarget(e.target.value)} placeholder='10.0.0.1:6343' slotProps={{ htmlInput: { 'aria-label': t('networkFlows.collectorTarget') } }} />
            </Tooltip>
          </DialogLine>
          <DialogLine label={t('settings.sflow.samplingRate')}>
            <NumericTextField fullWidth size='small' type='number' value={samplingRate} onChange={setSamplingRate} fallback={512} min={SFLOW_MIN_SAMPLING} slotProps={{ htmlInput: { 'aria-label': t('settings.sflow.samplingRate') } }} />
          </DialogLine>
          <DialogLine label={t('settings.sflow.samplingLoad')}>
            <Typography variant='body2'>
              {samplingRate <= 128 && t('networkFlows.samplingVeryHigh')}
              {samplingRate > 128 && samplingRate <= 256 && t('networkFlows.samplingHigh')}
              {samplingRate > 256 && samplingRate <= 512 && t('networkFlows.samplingBalanced')}
              {samplingRate > 512 && samplingRate <= 1024 && t('networkFlows.samplingLight')}
              {samplingRate > 1024 && t('networkFlows.samplingVeryLight')}
            </Typography>
          </DialogLine>
          <DialogLine label={t('networkFlows.nodesToConfigure')}>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              {(singleNode ? [singleNode] : pending).map(n => (
                <Chip key={n.ip} label={`${n.node} (${n.ip})`} size='small' variant='outlined' sx={{ height: 24, fontSize: '0.75rem' }} />
              ))}
            </Box>
          </DialogLine>
          <Alert severity='info' icon={<i className='ri-shield-check-line' />} sx={{ mt: 1.5 }}>{t('networkFlows.collectorFirewallHint')}</Alert>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button
            variant='contained'
            disabled={!collectorTarget || configuring}
            startIcon={configuring ? <CircularProgress size={16} color='inherit' /> : <i className='ri-play-circle-line' />}
            onClick={() => { void configure() }}
          >
            {t('networkFlows.configureAll')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
