'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert, Box, Card, CardContent, Chip, LinearProgress,
  Skeleton, Stack, Typography, alpha, useTheme
} from '@mui/material'

import type {
  ReplicationHealthStatus, ReplicationActivity, SiteInfo, JobStatusSummary
} from '@/lib/orchestrator/site-recovery.types'

// ── Helpers ────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))

  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '—'
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`

  return `${(seconds / 3600).toFixed(1)}h`
}

function timeAgo(dateStr: string): string {
  if (!dateStr) return '—'
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000

  if (diff < 0) return 'just now'
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`

  return `${Math.round(diff / 86400)}d ago`
}

// ── Sub-components ─────────────────────────────────────────────────────

const KPICard = ({ icon, label, value, subtitle, color = 'default' }: {
  icon: string; label: string; value: string | number; subtitle?: string
  color?: 'default' | 'primary' | 'success' | 'error' | 'warning'
}) => {
  const theme = useTheme()
  const colorMap: Record<string, string> = {
    default: theme.palette.text.primary,
    primary: theme.palette.primary.main,
    success: theme.palette.success.main,
    error: theme.palette.error.main,
    warning: theme.palette.warning.main
  }
  const bgMap: Record<string, string> = {
    default: alpha(theme.palette.text.primary, 0.04),
    primary: alpha(theme.palette.primary.main, 0.08),
    success: alpha(theme.palette.success.main, 0.08),
    error: alpha(theme.palette.error.main, 0.08),
    warning: alpha(theme.palette.warning.main, 0.08)
  }

  return (
    <Card variant='outlined' sx={{ borderRadius: 2 }}>
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
          <Box sx={{
            width: 36, height: 36, borderRadius: 1.5,
            bgcolor: bgMap[color], color: colorMap[color],
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.1rem', flexShrink: 0
          }}>
            <i className={icon} />
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography variant='caption' sx={{ color: 'text.secondary', display: 'block', lineHeight: 1.3 }}>
              {label}
            </Typography>
            <Typography variant='h5' sx={{ fontWeight: 700, color: colorMap[color], lineHeight: 1.2, mt: 0.25 }}>
              {value}
            </Typography>
            {subtitle && (
              <Typography variant='caption' sx={{ color: 'text.secondary', fontSize: '0.65rem' }}>
                {subtitle}
              </Typography>
            )}
          </Box>
        </Box>
      </CardContent>
    </Card>
  )
}

const SiteCard = ({ site, t }: { site: SiteInfo; t: any }) => {
  const theme = useTheme()
  const statusColors: Record<string, string> = {
    online: theme.palette.success.main,
    degraded: theme.palette.warning.main,
    offline: theme.palette.error.main
  }

  return (
    <Card variant='outlined' sx={{ borderRadius: 2, flex: 1 }}>
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.5 }}>
          <Box>
            <Typography variant='subtitle2' sx={{ fontWeight: 700 }}>{site.name || site.cluster_id}</Typography>
            <Chip
              size='small'
              label={site.role === 'primary' ? t('siteRecovery.dashboard.primary') : t('siteRecovery.dashboard.disasterRecovery')}
              color={site.role === 'primary' ? 'primary' : 'secondary'}
              variant='outlined'
              sx={{ mt: 0.5 }}
            />
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Box sx={{
              width: 8, height: 8, borderRadius: '50%',
              bgcolor: statusColors[site.status] || theme.palette.text.disabled,
              boxShadow: site.status === 'online' ? `0 0 8px ${statusColors[site.status]}` : 'none'
            }} />
            <Typography variant='caption' sx={{ fontWeight: 600, textTransform: 'capitalize' }}>
              {site.status}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: 3 }}>
          <Box>
            <Typography variant='caption' sx={{ color: 'text.secondary' }}>{t('siteRecovery.dashboard.nodes')}</Typography>
            <Typography variant='body2' sx={{ fontWeight: 600 }}>{site.node_count}</Typography>
          </Box>
          <Box>
            <Typography variant='caption' sx={{ color: 'text.secondary' }}>{t('siteRecovery.dashboard.vms')}</Typography>
            <Typography variant='body2' sx={{ fontWeight: 600 }}>{site.vm_count}</Typography>
          </Box>
        </Box>
      </CardContent>
    </Card>
  )
}

