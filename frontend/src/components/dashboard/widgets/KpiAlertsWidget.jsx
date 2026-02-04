'use client'

import { useTranslations } from 'next-intl'
import { Box, Typography } from '@mui/material'

export default function KpiAlertsWidget({ data, loading }) {
  const t = useTranslations()
  const alertsSummary = data?.alertsSummary || {}
  const hasCrit = alertsSummary.crit > 0
  const hasWarn = alertsSummary.warn > 0

  const color = hasCrit ? '#f44336' : hasWarn ? '#ff9800' : '#4caf50'
  const value = hasCrit ? `${alertsSummary.crit} crit` : hasWarn ? `${alertsSummary.warn} warn` : 'OK'

  return (
    <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', p: 1 }}>
      <Box sx={{ 
        width: 44, height: 44, borderRadius: 2, 
        bgcolor: `${color}18`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, mr: 1.5
      }}>
        <i className='ri-alarm-warning-line' style={{ fontSize: 22, color }} />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant='caption' sx={{ opacity: 0.6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {t('dashboard.widgets.alerts')}
        </Typography>
        <Typography variant='h6' sx={{ fontWeight: 800, color, lineHeight: 1.2 }}>
          {value}
        </Typography>
        <Typography variant='caption' sx={{ opacity: 0.5 }}>
          {hasCrit || hasWarn ? `${alertsSummary.crit || 0} ${t('alerts.critical')} • ${alertsSummary.warn || 0} ${t('alerts.warning')}` : t('alerts.noActiveAlerts')}
        </Typography>
      </Box>
    </Box>
  )
}
