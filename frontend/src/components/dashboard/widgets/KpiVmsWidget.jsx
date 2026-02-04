'use client'

import { useTranslations } from 'next-intl'
import { Box, Typography, useTheme } from '@mui/material'

export default function KpiVmsWidget({ data, loading }) {
  const t = useTranslations()
  const theme = useTheme()
  const primaryColor = theme.palette.primary.main
  const summary = data?.summary || {}

  return (
    <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', p: 1 }}>
      <Box sx={{ 
        width: 44, height: 44, borderRadius: 2, 
        bgcolor: `${primaryColor}18`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, mr: 1.5
      }}>
        <i className='ri-computer-line' style={{ fontSize: 22, color: primaryColor }} />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant='caption' sx={{ opacity: 0.6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {t('dashboard.widgets.vms')} ({t('common.active').toLowerCase()} / {t('common.total').toLowerCase()})
        </Typography>
        <Typography variant='h6' sx={{ fontWeight: 800, color: primaryColor, lineHeight: 1.2 }}>
          {summary.vmsRunning || 0} / {summary.vmsTotal || 0}
        </Typography>
        <Typography variant='caption' sx={{ opacity: 0.5 }}>
          CPU {summary.cpuPct || 0}% • RAM {summary.ramPct || 0}%
        </Typography>
      </Box>
    </Box>
  )
}
