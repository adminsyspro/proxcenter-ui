'use client'

import { useCallback, useMemo, useState } from 'react'

import { useTranslations } from 'next-intl'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputAdornment,
  MenuItem,
  Select,
  Slider,
  Stack,
  TextField,
  Tooltip,
  Typography
} from '@mui/material'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'

import { usePageTitle } from '@/contexts/PageTitleContext'
import { useChanges } from '@/hooks/useChanges'
import { useSWRFetch } from '@/hooks/useSWRFetch'

import EmptyState from '@/components/EmptyState'
import { CardsSkeleton } from '@/components/skeletons'

/* --------------------------------
   Helpers
-------------------------------- */

function timeAgo(date, t) {
  const now = new Date()
  const past = new Date(date)
  const diff = Math.floor((now - past) / 1000)

  if (diff < 60) return t('changes.aFewSecondsAgo')
  if (diff < 3600) return t('changes.minutesAgo', { count: Math.floor(diff / 60) })
  if (diff < 86400) return t('changes.hoursAgo', { count: Math.floor(diff / 3600) })

  return t('changes.daysAgo', { count: Math.floor(diff / 86400) })
}

function formatTime(date) {
  return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDate(date) {
  return new Date(date).toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}

function getDayKey(date) {
  const d = new Date(date)

  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function isToday(date) {
  const d = new Date(date)
  const now = new Date()

  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

function isYesterday(date) {
  const d = new Date(date)
  const yesterday = new Date()

  yesterday.setDate(yesterday.getDate() - 1)

  return d.getFullYear() === yesterday.getFullYear() && d.getMonth() === yesterday.getMonth() && d.getDate() === yesterday.getDate()
}

function getDayLabel(date, t) {
  if (isToday(date)) return t('changes.today')
  if (isYesterday(date)) return t('changes.yesterday')

  return formatDate(date)
}

/* --------------------------------
   Config
-------------------------------- */

const resourceTypeConfig = {
  vm: { icon: 'ri-computer-line', color: '#4fc3f7', label: 'VM' },
  ct: { icon: 'ri-instance-line', color: '#81c784', label: 'Container' },
  node: { icon: 'ri-server-line', color: '#ffb74d', label: 'Node' },
  storage: { icon: 'ri-database-2-line', color: '#ce93d8', label: 'Storage' },
  pool: { icon: 'ri-stack-line', color: '#90a4ae', label: 'Pool' }
}

const actionConfig = {
  config_changed: { icon: 'ri-settings-3-line', color: 'info', chartColor: '#42a5f5', label: 'changes.actionConfigChanged' },
  hardware_changed: { icon: 'ri-cpu-line', color: 'warning', chartColor: '#ffa726', label: 'changes.actionHardwareChanged' },
  network_changed: { icon: 'ri-wifi-line', color: 'info', chartColor: '#29b6f6', label: 'changes.actionNetworkChanged' },
  snapshot_modified: { icon: 'ri-camera-switch-line', color: 'info', chartColor: '#7e57c2', label: 'changes.actionSnapshotModified' },
  migrated: { icon: 'ri-swap-box-line', color: 'warning', chartColor: '#ff7043', label: 'changes.actionMigrated' },
}

/* --------------------------------
   Stat cards (same style as events page)
-------------------------------- */

function DonutStatCard({ title, value, total, color }) {
  const remainder = Math.max(0, total - value)

  return (
    <Card variant='outlined'>
      <CardContent sx={{ py: 1.5, px: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box sx={{ width: 52, height: 52, flexShrink: 0 }}>
          <ResponsiveContainer width='100%' height='100%'>
            <PieChart>
              <Pie
                data={[{ value: value || 0 }, { value: remainder || 1 }]}
                dataKey='value'
                cx='50%' cy='50%'
                innerRadius={14} outerRadius={24}
                strokeWidth={0}
                startAngle={90} endAngle={-270}
              >
                <Cell fill={color} />
                <Cell fill='rgba(255,255,255,0.08)' />
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </Box>
        <Box>
          <Typography variant='caption' sx={{ opacity: 0.6 }}>{title}</Typography>
          <Typography variant='h5' sx={{ fontWeight: 700 }}>{value}</Typography>
        </Box>
      </CardContent>
    </Card>
  )
}

function DonutTotalCard({ title, value, segments }) {
  const data = segments.filter(s => s.value > 0)

  if (data.length === 0) data.push({ value: 1, color: 'rgba(255,255,255,0.08)' })

  return (
    <Card variant='outlined'>
      <CardContent sx={{ py: 1.5, px: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box sx={{ width: 52, height: 52, flexShrink: 0 }}>
          <ResponsiveContainer width='100%' height='100%'>
            <PieChart>
              <Pie
                data={data}
                dataKey='value'
                cx='50%' cy='50%'
                innerRadius={14} outerRadius={24}
                strokeWidth={0}
                startAngle={90} endAngle={-270}
              >
                {data.map((s, i) => <Cell key={i} fill={s.color} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </Box>
        <Box>
          <Typography variant='caption' sx={{ opacity: 0.6 }}>{title}</Typography>
          <Typography variant='h5' sx={{ fontWeight: 700 }}>{value}</Typography>
        </Box>
      </CardContent>
    </Card>
  )
}

/* --------------------------------
   Timeline components
-------------------------------- */

function FieldDiff({ field }) {
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

function TimelineEntry({ change, t }) {
  const [expanded, setExpanded] = useState(false)
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
              <Chip
                size='small'
                icon={<i className={actConfig.icon} style={{ fontSize: 14 }} />}
                label={t(actConfig.label)}
                color={actConfig.color}
                variant='outlined'
                sx={{ height: 24, fontSize: '0.7rem' }}
              />
              <Typography variant='body2' fontWeight={600}>
                {resConfig.label} {change.resourceId}
              </Typography>
              {change.resourceName && (
                <Typography variant='body2' sx={{ opacity: 0.7 }}>
                  &ldquo;{change.resourceName}&rdquo;
                </Typography>
              )}
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
              <Typography variant='caption' sx={{ opacity: 0.6 }}>
                {change.user}
              </Typography>
              <Typography variant='caption' sx={{ opacity: 0.4 }}>{'\u2022'}</Typography>
              <Typography variant='caption' sx={{ opacity: 0.6 }}>
                {change.node}
              </Typography>
              <Typography variant='caption' sx={{ opacity: 0.4 }}>{'\u2022'}</Typography>
              <Typography variant='caption' sx={{ opacity: 0.6 }}>
                {change.connectionName || change.connectionId}
              </Typography>
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
                <i className={expanded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} style={{ fontSize: 16 }} />
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
              {change.fields.map((field, idx) => (
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
   Page
-------------------------------- */

export default function ChangesPage() {
  const t = useTranslations()

  usePageTitle(t('changes.title'))

  const [resourceType, setResourceType] = useState('')
  const [action, setAction] = useState('')
  const [search, setSearch] = useState('')
  const [purgeOpen, setPurgeOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [purging, setPurging] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [retentionDays, setRetentionDays] = useState(30)

  const { data: response, isLoading, error, mutate } = useChanges({ limit: 300, resourceType: resourceType || undefined, action: action || undefined })
  const { data: settingsData, mutate: mutateSettings } = useSWRFetch('/api/v1/changes/settings')

  const changes = response?.data || []
  const currentRetention = settingsData?.retentionDays || 30

  // Stats
  const stats = useMemo(() => {
    const byType = {}
    const byAction = {}

    for (const c of changes) {
      byType[c.resourceType] = (byType[c.resourceType] || 0) + 1
      byAction[c.action] = (byAction[c.action] || 0) + 1
    }

    return { total: changes.length, byType, byAction }
  }, [changes])

  // Group by day
  const groupedChanges = useMemo(() => {
    let filtered = changes

    if (search) {
      const q = search.toLowerCase()

      filtered = filtered.filter(c =>
        c.resourceId?.toLowerCase().includes(q) ||
        c.resourceName?.toLowerCase().includes(q) ||
        c.node?.toLowerCase().includes(q) ||
        c.user?.toLowerCase().includes(q) ||
        c.connectionName?.toLowerCase().includes(q)
      )
    }

    const groups = []
    let currentDayKey = null
    let currentGroup = null

    for (const change of filtered) {
      const dayKey = getDayKey(change.timestamp)

      if (dayKey !== currentDayKey) {
        currentDayKey = dayKey
        currentGroup = { dayKey, label: getDayLabel(change.timestamp, t), changes: [] }
        groups.push(currentGroup)
      }

      currentGroup.changes.push(change)
    }

    return groups
  }, [changes, search, t])

  const handlePurge = useCallback(async () => {
    setPurging(true)

    try {
      await fetch('/api/v1/changes', { method: 'DELETE' })
      mutate()
      setPurgeOpen(false)
    } catch (e) {
      console.error('Purge failed:', e)
    } finally {
      setPurging(false)
    }
  }, [mutate])

  const handleOpenSettings = useCallback(() => {
    setRetentionDays(currentRetention)
    setSettingsOpen(true)
  }, [currentRetention])

  const handleSaveSettings = useCallback(async () => {
    setSavingSettings(true)

    try {
      await fetch('/api/v1/changes/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retentionDays })
      })
      mutateSettings()
      setSettingsOpen(false)
    } catch (e) {
      console.error('Settings save failed:', e)
    } finally {
      setSavingSettings(false)
    }
  }, [retentionDays, mutateSettings])

  if (isLoading) return <CardsSkeleton count={3} />

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minHeight: 0 }}>
      {/* Header Actions */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, flexShrink: 0 }}>
        <Tooltip title={t('changes.retentionInfo', { days: currentRetention })}>
          <Button
            variant='outlined'
            size='small'
            startIcon={<i className='ri-settings-3-line' />}
            onClick={handleOpenSettings}
          >
            {t('changes.settings')}
          </Button>
        </Tooltip>
        <Button
          variant='outlined'
          size='small'
          color='error'
          startIcon={<i className='ri-delete-bin-line' />}
          onClick={() => setPurgeOpen(true)}
          disabled={stats.total === 0}
        >
          {t('changes.purge')}
        </Button>
        <Button
          variant='outlined'
          size='small'
          startIcon={<i className='ri-refresh-line' />}
          onClick={() => mutate()}
          disabled={isLoading}
        >
          {t('common.refresh')}
        </Button>
      </Box>

      {/* Stats row - same style as events page */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 2, flexShrink: 0 }}>
        <DonutTotalCard
          title={t('changes.totalChanges')}
          value={stats.total}
          segments={Object.entries(stats.byType).map(([key]) => ({
            value: stats.byType[key],
            color: resourceTypeConfig[key]?.color || '#90a4ae'
          }))}
        />
        <DonutStatCard title='VM' value={stats.byType.vm || 0} total={stats.total} color='#4fc3f7' />
        <DonutStatCard title='Container' value={stats.byType.ct || 0} total={stats.total} color='#81c784' />
        <DonutStatCard title={t('changes.actionConfigChanged')} value={stats.byAction.config_changed || 0} total={stats.total} color='#42a5f5' />
      </Box>

      {/* Filters */}
      <Card variant='outlined' sx={{ flexShrink: 0 }}>
        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Stack direction='row' spacing={1.5} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField
              size='small'
              placeholder={t('changes.search')}
              value={search}
              onChange={e => setSearch(e.target.value)}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position='start'>
                      <i className='ri-search-line' style={{ fontSize: 16 }} />
                    </InputAdornment>
                  )
                }
              }}
              sx={{ minWidth: 200 }}
            />
            <FormControl size='small' sx={{ minWidth: 140 }}>
              <Select
                value={resourceType}
                onChange={e => setResourceType(e.target.value)}
                displayEmpty
              >
                <MenuItem value=''>{t('changes.allTypes')}</MenuItem>
                <MenuItem value='vm'>VM</MenuItem>
                <MenuItem value='ct'>Container</MenuItem>
                <MenuItem value='node'>Node</MenuItem>
                <MenuItem value='storage'>Storage</MenuItem>
              </Select>
            </FormControl>
            <FormControl size='small' sx={{ minWidth: 160 }}>
              <Select
                value={action}
                onChange={e => setAction(e.target.value)}
                displayEmpty
              >
                <MenuItem value=''>{t('changes.allActions')}</MenuItem>
                <MenuItem value='config_changed'>{t('changes.actionConfigChanged')}</MenuItem>
                <MenuItem value='hardware_changed'>{t('changes.actionHardwareChanged')}</MenuItem>
                <MenuItem value='network_changed'>{t('changes.actionNetworkChanged')}</MenuItem>
                <MenuItem value='snapshot_modified'>{t('changes.actionSnapshotModified')}</MenuItem>
                <MenuItem value='migrated'>{t('changes.actionMigrated')}</MenuItem>
              </Select>
            </FormControl>
          </Stack>
        </CardContent>
      </Card>

      {/* Error state */}
      {error && (
        <Alert severity='error'>{t('common.error')}</Alert>
      )}

      {/* Timeline */}
      {changes.length === 0 && !isLoading ? (
        <EmptyState
          icon='ri-git-commit-line'
          title={t('changes.emptyTitle')}
          description={t('changes.emptyDescription')}
        />
      ) : (
        <Card variant='outlined' sx={{ flex: 1, overflow: 'auto' }}>
          <CardContent>
            {groupedChanges.map(group => (
              <Box key={group.dayKey}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, mt: 1 }}>
                  <Typography
                    variant='overline'
                    fontWeight={700}
                    sx={{ color: 'text.secondary', letterSpacing: 1.5 }}
                  >
                    {group.label}
                  </Typography>
                  <Box sx={{ flex: 1, height: 1, bgcolor: 'divider' }} />
                  <Chip size='small' label={group.changes.length} sx={{ height: 20, fontSize: '0.65rem' }} />
                </Box>

                {group.changes.map(change => (
                  <TimelineEntry key={change.id} change={change} t={t} />
                ))}
              </Box>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Purge confirmation dialog */}
      <Dialog open={purgeOpen} onClose={() => setPurgeOpen(false)} maxWidth='xs' fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className='ri-delete-bin-line' style={{ color: 'var(--mui-palette-error-main)' }} />
          {t('changes.purgeTitle')}
        </DialogTitle>
        <DialogContent>
          <Typography variant='body2'>
            {t('changes.purgeDescription', { count: stats.total })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPurgeOpen(false)}>{t('common.cancel')}</Button>
          <Button color='error' variant='contained' onClick={handlePurge} disabled={purging}>
            {purging ? t('common.loading') : t('changes.purgeConfirm')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Settings dialog */}
      <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} maxWidth='xs' fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className='ri-settings-3-line' />
          {t('changes.settingsTitle')}
        </DialogTitle>
        <DialogContent>
          <Typography variant='body2' sx={{ mb: 3 }}>
            {t('changes.retentionDescription')}
          </Typography>
          <Typography variant='subtitle2' sx={{ mb: 1 }}>
            {t('changes.retentionDays')}: <strong>{retentionDays}</strong> {t('changes.days')}
          </Typography>
          <Slider
            value={retentionDays}
            onChange={(_, v) => setRetentionDays(v)}
            min={1}
            max={365}
            step={1}
            marks={[
              { value: 7, label: '7d' },
              { value: 30, label: '30d' },
              { value: 90, label: '90d' },
              { value: 180, label: '180d' },
              { value: 365, label: '365d' }
            ]}
            valueLabelDisplay='auto'
            valueLabelFormat={v => `${v}d`}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSettingsOpen(false)}>{t('common.cancel')}</Button>
          <Button variant='contained' onClick={handleSaveSettings} disabled={savingSettings}>
            {savingSettings ? t('common.loading') : t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