const ConnectivityIndicator = ({ connectivity, latency, t }: {
  connectivity: string; latency: number; t: any
}) => {
  const theme = useTheme()
  const colorMap: Record<string, string> = {
    connected: theme.palette.success.main,
    degraded: theme.palette.warning.main,
    disconnected: theme.palette.error.main
  }
  const color = colorMap[connectivity] || theme.palette.text.disabled

  return (
    <Box sx={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      px: 3, minWidth: 100
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
        <Box sx={{ width: 24, height: 2, bgcolor: color, borderRadius: 1 }} />
        <Box sx={{
          width: 10, height: 10, borderRadius: '50%', border: `2px solid ${color}`,
          bgcolor: connectivity === 'connected' ? color : 'transparent',
          animation: connectivity === 'connected' ? 'pulse 2s infinite' : 'none',
          '@keyframes pulse': {
            '0%, 100%': { opacity: 1 },
            '50%': { opacity: 0.5 }
          }
        }} />
        <Box sx={{ width: 24, height: 2, bgcolor: color, borderRadius: 1 }} />
      </Box>
      <Typography variant='caption' sx={{ color: 'text.secondary', fontSize: '0.65rem' }}>
        {connectivity === 'connected'
          ? t('siteRecovery.dashboard.connected')
          : connectivity === 'degraded'
            ? t('siteRecovery.dashboard.degraded')
            : t('siteRecovery.dashboard.noConnection')}
      </Typography>
    </Box>
  )
}

const RPOGauge = ({ compliance, t }: { compliance: number; t: any }) => {
  const theme = useTheme()
  const color = compliance >= 90
    ? theme.palette.success.main
    : compliance >= 60
      ? theme.palette.warning.main
      : theme.palette.error.main

  return (
    <Card variant='outlined' sx={{ borderRadius: 2 }}>
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Typography variant='subtitle2' sx={{ fontWeight: 600, mb: 1.5 }}>
          {t('siteRecovery.dashboard.rpoCompliance')}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {/* Circular gauge */}
          <Box sx={{ position: 'relative', width: 80, height: 80, flexShrink: 0 }}>
            <svg viewBox="0 0 36 36" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
              <circle cx="18" cy="18" r="15" fill="none"
                stroke={alpha(theme.palette.divider, 0.3)} strokeWidth="3" />
              <circle cx="18" cy="18" r="15" fill="none"
                stroke={color} strokeWidth="3"
                strokeDasharray={`${compliance * 0.942} 100`}
                strokeLinecap="round"
                style={{ transition: 'stroke-dasharray 0.6s ease' }}
              />
            </svg>
            <Box sx={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <Typography variant='body2' sx={{ fontWeight: 700, color }}>
                {Math.round(compliance)}%
              </Typography>
            </Box>
          </Box>
          <Box>
            <Typography variant='caption' sx={{ color: 'text.secondary', display: 'block' }}>
              {t('siteRecovery.dashboard.rpoComplianceDesc')}
            </Typography>
          </Box>
        </Box>
      </CardContent>
    </Card>
  )
}

const JobStatusDistribution = ({ summary, t }: { summary: JobStatusSummary; t: any }) => {
  const theme = useTheme()
  const total = summary.synced + summary.syncing + summary.pending + summary.error + summary.paused

  const segments = [
    { key: 'synced', count: summary.synced, color: theme.palette.success.main, label: t('siteRecovery.status.synced') },
    { key: 'syncing', count: summary.syncing, color: theme.palette.primary.main, label: t('siteRecovery.status.syncing') },
    { key: 'pending', count: summary.pending, color: theme.palette.warning.main, label: t('siteRecovery.status.pending') },
    { key: 'error', count: summary.error, color: theme.palette.error.main, label: t('siteRecovery.status.error') },
    { key: 'paused', count: summary.paused, color: theme.palette.text.disabled, label: t('siteRecovery.status.paused') }
  ].filter(s => s.count > 0)

  if (total === 0) return null

  return (
    <Card variant='outlined' sx={{ borderRadius: 2 }}>
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Typography variant='subtitle2' sx={{ fontWeight: 600, mb: 1.5 }}>
          {t('siteRecovery.dashboard.jobDistribution')}
        </Typography>

        {/* Stacked bar */}
        <Box sx={{
          display: 'flex', height: 12, borderRadius: 1, overflow: 'hidden', mb: 1.5
        }}>
          {segments.map(s => (
            <Box key={s.key} sx={{
              width: `${(s.count / total) * 100}%`,
              bgcolor: s.color,
              transition: 'width 0.4s ease'
            }} />
          ))}
        </Box>

        {/* Legend */}
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          {segments.map(s => (
            <Box key={s.key} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: s.color }} />
              <Typography variant='caption' sx={{ color: 'text.secondary' }}>
                {s.label}: <strong>{s.count}</strong>
              </Typography>
            </Box>
          ))}
        </Box>
      </CardContent>
    </Card>
  )
}

