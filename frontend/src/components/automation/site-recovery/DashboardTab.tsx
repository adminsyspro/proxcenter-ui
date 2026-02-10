'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert, Box, Card, CardContent, Chip, Skeleton, Stack, Typography, alpha, useTheme
} from '@mui/material'

import type { ReplicationHealthStatus, ReplicationActivity, SiteInfo } from '@/lib/orchestrator/site-recovery.types'

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

function timeAgo(dateStr: string): string {
  if (!dateStr) return '—'
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000

  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`

  return `${Math.round(diff / 86400)}d ago`
}

// ── Sub-components ─────────────────────────────────────────────────────

const MetricCard = ({ label, value, subtitle, color = 'default' }: {
  label: string; value: string | number; subtitle?: string; color?: 'default' | 'primary' | 'success' | 'error' | 'warning'
}) => {
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
        {latency > 0 ? `${latency.toFixed(1)} ms` : t('siteRecovery.dashboard.noConnection')}
      </Typography>
    </Box>
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
    last_sync: '', replicated_bytes: 0, error_count: 0
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
        <MetricCard
          label={t('siteRecovery.dashboard.protectedVms')}
          value={kpis.protected_vms}
          color='success'
        />
        <MetricCard
          label={t('siteRecovery.dashboard.unprotectedVms')}
          value={kpis.unprotected_vms}
          color={kpis.unprotected_vms > 0 ? 'warning' : 'default'}
        />
        <MetricCard
          label={t('siteRecovery.dashboard.avgRpo')}
          value={kpis.avg_rpo_seconds > 0 ? formatDuration(kpis.avg_rpo_seconds) : '—'}
          color='primary'
        />
        <MetricCard
          label={t('siteRecovery.dashboard.lastSync')}
          value={kpis.last_sync ? timeAgo(kpis.last_sync) : '—'}
        />
        <MetricCard
          label={t('siteRecovery.dashboard.replicatedVolume')}
          value={formatBytes(kpis.replicated_bytes)}
        />
        <MetricCard
          label={t('siteRecovery.dashboard.errors')}
          value={kpis.error_count}
          color={kpis.error_count > 0 ? 'error' : 'default'}
        />
      </Box>

      {/* Recent Activity Timeline */}
      <Card variant='outlined' sx={{ borderRadius: 2 }}>
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
          <Typography variant='subtitle2' sx={{ fontWeight: 600, mb: 1.5 }}>
            {t('siteRecovery.dashboard.recentActivity')}
          </Typography>
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
