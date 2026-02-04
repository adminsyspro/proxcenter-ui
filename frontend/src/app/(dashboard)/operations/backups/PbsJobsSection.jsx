'use client'

import { useEffect, useState, useCallback } from 'react'

import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
  useTheme
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import { useTranslations } from 'next-intl'

/* -----------------------------
  Helpers
------------------------------ */

const formatDate = (dateStr, locale = 'en-US') => {
  if (!dateStr) return '—'
  const date = new Date(dateStr)

  return date.toLocaleString(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const JobTypeIcon = ({ type }) => {
  const icons = {
    sync: { icon: 'ri-refresh-line', color: '#2196F3', label: 'Sync' },
    verify: { icon: 'ri-shield-check-line', color: '#4CAF50', label: 'Verify' },
    prune: { icon: 'ri-scissors-cut-line', color: '#FF9800', label: 'Prune' },
    gc: { icon: 'ri-delete-bin-7-line', color: '#9C27B0', label: 'GC' },
    tape: { icon: 'ri-archive-drawer-line', color: '#795548', label: 'Tape' }
  }
  
  const config = icons[type] || { icon: 'ri-question-line', color: '#757575', label: type }
  
  return (
    <Tooltip title={config.label}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <i className={config.icon} style={{ fontSize: 18, color: config.color }} />
      </Box>
    </Tooltip>
  )
}

const StatusChip = ({ state, t }) => {
  if (!state) return <Chip size="small" label="N/A" variant="outlined" sx={{ opacity: 0.5 }} />

  const stateUpper = String(state).toUpperCase()

  if (stateUpper === 'OK') {
    return <Chip size="small" color="success" label={t('backups.ok')} />
  }

  if (stateUpper === 'ERROR') {
    return <Chip size="small" color="error" label={t('backups.error')} />
  }

  if (stateUpper === 'WARNING') {
    return <Chip size="small" color="warning" label={t('common.warning')} />
  }

  if (stateUpper === 'RUNNING') {
    return <Chip size="small" color="info" label={t('backups.running')} icon={<CircularProgress size={12} />} />
  }

  return <Chip size="small" label={state} variant="outlined" />
}

const RetentionChip = ({ job }) => {
  const parts = []

  if (job.keepLast) parts.push(`L:${job.keepLast}`)
  if (job.keepHourly) parts.push(`H:${job.keepHourly}`)
  if (job.keepDaily) parts.push(`D:${job.keepDaily}`)
  if (job.keepWeekly) parts.push(`W:${job.keepWeekly}`)
  if (job.keepMonthly) parts.push(`M:${job.keepMonthly}`)
  if (job.keepYearly) parts.push(`Y:${job.keepYearly}`)
  
  if (parts.length === 0) return <Typography variant="body2" sx={{ opacity: 0.5 }}>—</Typography>
  
  return (
    <Tooltip title={`Last:${job.keepLast || 0}, Hourly:${job.keepHourly || 0}, Daily:${job.keepDaily || 0}, Weekly:${job.keepWeekly || 0}, Monthly:${job.keepMonthly || 0}, Yearly:${job.keepYearly || 0}`}>
      <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
        {parts.join(' ')}
      </Typography>
    </Tooltip>
  )
}

/* -----------------------------
  PbsJobsSection Component
------------------------------ */

export default function PbsJobsSection({ pbsConnections = [] }) {
  const theme = useTheme()
  const t = useTranslations()

  // État principal
  const [selectedPbs, setSelectedPbs] = useState('')
  const [jobs, setJobs] = useState(null)
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  
  // Filtre par type
  const [selectedType, setSelectedType] = useState('all')
  
  // Charger les jobs PBS
  const loadJobs = useCallback(async () => {
    if (!selectedPbs) return
    
    setLoading(true)
    setError(null)
    
    try {
      const res = await fetch(`/api/v1/pbs/${encodeURIComponent(selectedPbs)}/jobs`)
      const json = await res.json()
      
      if (json.error) {
        setError(json.error)
      } else {
        setJobs(json.data?.jobs || null)
        setStats(json.data?.stats || null)
      }
    } catch (e) {
      setError(e.message || t('errors.loadingError'))
    } finally {
      setLoading(false)
    }
  }, [selectedPbs])
  
  useEffect(() => {
    if (selectedPbs) {
      loadJobs()
    }
  }, [selectedPbs, loadJobs])
  
  // Auto-sélectionner le premier PBS
  useEffect(() => {
    if (pbsConnections.length > 0 && !selectedPbs) {
      setSelectedPbs(pbsConnections[0].id)
    }
  }, [pbsConnections, selectedPbs])
  
  // Jobs filtrés
  const filteredJobs = jobs 
    ? (selectedType === 'all' ? jobs.all : jobs[selectedType] || [])
    : []
  
  // Colonnes du DataGrid
  const columns = [
    {
      field: 'type',
      headerName: t('backups.jobType'),
      width: 70,
      renderCell: (params) => <JobTypeIcon type={params.value} />
    },
    {
      field: 'enabled',
      headerName: '',
      width: 50,
      renderCell: (params) => (
        <Tooltip title={params.value !== false ? t('common.enabled') : t('common.disabled')}>
          <i
            className={params.value !== false ? 'ri-checkbox-circle-fill' : 'ri-close-circle-line'}
            style={{
              fontSize: 18,
              color: params.value !== false ? theme.palette.success.main : theme.palette.text.disabled
            }}
          />
        </Tooltip>
      )
    },
    {
      field: 'id',
      headerName: 'ID',
      width: 150,
      renderCell: (params) => (
        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
          {params.value}
        </Typography>
      )
    },
    {
      field: 'store',
      headerName: t('backups.datastore'),
      width: 140,
      valueGetter: (value, row) => row.store || row.datastore || '—'
    },
    {
      field: 'ns',
      headerName: t('backups.namespace'),
      width: 120,
      renderCell: (params) => params.value
        ? <Chip size="small" label={params.value} variant="outlined" />
        : <Typography variant="body2" sx={{ opacity: 0.5 }}>—</Typography>
    },
    {
      field: 'schedule',
      headerName: t('backups.planification'),
      width: 130,
      renderCell: (params) => params.value
        ? <Chip size="small" label={params.value} variant="outlined" />
        : <Typography variant="body2" sx={{ opacity: 0.5 }}>{t('backups.manual')}</Typography>
    },
    {
      field: 'lastRunState',
      headerName: t('backups.lastState'),
      width: 110,
      renderCell: (params) => <StatusChip state={params.value} t={t} />
    },
    {
      field: 'lastRunEndtime',
      headerName: t('backups.lastExecution'),
      width: 160,
      renderCell: (params) => (
        <Typography variant="body2">{formatDate(params.value)}</Typography>
      )
    },
    {
      field: 'nextRun',
      headerName: t('backups.nextExecution'),
      width: 160,
      renderCell: (params) => (
        <Typography variant="body2" sx={{ opacity: params.value ? 1 : 0.5 }}>
          {formatDate(params.value)}
        </Typography>
      )
    },
    {
      field: 'comment',
      headerName: t('network.comment'),
      flex: 1,
      minWidth: 150,
      renderCell: (params) => (
        <Typography variant="body2" sx={{ opacity: params.value ? 1 : 0.5 }} noWrap>
          {params.value || '—'}
        </Typography>
      )
    },

    // Colonnes spécifiques selon le type sélectionné
    ...(selectedType === 'sync' ? [
      {
        field: 'remote',
        headerName: t('backups.remote'),
        width: 120
      },
      {
        field: 'remoteStore',
        headerName: t('backups.remoteDatastore'),
        width: 120
      }
    ] : []),
    ...(selectedType === 'prune' ? [
      {
        field: 'retention',
        headerName: t('backups.retention'),
        width: 180,
        renderCell: (params) => <RetentionChip job={params.row} />
      }
    ] : []),
    ...(selectedType === 'verify' ? [
      {
        field: 'ignoreVerified',
        headerName: t('backups.ignoreVerified'),
        width: 130,
        renderCell: (params) => params.value ? t('common.yes') : t('common.no')
      },
      {
        field: 'outdatedAfter',
        headerName: t('backups.obsoleteAfter'),
        width: 130,
        renderCell: (params) => params.value ? `${params.value} ${t('backups.days')}` : '—'
      }
    ] : []),
    ...(selectedType === 'tape' ? [
      {
        field: 'pool',
        headerName: t('backups.mediaPool'),
        width: 120
      },
      {
        field: 'drive',
        headerName: t('backups.drive'),
        width: 100
      }
    ] : [])
  ]

  return (
    <Card variant="outlined">
      <CardContent>
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className="ri-server-line" style={{ fontSize: 20, color: theme.palette.primary.main }} />
            <Typography variant="h6">{t('backups.pbsJobs')}</Typography>
            <Typography variant="caption" sx={{ opacity: 0.7 }}>
              (Sync, Verify, Prune, GC, Tape)
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', gap: 2 }}>
            {/* Sélecteur PBS */}
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <InputLabel>{t('backups.pbsServer')}</InputLabel>
              <Select
                value={selectedPbs}
                onChange={(e) => setSelectedPbs(e.target.value)}
                label={t('backups.pbsServer')}
              >
                {pbsConnections.map(conn => (
                  <MenuItem key={conn.id} value={conn.id}>
                    {conn.name || conn.host}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* Filtre par type */}
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel>{t('backups.jobType')}</InputLabel>
              <Select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                label={t('backups.jobType')}
              >
                <MenuItem value="all">{t('common.all')} ({stats?.total || 0})</MenuItem>
                <MenuItem value="sync">
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <JobTypeIcon type="sync" /> Sync ({stats?.byType?.sync || 0})
                  </Box>
                </MenuItem>
                <MenuItem value="verify">
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <JobTypeIcon type="verify" /> Verify ({stats?.byType?.verify || 0})
                  </Box>
                </MenuItem>
                <MenuItem value="prune">
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <JobTypeIcon type="prune" /> Prune ({stats?.byType?.prune || 0})
                  </Box>
                </MenuItem>
                <MenuItem value="gc">
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <JobTypeIcon type="gc" /> GC ({stats?.byType?.gc || 0})
                  </Box>
                </MenuItem>
                <MenuItem value="tape">
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <JobTypeIcon type="tape" /> Tape ({stats?.byType?.tape || 0})
                  </Box>
                </MenuItem>
              </Select>
            </FormControl>

            {/* Refresh */}
            <Tooltip title={t('common.refresh')}>
              <IconButton onClick={loadJobs} disabled={loading || !selectedPbs}>
                <i className={`ri-refresh-line ${loading ? 'ri-spin' : ''}`} />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        {/* Stats rapides */}
        {stats && (
          <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
            <Chip
              size="small"
              icon={<i className="ri-checkbox-circle-fill" style={{ color: theme.palette.success.main }} />}
              label={t('backups.activeJobs', { count: stats.enabled })}
              variant="outlined"
            />
            <Chip
              size="small"
              icon={<i className="ri-close-circle-line" style={{ color: theme.palette.text.disabled }} />}
              label={t('backups.inactiveJobs', { count: stats.disabled })}
              variant="outlined"
            />
            <Divider orientation="vertical" flexItem />
            <Chip
              size="small"
              color="success"
              label={`${stats.lastRunStates?.ok || 0} OK`}
              variant="outlined"
            />
            <Chip
              size="small"
              color="error"
              label={t('backups.errorsCount', { count: stats.lastRunStates?.error || 0 })}
              variant="outlined"
            />
            <Chip
              size="small"
              color="warning"
              label={t('backups.warningsCount', { count: stats.lastRunStates?.warning || 0 })}
              variant="outlined"
            />
          </Box>
        )}

        {loading && <LinearProgress sx={{ mb: 2 }} />}

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
        )}

        {!selectedPbs && pbsConnections.length === 0 && (
          <Alert severity="info">
            {t('backups.noPbsServerConfigured')}
          </Alert>
        )}

        {/* Table des jobs */}
        {selectedPbs && !loading && (
          <DataGrid
            rows={filteredJobs}
            columns={columns}
            getRowId={(row) => row.id}
            pageSizeOptions={[10, 25, 50]}
            initialState={{
              pagination: { paginationModel: { pageSize: 10 } },
              sorting: { sortModel: [{ field: 'lastRunEndtime', sort: 'desc' }] }
            }}
            disableRowSelectionOnClick
            autoHeight
            sx={{
              border: 'none',
              '& .MuiDataGrid-cell': {
                borderColor: 'divider'
              },
              '& .MuiDataGrid-columnHeaders': {
                bgcolor: 'action.hover',
                borderRadius: 1
              }
            }}
            localeText={{
              noRowsLabel: t('backups.noJobFound'),
              MuiTablePagination: {
                labelRowsPerPage: t('backups.rowsPerPage')
              }
            }}
          />
        )}
      </CardContent>
    </Card>
  )
}
