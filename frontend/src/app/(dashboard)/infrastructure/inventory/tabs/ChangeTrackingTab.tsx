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
  vm: { icon: 'ri-computer-line', color: '#4fc3f7', label: 'VM' },
  ct: { icon: 'ri-instance-line', color: '#81c784', label: 'Container' },
  node: { icon: 'ri-server-line', color: '#ffb74d', label: 'Node' },
  storage: { icon: 'ri-database-2-line', color: '#ce93d8', label: 'Storage' },
  pool: { icon: 'ri-stack-line', color: '#90a4ae', label: 'Pool' }
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
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
      <Typography
        variant='caption'
        sx={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, minWidth: 100, opacity: 0.8 }}
      >
        {field.field}
      </Typography>
      {field.oldValue && (
        <Chip
          size='small'
          label={field.oldValue}
          sx={{
            height: 20,
            fontSize: '0.65rem',
            fontFamily: 'JetBrains Mono, monospace',
            bgcolor: 'error.main',
            color: 'error.contrastText',
            opacity: 0.8,
            textDecoration: 'line-through',
            maxWidth: 200,
            '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' }
          }}
        />
      )}
      {field.oldValue && field.newValue && (
        <i className='ri-arrow-right-line' style={{ fontSize: 12, opacity: 0.5 }} />
      )}
      {field.newValue && (
        <Chip
          size='small'
          label={field.newValue}
          sx={{
            height: 20,
            fontSize: '0.65rem',
            fontFamily: 'JetBrains Mono, monospace',
            bgcolor: 'success.main',
            color: 'success.contrastText',
            maxWidth: 200,
            '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' }
          }}
        />
      )}
    </Box>
  )
}

function TimelineEntry({ change, t }: { change: any; t: any }) {
  const [expanded, setExpanded] = useState(false)
  const resConfig = resourceTypeConfig[change.resourceType] || resourceTypeConfig.vm
  const actConfig = actionConfig[change.action] || actionConfig.config_changed
  const hasFields = change.fields && change.fields.length > 0

  return (
    <Box sx={{ display: 'flex', gap: 2, position: 'relative' }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pt: 0.5 }}>
        <Box
          sx={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: resConfig.color,
            color: '#fff',
            flexShrink: 0,
            boxShadow: `0 0 0 3px var(--mui-palette-background-paper)`
          }}
        >
          <i className={resConfig.icon} style={{ fontSize: 16 }} />
        </Box>
        <Box sx={{ width: 2, flex: 1, bgcolor: 'divider', mt: 0.5, minHeight: 16 }} />
      </Box>

      <Box sx={{ flex: 1, pb: 2.5, minWidth: 0 }}>
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
              <Chip
                size='small'
                icon={<i className={actConfig.icon} style={{ fontSize: 14 }} />}
                label={t(actConfig.label)}
                color={actConfig.color}
                variant='outlined'
                sx={{ height: 22, fontSize: '0.7rem' }}
              />
              <Typography variant='body2' fontWeight={600} fontSize={13}>
                {resConfig.label} {change.resourceId}
              </Typography>
              {change.resourceName && (
                <Typography variant='body2' sx={{ opacity: 0.7 }} fontSize={13}>
                  &ldquo;{change.resourceName}&rdquo;
                </Typography>
              )}
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25, flexWrap: 'wrap' }}>
              {hasFields && (
                <Typography variant='caption' sx={{ opacity: 0.7 }}>
                  {change.fields.length} {change.fields.length === 1 ? t('changes.fieldChanged') : t('changes.fieldsChanged')}
                </Typography>
              )}
              {hasFields && (
                <Typography variant='caption' sx={{ opacity: 0.4 }}>{'\u2022'}</Typography>
              )}
              <Typography variant='caption' sx={{ opacity: 0.6 }}>
                {change.node}
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
            <Typography variant='caption' sx={{ opacity: 0.5, fontSize: '0.7rem' }}>
              {timeAgo(change.timestamp, t)}
            </Typography>
            <Typography variant='caption' sx={{ fontFamily: 'JetBrains Mono, monospace', opacity: 0.4, fontSize: '0.7rem' }}>
              {formatTime(change.timestamp)}
            </Typography>
            {hasFields && (
              <IconButton size='small' sx={{ opacity: 0.4, p: 0.25 }}>
                <i className={expanded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} style={{ fontSize: 14 }} />
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
