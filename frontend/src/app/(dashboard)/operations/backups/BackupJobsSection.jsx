'use client'

import { useEffect, useState, useCallback } from 'react'

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
import { useTranslations } from 'next-intl'

/* -----------------------------
  BackupJobsSection Component
------------------------------ */

export default function BackupJobsSection({ pveConnections = [] }) {
  const theme = useTheme()
  const t = useTranslations()

  // État principal
  const [selectedConnection, setSelectedConnection] = useState('')
  const [jobs, setJobs] = useState([])
  const [storages, setStorages] = useState([])
  const [nodes, setNodes] = useState([])
  const [vms, setVms] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  
  // Dialog
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogMode, setDialogMode] = useState('create') // 'create' | 'edit'
  const [editingJob, setEditingJob] = useState(null)
  const [saving, setSaving] = useState(false)
  
  // Dialog de confirmation de suppression
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [jobToDelete, setJobToDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  
  // Form state
  const [formData, setFormData] = useState({
    enabled: true,
    storage: '',
    schedule: '00:00',
    node: '', // vide = tous les nodes
    mode: 'snapshot',
    compress: 'zstd',
    selectionMode: 'all', // 'all' | 'include' | 'exclude'
    vmids: [],
    excludedVmids: [],
    comment: '',
    mailto: '',
    mailnotification: 'always',
    maxfiles: 1,
    namespace: '' // PBS namespace pour organiser les backups
  })

  // Charger les backup jobs quand on sélectionne une connexion
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
        setStorages(json.data?.storages || [])
        setNodes(json.data?.nodes || [])
      }
    } catch (e) {
      setError(e.message || t('errors.loadingError'))
    } finally {
      setLoading(false)
    }
  }, [selectedConnection])

  // Charger les VMs pour la sélection
  const loadVms = useCallback(async () => {
    if (!selectedConnection) return
    
    try {
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(selectedConnection)}/resources?type=vm`)
      const json = await res.json()
      
      if (!json.error) {
        // Combiner VMs et CTs
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

  // Auto-sélectionner la première connexion
  useEffect(() => {
    if (pveConnections.length > 0 && !selectedConnection) {
      setSelectedConnection(pveConnections[0].id)
    }
  }, [pveConnections, selectedConnection])

  // Ouvrir le dialog de création
  const handleCreate = () => {
    setFormData({
      enabled: true,
      storage: storages[0]?.id || '',
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

  // Ouvrir le dialog d'édition
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

  // Sauvegarder
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

  // Ouvrir le dialog de confirmation de suppression
  const handleDeleteClick = (job) => {
    setJobToDelete(job)
    setDeleteDialogOpen(true)
  }

  // Confirmer la suppression
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

  // Toggle enabled
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

  // Exécuter maintenant
  const handleRunNow = async (job) => {
    try {
      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(selectedConnection)}/backup-jobs/${encodeURIComponent(job.id)}?action=run`,
        { method: 'POST' }
      )
      
      const json = await res.json()
      
      if (json.error) {
        setError(json.error)
      } else {
        // Afficher un message de succès
        alert(t('backups.backupStartedAlert'))
      }
    } catch (e) {
      setError(e.message || t('common.error'))
    }
  }

  // Formater la sélection pour l'affichage
  const formatSelection = (job) => {
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

  // Colonnes du tableau
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
      renderCell: (params) => formatSelection(params.row)
    },
    {
      field: 'mode',
      headerName: t('backups.mode'),
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

  return (
    <Card variant="outlined">
      <CardContent>
        {/* Header */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <i className="ri-calendar-schedule-line" style={{ fontSize: 20, opacity: 0.7 }} />
            <Typography variant="subtitle1" fontWeight={700}>
              {t('backups.scheduledBackupJobs')}
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            {/* Sélecteur de connexion PVE */}
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <InputLabel>{t('backups.pveCluster')}</InputLabel>
              <Select
                value={selectedConnection}
                onChange={(e) => setSelectedConnection(e.target.value)}
                label={t('backups.pveCluster')}
                disabled={pveConnections.length === 0}
              >
                {pveConnections.map(conn => (
                  <MenuItem key={conn.id} value={conn.id}>{conn.name}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <Button
              variant="contained"
              size="small"
              startIcon={<i className="ri-add-line" />}
              onClick={handleCreate}
              disabled={!selectedConnection || loading}
            >
              {t('common.add')}
            </Button>
          </Box>
        </Box>

        {/* Error */}
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* Tableau des jobs */}
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : jobs.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 4, opacity: 0.5 }}>
            <i className="ri-calendar-todo-line" style={{ fontSize: 48, marginBottom: 8 }} />
            <Typography>{t('backups.noJobConfigured')}</Typography>
            {selectedConnection && (
              <Button
                variant="outlined"
                size="small"
                sx={{ mt: 2 }}
                onClick={handleCreate}
              >
                {t('backups.createFirstJob')}
              </Button>
            )}
          </Box>
        ) : (
          <DataGrid
            rows={jobs}
            columns={columns}
            autoHeight
            disableRowSelectionOnClick
            pageSizeOptions={[5, 10, 25]}
            initialState={{
              pagination: { paginationModel: { pageSize: 5 } }
            }}
            sx={{
              border: 'none',
              '& .MuiDataGrid-cell': { borderBottom: '1px solid', borderColor: 'divider' },
              '& .MuiDataGrid-columnHeaders': { bgcolor: 'action.hover' }
            }}
          />
        )}
      </CardContent>

      {/* Dialog de création/édition */}
      <Dialog
        open={dialogOpen}
        onClose={() => !saving && setDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          {dialogMode === 'create' ? t('backups.createBackupJob') : t('backups.editBackupJob')}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            {/* Ligne 1: Storage, Namespace, Schedule, Node */}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr 1fr 1fr' }, gap: 2 }}>
              <FormControl fullWidth size="small">
                <InputLabel>{t('backups.storageRequired')}</InputLabel>
                <Select
                  value={formData.storage}
                  onChange={(e) => setFormData(prev => ({ ...prev, storage: e.target.value }))}
                  label={t('backups.storageRequired')}
                >
                  {storages.map(s => (
                    <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              
              <TextField
                size="small"
                label={t('backups.namespace')}
                value={formData.namespace}
                onChange={(e) => setFormData(prev => ({ ...prev, namespace: e.target.value }))}
                placeholder="ex: production/web"
                helperText={t('backups.namespacePbsHelp')}
              />

              <TextField
                size="small"
                label={t('backups.scheduleTime')}
                value={formData.schedule}
                onChange={(e) => setFormData(prev => ({ ...prev, schedule: e.target.value }))}
                placeholder="00:00 ou */6:00"
                helperText={t('backups.scheduleHelp')}
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

            {/* Ligne 2: Mode, Compression, Enabled */}
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

            <Divider sx={{ my: 1 }} />

            {/* Sélection des VMs */}
            <Typography variant="subtitle2" fontWeight={600}>
              {t('backups.vmSelection')}
            </Typography>

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
                  renderInput={(params) => (
                    <TextField {...params} label={t('backups.vmsToInclude')} placeholder={t('common.select')} />
                  )}
                  renderTags={(value, getTagProps) =>
                    value.map((option, index) => (
                      <Chip
                        size="small"
                        label={`${option.vmid}`}
                        {...getTagProps({ index })}
                        key={option.vmid}
                      />
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
                  renderInput={(params) => (
                    <TextField {...params} label={t('backups.vmsToExclude')} placeholder={t('common.select')} />
                  )}
                  renderTags={(value, getTagProps) =>
                    value.map((option, index) => (
                      <Chip
                        size="small"
                        label={`${option.vmid}`}
                        color="error"
                        variant="outlined"
                        {...getTagProps({ index })}
                        key={option.vmid}
                      />
                    ))
                  }
                />
              )}
            </Box>

            <Divider sx={{ my: 1 }} />

            {/* Options avancées */}
            <Typography variant="subtitle2" fontWeight={600}>
              {t('backups.options')}
            </Typography>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
              <TextField
                size="small"
                label={t('network.comment')}
                value={formData.comment}
                onChange={(e) => setFormData(prev => ({ ...prev, comment: e.target.value }))}
                placeholder={t('backups.jobDescription')}
              />

              <TextField
                size="small"
                label={t('backups.retentionBackupCount')}
                type="number"
                value={formData.maxfiles}
                onChange={(e) => setFormData(prev => ({ ...prev, maxfiles: parseInt(e.target.value) || 1 }))}
                inputProps={{ min: 1 }}
              />
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
              <TextField
                size="small"
                label={t('backups.notificationEmail')}
                type="email"
                value={formData.mailto}
                onChange={(e) => setFormData(prev => ({ ...prev, mailto: e.target.value }))}
                placeholder="admin@example.com"
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
          <Button onClick={() => setDialogOpen(false)} disabled={saving}>
            {t('common.cancel')}
          </Button>
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

      {/* Dialog de confirmation de suppression */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => !deleting && setDeleteDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-error-warning-line" style={{ fontSize: 24, color: theme.palette.error.main }} />
          {t('backups.confirmDeleteJobTitle')}
        </DialogTitle>
        <DialogContent>
          <Typography>
            {t('backups.deleteJobConfirm')}
          </Typography>
          {jobToDelete && (
            <Box sx={{ mt: 2, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {jobToDelete.comment || t('backups.noComment')}
              </Typography>
              <Typography variant="caption" sx={{ opacity: 0.7 }}>
                Storage: {jobToDelete.storage} • {t('backups.scheduleTime')}: {jobToDelete.schedule}
              </Typography>
            </Box>
          )}
          <Typography variant="body2" sx={{ mt: 2, color: 'warning.main' }}>
            {t('backups.thisActionIrreversible')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setDeleteDialogOpen(false)}
            disabled={deleting}
          >
            {t('common.cancel')}
          </Button>
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
    </Card>
  )
}
