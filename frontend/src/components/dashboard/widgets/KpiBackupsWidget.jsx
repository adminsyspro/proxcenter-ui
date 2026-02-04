'use client'

import { useTranslations } from 'next-intl'
import { Box, Typography } from '@mui/material'

export default function KpiBackupsWidget({ data, loading }) {
  const t = useTranslations()
  const pbs = data?.pbs || {}
  const hasError = pbs.backups24h?.error > 0
  const hasServers = pbs.servers > 0

  const color = hasError ? '#ff9800' : hasServers ? '#4caf50' : '#9e9e9e'

  return (
    <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', p: 1 }}>
      <Box sx={{ 
        width: 44, height: 44, borderRadius: 2, 
        bgcolor: `${color}18`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, mr: 1.5
      }}>
        <i className='ri-shield-check-line' style={{ fontSize: 22, color }} />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant='caption' sx={{ opacity: 0.6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {t('dashboard.widgets.backups')} PBS (24h)
        </Typography>
        <Typography variant='h6' sx={{ fontWeight: 800, color, lineHeight: 1.2 }}>
          {pbs.backups24h?.total > 0 ? `${pbs.backups24h?.ok || 0} / ${pbs.backups24h?.total || 0}` : '—'}
        </Typography>
        <Typography variant='caption' sx={{ opacity: 0.5 }}>
          {hasError ? `${pbs.backups24h.error} ${t('jobs.failed').toLowerCase()}` : hasServers ? `${pbs.servers} PBS` : t('common.noData')}
        </Typography>
      </Box>
    </Box>
  )
}
