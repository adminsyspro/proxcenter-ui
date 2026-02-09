'use client'

import React from 'react'

import { useTranslations } from 'next-intl'
import { Alert, Box, Chip, CircularProgress, List, ListItem, ListItemText, Typography } from '@mui/material'
import { useTaskEvents } from '@/hooks/useTaskEvents'

function ActivityFeedWidget({ data, loading, config }) {
  const t = useTranslations()
  const { data: eventsData, isLoading: loadingEvents } = useTaskEvents(20, 30000)
  const events = Array.isArray(eventsData?.data) ? eventsData.data : []

  function timeAgo(ts) {
    if (!ts) return ''
    const now = Date.now() / 1000
    const diff = Math.floor(now - ts)

    if (diff < 60) return t('time.justNow')
    if (diff < 3600) return t('time.minutesAgo', { count: Math.floor(diff / 60) })
    if (diff < 86400) return t('time.hoursAgo', { count: Math.floor(diff / 3600) })

    return t('time.daysAgo', { count: Math.floor(diff / 86400) })
  }

  const TASK_LABELS = {
    'qmstart': t('audit.actions.start') + ' VM',
    'qmstop': t('audit.actions.stop') + ' VM',
    'qmshutdown': 'Shutdown VM',
    'qmreboot': t('audit.actions.restart') + ' VM',
    'qmmigrate': t('audit.actions.migrate') + ' VM',
    'qmclone': t('audit.actions.clone') + ' VM',
    'vzdump': t('audit.actions.backup'),
    'vzcreate': t('audit.actions.create') + ' CT',
    'vzstart': t('audit.actions.start') + ' CT',
    'vzstop': t('audit.actions.stop') + ' CT',
    'pull': 'Sync PBS',
    'verify': t('backups.verified'),
    'garbage_collection': 'GC PBS',
  }

  if (loadingEvents) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress size={24} />
      </Box>
    )
  }

  if (events.length === 0) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
        <Alert severity='info' sx={{ width: '100%' }}>{t('common.noData')}</Alert>
      </Box>
    )
  }

  return (
    <List dense disablePadding sx={{ height: '100%', overflow: 'auto' }}>
      {events.map((event, idx) => {
        const statusColor = event.status === 'running' ? 'info' 
          : event.status === 'OK' ? 'success' 
          : event.status?.includes('WARNINGS') ? 'warning' 
          : event.level === 'error' ? 'error' : 'success'
        
        const statusLabel = event.status === 'running' ? t('jobs.running')
          : event.status === 'OK' ? 'OK'
          : event.status?.includes('WARNINGS') ? t('common.warning')
          : event.level === 'error' ? t('common.error') : 'OK'

        return (
          <ListItem key={idx} sx={{ px: 0.5, py: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}>
            <ListItemText
              primary={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <Chip 
                    size='small' 
                    label={statusLabel}
                    color={statusColor}
                    sx={{ height: 18, fontSize: 9, minWidth: 50 }}
                  />
                  <Typography variant='caption' sx={{ fontWeight: 600, fontSize: 11 }}>
                    {TASK_LABELS[event.type] || event.typeLabel || event.type}
                  </Typography>
                </Box>
              }
              secondary={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.25 }}>
                  {event.entity && (
                    <Typography variant='caption' sx={{ opacity: 0.7, fontSize: 10 }}>
                      {event.entity}
                    </Typography>
                  )}
                  <Typography variant='caption' sx={{ opacity: 0.5, fontSize: 9 }}>
                    {timeAgo(event.starttime || event.ts)} • {event.node}
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

export default React.memo(ActivityFeedWidget)
