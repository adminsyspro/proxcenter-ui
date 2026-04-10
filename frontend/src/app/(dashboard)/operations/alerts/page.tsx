'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'

import { useSession } from 'next-auth/react'

import { useTranslations } from 'next-intl'

import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Slider,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography
} from '@mui/material'
import { DataGrid, GridColDef, GridRowSelectionModel } from '@mui/x-data-grid'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'

import { usePageTitle } from '@/contexts/PageTitleContext'
import EnterpriseGuard from '@/components/guards/EnterpriseGuard'
import { Features, useLicense } from '@/contexts/LicenseContext'
import { useToast } from '@/contexts/ToastContext'
import { useOrchestratorAlerts, useAlertsSummary, useAlertRules, useAlertThresholds } from '@/hooks/useAlerts'
import EmptyState from '@/components/EmptyState'
import { CardsSkeleton, TableSkeleton } from '@/components/skeletons'

/* --------------------------------
   Types
-------------------------------- */

interface AlertData {
  id: string
  connection_id: string
  type: string
  severity: 'info' | 'warning' | 'critical'
  status: 'active' | 'acknowledged' | 'resolved'
  resource: string
  resource_type: string
  message: string
  current_value: number
  threshold: number
  unit: string
  occurrences: number
  first_seen_at: string
  last_seen_at: string
  rule_id?: string
}

interface AlertSummary {
  total_active: number
  critical: number
  warning: number
  info: number
  acknowledged: number
  resolved_today: number
}

interface AlertThresholds {
  cpu_warning: number
  cpu_critical: number
  memory_warning: number
  memory_critical: number
  storage_warning: number
  storage_critical: number
  snapshot_max_age_days: number
}

interface EventRule {
  id: string
  name: string
  description: string
  enabled: boolean
  category: 'task' | 'log' | 'all'
  level: 'error' | 'warning' | 'info' | 'all'
  task_types: string
  pattern: string
  connection_id: string
  node_pattern: string
  severity: 'info' | 'warning' | 'critical'
  notify_email: boolean
  created_at: string
  updated_at: string
}

/* --------------------------------
   Proxmox task types
-------------------------------- */

const TASK_TYPES = [
  // VM (QEMU)
  { id: 'qmstart', label: 'VM Start', group: 'VM' },
  { id: 'qmstop', label: 'VM Stop', group: 'VM' },
  { id: 'qmshutdown', label: 'VM Shutdown', group: 'VM' },
  { id: 'qmreboot', label: 'VM Reboot', group: 'VM' },
  { id: 'qmsuspend', label: 'VM Suspend', group: 'VM' },
  { id: 'qmresume', label: 'VM Resume', group: 'VM' },
  { id: 'qmclone', label: 'VM Clone', group: 'VM' },
  { id: 'qmcreate', label: 'VM Create', group: 'VM' },
  { id: 'qmdestroy', label: 'VM Delete', group: 'VM' },
  { id: 'qmmigrate', label: 'VM Migrate', group: 'VM' },
  { id: 'qmrollback', label: 'VM Rollback', group: 'VM' },
  { id: 'qmsnapshot', label: 'VM Snapshot', group: 'VM' },
  { id: 'qmdelsnapshot', label: 'VM Delete Snapshot', group: 'VM' },
  // Container (LXC)
  { id: 'vzstart', label: 'CT Start', group: 'Container' },
  { id: 'vzstop', label: 'CT Stop', group: 'Container' },
  { id: 'vzshutdown', label: 'CT Shutdown', group: 'Container' },
  { id: 'vzreboot', label: 'CT Reboot', group: 'Container' },
  { id: 'vzsuspend', label: 'CT Suspend', group: 'Container' },
  { id: 'vzresume', label: 'CT Resume', group: 'Container' },
  { id: 'vzcreate', label: 'CT Create', group: 'Container' },
  { id: 'vzdestroy', label: 'CT Delete', group: 'Container' },
  { id: 'vzmigrate', label: 'CT Migrate', group: 'Container' },
  // Backup
  { id: 'vzdump', label: 'Backup (vzdump)', group: 'Backup' },
  { id: 'imgcopy', label: 'Image Copy', group: 'Backup' },
  { id: 'download', label: 'Download', group: 'Backup' },
  // System
  { id: 'vncproxy', label: 'VNC Console', group: 'System' },
  { id: 'vncshell', label: 'Shell Console', group: 'System' },
  { id: 'spiceproxy', label: 'SPICE Console', group: 'System' },
  { id: 'aptupdate', label: 'APT Update', group: 'System' },
  { id: 'startall', label: 'Start All', group: 'System' },
  { id: 'stopall', label: 'Stop All', group: 'System' },
  { id: 'migrateall', label: 'Migrate All', group: 'System' },
  { id: 'srvreload', label: 'Service Reload', group: 'System' },
  { id: 'srvrestart', label: 'Service Restart', group: 'System' },
  // Ceph
  { id: 'cephcreateosd', label: 'Ceph Create OSD', group: 'Ceph' },
  { id: 'cephdestroyosd', label: 'Ceph Destroy OSD', group: 'Ceph' },
]

/* --------------------------------
   Helpers
-------------------------------- */

