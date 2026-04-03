'use client'

import React, { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { Box, Typography, Chip, CircularProgress, Stack, useTheme } from '@mui/material'
import { widgetColors } from './themeColors'
import { useLicense } from '@/contexts/LicenseContext'
import { useReplicationHealth } from '@/hooks/useSiteRecovery'

function ScoreRing({ score, size = 56 }) {
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const c = widgetColors(isDark)
  const color = score >= 80 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444'
  const circumference = 2 * Math.PI * 14
  const dashLen = (score / 100) * circumference

  return (
    <Box sx={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg viewBox="0 0 36 36" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
        <circle cx="18" cy="18" r="14" fill="none"
          stroke={c.surfaceSubtle} strokeWidth="3" />
        <circle cx="18" cy="18" r="14" fill="none"
          stroke={color} strokeWidth="3"
          strokeDasharray={`${dashLen} ${circumference}`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
      </svg>
      <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography variant='body2' sx={{ fontWeight: 800, fontSize: 13, color }}>
          {score}
        </Typography>
      </Box>
    </Box>
  )
}

function statColor(value, goodThreshold, warnThreshold) {
  if (value >= goodThreshold) return '#22c55e'
  if (value >= warnThreshold) return '#f59e0b'
  return '#ef4444'
}

function SiteRecoveryWidget({ data, loading, config }) {
  const t = useTranslations()
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const c = widgetColors(isDark)
  const { isEnterprise } = useLicense()
  const { data: health, isLoading: healthLoading } = useReplicationHealth(isEnterprise)

  // Composite SR score: weighted average of coverage (40%), RPO compliance (40%), error rate (20%)
  const srScore = useMemo(() => {
    if (!health?.kpis) return null
    const kpis = health.kpis
    const totalVMs = (kpis.protected_vms || 0) + (kpis.unprotected_vms || 0)
    const coveragePct = totalVMs > 0 ? (kpis.protected_vms / totalVMs) * 100 : 0
    const rpoPct = kpis.rpo_compliance || 0
    const totalJobs = kpis.total_jobs || 0
    const errorRate = totalJobs > 0 ? ((kpis.error_count || 0) / totalJobs) * 100 : 0
    const errorScore = Math.max(0, 100 - errorRate * 10) // each error costs 10pts

    return Math.round(coveragePct * 0.4 + rpoPct * 0.4 + errorScore * 0.2)
  }, [health])

  // Dark vignette wrapper for empty/loading states
  const darkShell = (children) => (
    <Box
      sx={{
        bgcolor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
        border: '1px solid',
        borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
        borderRadius: 2.5,
        p: 1.5,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </Box>
  )

  if (!isEnterprise) {
    return darkShell(
      <>
        <i className='ri-vip-crown-fill' style={{ fontSize: 32, color: '#f59e0b', marginBottom: 8 }} />
        <Typography variant='caption' sx={{ color: 'rgba(255,255,255,0.4)' }}>Enterprise</Typography>
      </>
    )
  }

  if (healthLoading) {
    return darkShell(
      <CircularProgress size={24} sx={{ color: 'rgba(255,255,255,0.4)' }} />
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
      <Box
        sx={{
          bgcolor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
          border: '1px solid',
          borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
          borderRadius: 2.5,
          p: 1.5,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          transition: 'border-color 0.2s, box-shadow 0.2s',
          '&:hover': {
            borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)',
            boxShadow: isDark ? '0 2px 8px rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.08)',
          },
        }}
      >
        <Typography variant='caption' sx={{ color: 'rgba(255,255,255,0.4)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, mb: 1.5, fontSize: 10 }}>
          Site Recovery
        </Typography>
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <i className='ri-shield-star-line' style={{ fontSize: 28, color: c.textFaint, marginBottom: 4 }} />
          <Typography variant='caption' sx={{ color: 'rgba(255,255,255,0.4)' }}>{t('dashboard.widgetSr.noJobs')}</Typography>
        </Box>
      </Box>
    )
  }

  return (
    <Box
      sx={{
        bgcolor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
        border: '1px solid',
        borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
        borderRadius: 2.5,
        p: 1.5,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: 'border-color 0.2s, box-shadow 0.2s',
        '&:hover': {
          borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)',
          boxShadow: isDark ? '0 2px 8px rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.08)',
        },
      }}
    >
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
        <Typography variant='caption' sx={{ color: 'rgba(255,255,255,0.4)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 10 }}>
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
        {/* Protection Score */}
        {srScore !== null && (
          <Box sx={{
            display: 'flex', alignItems: 'center', gap: 1.5, p: 1, borderRadius: 1,
            bgcolor: `${statColor(srScore, 80, 50)}10`,
            border: '1px solid',
            borderColor: `${statColor(srScore, 80, 50)}25`,
          }}>
            <ScoreRing score={srScore} size={44} />
            <Box>
              <Typography variant='caption' sx={{ color: c.textMuted, fontSize: 9, display: 'block' }}>
                {t('dashboard.widgetSr.protectionScore')}
              </Typography>
              <Typography variant='body2' sx={{ fontWeight: 700, lineHeight: 1.2, color: '#fff' }}>
                {srScore >= 80 ? t('dashboard.widgetSr.healthy') : srScore >= 50 ? t('dashboard.widgetSr.attention') : t('dashboard.widgetSr.critical')}
              </Typography>
            </Box>
          </Box>
        )}

        {/* Coverage + RPO row */}
        <Stack direction='row' spacing={0.75}>
          <Box sx={{
            flex: 1, p: 0.75, borderRadius: 1, textAlign: 'center',
            bgcolor: `${statColor(coveragePct, 80, 50)}12`,
          }}>
            <Typography variant='h6' sx={{
              fontWeight: 900, lineHeight: 1,
              color: statColor(coveragePct, 80, 50),
              fontFamily: '"JetBrains Mono", monospace',
            }}>{coveragePct}%</Typography>
            <Typography variant='caption' sx={{ color: c.textMuted, fontSize: 8 }}>{t('dashboard.widgetSr.coverage')}</Typography>
          </Box>
          <Box sx={{
            flex: 1, p: 0.75, borderRadius: 1, textAlign: 'center',
            bgcolor: `${statColor(rpoCompliance, 90, 60)}12`,
          }}>
            <Typography variant='h6' sx={{
              fontWeight: 900, lineHeight: 1,
              color: statColor(rpoCompliance, 90, 60),
              fontFamily: '"JetBrains Mono", monospace',
            }}>{rpoCompliance}%</Typography>
            <Typography variant='caption' sx={{ color: c.textMuted, fontSize: 8 }}>RPO</Typography>
          </Box>
        </Stack>

        {/* Jobs row */}
        <Stack direction='row' spacing={0.75}>
          <Box sx={{
            flex: 1, p: 0.75, borderRadius: 1, textAlign: 'center',
            bgcolor: 'rgba(59,130,246,0.1)',
          }}>
            <Typography variant='h6' sx={{ fontWeight: 900, lineHeight: 1, color: '#3b82f6', fontFamily: '"JetBrains Mono", monospace' }}>{totalJobs}</Typography>
            <Typography variant='caption' sx={{ color: c.textMuted, fontSize: 8 }}>{t('dashboard.widgetSr.jobs')}</Typography>
          </Box>
          <Box sx={{
            flex: 1, p: 0.75, borderRadius: 1, textAlign: 'center',
            bgcolor: syncing > 0 ? 'rgba(99,102,241,0.15)' : 'rgba(99,102,241,0.06)',
          }}>
            <Typography variant='h6' sx={{ fontWeight: 900, lineHeight: 1, color: '#6366f1', fontFamily: '"JetBrains Mono", monospace' }}>{syncing}</Typography>
            <Typography variant='caption' sx={{ color: c.textMuted, fontSize: 8 }}>{t('dashboard.widgetSr.syncing')}</Typography>
          </Box>
          <Box sx={{
            flex: 1, p: 0.75, borderRadius: 1, textAlign: 'center',
            bgcolor: errors > 0 ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.06)',
          }}>
            <Typography variant='h6' sx={{ fontWeight: 900, lineHeight: 1, color: errors > 0 ? '#ef4444' : c.textFaint, fontFamily: '"JetBrains Mono", monospace' }}>{errors}</Typography>
            <Typography variant='caption' sx={{ color: c.textMuted, fontSize: 8 }}>{t('dashboard.widgetSr.errors')}</Typography>
          </Box>
        </Stack>
      </Stack>
    </Box>
  )
}

export default React.memo(SiteRecoveryWidget)
