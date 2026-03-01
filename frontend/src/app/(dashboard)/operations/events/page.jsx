'use client'

import { useEffect, useMemo, useState } from 'react'

import { useTranslations } from 'next-intl'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  FormControl,
  InputAdornment,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'

import { usePageTitle } from '@/contexts/PageTitleContext'
import { useLicense } from '@/contexts/LicenseContext'
import { useSWRFetch } from '@/hooks/useSWRFetch'

import TaskDetailDialog from '@/components/TaskDetailDialog'
import EmptyState from '@/components/EmptyState'
import { CardsSkeleton, TableSkeleton } from '@/components/skeletons'

/* --------------------------------
   Helpers
-------------------------------- */

function timeAgo(date, t) {
  const now = new Date()
  const past = new Date(date)
  const diff = Math.floor((now - past) / 1000)

  if (diff < 60) return t('eventsPage.aFewSecondsAgo')
  if (diff < 3600) return t('eventsPage.minutesAgo', { count: Math.floor(diff / 60) })
  if (diff < 86400) return t('eventsPage.hoursAgo', { count: Math.floor(diff / 3600) })

return t('eventsPage.daysAgo', { count: Math.floor(diff / 86400) })
}

/* --------------------------------
   Components
-------------------------------- */

function LevelChip({ level, t }) {
  const config = {
    error: { label: t('eventsPage.levelError'), color: 'error' },
    warning: { label: t('eventsPage.levelWarning'), color: 'warning' },
    info: { label: t('eventsPage.levelInfo'), color: 'info' }
  }

  const cfg = config[level] || config.info


return <Chip size='small' label={cfg.label} color={cfg.color} sx={{ minWidth: 70 }} />
}

function StatusChip({ status, t }) {
  if (!status) return null

  if (status === 'running') {
    return <Chip size='small' label={t('eventsPage.statusRunning')} color='primary' variant='outlined' />
  }

  if (status === 'OK') {
    return <Chip size='small' label={t('eventsPage.statusOk')} color='success' variant='outlined' />
  }

  if (status.includes('WARNINGS')) {
    return <Chip size='small' label={t('eventsPage.statusWarnings')} color='warning' variant='outlined' />
  }


return <Chip size='small' label={t('eventsPage.statusFailed')} color='error' variant='outlined' />
}

function CategoryChip({ category, t }) {
  const config = {
    task: { label: t('eventsPage.categoryTask'), icon: 'ri-play-circle-line', color: 'primary' },
    log: { label: t('eventsPage.categoryLog'), icon: 'ri-file-text-line', color: 'default' }
  }

  const cfg = config[category] || config.log


return (
    <Chip
      size='small'
      label={cfg.label}
      color={cfg.color}
      variant='outlined'
      icon={<i className={cfg.icon} style={{ fontSize: 14 }} />}
    />
  )
}

function StatCard({ title, value, color, icon }) {
  return (
    <Card variant='outlined' sx={{ height: '100%' }}>
      <CardContent sx={{ py: 1.5, px: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: 2,
              bgcolor: color ? `${color}.main` : 'action.hover',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: 0.8
            }}
          >
            <i className={icon} style={{ fontSize: 20, color: '#fff' }} />
          </Box>
          <Box>
            <Typography variant='h5' sx={{ fontWeight: 700, lineHeight: 1.2 }}>
              {value}
            </Typography>
            <Typography variant='caption' sx={{ opacity: 0.6 }}>
              {title}
            </Typography>
          </Box>
        </Box>
      </CardContent>
    </Card>
  )
}

/* --------------------------------
   Page
-------------------------------- */