function useTimeAgo(t: ReturnType<typeof useTranslations>) {
  return (date: string) => {
    if (!date) return ''
    const now = new Date()
    const past = new Date(date)
    const diff = Math.floor((now.getTime() - past.getTime()) / 1000)

    if (diff < 60) return t('time.justNow')
    if (diff < 3600) return t('time.minutesAgo', { count: Math.floor(diff / 60) })
    if (diff < 86400) return t('time.hoursAgo', { count: Math.floor(diff / 3600) })
    return t('time.daysAgo', { count: Math.floor(diff / 86400) })
  }
}

/* --------------------------------
   Components
-------------------------------- */

function SeverityChip({ severity, t }: { severity: string; t: ReturnType<typeof useTranslations> }) {
  const config: Record<string, { labelKey: string; color: 'error' | 'warning' | 'info' }> = {
    critical: { labelKey: 'alerts.criticalSeverity', color: 'error' },
    warning: { labelKey: 'alerts.warningLevel', color: 'warning' },
    info: { labelKey: 'alerts.infoLevel', color: 'info' }
  }

  const cfg = config[severity] || config.info


return <Chip size="small" label={t(cfg.labelKey)} color={cfg.color} />
}

function StatusChip({ status, t }: { status: string; t: ReturnType<typeof useTranslations> }) {
  const config: Record<string, { labelKey: string; color: 'error' | 'warning' | 'success' | 'default'; variant: 'filled' | 'outlined' }> = {
    active: { labelKey: 'alerts.activeStatus', color: 'error', variant: 'filled' },
    acknowledged: { labelKey: 'alerts.acknowledgedStatus', color: 'warning', variant: 'outlined' },
    resolved: { labelKey: 'alerts.resolvedStatus', color: 'success', variant: 'outlined' }
  }

  const cfg = config[status] || { labelKey: '', color: 'default' as const, variant: 'outlined' as const }


return <Chip size="small" label={cfg.labelKey ? t(cfg.labelKey) : status} color={cfg.color} variant={cfg.variant} />
}

