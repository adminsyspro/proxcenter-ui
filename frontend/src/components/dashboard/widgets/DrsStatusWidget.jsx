'use client'

import React from 'react'
import { useTranslations } from 'next-intl'
import { Box, Typography, Chip, CircularProgress, alpha, Stack } from '@mui/material'
import { useLicense, Features } from '@/contexts/LicenseContext'
import { useDRSStatus, useDRSRecommendations } from '@/hooks/useDRS'

function DrsStatusWidget({ data, loading, config }) {
  const t = useTranslations()
  const { isEnterprise } = useLicense()
  const { data: status, isLoading: statusLoading } = useDRSStatus(isEnterprise)
  const { data: recs, isLoading: recsLoading } = useDRSRecommendations(isEnterprise)

  if (!isEnterprise) {
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 2, textAlign: 'center' }}>
        <i className='ri-vip-crown-fill' style={{ fontSize: 32, color: 'var(--mui-palette-warning-main)', marginBottom: 8 }} />
        <Typography variant='caption' sx={{ opacity: 0.6 }}>Enterprise</Typography>
      </Box>
    )
  }

  if (statusLoading) {
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
  const pending = status?.pending_count || 0

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
          {/* Active Migrations */}
          <Box sx={{
            display: 'flex', alignItems: 'center', gap: 1, p: 1, borderRadius: 1,
            bgcolor: (theme) => alpha(theme.palette.primary.main, activeMigrations > 0 ? 0.1 : 0.04),
            border: '1px solid',
            borderColor: (theme) => alpha(theme.palette.primary.main, activeMigrations > 0 ? 0.25 : 0.1)
          }}>
            <Box sx={{
              width: 28, height: 28, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              bgcolor: (theme) => alpha(theme.palette.primary.main, 0.15), flexShrink: 0
            }}>
              <i className='ri-swap-line' style={{ fontSize: 14, color: 'var(--mui-palette-primary-main)' }} />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant='caption' sx={{ color: 'text.secondary', fontSize: 9 }}>
                {t('dashboard.widgetDrs.activeMigrations')}
              </Typography>
              <Typography variant='body2' sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                {activeMigrations}
              </Typography>
            </Box>
          </Box>

          {/* Recommendations */}
          <Box sx={{
            display: 'flex', alignItems: 'center', gap: 1, p: 1, borderRadius: 1,
            bgcolor: (theme) => alpha(theme.palette.warning.main, recommendations > 0 ? 0.1 : 0.04),
            border: '1px solid',
            borderColor: (theme) => alpha(theme.palette.warning.main, recommendations > 0 ? 0.25 : 0.1)
          }}>
            <Box sx={{
              width: 28, height: 28, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              bgcolor: (theme) => alpha(theme.palette.warning.main, 0.15), flexShrink: 0
            }}>
              <i className='ri-lightbulb-line' style={{ fontSize: 14, color: 'var(--mui-palette-warning-main)' }} />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant='caption' sx={{ color: 'text.secondary', fontSize: 9 }}>
                {t('dashboard.widgetDrs.recommendations')}
              </Typography>
              <Typography variant='body2' sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                {recommendations}
              </Typography>
            </Box>
          </Box>

          {/* Mode */}
          <Box sx={{
            display: 'flex', alignItems: 'center', gap: 1, p: 1, borderRadius: 1,
            bgcolor: (theme) => alpha(theme.palette.success.main, 0.04),
            border: '1px solid',
            borderColor: (theme) => alpha(theme.palette.success.main, 0.1)
          }}>
            <Box sx={{
              width: 28, height: 28, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              bgcolor: (theme) => alpha(theme.palette.success.main, 0.15), flexShrink: 0
            }}>
              <i className='ri-settings-3-line' style={{ fontSize: 14, color: 'var(--mui-palette-success-main)' }} />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant='caption' sx={{ color: 'text.secondary', fontSize: 9 }}>
                {t('dashboard.widgetDrs.mode')}
              </Typography>
              <Typography variant='body2' sx={{ fontWeight: 700, lineHeight: 1.2, color: modeColor }}>
                {modeLabel}
              </Typography>
            </Box>
          </Box>
        </Stack>
      )}
    </Box>
  )
}

export default React.memo(DrsStatusWidget)
