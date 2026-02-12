'use client'

import { useCallback, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert, Box, Button, Card, CardContent, Chip, Divider, Drawer, IconButton,
  InputAdornment, LinearProgress, MenuItem, Select, Stack, TextField, Tooltip, Typography,
  alpha, useTheme
} from '@mui/material'

import type { ReplicationJob, ReplicationJobStatus, ReplicationJobLog } from '@/lib/orchestrator/site-recovery.types'

// ── Helpers ────────────────────────────────────────────────────────────

function formatBytes(bytes: number | undefined | null): string {
  if (!bytes || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))

  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

function formatDuration(seconds: number | undefined | null): string {
  if (seconds == null || isNaN(seconds)) return '—'
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`

  return `${(seconds / 3600).toFixed(1)}h`
}

function computeRpoActual(lastSync: string | null | undefined): number | null {
  if (!lastSync) return null
  const diff = Math.floor((Date.now() - new Date(lastSync).getTime()) / 1000)
  return diff > 0 ? diff : null
}

function jobLabel(job: ReplicationJob, vmNameMap?: Record<number, string>): string {
  const ids = job.vm_ids || []
  if (ids.length === 0) return 'Replication Job'

  const labels = ids.map(id => {
    const name = vmNameMap?.[id] || (job.vm_names || [])[ids.indexOf(id)]
    return name ? `${id} - ${name}` : `VM ${id}`
  })

  if (labels.length <= 3) return labels.join(', ')
  return `${ids.length} VMs (${labels.slice(0, 2).join(', ')}…)`
}

// ── Sub-components ─────────────────────────────────────────────────────

const StatusChip = ({ status, t }: { status: ReplicationJobStatus; t: any }) => {
  const config: Record<ReplicationJobStatus, { label: string; color: 'success' | 'primary' | 'error' | 'default' | 'warning' }> = {
    synced: { label: t('siteRecovery.status.synced'), color: 'success' },
    syncing: { label: t('siteRecovery.status.syncing'), color: 'primary' },
    error: { label: t('siteRecovery.status.error'), color: 'error' },
    paused: { label: t('siteRecovery.status.paused'), color: 'default' },
    pending: { label: t('siteRecovery.status.pending'), color: 'warning' }
  }

  const c = config[status] || config.paused

  return <Chip size='small' label={c.label} color={c.color} variant={status === 'paused' ? 'outlined' : 'filled'} />
}

const DetailRow = ({ icon, label, value, mono }: { icon: string; label: string; value: string; mono?: boolean }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1.25 }}>
    <Box sx={{ width: 32, height: 32, borderRadius: 1, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.secondary', fontSize: '0.9rem' }}>
      <i className={icon} />
    </Box>
    <Box sx={{ flex: 1 }}>
      <Typography variant='caption' sx={{ color: 'text.secondary', display: 'block' }}>{label}</Typography>
      <Typography variant='body2' sx={{ fontWeight: 600, fontFamily: mono ? 'monospace' : 'inherit' }}>{value}</Typography>
    </Box>
  </Box>
)

const JobCard = ({ job, onClick, vmNameMap, t }: { job: ReplicationJob; onClick: () => void; vmNameMap?: Record<number, string>; t: any }) => {
  const theme = useTheme()
  const progress = job.progress_percent || 0
  const isError = job.status === 'error'
  const isSyncing = job.status === 'syncing'
  const rpoActual = computeRpoActual(job.last_sync)
  const rpoOk = rpoActual != null && rpoActual <= job.rpo_target

  const flowGradient = `linear-gradient(90deg, transparent 0%, transparent 30%, ${alpha(theme.palette.primary.main, 0.12)} 50%, transparent 70%, transparent 100%)`

  return (
    <Card
      variant='outlined'
      onClick={onClick}
      sx={{
        borderRadius: 1.5, cursor: 'pointer', transition: 'all 0.2s ease',
        borderColor: isError ? 'error.main' : isSyncing ? 'primary.main' : 'divider',
        position: 'relative', overflow: 'hidden',
        '&:hover': { borderColor: isError ? 'error.light' : 'primary.main', bgcolor: 'action.hover' },
        // Progress fill
        ...(isSyncing ? {
          '&::before': {
            content: '""',
            position: 'absolute',
            top: 0, left: 0,
            height: '100%',
            width: `${progress}%`,
            bgcolor: 'primary.main',
            opacity: 0.07,
            transition: 'width 1.5s ease',
            zIndex: 0,
          },
          // Animated data flow sweep (left → right)
          '&::after': {
            content: '""',
            position: 'absolute',
            top: 0, left: '-100%',
            height: '100%',
            width: '100%',
            background: flowGradient,
            animation: 'dataFlow 2s ease-in-out infinite',
            zIndex: 0,
          },
          '@keyframes dataFlow': {
            '0%': { left: '-100%' },
            '100%': { left: '100%' },
          },
        } : {})
      }}
    >
      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 }, position: 'relative', zIndex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {/* Sync icon */}
          {isSyncing && (
            <Box sx={{
              display: 'flex', alignItems: 'center', color: 'primary.main',
              animation: 'spin 1.5s linear infinite',
              '@keyframes spin': { '0%': { transform: 'rotate(0deg)' }, '100%': { transform: 'rotate(360deg)' } },
              fontSize: '1rem', flexShrink: 0,
            }}>
              <i className='ri-loader-4-line' />
            </Box>
          )}

          {/* VM names */}
          <Typography variant='body2' sx={{
            fontWeight: 600, flex: 1, minWidth: 0,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
          }}>
            {jobLabel(job, vmNameMap)}
          </Typography>

          {/* RPO */}
          <Box sx={{ textAlign: 'center', minWidth: 60, display: { xs: 'none', sm: 'block' } }}>
            <Typography variant='caption' sx={{ color: 'text.secondary', display: 'block', lineHeight: 1.2 }}>RPO</Typography>
            <Typography variant='body2' sx={{ fontWeight: 600, fontSize: '0.75rem', color: rpoOk ? 'success.main' : 'text.secondary' }}>
              {formatDuration(rpoActual)}
            </Typography>
          </Box>

          {/* Last Sync */}
          <Box sx={{ textAlign: 'center', minWidth: 100, display: { xs: 'none', md: 'block' } }}>
            <Typography variant='caption' sx={{ color: 'text.secondary', display: 'block', lineHeight: 1.2 }}>{t('siteRecovery.protection.lastSync')}</Typography>
            <Typography variant='body2' sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>
              {job.last_sync ? new Date(job.last_sync).toLocaleString() : '—'}
            </Typography>
          </Box>

          {/* Syncing throughput + progress */}
          {isSyncing && (
            <Box sx={{ textAlign: 'center', minWidth: 70, display: { xs: 'none', sm: 'block' } }}>
              <Typography variant='caption' sx={{ color: 'primary.main', fontWeight: 700, display: 'block', lineHeight: 1.2 }}>
                {progress > 0 ? `${Math.round(progress)}%` : '…'}
              </Typography>
              <Typography variant='caption' sx={{ color: 'text.secondary', fontWeight: 500 }}>
                {formatBytes(job.throughput_bps)}/s
              </Typography>
            </Box>
          )}

          {/* Status */}
          <StatusChip status={job.status} t={t} />
        </Box>
      </CardContent>

      {/* Bottom progress bar */}
      {isSyncing && (
        <LinearProgress
          variant='determinate'
          value={progress}
          sx={{ height: 3, position: 'absolute', bottom: 0, left: 0, right: 0 }}
        />
      )}
    </Card>
  )
}

// ── Main Component ─────────────────────────────────────────────────────

interface Connection {
  id: string
  name: string
}

interface ProtectionTabProps {
  jobs: ReplicationJob[]
  loading: boolean
  logs: ReplicationJobLog[]
  logsLoading: boolean
  connections: Connection[]
  vmNameMap?: Record<number, string>
  onSyncJob: (id: string) => void
  onPauseJob: (id: string) => void
  onResumeJob: (id: string) => void
  onDeleteJob: (id: string) => void
  selectedJobId: string | null
  onSelectJob: (id: string | null) => void
}

export default function ProtectionTab({
  jobs, loading, logs, logsLoading, connections, vmNameMap,
  onSyncJob, onPauseJob, onResumeJob, onDeleteJob,
  selectedJobId, onSelectJob
}: ProtectionTabProps) {
  const t = useTranslations()
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const connMap = useMemo(() => {
    const m: Record<string, string> = {}
    for (const c of connections || []) m[c.id] = c.name
    return m
  }, [connections])

  const connName = (id: string) => connMap[id] || id

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase()

    return (jobs || []).filter(j => {
      const label = jobLabel(j, vmNameMap)
      const matchQ = !qq || label.toLowerCase().includes(qq) ||
        connName(j.source_cluster).toLowerCase().includes(qq) || connName(j.target_cluster).toLowerCase().includes(qq)

      return matchQ && (statusFilter === 'all' || j.status === statusFilter)
    })
  }, [jobs, q, statusFilter, connName, vmNameMap])

  const grouped = useMemo(() => {
    const map = new Map<string, ReplicationJob[]>()

    for (const job of filtered) {
      const key = `${job.source_cluster}::${job.target_cluster}`

      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(job)
    }

    return map
  }, [filtered])

  const selected = useMemo(() => (jobs || []).find(j => j.id === selectedJobId), [jobs, selectedJobId])

  const openJob = (id: string) => {
    onSelectJob(id)
    setDrawerOpen(true)
  }

  const closeDrawer = () => {
    setDrawerOpen(false)
    onSelectJob(null)
  }

  const copyLogs = useCallback(() => {
    if (!logs || logs.length === 0) return
    const text = logs.map(l => `[${new Date(l.created_at).toLocaleTimeString()}] [${l.level}] ${l.message}`).join('\n')
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [logs])

  if (loading) {
    return (
      <Stack spacing={2}>
        {[1, 2, 3, 4].map(i => (
          <Card key={i} variant='outlined' sx={{ borderRadius: 2, height: 120 }}>
            <CardContent><LinearProgress /></CardContent>
          </Card>
        ))}
      </Stack>
    )
  }

  return (
    <Box>
      {/* Filter Bar */}
      <Card variant='outlined' sx={{ borderRadius: 2, mb: 2 }}>
        <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder={t('siteRecovery.protection.searchPlaceholder')}
              size='small'
              sx={{ flex: 1, minWidth: 200 }}
              InputProps={{ startAdornment: <InputAdornment position='start'><i className='ri-search-line' style={{ opacity: 0.5 }} /></InputAdornment> }}
            />
            <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} size='small' sx={{ minWidth: 140 }}>
              <MenuItem value='all'>{t('siteRecovery.status.all')}</MenuItem>
              <MenuItem value='synced'>{t('siteRecovery.status.synced')}</MenuItem>
              <MenuItem value='syncing'>{t('siteRecovery.status.syncing')}</MenuItem>
              <MenuItem value='paused'>{t('siteRecovery.status.paused')}</MenuItem>
              <MenuItem value='error'>{t('siteRecovery.status.error')}</MenuItem>
            </Select>
            {(q || statusFilter !== 'all') && (
              <Button size='small' onClick={() => { setQ(''); setStatusFilter('all') }} startIcon={<i className='ri-close-line' />}>
                {t('common.reset')}
              </Button>
            )}
          </Box>
        </CardContent>
      </Card>

      {/* Jobs List */}
      {filtered.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 6, px: 3 }}>
          <Box sx={{ fontSize: '2.5rem', mb: 1, opacity: 0.3 }}><i className='ri-shield-line' /></Box>
          <Typography variant='subtitle1' sx={{ fontWeight: 600, mb: 0.5 }}>
            {(jobs || []).length === 0 ? t('siteRecovery.protection.noJobs') : t('siteRecovery.protection.noJobFound')}
          </Typography>
          <Typography variant='body2' sx={{ color: 'text.secondary' }}>
            {(jobs || []).length === 0
              ? t('siteRecovery.protection.noJobsDesc')
              : t('siteRecovery.protection.noJobFoundDesc')}
          </Typography>
        </Box>
      ) : (
        <Stack spacing={0}>
          {Array.from(grouped.entries()).map(([key, groupJobs], groupIndex) => {
            const [sourceId, targetId] = key.split('::')

            return (
              <Box key={key}>
                {/* Group header */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, mt: groupIndex > 0 ? 2.5 : 0 }}>
                  <i className='ri-server-line' style={{ opacity: 0.5 }} />
                  <Typography variant='subtitle2' sx={{ fontWeight: 600 }}>
                    {connName(sourceId)} → {connName(targetId)}
                  </Typography>
                  <Chip size='small' label={`${groupJobs.length} job${groupJobs.length > 1 ? 's' : ''}`} variant='outlined' sx={{ height: 20, fontSize: '0.65rem' }} />
                </Box>
                {/* Group jobs */}
                <Stack spacing={1}>
                  {groupJobs.map(j => (
                    <JobCard key={j.id} job={j} onClick={() => openJob(j.id)} vmNameMap={vmNameMap} t={t} />
                  ))}
                </Stack>
              </Box>
            )
          })}
        </Stack>
      )}

      {/* Detail Drawer */}
      <Drawer anchor='right' open={drawerOpen} onClose={closeDrawer} PaperProps={{ sx: { width: { xs: '100%', sm: 450 } } }}>
        <Box sx={{ p: 2.5, display: 'flex', flexDirection: 'column', height: '100%' }}>
          {!selected ? (
            <Alert severity='info'>{t('siteRecovery.protection.selectJob')}</Alert>
          ) : (
            <>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                <Box>
                  <Typography variant='h6' sx={{ fontWeight: 700, mb: 0.25 }}>{jobLabel(selected, vmNameMap)}</Typography>
                  <Typography variant='caption' sx={{ color: 'text.secondary' }}>
                    {(selected.vm_ids || []).length} VM(s) — {(selected.vm_ids || []).map(id => {
                      const name = vmNameMap?.[id]
                      return name ? `${id} - ${name}` : `${id}`
                    }).join(', ')}
                  </Typography>
                </Box>
                <IconButton onClick={closeDrawer} size='small'><i className='ri-close-line' /></IconButton>
              </Box>

              <StatusChip status={selected.status} t={t} />

              {selected.status === 'error' && selected.error_message && (
                <Alert severity='error' sx={{ mt: 2 }} icon={<i className='ri-error-warning-line' />}>{selected.error_message}</Alert>
              )}

              <Box sx={{ p: 2, borderRadius: 1, bgcolor: 'action.hover', my: 2, textAlign: 'center' }}>
                <Typography variant='caption' sx={{ color: 'text.secondary' }}>{t('siteRecovery.protection.source')}</Typography>
                <Typography variant='body2' sx={{ fontWeight: 600, fontFamily: 'monospace', mb: 1 }}>{connName(selected.source_cluster)}</Typography>
                <Box sx={{ color: 'text.disabled', my: 0.5 }}><i className='ri-arrow-down-line' /></Box>
                <Typography variant='caption' sx={{ color: 'text.secondary' }}>{t('siteRecovery.protection.target')}</Typography>
                <Typography variant='body2' sx={{ fontWeight: 600, fontFamily: 'monospace' }}>{connName(selected.target_cluster)} / {selected.target_pool}</Typography>
              </Box>

              <Box sx={{ flex: 1, overflow: 'auto' }}>
                <DetailRow icon='ri-time-line' label={t('siteRecovery.protection.schedule')} value={selected.schedule} />
                <DetailRow icon='ri-timer-line' label={t('siteRecovery.protection.rpoTarget')} value={formatDuration(selected.rpo_target)} />
                <DetailRow icon='ri-timer-flash-line' label={t('siteRecovery.protection.rpoActual')} value={formatDuration(computeRpoActual(selected.last_sync))} />
                <DetailRow icon='ri-speed-line' label={t('siteRecovery.protection.throughput')} value={selected.throughput_bps > 0 ? `${formatBytes(selected.throughput_bps)}/s` : '—'} />
                <DetailRow icon='ri-calendar-line' label={t('siteRecovery.protection.lastSync')} value={selected.last_sync ? new Date(selected.last_sync).toLocaleString() : '—'} mono />

                {/* Logs */}
                <Divider sx={{ my: 2 }} />
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant='overline' sx={{ color: 'text.secondary', fontWeight: 600 }}>
                    {t('siteRecovery.protection.recentLogs')}
                  </Typography>
                  {logs && logs.length > 0 && (
                    <Tooltip title={copied ? 'Copied!' : 'Copy logs'} arrow>
                      <IconButton size='small' onClick={copyLogs} sx={{ p: 0.5 }}>
                        <i className={copied ? 'ri-check-line' : 'ri-file-copy-line'} style={{ fontSize: 14 }} />
                      </IconButton>
                    </Tooltip>
                  )}
                </Box>
                {logs && logs.length > 0 ? (
                  <Box sx={{ maxHeight: 350, overflow: 'auto', bgcolor: 'background.default', border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                    {logs.slice(0, 50).map((log, i) => (
                      <Typography key={i} variant='caption' sx={{
                        display: 'block', fontFamily: '"JetBrains Mono", monospace', fontSize: '0.65rem', lineHeight: 1.7,
                        color: log.level === 'error' ? 'error.main' : log.level === 'warning' ? 'warning.main' : 'text.secondary'
                      }}>
                        [{new Date(log.created_at).toLocaleTimeString()}] {log.message}
                      </Typography>
                    ))}
                  </Box>
                ) : (
                  <Typography variant='caption' sx={{ color: 'text.disabled', fontStyle: 'italic' }}>
                    No logs available
                  </Typography>
                )}

                <Divider sx={{ my: 2 }} />

                <Typography variant='overline' sx={{ color: 'text.secondary', fontWeight: 600, mb: 1.5, display: 'block' }}>
                  {t('siteRecovery.protection.actions')}
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  <Button variant='contained' size='small' startIcon={<i className='ri-refresh-line' />} onClick={() => onSyncJob(selected.id)}>
                    {t('siteRecovery.protection.syncNow')}
                  </Button>
                  {selected.status === 'paused' ? (
                    <Button variant='outlined' size='small' startIcon={<i className='ri-play-circle-line' />} onClick={() => onResumeJob(selected.id)}>
                      {t('siteRecovery.protection.resume')}
                    </Button>
                  ) : (
                    <Button variant='outlined' size='small' startIcon={<i className='ri-pause-line' />} onClick={() => onPauseJob(selected.id)}>
                      {t('siteRecovery.protection.pause')}
                    </Button>
                  )}
                  <Button variant='outlined' size='small' color='error' startIcon={<i className='ri-delete-bin-line' />} onClick={() => { onDeleteJob(selected.id); closeDrawer() }}>
                    {t('common.delete')}
                  </Button>
                </Box>
              </Box>
            </>
          )}
        </Box>
      </Drawer>
    </Box>
  )
}
