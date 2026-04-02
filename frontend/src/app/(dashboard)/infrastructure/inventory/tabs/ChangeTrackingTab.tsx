'use client'

import { useState } from 'react'

import { useTranslations } from 'next-intl'

import { Box, Chip, Collapse, IconButton, Typography } from '@mui/material'

import { useChanges } from '@/hooks/useChanges'
import EmptyState from '@/components/EmptyState'
import { CardsSkeleton } from '@/components/skeletons'

/* --------------------------------
   Helpers
-------------------------------- */

function timeAgo(date: string, t: any) {
  const now = new Date()
  const past = new Date(date)
  const diff = Math.floor((now.getTime() - past.getTime()) / 1000)

  if (diff < 60) return t('changes.aFewSecondsAgo')
  if (diff < 3600) return t('changes.minutesAgo', { count: Math.floor(diff / 60) })
  if (diff < 86400) return t('changes.hoursAgo', { count: Math.floor(diff / 3600) })

  return t('changes.daysAgo', { count: Math.floor(diff / 86400) })
}

function formatTime(date: string) {
  return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDate(date: string) {
  return new Date(date).toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}

function getDayKey(date: string) {
  const d = new Date(date)

  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function getDayLabel(date: string, t: any) {
  const d = new Date(date)
  const now = new Date()

  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) {
    return t('changes.today')
  }

  const yesterday = new Date()

  yesterday.setDate(yesterday.getDate() - 1)

  if (d.getFullYear() === yesterday.getFullYear() && d.getMonth() === yesterday.getMonth() && d.getDate() === yesterday.getDate()) {
    return t('changes.yesterday')
  }

  return formatDate(date)
}

/* --------------------------------
   Config
-------------------------------- */

const resourceTypeConfig: Record<string, { icon: string; color: string; label: string }> = {
  vm: { icon: 'ri-computer-line', color: 'var(--mui-palette-primary-main)', label: 'VM' },
  ct: { icon: 'ri-instance-line', color: 'var(--mui-palette-success-main)', label: 'Container' },
  node: { icon: 'ri-server-line', color: 'var(--mui-palette-warning-main)', label: 'Node' },
  storage: { icon: 'ri-database-2-line', color: 'var(--mui-palette-secondary-main)', label: 'Storage' },
  pool: { icon: 'ri-stack-line', color: 'var(--mui-palette-text-secondary)', label: 'Pool' }
}

const actionConfig: Record<string, { icon: string; color: 'info' | 'success' | 'error' | 'warning'; label: string }> = {
  config_changed: { icon: 'ri-settings-3-line', color: 'info', label: 'changes.actionConfigChanged' },
  hardware_changed: { icon: 'ri-cpu-line', color: 'warning', label: 'changes.actionHardwareChanged' },
  network_changed: { icon: 'ri-wifi-line', color: 'info', label: 'changes.actionNetworkChanged' },
  snapshot_created: { icon: 'ri-camera-line', color: 'success', label: 'changes.actionSnapshotCreated' },
  snapshot_deleted: { icon: 'ri-camera-off-line', color: 'error', label: 'changes.actionSnapshotDeleted' },
  snapshot_modified: { icon: 'ri-camera-switch-line', color: 'info', label: 'changes.actionSnapshotModified' },
  migrated: { icon: 'ri-swap-box-line', color: 'warning', label: 'changes.actionMigrated' },
}

/* --------------------------------
   Sub-components
-------------------------------- */

function FieldDiff({ field }: { field: any }) {
  return (
    <Box sx={{ py: 0.5 }}>
      <Typography
        variant='caption'
        sx={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, opacity: 0.8, display: 'block', mb: 0.25 }}
      >
        {field.field}
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, pl: 1 }}>
        {field.oldValue && (
          <Box sx={{
            px: 1, py: 0.25, borderRadius: 0.5,
            bgcolor: (theme: any) => theme.palette.mode === 'dark' ? 'rgba(244,67,54,0.15)' : 'rgba(244,67,54,0.1)',
            color: (theme: any) => theme.palette.mode === 'dark' ? '#ef9a9a' : '#c62828',
            fontFamily: 'JetBrains Mono, monospace', fontSize: '0.7rem',
            textDecoration: 'line-through', wordBreak: 'break-all', whiteSpace: 'pre-wrap',
          }}>
            {field.oldValue}
          </Box>
        )}
        {field.newValue && (
          <Box sx={{
            px: 1, py: 0.25, borderRadius: 0.5,
            bgcolor: (theme: any) => theme.palette.mode === 'dark' ? 'rgba(76,175,80,0.15)' : 'rgba(76,175,80,0.1)',
            color: (theme: any) => theme.palette.mode === 'dark' ? '#a5d6a7' : '#2e7d32',
            fontFamily: 'JetBrains Mono, monospace', fontSize: '0.7rem',
            wordBreak: 'break-all', whiteSpace: 'pre-wrap',
          }}>
            {field.newValue}
          </Box>
        )}
      </Box>
    </Box>
  )
}

