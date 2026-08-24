'use client'

import { useMemo, useState, useEffect } from 'react'

import { useTranslations } from 'next-intl'

import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  FormControl,
  IconButton,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Select,
  TextField,
  Tooltip,
  Typography
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import { PieChart, Pie, Cell } from 'recharts'
import ChartContainer from '@/components/ChartContainer'

import { usePageTitle } from '@/contexts/PageTitleContext'
import EnterpriseGuard from '@/components/guards/EnterpriseGuard'
import { Features, useLicense } from '@/contexts/LicenseContext'
import { useJobs } from '@/hooks/useJobs'
import EmptyState from '@/components/EmptyState'
import { CardsSkeleton, TableSkeleton } from '@/components/skeletons'

import { runJobAction } from '@/lib/tasks/jobActions'
import JobDetailDialog from '@/components/tasks/JobDetailDialog'
import { StatusChip, TypeChip } from '@/components/tasks/JobChips'

/* --------------------------------
   Helpers
-------------------------------- */

function useTimeAgo(t) {
  return (date) => {
    if (!date) return '—'
    const now = new Date()
    const past = new Date(date)
    const diff = Math.floor((now - past) / 1000)

    if (diff < 60) return t('time.secondsAgo')
    if (diff < 3600) return t('time.minutesAgo', { count: Math.floor(diff / 60) })
    if (diff < 86400) return t('time.hoursAgo', { count: Math.floor(diff / 3600) })
    return t('time.daysAgo', { count: Math.floor(diff / 86400) })
  }
}

// Every control in the filter toolbar is normalised to this height: MUI gives
// a size='small' TextField/Select 40px but a size='small' Button ~31px, so the
// row looked ragged.
const CONTROL_HEIGHT = 40

// Icon-only toolbar buttons keep the outlined look and the exact height of the
// text field and the selectors next to them.
const CONTROL_ICON_BUTTON_SX = {
  width: CONTROL_HEIGHT,
  height: CONTROL_HEIGHT,
  border: '1px solid',
  borderColor: 'divider',
  borderRadius: 1
}

/* --------------------------------
   Components
-------------------------------- */


function ProgressCell({ value, status }) {
  if (status === 'queued' || status === 'pending') {
    return <Typography variant='body2' sx={{ opacity: 0.5 }}>—</Typography>
  }

  if (status === 'success' || status === 'completed' || status === 'failed' || status === 'cancelled') {
    return <Typography variant='body2' sx={{ opacity: 0.7 }}>100%</Typography>
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
      <LinearProgress
        variant='determinate'
        value={value}
        sx={{ flex: 1, height: 6, borderRadius: 3 }}
      />
      <Typography variant='caption' sx={{ minWidth: 35 }}>{value}%</Typography>
    </Box>
  )
}


/* --------------------------------
   Page
-------------------------------- */

