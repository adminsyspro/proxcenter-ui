'use client'

import React from 'react'
import { useTranslations } from 'next-intl'
import { Box, Typography, Chip, CircularProgress, alpha, Stack } from '@mui/material'
import { useLicense } from '@/contexts/LicenseContext'
import { useReplicationHealth } from '@/hooks/useSiteRecovery'

function SiteRecoveryWidget({ data, loading, config }) {
  const t = useTranslations()
  const { isEnterprise } = useLicense()
  const { data: health, isLoading: healthLoading } = useReplicationHealth(isEnterprise)

  if (!isEnterprise) {
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 2, textAlign: 'center' }}>
        <i className='ri-vip-crown-fill' style={{ fontSize: 32, color: 'var(--mui-palette-warning-main)', marginBottom: 8 }} />
        <Typography variant='caption' sx={{ opacity: 0.6 }}>Enterprise</Typography>
      </Box>
    )
  }

  if (healthLoading) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress size={24} />
      </Box>
    )
  }

  const kpis = health?.kpis || {}
  const jobSummary = health?.job_summary || {}
  const connectivity = health?.connectivity || 'disconnected'
  const hasData = health && health.sites?.length > 0

  const protectedVMs = kpis.protected_vms || 0
  const unprotectedVMs = kpis.unprotected_vms || 0
  const totalVMs = protectedVMs + unprotectedVMs
  const coveragePct = totalVMs > 0 ? Math.round((protectedVMs / totalVMs) * 100) : 0
  const rpoCompliance = Math.round(kpis.rpo_compliance || 0)
  const errors = kpis.error_count || 0
  const totalJobs = kpis.total_jobs || 0
  const syncing = jobSummary.syncing || 0

  const connColor = connectivity === 'connected' ? 'success' : connectivity === 'degraded' ? 'warning' : 'error'

  if (!hasData) {
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', p: 1.5 }}>
        <Typography variant='caption' sx={{ opacity: 0.6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, mb: 1.5 }}>
          Site Recovery
        </Typography>
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: 0.5 }}>
          <i className='ri-shield-star-line' style={{ fontSize: 28, marginBottom: 4 }} />
          <Typography variant='caption'>{t('dashboard.widgetSr.noJobs')}</Typography>
        </Box>
      </Box>
    )
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', p: 1.5, overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
        <Typography variant='caption' sx={{ opacity: 0.6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Site Recovery
        </Typography>
        <Chip
          size='small'
          label={t(`dashboard.widgetSr.${connectivity}`)}
          color={connColor}
          sx={{ height: 20, fontSize: 10, fontWeight: 700 }}
        />
      </Box>

      <Stack spacing={1} sx={{ flex: 1 }}>
        {/* Protection Coverage - mini donut + stats */}
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 1.5, p: 1, borderRadius: 1,
          bgcolor: (theme) => alpha(coveragePct >= 80 ? theme.palette.success.main : coveragePct >= 50 ? theme.palette.warning.main : theme.palette.error.main, 0.06),
          border: '1px solid',
          borderColor: (theme) => alpha(coveragePct >= 80 ? theme.palette.success.main : coveragePct >= 50 ? theme.palette.warning.main : theme.palette.error.main, 0.15)
        }}>
          {/* Mini circular gauge */}
          <Box sx={{ position: 'relative', width: 40, height: 40, flexShrink: 0 }}>
            <svg viewBox="0 0 36 36" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
              <circle cx="18" cy="18" r="14" fill="none"
                stroke="var(--mui-palette-divider)" strokeWidth="3" opacity={0.3} />
              <circle cx="18" cy="18" r="14" fill="none"
                stroke={coveragePct >= 80 ? 'var(--mui-palette-success-main)' : coveragePct >= 50 ? 'var(--mui-palette-warning-main)' : 'var(--mui-palette-error-main)'}
                strokeWidth="3"
                strokeDasharray={`${coveragePct * 0.88} 100`}
                strokeLinecap="round"
              />
            </svg>
            <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography variant='caption' sx={{ fontWeight: 800, fontSize: 9 }}>
                {coveragePct}%
              </Typography>
            </Box>
          </Box>
          <Box>
            <Typography variant='caption' sx={{ color: 'text.secondary', fontSize: 9, display: 'block' }}>
              {t('dashboard.widgetSr.coverage')}
            </Typography>
            <Typography variant='body2' sx={{ fontWeight: 700, lineHeight: 1.2 }}>
              {protectedVMs} / {totalVMs} VMs
            </Typography>
          </Box>
        </Box>

        {/* RPO Compliance */}
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 1, p: 1, borderRadius: 1,
          bgcolor: (theme) => alpha(theme.palette.primary.main, 0.04),
          border: '1px solid',
          borderColor: (theme) => alpha(theme.palette.primary.main, 0.1)
        }}>
          <Box sx={{
            width: 28, height: 28, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            bgcolor: (theme) => alpha(theme.palette.primary.main, 0.15), flexShrink: 0
          }}>
            <i className='ri-timer-line' style={{ fontSize: 14, color: 'var(--mui-palette-primary-main)' }} />
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography variant='caption' sx={{ color: 'text.secondary', fontSize: 9 }}>
              {t('dashboard.widgetSr.rpoCompliance')}
            </Typography>
            <Typography variant='body2' sx={{ fontWeight: 700, lineHeight: 1.2, color: rpoCompliance >= 90 ? 'success.main' : rpoCompliance >= 60 ? 'warning.main' : 'error.main' }}>
              {rpoCompliance}%
            </Typography>
          </Box>
        </Box>

        {/* Jobs row */}
        <Stack direction='row' spacing={0.75}>
          <Box sx={{
            flex: 1, p: 0.75, borderRadius: 1, textAlign: 'center',
            bgcolor: (theme) => alpha(theme.palette.info.main, 0.08)
          }}>
            <Typography variant='h6' sx={{ fontWeight: 900, lineHeight: 1, color: 'info.main' }}>{totalJobs}</Typography>
            <Typography variant='caption' sx={{ color: 'text.secondary', fontSize: 8 }}>{t('dashboard.widgetSr.jobs')}</Typography>
          </Box>
          <Box sx={{
            flex: 1, p: 0.75, borderRadius: 1, textAlign: 'center',
            bgcolor: (theme) => alpha(theme.palette.primary.main, syncing > 0 ? 0.12 : 0.05)
          }}>
            <Typography variant='h6' sx={{ fontWeight: 900, lineHeight: 1, color: 'primary.main' }}>{syncing}</Typography>
            <Typography variant='caption' sx={{ color: 'text.secondary', fontSize: 8 }}>{t('dashboard.widgetSr.syncing')}</Typography>
          </Box>
          <Box sx={{
            flex: 1, p: 0.75, borderRadius: 1, textAlign: 'center',
            bgcolor: (theme) => alpha(theme.palette.error.main, errors > 0 ? 0.12 : 0.05)
          }}>
            <Typography variant='h6' sx={{ fontWeight: 900, lineHeight: 1, color: errors > 0 ? 'error.main' : 'text.secondary' }}>{errors}</Typography>
            <Typography variant='caption' sx={{ color: 'text.secondary', fontSize: 8 }}>{t('dashboard.widgetSr.errors')}</Typography>
          </Box>
        </Stack>
      </Stack>
    </Box>
  )
}

export default React.memo(SiteRecoveryWidget)
