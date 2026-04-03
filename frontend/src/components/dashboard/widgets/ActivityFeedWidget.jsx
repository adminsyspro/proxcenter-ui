'use client'

import React, { useState } from 'react'

import { useTranslations } from 'next-intl'
import {
  Box, Chip, CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Divider, IconButton, Typography, useTheme
} from '@mui/material'

import { useTaskEvents } from '@/hooks/useTaskEvents'
import { widgetColors } from './themeColors'

// ─── Entity icon with status dot ─────────────────────────────────────────────
function EntityIcon({ isGuest, type, status, taskStatus, isDark }) {
  // Use task status for the dot color (reflects what happened)
  const dotColor = taskStatus === 'running' ? '#3b82f6'
    : taskStatus === 'OK' ? '#4caf50'
    : taskStatus?.includes('WARNINGS') ? '#ff9800'
    : taskStatus && taskStatus !== 'OK' ? '#f44336'
    : status === 'running' ? '#4caf50'
    : '#9e9e9e'

  if (!isGuest) {
    return (
      <Box sx={{ position: 'relative', width: 20, height: 20, flexShrink: 0, mr: 0.25 }}>
        <img src={isDark ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={18} height={18} style={{ opacity: 0.8 }} />
        <Box sx={{ position: 'absolute', bottom: -1, right: -1, width: 9, height: 9, borderRadius: '50%', bgcolor: dotColor, border: '2px solid', borderColor: isDark ? '#1e1e2d' : '#fff' }} />
      </Box>
    )
  }

  const isLxc = type === 'lxc' || type === 'vzcreate' || type === 'vzstart' || type === 'vzstop'
  const icon = isLxc ? 'ri-instance-line' : 'ri-computer-line'

  return (
    <Box sx={{ position: 'relative', width: 20, height: 20, flexShrink: 0, mr: 0.25 }}>
      <i className={icon} style={{ fontSize: 18, opacity: 0.8 }} />
      <Box sx={{ position: 'absolute', bottom: -1, right: -1, width: 9, height: 9, borderRadius: '50%', bgcolor: dotColor, border: '2px solid', borderColor: isDark ? '#1e1e2d' : '#fff' }} />
    </Box>
  )
}

// ─── Detail Dialog ───────────────────────────────────────────────────────────
function NodeLabel({ name, online, isDark }) {
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
      <Box sx={{ position: 'relative', width: 16, height: 16, flexShrink: 0 }}>
        <img src={isDark ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={14} height={14} style={{ opacity: 0.8 }} />
        <Box sx={{ position: 'absolute', bottom: -1, right: -1, width: 7, height: 7, borderRadius: '50%', bgcolor: online !== false ? '#4caf50' : '#f44336', border: '1.5px solid', borderColor: 'background.paper' }} />
      </Box>
      {name}
    </Box>
  )
}

function TaskDetailDialog({ event, open, onClose, t, nodeStatusMap, isDark }) {
  if (!event) return null

  const statusColor = event.status === 'running' ? 'info'
    : event.status === 'OK' ? 'success'
    : event.status?.includes('WARNINGS') ? 'warning'
    : event.level === 'error' ? 'error' : 'success'

  const nodeOnline = nodeStatusMap?.[event.node]

  const rows = [
    { label: t('common.type'), value: event.typeLabel || event.type },
    event.entityName && { label: 'Guest', value: `${event.entityName} (${event.entity})` },
    !event.entityName && event.entity && { label: 'Entity', value: event.entity },
    { label: 'Node', value: <NodeLabel name={event.node} online={nodeOnline} isDark={isDark} /> },
    { label: t('common.status'), value: event.status },
    event.user && { label: t('tasks.detail.user'), value: event.user },
    { label: t('tasks.detail.duration'), value: event.duration },
    event.connectionName && { label: 'Connection', value: event.connectionName },
    event.ts && { label: t('tasks.columns.start'), value: new Date(event.ts).toLocaleString() },
    event.endTs && { label: t('tasks.columns.end'), value: new Date(event.endTs).toLocaleString() },
  ].filter(Boolean)

  return (
    <Dialog open={open} onClose={onClose} maxWidth='xs' fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Chip size='small' label={event.status === 'running' ? t('jobs.running') : event.status} color={statusColor} sx={{ height: 22, fontSize: 11 }} />
          {event.typeLabel || event.type}
        </Box>
        <IconButton size='small' onClick={onClose}>
          <i className='ri-close-line' />
        </IconButton>
      </DialogTitle>
      <Divider />
      <DialogContent sx={{ py: 2 }}>
        {rows.map((row, idx) => (
          <Box key={idx} sx={{ display: 'flex', py: 0.75, borderBottom: idx < rows.length - 1 ? '1px solid' : 'none', borderColor: 'divider' }}>
            <Typography variant='body2' sx={{ fontWeight: 600, width: 110, flexShrink: 0, color: 'text.secondary', fontSize: 13 }}>
              {row.label}
            </Typography>
            <Typography variant='body2' sx={{ fontSize: 13 }}>
              {row.value}
            </Typography>
          </Box>
        ))}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose} size='small'>{t('common.close')}</Button>
      </DialogActions>
    </Dialog>
  )
}