const ProtectionCoverage = ({ protectedVMs, unprotectedVMs, t }: {
  protectedVMs: number; unprotectedVMs: number; t: any
}) => {
  const theme = useTheme()
  const total = protectedVMs + unprotectedVMs
  const pct = total > 0 ? (protectedVMs / total) * 100 : 0

  return (
    <Card variant='outlined' sx={{ borderRadius: 2 }}>
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Typography variant='subtitle2' sx={{ fontWeight: 600, mb: 1.5 }}>
          {t('siteRecovery.dashboard.protectionCoverage')}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
          <Box sx={{ flex: 1 }}>
            <LinearProgress
              variant='determinate'
              value={pct}
              sx={{
                height: 10, borderRadius: 1,
                bgcolor: alpha(theme.palette.error.main, 0.12),
                '& .MuiLinearProgress-bar': {
                  bgcolor: theme.palette.success.main,
                  borderRadius: 1
                }
              }}
            />
          </Box>
          <Typography variant='body2' sx={{ fontWeight: 700, minWidth: 40, textAlign: 'right' }}>
            {Math.round(pct)}%
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'success.main' }} />
            <Typography variant='caption' sx={{ color: 'text.secondary' }}>
              {t('siteRecovery.dashboard.protectedVms')}: <strong>{protectedVMs}</strong>
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'error.main' }} />
            <Typography variant='caption' sx={{ color: 'text.secondary' }}>
              {t('siteRecovery.dashboard.unprotectedVms')}: <strong>{unprotectedVMs}</strong>
            </Typography>
          </Box>
        </Box>
      </CardContent>
    </Card>
  )
}

const ActivityItem = ({ activity }: { activity: ReplicationActivity }) => {
  const theme = useTheme()
  const iconMap: Record<string, string> = {
    sync: 'ri-refresh-line',
    failover: 'ri-shield-star-line',
    failback: 'ri-arrow-go-back-line',
    error: 'ri-error-warning-line',
    job_created: 'ri-add-circle-line',
    plan_tested: 'ri-test-tube-line'
  }
  const colorMap: Record<string, string> = {
    info: theme.palette.info.main,
    warning: theme.palette.warning.main,
    error: theme.palette.error.main,
    success: theme.palette.success.main
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, py: 1 }}>
      <Box sx={{
        width: 28, height: 28, borderRadius: 1,
        bgcolor: alpha(colorMap[activity.severity] || theme.palette.text.disabled, 0.1),
        color: colorMap[activity.severity] || theme.palette.text.disabled,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.85rem', flexShrink: 0
      }}>
        <i className={iconMap[activity.type] || 'ri-information-line'} />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant='body2' sx={{ fontSize: '0.8rem', lineHeight: 1.4 }}>
          {activity.message}
        </Typography>
        <Typography variant='caption' sx={{ color: 'text.secondary', fontSize: '0.65rem' }}>
          {timeAgo(activity.timestamp)}
        </Typography>
      </Box>
    </Box>
  )
}

// ── Main Component ─────────────────────────────────────────────────────

interface DashboardTabProps {
  health: ReplicationHealthStatus | undefined
  loading: boolean
}

