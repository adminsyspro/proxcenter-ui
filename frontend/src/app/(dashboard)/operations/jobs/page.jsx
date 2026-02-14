'use client'

import { useMemo, useState, useEffect } from 'react'

import { useTranslations } from 'next-intl'

import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  IconButton,
  InputAdornment,
  LinearProgress,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
// RemixIcon replacements for @mui/icons-material
const CheckCircleIcon = (props) => <i className="ri-checkbox-circle-fill" style={{ fontSize: props?.sx?.fontSize || 20, color: props?.sx?.color, ...props?.style }} />
const ErrorIcon = (props) => <i className="ri-error-warning-fill" style={{ fontSize: props?.sx?.fontSize || 20, color: props?.sx?.color, ...props?.style }} />
const WarningIcon = (props) => <i className="ri-alert-line" style={{ fontSize: props?.sx?.fontSize || 20, color: props?.sx?.color, ...props?.style }} />
const InfoIcon = (props) => <i className="ri-information-line" style={{ fontSize: props?.sx?.fontSize || 20, color: props?.sx?.color, ...props?.style }} />
const CloseIcon = (props) => <i className="ri-close-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const PauseIcon = (props) => <i className="ri-pause-fill" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const PlayArrowIcon = (props) => <i className="ri-play-fill" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const StopIcon = (props) => <i className="ri-stop-fill" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />

import { usePageTitle } from '@/contexts/PageTitleContext'
import EnterpriseGuard from '@/components/guards/EnterpriseGuard'
import { Features, useLicense } from '@/contexts/LicenseContext'
import { useJobs } from '@/hooks/useJobs'
import EmptyState from '@/components/EmptyState'
import { CardsSkeleton, TableSkeleton } from '@/components/skeletons'

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

/* --------------------------------
   Type Labels (fallback if translation missing)
-------------------------------- */

const TYPE_LABELS = {
  backup: 'Backup',
  replication: 'Réplication',
  drs: 'DRS',
  maintenance: 'Maintenance',
  migration: 'Migration',
  rolling_update: 'Rolling Update'
}

const TYPE_ICONS = {
  backup: 'ri-hard-drive-2-line',
  replication: 'ri-repeat-line',
  drs: 'ri-exchange-line',
  maintenance: 'ri-tools-line',
  migration: 'ri-swap-box-line',
  rolling_update: 'ri-refresh-line'
}

/* --------------------------------
   Components
-------------------------------- */

function StatusChip({ status, t }) {
  const config = {
    running: { label: 'En cours', color: 'info' },
    success: { label: 'Succès', color: 'success' },
    completed: { label: 'Succès', color: 'success' },
    failed: { label: 'Échec', color: 'error' },
    cancelled: { label: 'Annulé', color: 'error' },
    queued: { label: 'En attente', color: 'default' },
    pending: { label: 'En attente', color: 'default' },
    paused: { label: 'Pausé', color: 'warning' }
  }

  const cfg = config[status] || { label: status, color: 'default' }

  return <Chip size='small' label={cfg.label} color={cfg.color} sx={{ minWidth: 80 }} />
}

function TypeChip({ type }) {
  const label = TYPE_LABELS[type] || type
  const icon = TYPE_ICONS[type] || 'ri-file-list-line'

  return (
    <Chip
      size='small'
      label={label}
      variant='outlined'
      icon={<i className={icon} style={{ fontSize: 14 }} />}
    />
  )
}

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

function getNodeStatusIcon(status) {
  switch (status) {
    case 'completed':
      return <CheckCircleIcon color="success" fontSize="small" />
    case 'failed':
      return <ErrorIcon color="error" fontSize="small" />
    case 'running':
    case 'updating':
    case 'migrating_vms':
    case 'rebooting':
    case 'entering_maintenance':
    case 'exiting_maintenance':
    case 'verifying_health':
    case 'waiting_return':
      return <CircularProgress size={18} />
    case 'pending':
      return <InfoIcon color="disabled" fontSize="small" />
    case 'skipped':
      return <WarningIcon color="warning" fontSize="small" />
    default:
      return <InfoIcon color="disabled" fontSize="small" />
  }
}

/* --------------------------------
   Job Detail Dialog
-------------------------------- */

