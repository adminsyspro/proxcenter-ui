'use client'

import React, { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { Box, Typography, Chip, CircularProgress, alpha, Stack } from '@mui/material'
import { useLicense } from '@/contexts/LicenseContext'
import { useDRSStatus, useDRSMetrics } from '@/hooks/useDRS'
import { computeDrsHealthScore } from '@/lib/utils/drs-health'

function ScoreRing({ score, size = 56 }) {
  const color = score >= 80 ? 'var(--mui-palette-success-main)' : score >= 50 ? 'var(--mui-palette-warning-main)' : 'var(--mui-palette-error-main)'
  const circumference = 2 * Math.PI * 14 // r=14
  const dashLen = (score / 100) * circumference

  return (
    <Box sx={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg viewBox="0 0 36 36" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
        <circle cx="18" cy="18" r="14" fill="none"
          stroke="var(--mui-palette-divider)" strokeWidth="3" opacity={0.3} />
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

function DrsStatusWidget({ data, loading, config }) {
  const t = useTranslations()
  const { isEnterprise } = useLicense()
  const { data: status, isLoading: statusLoading } = useDRSStatus(isEnterprise)
  const { data: metricsData, isLoading: metricsLoading } = useDRSMetrics(isEnterprise)

  // Compute average health score across all clusters
  const healthScore = useMemo(() => {
    if (!metricsData) return null
    const clusters = Object.values(metricsData)
    if (clusters.length === 0) return null

    let total = 0
    for (const cluster of clusters) {
      const breakdown = computeDrsHealthScore(cluster.summary, cluster.nodes)
      total += breakdown.score
    }
    return Math.round(total / clusters.length)
  }, [metricsData])

  if (!isEnterprise) {
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 2, textAlign: 'center' }}>
        <i className='ri-vip-crown-fill' style={{ fontSize: 32, color: 'var(--mui-palette-warning-main)', marginBottom: 8 }} />
        <Typography variant='caption' sx={{ opacity: 0.6 }}>Enterprise</Typography>
      </Box>
    )
  }

  if (statusLoading || metricsLoading) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress size={24} />
      </Box>
    )
  }

  const enabled = status?.enabled ?? false
  const mode = status?.mode || 'manual'
  const recommendations = status?.recommendations || 0
  const activeMigrations = status?.active_migrations || 0

  const modeColor = mode === 'automatic' ? 'success.main' : mode === 'partial' ? 'warning.main' : 'info.main'
  const modeLabel = mode === 'automatic' ? t('dashboard.widgetDrs.automatic') : mode === 'partial' ? t('dashboard.widgetDrs.partial') : t('dashboard.widgetDrs.manual')

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', p: 1.5, overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
        <Typography variant='caption' sx={{ opacity: 0.6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          DRS
        </Typography>
        <Chip
          size='small'
          label={enabled ? modeLabel : t('dashboard.widgetDrs.disabled')}
          color={enabled ? 'success' : 'default'}
          variant={enabled ? 'filled' : 'outlined'}
          sx={{ height: 20, fontSize: 10, fontWeight: 700 }}
        />
      </Box>

      {!enabled ? (
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: 0.5 }}>
          <i className='ri-pause-circle-line' style={{ fontSize: 28, marginBottom: 4 }} />
          <Typography variant='caption'>{t('dashboard.widgetDrs.disabled')}</Typography>
        </Box>
      ) : (
        <Stack spacing={1} sx={{ flex: 1 }}>
          {/* Health Score */}
          {healthScore !== null && (
            <Box sx={{
              display: 'flex', alignItems: 'center', gap: 1.5, p: 1, borderRadius: 1,
              bgcolor: (theme) => alpha(
                healthScore >= 80 ? theme.palette.success.main : healthScore >= 50 ? theme.palette.warning.main : theme.palette.error.main,
                0.06
              ),
              border: '1px solid',
              borderColor: (theme) => alpha(
                healthScore >= 80 ? theme.palette.success.main : healthScore >= 50 ? theme.palette.warning.main : theme.palette.error.main,
                0.15
              )
            }}>
              <ScoreRing score={healthScore} size={44} />
              <Box>
                <Typography variant='caption' sx={{ color: 'text.secondary', fontSize: 9, display: 'block' }}>
                  {t('dashboard.widgetDrs.healthScore')}
                </Typography>
                <Typography variant='body2' sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                  {healthScore >= 80 ? t('dashboard.widgetDrs.healthy') : healthScore >= 50 ? t('dashboard.widgetDrs.attention') : t('dashboard.widgetDrs.critical')}
                </Typography>
              </Box>
            </Box>
          )}

          {/* Stats row */}
          <Stack direction='row' spacing={0.75}>
            <Box sx={{
              flex: 1, p: 0.75, borderRadius: 1, textAlign: 'center',
              bgcolor: (theme) => alpha(theme.palette.primary.main, activeMigrations > 0 ? 0.12 : 0.05)
            }}>
              <Typography variant='h6' sx={{ fontWeight: 900, lineHeight: 1, color: 'primary.main' }}>{activeMigrations}</Typography>
              <Typography variant='caption' sx={{ color: 'text.secondary', fontSize: 8 }}>{t('dashboard.widgetDrs.migrations')}</Typography>
            </Box>
            <Box sx={{
              flex: 1, p: 0.75, borderRadius: 1, textAlign: 'center',
              bgcolor: (theme) => alpha(theme.palette.warning.main, recommendations > 0 ? 0.12 : 0.05)
            }}>
              <Typography variant='h6' sx={{ fontWeight: 900, lineHeight: 1, color: recommendations > 0 ? 'warning.main' : 'text.secondary' }}>{recommendations}</Typography>
              <Typography variant='caption' sx={{ color: 'text.secondary', fontSize: 8 }}>{t('dashboard.widgetDrs.recs')}</Typography>
            </Box>
            <Box sx={{
              flex: 1, p: 0.75, borderRadius: 1, textAlign: 'center',
              bgcolor: (theme) => alpha(theme.palette.success.main, 0.05)
            }}>
              <Typography variant='h6' sx={{ fontWeight: 900, lineHeight: 1, color: modeColor }}>{modeLabel.slice(0, 4)}</Typography>
              <Typography variant='caption' sx={{ color: 'text.secondary', fontSize: 8 }}>{t('dashboard.widgetDrs.mode')}</Typography>
            </Box>
          </Stack>
        </Stack>
      )}
    </Box>
  )
}

export default React.memo(DrsStatusWidget)