function DonutStatCard({ title, value, total, color }: { title: string; value: number; total: number; color: string }) {
  const remainder = Math.max(0, total - value)

  return (
    <Card variant="outlined">
      <CardContent sx={{ py: 1.5, px: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box sx={{ width: 52, height: 52, flexShrink: 0 }}>
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <PieChart>
              <Pie
                data={[{ value: value || 0 }, { value: remainder || 1 }]}
                dataKey="value"
                cx="50%" cy="50%"
                innerRadius={14} outerRadius={24}
                strokeWidth={0}
                startAngle={90} endAngle={-270}
              >
                <Cell fill={color} />
                <Cell fill="rgba(255,255,255,0.08)" />
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </Box>
        <Box>
          <Typography variant="caption" sx={{ opacity: 0.6 }}>{title}</Typography>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>{value}</Typography>
        </Box>
      </CardContent>
    </Card>
  )
}

function DonutTotalCard({ title, value, segments }: { title: string; value: number; segments: { value: number; color: string }[] }) {
  const data = segments.filter(s => s.value > 0)
  if (data.length === 0) data.push({ value: 1, color: 'rgba(255,255,255,0.08)' })

  return (
    <Card variant="outlined">
      <CardContent sx={{ py: 1.5, px: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box sx={{ width: 52, height: 52, flexShrink: 0 }}>
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                cx="50%" cy="50%"
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
          <Typography variant="caption" sx={{ opacity: 0.6 }}>{title}</Typography>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>{value}</Typography>
        </Box>
      </CardContent>
    </Card>
  )
}

/* --------------------------------
   Page
-------------------------------- */

export default function AlertsPage() {
  const t = useTranslations()
  const { setPageInfo } = usePageTitle()
  const { data: session } = useSession()
  const { isEnterprise } = useLicense()
  const [mounted, setMounted] = useState(false)
  const [tab, setTab] = useState(0)

  const [thresholds, setThresholds] = useState<AlertThresholds>({
    cpu_warning: 80, cpu_critical: 95,
    memory_warning: 85, memory_critical: 95,
    storage_warning: 80, storage_critical: 90,
    snapshot_max_age_days: 7
  })

  const [savingThresholds, setSavingThresholds] = useState(false)
  const { showToast } = useToast()

  // Dialog pour créer/éditer une règle
  const [ruleDialog, setRuleDialog] = useState(false)
  const [editingRule, setEditingRule] = useState<EventRule | null>(null)

  const [ruleForm, setRuleForm] = useState<Partial<EventRule>>({
    name: '', description: '', enabled: true,
    category: 'all', level: 'error', task_types: '',
    pattern: '', connection_id: '', node_pattern: '',
    severity: 'warning', notify_email: true
  })

  const [savingRule, setSavingRule] = useState(false)

  // Dialogs de confirmation
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean
    title: string
    message: string
    onConfirm: () => void
  }>({ open: false, title: '', message: '', onConfirm: () => {} })

  // Filtres
  const [search, setSearch] = useState('')
  const [severityFilter, setSeverityFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('active')

  // Selection for bulk actions
  const [selectionModel, setSelectionModel] = useState<GridRowSelectionModel>({ type: 'include', ids: new Set() })
  const selectedAlertIds = Array.from(selectionModel.ids) as string[]

  // Montage côté client
  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    setPageInfo(t('alerts.title'), t('alerts.title'), 'ri-notification-3-line')

return () => setPageInfo('', '', '')
  }, [setPageInfo, t])

  // SWR data fetching - only fetch when Enterprise mode is active
  const {
    data: alertsData,
    error: alertsError,
    isLoading: alertsLoading,
    mutate: mutateAlerts
  } = useOrchestratorAlerts(isEnterprise)

  const {
    data: summaryData,
    mutate: mutateSummary
  } = useAlertsSummary(isEnterprise)

  const {
    data: rulesData,
    mutate: mutateRules
  } = useAlertRules(isEnterprise)

  const {
    data: thresholdsData
  } = useAlertThresholds(isEnterprise)

  // Derive state from SWR data
  const alerts: AlertData[] = alertsData?.data || []
  const orchestratorAvailable = !alertsError
  const loading = alertsLoading

  const summary: AlertSummary = summaryData || {
    total_active: 0, critical: 0, warning: 0, info: 0, acknowledged: 0, resolved_today: 0
  }

  const rules: EventRule[] = useMemo(() => {
    if (!rulesData) return []
    return Array.isArray(rulesData) ? rulesData : []
  }, [rulesData])

  // Sync thresholds from SWR into local state (for editing)
  useEffect(() => {
    if (thresholdsData) {
      setThresholds(thresholdsData)
    }
  }, [thresholdsData])

  // Revalidate all SWR caches after mutations
  const revalidateAll = useCallback(() => {
    mutateAlerts()
    mutateSummary()
    mutateRules()
  }, [mutateAlerts, mutateSummary, mutateRules])

  const filteredAlerts = useMemo(() => {
    return alerts.filter(alert => {
      if (search) {
        const s = search.toLowerCase()

        if (!alert.message?.toLowerCase().includes(s) && !alert.resource?.toLowerCase().includes(s)) return false
      }

      if (severityFilter !== 'all' && alert.severity !== severityFilter) return false
      if (statusFilter !== 'all' && alert.status !== statusFilter) return false

return true
    })
  }, [alerts, search, severityFilter, statusFilter])

  const handleClearAll = () => {
    if (!isEnterprise) return

    const activeCount = filteredAlerts.filter(a => a.status === 'active').length

    setConfirmDialog({
      open: true,
      title: t('alerts.resolveAll'),
      message: t('alerts.resolveConfirm', { count: activeCount }),
      onConfirm: async () => {
        try {
          // DELETE /api/v1/orchestrator/alerts résout toutes les alertes
          await fetch('/api/v1/orchestrator/alerts', { method: 'DELETE' })
          showToast(t('common.success'), 'success')
          revalidateAll()
        } catch (e) {
          showToast(t('common.error'), 'error')
        }

        setConfirmDialog(d => ({ ...d, open: false }))
      }
    })
  }

  const handleSaveThresholds = async () => {
    if (!isEnterprise) return

    try {
      setSavingThresholds(true)
      await fetch('/api/v1/orchestrator/alerts/thresholds', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(thresholds)
      })
      showToast(t('common.success'), 'success')
    } catch (e) {
      showToast(t('common.error'), 'error')
    } finally {
      setSavingThresholds(false)
    }
  }

  const openNewRuleDialog = () => {
    setEditingRule(null)
    setRuleForm({
      name: '', description: '', enabled: true,
      category: 'all', level: 'error', task_types: '',
      pattern: '', connection_id: '', node_pattern: '',
      severity: 'warning', notify_email: true
    })
    setRuleDialog(true)
  }

  const openEditRuleDialog = (rule: EventRule) => {
    setEditingRule(rule)
    setRuleForm({ ...rule })
    setRuleDialog(true)
  }

  const handleSaveRule = async () => {
    if (!isEnterprise) return

    try {
      setSavingRule(true)

      const url = editingRule
        ? `/api/v1/orchestrator/alerts/rules/${editingRule.id}`
        : '/api/v1/orchestrator/alerts/rules'

      await fetch(url, {
        method: editingRule ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ruleForm)
      })
      showToast(t('common.success'), 'success')
      setRuleDialog(false)
      revalidateAll()
    } catch (e) {
      showToast(t('common.error'), 'error')
    } finally {
      setSavingRule(false)
    }
  }

  const handleDeleteRule = (id: string) => {
    if (!isEnterprise) return

    setConfirmDialog({
      open: true,
      title: t('common.confirmDelete'),
      message: t('common.deleteConfirmation'),
      onConfirm: async () => {
        try {
          await fetch(`/api/v1/orchestrator/alerts/rules/${id}`, { method: 'DELETE' })
          showToast(t('common.success'), 'success')
          revalidateAll()
        } catch (e) {
          showToast(t('common.error'), 'error')
        }

        setConfirmDialog(d => ({ ...d, open: false }))
      }
    })
  }

  const handleToggleRule = async (id: string) => {
    if (!isEnterprise) return

    try {
      await fetch(`/api/v1/orchestrator/alerts/rules/${id}/toggle`, { method: 'POST' })
      revalidateAll()
    } catch (e) {
      showToast(t('common.error'), 'error')
    }
  }

  const handleAcknowledgeSingle = async (id: string) => {
    if (!isEnterprise) return

    try {
      const userId = session?.user?.name || 'unknown'

      await fetch(`/api/v1/orchestrator/alerts/${id}/acknowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acknowledged_by: userId })
      })
      showToast(t('common.success'), 'success')
      revalidateAll()
    } catch (e) {
      showToast(t('common.error'), 'error')
    }
  }

  const handleResolveSingle = async (id: string) => {
    if (!isEnterprise) return

    try {
      await fetch(`/api/v1/orchestrator/alerts/${id}/resolve`, { method: 'POST' })
      showToast(t('common.success'), 'success')
      revalidateAll()
    } catch (e) {
      showToast(t('common.error'), 'error')
    }
  }

  const handleDeleteAlerts = (ids: string[]) => {
    if (!isEnterprise || ids.length === 0) return

    setConfirmDialog({
      open: true,
      title: t('common.confirmDelete'),
      message: t('alerts.deleteConfirm', { count: ids.length }),
      onConfirm: async () => {
        try {
          // Resolve first (to ensure orchestrator marks them resolved), then delete from local DB
          for (const id of ids) {
            await fetch(`/api/v1/orchestrator/alerts/${id}/resolve`, { method: 'POST' }).catch(() => {})
          }
          showToast(t('common.success'), 'success')
          setSelectionModel({ type: 'include', ids: new Set() })
          revalidateAll()
        } catch (e) {
          showToast(t('common.error'), 'error')
        }

        setConfirmDialog(d => ({ ...d, open: false }))
      }
    })
  }

  const handleBulkResolve = () => {
    if (!isEnterprise || selectedAlertIds.length === 0) return

    const resolvableIds = selectedAlertIds.filter(id => {
      const alert = alerts.find(a => a.id === id)
      return alert && alert.status !== 'resolved'
    })

    if (resolvableIds.length === 0) return

    setConfirmDialog({
      open: true,
      title: t('alerts.resolve'),
      message: t('alerts.resolveConfirm', { count: resolvableIds.length }),
      onConfirm: async () => {
        try {
          await Promise.all(
            resolvableIds.map(id =>
              fetch(`/api/v1/orchestrator/alerts/${id}/resolve`, { method: 'POST' })
            )
          )
          showToast(t('common.success'), 'success')
          setSelectionModel({ type: 'include', ids: new Set() })
          revalidateAll()
        } catch (e) {
          showToast(t('common.error'), 'error')
        }

        setConfirmDialog(d => ({ ...d, open: false }))
      }
    })
  }

  const handleClearResolved = () => {
    if (!isEnterprise) return

    setConfirmDialog({
      open: true,
      title: t('alerts.clearResolved'),
      message: t('alerts.clearResolvedConfirm'),
      onConfirm: async () => {
        try {
          await fetch('/api/v1/orchestrator/alerts/clear', { method: 'DELETE' })
          showToast(t('common.success'), 'success')
          revalidateAll()
        } catch (e) {
          showToast(t('common.error'), 'error')
        }

        setConfirmDialog(d => ({ ...d, open: false }))
      }
    })
  }

  const timeAgo = useTimeAgo(t)

  const alertColumns: GridColDef[] = [
    { field: 'severity', headerName: t('alerts.severity'), width: 100, renderCell: (p) => <SeverityChip severity={p.value} t={t} /> },
    { field: 'status', headerName: t('common.status'), width: 100, renderCell: (p) => <StatusChip status={p.value} t={t} /> },
    {
      field: 'message',
      headerName: t('alerts.message'),
      flex: 1,
      minWidth: 300,
      renderCell: (p) => (
        <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', py: 0.5 }}>
          <Typography variant="body2" sx={{ fontWeight: 500, lineHeight: 1.4 }}>{p.value}</Typography>
          <Typography variant="caption" sx={{ opacity: 0.6, lineHeight: 1.2 }}>{p.row.occurrences} {t('alerts.occurrences')}</Typography>
        </Box>
      )
    },
    { field: 'resource', headerName: t('alerts.resource'), width: 150 },
    { field: 'current_value', headerName: t('alerts.value'), width: 80, renderCell: (p) => p.value ? `${p.value.toFixed(1)}${p.row.unit || ''}` : '—' },
    { field: 'last_seen_at', headerName: t('alerts.lastSeen'), width: 120, renderCell: (p) => <Tooltip title={new Date(p.value).toLocaleString()}><span>{timeAgo(p.value)}</span></Tooltip> },
    {
      field: 'actions',
      headerName: t('common.actions'),
      width: 120,
      sortable: false,
      renderCell: (p) => {
        const { status, id } = p.row

        if (status === 'active') {
          return (
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              <Tooltip title={t('alerts.acknowledge')}>
                <Button size="small" color="warning" onClick={() => handleAcknowledgeSingle(id)}>
                  <i className="ri-check-line" />
                </Button>
              </Tooltip>
              <Tooltip title={t('alerts.resolve')}>
                <Button size="small" color="success" onClick={() => handleResolveSingle(id)}>
                  <i className="ri-check-double-line" />
                </Button>
              </Tooltip>
            </Box>
          )
        }

        if (status === 'acknowledged') {
          return (
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              <Tooltip title={t('alerts.resolve')}>
                <Button size="small" color="success" onClick={() => handleResolveSingle(id)}>
                  <i className="ri-check-double-line" />
                </Button>
              </Tooltip>
              <Tooltip title={t('common.delete')}>
                <Button size="small" color="error" onClick={() => handleDeleteAlerts([id])}>
                  <i className="ri-delete-bin-line" />
                </Button>
              </Tooltip>
            </Box>
          )
        }

        if (status === 'resolved') {
          return (
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              <Tooltip title={t('common.delete')}>
                <Button size="small" color="error" onClick={() => handleDeleteAlerts([id])}>
                  <i className="ri-delete-bin-line" />
                </Button>
              </Tooltip>
            </Box>
          )
        }

        return null
      }
    }
  ]

  const ruleColumns: GridColDef[] = [
    { field: 'enabled', headerName: t('common.active'), width: 80, renderCell: (p) => <Switch size="small" checked={p.value} onChange={() => handleToggleRule(p.row.id)} /> },
    { field: 'name', headerName: t('common.name'), width: 200, flex: 1 },
    { field: 'category', headerName: t('alerts.category'), width: 100, renderCell: (p) => {
      const labels: Record<string, string> = { task: t('alerts.tasksOnly'), log: 'Log', all: t('common.all') }


return <Chip size="small" label={labels[p.value] || p.value} variant="outlined" />
    }},
    { field: 'level', headerName: t('alerts.eventLevel'), width: 100, renderCell: (p) => {
      const labels: Record<string, string> = { error: t('alerts.errorLevel'), warning: t('alerts.warningLevel'), info: t('alerts.infoLevel'), all: t('common.all') }
      const colors: Record<string, 'error' | 'warning' | 'info' | 'default'> = { error: 'error', warning: 'warning', info: 'info', all: 'default' }


return <Chip size="small" label={labels[p.value] || p.value} color={colors[p.value] || 'default'} />
    }},
    { field: 'severity', headerName: t('alerts.alertSeverity'), width: 120, renderCell: (p) => <SeverityChip severity={p.value} t={t} /> },
    { field: 'notify_email', headerName: 'Email', width: 80, renderCell: (p) => p.value ? <i className="ri-mail-check-line" style={{ color: 'var(--mui-palette-success-main)' }} /> : <i className="ri-mail-close-line" style={{ opacity: 0.3 }} /> },
    { field: 'actions', headerName: t('common.actions'), width: 120, sortable: false, renderCell: (p) => (
      <Box sx={{ display: 'flex', gap: 0.5 }}>
        <Tooltip title={t('common.edit')}><Button size="small" onClick={() => openEditRuleDialog(p.row)}><i className="ri-edit-line" /></Button></Tooltip>
        <Tooltip title={t('common.delete')}><Button size="small" color="error" onClick={() => handleDeleteRule(p.row.id)}><i className="ri-delete-bin-line" /></Button></Tooltip>
      </Box>
    )}
  ]

  // Attendre le montage côté client pour éviter les erreurs d'hydratation
  if (!mounted) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: 2 }}>
        <CardsSkeleton count={4} columns={4} />
        <TableSkeleton rows={5} columns={6} />
      </Box>
    )
  }

  return (
    <EnterpriseGuard requiredFeature={Features.ALERTS} featureName={t('alerts.title')}>
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, height: '100%' }}>
      {!orchestratorAvailable && (
        <Alert severity="warning" sx={{ flexShrink: 0 }}>
          {t('alerts.orchestratorUnavailable')}
        </Alert>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 2, flexShrink: 0 }}>
        <DonutTotalCard
          title={t('alerts.activeAlerts')} value={summary.total_active}
          segments={[
            { value: summary.critical, color: '#f44336' },
            { value: summary.warning, color: '#ff9800' },
            { value: summary.acknowledged, color: '#2196f3' },
            { value: Math.max(0, summary.total_active - summary.critical - summary.warning - summary.acknowledged), color: '#4caf50' },
          ]}
        />
        <DonutStatCard title={t('alerts.criticalAlerts')} value={summary.critical} total={summary.total_active} color="#f44336" />
        <DonutStatCard title={t('alerts.warningsAlerts')} value={summary.warning} total={summary.total_active} color="#ff9800" />
        <DonutStatCard title={t('alerts.acknowledgedAlerts')} value={summary.acknowledged} total={summary.total_active} color="#2196f3" />
      </Box>

      <Card variant="outlined" sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs value={tab} onChange={(_, v) => setTab(v)}>
            <Tab label={t('alerts.alertsTab', { count: summary.total_active })} />
            <Tab label={t('alerts.thresholds')} />
            <Tab label={t('alerts.eventRules', { count: rules.length })} />
          </Tabs>
        </Box>

        {tab === 0 && (
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, p: 2 }}>
            <Stack direction="row" spacing={1.5} sx={{ mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
              <TextField size="small" placeholder={t('common.search')} value={search} onChange={(e) => setSearch(e.target.value)} sx={{ minWidth: 200 }}
                InputProps={{ startAdornment: <InputAdornment position="start"><i className="ri-search-line" /></InputAdornment> }} />
              <FormControl size="small" sx={{ minWidth: 120 }}>
                <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <MenuItem value="all">{t('alerts.allStatuses')}</MenuItem>
                  <MenuItem value="active">{t('alerts.activeStatus')}</MenuItem>
                  <MenuItem value="acknowledged">{t('alerts.acknowledgedStatus')}</MenuItem>
                  <MenuItem value="resolved">{t('alerts.resolvedStatus')}</MenuItem>
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 140 }}>
                <Select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
                  <MenuItem value="all">{t('alerts.allSeverities')}</MenuItem>
                  <MenuItem value="critical">{t('alerts.criticalSeverity')}</MenuItem>
                  <MenuItem value="warning">{t('alerts.warningLevel')}</MenuItem>
                  <MenuItem value="info">{t('alerts.infoLevel')}</MenuItem>
                </Select>
              </FormControl>
              <Box sx={{ flex: 1 }} />
              {selectedAlertIds.length > 0 && (
                <>
                  <Button size="small" variant="outlined" color="success" onClick={handleBulkResolve}
                    disabled={selectedAlertIds.filter(id => { const a = alerts.find(x => x.id === id); return a && a.status !== 'resolved' }).length === 0}>
                    <i className="ri-check-double-line" style={{ marginRight: 4 }} /> {t('alerts.resolveSelected')} ({selectedAlertIds.length})
                  </Button>
                  <Button size="small" variant="outlined" color="error" onClick={() => handleDeleteAlerts(selectedAlertIds)}>
                    <i className="ri-delete-bin-line" style={{ marginRight: 4 }} /> {t('alerts.deleteSelected')} ({selectedAlertIds.length})
                  </Button>
                </>
              )}
              {selectedAlertIds.length === 0 && (
                <>
                  <Button size="small" variant="outlined" color="error" onClick={handleClearAll} disabled={filteredAlerts.filter(a => a.status === 'active').length === 0}>
                    <i className="ri-delete-bin-line" style={{ marginRight: 4 }} /> {t('alerts.resolveAll')} ({filteredAlerts.filter(a => a.status === 'active').length})
                  </Button>
                  <Button size="small" variant="outlined" onClick={handleClearResolved} disabled={alerts.filter(a => a.status === 'resolved').length === 0}>
                    <i className="ri-eraser-line" style={{ marginRight: 4 }} /> {t('alerts.clearResolved')}
                  </Button>
                </>
              )}
            </Stack>
            <Box sx={{ flex: 1, minHeight: 0 }}>
              {!loading && filteredAlerts.length === 0 ? (
                <EmptyState
                  icon="ri-checkbox-circle-line"
                  title={t('emptyState.noAlerts')}
                  description={t('emptyState.noAlertsDesc')}
                  size="large"
                />
              ) : (
              <DataGrid
                rows={filteredAlerts}
                columns={alertColumns}
                loading={loading}
                density="compact"
                getRowHeight={() => 'auto'}
                pageSizeOptions={[25, 50, 100]}
                initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
                checkboxSelection
                rowSelectionModel={selectionModel}
                onRowSelectionModelChange={(newModel) => setSelectionModel(newModel)}
                sx={{
                  border: 'none',
                  '& .MuiDataGrid-cell': {
                    display: 'flex',
                    alignItems: 'center',
                    py: 0.5,
                  },
                }}
              />
              )}
            </Box>
          </Box>
        )}

        {tab === 1 && (
          <Box sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
              <Typography variant="h6" fontWeight={700}>{t('alerts.thresholdsConfig')}</Typography>
              <Button variant="contained" onClick={handleSaveThresholds} disabled={savingThresholds}
                startIcon={savingThresholds ? <CircularProgress size={16} /> : <i className="ri-save-line" />}>{t('common.save')}</Button>
            </Box>

            {/* Section: Resource Usage */}
            <Typography variant="overline" color="text.secondary" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <i className="ri-bar-chart-box-line" style={{ fontSize: 16 }} />
              {t('alerts.resourceUsage')}
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr 1fr' }, gap: 2, mb: 4 }}>
              {/* CPU */}
              <Card variant="outlined" sx={{ borderRadius: 2 }}>
                <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                    <i className="ri-cpu-line" style={{ fontSize: 18, opacity: 0.6 }} />
                    <Typography variant="subtitle2" fontWeight={700}>{t('alerts.cpu')}</Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'JetBrains Mono, monospace' }}>
                    {t('alerts.warning')}: {thresholds.cpu_warning}% · {t('alerts.critical')}: {thresholds.cpu_critical}%
                  </Typography>
                  <Slider
                    value={[thresholds.cpu_warning, thresholds.cpu_critical]}
                    onChange={(_, v) => { const [w, c] = v as number[]; setThresholds(th => ({ ...th, cpu_warning: w, cpu_critical: c })) }}
                    valueLabelDisplay="auto" valueLabelFormat={(v) => `${v}%`}
                    min={50} max={100}
                    marks={[{ value: 50, label: '50%' }, { value: 75, label: '75%' }, { value: 100, label: '100%' }]}
                    sx={{ mt: 2, '& .MuiSlider-markLabel[data-index="0"]': { left: '6% !important' }, '& .MuiSlider-markLabel[data-index="2"]': { left: '94% !important' } }}
                  />
                </CardContent>
              </Card>

              {/* Memory */}
              <Card variant="outlined" sx={{ borderRadius: 2 }}>
                <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                    <i className="ri-ram-line" style={{ fontSize: 18, opacity: 0.6 }} />
                    <Typography variant="subtitle2" fontWeight={700}>{t('alerts.memory')}</Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'JetBrains Mono, monospace' }}>
                    {t('alerts.warning')}: {thresholds.memory_warning}% · {t('alerts.critical')}: {thresholds.memory_critical}%
                  </Typography>
                  <Slider
                    value={[thresholds.memory_warning, thresholds.memory_critical]}
                    onChange={(_, v) => { const [w, c] = v as number[]; setThresholds(th => ({ ...th, memory_warning: w, memory_critical: c })) }}
                    valueLabelDisplay="auto" valueLabelFormat={(v) => `${v}%`}
                    min={50} max={100}
                    marks={[{ value: 50, label: '50%' }, { value: 75, label: '75%' }, { value: 100, label: '100%' }]}
                    sx={{ mt: 2, '& .MuiSlider-markLabel[data-index="0"]': { left: '6% !important' }, '& .MuiSlider-markLabel[data-index="2"]': { left: '94% !important' } }}
                  />
                </CardContent>
              </Card>

              {/* Storage */}
              <Card variant="outlined" sx={{ borderRadius: 2 }}>
                <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                    <i className="ri-hard-drive-2-line" style={{ fontSize: 18, opacity: 0.6 }} />
                    <Typography variant="subtitle2" fontWeight={700}>{t('alerts.storage')}</Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'JetBrains Mono, monospace' }}>
                    {t('alerts.warning')}: {thresholds.storage_warning}% · {t('alerts.critical')}: {thresholds.storage_critical}%
                  </Typography>
                  <Slider
                    value={[thresholds.storage_warning, thresholds.storage_critical]}
                    onChange={(_, v) => { const [w, c] = v as number[]; setThresholds(th => ({ ...th, storage_warning: w, storage_critical: c })) }}
                    valueLabelDisplay="auto" valueLabelFormat={(v) => `${v}%`}
                    min={50} max={100}
                    marks={[{ value: 50, label: '50%' }, { value: 75, label: '75%' }, { value: 100, label: '100%' }]}
                    sx={{ mt: 2, '& .MuiSlider-markLabel[data-index="0"]': { left: '6% !important' }, '& .MuiSlider-markLabel[data-index="2"]': { left: '94% !important' } }}
                  />
                </CardContent>
              </Card>
            </Box>

            {/* Section: Maintenance */}
            <Typography variant="overline" color="text.secondary" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <i className="ri-tools-line" style={{ fontSize: 16 }} />
              {t('alerts.maintenance')}
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr 1fr' }, gap: 2 }}>
              {/* Stale Snapshots */}
              <Card variant="outlined" sx={{ borderRadius: 2 }}>
                <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <i className="ri-camera-line" style={{ fontSize: 18, opacity: 0.6 }} />
                      <Typography variant="subtitle2" fontWeight={700}>{t('alerts.snapshotAge')}</Typography>
                    </Box>
                    <Switch
                      size="small"
                      checked={thresholds.snapshot_max_age_days > 0}
                      onChange={(_, checked) => setThresholds(th => ({ ...th, snapshot_max_age_days: checked ? 7 : 0 }))}
                    />
                  </Box>
                  <Typography variant="caption" color="text.secondary">{t('alerts.snapshotAgeDesc')}</Typography>
                  {thresholds.snapshot_max_age_days > 0 ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 2 }}>
                      <TextField
                        type="number"
                        size="small"
                        value={thresholds.snapshot_max_age_days}
                        onChange={(e) => setThresholds(th => ({ ...th, snapshot_max_age_days: Math.max(1, Number.parseInt(e.target.value) || 1) }))}
                        slotProps={{ htmlInput: { min: 1, max: 365 } }}
                        sx={{ width: 80 }}
                      />
                      <Typography variant="body2" color="text.secondary">{t('alerts.snapshotDays')}</Typography>
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.disabled" sx={{ mt: 2 }}>{t('alerts.snapshotDisabled')}</Typography>
                  )}
                </CardContent>
              </Card>
            </Box>
          </Box>
        )}

        {tab === 2 && (
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, p: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="body2" sx={{ opacity: 0.7 }}>{t('alerts.rulesDescription')}</Typography>
              <Button variant="contained" size="small" onClick={openNewRuleDialog} startIcon={<i className="ri-add-line" />}>{t('common.add')}</Button>
            </Box>
            <Box sx={{ flex: 1, minHeight: 0 }}>
              <DataGrid
                rows={rules}
                columns={ruleColumns}
                loading={loading}
                density="compact"
                getRowHeight={() => 'auto'}
                pageSizeOptions={[10, 25, 50]}
                initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
                sx={{
                  border: 'none',
                  '& .MuiDataGrid-cell': {
                    display: 'flex',
                    alignItems: 'center',
                    py: 0.5,
                  },
                }}
              />
            </Box>
          </Box>
        )}
      </Card>

      <Dialog open={ruleDialog} onClose={() => setRuleDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingRule ? t('alerts.editRule') : t('alerts.newRule')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label={t('alerts.ruleName')} value={ruleForm.name || ''} onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })} fullWidth required />
            <TextField label={t('common.description')} value={ruleForm.description || ''} onChange={(e) => setRuleForm({ ...ruleForm, description: e.target.value })} fullWidth multiline rows={2} />
            <Box sx={{ display: 'flex', gap: 2 }}>
              <FormControl fullWidth>
                <InputLabel>{t('alerts.category')}</InputLabel>
                <Select value={ruleForm.category || 'all'} label={t('alerts.category')} onChange={(e) => setRuleForm({ ...ruleForm, category: e.target.value as EventRule['category'] })}>
                  <MenuItem value="all">{t('alerts.allCategory')}</MenuItem>
                  <MenuItem value="task">{t('alerts.tasksOnly')}</MenuItem>
                  <MenuItem value="log">{t('alerts.logsOnly')}</MenuItem>
                </Select>
              </FormControl>
              <FormControl fullWidth>
                <InputLabel>{t('alerts.eventLevel')}</InputLabel>
                <Select value={ruleForm.level || 'error'} label={t('alerts.eventLevel')} onChange={(e) => setRuleForm({ ...ruleForm, level: e.target.value as EventRule['level'] })}>
                  <MenuItem value="all">{t('alerts.allLevels')}</MenuItem>
                  <MenuItem value="error">{t('alerts.errorLevel')}</MenuItem>
                  <MenuItem value="warning">{t('alerts.warningLevel')}</MenuItem>
                  <MenuItem value="info">{t('alerts.infoLevel')}</MenuItem>
                </Select>
              </FormControl>
            </Box>
            <Autocomplete
              multiple
              options={TASK_TYPES}
              groupBy={(option) => option.group}
              getOptionLabel={(option) => typeof option === 'string' ? option : `${option.id} — ${option.label}`}
              value={TASK_TYPES.filter(tt => (ruleForm.task_types || '').split(',').filter(Boolean).includes(tt.id))}
              onChange={(_, values) => setRuleForm({ ...ruleForm, task_types: values.map(v => v.id).join(',') })}
              renderTags={(value, getTagProps) => value.map((option, index) => (
                <Chip {...getTagProps({ index })} key={option.id} label={option.id} size="small" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }} />
              ))}
              renderInput={(params) => (
                <TextField {...params} label={t('alerts.taskTypes')} placeholder={ruleForm.task_types ? '' : t('alerts.leaveEmptyForAll')} helperText={t('alerts.leaveEmptyForAll')} />
              )}
              renderOption={(props, option) => (
                <li {...props} key={option.id}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600, minWidth: 120 }}>{option.id}</Typography>
                    <Typography variant="caption" sx={{ opacity: 0.6 }}>{option.label}</Typography>
                  </Box>
                </li>
              )}
              fullWidth
              disableCloseOnSelect
            />
            <TextField label={t('alerts.pattern')} value={ruleForm.pattern || ''} onChange={(e) => setRuleForm({ ...ruleForm, pattern: e.target.value })} fullWidth
              placeholder={t('alerts.patternPlaceholder')} helperText={t('alerts.optionalRegex')} />
            <FormControl fullWidth>
              <InputLabel>{t('alerts.alertSeverity')}</InputLabel>
              <Select value={ruleForm.severity || 'warning'} label={t('alerts.alertSeverity')} onChange={(e) => setRuleForm({ ...ruleForm, severity: e.target.value as EventRule['severity'] })}>
                <MenuItem value="info">{t('alerts.infoLevel')}</MenuItem>
                <MenuItem value="warning">{t('alerts.warningLevel')}</MenuItem>
                <MenuItem value="critical">{t('alerts.criticalSeverity')}</MenuItem>
              </Select>
            </FormControl>
            <FormControlLabel control={<Switch checked={ruleForm.notify_email ?? true} onChange={(e) => setRuleForm({ ...ruleForm, notify_email: e.target.checked })} />} label={t('alerts.sendEmailNotification')} />
            <FormControlLabel control={<Switch checked={ruleForm.enabled ?? true} onChange={(e) => setRuleForm({ ...ruleForm, enabled: e.target.checked })} />} label={t('alerts.activeRule')} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRuleDialog(false)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={handleSaveRule} disabled={savingRule || !ruleForm.name}>{savingRule ? <CircularProgress size={20} /> : t('common.save')}</Button>
        </DialogActions>
      </Dialog>

      {/* Dialog de confirmation */}
      <Dialog
        open={confirmDialog.open}
        onClose={() => setConfirmDialog(d => ({ ...d, open: false }))}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{confirmDialog.title}</DialogTitle>
        <DialogContent>
          <Typography>{confirmDialog.message}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDialog(d => ({ ...d, open: false }))}>
            {t('common.cancel')}
          </Button>
          <Button variant="contained" color="error" onClick={confirmDialog.onConfirm}>
            {t('common.confirm')}
          </Button>
        </DialogActions>
      </Dialog>

    </Box>
    </EnterpriseGuard>
  )
}
