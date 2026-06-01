'use client'

import React from 'react'

import { useTranslations } from 'next-intl'
import { Box, Typography, useTheme } from '@mui/material'

import { widgetColors } from './themeColors'
import CircularGauge from './CircularGauge'

function KpiClustersWidget({ data, loading }) {
  const t = useTranslations()
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const c = widgetColors(isDark)
  const summary = data?.summary || {}
  const hasOffline = summary.nodesOffline > 0
  const color = hasOffline ? '#f44336' : '#4caf50'

  return (
    <Box
      sx={{
        bgcolor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
        border: '1px solid', borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
        borderRadius: 'var(--proxcenter-card-radius)', p: 1.5, height: '100%',
        display: 'flex', alignItems: 'center', gap: 1.5,
      }}
    >
      <CircularGauge value={summary.nodesOnline || summary.nodes || 0} max={summary.nodes || 0} color={color} trackColor={c.surfaceSubtle} size='4em'>
        <Box component='span' sx={{ fontWeight: 800, fontSize: '0.9em', color, lineHeight: 1 }}>{summary.nodesOnline || summary.nodes || 0}</Box>
        <Box component='span' sx={{ fontSize: '0.45em', opacity: 0.5, fontWeight: 700 }}>/{summary.nodes || 0}</Box>
      </CircularGauge>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: '0.7143rem', opacity: 0.65, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {t('inventory.clusters')} / {t('dashboard.widgets.nodes')}
        </Typography>
        <Typography sx={{ fontSize: '1.2857rem', fontWeight: 800, color, lineHeight: 1.2, fontFamily: '"JetBrains Mono", monospace' }}>
          {summary.clusters || 0} / {summary.nodes || 0}
        </Typography>
        <Typography sx={{ fontSize: '0.7143rem', opacity: 0.6 }}>
          {hasOffline ? `${summary.nodesOffline} ${t('common.offline').toLowerCase()}` : t('common.online')}
        </Typography>
      </Box>
    </Box>
  )
}

export default React.memo(KpiClustersWidget)