// ─── Main Widget ─────────────────────────────────────────────────────────────
function ActivityFeedWidget({ data, loading, config }) {
  const t = useTranslations()
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const c = widgetColors(isDark)
  const { data: eventsData, isLoading: loadingEvents } = useTaskEvents(20)
  const events = Array.isArray(eventsData?.data) ? eventsData.data : []
  const [selectedEvent, setSelectedEvent] = useState(null)

  // Build node -> online status map
  const nodeStatusMap = {}

  for (const n of (data?.nodes || [])) {
    nodeStatusMap[n.name] = n.status === 'online'
  }

  // Build vmid -> guest info map from dashboard data
  const guestMap = {}

  for (const vm of (data?.vmList || [])) {
    guestMap[String(vm.vmid)] = { name: vm.name, type: 'qemu', status: vm.status }
  }

  for (const lxc of (data?.lxcList || [])) {
    guestMap[String(lxc.vmid)] = { name: lxc.name, type: 'lxc', status: lxc.status }
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

  function timeAgo(ts) {
    if (!ts) return ''
    const now = Date.now() / 1000
    const diff = Math.floor(now - ts)

    if (diff < 60) return t('time.justNow')
    if (diff < 3600) return t('time.minutesAgo', { count: Math.floor(diff / 60) })
    if (diff < 86400) return t('time.hoursAgo', { count: Math.floor(diff / 3600) })
    
return t('time.daysAgo', { count: Math.floor(diff / 86400) })
  }

  function getTaskStatusColor(event) {
    if (event.status === 'running') return '#3b82f6'
    if (event.status === 'OK') return '#4caf50'
    if (event.status?.includes('WARNINGS')) return '#ff9800'
    if (event.level === 'error') return '#f44336'
    
return '#4caf50'
  }

  const darkCard = {
    bgcolor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
    border: '1px solid', borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
    borderRadius: 2.5, p: 1.5,
    transition: 'border-color 0.2s, box-shadow 0.2s',
    '&:hover': { borderColor: c.surfaceActive, boxShadow: isDark ? '0 2px 8px rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.08)' },
  }

  if (loadingEvents) {
    return (
      <Box sx={{ height: '100%', ...darkCard, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress size={24} />
      </Box>
    )
  }

  if (events.length === 0) {
    return (
      <Box sx={{ height: '100%', ...darkCard, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.65 }}>
        <Typography variant='caption'>{t('common.noData')}</Typography>
      </Box>
    )
  }

  return (
    <>
      <Box
        sx={{ height: '100%', ...darkCard, overflow: 'auto' }}
      >
        {events.map((event, idx) => {
          const guest = event.entity ? guestMap[String(event.entity)] : null
          const displayName = event.entityName || guest?.name || null
          const guestType = guest?.type || (event.type?.startsWith('vz') ? 'lxc' : 'qemu')
          const guestStatus = guest?.status || (event.status === 'running' ? 'running' : 'stopped')
          const statusColor = getTaskStatusColor(event)
          const isGuest = event.entity && /^\d+$/.test(String(event.entity))
          const starttime = event.ts ? new Date(event.ts).getTime() / 1000 : event.starttime

          return (
            <Box
              key={idx}
              onClick={() => setSelectedEvent(event)}
              sx={{
                display: 'flex', alignItems: 'center', gap: 0.75,
                px: 0.75, py: 0.6,
                borderBottom: idx < events.length - 1 ? `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}` : 'none',
                cursor: 'pointer',
                '&:hover': { bgcolor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' },
              }}
            >
              {/* Entity icon */}
              <EntityIcon isGuest={isGuest} type={guestType} status={guestStatus} taskStatus={event.status} isDark={isDark} />

              {/* Task label + guest name */}
              <Typography sx={{ fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
                {TASK_LABELS[event.type] || event.type}
                {displayName && (
                  <Typography component='span' sx={{ fontSize: 11, fontWeight: 400, opacity: 0.7, ml: 0.5 }}>
                    {displayName}
                  </Typography>
                )}
                {!displayName && isGuest && (
                  <Typography component='span' sx={{ fontSize: 10, fontWeight: 400, opacity: 0.5, ml: 0.5, fontFamily: '"JetBrains Mono", monospace' }}>
                    #{event.entity}
                  </Typography>
                )}
              </Typography>

              {/* Node */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, flexShrink: 0 }}>
                <img src={isDark ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={10} height={10} style={{ opacity: 0.5 }} />
                <Typography sx={{ fontSize: 9, opacity: 0.5, fontFamily: '"JetBrains Mono", monospace' }}>
                  {event.node}
                </Typography>
              </Box>

              {/* Time ago */}
              <Typography sx={{ fontSize: 9, opacity: 0.5, flexShrink: 0 }}>
                {timeAgo(starttime)}
              </Typography>
            </Box>
          )
        })}
      </Box>

      <TaskDetailDialog
        event={selectedEvent}
        open={!!selectedEvent}
        onClose={() => setSelectedEvent(null)}
        t={t}
        nodeStatusMap={nodeStatusMap}
        isDark={isDark}
      />
    </>
  )
}

export default React.memo(ActivityFeedWidget)
