'use client'

import { useTranslations } from 'next-intl'
import { Alert, Box, Chip, List, ListItem, ListItemText, Typography } from '@mui/material'

export default function AlertsListWidget({ data, loading }) {
  const t = useTranslations()
  const alerts = data?.alerts || []

  function timeAgo(date) {
    const now = new Date()
    const past = new Date(date)
    const diff = Math.floor((now - past) / 1000)

    if (diff < 60) return t('time.justNow')
    if (diff < 3600) return t('time.minutesAgo', { count: Math.floor(diff / 60) })
    if (diff < 86400) return t('time.hoursAgo', { count: Math.floor(diff / 3600) })

    return t('time.daysAgo', { count: Math.floor(diff / 86400) })
  }

  if (alerts.length === 0) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
        <Alert severity='success' sx={{ width: '100%' }}>{t('alerts.noActiveAlerts')}</Alert>
      </Box>
    )
  }

  const severityConfig = {
    crit: { label: 'CRIT', color: 'error' },
    warn: { label: 'WARN', color: 'warning' },
    info: { label: 'INFO', color: 'info' },
  }

  return (
    <List dense disablePadding sx={{ height: '100%', overflow: 'auto', p: 0.5 }}>
      {alerts.map((alert, idx) => {
        const cfg = severityConfig[alert.severity] || severityConfig.info

        
return (
          <ListItem key={idx} sx={{ px: 0.5, py: 0.5 }}>
            <ListItemText
              primary={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <Chip 
                    size='small' 
                    label={cfg.label} 
                    color={cfg.color}
                    sx={{ height: 18, fontSize: 9, minWidth: 40 }}
                  />
                  <Typography variant='caption' sx={{ 
                    fontWeight: 600, overflow: 'hidden', 
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 
                  }}>
                    {alert.message}
                  </Typography>
                </Box>
              }
              secondary={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.25 }}>
                  <Typography variant='caption' sx={{ opacity: 0.5, fontSize: 9 }}>
                    {timeAgo(alert.time)}
                  </Typography>
                  <Typography variant='caption' sx={{ opacity: 0.4, fontSize: 9 }}>
                    • {alert.source}
                  </Typography>
                </Box>
              }
            />
          </ListItem>
        )
      })}
    </List>
  )
}
