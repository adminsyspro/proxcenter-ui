'use client'

import { useMemo, useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'

import Link from 'next/link'

import {
  Alert, Box, Button, Card, CardContent, Chip, Divider, Drawer, IconButton,
  InputAdornment, MenuItem, Select, Stack, TextField, Typography, LinearProgress
} from '@mui/material'

import { usePageTitle } from '@/contexts/PageTitleContext'
import EnterpriseGuard from '@/components/guards/EnterpriseGuard'
import { Features } from '@/contexts/LicenseContext'


/* --------------------------------- Network Throughput Chart --------------------------------- */

const NetworkThroughputChart = ({ t }) => {
  const chartData = useMemo(() => {
    const points = 60
    const baseSpeed = 800
    let data = []
    let current = baseSpeed
    
    for (let i = 0; i < points; i++) {
      const trend = Math.sin(i / 10) * 200
      const noise = (Math.random() - 0.5) * 150
      const spike = Math.random() > 0.92 ? Math.random() * 400 : 0

      current = Math.max(100, Math.min(1800, baseSpeed + trend + noise + spike))
      data.push(Math.round(current))
    }

    
return data
  }, [])

  const max = Math.max(...chartData)
  const min = Math.min(...chartData)
  const avg = Math.round(chartData.reduce((a, b) => a + b, 0) / chartData.length)
  const current = chartData[chartData.length - 1]

  const createPath = (data) => {
    const height = 100, width = 100, range = max - min || 1

    
return data.map((v, i) => {
      const x = (i / (data.length - 1)) * width
      const y = height - ((v - min) / range) * (height * 0.85) - 5

      
return `${i === 0 ? 'M' : 'L'} ${x} ${y}`
    }).join(' ')
  }

  const createAreaPath = (data) => `${createPath(data)} L 100 100 L 0 100 Z`

  return (
    <Card variant='outlined' sx={{ borderRadius: 2, overflow: 'hidden' }}>
      <CardContent sx={{ p: 0 }}>
        <Box sx={{ p: 2, pb: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Box>
            <Typography variant='subtitle2' sx={{ fontWeight: 600, mb: 0.25 }}>{t('replication.networkThroughput')}</Typography>
            <Typography variant='caption' sx={{ color: 'text.secondary' }}>{t('replication.lastHour')} • Ceph RBD Mirror</Typography>
          </Box>
          <Box sx={{ textAlign: 'right' }}>
            <Typography variant='h5' sx={{ fontWeight: 700, color: 'primary.main', lineHeight: 1 }}>
              {current} <Typography component='span' variant='caption' sx={{ fontWeight: 500 }}>Mo/s</Typography>
            </Typography>
            <Typography variant='caption' sx={{ color: 'text.secondary' }}>{t('replication.current')}</Typography>
          </Box>
        </Box>

        <Box sx={{ px: 2, height: 140, position: 'relative' }}>
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', pointerEvents: 'none' }}>
            {[0, 1, 2, 3].map(i => <Box key={i} sx={{ borderBottom: '1px solid', borderColor: 'divider', opacity: 0.5 }} />)}
          </Box>
          
          <Box sx={{ position: 'absolute', left: 0, top: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', pr: 1 }}>
            {[max, Math.round((max + min) / 2), min].map((v, i) => (
              <Typography key={i} variant='caption' sx={{ fontSize: '0.6rem', color: 'text.disabled', lineHeight: 1 }}>{v}</Typography>
            ))}
          </Box>

          <Box sx={{ position: 'absolute', left: 32, right: 0, top: 8, bottom: 20 }}>
            <svg width='100%' height='100%' viewBox='0 0 100 100' preserveAspectRatio='none'>
              <defs>
                <linearGradient id='throughputGradient' x1='0%' y1='0%' x2='0%' y2='100%'>
                  <stop offset='0%' stopColor='var(--mui-palette-primary-main)' stopOpacity={0.3} />
                  <stop offset='100%' stopColor='var(--mui-palette-primary-main)' stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <path d={createAreaPath(chartData)} fill='url(#throughputGradient)' />
              <path d={createPath(chartData)} fill='none' stroke='var(--mui-palette-primary-main)' strokeWidth={1.5} strokeLinecap='round' strokeLinejoin='round' vectorEffect='non-scaling-stroke' />
            </svg>
          </Box>

          <Box sx={{ position: 'absolute', left: 32, right: 0, bottom: 0, display: 'flex', justifyContent: 'space-between' }}>
            {['-60 min', '-30 min', 'now'].map((l, i) => (
              <Typography key={i} variant='caption' sx={{ fontSize: '0.6rem', color: 'text.disabled' }}>{l}</Typography>
            ))}
          </Box>
        </Box>

        <Box sx={{ display: 'flex', borderTop: '1px solid', borderColor: 'divider', mt: 1 }}>
          {[{ label: t('replication.average'), value: `${avg} Mo/s` }, { label: t('replication.max'), value: `${max} Mo/s` }, { label: t('replication.min'), value: `${min} Mo/s` }].map((stat, i) => (
            <Box key={i} sx={{ flex: 1, p: 1.5, textAlign: 'center', borderRight: i < 2 ? '1px solid' : 'none', borderColor: 'divider' }}>
              <Typography variant='caption' sx={{ color: 'text.secondary', display: 'block', fontSize: '0.65rem' }}>{stat.label}</Typography>
              <Typography variant='body2' sx={{ fontWeight: 600 }}>{stat.value}</Typography>
            </Box>
          ))}
        </Box>
      </CardContent>
    </Card>
  )
}

/* --------------------------------- Reusable Components --------------------------------- */

const StatusChip = ({ status, t }) => {
  const config = {
    ok: { label: t ? t('replication.status.synced') : 'Synced', color: 'success' },
    syncing: { label: t ? t('replication.status.syncing') : 'Syncing', color: 'primary' },
    error: { label: t ? t('replication.status.error') : 'Error', color: 'error' },
    paused: { label: t ? t('replication.status.paused') : 'Paused', color: 'default' }
  }

  const c = config[status] || config.paused

  return <Chip size='small' label={c.label} color={c.color} variant={status === 'paused' ? 'outlined' : 'filled'} />
}

const MetricCard = ({ label, value, subtitle, color = 'default' }) => {
  const colorMap = { default: 'text.primary', primary: 'primary.main', success: 'success.main', error: 'error.main', warning: 'warning.main' }

  
return (
    <Card variant='outlined' sx={{ borderRadius: 2 }}>
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Typography variant='caption' sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>{label}</Typography>
        <Typography variant='h5' sx={{ fontWeight: 700, color: colorMap[color], lineHeight: 1.2 }}>{value}</Typography>
        {subtitle && <Typography variant='caption' sx={{ color: 'text.secondary' }}>{subtitle}</Typography>}
      </CardContent>
    </Card>
  )
}

const DetailRow = ({ icon, label, value, mono }) => (
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

/* --------------------------------- Job Card (Compact) --------------------------------- */

const JobCard = ({ job, onClick, t }) => {
  const progress = job.sizeGb ? (job.transferredGb / job.sizeGb) * 100 : 0
  const isError = job.status === 'error'
  const isSyncing = job.status === 'syncing'

  return (
    <Card 
      variant='outlined' 
      onClick={onClick} 
      sx={{ 
        borderRadius: 2, 
        cursor: 'pointer', 
        transition: 'all 0.2s ease',
        borderColor: isError ? 'error.main' : 'divider',
        '&:hover': { borderColor: isError ? 'error.light' : 'primary.main', bgcolor: 'action.hover' }
      }}
    >
      {isSyncing && <LinearProgress variant='determinate' value={progress} sx={{ height: 2 }} />}
      
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        {/* Header */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
          <Box>
            <Typography variant='subtitle2' sx={{ fontWeight: 700, mb: 0.25 }}>{job.name}</Typography>
            <Typography variant='caption' sx={{ color: 'text.secondary' }}>
              {job.source} → {job.target}
            </Typography>
          </Box>
          <StatusChip status={job.status} t={t} />
        </Box>

        {/* Metrics */}
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <Box>
            <Typography variant='caption' sx={{ color: 'text.secondary' }}>RPO</Typography>
            <Typography variant='body2' sx={{ fontWeight: 600, color: 'primary.main' }}>{job.rpo}</Typography>
          </Box>
          <Box>
            <Typography variant='caption' sx={{ color: 'text.secondary' }}>Volume</Typography>
            <Typography variant='body2' sx={{ fontWeight: 600 }}>{job.sizeGb >= 1000 ? `${(job.sizeGb / 1000).toFixed(1)} To` : `${job.sizeGb} Go`}</Typography>
          </Box>
          <Box>
            <Typography variant='caption' sx={{ color: 'text.secondary' }}>Latence</Typography>
            <Typography variant='body2' sx={{ fontWeight: 600 }}>{job.latencyMs} ms</Typography>
          </Box>
          <Box sx={{ ml: 'auto', textAlign: 'right' }}>
            <Typography variant='caption' sx={{ color: 'text.secondary' }}>{t ? t('replication.lastSync') : 'Last sync'}</Typography>
            <Typography variant='body2' sx={{ fontWeight: 500, fontFamily: 'monospace', fontSize: '0.75rem' }}>{job.lastRun}</Typography>
          </Box>
        </Box>

        {/* Syncing details */}
        {isSyncing && (
          <Box sx={{ mt: 1.5, pt: 1.5, borderTop: '1px dashed', borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant='caption' sx={{ color: 'text.secondary' }}>
              {job.transferredGb} / {job.sizeGb} Go ({Math.round(progress)}%)
            </Typography>
            <Typography variant='caption' sx={{ color: 'primary.main', fontWeight: 600 }}>
              {job.throughputMbps} Mo/s {job.eta && `• ~${job.eta}`}
            </Typography>
          </Box>
        )}
      </CardContent>
    </Card>
  )
}

/* --------------------------------- Main Page --------------------------------- */

export default function ReplicationPage() {
  const t = useTranslations()
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedId, setSelectedId] = useState(null)

  const { setPageInfo } = usePageTitle()

  useEffect(() => {
    setPageInfo(t('replication.title'), t('replication.subtitle'), 'ri-arrow-right-double-fill')

return () => setPageInfo('', '', '')
  }, [setPageInfo, t])

  const jobs = useMemo(() => [
    { id: 'rep-rbd-prod', name: 'RBD Production VMs', mode: 'rbd-mirror (journal)', source: 'DC1 / rbd-ssd', target: 'DC2 / rbd-ssd', schedule: 'Continu', rpo: '< 30 sec', lastRun: '2026-01-06 09:04', status: 'ok', latencyMs: 0.8, sizeGb: 2400, transferredGb: 2400, throughputMbps: 920 },
    { id: 'rep-rbd-web', name: 'RBD Web Services', mode: 'rbd-mirror (journal)', source: 'DC1 / rbd-nvme', target: 'DC2 / rbd-nvme', schedule: 'Continu', rpo: '< 1 min', lastRun: '2026-01-06 09:05', status: 'syncing', latencyMs: 0.6, sizeGb: 180, transferredGb: 142, throughputMbps: 1240, eta: '5 min' },
    { id: 'rep-rbd-db', name: 'RBD Databases', mode: 'rbd-mirror (snapshot)', source: 'DC1 / rbd-ssd', target: 'DC3 / rbd-archive', schedule: 'Toutes les 15 min', rpo: '15 min', lastRun: '2026-01-06 08:45', status: 'ok', latencyMs: 1.2, sizeGb: 850, transferredGb: 850, throughputMbps: 780 },
    { id: 'rep-cephfs', name: 'CephFS Shared Storage', mode: 'cephfs-mirror', source: 'DC1 / cephfs-data', target: 'DC2 / cephfs-data', schedule: 'Continu', rpo: '< 5 min', lastRun: '2026-01-06 09:03', status: 'error', latencyMs: 1.5, sizeGb: 4200, transferredGb: 3800, throughputMbps: 0, errorMessage: 'cephfs-mirror daemon not responding on DC2' },
    { id: 'rep-rgw', name: 'RGW Object Storage', mode: 'rgw multisite', source: 'DC1 / rgw-zone1', target: 'DC2 / rgw-zone2', schedule: 'Multi-site sync', rpo: '< 5 min', lastRun: '2026-01-06 09:01', status: 'ok', latencyMs: 1.1, sizeGb: 1800, transferredGb: 1800, throughputMbps: 650 },
    { id: 'rep-rbd-test', name: 'RBD Test Environment', mode: 'rbd-mirror (snapshot)', source: 'DC1 / rbd-hdd', target: 'DC2 / rbd-hdd', schedule: 'Toutes les heures', rpo: '1 h', lastRun: '2026-01-06 08:00', status: 'paused', latencyMs: 2.1, sizeGb: 320, transferredGb: 0, throughputMbps: 0 }
  ], [])

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase()

    
return jobs.filter(j => {
      const matchQ = !qq || j.name.toLowerCase().includes(qq) || j.source.toLowerCase().includes(qq) || j.target.toLowerCase().includes(qq)

      
return matchQ && (statusFilter === 'all' || j.status === statusFilter)
    })
  }, [jobs, q, statusFilter])

  const selected = useMemo(() => jobs.find(j => j.id === selectedId), [jobs, selectedId])
  const openJob = id => { setSelectedId(id); setDrawerOpen(true) }

  const kpi = useMemo(() => {
    const total = jobs.length
    const ok = jobs.filter(j => j.status === 'ok').length
    const syncing = jobs.filter(j => j.status === 'syncing').length
    const error = jobs.filter(j => j.status === 'error').length
    const totalSize = jobs.reduce((a, j) => a + j.sizeGb, 0)

    
return { total, ok, syncing, error, totalSize }
  }, [jobs])

  return (
    <EnterpriseGuard requiredFeature={Features.CEPH_REPLICATION} featureName="Ceph Replication">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        {/* Header */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap' }}>
          <Box>
            <Typography variant='h5' sx={{ fontWeight: 700, mb: 0.25 }}>{t('replication.cephReplication')}</Typography>
          <Typography variant='body2' sx={{ color: 'text.secondary' }}>{t('replication.description')}</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button variant='outlined' component={Link} href='/drs' size='small' startIcon={<i className='ri-swap-line' />}>DRS</Button>
          <Button variant='outlined' component={Link} href='/policies' size='small' startIcon={<i className='ri-shield-check-line' />}>Policies</Button>
          <Button variant='contained' size='small' startIcon={<i className='ri-add-line' />} onClick={() => alert('TODO: create replication job')}>{t('replication.new')}</Button>
        </Box>
      </Box>

      {/* KPI */}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(5, 1fr)' } }}>
        <MetricCard label={t('replication.jobs')} value={kpi.total} />
        <MetricCard label={t('replication.syncedJobs')} value={kpi.ok} color='success' subtitle={`${Math.round((kpi.ok / kpi.total) * 100)}%`} />
        <MetricCard label={t('replication.inProgress')} value={kpi.syncing} color='primary' />
        <MetricCard label={t('replication.errors')} value={kpi.error} color={kpi.error > 0 ? 'error' : 'default'} />
        <MetricCard label={t('replication.totalVolume')} value={`${(kpi.totalSize / 1000).toFixed(1)} To`} />
      </Box>

      {/* Throughput Chart */}
      <NetworkThroughputChart t={t} />

      {/* Filters */}
      <Card variant='outlined' sx={{ borderRadius: 2 }}>
        <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder={t('replication.searchPlaceholder')}
              size='small'
              sx={{ flex: 1, minWidth: 200 }}
              InputProps={{ startAdornment: <InputAdornment position='start'><i className='ri-search-line' style={{ opacity: 0.5 }} /></InputAdornment> }}
            />
            <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} size='small' sx={{ minWidth: 140 }}>
              <MenuItem value='all'>{t('replication.allStatuses')}</MenuItem>
              <MenuItem value='ok'>{t('replication.status.synced')}</MenuItem>
              <MenuItem value='syncing'>{t('replication.status.syncing')}</MenuItem>
              <MenuItem value='paused'>{t('replication.status.paused')}</MenuItem>
              <MenuItem value='error'>{t('replication.status.error')}</MenuItem>
            </Select>
            {(q || statusFilter !== 'all') && (
              <Button size='small' onClick={() => { setQ(''); setStatusFilter('all') }} startIcon={<i className='ri-close-line' />}>Reset</Button>
            )}
          </Box>
        </CardContent>
      </Card>

      {/* Jobs Grid */}
      {filtered.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 6, px: 3 }}>
          <Box sx={{ fontSize: '2.5rem', mb: 1, opacity: 0.3 }}><i className='ri-inbox-line' /></Box>
          <Typography variant='subtitle1' sx={{ fontWeight: 600, mb: 0.5 }}>{t('replication.noJobFound')}</Typography>
          <Typography variant='body2' sx={{ color: 'text.secondary' }}>{t('replication.noJobFoundDesc')}</Typography>
        </Box>
      ) : (
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, 1fr)' } }}>
          {filtered.map(j => <JobCard key={j.id} job={j} onClick={() => openJob(j.id)} t={t} />)}
        </Box>
      )}

      {/* Drawer */}
      <Drawer anchor='right' open={drawerOpen} onClose={() => setDrawerOpen(false)} PaperProps={{ sx: { width: { xs: '100%', sm: 420 } } }}>
        <Box sx={{ p: 2.5, display: 'flex', flexDirection: 'column', height: '100%' }}>
          {!selected ? (
            <Alert severity='info'>{t('replication.selectJob')}</Alert>
          ) : (
            <>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                <Box>
                  <Typography variant='h6' sx={{ fontWeight: 700, mb: 0.25 }}>{selected.name}</Typography>
                  <Typography variant='caption' sx={{ color: 'text.secondary' }}>{selected.mode}</Typography>
                </Box>
                <IconButton onClick={() => setDrawerOpen(false)} size='small'><i className='ri-close-line' /></IconButton>
              </Box>

              <StatusChip status={selected.status} t={t} />

              {selected.status === 'error' && selected.errorMessage && (
                <Alert severity='error' sx={{ mt: 2 }} icon={<i className='ri-error-warning-line' />}>{selected.errorMessage}</Alert>
              )}

              <Box sx={{ p: 2, borderRadius: 1, bgcolor: 'action.hover', my: 2, textAlign: 'center' }}>
                <Typography variant='caption' sx={{ color: 'text.secondary' }}>{t('replication.source')}</Typography>
                <Typography variant='body2' sx={{ fontWeight: 600, fontFamily: 'monospace', mb: 1 }}>{selected.source}</Typography>
                <Box sx={{ color: 'text.disabled', my: 0.5 }}><i className='ri-arrow-down-line' /></Box>
                <Typography variant='caption' sx={{ color: 'text.secondary' }}>{t('replication.target')}</Typography>
                <Typography variant='body2' sx={{ fontWeight: 600, fontFamily: 'monospace' }}>{selected.target}</Typography>
              </Box>

              <Box sx={{ flex: 1, overflow: 'auto' }}>
                <DetailRow icon='ri-time-line' label={t('replication.schedule')} value={selected.schedule} />
                <DetailRow icon='ri-timer-line' label='RPO' value={selected.rpo} />
                <DetailRow icon='ri-speed-line' label={t('replication.latency')} value={`${selected.latencyMs} ms`} />
                <DetailRow icon='ri-database-2-line' label={t('replication.volume')} value={selected.sizeGb >= 1000 ? `${(selected.sizeGb / 1000).toFixed(1)} To` : `${selected.sizeGb} Go`} />
                <DetailRow icon='ri-calendar-line' label={t('replication.lastSync')} value={selected.lastRun} mono />

                <Divider sx={{ my: 2 }} />

                <Typography variant='overline' sx={{ color: 'text.secondary', fontWeight: 600, mb: 1.5, display: 'block' }}>{t('replication.actions')}</Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  <Button variant='contained' size='small' startIcon={<i className='ri-play-line' />} onClick={() => alert('TODO: sync')}>{t('replication.syncNow')}</Button>
                  {selected.status === 'paused' ? (
                    <Button variant='outlined' size='small' startIcon={<i className='ri-play-circle-line' />} onClick={() => alert('TODO: resume')}>{t('replication.resume')}</Button>
                  ) : (
                    <Button variant='outlined' size='small' startIcon={<i className='ri-pause-line' />} onClick={() => alert('TODO: pause')}>{t('replication.pause')}</Button>
                  )}
                  <Button variant='outlined' size='small' color='warning' startIcon={<i className='ri-swap-box-line' />} onClick={() => alert('TODO: failover')}>{t('replication.failover')}</Button>
                </Box>
              </Box>
            </>
          )}
        </Box>
      </Drawer>
      </Box>
    </EnterpriseGuard>
  )
}