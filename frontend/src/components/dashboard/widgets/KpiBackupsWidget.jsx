'use client'

import React from 'react'

import { useTranslations } from 'next-intl'
import { Box, Typography, useTheme } from '@mui/material'

import { widgetColors } from './themeColors'
import CircularGauge from './CircularGauge'

function KpiBackupsWidget({ data, loading }) {
  const t = useTranslations()
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const c = widgetColors(isDark)
  const pbs = data?.pbs || {}
  const total = pbs.backups24h?.total || 0
  const ok = pbs.backups24h?.ok || 0
  const hasError = pbs.backups24h?.error > 0
  const hasServers = pbs.servers > 0

  const color = hasError ? '#ff9800' : hasServers ? '#4caf50' : '#9e9e9e'

  return (
    <Box
      sx={{
        bgcolor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
        border: '1px solid', borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
        borderRadius: 'var(--proxcenter-card-radius)', p: 1.5, height: '100%',
        display: 'flex', alignItems: 'center', gap: 1.5,
      }}
    >
      <CircularGauge value={ok} max={total || (hasServers ? 1 : 0)} color={color} trackColor={c.surfaceSubtle} size='4em'>
        <Box component='span' sx={{ fontWeight: 800, fontSize: '0.9em', color, lineHeight: 1 }}>{ok}</Box>
        <Box component='span' sx={{ fontSize: '0.45em', opacity: 0.5, fontWeight: 700 }}>/{total}</Box>
      </CircularGauge>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: '0.7143rem', opacity: 0.65, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {t('dashboard.widgets.backups')} PBS (24h)
        </Typography>
        <Typography sx={{ fontSize: '1.2857rem', fontWeight: 800, color, lineHeight: 1.2, fontFamily: '"JetBrains Mono", monospace' }}>
          {total > 0 ? `${ok} / ${total}` : '\u2014'}
        </Typography>
        <Typography sx={{ fontSize: '0.7143rem', opacity: 0.6 }}>
          {hasError ? `${pbs.backups24h.error} ${t('jobs.failed').toLowerCase()}` : hasServers ? `${pbs.servers} PBS` : t('common.noData')}
        </Typography>
      </Box>
    </Box>
  )
}

export default React.memo(KpiBackupsWidget)
