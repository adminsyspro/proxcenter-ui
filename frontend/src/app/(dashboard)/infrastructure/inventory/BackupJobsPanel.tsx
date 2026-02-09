'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { DataGrid, GridColDef } from '@mui/x-data-grid'
import { useTranslations } from 'next-intl'

interface BackupJob {
  id: string
  enabled: boolean
  schedule: string
  storage: string
  node?: string
  mode: string
  compress: string
  comment?: string
  mailto?: string
  mailnotification?: string
  maxfiles?: number
  all?: number | boolean
  vmid?: string
  exclude?: string
  'prune-backups'?: string
  namespace?: string
  [key: string]: any
}

interface BackupJobsPanelProps {
  connectionId: string
  onError?: (error: string) => void
}

export default function BackupJobsPanel({ connectionId, onError }: BackupJobsPanelProps) {
  const t = useTranslations()

  // États
  const [jobs, setJobs] = useState<BackupJob[]>([])
  const [storages, setStorages] = useState<any[]>([])
  const [nodes, setNodes] = useState<any[]>([])
  const [vms, setVms] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Dialog
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create')
  const [dialogTab, setDialogTab] = useState(0)
  const [editingJob, setEditingJob] = useState<BackupJob | null>(null)
  const [saving, setSaving] = useState(false)

  // Dialog de suppression
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [jobToDelete, setJobToDelete] = useState<BackupJob | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Form state
  const [formData, setFormData] = useState({
    enabled: true,
    storage: '',
    schedule: '00:00',
    node: '',
    mode: 'snapshot',
    compress: 'zstd',
    selectionMode: 'all' as 'all' | 'include' | 'exclude',
    vmids: [] as number[],
    excludedVmids: [] as number[],
    comment: '',
    mailto: '',
    mailnotification: 'always',
    maxfiles: 1,
    namespace: ''
  })

  // Charger les jobs
  const loadJobs = useCallback(async () => {
    if (!connectionId) return

    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(connectionId)}/backup-jobs`)
      const json = await res.json()

      if (json.error) {
        setError(json.error)
        onError?.(json.error)
      } else {
        // Parser les jobs pour extraire les infos
        const parsedJobs = (json.data?.jobs || []).map((job: any) => {
          let selectionMode = 'all'
          let vmids: number[] = []
          let excludedVmids: number[] = []

          if (job.all === 1 || job.all === true) {
            selectionMode = 'all'
            if (job.exclude) {
              excludedVmids = String(job.exclude).split(',').map((v: string) => parseInt(v.trim())).filter((v: number) => !isNaN(v))
            }
          } else if (job.vmid) {
            selectionMode = 'include'
            vmids = String(job.vmid).split(',').map((v: string) => parseInt(v.trim())).filter((v: number) => !isNaN(v))
          }

          return {
            ...job,
            selectionMode,
            vmids,
            excludedVmids
          }
        })

        setJobs(parsedJobs)
        setStorages(json.data?.storages || [])
        setNodes(json.data?.nodes || [])
      }
    } catch (e: any) {
      const msg = e?.message || 'Failed to load backup jobs'
      setError(msg)
      onError?.(msg)
    } finally {
      setLoading(false)
    }
  }, [connectionId, onError])

  // Charger les VMs
  const loadVms = useCallback(async () => {
    if (!connectionId) return

    try {
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(connectionId)}/resources?type=vm`)
      const json = await res.json()

      if (!json.error) {
        const allVms = (json.data || []).filter((r: any) => r.type === 'qemu' || r.type === 'lxc')
        setVms(allVms.map((vm: any) => ({
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
  }, [connectionId])

  useEffect(() => {
    if (connectionId) {
      loadJobs()
      loadVms()
    }
  }, [connectionId, loadJobs, loadVms])

  // Créer un job
  const handleCreate = () => {
    setFormData({
      enabled: true,
      storage: storages[0]?.storage || '',
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
    setDialogTab(0)
    setEditingJob(null)
    setDialogOpen(true)
  }

  // Éditer un job
  const handleEdit = (job: BackupJob) => {
    setFormData({
      enabled: Boolean(job.enabled),
      storage: job.storage || '',
      schedule: job.schedule || '00:00',
      node: job.node || '',
      mode: job.mode || 'snapshot',
      compress: job.compress || 'zstd',
      selectionMode: (job as any).selectionMode || 'all',
      vmids: (job as any).vmids || [],
      excludedVmids: (job as any).excludedVmids || [],
      comment: job.comment || '',
      mailto: job.mailto || '',
      mailnotification: job.mailnotification || 'always',
      maxfiles: job.maxfiles || 1,
      namespace: job.namespace || ''
    })
    setDialogMode('edit')
    setDialogTab(0)
    setEditingJob(job)
    setDialogOpen(true)
  }

  // Sauvegarder
  const handleSave = async () => {
    setSaving(true)
    setError(null)

    try {
      const url = dialogMode === 'create'
        ? `/api/v1/connections/${encodeURIComponent(connectionId)}/backup-jobs`
        : `/api/v1/connections/${encodeURIComponent(connectionId)}/backup-jobs/${encodeURIComponent(editingJob?.id || '')}`

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
    } catch (e: any) {
      setError(e?.message || 'Failed to save backup job')
    } finally {
      setSaving(false)
    }
  }

  // Supprimer
  const handleDelete = async () => {
    if (!jobToDelete) return

    setDeleting(true)

    try {
      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(connectionId)}/backup-jobs/${encodeURIComponent(jobToDelete.id)}`,
        { method: 'DELETE' }
      )

      const json = await res.json()

      if (json.error) {
        setError(json.error)
      } else {
        setDeleteDialogOpen(false)
        setJobToDelete(null)
        loadJobs()
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to delete backup job')
    } finally {
      setDeleting(false)
    }
  }

  // Toggle enabled
  const handleToggleEnabled = async (job: BackupJob) => {
    try {
      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(connectionId)}/backup-jobs/${encodeURIComponent(job.id)}`,
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

  // Run now
  const handleRunNow = async (job: BackupJob) => {
    try {
      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(connectionId)}/backup-jobs/${encodeURIComponent(job.id)}/run`,
        { method: 'POST' }
      )

      const json = await res.json()

      if (json.error) {
        setError(json.error)
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to run backup job')
    }
  }

  // Formater la sélection
  const formatSelection = (job: any) => {
    if (job.selectionMode === 'all') {
      if (job.excludedVmids?.length > 0) {
        return `All except ${job.excludedVmids.length}`
      }
      return 'All VMs'
    }

    if (job.selectionMode === 'include') {
      return `${job.vmids?.length || 0} VMs`
    }

    return '—'
  }

  // Calculer le prochain run
  const getNextRun = (schedule: string) => {
    if (!schedule) return '—'
    
    const now = new Date()
    const [hours, minutes] = schedule.split(':').map(Number)
    const next = new Date(now)
    next.setHours(hours, minutes, 0, 0)
    
    if (next <= now) {
      next.setDate(next.getDate() + 1)
    }
    
    return next.toLocaleString('fr-FR', { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric',
      hour: '2-digit', 
      minute: '2-digit' 
    })
  }

  // Colonnes
  const columns: GridColDef[] = [
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
      field: 'node',
      headerName: 'Node',
      width: 120,
      renderCell: (params) => params.value || <Typography sx={{ opacity: 0.5, fontSize: 12 }}>— All —</Typography>
    },
    {
      field: 'schedule',
      headerName: 'Schedule',
      width: 80,
      renderCell: (params) => (
        <Chip size="small" label={params.value} variant="outlined" sx={{ fontSize: 11 }} />
      )
    },
    {
      field: 'nextRun',
      headerName: 'Next Run',
      width: 150,
      renderCell: (params) => (
        <Typography variant="caption">{getNextRun(params.row.schedule)}</Typography>
      )
    },
    {
      field: 'storage',
      headerName: 'Storage',
      width: 130
    },
    {
      field: 'selection',
      headerName: 'Selection',
      width: 120,
      renderCell: (params) => formatSelection(params.row)
    },
    {
      field: 'comment',
      headerName: 'Comment',
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
          <Tooltip title="Run now">
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
            <IconButton size="small" color="error" onClick={() => { setJobToDelete(params.row); setDeleteDialogOpen(true) }}>
              <i className="ri-delete-bin-line" style={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        </Stack>
      )
    }
  ]

  return (
    <Box sx={{ p: 2 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-calendar-schedule-line" style={{ fontSize: 20, opacity: 0.7 }} />
          Backup Jobs
        </Typography>
        <Button
          variant="contained"
          size="small"
          startIcon={<i className="ri-add-line" />}
          onClick={handleCreate}
          disabled={loading}
        >
          {t('common.add')}
        </Button>
      </Box>

      {/* Error */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Content */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      ) : jobs.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 4, opacity: 0.5 }}>
          <i className="ri-calendar-todo-line" style={{ fontSize: 48, marginBottom: 8 }} />
          <Typography>No backup job configured</Typography>
          <Button
            variant="outlined"
            size="small"
            sx={{ mt: 2 }}
            onClick={handleCreate}
          >
            Create first job
          </Button>
        </Box>
      ) : (
        <DataGrid
          rows={jobs}
          columns={columns}
          autoHeight
          disableRowSelectionOnClick
          pageSizeOptions={[5, 10, 25]}
          initialState={{
            pagination: { paginationModel: { pageSize: 10 } }
          }}
          sx={{
            border: 'none',
            '& .MuiDataGrid-cell': { borderBottom: '1px solid', borderColor: 'divider' },
            '& .MuiDataGrid-columnHeaders': { bgcolor: 'action.hover' }
          }}
        />
      )}

      {/* Dialog Create/Edit */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className={dialogMode === 'create' ? 'ri-add-line' : 'ri-edit-line'} />
          {dialogMode === 'create' ? 'Create Backup Job' : 'Edit Backup Job'}
        </DialogTitle>
        <DialogContent>
          <Tabs value={dialogTab} onChange={(_, v) => setDialogTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
            <Tab label="General" />
            <Tab label="Retention" />
            <Tab label="Advanced" />
          </Tabs>

          {/* Tab General */}
          {dialogTab === 0 && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                <FormControl size="small" fullWidth>
                  <InputLabel>Node</InputLabel>
                  <Select
                    value={formData.node}
                    onChange={(e) => setFormData(prev => ({ ...prev, node: e.target.value }))}
                    label="Node"
                  >
                    <MenuItem value="">— All —</MenuItem>
                    {nodes.map(n => (
                      <MenuItem key={n.node || n.name} value={n.node || n.name}>{n.node || n.name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl size="small" fullWidth>
                  <InputLabel>Storage</InputLabel>
                  <Select
                    value={formData.storage}
                    onChange={(e) => setFormData(prev => ({ ...prev, storage: e.target.value }))}
                    label="Storage"
                  >
                    {storages.map(s => (
                      <MenuItem key={s.storage} value={s.storage}>{s.storage}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>

              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                <TextField
                  size="small"
                  label="Schedule"
                  value={formData.schedule}
                  onChange={(e) => setFormData(prev => ({ ...prev, schedule: e.target.value }))}
                  placeholder="HH:MM"
                  helperText="Format: HH:MM (e.g., 02:00)"
                />

                <FormControl size="small" fullWidth>
                  <InputLabel>Selection Mode</InputLabel>
                  <Select
                    value={formData.selectionMode}
                    onChange={(e) => setFormData(prev => ({ ...prev, selectionMode: e.target.value as any }))}
                    label="Selection Mode"
                  >
                    <MenuItem value="all">All VMs</MenuItem>
                    <MenuItem value="include">Include selected VMs</MenuItem>
                    <MenuItem value="exclude">Exclude selected VMs</MenuItem>
                  </Select>
                </FormControl>
              </Box>

              {formData.selectionMode === 'include' && (
                <Autocomplete
                  multiple
                  size="small"
                  options={vms}
                  getOptionLabel={(option) => `${option.vmid} - ${option.name}`}
                  value={vms.filter(vm => formData.vmids.includes(vm.vmid))}
                  onChange={(_, newValue) => setFormData(prev => ({ ...prev, vmids: newValue.map(v => v.vmid) }))}
                  renderInput={(params) => <TextField {...params} label="Select VMs" />}
                  renderOption={(props, option) => (
                    <li {...props}>
                      <Chip 
                        size="small" 
                        label={option.type === 'qemu' ? 'VM' : 'CT'} 
                        sx={{ mr: 1, fontSize: 10 }}
                        color={option.type === 'qemu' ? 'primary' : 'secondary'}
                      />
                      {option.vmid} - {option.name}
                    </li>
                  )}
                />
              )}

              {formData.selectionMode === 'exclude' && (
                <Autocomplete
                  multiple
                  size="small"
                  options={vms}
                  getOptionLabel={(option) => `${option.vmid} - ${option.name}`}
                  value={vms.filter(vm => formData.excludedVmids.includes(vm.vmid))}
                  onChange={(_, newValue) => setFormData(prev => ({ ...prev, excludedVmids: newValue.map(v => v.vmid) }))}
                  renderInput={(params) => <TextField {...params} label="Exclude VMs" />}
                  renderOption={(props, option) => (
                    <li {...props}>
                      <Chip 
                        size="small" 
                        label={option.type === 'qemu' ? 'VM' : 'CT'} 
                        sx={{ mr: 1, fontSize: 10 }}
                        color={option.type === 'qemu' ? 'primary' : 'secondary'}
                      />
                      {option.vmid} - {option.name}
                    </li>
                  )}
                />
              )}

              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                <FormControl size="small" fullWidth>
                  <InputLabel>Compression</InputLabel>
                  <Select
                    value={formData.compress}
                    onChange={(e) => setFormData(prev => ({ ...prev, compress: e.target.value }))}
                    label="Compression"
                  >
                    <MenuItem value="0">None</MenuItem>
                    <MenuItem value="gzip">GZIP</MenuItem>
                    <MenuItem value="lzo">LZO</MenuItem>
                    <MenuItem value="zstd">ZSTD (fast and good)</MenuItem>
                  </Select>
                </FormControl>

                <FormControl size="small" fullWidth>
                  <InputLabel>Mode</InputLabel>
                  <Select
                    value={formData.mode}
                    onChange={(e) => setFormData(prev => ({ ...prev, mode: e.target.value }))}
                    label="Mode"
                  >
                    <MenuItem value="snapshot">Snapshot</MenuItem>
                    <MenuItem value="suspend">Suspend</MenuItem>
                    <MenuItem value="stop">Stop</MenuItem>
                  </Select>
                </FormControl>
              </Box>

              <FormControlLabel
                control={
                  <Checkbox
                    checked={formData.enabled}
                    onChange={(e) => setFormData(prev => ({ ...prev, enabled: e.target.checked }))}
                  />
                }
                label="Enable"
              />
            </Stack>
          )}

          {/* Tab Retention */}
          {dialogTab === 1 && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField
                size="small"
                type="number"
                label="Max backups to keep"
                value={formData.maxfiles}
                onChange={(e) => setFormData(prev => ({ ...prev, maxfiles: parseInt(e.target.value) || 1 }))}
                inputProps={{ min: 1 }}
                helperText="Number of backups to keep per VM"
              />

              <TextField
                size="small"
                label="PBS Namespace"
                value={formData.namespace}
                onChange={(e) => setFormData(prev => ({ ...prev, namespace: e.target.value }))}
                helperText="Optional namespace for PBS storage"
              />
            </Stack>
          )}

          {/* Tab Advanced */}
          {dialogTab === 2 && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField
                size="small"
                label="Comment"
                value={formData.comment}
                onChange={(e) => setFormData(prev => ({ ...prev, comment: e.target.value }))}
                multiline
                rows={2}
              />

              <TextField
                size="small"
                label="Email to"
                value={formData.mailto}
                onChange={(e) => setFormData(prev => ({ ...prev, mailto: e.target.value }))}
                placeholder="admin@example.com"
              />

              <FormControl size="small" fullWidth>
                <InputLabel>Send email</InputLabel>
                <Select
                  value={formData.mailnotification}
                  onChange={(e) => setFormData(prev => ({ ...prev, mailnotification: e.target.value }))}
                  label="Send email"
                >
                  <MenuItem value="always">Always</MenuItem>
                  <MenuItem value="failure">On failure only</MenuItem>
                  <MenuItem value="never">Never</MenuItem>
                </Select>
              </FormControl>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? <CircularProgress size={20} /> : dialogMode === 'create' ? t('common.create') : t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog Delete */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-delete-bin-line" style={{ color: 'red' }} />
          Delete Backup Job
        </DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete this backup job?
          </Typography>
          {jobToDelete && (
            <Box sx={{ mt: 2, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
              <Typography variant="body2"><strong>Schedule:</strong> {jobToDelete.schedule}</Typography>
              <Typography variant="body2"><strong>Storage:</strong> {jobToDelete.storage}</Typography>
              {jobToDelete.comment && <Typography variant="body2"><strong>Comment:</strong> {jobToDelete.comment}</Typography>}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>
            {t('common.cancel')}
          </Button>
          <Button variant="contained" color="error" onClick={handleDelete} disabled={deleting}>
            {deleting ? <CircularProgress size={20} /> : t('common.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
