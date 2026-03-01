'use client'

import { useEffect, useState, useCallback } from 'react'

import { useLocale, useTranslations } from 'next-intl'

import { getDateLocale } from '@/lib/i18n/date'

import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  useTheme
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'

/* -----------------------------
  Helpers
------------------------------ */

const formatDate = (dateStr, locale) => {
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

const JobTypeChip = ({ type }) => {
  const configs = {
    sync: { color: '#2196F3', label: 'Sync', bg: 'rgba(33, 150, 243, 0.15)' },
    verify: { color: '#4CAF50', label: 'Verify', bg: 'rgba(76, 175, 80, 0.15)' },
    prune: { color: '#FF9800', label: 'Prune', bg: 'rgba(255, 152, 0, 0.15)' },
    gc: { color: '#9C27B0', label: 'GC', bg: 'rgba(156, 39, 176, 0.15)' },
    tape: { color: '#795548', label: 'Tape', bg: 'rgba(121, 85, 72, 0.15)' }
  }
  
  const config = configs[type] || { color: '#757575', label: type?.toUpperCase() || '?', bg: 'rgba(117, 117, 117, 0.15)' }
  
  return (
    <Chip 
      size="small" 
      label={config.label}
      sx={{ 
        bgcolor: config.bg, 
        color: config.color,
        fontWeight: 600,
        fontSize: '0.7rem',
        height: 22
      }}
    />
  )
}

const StatusChip = ({ state, t }) => {
  if (!state) return <Chip size="small" label="N/A" variant="outlined" sx={{ opacity: 0.5 }} />

  const stateUpper = String(state).toUpperCase()

  if (stateUpper === 'OK') {
    return <Chip size="small" color="success" label={t ? t('backups.ok') : 'OK'} />
  }

  if (stateUpper === 'ERROR') {
    return <Chip size="small" color="error" label={t ? t('backups.error') : 'Error'} />
  }

  if (stateUpper === 'WARNING') {
    return <Chip size="small" color="warning" label="Warning" />
  }

  if (stateUpper === 'RUNNING') {
    return <Chip size="small" color="info" label={t ? t('backups.running') : 'Running'} icon={<CircularProgress size={12} />} />
  }

  return <Chip size="small" label={state} variant="outlined" />
}

/* -----------------------------
  PVE Backup Jobs Tab
------------------------------ */

function PveJobsTab({ pveConnections = [] }) {
  const theme = useTheme()
  const t = useTranslations()
  
  const [selectedConnection, setSelectedConnection] = useState('')
  const [jobs, setJobs] = useState([])
  const [storages, setStorages] = useState([])
  const [nodes, setNodes] = useState([])
  const [vms, setVms] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  
  // Dialog
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogMode, setDialogMode] = useState('create')
  const [editingJob, setEditingJob] = useState(null)
  const [saving, setSaving] = useState(false)
  
  // Delete dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [jobToDelete, setJobToDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  
  // Form state
  const [formData, setFormData] = useState({
    enabled: true,
    storage: '',
    schedule: '00:00',
    node: '',
    mode: 'snapshot',
    compress: 'zstd',
    selectionMode: 'all',
    vmids: [],
    excludedVmids: [],
    comment: '',
    mailto: '',
    mailnotification: 'always',
    maxfiles: 1,
    namespace: ''
  })

  const loadJobs = useCallback(async () => {
    if (!selectedConnection) return
    
    setLoading(true)
    setError(null)
    
    try {
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(selectedConnection)}/backup-jobs`)
      const json = await res.json()
      
      if (json.error) {
        setError(json.error)
      } else {
        setJobs(json.data?.jobs || [])

        // Utiliser allBackupStorages pour avoir tous les storages qui supportent backup
        setStorages(json.data?.allBackupStorages || json.data?.storages || [])
        setNodes(json.data?.nodes || [])
      }
    } catch (e) {
      setError(e.message || t('errors.loadingError'))
    } finally {
      setLoading(false)
    }
  }, [selectedConnection, t])

  const loadVms = useCallback(async () => {
    if (!selectedConnection) return
    
    try {
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(selectedConnection)}/resources?type=vm`)
      const json = await res.json()
      
      if (!json.error) {
        const allVms = (json.data || []).filter(r => r.type === 'qemu' || r.type === 'lxc')

        setVms(allVms.map(vm => ({
          vmid: vm.vmid,
          name: vm.name,
          type: vm.type,
          node: vm.node,
          status: vm.status
        })))
      }
    } catch (e) {
      console.error('Error loading VMs:', e)
    }
  }, [selectedConnection])

  useEffect(() => {
    if (selectedConnection) {
      loadJobs()
      loadVms()
    }
  }, [selectedConnection, loadJobs, loadVms])

  useEffect(() => {
    if (pveConnections.length > 0 && !selectedConnection) {
      setSelectedConnection(pveConnections[0].id)
    }
  }, [pveConnections, selectedConnection])

  const handleCreate = () => {
    // Trouver le premier storage PBS
    const pbsStorage = storages.find(s => s.isPbs || s.type === 'pbs')

    setFormData({
      enabled: true,
      storage: pbsStorage?.id || '',
      schedule: '00:00',
      node: '',
      mode: 'snapshot',
      compress: 'zstd',
      selectionMode: 'all',
      vmids: [],
      excludedVmids: [],
      comment: '',
      mailto: '',
      mailnotification: 'always',
      maxfiles: 1,
      namespace: ''
    })
    setDialogMode('create')
    setEditingJob(null)
    setDialogOpen(true)
  }

  const handleEdit = (job) => {
    setFormData({
      enabled: job.enabled,
      storage: job.storage || '',
      schedule: job.schedule || '00:00',
      node: job.node || '',
      mode: job.mode || 'snapshot',
      compress: job.compress || 'zstd',
      selectionMode: job.selectionMode || 'all',
      vmids: job.vmids || [],
      excludedVmids: job.excludedVmids || [],
      comment: job.comment || '',
      mailto: job.mailto || '',
      mailnotification: job.mailnotification || 'always',
      maxfiles: job.maxfiles || 1,
      namespace: job.namespace || ''
    })
    setDialogMode('edit')
    setEditingJob(job)
    setDialogOpen(true)
  }

  const handleSave = async () => {
    setSaving(true)
    
    try {
      const url = dialogMode === 'create'
        ? `/api/v1/connections/${encodeURIComponent(selectedConnection)}/backup-jobs`
        : `/api/v1/connections/${encodeURIComponent(selectedConnection)}/backup-jobs/${encodeURIComponent(editingJob.id)}`
      
      const res = await fetch(url, {
        method: dialogMode === 'create' ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      })
      
      const json = await res.json()
      
      if (json.error) {
        setError(json.error)
      } else {
        setDialogOpen(false)
        loadJobs()
      }
    } catch (e) {
      setError(e.message || t('backups.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteClick = (job) => {
    setJobToDelete(job)
    setDeleteDialogOpen(true)
  }

  const handleDeleteConfirm = async () => {
    if (!jobToDelete) return

    setDeleting(true)

    try {
      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(selectedConnection)}/backup-jobs/${encodeURIComponent(jobToDelete.id)}`,
        { method: 'DELETE' }
      )

      const json = await res.json()

      if (json.error) {
        setError(json.error)
      } else {
        loadJobs()
      }
    } catch (e) {
      setError(e.message || t('backups.deleteError'))
    } finally {
      setDeleting(false)
      setDeleteDialogOpen(false)
      setJobToDelete(null)
    }
  }

  const handleToggleEnabled = async (job) => {
    try {
      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(selectedConnection)}/backup-jobs/${encodeURIComponent(job.id)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: !job.enabled })
        }
      )
      
      const json = await res.json()
      
      if (!json.error) {
        loadJobs()
      }
    } catch (e) {
      console.error('Error toggling job:', e)
    }
  }

  const handleRunNow = async (job) => {
    try {
      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(selectedConnection)}/backup-jobs/${encodeURIComponent(job.id)}?action=run`,
        { method: 'POST' }
      )
      
      const json = await res.json()
      
      if (json.error) {
        setError(json.error)
      }
    } catch (e) {
      setError(e.message || t('common.error'))
    }
  }

  const formatSelection = (job, t) => {
    if (job.selectionMode === 'all') {
      if (job.excludedVmids?.length > 0) {
        return t('backups.allExcept', { count: job.excludedVmids.length })
      }


return t('backups.allVms')
    }

    if (job.selectionMode === 'include') {
      return t('backups.vmCount', { count: job.vmids?.length || 0 })
    }

    if (job.selectionMode === 'pool') {
      return t('backups.pool', { name: job.pool })
    }


return '—'
  }

  const columns = [
    {
      field: 'enabled',
      headerName: '',
      width: 60,
      renderCell: (params) => (
        <Switch
          size="small"
          checked={params.value}
          onChange={() => handleToggleEnabled(params.row)}
        />
      )
    },
    {
      field: 'schedule',
      headerName: t('backups.scheduleTime'),
      width: 100,
      renderCell: (params) => (
        <Chip size="small" label={params.value} variant="outlined" />
      )
    },
    {
      field: 'storage',
      headerName: 'Storage',
      width: 130
    },
    {
      field: 'namespace',
      headerName: 'Namespace',
      width: 110,
      renderCell: (params) => params.value 
        ? <Chip size="small" label={params.value} variant="outlined" color="info" />
        : <Typography sx={{ opacity: 0.5, fontSize: '0.75rem' }}>—</Typography>
    },
    {
      field: 'node',
      headerName: 'Node',
      width: 120,
      renderCell: (params) => params.value || <Typography sx={{ opacity: 0.5 }}>{t('backups.allNodes')}</Typography>
    },
    {
      field: 'selection',
      headerName: t('backups.selection'),
      width: 140,
      renderCell: (params) => formatSelection(params.row, t)
    },
    {
      field: 'mode',
      headerName: 'Mode',
      width: 100,
      renderCell: (params) => (
        <Chip 
          size="small" 
          label={params.value} 
          color={params.value === 'snapshot' ? 'success' : params.value === 'suspend' ? 'warning' : 'error'}
          variant="outlined"
        />
      )
    },
    {
      field: 'comment',
      headerName: t('network.comment'),
      flex: 1,
      minWidth: 150
    },
    {
      field: 'actions',
      headerName: '',
      width: 120,
      sortable: false,
      renderCell: (params) => (
        <Stack direction="row" spacing={0.5}>
          <Tooltip title={t('backups.runNow')}>
            <IconButton size="small" onClick={() => handleRunNow(params.row)}>
              <i className="ri-play-line" style={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('common.edit')}>
            <IconButton size="small" onClick={() => handleEdit(params.row)}>
              <i className="ri-edit-line" style={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('common.delete')}>
            <IconButton size="small" color="error" onClick={() => handleDeleteClick(params.row)}>
              <i className="ri-delete-bin-line" style={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        </Stack>
      )
    }
  ]

  if (pveConnections.length === 0) {
    return (
      <Alert severity="info">
        {t('backups.noPveConfigured')}
      </Alert>
    )
  }

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 2 }}>
        <FormControl size="small" sx={{ minWidth: 250 }}>
          <InputLabel>{t('backups.pveCluster')}</InputLabel>
          <Select
            value={selectedConnection}
            onChange={(e) => setSelectedConnection(e.target.value)}
            label={t('backups.pveCluster')}
          >
            {pveConnections.map(conn => (
              <MenuItem key={conn.id} value={conn.id}>
                {conn.name || conn.host}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            variant="contained"
            startIcon={<i className="ri-add-line" />}
            onClick={handleCreate}
            disabled={!selectedConnection}
          >
            {t('backups.createJob')}
          </Button>
          <Tooltip title={t('common.refresh')}>
            <IconButton onClick={loadJobs} disabled={loading || !selectedConnection}>
              <i className={`ri-refresh-line ${loading ? 'ri-spin' : ''}`} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>
      
      {loading && <LinearProgress sx={{ mb: 2 }} />}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      
      {/* Table */}
      <DataGrid
        rows={jobs}
        columns={columns}
        getRowId={(row) => row.id}
        pageSizeOptions={[10, 25, 50]}
        initialState={{
          pagination: { paginationModel: { pageSize: 10 } }
        }}
        disableRowSelectionOnClick
        autoHeight
        sx={{
          border: 'none',
          '& .MuiDataGrid-cell': { borderColor: 'divider' },
          '& .MuiDataGrid-columnHeaders': { bgcolor: 'action.hover', borderRadius: 1 }
        }}
        localeText={{
          noRowsLabel: t('backups.noJobConfigured'),
          MuiTablePagination: { labelRowsPerPage: t('backups.rowsPerPage') }
        }}
      />

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          {dialogMode === 'create' ? t('backups.createBackupJob') : t('backups.editBackupJob')}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            {/* Row 1 */}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr 1fr 1fr' }, gap: 2 }}>
              <FormControl fullWidth size="small">
                <InputLabel>{t('backups.pbsStorage')}</InputLabel>
                <Select
                  value={formData.storage}
                  onChange={(e) => setFormData(prev => ({ ...prev, storage: e.target.value }))}
                  label={t('backups.pbsStorage')}
                >
                  {storages.filter(s => s.isPbs || s.type === 'pbs').map(s => (
                    <MenuItem key={s.id} value={s.id}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <i className="ri-server-line" style={{ fontSize: 14, color: '#4CAF50' }} />
                        {s.name}
                      </Box>
                    </MenuItem>
                  ))}
                  {storages.filter(s => s.isPbs || s.type === 'pbs').length === 0 && (
                    <MenuItem disabled>
                      <Typography variant="body2" sx={{ opacity: 0.5 }}>
                        {t('backups.noPbsConfigured')}
                      </Typography>
                    </MenuItem>
                  )}
                </Select>
              </FormControl>

              <TextField
                size="small"
                label={t('backups.namespace')}
                value={formData.namespace}
                onChange={(e) => setFormData(prev => ({ ...prev, namespace: e.target.value }))}
                placeholder="ex: prod/web"
                helperText={t('common.optional')}
              />
              
              <TextField
                size="small"
                label={t('backups.scheduleTime')}
                value={formData.schedule}
                onChange={(e) => setFormData(prev => ({ ...prev, schedule: e.target.value }))}
                placeholder="00:00"
              />
              
              <FormControl fullWidth size="small">
                <InputLabel>{t('backups.node')}</InputLabel>
                <Select
                  value={formData.node}
                  onChange={(e) => setFormData(prev => ({ ...prev, node: e.target.value }))}
                  label={t('backups.node')}
                >
                  <MenuItem value="">{t('backups.allNodes')}</MenuItem>
                  {nodes.map(n => (
                    <MenuItem key={n.node} value={n.node}>{n.node}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>

            {/* Row 2 */}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr 1fr' }, gap: 2 }}>
              <FormControl fullWidth size="small">
                <InputLabel>{t('backups.mode')}</InputLabel>
                <Select
                  value={formData.mode}
                  onChange={(e) => setFormData(prev => ({ ...prev, mode: e.target.value }))}
                  label={t('backups.mode')}
                >
                  <MenuItem value="snapshot">{t('backups.snapshotFast')}</MenuItem>
                  <MenuItem value="suspend">{t('backups.suspendPauseDuringBackup')}</MenuItem>
                  <MenuItem value="stop">{t('backups.stopFullStop')}</MenuItem>
                </Select>
              </FormControl>

              <FormControl fullWidth size="small">
                <InputLabel>{t('backups.compression')}</InputLabel>
                <Select
                  value={formData.compress}
                  onChange={(e) => setFormData(prev => ({ ...prev, compress: e.target.value }))}
                  label={t('backups.compression')}
                >
                  <MenuItem value="0">{t('backups.none')}</MenuItem>
                  <MenuItem value="gzip">{t('backups.gzipCompression')}</MenuItem>
                  <MenuItem value="lzo">{t('backups.lzoFastCompression')}</MenuItem>
                  <MenuItem value="zstd">{t('backups.zstdRecommendedCompression')}</MenuItem>
                </Select>
              </FormControl>

              <FormControlLabel
                control={
                  <Switch
                    checked={formData.enabled}
                    onChange={(e) => setFormData(prev => ({ ...prev, enabled: e.target.checked }))}
                  />
                }
                label={t('common.enabled')}
              />
            </Box>

            <Divider />

            {/* VM Selection */}
            <Typography variant="subtitle2" fontWeight={600}>{t('backups.vmSelection')}</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 2fr' }, gap: 2 }}>
              <FormControl fullWidth size="small">
                <InputLabel>{t('backups.selectionMode')}</InputLabel>
                <Select
                  value={formData.selectionMode}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    selectionMode: e.target.value,
                    vmids: [],
                    excludedVmids: []
                  }))}
                  label={t('backups.selectionMode')}
                >
                  <MenuItem value="all">{t('backups.allVms')}</MenuItem>
                  <MenuItem value="include">{t('backups.selectVms')}</MenuItem>
                  <MenuItem value="exclude">{t('backups.allExceptMode')}</MenuItem>
                </Select>
              </FormControl>
              
              {formData.selectionMode === 'include' && (
                <Autocomplete
                  multiple
                  size="small"
                  options={vms}
                  value={vms.filter(vm => formData.vmids.includes(String(vm.vmid)))}
                  onChange={(_, newValue) => setFormData(prev => ({
                    ...prev,
                    vmids: newValue.map(v => String(v.vmid))
                  }))}
                  getOptionLabel={(option) => `${option.vmid} - ${option.name}`}
                  renderInput={(params) => <TextField {...params} label={t('backups.vmsToInclude')} />}
                  renderTags={(value, getTagProps) =>
                    value.map((option, index) => (
                      <Chip size="small" label={option.vmid} {...getTagProps({ index })} key={option.vmid} />
                    ))
                  }
                />
              )}

              {formData.selectionMode === 'exclude' && (
                <Autocomplete
                  multiple
                  size="small"
                  options={vms}
                  value={vms.filter(vm => formData.excludedVmids.includes(String(vm.vmid)))}
                  onChange={(_, newValue) => setFormData(prev => ({
                    ...prev,
                    excludedVmids: newValue.map(v => String(v.vmid))
                  }))}
                  getOptionLabel={(option) => `${option.vmid} - ${option.name}`}
                  renderInput={(params) => <TextField {...params} label={t('backups.vmsToExclude')} />}
                  renderTags={(value, getTagProps) =>
                    value.map((option, index) => (
                      <Chip size="small" label={option.vmid} color="error" variant="outlined" {...getTagProps({ index })} key={option.vmid} />
                    ))
                  }
                />
              )}
            </Box>

            <Divider />

            {/* Options */}
            <Typography variant="subtitle2" fontWeight={600}>{t('backups.options')}</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr 1fr 1fr' }, gap: 2 }}>
              <TextField
                size="small"
                label={t('network.comment')}
                value={formData.comment}
                onChange={(e) => setFormData(prev => ({ ...prev, comment: e.target.value }))}
              />
              <TextField
                size="small"
                label={t('backups.retention')}
                type="number"
                value={formData.maxfiles}
                onChange={(e) => setFormData(prev => ({ ...prev, maxfiles: parseInt(e.target.value) || 1 }))}
                inputProps={{ min: 1 }}
              />
              <TextField
                size="small"
                label={t('backups.notificationEmail')}
                value={formData.mailto}
                onChange={(e) => setFormData(prev => ({ ...prev, mailto: e.target.value }))}
              />
              <FormControl fullWidth size="small">
                <InputLabel>{t('backups.notifications')}</InputLabel>
                <Select
                  value={formData.mailnotification}
                  onChange={(e) => setFormData(prev => ({ ...prev, mailnotification: e.target.value }))}
                  label={t('backups.notifications')}
                >
                  <MenuItem value="always">{t('backups.always')}</MenuItem>
                  <MenuItem value="failure">{t('backups.failureOnly')}</MenuItem>
                </Select>
              </FormControl>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={saving}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={saving || !formData.storage}
            startIcon={saving ? <CircularProgress size={16} /> : null}
          >
            {dialogMode === 'create' ? t('common.create') : t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => !deleting && setDeleteDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-error-warning-line" style={{ fontSize: 24, color: theme.palette.error.main }} />
          {t('backups.confirmDeleteJob')}
        </DialogTitle>
        <DialogContent>
          <Typography>{t('backups.deleteJobConfirm')}</Typography>
          {jobToDelete && (
            <Box sx={{ mt: 2, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
              <Typography variant="body2" fontWeight={600}>
                {jobToDelete.comment || t('backups.noComment')}
              </Typography>
              <Typography variant="caption" sx={{ opacity: 0.7 }}>
                Storage: {jobToDelete.storage} • {t('backups.scheduleTime')}: {jobToDelete.schedule}
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleDeleteConfirm}
            disabled={deleting}
            startIcon={deleting ? <CircularProgress size={16} /> : <i className="ri-delete-bin-line" />}
          >
            {t('common.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

/* -----------------------------
  PBS Jobs Tab
------------------------------ */

function PbsJobsTab({ pbsConnections = [] }) {
  const theme = useTheme()
  const t = useTranslations()
  const dateLocale = getDateLocale(useLocale())

  const [selectedPbs, setSelectedPbs] = useState('')
  const [jobs, setJobs] = useState(null)
  const [datastores, setDatastores] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  
  const [selectedType, setSelectedType] = useState('all')
  
  // Dialog states
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogMode, setDialogMode] = useState('create')
  const [dialogType, setDialogType] = useState('sync') // sync, verify, prune
  const [editingJob, setEditingJob] = useState(null)
  const [saving, setSaving] = useState(false)
  
  // Delete dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [jobToDelete, setJobToDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  
  // Form data for different job types
  const [formData, setFormData] = useState({
    id: '',
    store: '',
    ns: '',
    schedule: '',
    comment: '',

    // Sync specific
    remote: '',
    remoteStore: '',
    remoteNs: '',
    removeVanished: false,

    // Verify specific
    ignoreVerified: true,
    outdatedAfter: 30,

    // Prune specific
    keepLast: 3,
    keepDaily: 7,
    keepWeekly: 4,
    keepMonthly: 6,
    keepYearly: 1,

    // Tape specific
    pool: '',
    drive: '',
    ejectMedia: false,
    exportMediaSet: false,
    latestOnly: false
  })

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
        setDatastores(json.data?.datastores || [])
        setStats(json.data?.stats || null)
      }
    } catch (e) {
      setError(e.message || t('errors.loadingError'))
    } finally {
      setLoading(false)
    }
  }, [selectedPbs, t])

  useEffect(() => {
    if (selectedPbs) {
      loadJobs()
    }
  }, [selectedPbs, loadJobs])

  useEffect(() => {
    if (pbsConnections.length > 0 && !selectedPbs) {
      setSelectedPbs(pbsConnections[0].id)
    }
  }, [pbsConnections, selectedPbs])

  const handleCreate = (type) => {
    setDialogType(type)
    setDialogMode('create')
    setEditingJob(null)
    setFormData({
      id: '',
      store: datastores[0] || '',
      ns: '',
      schedule: '00:00',
      comment: '',
      remote: '',
      remoteStore: '',
      remoteNs: '',
      removeVanished: false,
      ignoreVerified: true,
      outdatedAfter: 30,
      keepLast: 3,
      keepDaily: 7,
      keepWeekly: 4,
      keepMonthly: 6,
      keepYearly: 1,
      pool: '',
      drive: '',
      ejectMedia: false,
      exportMediaSet: false,
      latestOnly: false
    })
    setDialogOpen(true)
  }

  const handleEdit = (job) => {
    setDialogType(job.type)
    setDialogMode('edit')
    setEditingJob(job)
    setFormData({
      id: job.id,
      store: job.store || job.datastore || '',
      ns: job.ns || '',
      schedule: job.schedule || '',
      comment: job.comment || '',
      remote: job.remote || '',
      remoteStore: job.remoteStore || '',
      remoteNs: job.remoteNs || '',
      removeVanished: job.removeVanished || false,
      ignoreVerified: job.ignoreVerified !== false,
      outdatedAfter: job.outdatedAfter || 30,
      keepLast: job.keepLast || 3,
      keepDaily: job.keepDaily || 7,
      keepWeekly: job.keepWeekly || 4,
      keepMonthly: job.keepMonthly || 6,
      keepYearly: job.keepYearly || 1,
      pool: job.pool || '',
      drive: job.drive || '',
      ejectMedia: job.ejectMedia || false,
      exportMediaSet: job.exportMediaSet || false,
      latestOnly: job.latestOnly || false
    })
    setDialogOpen(true)
  }

  const handleSave = async () => {
    setSaving(true)
    
    try {
      const endpoint = dialogType === 'sync' ? 'sync' 
        : dialogType === 'verify' ? 'verify' 
        : dialogType === 'tape' ? 'tape'
        : 'prune'
      
      // Pour prune, on a besoin du store dans l'URL
      let url

      if (dialogMode === 'create') {
        url = `/api/v1/pbs/${encodeURIComponent(selectedPbs)}/jobs/${endpoint}`
      } else {
        url = `/api/v1/pbs/${encodeURIComponent(selectedPbs)}/jobs/${endpoint}/${encodeURIComponent(editingJob.id)}`


        // Pour prune, ajouter le store en query param pour le DELETE
        if (dialogType === 'prune') {
          url += `?store=${encodeURIComponent(formData.store)}`
        }
      }
      
      const res = await fetch(url, {
        method: dialogMode === 'create' ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      })
      
      const json = await res.json()
      
      if (json.error) {
        setError(json.error)
      } else {
        setDialogOpen(false)
        loadJobs()
      }
    } catch (e) {
      setError(e.message || t('backups.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteClick = (job) => {
    setJobToDelete(job)
    setDeleteDialogOpen(true)
  }

  const handleDeleteConfirm = async () => {
    if (!jobToDelete) return

    setDeleting(true)

    try {
      const endpoint = jobToDelete.type === 'sync' ? 'sync'
        : jobToDelete.type === 'verify' ? 'verify'
        : jobToDelete.type === 'tape' ? 'tape'
        : 'prune'

      let url = `/api/v1/pbs/${encodeURIComponent(selectedPbs)}/jobs/${endpoint}/${encodeURIComponent(jobToDelete.id)}`

      // Pour prune, on a besoin du store en query param
      if (jobToDelete.type === 'prune') {
        const store = jobToDelete.store || jobToDelete.datastore

        url += `?store=${encodeURIComponent(store)}`
      }

      const res = await fetch(url, { method: 'DELETE' })

      const json = await res.json()

      if (json.error) {
        setError(json.error)
      } else {
        loadJobs()
      }
    } catch (e) {
      setError(e.message || t('backups.deleteError'))
    } finally {
      setDeleting(false)
      setDeleteDialogOpen(false)
      setJobToDelete(null)
    }
  }

  const handleRunNow = async (job) => {
    try {
      const endpoint = job.type === 'sync' ? 'sync' 
        : job.type === 'verify' ? 'verify' 
        : job.type === 'prune' ? 'prune' 
        : job.type === 'tape' ? 'tape'
        : 'gc'

      const res = await fetch(
        `/api/v1/pbs/${encodeURIComponent(selectedPbs)}/jobs/${endpoint}/${encodeURIComponent(job.id)}/run`,
        { method: 'POST' }
      )
      
      const json = await res.json()
      
      if (json.error) {
        setError(json.error)
      }
    } catch (e) {
      setError(e.message || t('common.error'))
    }
  }

  const filteredJobs = jobs 
    ? (selectedType === 'all' ? jobs.all : jobs[selectedType] || [])
    : []

  const columns = [
    {
      field: 'type',
      headerName: t('backups.jobType'),
      width: 85,
      renderCell: (params) => <JobTypeChip type={params.value} />
    },
    {
      field: 'enabled',
      headerName: '',
      width: 40,
      renderCell: (params) => (
        <Tooltip title={params.value !== false ? t('common.enabled') : t('common.disabled')}>
          <i
            className={params.value !== false ? 'ri-checkbox-circle-fill' : 'ri-close-circle-line'}
            style={{ fontSize: 16, color: params.value !== false ? theme.palette.success.main : theme.palette.text.disabled }}
          />
        </Tooltip>
      )
    },
    {
      field: 'id',
      headerName: 'ID',
      width: 180,
      renderCell: (params) => (
        <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          <Typography variant="body2" noWrap title={params.value}>
            {params.value}
          </Typography>
        </Box>
      )
    },
    {
      field: 'store',
      headerName: t('backups.datastore'),
      width: 130,
      valueGetter: (value, row) => row.store || row.datastore || '—'
    },
    {
      field: 'ns',
      headerName: 'Namespace',
      width: 100,
      renderCell: (params) => (
        <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          {params.value 
            ? <Chip size="small" label={params.value} variant="outlined" sx={{ height: 22, fontSize: '0.7rem' }} />
            : <Typography variant="body2" sx={{ opacity: 0.4 }}>—</Typography>
          }
        </Box>
      )
    },
    {
      field: 'schedule',
      headerName: t('backups.planification'),
      width: 120,
      renderCell: (params) => (
        <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          {params.value
            ? <Chip size="small" label={params.value} variant="outlined" sx={{ height: 22, fontSize: '0.7rem' }} />
            : <Typography variant="body2" sx={{ opacity: 0.4 }}>{t('backups.manual')}</Typography>
          }
        </Box>
      )
    },
    {
      field: 'lastRunState',
      headerName: t('backups.lastState'),
      width: 100,
      renderCell: (params) => (
        <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          <StatusChip state={params.value} t={t} />
        </Box>
      )
    },
    {
      field: 'lastRunEndtime',
      headerName: t('backups.lastExecution'),
      width: 140,
      renderCell: (params) => (
        <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          <Typography variant="body2" sx={{ opacity: params.value ? 1 : 0.4, fontSize: '0.8rem' }}>
            {formatDate(params.value, dateLocale)}
          </Typography>
        </Box>
      )
    },
    {
      field: 'nextRun',
      headerName: t('backups.nextExecution'),
      width: 140,
      renderCell: (params) => (
        <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          <Typography variant="body2" sx={{ opacity: params.value ? 1 : 0.4, fontSize: '0.8rem' }}>
            {formatDate(params.value, dateLocale)}
          </Typography>
        </Box>
      )
    },
    {
      field: 'comment',
      headerName: t('network.comment'),
      flex: 1,
      minWidth: 100,
      renderCell: (params) => (
        <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          <Typography variant="body2" noWrap sx={{ opacity: params.value ? 1 : 0.4 }} title={params.value}>
            {params.value || '—'}
          </Typography>
        </Box>
      )
    },
    {
      field: 'actions',
      headerName: '',
      width: 100,
      sortable: false,
      renderCell: (params) => {
        const jobType = params.row.type
        const isEnabled = params.row.enabled !== false
        const isRunning = params.row.lastRunState === 'running' || params.row.lastRunState === 'RUNNING'
        const canEdit = ['sync', 'verify', 'prune', 'tape'].includes(jobType)
        const canDelete = ['sync', 'verify', 'prune', 'tape'].includes(jobType)
        const canRun = ['sync', 'verify', 'prune', 'gc', 'tape'].includes(jobType) && !isRunning

        return (
          <Stack direction="row" spacing={0}>
            <Tooltip title={isRunning ? t('backups.running') + '...' : t('backups.runNow')}>
              <span>
                <IconButton
                  size="small"
                  onClick={() => handleRunNow(params.row)}
                  disabled={!canRun}
                  sx={{ opacity: canRun ? 1 : 0.3 }}
                >
                  <i className={isRunning ? 'ri-loader-4-line ri-spin' : 'ri-play-line'} style={{ fontSize: 15 }} />
                </IconButton>
              </span>
            </Tooltip>
            {canEdit && (
              <Tooltip title={t('common.edit')}>
                <IconButton size="small" onClick={() => handleEdit(params.row)}>
                  <i className="ri-edit-line" style={{ fontSize: 15 }} />
                </IconButton>
              </Tooltip>
            )}
            {canDelete && (
              <Tooltip title={t('common.delete')}>
                <IconButton size="small" color="error" onClick={() => handleDeleteClick(params.row)} sx={{ opacity: 0.7, '&:hover': { opacity: 1 } }}>
                  <i className="ri-delete-bin-line" style={{ fontSize: 15 }} />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
        )
      }
    }
  ]

  if (pbsConnections.length === 0) {
    return (
      <Alert severity="info">
        {t('backups.noPbsServerConfigured')}
      </Alert>
    )
  }

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 2 }}>
        <Box sx={{ display: 'flex', gap: 2 }}>
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

          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>{t('backups.jobType')}</InputLabel>
            <Select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              label={t('backups.jobType')}
            >
              <MenuItem value="all">{t('common.all')} ({stats?.total || 0})</MenuItem>
              <MenuItem value="sync">Sync ({stats?.byType?.sync || 0})</MenuItem>
              <MenuItem value="verify">Verify ({stats?.byType?.verify || 0})</MenuItem>
              <MenuItem value="prune">Prune ({stats?.byType?.prune || 0})</MenuItem>
              <MenuItem value="gc">GC ({stats?.byType?.gc || 0})</MenuItem>
              <MenuItem value="tape">Tape ({stats?.byType?.tape || 0})</MenuItem>
            </Select>
          </FormControl>
        </Box>
        
        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
          {/* Boutons de création par type */}
          <Tooltip title={t('backups.createSyncJob')}>
            <IconButton
              size="small"
              onClick={() => handleCreate('sync')}
              disabled={!selectedPbs}
              sx={{ color: '#2196F3' }}
            >
              <i className="ri-refresh-line" style={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('backups.createVerifyJob')}>
            <IconButton
              size="small"
              onClick={() => handleCreate('verify')}
              disabled={!selectedPbs}
              sx={{ color: '#4CAF50' }}
            >
              <i className="ri-shield-check-line" style={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('backups.createPruneJob')}>
            <IconButton
              size="small"
              onClick={() => handleCreate('prune')}
              disabled={!selectedPbs}
              sx={{ color: '#FF9800' }}
            >
              <i className="ri-scissors-cut-line" style={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('backups.createTapeJob')}>
            <IconButton
              size="small"
              onClick={() => handleCreate('tape')}
              disabled={!selectedPbs}
              sx={{ color: '#795548' }}
            >
              <i className="ri-archive-drawer-line" style={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
          <Tooltip title={t('common.refresh')}>
            <IconButton onClick={loadJobs} disabled={loading || !selectedPbs} size="small">
              <i className={`ri-refresh-line ${loading ? 'ri-spin' : ''}`} style={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>
      
      {/* Stats */}
      {stats && (
        <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          <Chip size="small" color="success" label={`${stats.lastRunStates?.ok || 0} OK`} variant="outlined" />
          <Chip size="small" color="error" label={t('backups.errorsCount', { count: stats.lastRunStates?.error || 0 })} variant="outlined" />
          <Chip size="small" color="warning" label={t('backups.warningsCount', { count: stats.lastRunStates?.warning || 0 })} variant="outlined" />
        </Box>
      )}
      
      {loading && <LinearProgress sx={{ mb: 2 }} />}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      
      {/* Table */}
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
          '& .MuiDataGrid-cell': { borderColor: 'divider' },
          '& .MuiDataGrid-columnHeaders': { bgcolor: 'action.hover', borderRadius: 1 }
        }}
        localeText={{
          noRowsLabel: t('backups.noJobFound'),
          MuiTablePagination: { labelRowsPerPage: t('backups.rowsPerPage') }
        }}
      />

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {dialogMode === 'create' ? t('backups.createJobType', { type: dialogType }) : t('backups.editJob', { type: dialogType })}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            {/* Common fields */}
            <TextField
              size="small"
              label={t('backups.jobId')}
              value={formData.id}
              onChange={(e) => setFormData(prev => ({ ...prev, id: e.target.value }))}
              disabled={dialogMode === 'edit'}
              placeholder="my-sync-job"
            />

            <FormControl fullWidth size="small">
              <InputLabel>{t('backups.datastore')}</InputLabel>
              <Select
                value={formData.store}
                onChange={(e) => setFormData(prev => ({ ...prev, store: e.target.value }))}
                label={t('backups.datastore')}
              >
                {datastores.map(ds => (
                  <MenuItem key={ds} value={ds}>{ds}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              size="small"
              label={t('backups.namespace')}
              value={formData.ns}
              onChange={(e) => setFormData(prev => ({ ...prev, ns: e.target.value }))}
              placeholder="production/web"
            />

            <TextField
              size="small"
              label={t('backups.planification')}
              value={formData.schedule}
              onChange={(e) => setFormData(prev => ({ ...prev, schedule: e.target.value }))}
              placeholder="daily 02:00"
              helperText="Ex: hourly, daily 02:00, mon..fri 03:00"
            />

            <TextField
              size="small"
              label={t('network.comment')}
              value={formData.comment}
              onChange={(e) => setFormData(prev => ({ ...prev, comment: e.target.value }))}
            />

            {/* Sync specific */}
            {dialogType === 'sync' && (
              <>
                <Divider />
                <Typography variant="subtitle2" fontWeight={600}>{t('backups.syncConfig')}</Typography>
                <TextField
                  size="small"
                  label={t('backups.remote')}
                  value={formData.remote}
                  onChange={(e) => setFormData(prev => ({ ...prev, remote: e.target.value }))}
                  placeholder="remote-name"
                />
                <TextField
                  size="small"
                  label={t('backups.remoteDatastore')}
                  value={formData.remoteStore}
                  onChange={(e) => setFormData(prev => ({ ...prev, remoteStore: e.target.value }))}
                />
                <TextField
                  size="small"
                  label={t('backups.remoteNamespace')}
                  value={formData.remoteNs}
                  onChange={(e) => setFormData(prev => ({ ...prev, remoteNs: e.target.value }))}
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={formData.removeVanished}
                      onChange={(e) => setFormData(prev => ({ ...prev, removeVanished: e.target.checked }))}
                    />
                  }
                  label={t('backups.removeVanished')}
                />
              </>
            )}

            {/* Verify specific */}
            {dialogType === 'verify' && (
              <>
                <Divider />
                <Typography variant="subtitle2" fontWeight={600}>{t('backups.verifyConfig')}</Typography>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={formData.ignoreVerified}
                      onChange={(e) => setFormData(prev => ({ ...prev, ignoreVerified: e.target.checked }))}
                    />
                  }
                  label={t('backups.ignoreVerified')}
                />
                <TextField
                  size="small"
                  label={t('backups.reVerifyAfter')}
                  type="number"
                  value={formData.outdatedAfter}
                  onChange={(e) => setFormData(prev => ({ ...prev, outdatedAfter: parseInt(e.target.value) || 30 }))}
                  inputProps={{ min: 1 }}
                />
              </>
            )}

            {/* Prune specific */}
            {dialogType === 'prune' && (
              <>
                <Divider />
                <Typography variant="subtitle2" fontWeight={600}>{t('backups.retentionPolicy')}</Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 2 }}>
                  <TextField
                    size="small"
                    label={t('backups.keepLast')}
                    type="number"
                    value={formData.keepLast}
                    onChange={(e) => setFormData(prev => ({ ...prev, keepLast: parseInt(e.target.value) || 0 }))}
                    inputProps={{ min: 0 }}
                  />
                  <TextField
                    size="small"
                    label={t('backups.keepDaily')}
                    type="number"
                    value={formData.keepDaily}
                    onChange={(e) => setFormData(prev => ({ ...prev, keepDaily: parseInt(e.target.value) || 0 }))}
                    inputProps={{ min: 0 }}
                  />
                  <TextField
                    size="small"
                    label={t('backups.keepWeekly')}
                    type="number"
                    value={formData.keepWeekly}
                    onChange={(e) => setFormData(prev => ({ ...prev, keepWeekly: parseInt(e.target.value) || 0 }))}
                    inputProps={{ min: 0 }}
                  />
                  <TextField
                    size="small"
                    label={t('backups.keepMonthly')}
                    type="number"
                    value={formData.keepMonthly}
                    onChange={(e) => setFormData(prev => ({ ...prev, keepMonthly: parseInt(e.target.value) || 0 }))}
                    inputProps={{ min: 0 }}
                  />
                  <TextField
                    size="small"
                    label={t('backups.keepYearly')}
                    type="number"
                    value={formData.keepYearly}
                    onChange={(e) => setFormData(prev => ({ ...prev, keepYearly: parseInt(e.target.value) || 0 }))}
                    inputProps={{ min: 0 }}
                  />
                </Box>
              </>
            )}

            {/* Tape specific */}
            {dialogType === 'tape' && (
              <>
                <Divider />
                <Typography variant="subtitle2" fontWeight={600}>{t('backups.tapeBackupConfig')}</Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                  <TextField
                    size="small"
                    label={t('backups.mediaPool')}
                    value={formData.pool}
                    onChange={(e) => setFormData(prev => ({ ...prev, pool: e.target.value }))}
                    placeholder="MediaPool"
                  />
                  <TextField
                    size="small"
                    label={t('backups.drive')}
                    value={formData.drive}
                    onChange={(e) => setFormData(prev => ({ ...prev, drive: e.target.value }))}
                    placeholder="drive0"
                  />
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={formData.ejectMedia}
                        onChange={(e) => setFormData(prev => ({ ...prev, ejectMedia: e.target.checked }))}
                      />
                    }
                    label={t('backups.ejectMedia')}
                  />
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={formData.exportMediaSet}
                        onChange={(e) => setFormData(prev => ({ ...prev, exportMediaSet: e.target.checked }))}
                      />
                    }
                    label={t('backups.exportMediaSet')}
                  />
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={formData.latestOnly}
                        onChange={(e) => setFormData(prev => ({ ...prev, latestOnly: e.target.checked }))}
                      />
                    }
                    label={t('backups.backupLatestOnly')}
                  />
                </Box>
              </>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={saving}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={saving || !formData.id || !formData.store || (dialogType === 'tape' && (!formData.pool || !formData.drive))}
            startIcon={saving ? <CircularProgress size={16} /> : null}
          >
            {dialogMode === 'create' ? t('common.create') : t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => !deleting && setDeleteDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-error-warning-line" style={{ fontSize: 24, color: theme.palette.error.main }} />
          {t('backups.confirmDeleteJobTitle')}
        </DialogTitle>
        <DialogContent>
          <Typography>{t('backups.confirmDeleteJobMessage')}</Typography>
          {jobToDelete && (
            <Box sx={{ mt: 2, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
              <Typography variant="body2" fontWeight={600}>{jobToDelete.id}</Typography>
              <Typography variant="caption" sx={{ opacity: 0.7 }}>
                {t('common.type')}: {jobToDelete.type} • Datastore: {jobToDelete.store || jobToDelete.datastore}
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleDeleteConfirm}
            disabled={deleting}
            startIcon={deleting ? <CircularProgress size={16} /> : <i className="ri-delete-bin-line" />}
          >
            {t('common.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

/* -----------------------------
  Main Component with Tabs
------------------------------ */

export default function BackupJobsTabs({ pveConnections = [], pbsConnections = [] }) {
  const theme = useTheme()
  const t = useTranslations()
  const [activeTab, setActiveTab] = useState(0)
  const [expanded, setExpanded] = useState(false)

  return (
    <Card variant="outlined">
      <CardContent sx={{ '&:last-child': { pb: expanded ? 2 : 1 } }}>
        <Box
          sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
          onClick={() => setExpanded(!expanded)}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className="ri-calendar-schedule-line" style={{ fontSize: 22, color: theme.palette.primary.main }} />
            <Typography variant="h6">{t('backups.backupJobs')}</Typography>
          </Box>
          <IconButton size="small">
            <i
              className={expanded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'}
              style={{ fontSize: 20 }}
            />
          </IconButton>
        </Box>

        <Collapse in={expanded}>
          <Tabs
            value={activeTab}
            onChange={(_, v) => setActiveTab(v)}
            sx={{ mt: 2, mb: 3, borderBottom: 1, borderColor: 'divider' }}
          >
            <Tab
              icon={<i className="ri-server-line" style={{ fontSize: 18 }} />}
              iconPosition="start"
              label={`PVE (${pveConnections.length})`}
            />
            <Tab
              icon={<i className="ri-archive-line" style={{ fontSize: 18 }} />}
              iconPosition="start"
              label={`PBS (${pbsConnections.length})`}
            />
          </Tabs>

          {activeTab === 0 && <PveJobsTab pveConnections={pveConnections} />}
          {activeTab === 1 && <PbsJobsTab pbsConnections={pbsConnections} />}
        </Collapse>
      </CardContent>
    </Card>
  )
}