export default function EventsPage() {
  const t = useTranslations()
  const { isEnterprise } = useLicense()

  const { setPageInfo } = usePageTitle()

  // SWR data fetching with 30s polling
  const { data: eventsResponse, error, isLoading, mutate } = useSWRFetch('/api/v1/events?limit=500', {
    refreshInterval: 30000,
    onSuccess: (json) => {
      // Envoyer les événements à l'orchestrator pour analyse (alertes sur événements)
      // Seulement en mode Enterprise
      const eventsData = Array.isArray(json?.data) ? json.data : []
      if (isEnterprise && eventsData.length > 0) {
        fetch('/api/v1/orchestrator/alerts/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(eventsData)
        }).catch(err => {
          // Silencieux si l'orchestrator n'est pas disponible
          console.debug('Event processing skipped:', err.message)
        })
      }
    }
  })

  const events = useMemo(() => {
    return Array.isArray(eventsResponse?.data) ? eventsResponse.data : []
  }, [eventsResponse])
  const loading = isLoading

  useEffect(() => {
    setPageInfo(t('events.title'), t('events.title'), 'ri-calendar-event-line')

return () => setPageInfo('', '', '')
  }, [setPageInfo, t])

  // Filtres
  const [q, setQ] = useState('')
  const [levelFilter, setLevelFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [connectionFilter, setConnectionFilter] = useState('all')

  // Task detail dialog
  const [selectedTask, setSelectedTask] = useState(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  // Liste des connexions uniques
  const connections = useMemo(() => {
    const names = new Set(events.map(e => e.connectionName).filter(Boolean))


return ['all', ...Array.from(names)]
  }, [events])

  // Filtrage
  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase()


return events.filter(e => {
      const matchQ =
        !qq ||
        e.message?.toLowerCase().includes(qq) ||
        e.node?.toLowerCase().includes(qq) ||
        e.entity?.toLowerCase().includes(qq) ||
        e.user?.toLowerCase().includes(qq) ||
        e.typeLabel?.toLowerCase().includes(qq)

      const matchLevel = levelFilter === 'all' || e.level === levelFilter
      const matchCategory = categoryFilter === 'all' || e.category === categoryFilter
      const matchConnection = connectionFilter === 'all' || e.connectionName === connectionFilter


return matchQ && matchLevel && matchCategory && matchConnection
    })
  }, [events, q, levelFilter, categoryFilter, connectionFilter])

  // Stats
  const stats = useMemo(() => {
    const total = filtered.length
    const errors = filtered.filter(e => e.level === 'error').length
    const warnings = filtered.filter(e => e.level === 'warning').length
    const running = filtered.filter(e => e.status === 'running').length


return { total, errors, warnings, running }
  }, [filtered])

  // Handle double-click on row
  const handleRowDoubleClick = (params) => {
    const event = params.row


    // Only open dialog for tasks (not logs)
    if (event.category === 'task') {
      setSelectedTask(event)
      setDialogOpen(true)
    }
  }

  // Close dialog
  const handleCloseDialog = () => {
    setDialogOpen(false)

    // Keep selectedTask for animation, clear after dialog closes
    setTimeout(() => setSelectedTask(null), 300)
  }

  // Colonnes
  const columns = useMemo(
    () => [
      {
        field: 'ts',
        headerName: t('eventsPage.columnDate'),
        width: 120,
        renderCell: params => (
          <Tooltip title={new Date(params.row.ts).toLocaleString()}>
            <Typography variant='body2' sx={{ fontSize: 13 }}>
              {timeAgo(params.row.ts, t)}
            </Typography>
          </Tooltip>
        )
      },
      {
        field: 'level',
        headerName: t('eventsPage.columnLevel'),
        width: 100,
        renderCell: params => <LevelChip level={params.row.level} t={t} />
      },
      {
        field: 'category',
        headerName: t('eventsPage.columnType'),
        width: 100,
        renderCell: params => <CategoryChip category={params.row.category} t={t} />
      },
      {
        field: 'typeLabel',
        headerName: t('eventsPage.columnAction'),
        width: 160,
        renderCell: params => (
          <Typography variant='body2' sx={{ fontWeight: 500 }}>
            {params.row.typeLabel || params.row.type}
          </Typography>
        )
      },
      {
        field: 'entity',
        headerName: t('eventsPage.columnEntity'),
        width: 120,
        renderCell: params => (
          <Typography variant='body2' sx={{ opacity: 0.8 }}>
            {params.row.entity || '—'}
          </Typography>
        )
      },
      {
        field: 'node',
        headerName: t('eventsPage.columnNode'),
        width: 150,
        renderCell: params => (
          <Typography variant='body2' sx={{ opacity: 0.8 }}>
            {params.row.node}
          </Typography>
        )
      },
      {
        field: 'status',
        headerName: t('eventsPage.columnStatus'),
        width: 110,
        renderCell: params => <StatusChip status={params.row.status} t={t} />
      },
      {
        field: 'duration',
        headerName: t('eventsPage.columnDuration'),
        width: 80,
        renderCell: params =>
          params.row.duration ? (
            <Typography variant='body2' sx={{ opacity: 0.7 }}>
              {params.row.duration}
            </Typography>
          ) : null
      },
      {
        field: 'user',
        headerName: t('eventsPage.columnUser'),
        width: 140,
        renderCell: params => (
          <Typography variant='body2' sx={{ opacity: 0.7 }}>
            {params.row.user || '—'}
          </Typography>
        )
      },
      {
        field: 'message',
        headerName: t('eventsPage.columnMessage'),
        flex: 1,
        minWidth: 250,
        renderCell: params => (
          <Tooltip title={params.row.message}>
            <Typography
              variant='body2'
              sx={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {params.row.message}
            </Typography>
          </Tooltip>
        )
      }
    ],
    [t]
  )

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minHeight: 0 }}>
      {/* Header Actions */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2, flexShrink: 0 }}>
        <Button
          variant='outlined'
          size='small'
          startIcon={<i className='ri-refresh-line' />}
          onClick={() => mutate()}
          disabled={loading}
        >
          {t('common.refresh')}
        </Button>
      </Box>

      {/* Stats */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 2, flexShrink: 0 }}>
        <StatCard title={t('common.total')} value={stats.total} icon='ri-list-check' color='primary' />
        <StatCard title={t('jobs.running')} value={stats.running} icon='ri-loader-4-line' color='info' />
        <StatCard title={t('alerts.warnings')} value={stats.warnings} icon='ri-alert-line' color='warning' />
        <StatCard title={t('common.error')} value={stats.errors} icon='ri-error-warning-line' color='error' />
      </Box>

      {/* Filtres + Table */}
      <Card variant='outlined' sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        <CardContent sx={{ pb: 0, flexShrink: 0 }}>
          <Stack direction='row' spacing={1.5} sx={{ flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
            <TextField
              size='small'
              placeholder={t('common.search')}
              value={q}
              onChange={e => setQ(e.target.value)}
              sx={{ minWidth: 200 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position='start'>
                    <i className='ri-search-line' />
                  </InputAdornment>
                )
              }}
            />

            <FormControl size='small' sx={{ minWidth: 120 }}>
              <Select value={levelFilter} onChange={e => setLevelFilter(e.target.value)}>
                <MenuItem value='all'>{t('eventsPage.allLevels')}</MenuItem>
                <MenuItem value='error'>{t('eventsPage.levelError')}</MenuItem>
                <MenuItem value='warning'>{t('eventsPage.levelWarning')}</MenuItem>
                <MenuItem value='info'>{t('eventsPage.levelInfo')}</MenuItem>
              </Select>
            </FormControl>

            <FormControl size='small' sx={{ minWidth: 120 }}>
              <Select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
                <MenuItem value='all'>{t('eventsPage.allTypes')}</MenuItem>
                <MenuItem value='task'>{t('eventsPage.tasks')}</MenuItem>
                <MenuItem value='log'>{t('eventsPage.logs')}</MenuItem>
              </Select>
            </FormControl>

            <FormControl size='small' sx={{ minWidth: 160 }}>
              <Select value={connectionFilter} onChange={e => setConnectionFilter(e.target.value)}>
                <MenuItem value='all'>{t('eventsPage.allConnections')}</MenuItem>
                {connections
                  .filter(c => c !== 'all')
                  .map(c => (
                    <MenuItem key={c} value={c}>
                      {c}
                    </MenuItem>
                  ))}
              </Select>
            </FormControl>

            <Button
              variant='outlined'
              size='small'
              onClick={() => {
                setQ('')
                setLevelFilter('all')
                setCategoryFilter('all')
                setConnectionFilter('all')
              }}
            >
              {t('common.reset')}
            </Button>

            <Typography variant='body2' sx={{ ml: 'auto', opacity: 0.6 }}>
              {t('eventsPage.eventsCount', { count: filtered.length })}
            </Typography>
          </Stack>
        </CardContent>

        <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
          {error ? (
            <Box sx={{ p: 2 }}>
              <Alert severity='error'>{t('common.error')}: {error.message}</Alert>
            </Box>
          ) : !loading && filtered.length === 0 ? (
            <EmptyState
              icon="ri-calendar-event-line"
              title={t('emptyState.noEvents')}
              description={t('emptyState.noEventsDesc')}
              size="large"
            />
          ) : (
            <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
              <DataGrid
                rows={filtered}
                columns={columns}
                loading={loading}
                getRowId={row => row.id}
                density='compact'
                pageSizeOptions={[25, 50, 100]}
                initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
                disableRowSelectionOnClick
                onRowDoubleClick={handleRowDoubleClick}
                sx={{
                  border: 'none',
                  '& .MuiDataGrid-row': {
                    minHeight: '36px !important',
                    maxHeight: '36px !important',
                    cursor: 'pointer',
                    '&:hover': {
                      bgcolor: 'action.hover'
                    }
                  },
                  '& .MuiDataGrid-cell': {
                    display: 'flex',
                    alignItems: 'center',
                    py: 0.5,
                  },
                  '& .MuiDataGrid-columnHeaders': {
                    borderBottom: '1px solid',
                    borderColor: 'divider'
                  }
                }}
              />
            </Box>
          )}
        </Box>
      </Card>

      {/* Task Detail Dialog */}
      <TaskDetailDialog
        open={dialogOpen}
        task={selectedTask}
        onClose={handleCloseDialog}
      />
    </Box>
  )
}