export default function JobsPage() {
  const t = useTranslations()
  const { isEnterprise } = useLicense()
  const [q, setQ] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 20 })

  // Dialog state
  const [selectedJob, setSelectedJob] = useState(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  // A rejected action (403 without vm.migrate, 400 on an already-finished job)
  // must say so instead of looking like the click did nothing.
  const [actionError, setActionError] = useState(null)

  const { setPageInfo } = usePageTitle()

  useEffect(() => {
    setPageInfo(t('jobs.title'), t('jobs.title'), 'ri-play-list-2-line')
    return () => setPageInfo('', '', '')
  }, [setPageInfo, t])

  // SWR data fetching with conditional refresh interval
  // Use faster polling (5s) when there are running jobs, otherwise no auto-refresh
  const { data: jobsResponse, error, isLoading, isValidating, mutate } = useJobs(isEnterprise)

  const jobs = jobsResponse?.data || []
  const stats = jobsResponse?.stats || { total: 0, running: 0, pending: 0, failed: 0 }
  const loading = isLoading

  // Conditional auto-refresh: 5s when running jobs exist
  useEffect(() => {
    if (stats.running > 0 && isEnterprise) {
      const interval = setInterval(() => mutate(), 5000)
      return () => clearInterval(interval)
    }
  }, [stats.running, isEnterprise, mutate])

  // Handle job action (pause/resume/cancel). The endpoint depends on the job
  // type: a migration is cancelled through /api/v1/migrations, only a rolling
  // update goes to the orchestrator route.
  const handleJobAction = async (job, action) => {
    if (!isEnterprise) return

    setActionError(null)
    const { ok, error: actionFailure } = await runJobAction(job, action)
    if (!ok) {
      setActionError(actionFailure)

      return
    }

    // Refresh the list, then re-point the open dialog at the refreshed row so
    // a cancelled migration stops advertising itself as running.
    const refreshed = await mutate()
    const fresh = refreshed?.data?.find(j => j.id === job.id)
    if (fresh) setSelectedJob(fresh)
  }

  // Handle row double-click
  const handleRowDoubleClick = (params) => {
    setActionError(null)
    setSelectedJob(params.row)
    setDialogOpen(true)
  }

  // Filtrage
  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase()

    return jobs.filter(job => {
      const matchQ =
        !qq ||
        job.name?.toLowerCase().includes(qq) ||
        job.detail?.toLowerCase().includes(qq) ||
        job.target?.toLowerCase().includes(qq)

      const matchType = typeFilter === 'all' || job.type === typeFilter

      // Handle status filter with aliases
      let matchStatus = statusFilter === 'all'
      if (!matchStatus) {
        if (statusFilter === 'success') {
          matchStatus = job.status === 'success' || job.status === 'completed'
        } else if (statusFilter === 'failed') {
          matchStatus = job.status === 'failed' || job.status === 'cancelled'
        } else if (statusFilter === 'queued') {
          matchStatus = job.status === 'queued' || job.status === 'pending'
        } else {
          matchStatus = job.status === statusFilter
        }
      }

      return matchQ && matchType && matchStatus
    })
  }, [jobs, q, typeFilter, statusFilter])

  // Time ago helper
  const timeAgo = useTimeAgo(t)

  // Colonnes
  const columns = useMemo(
    () => [
      {
        field: 'name',
        headerName: 'Job',
        flex: 1.2,
        minWidth: 220,
        renderCell: params => (
          <Tooltip title={params.row.id?.slice(0, 8)}>
            <Typography variant='body2' sx={{ fontWeight: 600 }}>{params.row.name}</Typography>
          </Tooltip>
        )
      },
      {
        field: 'type',
        headerName: 'Type',
        width: 150,
        renderCell: params => <TypeChip type={params.row.type} t={t} />
      },
      {
        field: 'status',
        headerName: t('jobsPage.columnStatus'),
        width: 110,
        renderCell: params => <StatusChip status={params.row.status} t={t} />
      },
      {
        field: 'progress',
        headerName: t('jobsPage.columnProgress'),
        width: 150,
        renderCell: params => <ProgressCell value={params.row.progress} status={params.row.status} />
      },
      {
        field: 'startedAt',
        headerName: t('jobsPage.columnStarted'),
        width: 140,
        renderCell: params => (
          <Typography variant='body2' sx={{ opacity: 0.7 }}>
            {params.row.startedAt ? timeAgo(params.row.startedAt) : '—'}
          </Typography>
        )
      },
      {
        field: 'target',
        headerName: t('jobsPage.columnTarget'),
        width: 180,
        renderCell: params => (
          <Typography variant='body2' sx={{ opacity: 0.7 }}>
            {params.row.target || '—'}
          </Typography>
        )
      },
      {
        field: 'detail',
        headerName: t('jobsPage.columnDetail'),
        flex: 1,
        minWidth: 200,
        renderCell: params => (
          <Typography
            variant='body2'
            sx={{ opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {params.row.detail}
          </Typography>
        )
      }
    ],
    [timeAgo, t]
  )

  return (
    <EnterpriseGuard requiredFeature={Features.TASK_CENTER} featureName="Task Center">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minHeight: 0 }}>
      {/* Stats */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 2, flexShrink: 0 }}>
        {/* Total — full distribution donut */}
        <Card variant='outlined'>
          <CardContent sx={{ py: 1.5, px: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box sx={{ width: 52, height: 52, flexShrink: 0 }}>
              <ChartContainer>
                <PieChart>
                  <Pie
                    data={[
                      { value: stats.running || 0 },
                      { value: stats.pending || 0 },
                      { value: stats.failed || 0 },
                      { value: Math.max(0, (stats.total || 0) - (stats.running || 0) - (stats.pending || 0) - (stats.failed || 0)) }
                    ]}
                    dataKey="value"
                    cx="50%" cy="50%"
                    innerRadius={14} outerRadius={24}
                    strokeWidth={0}
                    startAngle={90} endAngle={-270}
                  >
                    <Cell fill="#2196f3" />
                    <Cell fill="#ff9800" />
                    <Cell fill="#f44336" />
                    <Cell fill="#4caf50" />
                  </Pie>
                </PieChart>
              </ChartContainer>
            </Box>
            <Box>
              <Typography variant='caption' sx={{ opacity: 0.6 }}>{t('jobsPage.total')}</Typography>
              <Typography variant='h5' sx={{ fontWeight: 700 }}>{stats.total}</Typography>
            </Box>
          </CardContent>
        </Card>

        {/* Running */}
        <Card variant='outlined'>
          <CardContent sx={{ py: 1.5, px: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box sx={{ width: 52, height: 52, flexShrink: 0 }}>
              <ChartContainer>
                <PieChart>
                  <Pie
                    data={[
                      { value: stats.running || 0 },
                      { value: Math.max(0, (stats.total || 0) - (stats.running || 0)) }
                    ]}
                    dataKey="value"
                    cx="50%" cy="50%"
                    innerRadius={14} outerRadius={24}
                    strokeWidth={0}
                    startAngle={90} endAngle={-270}
                  >
                    <Cell fill="#2196f3" />
                    <Cell fill="rgba(255,255,255,0.08)" />
                  </Pie>
                </PieChart>
              </ChartContainer>
            </Box>
            <Box>
              <Typography variant='caption' sx={{ opacity: 0.6 }}>{t('jobsPage.running')}</Typography>
              <Typography variant='h5' sx={{ fontWeight: 700, color: 'info.main' }}>{stats.running}</Typography>
            </Box>
          </CardContent>
        </Card>

        {/* Pending */}
        <Card variant='outlined'>
          <CardContent sx={{ py: 1.5, px: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box sx={{ width: 52, height: 52, flexShrink: 0 }}>
              <ChartContainer>
                <PieChart>
                  <Pie
                    data={[
                      { value: stats.pending || 0 },
                      { value: Math.max(0, (stats.total || 0) - (stats.pending || 0)) }
                    ]}
                    dataKey="value"
                    cx="50%" cy="50%"
                    innerRadius={14} outerRadius={24}
                    strokeWidth={0}
                    startAngle={90} endAngle={-270}
                  >
                    <Cell fill="#ff9800" />
                    <Cell fill="rgba(255,255,255,0.08)" />
                  </Pie>
                </PieChart>
              </ChartContainer>
            </Box>
            <Box>
              <Typography variant='caption' sx={{ opacity: 0.6 }}>{t('jobsPage.pending')}</Typography>
              <Typography variant='h5' sx={{ fontWeight: 700 }}>{stats.pending}</Typography>
            </Box>
          </CardContent>
        </Card>

        {/* Failed */}
        <Card variant='outlined'>
          <CardContent sx={{ py: 1.5, px: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box sx={{ width: 52, height: 52, flexShrink: 0 }}>
              <ChartContainer>
                <PieChart>
                  <Pie
                    data={[
                      { value: stats.failed || 0 },
                      { value: Math.max(0, (stats.total || 0) - (stats.failed || 0)) }
                    ]}
                    dataKey="value"
                    cx="50%" cy="50%"
                    innerRadius={14} outerRadius={24}
                    strokeWidth={0}
                    startAngle={90} endAngle={-270}
                  >
                    <Cell fill="#f44336" />
                    <Cell fill="rgba(255,255,255,0.08)" />
                  </Pie>
                </PieChart>
              </ChartContainer>
            </Box>
            <Box>
              <Typography variant='caption' sx={{ opacity: 0.6 }}>{t('jobsPage.failed')}</Typography>
              <Typography variant='h5' sx={{ fontWeight: 700, color: 'error.main' }}>{stats.failed}</Typography>
            </Box>
          </CardContent>
        </Card>
      </Box>

      {/* Filtres + Table */}
      <Card variant='outlined' sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        <CardContent sx={{ pb: 0, flexShrink: 0 }}>
          {/* Plain flex row, not a Stack: Stack injects margin-left on every
              sibling with a selector more specific than a child's own sx, so an
              `ml: auto` meant to push the trailing controls right is silently
              dropped and everything stays packed on the left. An explicit
              spacer pins both icon buttons to the right edge instead. */}
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
            <TextField
              size='small'
              placeholder={t('common.search')}
              value={q}
              onChange={e => setQ(e.target.value)}
              sx={{ minWidth: 220, '& .MuiOutlinedInput-root': { height: CONTROL_HEIGHT } }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position='start'>
                    <i className='ri-search-line' />
                  </InputAdornment>
                )
              }}
            />

            <FormControl size='small' sx={{ minWidth: 150 }}>
              {/* Only the types the endpoint can actually emit. "Backup" was
                  offered here with no source feeding it, so the filter always
                  emptied the table (same trap as "Migration" before #767). */}
              <Select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} sx={{ height: CONTROL_HEIGHT }}>
                <MenuItem value='all'>{t('jobsPage.allTypes')}</MenuItem>
                <MenuItem value='rolling_update'>{t('jobsPage.typeRollingUpdate')}</MenuItem>
                <MenuItem value='replication'>{t('jobsPage.typeReplication')}</MenuItem>
                <MenuItem value='drs'>{t('jobsPage.typeDrs')}</MenuItem>
                <MenuItem value='migration'>{t('jobsPage.typeMigration')}</MenuItem>
                <MenuItem value='site_recovery'>{t('jobsPage.typeSiteRecovery')}</MenuItem>
              </Select>
            </FormControl>

            <FormControl size='small' sx={{ minWidth: 130 }}>
              <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} sx={{ height: CONTROL_HEIGHT }}>
                <MenuItem value='all'>{t('jobsPage.allStatuses')}</MenuItem>
                <MenuItem value='running'>{t('jobsPage.statusRunning')}</MenuItem>
                <MenuItem value='queued'>{t('jobsPage.statusQueued')}</MenuItem>
                <MenuItem value='success'>{t('jobsPage.statusSuccess')}</MenuItem>
                <MenuItem value='failed'>{t('jobsPage.statusFailed')}</MenuItem>
                <MenuItem value='paused'>{t('jobsPage.statusPaused')}</MenuItem>
              </Select>
            </FormControl>

            <Box sx={{ flexGrow: 1 }} />

            <Tooltip title={t('common.reset')}>
              <IconButton
                sx={CONTROL_ICON_BUTTON_SX}
                onClick={() => {
                  setQ('')
                  setTypeFilter('all')
                  setStatusFilter('all')
                }}
              >
                <i className='ri-filter-off-line' style={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>

            {/* A disabled button fires no pointer event, so the Tooltip needs a
                wrapper element to hang on while a refresh is in flight. */}
            <Tooltip title={t('common.refresh')}>
              <span>
                <IconButton sx={CONTROL_ICON_BUTTON_SX} onClick={() => mutate()} disabled={isValidating}>
                  {isValidating
                    ? <CircularProgress size={16} />
                    : <i className='ri-refresh-line' style={{ fontSize: 18 }} />}
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        </CardContent>

        <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
          <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
            {loading && jobs.length === 0 ? (
              <Box sx={{ p: 2 }}>
                <TableSkeleton rows={5} columns={6} />
              </Box>
            ) : error ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', flexDirection: 'column', gap: 2 }}>
                <Typography color="error">{error.message}</Typography>
                <Button onClick={() => mutate()} variant="outlined" size="small">
                  {t('common.retry')}
                </Button>
              </Box>
            ) : !loading && filtered.length === 0 ? (
              <EmptyState
                icon="ri-play-list-2-line"
                title={t('emptyState.noJobs')}
                description={t('emptyState.noJobsDesc')}
                size="large"
              />
            ) : (
              <DataGrid
                rows={filtered}
                columns={columns}
                getRowId={(row) => row.id || `${row.type}-${row.name}-${row.startedAt}`}
                paginationModel={paginationModel}
                onPaginationModelChange={setPaginationModel}
                pageSizeOptions={[20, 50, 100]}
                disableRowSelectionOnClick
                density='compact'
                loading={isValidating}
                onRowDoubleClick={handleRowDoubleClick}
                sx={{
                  border: 'none',
                  '& .MuiDataGrid-row': {
                    minHeight: '36px !important',
                    maxHeight: '36px !important',
                    cursor: 'pointer'
                  },
                  '& .MuiDataGrid-cell': {
                    display: 'flex',
                    alignItems: 'center',
                    py: 0.5,
                  },
                  '& .MuiDataGrid-columnHeaders': {
                    borderBottom: '1px solid',
                    borderColor: 'divider'
                  },
                }}
              />
            )}
          </Box>
        </Box>
      </Card>

      {/* Job Detail Dialog */}
      <JobDetailDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        job={selectedJob}
        onAction={handleJobAction}
        actionError={actionError}
        isEnterprise={isEnterprise}
        t={t}
      />
      </Box>
    </EnterpriseGuard>
  )
}
