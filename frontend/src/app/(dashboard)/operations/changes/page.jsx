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
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts'

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
  created: { icon: 'ri-add-circle-line', color: 'success', chartColor: '#66bb6a', label: 'changes.actionCreated' },
  deleted: { icon: 'ri-delete-bin-line', color: 'error', chartColor: '#ef5350', label: 'changes.actionDeleted' },
  migrated: { icon: 'ri-swap-box-line', color: 'warning', chartColor: '#ffa726', label: 'changes.actionMigrated' },
  started: { icon: 'ri-play-circle-line', color: 'success', chartColor: '#26a69a', label: 'changes.actionStarted' },
  stopped: { icon: 'ri-stop-circle-line', color: 'error', chartColor: '#ec407a', label: 'changes.actionStopped' }
}

const RESOURCE_COLORS = ['#4fc3f7', '#81c784', '#ffb74d', '#ce93d8', '#90a4ae']

/* --------------------------------
   Components
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
        {/* Header */}
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

        {/* Expandable field diffs */}
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

function CustomPieTooltip({ active, payload }) {
  if (!active || !payload?.length) return null

  const { name, value, fill } = payload[0]

  return (
    <Box sx={{ bgcolor: 'background.paper', px: 1.5, py: 0.75, borderRadius: 1, boxShadow: 2, border: 1, borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: fill }} />
        <Typography variant='caption' fontWeight={600}>{name}</Typography>
        <Typography variant='caption' sx={{ opacity: 0.6 }}>{value}</Typography>
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

  // Filters
  const [resourceType, setResourceType] = useState('')
  const [action, setAction] = useState('')
  const [search, setSearch] = useState('')

  // Dialogs
  const [purgeOpen, setPurgeOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [purging, setPurging] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [retentionDays, setRetentionDays] = useState(30)

  const { data: response, isLoading, error, mutate } = useChanges({ limit: 300, resourceType: resourceType || undefined, action: action || undefined })
  const { data: settingsData, mutate: mutateSettings } = useSWRFetch('/api/v1/changes/settings')

  const changes = response?.data || []

  // Load retention from settings
  const currentRetention = settingsData?.retentionDays || 30

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

  // Stats for pie charts
  const { byTypePie, byActionPie, total } = useMemo(() => {
    const byType = {}
    const byAction = {}

    for (const c of changes) {
      byType[c.resourceType] = (byType[c.resourceType] || 0) + 1
      byAction[c.action] = (byAction[c.action] || 0) + 1
    }

    const byTypePie = Object.entries(byType).map(([key, value], i) => ({
      name: resourceTypeConfig[key]?.label || key,
      value,
      fill: resourceTypeConfig[key]?.color || RESOURCE_COLORS[i % RESOURCE_COLORS.length]
    }))

    const byActionPie = Object.entries(byAction).map(([key, value]) => ({
      name: t(actionConfig[key]?.label || key),
      value,
      fill: actionConfig[key]?.chartColor || '#90a4ae'
    }))

    return { byTypePie, byActionPie, total: changes.length }
  }, [changes, t])

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
    <Stack spacing={3}>
      {/* Stats row: pie chart + summary */}
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        {/* Main stat card with pie charts */}
        <Card sx={{ flex: 2, minWidth: 300 }}>
          <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Box>
                <Typography variant='caption' sx={{ opacity: 0.6 }}>{t('changes.totalChanges')}</Typography>
                <Typography variant='h4' fontWeight={700}>{total}</Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Tooltip title={t('changes.settings')}>
                  <IconButton size='small' onClick={handleOpenSettings}>
                    <i className='ri-settings-3-line' style={{ fontSize: 18 }} />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t('changes.purge')}>
                  <IconButton size='small' color='error' onClick={() => setPurgeOpen(true)} disabled={total === 0}>
                    <i className='ri-delete-bin-line' style={{ fontSize: 18 }} />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>

            {total > 0 && (
              <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
                {/* By resource type */}
                <Box sx={{ flex: 1, textAlign: 'center' }}>
                  <Typography variant='caption' sx={{ opacity: 0.5, mb: 1, display: 'block' }}>
                    {t('changes.byResourceType')}
                  </Typography>
                  <ResponsiveContainer width='100%' height={120}>
                    <PieChart>
                      <Pie
                        data={byTypePie}
                        cx='50%'
                        cy='50%'
                        innerRadius={30}
                        outerRadius={50}
                        paddingAngle={2}
                        dataKey='value'
                        stroke='none'
                      >
                        {byTypePie.map((entry, i) => (
                          <Cell key={i} fill={entry.fill} />
                        ))}
                      </Pie>
                      <RechartsTooltip content={<CustomPieTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center', flexWrap: 'wrap', mt: 0.5 }}>
                    {byTypePie.map(entry => (
                      <Box key={entry.name} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.fill }} />
                        <Typography variant='caption' sx={{ opacity: 0.7 }}>
                          {entry.name} ({entry.value})
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                </Box>

                {/* By action type */}
                <Box sx={{ flex: 1, textAlign: 'center' }}>
                  <Typography variant='caption' sx={{ opacity: 0.5, mb: 1, display: 'block' }}>
                    {t('changes.byAction')}
                  </Typography>
                  <ResponsiveContainer width='100%' height={120}>
                    <PieChart>
                      <Pie
                        data={byActionPie}
                        cx='50%'
                        cy='50%'
                        innerRadius={30}
                        outerRadius={50}
                        paddingAngle={2}
                        dataKey='value'
                        stroke='none'
                      >
                        {byActionPie.map((entry, i) => (
                          <Cell key={i} fill={entry.fill} />
                        ))}
                      </Pie>
                      <RechartsTooltip content={<CustomPieTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center', flexWrap: 'wrap', mt: 0.5 }}>
                    {byActionPie.map(entry => (
                      <Box key={entry.name} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.fill }} />
                        <Typography variant='caption' sx={{ opacity: 0.7 }}>
                          {entry.name} ({entry.value})
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                </Box>
              </Box>
            )}

            <Typography variant='caption' sx={{ opacity: 0.4, display: 'block', mt: 1.5 }}>
              {t('changes.retentionInfo', { days: currentRetention })}
            </Typography>
          </CardContent>
        </Card>
      </Box>

      {/* Filters */}
      <Card>
        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
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
                <MenuItem value='created'>{t('changes.actionCreated')}</MenuItem>
                <MenuItem value='deleted'>{t('changes.actionDeleted')}</MenuItem>
                <MenuItem value='migrated'>{t('changes.actionMigrated')}</MenuItem>
              </Select>
            </FormControl>
          </Box>
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
        <Card>
          <CardContent>
            {groupedChanges.map(group => (
              <Box key={group.dayKey}>
                {/* Day separator */}
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

                {/* Changes in this day */}
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
            {t('changes.purgeDescription', { count: total })}
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
    </Stack>
  )
}
