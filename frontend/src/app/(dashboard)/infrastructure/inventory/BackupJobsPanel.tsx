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
  LinearProgress,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material'
import { DataGrid, GridColDef } from '@mui/x-data-grid'
import { useTranslations, useLocale } from 'next-intl'
import { formatBytes } from '@/utils/format'
import { getDateLocale } from '@/lib/i18n/date'

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

function parsePruneBackups(raw: string | null | undefined) {
  const result = { keepLast: '', keepHourly: '', keepDaily: '', keepWeekly: '', keepMonthly: '', keepYearly: '' }
  if (!raw) return result
  const str = typeof raw === 'string' ? raw : ''
  const pairs = str.split(',').map(s => s.trim())
  for (const pair of pairs) {
    const [k, v] = pair.split('=')
    if (k === 'keep-last') result.keepLast = v || ''
    if (k === 'keep-hourly') result.keepHourly = v || ''
    if (k === 'keep-daily') result.keepDaily = v || ''
    if (k === 'keep-weekly') result.keepWeekly = v || ''
    if (k === 'keep-monthly') result.keepMonthly = v || ''
    if (k === 'keep-yearly') result.keepYearly = v || ''
  }
  return result
}

export default function BackupJobsPanel({ connectionId, onError }: BackupJobsPanelProps) {
  const t = useTranslations()
  const dateLocale = getDateLocale(useLocale())
  const theme = useTheme()
  const pveLogoSrc = theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'

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

  // Dialog de detail
  const [detailJob, setDetailJob] = useState<BackupJob | null>(null)

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
    // Notifications
    notificationMode: 'notification-system' as string,
    mailto: '',
    mailnotification: 'always',
    // Retention
    keepAll: true,
    keepLast: '',
    keepHourly: '',
    keepDaily: '',
    keepWeekly: '',
    keepMonthly: '',
    keepYearly: '',
    // Note Template
    notesTemplate: '',
    // Advanced
    namespace: '',
    bwlimit: '',
    zstd: '',
    ioWorkers: '',
    fleecing: false,
    fleecingStorage: '',
    repeatMissed: false,
    pbsChangeDetectionMode: 'default' as 'default' | 'data' | 'metadata',
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
        // Les jobs sont déjà parsés par l'API (selectionMode, vmids, excludedVmids)
        // On s'assure juste que les vmids sont des nombres pour le formulaire
        const parsedJobs = (json.data?.jobs || []).map((job: any) => ({
          ...job,
          vmids: (job.vmids || []).map((v: any) => Number(v)).filter((v: number) => !isNaN(v)),
          excludedVmids: (job.excludedVmids || []).map((v: any) => Number(v)).filter((v: number) => !isNaN(v))
        }))

        setJobs(parsedJobs)
        setStorages(json.data?.storages || [])
        setNodes(json.data?.nodes || [])
      }
    } catch (e: any) {
      const msg = e?.message || t('inventory.failedToLoadBackupJobs')
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
      storage: storages[0]?.id || storages[0]?.storage || '',
      schedule: '00:00',
      node: '',
      mode: 'snapshot',
      compress: 'zstd',
      selectionMode: 'all',
      vmids: [],
      excludedVmids: [],
      comment: '',
      notificationMode: 'auto',
      mailto: '',
      mailnotification: 'always',
      keepAll: true,
      keepLast: '',
      keepHourly: '',
      keepDaily: '',
      keepWeekly: '',
      keepMonthly: '',
      keepYearly: '',
      notesTemplate: '{{guestname}}',
      namespace: '',
      bwlimit: '',
      zstd: '',
      ioWorkers: '',
      fleecing: false,
      fleecingStorage: '',
      repeatMissed: false,
      pbsChangeDetectionMode: 'default',
    })
    setDialogMode('create')
    setDialogTab(0)
    setEditingJob(null)
    setDialogOpen(true)
  }

  // Éditer un job
  const handleEdit = (job: BackupJob) => {
    // Parse prune-backups string if present
    const prune = parsePruneBackups((job as any).pruneBackups)
    const hasKeepValues = Object.values(prune).some(v => v !== '')

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
      notificationMode: ['auto', 'notification-system', 'legacy-sendmail'].includes((job as any).notificationMode) ? (job as any).notificationMode : 'auto',
      mailto: job.mailto || '',
      mailnotification: job.mailnotification || 'always',
      keepAll: !hasKeepValues,
      keepLast: prune.keepLast,
      keepHourly: prune.keepHourly,
      keepDaily: prune.keepDaily,
      keepWeekly: prune.keepWeekly,
      keepMonthly: prune.keepMonthly,
      keepYearly: prune.keepYearly,
      notesTemplate: (job as any).notesTemplate || (job as any)['notes-template'] || '',
      namespace: job.namespace || '',
      bwlimit: (job as any).bwlimit != null ? String((job as any).bwlimit) : '',
      zstd: (job as any).zstd != null ? String((job as any).zstd) : '',
      ioWorkers: ((job as any).ioWorkers ?? (job as any)['io-workers']) != null ? String((job as any).ioWorkers ?? (job as any)['io-workers']) : '',
      fleecing: Boolean((job as any).fleecing),
      fleecingStorage: (job as any).fleecingStorage || '',
      repeatMissed: Boolean((job as any).repeatMissed),
      pbsChangeDetectionMode: (job as any).pbsChangeDetectionMode || (job as any)['pbs-change-detection-mode'] || 'default',
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
      setError(e?.message || t('inventory.failedToSaveBackupJob'))
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
      setError(e?.message || t('inventory.failedToDeleteBackupJob'))
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
      setError(e?.message || t('inventory.failedToRunBackupJob'))
    }
  }

  // Formater la sélection
  const formatSelection = (job: any) => {
    if (job.selectionMode === 'all') {
      if (job.excludedVmids?.length > 0) {
        return t('inventory.allExceptCount', { count: job.excludedVmids.length })
      }
      return t('inventory.allVms')
    }

    if (job.selectionMode === 'include') {
      return t('inventory.vmCount', { count: job.vmids?.length || 0 })
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
    
    return next.toLocaleString(dateLocale, {
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric',
      hour: '2-digit', 
      minute: '2-digit' 
    })
  }

  // Colonnes
  const cellAlign = { display: 'flex', alignItems: 'center', height: '100%' }

  const columns: GridColDef[] = [
    {
      field: 'enabled',
      headerName: '',
      width: 50,
      sortable: false,
      renderCell: (params) => (
        <Box sx={cellAlign}>
          <Switch size="small" checked={params.value} onChange={() => handleToggleEnabled(params.row)} />
        </Box>
      )
    },
    {
      field: 'node',
      headerName: t('inventory.nodeHeader'),
      width: 130,
      renderCell: (params) => (
        <Box sx={{ ...cellAlign, gap: 1 }}>
          {params.value ? (
            <>
              <img src={pveLogoSrc} alt="" style={{ width: 14, height: 14 }} />
              <Typography variant="body2">{params.value}</Typography>
            </>
          ) : (
            <Typography variant="body2" sx={{ opacity: 0.5 }}>{t('inventory.allNodes')}</Typography>
          )}
        </Box>
      )
    },
    {
      field: 'schedule',
      headerName: t('inventory.scheduleHeader'),
      width: 120,
      renderCell: (params) => (
        <Box sx={cellAlign}>
          <Chip size="small" label={params.value} variant="outlined" sx={{ fontSize: 11, fontFamily: 'monospace' }} />
        </Box>
      )
    },
    {
      field: 'nextRun',
      headerName: t('inventory.nextRun'),
      width: 150,
      renderCell: (params) => (
        <Box sx={cellAlign}>
          <Typography variant="caption">{getNextRun(params.row.schedule)}</Typography>
        </Box>
      )
    },
    {
      field: 'storage',
      headerName: t('inventory.storageHeader'),
      width: 130,
      renderCell: (params) => (
        <Box sx={{ ...cellAlign, gap: 0.5 }}>
          <i className={params.row.isPbs ? 'ri-shield-check-line' : 'ri-hard-drive-2-line'} style={{ fontSize: 14, opacity: 0.6 }} />
          <Typography variant="body2">{params.value}</Typography>
        </Box>
      )
    },
    {
      field: 'selection',
      headerName: t('inventory.selectionHeader'),
      width: 120,
      renderCell: (params) => (
        <Box sx={cellAlign}>
          {formatSelection(params.row)}
        </Box>
      )
    },
    {
      field: 'comment',
      headerName: t('inventory.commentHeader'),
      flex: 1,
      minWidth: 150,
      renderCell: (params) => (
        <Box sx={{ ...cellAlign, overflow: 'hidden' }}>
          <Typography variant="body2" noWrap sx={{ opacity: 0.7 }}>{params.value || '-'}</Typography>
        </Box>
      )
    },
    {
      field: 'actions',
      headerName: '',
      width: 140,
      sortable: false,
      renderCell: (params) => (
        <Box sx={{ ...cellAlign, justifyContent: 'flex-end' }}>
          <Tooltip title={t('backup.jobDetail')}>
            <IconButton size="small" onClick={() => setDetailJob(params.row)}>
              <i className="ri-eye-line" style={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('inventory.runNow')}>
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
        </Box>
      )
    }
  ]

  return (
    <Box sx={{ p: 2 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-calendar-schedule-line" style={{ fontSize: 20, opacity: 0.7 }} />
          {t('inventory.backupJobs')}
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
          <Typography>{t('inventory.noBackupJobConfigured')}</Typography>
          <Button
            variant="outlined"
            size="small"
            sx={{ mt: 2 }}
            onClick={handleCreate}
          >
            {t('inventory.createFirstJob')}
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
          {dialogMode === 'create' ? t('inventory.createBackupJob') : t('inventory.editBackupJob')}
        </DialogTitle>
        <DialogContent>
          <Tabs value={dialogTab} onChange={(_, v) => setDialogTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
            <Tab label={t('inventory.tabGeneral')} />
            <Tab label={t('inventory.tabNotifications')} />
            <Tab label={t('inventory.tabRetention')} />
            <Tab label={t('inventory.tabNoteTemplate')} />
            <Tab label={t('inventory.tabAdvanced')} />
          </Tabs>

          {/* Tab General */}
          {dialogTab === 0 && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                <FormControl size="small" fullWidth>
                  <InputLabel>{t('inventory.nodeLabel')}</InputLabel>
                  <Select
                    value={formData.node}
                    onChange={(e) => setFormData(prev => ({ ...prev, node: e.target.value }))}
                    label={t('inventory.nodeLabel')}
                  >
                    <MenuItem value="">{t('inventory.allNodes')}</MenuItem>
                    {nodes.map(n => (
                      <MenuItem key={n.node || n.name} value={n.node || n.name}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <img src={pveLogoSrc} alt="" style={{ width: 14, height: 14 }} />
                          {n.node || n.name}
                        </Box>
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl size="small" fullWidth>
                  <InputLabel>{t('inventory.storageFormLabel')}</InputLabel>
                  <Select
                    value={formData.storage}
                    onChange={(e) => setFormData(prev => ({ ...prev, storage: e.target.value }))}
                    label={t('inventory.storageFormLabel')}
                  >
                    {storages.map(s => {
                      const usedPct = s.total > 0 ? Math.round((s.used / s.total) * 100) : 0
                      return (
                        <MenuItem key={s.id || s.storage} value={s.id || s.storage}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                            <i className={s.isPbs ? 'ri-shield-check-line' : 'ri-hard-drive-2-line'} style={{ fontSize: 14, opacity: 0.6 }} />
                            <Typography variant="body2">{s.name || s.id || s.storage}</Typography>
                            <Chip size="small" label={s.type} sx={{ height: 18, fontSize: 10, opacity: 0.7 }} />
                            {s.total > 0 && (
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 'auto' }}>
                                <LinearProgress
                                  variant="determinate"
                                  value={usedPct}
                                  sx={{
                                    width: 50, height: 6, borderRadius: 3,
                                    bgcolor: 'action.hover',
                                    '& .MuiLinearProgress-bar': {
                                      borderRadius: 3,
                                      bgcolor: usedPct > 90 ? 'error.main' : usedPct > 70 ? 'warning.main' : 'success.main',
                                    }
                                  }}
                                />
                                <Typography variant="caption" sx={{ fontSize: 10, opacity: 0.6, whiteSpace: 'nowrap' }}>
                                  {formatBytes(s.used)} / {formatBytes(s.total)}
                                </Typography>
                              </Box>
                            )}
                          </Box>
                        </MenuItem>
                      )
                    })}
                  </Select>
                </FormControl>
              </Box>

              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                <Autocomplete
                  freeSolo
                  size="small"
                  options={[
                    { label: t('inventory.scheduleEvery30min'), value: '*:00,30' },
                    { label: t('inventory.scheduleEveryHour'), value: '*:00' },
                    { label: t('inventory.scheduleEvery2hours'), value: '0/2:00' },
                    { label: t('inventory.scheduleEveryDay21'), value: '21:00' },
                    { label: t('inventory.scheduleEveryDay0230_2230'), value: '02:30,22:30' },
                    { label: t('inventory.scheduleMonFri0000'), value: 'mon..fri 00:00' },
                    { label: t('inventory.scheduleMonFriHourly'), value: 'mon..fri *:00' },
                    { label: t('inventory.scheduleMonFri0700_1845_15min'), value: 'mon..fri 07:00..18:45/15' },
                    { label: t('inventory.scheduleSunday0100'), value: 'sun 01:00' },
                    { label: t('inventory.scheduleFirstDayOfMonth'), value: '01 00:00' },
                    { label: t('inventory.scheduleFirstSatMonth1500'), value: 'sat 01..07 15:00' },
                    { label: t('inventory.scheduleFirstDayOfYear'), value: '01-01 00:00' },
                  ]}
                  getOptionLabel={(opt) => typeof opt === 'string' ? opt : opt.label}
                  value={formData.schedule}
                  onChange={(_, newValue) => {
                    const val = typeof newValue === 'string' ? newValue : newValue?.value || ''
                    setFormData(prev => ({ ...prev, schedule: val }))
                  }}
                  onInputChange={(_, newInput, reason) => {
                    if (reason === 'input') setFormData(prev => ({ ...prev, schedule: newInput }))
                  }}
                  renderOption={(props, option) => (
                    <li {...props}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%', gap: 2 }}>
                        <Typography variant="body2">{typeof option === 'string' ? option : option.label}</Typography>
                        <Typography variant="caption" sx={{ opacity: 0.5, fontFamily: 'monospace' }}>{typeof option === 'string' ? '' : option.value}</Typography>
                      </Box>
                    </li>
                  )}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label={t('inventory.scheduleFormLabel')}
                      placeholder="21:00"
                      helperText={t('inventory.scheduleHelperText')}
                    />
                  )}
                />

                <FormControl size="small" fullWidth>
                  <InputLabel>{t('inventory.selectionMode')}</InputLabel>
                  <Select
                    value={formData.selectionMode}
                    onChange={(e) => setFormData(prev => ({ ...prev, selectionMode: e.target.value as any }))}
                    label={t('inventory.selectionMode')}
                  >
                    <MenuItem value="all">{t('inventory.allVmsOption')}</MenuItem>
                    <MenuItem value="include">{t('inventory.includeSelectedVms')}</MenuItem>
                    <MenuItem value="exclude">{t('inventory.excludeSelectedVms')}</MenuItem>
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
                  renderInput={(params) => <TextField {...params} label={t('inventory.selectVms')} />}
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
                  renderInput={(params) => <TextField {...params} label={t('inventory.excludeVms')} />}
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
                  <InputLabel>{t('inventory.compression')}</InputLabel>
                  <Select
                    value={formData.compress}
                    onChange={(e) => setFormData(prev => ({ ...prev, compress: e.target.value }))}
                    label={t('inventory.compression')}
                  >
                    <MenuItem value="0">{t('inventory.compressionNone')}</MenuItem>
                    <MenuItem value="gzip">GZIP</MenuItem>
                    <MenuItem value="lzo">LZO</MenuItem>
                    <MenuItem value="zstd">{t('inventory.compressionZstd')}</MenuItem>
                  </Select>
                </FormControl>

                <FormControl size="small" fullWidth>
                  <InputLabel>{t('inventory.modeLabel')}</InputLabel>
                  <Select
                    value={formData.mode}
                    onChange={(e) => setFormData(prev => ({ ...prev, mode: e.target.value }))}
                    label={t('inventory.modeLabel')}
                  >
                    <MenuItem value="snapshot"><Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><i className="ri-camera-line" style={{ fontSize: 16, opacity: 0.7 }} />{t('inventory.modeSnapshot')}</Box></MenuItem>
                    <MenuItem value="suspend"><Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><i className="ri-pause-circle-line" style={{ fontSize: 16, opacity: 0.7 }} />{t('inventory.modeSuspend')}</Box></MenuItem>
                    <MenuItem value="stop"><Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><i className="ri-stop-circle-line" style={{ fontSize: 16, opacity: 0.7 }} />{t('inventory.modeStop')}</Box></MenuItem>
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
                label={t('inventory.enableLabel')}
              />
            </Stack>
          )}

          {/* Tab Retention */}
          {/* Tab Notifications */}
          {dialogTab === 1 && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <FormControl>
                <RadioGroup
                  value={formData.notificationMode}
                  onChange={(e) => setFormData(prev => ({ ...prev, notificationMode: e.target.value as any }))}
                >
                  <FormControlLabel value="auto" control={<Radio />} label={t('backup.notifAuto')} />
                  <FormControlLabel value="notification-system" control={<Radio />} label={t('backup.useGlobalNotifications')} />
                  <FormControlLabel value="legacy-sendmail" control={<Radio />} label={t('backup.useSendmail')} />
                </RadioGroup>
              </FormControl>

              {formData.notificationMode === 'legacy-sendmail' && (
                <>
                  <TextField
                    size="small"
                    label={t('backup.recipients')}
                    value={formData.mailto}
                    onChange={(e) => setFormData(prev => ({ ...prev, mailto: e.target.value }))}
                    placeholder="admin@example.com, ..."
                  />
                  <FormControl size="small" fullWidth>
                    <InputLabel>{t('backup.when')}</InputLabel>
                    <Select
                      value={formData.mailnotification}
                      onChange={(e) => setFormData(prev => ({ ...prev, mailnotification: e.target.value }))}
                      label={t('backup.when')}
                    >
                      <MenuItem value="always">{t('inventory.sendEmailAlways')}</MenuItem>
                      <MenuItem value="failure">{t('inventory.sendEmailFailure')}</MenuItem>
                    </Select>
                  </FormControl>
                </>
              )}
            </Stack>
          )}

          {/* Tab Retention */}
          {dialogTab === 2 && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={formData.keepAll}
                    onChange={(e) => setFormData(prev => ({
                      ...prev,
                      keepAll: e.target.checked,
                      ...(e.target.checked ? { keepLast: '', keepHourly: '', keepDaily: '', keepWeekly: '', keepMonthly: '', keepYearly: '' } : {})
                    }))}
                  />
                }
                label={t('backup.keepAllBackups')}
              />

              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, opacity: formData.keepAll ? 0.4 : 1, pointerEvents: formData.keepAll ? 'none' : 'auto' }}>
                <TextField size="small" type="number" label={t('backup.keepLast')} value={formData.keepLast} onChange={(e) => setFormData(prev => ({ ...prev, keepLast: e.target.value }))} inputProps={{ min: 0 }} />
                <TextField size="small" type="number" label={t('backup.keepHourly')} value={formData.keepHourly} onChange={(e) => setFormData(prev => ({ ...prev, keepHourly: e.target.value }))} inputProps={{ min: 0 }} />
                <TextField size="small" type="number" label={t('backup.keepDaily')} value={formData.keepDaily} onChange={(e) => setFormData(prev => ({ ...prev, keepDaily: e.target.value }))} inputProps={{ min: 0 }} />
                <TextField size="small" type="number" label={t('backup.keepWeekly')} value={formData.keepWeekly} onChange={(e) => setFormData(prev => ({ ...prev, keepWeekly: e.target.value }))} inputProps={{ min: 0 }} />
                <TextField size="small" type="number" label={t('backup.keepMonthly')} value={formData.keepMonthly} onChange={(e) => setFormData(prev => ({ ...prev, keepMonthly: e.target.value }))} inputProps={{ min: 0 }} />
                <TextField size="small" type="number" label={t('backup.keepYearly')} value={formData.keepYearly} onChange={(e) => setFormData(prev => ({ ...prev, keepYearly: e.target.value }))} inputProps={{ min: 0 }} />
              </Box>
            </Stack>
          )}

          {/* Tab Note Template */}
          {dialogTab === 3 && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField
                size="small"
                label={t('backup.backupNotes')}
                value={formData.notesTemplate}
                onChange={(e) => setFormData(prev => ({ ...prev, notesTemplate: e.target.value }))}
                multiline
                rows={4}
                placeholder="{{guestname}}"
              />
              <Typography variant="caption" sx={{ opacity: 0.6 }}>
                {t('backup.notesTemplateHelp')}
                <br />
                {t('backup.notesTemplateVars')}
              </Typography>
            </Stack>
          )}

          {/* Tab Advanced */}
          {dialogTab === 4 && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              {dialogMode === 'edit' && editingJob && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 100 }}>Job ID:</Typography>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', opacity: 0.7 }}>{editingJob.id}</Typography>
                </Box>
              )}

              <TextField
                size="small"
                label={t('inventory.commentLabel')}
                value={formData.comment}
                onChange={(e) => setFormData(prev => ({ ...prev, comment: e.target.value }))}
                multiline
                rows={2}
              />

              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                <TextField
                  size="small"
                  type="number"
                  label={t('backup.bandwidthLimit')}
                  value={formData.bwlimit}
                  onChange={(e) => setFormData(prev => ({ ...prev, bwlimit: e.target.value }))}
                  placeholder="Fallback"
                  helperText="MiB/s"
                  inputProps={{ min: 0 }}
                />
                <TextField
                  size="small"
                  type="number"
                  label={t('backup.zstdThreads')}
                  value={formData.zstd}
                  onChange={(e) => setFormData(prev => ({ ...prev, zstd: e.target.value }))}
                  placeholder="Fallback"
                  inputProps={{ min: 0 }}
                />
              </Box>

              <TextField
                size="small"
                type="number"
                label={t('backup.ioWorkers')}
                value={formData.ioWorkers}
                onChange={(e) => setFormData(prev => ({ ...prev, ioWorkers: e.target.value }))}
                placeholder="Fallback"
                helperText={t('backup.ioWorkersHelp')}
                inputProps={{ min: 0 }}
              />

              <FormControlLabel
                control={<Checkbox checked={formData.fleecing} onChange={(e) => setFormData(prev => ({ ...prev, fleecing: e.target.checked }))} />}
                label={t('backup.fleecing')}
              />
              {formData.fleecing && (
                <FormControl size="small" fullWidth>
                  <InputLabel>{t('backup.fleecingStorage')}</InputLabel>
                  <Select
                    value={formData.fleecingStorage}
                    onChange={(e) => setFormData(prev => ({ ...prev, fleecingStorage: e.target.value }))}
                    label={t('backup.fleecingStorage')}
                  >
                    {storages.map(s => (
                      <MenuItem key={s.id || s.storage} value={s.id || s.storage}>{s.name || s.id || s.storage}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}

              <FormControlLabel
                control={<Checkbox checked={formData.repeatMissed} onChange={(e) => setFormData(prev => ({ ...prev, repeatMissed: e.target.checked }))} />}
                label={t('backup.repeatMissed')}
              />

              <FormControl size="small" fullWidth>
                <InputLabel>{t('backup.pbsChangeDetection')}</InputLabel>
                <Select
                  value={formData.pbsChangeDetectionMode}
                  onChange={(e) => setFormData(prev => ({ ...prev, pbsChangeDetectionMode: e.target.value as any }))}
                  label={t('backup.pbsChangeDetection')}
                >
                  <MenuItem value="default">{t('common.default')}</MenuItem>
                  <MenuItem value="data">Data</MenuItem>
                  <MenuItem value="metadata">Metadata</MenuItem>
                </Select>
              </FormControl>

              <TextField
                size="small"
                label={t('inventory.pbsNamespace')}
                value={formData.namespace}
                onChange={(e) => setFormData(prev => ({ ...prev, namespace: e.target.value }))}
                helperText={t('inventory.pbsNamespaceHelper')}
              />
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
          {t('inventory.deleteBackupJob')}
        </DialogTitle>
        <DialogContent>
          <Typography>
            {t('inventory.confirmDeleteBackupJob')}
          </Typography>
          {jobToDelete && (
            <Box sx={{ mt: 2, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
              <Typography variant="body2"><strong>{t('inventory.scheduleHeader')}:</strong> {jobToDelete.schedule}</Typography>
              <Typography variant="body2"><strong>{t('inventory.storageHeader')}:</strong> {jobToDelete.storage}</Typography>
              {jobToDelete.comment && <Typography variant="body2"><strong>{t('inventory.commentHeader')}:</strong> {jobToDelete.comment}</Typography>}
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

      {/* Dialog Job Detail */}
      <Dialog open={!!detailJob} onClose={() => setDetailJob(null)} maxWidth="md" fullWidth>
        {detailJob && (() => {
          const prune = parsePruneBackups((detailJob as any).pruneBackups)
          const hasKeepValues = Object.values(prune).some(v => v !== '')
          const notifLabel = (detailJob as any).notificationMode === 'notification-system'
            ? t('backup.useGlobalNotifications')
            : (detailJob as any).notificationMode === 'legacy-sendmail'
              ? t('backup.useSendmail')
              : 'Auto'

          // Resolve included/excluded VMs
          const jobVmids: number[] = (detailJob as any).vmids || []
          const jobExcludedVmids: number[] = (detailJob as any).excludedVmids || []
          const isAllMode = (detailJob as any).selectionMode === 'all'
          const includedVms = isAllMode
            ? vms.filter(vm => !jobExcludedVmids.includes(vm.vmid))
            : vms.filter(vm => jobVmids.includes(vm.vmid))

          return (
            <>
              <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'primary.main' }}>
                <i className="ri-file-info-line" style={{ fontSize: 20 }} />
                {t('backup.jobDetail')}
              </DialogTitle>
              <DialogContent>
                {/* Summary grid */}
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', mb: 3 }}>
                  {[
                    [t('inventory.nodeHeader'), detailJob.node || `-- ${t('inventory.allNodes')} --`],
                    [t('backup.notifLabel'), notifLabel],
                    [t('inventory.storageHeader'), detailJob.storage],
                    [t('inventory.compression'), detailJob.compress || 'zstd'],
                    [t('inventory.scheduleHeader'), detailJob.schedule],
                    [t('inventory.modeLabel'), detailJob.mode],
                    [t('inventory.nextRun'), getNextRun(detailJob.schedule)],
                    [t('common.enabled'), detailJob.enabled ? t('common.yes') : t('common.no')],
                    [t('inventory.selectionMode'), formatSelection(detailJob)],
                  ].map(([label, value], i) => (
                    <Box key={i} sx={{ display: 'flex', gap: 1, px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider', '&:nth-of-type(odd)': { borderRight: '1px solid', borderColor: 'divider' } }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 120, opacity: 0.7 }}>{label}:</Typography>
                      <Typography variant="body2">{value}</Typography>
                    </Box>
                  ))}
                </Box>

                {/* Comment */}
                {detailJob.comment && (
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, opacity: 0.7, mb: 0.5 }}>{t('inventory.commentHeader')}:</Typography>
                    <Typography variant="body2">{detailJob.comment}</Typography>
                  </Box>
                )}

                {/* Retention */}
                <Box sx={{ mb: 3 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <i className="ri-arrow-go-back-line" style={{ fontSize: 16 }} />
                    {t('inventory.tabRetention')}
                  </Typography>
                  {!hasKeepValues ? (
                    <Typography variant="body2">{t('backup.keepAllBackups')}: {t('common.yes')}</Typography>
                  ) : (
                    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1 }}>
                      {prune.keepLast && <Chip size="small" variant="outlined" label={`${t('backup.keepLast')}: ${prune.keepLast}`} />}
                      {prune.keepHourly && <Chip size="small" variant="outlined" label={`${t('backup.keepHourly')}: ${prune.keepHourly}`} />}
                      {prune.keepDaily && <Chip size="small" variant="outlined" label={`${t('backup.keepDaily')}: ${prune.keepDaily}`} />}
                      {prune.keepWeekly && <Chip size="small" variant="outlined" label={`${t('backup.keepWeekly')}: ${prune.keepWeekly}`} />}
                      {prune.keepMonthly && <Chip size="small" variant="outlined" label={`${t('backup.keepMonthly')}: ${prune.keepMonthly}`} />}
                      {prune.keepYearly && <Chip size="small" variant="outlined" label={`${t('backup.keepYearly')}: ${prune.keepYearly}`} />}
                    </Box>
                  )}
                </Box>

                {/* Included VMs */}
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, display: 'flex', alignItems: 'center', gap: 1, color: 'primary.main' }}>
                  <i className="ri-hard-drive-2-line" style={{ fontSize: 16 }} />
                  {t('backup.includedDisks')} ({includedVms.length})
                </Typography>
                {includedVms.length === 0 ? (
                  <Typography variant="body2" sx={{ opacity: 0.5 }}>{t('common.noData')}</Typography>
                ) : (
                  <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
                    {/* Header */}
                    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 80px 100px', px: 2, py: 0.75, bgcolor: 'action.hover', borderBottom: '1px solid', borderColor: 'divider' }}>
                      <Typography variant="caption" sx={{ fontWeight: 600 }}>{t('backup.guestImage')}</Typography>
                      <Typography variant="caption" sx={{ fontWeight: 600 }}>{t('common.type')}</Typography>
                      <Typography variant="caption" sx={{ fontWeight: 600 }}>{t('backup.backupJob')}</Typography>
                    </Box>
                    {/* Rows */}
                    {includedVms.map((vm: any) => (
                      <Box key={vm.vmid} sx={{ display: 'grid', gridTemplateColumns: '1fr 80px 100px', px: 2, py: 0.75, borderBottom: '1px solid', borderColor: 'divider', '&:last-child': { borderBottom: 'none' }, '&:hover': { bgcolor: 'action.hover' } }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <i className={vm.type === 'lxc' ? 'ri-instance-line' : 'ri-computer-line'} style={{ fontSize: 14, opacity: 0.6 }} />
                          <Typography variant="body2">{vm.vmid} ({vm.name})</Typography>
                        </Box>
                        <Typography variant="body2" sx={{ opacity: 0.7 }}>{vm.type === 'lxc' ? 'lxc' : 'qemu'}</Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <i className="ri-checkbox-circle-fill" style={{ fontSize: 14, color: '#4caf50' }} />
                          <Typography variant="body2" sx={{ color: 'success.main' }}>{t('common.yes')}</Typography>
                        </Box>
                      </Box>
                    ))}
                  </Box>
                )}
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setDetailJob(null)}>{t('common.close')}</Button>
              </DialogActions>
            </>
          )
        })()}
      </Dialog>
    </Box>
  )
}
