'use client'

import React from 'react'
import { useTranslations } from 'next-intl'
import { Box, Chip, Typography } from '@mui/material'

function BackupRecentWidget({ data, loading }) {
  const t = useTranslations()
  const pbs = data?.pbs || {}

  function timeAgo(ts) {
    if (!ts) return ''
    const now = Date.now() / 1000
    const diff = Math.floor(now - ts)

    if (diff < 60) return t('time.justNow')
    if (diff < 3600) return t('time.minutesAgo', { count: Math.floor(diff / 60) })
    if (diff < 86400) return t('time.hoursAgo', { count: Math.floor(diff / 3600) })

    return t('time.daysAgo', { count: Math.floor(diff / 86400) })
  }
  const recentErrors = pbs.recentErrors || []
  const backups24h = pbs.backups24h || {}

  // Créer une liste combinée de succès et erreurs
  const items = []
  
  // Ajouter les erreurs récentes
  recentErrors.forEach(err => {
    items.push({
      type: 'error',
      name: err.id || 'Unknown',
      taskType: err.type,
      time: err.time,
      server: err.server,
      status: err.status,
    })
  })

  // Stats globales si pas d'erreurs détaillées
  if (items.length === 0 && backups24h.total > 0) {
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', p: 2 }}>
        <Box sx={{ textAlign: 'center' }}>
          <Typography variant='h4' sx={{ fontWeight: 800, color: backups24h.error > 0 ? '#ff9800' : '#4caf50' }}>
            {backups24h.ok}/{backups24h.total}
          </Typography>
          <Typography variant='caption' sx={{ opacity: 0.6 }}>
            {t('dashboard.widgets.backups')} (24h)
          </Typography>
        </Box>
        
        {backups24h.error > 0 && (
          <Box sx={{ mt: 2, p: 1.5, bgcolor: '#ff980022', borderRadius: 1, textAlign: 'center' }}>
            <Typography variant='body2' sx={{ color: '#ff9800', fontWeight: 700 }}>
              {backups24h.error} {t('jobs.failed').toLowerCase()}
            </Typography>
          </Box>
        )}

        {backups24h.error === 0 && (
          <Box sx={{ mt: 2, p: 1.5, bgcolor: '#4caf5022', borderRadius: 1, textAlign: 'center' }}>
            <Typography variant='body2' sx={{ color: '#4caf50', fontWeight: 700 }}>
              {t('common.success')}
            </Typography>
          </Box>
        )}
      </Box>
    )
  }

  if (items.length === 0) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
        <Typography variant='caption' sx={{ opacity: 0.6 }}>{t('common.noData')}</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ height: '100%', overflow: 'auto', p: 0.5 }}>
      {items.map((item, idx) => (
        <Box 
          key={idx}
          sx={{ 
            py: 0.75,
            borderBottom: idx < items.length - 1 ? '1px solid' : 'none',
            borderColor: 'divider'
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
            <Chip
              size='small'
              label={item.type === 'error' ? t('jobs.failed') : 'OK'}
              color={item.type === 'error' ? 'error' : 'success'}
              sx={{ height: 18, fontSize: 9 }}
            />
            <Typography variant='caption' sx={{ fontWeight: 600, fontSize: 11 }}>
              {item.name}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant='caption' sx={{ opacity: 0.5, fontSize: 9 }}>
              {item.taskType} • {item.server} • {timeAgo(item.time)}
            </Typography>
          </Box>
        </Box>
      ))}
    </Box>
  )
}

export default React.memo(BackupRecentWidget)