function JobDetailDialog({ open, onClose, job, onAction, isEnterprise }) {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(false)

  // Fetch full job details when dialog opens
  useEffect(() => {
    if (open && job?.id && job.type === 'rolling_update' && isEnterprise) {
      fetchJobDetails()
    }
  }, [open, job?.id, isEnterprise])

  const fetchJobDetails = async () => {
    if (!job?.id || !isEnterprise) return

    setLoading(true)
    try {
      const res = await fetch(`/api/v1/orchestrator/rolling-updates/${job.id}`)
      if (res.ok) {
        const data = await res.json()
        const ru = data.data || data
        if (ru?.logs) {
          setLogs(ru.logs)
        }
      }
    } catch (e) {
      console.error('Error fetching job details:', e)
    } finally {
      setLoading(false)
    }
  }

  // Auto-refresh if job is running
  useEffect(() => {
    if (open && job?.status === 'running' && isEnterprise) {
      const interval = setInterval(fetchJobDetails, 3000)
      return () => clearInterval(interval)
    }
  }, [open, job?.status, isEnterprise])

  if (!job) return null

  const nodeStatuses = job.metadata?.nodeStatuses || []
  const isRunning = job.status === 'running'

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{ sx: { maxHeight: '80vh' } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <TypeChip type={job.type} />
          <Typography variant="h6">{job.name}</Typography>
          <StatusChip status={job.status} />
        </Box>
        <IconButton onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        <Stack spacing={3}>
          {/* Progress */}
          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="body2">
                Progression: {job.metadata?.completedNodes || 0} / {job.metadata?.totalNodes || 0} nœuds
              </Typography>
              {job.metadata?.currentNode && (
                <Typography variant="body2" color="text.secondary">
                  En cours: {job.metadata.currentNode}
                </Typography>
              )}
            </Box>
            <LinearProgress
              variant="determinate"
              value={job.progress || 0}
              sx={{ height: 8, borderRadius: 1 }}
            />
          </Box>

          {/* Info */}
          <Box sx={{ display: 'flex', gap: 4 }}>
            <Box>
              <Typography variant="caption" color="text.secondary">Cible</Typography>
              <Typography variant="body2">{job.target || '—'}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Démarré</Typography>
              <Typography variant="body2">
                {job.startedAt ? new Date(job.startedAt).toLocaleString() : '—'}
              </Typography>
            </Box>
            {job.endedAt && (
              <Box>
                <Typography variant="caption" color="text.secondary">Terminé</Typography>
                <Typography variant="body2">
                  {new Date(job.endedAt).toLocaleString()}
                </Typography>
              </Box>
            )}
          </Box>

          {/* Actions */}
          {isRunning && (
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                size="small"
                variant="outlined"
                color="warning"
                startIcon={<PauseIcon />}
                onClick={() => onAction(job.id, 'pause')}
              >
                Pause
              </Button>
              <Button
                size="small"
                variant="outlined"
                color="error"
                startIcon={<StopIcon />}
                onClick={() => onAction(job.id, 'cancel')}
              >
                Annuler
              </Button>
            </Box>
          )}

          {job.status === 'paused' && (
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                size="small"
                variant="outlined"
                color="primary"
                startIcon={<PlayArrowIcon />}
                onClick={() => onAction(job.id, 'resume')}
              >
                Reprendre
              </Button>
              <Button
                size="small"
                variant="outlined"
                color="error"
                startIcon={<StopIcon />}
                onClick={() => onAction(job.id, 'cancel')}
              >
                Annuler
              </Button>
            </Box>
          )}

          {/* Error */}
          {job.metadata?.error && (
            <Box sx={{ p: 2, bgcolor: 'error.main', color: 'error.contrastText', borderRadius: 1 }}>
              <Typography variant="body2">{job.metadata.error}</Typography>
            </Box>
          )}

          {/* Node statuses */}
          {nodeStatuses.length > 0 && (
            <Card variant="outlined">
              <CardContent>
                <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                  Statut des nœuds
                </Typography>
                <List dense>
                  {nodeStatuses.map((ns) => (
                    <ListItem key={ns.node_name}>
                      <ListItemIcon sx={{ minWidth: 40 }}>
                        {getNodeStatusIcon(ns.status)}
                      </ListItemIcon>
                      <ListItemText
                        primary={ns.node_name}
                        secondary={
                          <>
                            {ns.status}
                            {ns.version_before && ns.version_after &&
                              ` • ${ns.version_before} → ${ns.version_after}`}
                            {ns.did_reboot && ' • Redémarré'}
                          </>
                        }
                      />
                      {ns.error && (
                        <Chip size="small" label="Erreur" color="error" />
                      )}
                    </ListItem>
                  ))}
                </List>
              </CardContent>
            </Card>
          )}

          {/* Logs */}
          <Card variant="outlined">
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Typography variant="subtitle2" fontWeight={700}>
                  Logs
                </Typography>
                {loading && <CircularProgress size={16} />}
              </Box>
              <Box
                sx={{
                  maxHeight: 300,
                  overflow: 'auto',
                  bgcolor: 'background.default',
                  borderRadius: 1,
                  p: 1,
                  fontFamily: 'monospace',
                  fontSize: 11,
                }}
              >
                {logs.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    Aucun log disponible
                  </Typography>
                ) : (
                  logs.slice(-100).map((log, i) => (
                    <Box
                      key={i}
                      sx={{
                        color: log.level === 'error' ? 'error.main' :
                               log.level === 'warning' ? 'warning.main' :
                               'text.primary',
                        lineHeight: 1.4,
                      }}
                    >
                      [{new Date(log.timestamp).toLocaleTimeString()}]
                      {log.node && ` [${log.node}]`}
                      {' '}{log.message}
                    </Box>
                  ))
                )}
              </Box>
            </CardContent>
          </Card>
        </Stack>
      </DialogContent>
    </Dialog>
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
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 10 })

  // Dialog state
  const [selectedJob, setSelectedJob] = useState(null)
  const [dialogOpen, setDialogOpen] = useState(false)

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

  // Handle job action (pause/resume/cancel)
  const handleJobAction = async (jobId, action) => {
    if (!isEnterprise) return

    try {
      const res = await fetch(`/api/v1/orchestrator/rolling-updates/${jobId}/${action}`, {
        method: 'POST',
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || `Failed to ${action} job`)
      }
      // Refresh jobs list
      mutate()
    } catch (e) {
      console.error(`Error ${action} job:`, e)
    }
  }

  // Handle row double-click
  const handleRowDoubleClick = (params) => {
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
          <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <Typography variant='body2' sx={{ fontWeight: 600, lineHeight: 1.2 }}>{params.row.name}</Typography>
            <Typography variant='caption' sx={{ opacity: 0.5, lineHeight: 1.2 }}>{params.row.id?.slice(0, 8)}</Typography>
          </Box>
        )
      },
      {
        field: 'type',
        headerName: 'Type',
        width: 150,
        renderCell: params => <TypeChip type={params.row.type} />
      },
      {
        field: 'status',
        headerName: 'État',
        width: 110,
        renderCell: params => <StatusChip status={params.row.status} />
      },
      {
        field: 'progress',
        headerName: 'Progression',
        width: 150,
        renderCell: params => <ProgressCell value={params.row.progress} status={params.row.status} />
      },
      {
        field: 'startedAt',
        headerName: 'Démarré',
        width: 140,
        renderCell: params => (
          <Typography variant='body2' sx={{ opacity: 0.7 }}>
            {params.row.startedAt ? timeAgo(params.row.startedAt) : '—'}
          </Typography>
        )
      },
      {
        field: 'target',
        headerName: 'Cible',
        width: 180,
        renderCell: params => (
          <Typography variant='body2' sx={{ opacity: 0.7 }}>
            {params.row.target || '—'}
          </Typography>
        )
      },
      {
        field: 'detail',
        headerName: 'Détail',
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
    [timeAgo]
  )

  return (
    <EnterpriseGuard requiredFeature={Features.JOBS} featureName="Jobs">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
          <Button
            variant='outlined'
            size='small'
            startIcon={isValidating ? <CircularProgress size={14} /> : <i className='ri-refresh-line' />}
            onClick={() => mutate()}
            disabled={isValidating}
          >
            {t('common.refresh')}
          </Button>
        </Box>

      {/* Stats */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 2 }}>
        <Card variant='outlined'>
          <CardContent sx={{ py: 1.5, px: 2 }}>
            <Typography variant='caption' sx={{ opacity: 0.6 }}>Total</Typography>
            <Typography variant='h5' sx={{ fontWeight: 700 }}>{stats.total}</Typography>
          </CardContent>
        </Card>
        <Card variant='outlined'>
          <CardContent sx={{ py: 1.5, px: 2 }}>
            <Typography variant='caption' sx={{ opacity: 0.6 }}>En cours</Typography>
            <Typography variant='h5' sx={{ fontWeight: 700, color: 'info.main' }}>{stats.running}</Typography>
          </CardContent>
        </Card>
        <Card variant='outlined'>
          <CardContent sx={{ py: 1.5, px: 2 }}>
            <Typography variant='caption' sx={{ opacity: 0.6 }}>En attente</Typography>
            <Typography variant='h5' sx={{ fontWeight: 700 }}>{stats.pending}</Typography>
          </CardContent>
        </Card>
        <Card variant='outlined'>
          <CardContent sx={{ py: 1.5, px: 2 }}>
            <Typography variant='caption' sx={{ opacity: 0.6 }}>Échoué</Typography>
            <Typography variant='h5' sx={{ fontWeight: 700, color: 'error.main' }}>{stats.failed}</Typography>
          </CardContent>
        </Card>
      </Box>

      {/* Filtres + Table */}
      <Card variant='outlined' sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <CardContent sx={{ pb: 0 }}>
          <Stack direction='row' spacing={1.5} sx={{ flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
            <TextField
              size='small'
              placeholder="Rechercher"
              value={q}
              onChange={e => setQ(e.target.value)}
              sx={{ minWidth: 220 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position='start'>
                    <i className='ri-search-line' />
                  </InputAdornment>
                )
              }}
            />

            <FormControl size='small' sx={{ minWidth: 150 }}>
              <Select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
                <MenuItem value='all'>Tous types</MenuItem>
                <MenuItem value='rolling_update'>Rolling Update</MenuItem>
                <MenuItem value='backup'>Backup</MenuItem>
                <MenuItem value='replication'>Réplication</MenuItem>
                <MenuItem value='drs'>DRS</MenuItem>
                <MenuItem value='migration'>Migration</MenuItem>
                <MenuItem value='maintenance'>Maintenance</MenuItem>
              </Select>
            </FormControl>

            <FormControl size='small' sx={{ minWidth: 130 }}>
              <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <MenuItem value='all'>Tous états</MenuItem>
                <MenuItem value='running'>En cours</MenuItem>
                <MenuItem value='queued'>En attente</MenuItem>
                <MenuItem value='success'>Succès</MenuItem>
                <MenuItem value='failed'>Échec</MenuItem>
                <MenuItem value='paused'>Pausé</MenuItem>
              </Select>
            </FormControl>

            <Button
              variant='outlined'
              size='small'
              onClick={() => {
                setQ('')
                setTypeFilter('all')
                setStatusFilter('all')
              }}
            >
              Réinitialiser
            </Button>

            <Typography variant='body2' sx={{ ml: 'auto', opacity: 0.6 }}>
              {filtered.length} job(s)
            </Typography>
          </Stack>
        </CardContent>

        <Box sx={{ flex: 1, minHeight: 400 }}>
          {loading && jobs.length === 0 ? (
            <Box sx={{ p: 2 }}>
              <TableSkeleton rows={5} columns={6} />
            </Box>
          ) : error ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', flexDirection: 'column', gap: 2 }}>
              <Typography color="error">{error.message}</Typography>
              <Button onClick={() => mutate()} variant="outlined" size="small">
                Réessayer
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
              paginationModel={paginationModel}
              onPaginationModelChange={setPaginationModel}
              pageSizeOptions={[10, 25, 50]}
              disableRowSelectionOnClick
              rowHeight={56}
              loading={isValidating}
              onRowDoubleClick={handleRowDoubleClick}
              sx={{
                border: 'none',
                '& .MuiDataGrid-cell': {
                  display: 'flex',
                  alignItems: 'center'
                },
                '& .MuiDataGrid-columnHeaders': {
                  borderBottom: '1px solid',
                  borderColor: 'divider'
                },
                '& .MuiDataGrid-row': {
                  cursor: 'pointer'
                }
              }}
            />
          )}
        </Box>
      </Card>

      {/* Job Detail Dialog */}
      <JobDetailDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        job={selectedJob}
        onAction={handleJobAction}
        isEnterprise={isEnterprise}
      />
      </Box>
    </EnterpriseGuard>
  )
}