export default function DashboardTab({ health, loading }: DashboardTabProps) {
  const t = useTranslations()
  const theme = useTheme()

  const kpis = useMemo(() => health?.kpis || {
    protected_vms: 0, unprotected_vms: 0, avg_rpo_seconds: 0,
    last_sync: '', replicated_bytes: 0, error_count: 0,
    total_jobs: 0, rpo_compliance: 0
  }, [health])

  const jobSummary = useMemo(() => health?.job_summary || {
    synced: 0, syncing: 0, pending: 0, error: 0, paused: 0
  }, [health])

  if (loading) {
    return (
      <Stack spacing={2.5}>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Skeleton variant='rounded' height={120} sx={{ flex: 1 }} />
          <Skeleton variant='rounded' height={120} width={100} />
          <Skeleton variant='rounded' height={120} sx={{ flex: 1 }} />
        </Box>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} variant='rounded' height={80} />)}
        </Box>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(2, 1fr)' }}>
          <Skeleton variant='rounded' height={160} />
          <Skeleton variant='rounded' height={160} />
        </Box>
        <Skeleton variant='rounded' height={200} />
      </Stack>
    )
  }

  if (!health || health.sites.length === 0) {
    return (
      <Alert severity='info' icon={<i className='ri-information-line' />}>
        {t('siteRecovery.dashboard.noSitesConfigured')}
      </Alert>
    )
  }

  return (
    <Stack spacing={2.5}>
      {/* Site Health */}
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'stretch' }}>
        {health.sites[0] && <SiteCard site={health.sites[0]} t={t} />}
        <ConnectivityIndicator connectivity={health.connectivity} latency={health.latency_ms} t={t} />
        {health.sites[1] && <SiteCard site={health.sites[1]} t={t} />}
      </Box>

      {/* KPI Row */}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)', lg: 'repeat(6, 1fr)' } }}>
        <KPICard
          icon='ri-shield-check-line'
          label={t('siteRecovery.dashboard.protectedVms')}
          value={kpis.protected_vms}
          color='success'
        />
        <KPICard
          icon='ri-shield-line'
          label={t('siteRecovery.dashboard.unprotectedVms')}
          value={kpis.unprotected_vms}
          color={kpis.unprotected_vms > 0 ? 'warning' : 'default'}
        />
        <KPICard
          icon='ri-timer-line'
          label={t('siteRecovery.dashboard.avgRpo')}
          value={kpis.avg_rpo_seconds > 0 ? formatDuration(kpis.avg_rpo_seconds) : '—'}
          color='primary'
        />
        <KPICard
          icon='ri-refresh-line'
          label={t('siteRecovery.dashboard.lastSync')}
          value={kpis.last_sync ? timeAgo(kpis.last_sync) : '—'}
        />
        <KPICard
          icon='ri-hard-drive-3-line'
          label={t('siteRecovery.dashboard.replicatedVolume')}
          value={formatBytes(kpis.replicated_bytes)}
        />
        <KPICard
          icon='ri-error-warning-line'
          label={t('siteRecovery.dashboard.errors')}
          value={kpis.error_count}
          color={kpis.error_count > 0 ? 'error' : 'default'}
        />
      </Box>

      {/* Charts Row */}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' } }}>
        <RPOGauge compliance={kpis.rpo_compliance} t={t} />
        <JobStatusDistribution summary={jobSummary} t={t} />
        <ProtectionCoverage
          protectedVMs={kpis.protected_vms}
          unprotectedVMs={kpis.unprotected_vms}
          t={t}
        />
      </Box>

      {/* Recent Activity Timeline */}
      <Card variant='outlined' sx={{ borderRadius: 2 }}>
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
            <Typography variant='subtitle2' sx={{ fontWeight: 600 }}>
              {t('siteRecovery.dashboard.recentActivity')}
            </Typography>
            {health.recent_activity && health.recent_activity.length > 0 && (
              <Chip
                size='small'
                label={`${health.recent_activity.length} ${t('siteRecovery.dashboard.events')}`}
                variant='outlined'
                sx={{ height: 20, fontSize: '0.65rem' }}
              />
            )}
          </Box>
          {(!health.recent_activity || health.recent_activity.length === 0) ? (
            <Box sx={{ textAlign: 'center', py: 3, opacity: 0.5 }}>
              <i className='ri-time-line' style={{ fontSize: '1.5rem' }} />
              <Typography variant='body2' sx={{ mt: 0.5 }}>
                {t('siteRecovery.dashboard.noRecentActivity')}
              </Typography>
            </Box>
          ) : (
            <Box sx={{ maxHeight: 300, overflow: 'auto' }}>
              <Stack divider={<Box sx={{ borderBottom: '1px solid', borderColor: 'divider' }} />}>
                {health.recent_activity.map((activity, i) => (
                  <ActivityItem key={i} activity={activity} />
                ))}
              </Stack>
            </Box>
          )}
        </CardContent>
      </Card>
    </Stack>
  )
}