function TimelineEntry({ change, t }: { change: any; t: any }) {
  const autoExpand = change.fields && change.fields.length > 0 && change.fields.length <= 3
  const [expanded, setExpanded] = useState(autoExpand)
  const resConfig = resourceTypeConfig[change.resourceType] || resourceTypeConfig.vm
  const actConfig = actionConfig[change.action] || actionConfig.config_changed
  const hasFields = change.fields && change.fields.length > 0

  return (
    <Box sx={{ display: 'flex', gap: 2, position: 'relative' }}>
      {/* Timeline dot + connector */}
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pt: 0.5 }}>
        <Box
          sx={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: resConfig.color,
            color: '#fff',
            flexShrink: 0,
            boxShadow: `0 0 0 4px var(--mui-palette-background-paper)`
          }}
        >
          <i className={resConfig.icon} style={{ fontSize: 18 }} />
        </Box>
        <Box sx={{ width: 2, flex: 1, bgcolor: 'divider', mt: 0.5, minHeight: 20 }} />
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, pb: 3, minWidth: 0 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 1,
            cursor: hasFields ? 'pointer' : 'default',
            '&:hover': hasFields ? { opacity: 0.85 } : {}
          }}
          onClick={() => hasFields && setExpanded(!expanded)}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              {(change.resourceType === 'vm' || change.resourceType === 'ct') ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <Box sx={{ position: 'relative', display: 'inline-flex', width: 16, height: 16, flexShrink: 0 }}>
                    <i className={change.resourceType === 'ct' ? 'ri-instance-fill' : 'ri-computer-fill'} style={{ fontSize: 16, opacity: 0.7 }} />
                    <Box sx={{ position: 'absolute', bottom: -1, right: -2, width: 7, height: 7, borderRadius: '50%', bgcolor: '#4caf50', border: '1.5px solid', borderColor: 'background.paper' }} />
                  </Box>
                  <Typography variant='body2' fontWeight={600}>
                    {change.resourceName || `${resConfig.label} ${change.resourceId}`}
                  </Typography>
                </Box>
              ) : (
                <Typography variant='body2' fontWeight={600}>
                  {change.resourceName || `${resConfig.label} ${change.resourceId}`}
                </Typography>
              )}
              <Chip
                size='small'
                icon={<i className={actConfig.icon} style={{ fontSize: 14 }} />}
                label={t(actConfig.label)}
                color={actConfig.color}
                variant='outlined'
                sx={{ height: 24, fontSize: '0.7rem' }}
              />
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5, flexWrap: 'wrap' }}>
              {hasFields && (
                <Typography variant='caption' sx={{ opacity: 0.7 }}>
                  {change.fields.length} {change.fields.length === 1 ? t('changes.fieldChanged') : t('changes.fieldsChanged')}
                </Typography>
              )}
              {hasFields && (
                <Typography variant='caption' sx={{ opacity: 0.4 }}>{'\u2022'}</Typography>
              )}
              {change.user && (
                <>
                  <Typography variant='caption' sx={{ opacity: 0.6 }}>
                    {change.user}
                  </Typography>
                  <Typography variant='caption' sx={{ opacity: 0.4 }}>{'\u2022'}</Typography>
                </>
              )}
              <Typography variant='caption' sx={{ opacity: 0.6 }}>
                {change.node}
              </Typography>
              {change.connectionName && (
                <>
                  <Typography variant='caption' sx={{ opacity: 0.4 }}>{'\u2022'}</Typography>
                  <Typography variant='caption' sx={{ opacity: 0.6 }}>
                    {change.connectionName || change.connectionId}
                  </Typography>
                </>
              )}
            </Box>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
            <Typography variant='caption' sx={{ opacity: 0.5 }}>
              {timeAgo(change.timestamp, t)}
            </Typography>
            <Typography variant='caption' sx={{ fontFamily: 'JetBrains Mono, monospace', opacity: 0.4 }}>
              {formatTime(change.timestamp)}
            </Typography>
            {hasFields && (
              <IconButton size='small' sx={{ opacity: 0.4 }}>
                <i className={expanded ? 'ri-subtract-line' : 'ri-add-line'} style={{ fontSize: 16 }} />
              </IconButton>
            )}
          </Box>
        </Box>

        {hasFields && (
          <Collapse in={expanded}>
            <Box
              sx={{
                mt: 1,
                p: 1.5,
                bgcolor: 'action.hover',
                borderRadius: 1,
                border: 1,
                borderColor: 'divider'
              }}
            >
              {change.fields.map((field: any, idx: number) => (
                <FieldDiff key={idx} field={field} />
              ))}
            </Box>
          </Collapse>
        )}
      </Box>
    </Box>
  )
}

/* --------------------------------
   Main component
-------------------------------- */

interface ChangeTrackingTabProps {
  connectionId: string
  resourceType?: string   // 'vm' | 'ct' | 'node'
  resourceId?: string     // e.g. "100" for a VM
  node?: string           // node name filter
}

export default function ChangeTrackingTab({ connectionId, resourceType, resourceId, node }: ChangeTrackingTabProps) {
  const t = useTranslations()
  const { data, isLoading } = useChanges({
    limit: 100,
    connectionId,
    resourceType,
    resourceId,
    node
  })

  const changes = data?.data || []

  if (isLoading) return <CardsSkeleton count={3} />

  if (changes.length === 0) {
    return (
      <EmptyState
        icon='ri-git-commit-line'
        title={t('changes.noChanges')}
        description={t('changes.noChangesDescription')}
      />
    )
  }

  // Group by day
  const grouped: Record<string, any[]> = {}

  for (const change of changes) {
    const key = getDayKey(change.timestamp)

    if (!grouped[key]) grouped[key] = []
    grouped[key].push(change)
  }

  return (
    <Box sx={{ p: 2 }}>
      {Object.entries(grouped).map(([dayKey, dayChanges]) => (
        <Box key={dayKey}>
          <Typography
            variant='caption'
            fontWeight={700}
            sx={{
              display: 'block',
              mb: 1.5,
              mt: 1,
              opacity: 0.5,
              textTransform: 'uppercase',
              letterSpacing: 0.5
            }}
          >
            {getDayLabel(dayChanges[0].timestamp, t)}
          </Typography>
          {dayChanges.map((change: any) => (
            <TimelineEntry key={change.id} change={change} t={t} />
          ))}
        </Box>
      ))}
    </Box>
  )
}
