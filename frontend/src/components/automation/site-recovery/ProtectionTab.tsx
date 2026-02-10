'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert, Box, Button, Card, CardContent, Chip, Divider, Drawer, IconButton,
  InputAdornment, LinearProgress, MenuItem, Select, Stack, TextField, Typography
} from '@mui/material'

import type { ReplicationJob, ReplicationJobStatus, ReplicationJobLog } from '@/lib/orchestrator/site-recovery.types'

// ── Helpers ────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))

  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`

  return `${(seconds / 3600).toFixed(1)}h`
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

const JobCard = ({ job, onClick, t }: { job: ReplicationJob; onClick: () => void; t: any }) => {
  const progress = job.progress_percent || 0
  const isError = job.status === 'error'
  const isSyncing = job.status === 'syncing'

  return (
    <Card
      variant='outlined'
      onClick={onClick}
      sx={{
        borderRadius: 2, cursor: 'pointer', transition: 'all 0.2s ease',
        borderColor: isError ? 'error.main' : 'divider',
        '&:hover': { borderColor: isError ? 'error.light' : 'primary.main', bgcolor: 'action.hover' }
      }}
    >
      {isSyncing && <LinearProgress variant='determinate' value={progress} sx={{ height: 2 }} />}

      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        {/* Header */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
          <Box>
            <Typography variant='subtitle2' sx={{ fontWeight: 700, mb: 0.25 }}>{job.vm_name}</Typography>
            <Typography variant='caption' sx={{ color: 'text.secondary' }}>
              {job.source_cluster} → {job.target_cluster}
            </Typography>
          </Box>
          <StatusChip status={job.status} t={t} />
        </Box>

        {/* Metrics */}
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <Box>
            <Typography variant='caption' sx={{ color: 'text.secondary' }}>RPO</Typography>
            <Typography variant='body2' sx={{
              fontWeight: 600,
              color: job.rpo_actual <= job.rpo_target ? 'success.main' : 'warning.main'
            }}>
              {formatDuration(job.rpo_actual)}
            </Typography>
          </Box>
          <Box>
            <Typography variant='caption' sx={{ color: 'text.secondary' }}>{t('siteRecovery.protection.volume')}</Typography>
            <Typography variant='body2' sx={{ fontWeight: 600 }}>{formatBytes(job.volume_bytes)}</Typography>
          </Box>
          <Box sx={{ ml: 'auto', textAlign: 'right' }}>
            <Typography variant='caption' sx={{ color: 'text.secondary' }}>{t('siteRecovery.protection.lastSync')}</Typography>
            <Typography variant='body2' sx={{ fontWeight: 500, fontFamily: 'monospace', fontSize: '0.75rem' }}>
              {job.last_sync ? new Date(job.last_sync).toLocaleString() : '—'}
            </Typography>
          </Box>
        </Box>

        {/* Syncing details */}
        {isSyncing && (
          <Box sx={{ mt: 1.5, pt: 1.5, borderTop: '1px dashed', borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant='caption' sx={{ color: 'text.secondary' }}>
              {Math.round(progress)}%
            </Typography>
            <Typography variant='caption' sx={{ color: 'primary.main', fontWeight: 600 }}>
              {formatBytes(job.throughput_bps)}/s
            </Typography>
          </Box>
        )}
      </CardContent>
    </Card>
  )
}

// ── Main Component ─────────────────────────────────────────────────────

interface ProtectionTabProps {
  jobs: ReplicationJob[]
  loading: boolean
  logs: ReplicationJobLog[]
  logsLoading: boolean
  onSyncJob: (id: string) => void
  onPauseJob: (id: string) => void
  onResumeJob: (id: string) => void
  onDeleteJob: (id: string) => void
  selectedJobId: string | null
  onSelectJob: (id: string | null) => void
}

export default function ProtectionTab({
  jobs, loading, logs, logsLoading,
  onSyncJob, onPauseJob, onResumeJob, onDeleteJob,
  selectedJobId, onSelectJob
}: ProtectionTabProps) {
  const t = useTranslations()
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [drawerOpen, setDrawerOpen] = useState(false)

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase()

    return (jobs || []).filter(j => {
      const matchQ = !qq || j.vm_name.toLowerCase().includes(qq) ||
        j.source_cluster.toLowerCase().includes(qq) || j.target_cluster.toLowerCase().includes(qq)

      return matchQ && (statusFilter === 'all' || j.status === statusFilter)
    })
  }, [jobs, q, statusFilter])

  const selected = useMemo(() => (jobs || []).find(j => j.id === selectedJobId), [jobs, selectedJobId])

  const openJob = (id: string) => {
    onSelectJob(id)
    setDrawerOpen(true)
  }

  const closeDrawer = () => {
    setDrawerOpen(false)
    onSelectJob(null)
  }

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

      {/* Jobs Grid */}
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
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, 1fr)' } }}>
          {filtered.map(j => <JobCard key={j.id} job={j} onClick={() => openJob(j.id)} t={t} />)}
        </Box>
      )}

      {/* Detail Drawer */}
      <Drawer anchor='right' open={drawerOpen} onClose={closeDrawer} PaperProps={{ sx: { width: { xs: '100%', sm: 420 } } }}>
        <Box sx={{ p: 2.5, display: 'flex', flexDirection: 'column', height: '100%' }}>
          {!selected ? (
            <Alert severity='info'>{t('siteRecovery.protection.selectJob')}</Alert>
          ) : (
            <>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                <Box>
                  <Typography variant='h6' sx={{ fontWeight: 700, mb: 0.25 }}>{selected.vm_name}</Typography>
                  <Typography variant='caption' sx={{ color: 'text.secondary' }}>VM {selected.vm_id}</Typography>
                </Box>
                <IconButton onClick={closeDrawer} size='small'><i className='ri-close-line' /></IconButton>
              </Box>

              <StatusChip status={selected.status} t={t} />

              {selected.status === 'error' && selected.error_message && (
                <Alert severity='error' sx={{ mt: 2 }} icon={<i className='ri-error-warning-line' />}>{selected.error_message}</Alert>
              )}

              <Box sx={{ p: 2, borderRadius: 1, bgcolor: 'action.hover', my: 2, textAlign: 'center' }}>
                <Typography variant='caption' sx={{ color: 'text.secondary' }}>{t('siteRecovery.protection.source')}</Typography>
                <Typography variant='body2' sx={{ fontWeight: 600, fontFamily: 'monospace', mb: 1 }}>{selected.source_cluster} / {selected.source_pool}</Typography>
                <Box sx={{ color: 'text.disabled', my: 0.5 }}><i className='ri-arrow-down-line' /></Box>
                <Typography variant='caption' sx={{ color: 'text.secondary' }}>{t('siteRecovery.protection.target')}</Typography>
                <Typography variant='body2' sx={{ fontWeight: 600, fontFamily: 'monospace' }}>{selected.target_cluster} / {selected.target_pool}</Typography>
              </Box>

              <Box sx={{ flex: 1, overflow: 'auto' }}>
                <DetailRow icon='ri-time-line' label={t('siteRecovery.protection.schedule')} value={selected.schedule} />
                <DetailRow icon='ri-timer-line' label={t('siteRecovery.protection.rpoTarget')} value={formatDuration(selected.rpo_target)} />
                <DetailRow icon='ri-timer-flash-line' label={t('siteRecovery.protection.rpoActual')} value={formatDuration(selected.rpo_actual)} />
                <DetailRow icon='ri-database-2-line' label={t('siteRecovery.protection.volume')} value={formatBytes(selected.volume_bytes)} />
                <DetailRow icon='ri-speed-line' label={t('siteRecovery.protection.throughput')} value={selected.throughput_bps > 0 ? `${formatBytes(selected.throughput_bps)}/s` : '—'} />
                <DetailRow icon='ri-calendar-line' label={t('siteRecovery.protection.lastSync')} value={selected.last_sync ? new Date(selected.last_sync).toLocaleString() : '—'} mono />

                {/* Logs */}
                {logs && logs.length > 0 && (
                  <>
                    <Divider sx={{ my: 2 }} />
                    <Typography variant='overline' sx={{ color: 'text.secondary', fontWeight: 600, mb: 1, display: 'block' }}>
                      {t('siteRecovery.protection.recentLogs')}
                    </Typography>
                    <Box sx={{ maxHeight: 150, overflow: 'auto', bgcolor: 'action.hover', borderRadius: 1, p: 1 }}>
                      {logs.slice(0, 20).map((log, i) => (
                        <Typography key={i} variant='caption' sx={{
                          display: 'block', fontFamily: 'monospace', fontSize: '0.65rem', lineHeight: 1.6,
                          color: log.level === 'error' ? 'error.main' : log.level === 'warning' ? 'warning.main' : 'text.secondary'
                        }}>
                          [{new Date(log.timestamp).toLocaleTimeString()}] {log.message}
                        </Typography>
                      ))}
                    </Box>
                  </>
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
