'use client'

import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import DOMPurify from 'dompurify'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  LinearProgress,
  List,
  Menu,
  MenuItem,
  Select,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
  Tooltip as MuiTooltip,
  Divider,
  useTheme,
  alpha,
} from '@mui/material'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts'

import { formatBytes } from '@/utils/format'
import ExpandableChart from '../components/ExpandableChart'
import NodesTable, { NodeRow, BulkAction } from '@/components/NodesTable'
import VmsTable, { VmRow, TrendPoint } from '@/components/VmsTable'
import ClusterFirewallTab from '@/components/ClusterFirewallTab'
import BackupJobsPanel from '../BackupJobsPanel'
import CveTab from '@/components/CveTab'
import ChangeTrackingTab from './ChangeTrackingTab'
import ComplianceTab from '@/components/ComplianceTab'
import SnapshotsTab from '@/components/SnapshotsTab'
import RollingUpdateWizard from '@/components/RollingUpdateWizard'

import type { InventorySelection, DetailsPayload, RrdTimeframe, SeriesPoint, Status } from '../types'
import { formatBps, formatTime, formatUptime, parseMarkdown, markdownSx, parseNodeId, parseVmId, cpuPct, pct, buildSeriesFromRrd, fetchRrd, tagColor } from '../helpers'
import { AreaPctChart, AreaBpsChart2 } from '../components/RrdCharts'
import InventorySummary from '../components/InventorySummary'
import HaGroupDialog from '../HaGroupDialog'
import HaRuleDialog from '../HaRuleDialog'
import EntityTagManager from '../components/EntityTagManager'
import { AddIcon } from '../components/IconWrappers'
import { useLicense, Features } from '@/contexts/LicenseContext'
import { useToast } from '@/contexts/ToastContext'
import { useRollingUpdates } from '@/contexts/RollingUpdateContext'
import { useDRSStatus, useDRSMetrics, useDRSSettings, useDRSRecommendations } from '@/hooks/useDRS'
import { computeDrsHealthScore } from '@/lib/utils/drs-health'

const HA_STATES = ['started', 'stopped', 'enabled', 'disabled', 'ignored'] as const
const HA_STATE_META: Record<string, { color: string; icon: string; chipColor: string }> = {
  started:  { color: '#22c55e', icon: 'ri-play-circle-line', chipColor: 'success' },
  stopped:  { color: '#9ca3af', icon: 'ri-stop-circle-line', chipColor: 'default' },
  enabled:  { color: '#3b82f6', icon: 'ri-checkbox-circle-line', chipColor: 'success' },
  disabled: { color: '#6b7280', icon: 'ri-forbid-line', chipColor: 'default' },
  ignored:  { color: '#f59e0b', icon: 'ri-eye-off-line', chipColor: 'warning' },
}

function HaResourceStateCell({ sid, state, group, connId, t }: {
  sid: string; state: string; group?: string; connId: string; t: (key: string) => string
}) {
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [displayState, setDisplayState] = React.useState(state)

  React.useEffect(() => { setDisplayState(state) }, [state])

  const handleChange = async (newState: string) => {
    setAnchorEl(null)
    if (newState === displayState) return
    setDisplayState(newState)
    setSaving(true)
    try {
      await fetch(
        `/api/v1/connections/${encodeURIComponent(connId)}/ha/${encodeURIComponent(sid)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: newState, group: group || undefined }),
        }
      )
    } catch {
      setDisplayState(state) // revert on error
    }
    setSaving(false)
  }

  const meta = HA_STATE_META[displayState] || HA_STATE_META.started

  return (
    <Box>
      <Chip
        size="small"
        label={displayState}
        color={meta.chipColor as any}
        onClick={(e) => setAnchorEl(e.currentTarget)}
        deleteIcon={<i className="ri-arrow-down-s-line" style={{ fontSize: 12 }} />}
        onDelete={(e: any) => setAnchorEl(e.currentTarget.closest('.MuiChip-root'))}
        sx={{ height: 20, fontSize: 11, cursor: 'pointer', '& .MuiChip-deleteIcon': { fontSize: 12, ml: -0.25, color: 'inherit', opacity: 0.6 } }}
      />
      {saving && <CircularProgress size={10} sx={{ ml: 0.5 }} />}
      <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={() => setAnchorEl(null)} slotProps={{ paper: { sx: { minWidth: 150 } } }}>
        {HA_STATES.map(s => {
          const m = HA_STATE_META[s]
          return (
            <MenuItem key={s} selected={s === displayState} onClick={() => handleChange(s)} sx={{ fontSize: 13, py: 0.75, gap: 1 }}>
              <i className={m.icon} style={{ fontSize: 16, color: m.color }} />
              <Typography variant="body2" sx={{ fontWeight: s === displayState ? 700 : 400, color: m.color, textTransform: 'capitalize' }}>
                {s}
              </Typography>
            </MenuItem>
          )
        })}
      </Menu>
    </Box>
  )
}

export default function ClusterTabs(props: any) {
  const t = useTranslations()
  const router = useRouter()
  const { hasFeature, loading: licenseLoading } = useLicense()
  const isEnterprise = !licenseLoading && hasFeature(Features.DRS)
  const { data: drsStatus } = useDRSStatus(isEnterprise)
  const { data: metricsData } = useDRSMetrics(isEnterprise)
  const { data: drsSettings } = useDRSSettings(isEnterprise)
  const { data: drsRecommendations, mutate: mutateRecs } = useDRSRecommendations(isEnterprise)
  const [evaluating, setEvaluating] = useState(false)
  const [recsExpanded, setRecsExpanded] = useState(false)
  const [executingRecId, setExecutingRecId] = useState<string | null>(null)
  const [executingAll, setExecutingAll] = useState(false)
  const [executedRecIds, setExecutedRecIds] = useState<Set<string>>(new Set())
  const [expandedRecId, setExpandedRecId] = useState<string | null>(null)
  const [recSeries, setRecSeries] = useState<SeriesPoint[]>([])
  const [recRrdLoading, setRecRrdLoading] = useState(false)
  const [cephOsdFlags, setCephOsdFlags] = useState<string[]>([])
  const [cephOsdFlagsLoading, setCephOsdFlagsLoading] = useState(false)
  const [cephFlagToggling, setCephFlagToggling] = useState<string | null>(null)
  const [refreshingUpdates, setRefreshingUpdates] = useState(false)
  const [addHaDialogOpen, setAddHaDialogOpen] = useState(false)
  const [addHaSid, setAddHaSid] = useState('')
  const [addHaState, setAddHaState] = useState('started')
  const [addHaMaxRestart, setAddHaMaxRestart] = useState(1)
  const [addHaMaxRelocate, setAddHaMaxRelocate] = useState(1)
  const [addHaGroup, setAddHaGroup] = useState('')
  const [addHaComment, setAddHaComment] = useState('')
  const [addHaSaving, setAddHaSaving] = useState(false)
  const [clusterTags, setClusterTags] = useState<string[]>([])
  const [clusterTagsLoaded, setClusterTagsLoaded] = useState<string | null>(null)
  const theme = useTheme()
  const chartTooltipStyle = { backgroundColor: theme.palette.background.paper, border: `1px solid ${theme.palette.divider}`, borderRadius: 4, color: theme.palette.text.primary }
  const toast = useToast()

  const {
    allVms,
    cephTrends,
    clusterActionError,
    clusterActionLoading,
    clusterCephData,
    clusterCephLoading,
    clusterCephPerf,
    clusterCephPerfFiltered,
    clusterCephTimeframe,
    clusterConfig,
    clusterConfigLoaded,
    clusterConfigLoading,
    clusterHaGroups,
    clusterHaLoaded,
    clusterHaLoading,
    clusterHaResources,
    clusterHaRules,
    loadClusterHa,
    clusterNotesContent,
    clusterNotesEditMode,
    clusterNotesLoading,
    clusterNotesSaving,
    clusterPveMajorVersion,
    clusterStorageData,
    clusterStorageLoading,
    clusterTab,
    createClusterDialogOpen,
    cveAvailable,
    data,
    error,
    expandedClusterNodes,
    favorites,
    handleCreateCluster,
    handleJoinCluster,
    handleNodeBulkAction,
    handleSaveClusterNotes,
    handleTableMigrate,
    handleTableVmAction,
    joinClusterDialogOpen,
    joinClusterInfo,
    joinClusterPassword,
    joinInfoDialogOpen,
    loading,
    localVmsDialogNode,
    localVmsDialogOpen,
    migratingVmIds,
    newClusterLinks,
    newClusterName,
    nodeLocalVms,
    nodeUpdates,
    onSelect,
    primaryColor,
    rollingUpdateAvailable,
    rollingUpdateWizardOpen,
    selection,
    setClusterActionError,
    setClusterCephTimeframe,
    setClusterNotesContent,
    setClusterNotesEditMode,
    setClusterTab,
    setCreateClusterDialogOpen,
    setDeleteHaGroupDialog,
    setDeleteHaRuleDialog,
    setEditingHaGroup,
    setEditingHaRule,
    setExpandedClusterNodes,
    setHaGroupDialogOpen,
    setHaRuleDialogOpen,
    setHaRuleType,
    setJoinClusterDialogOpen,
    setJoinClusterInfo,
    setJoinClusterPassword,
    setJoinInfoDialogOpen,
    setLocalVmsDialogNode,
    setLocalVmsDialogOpen,
    setNewClusterLinks,
    setNewClusterName,
    setNodeLocalVms,
    setNodeUpdates,
    setRollingUpdateWizardOpen,
    setUpdatesDialogNode,
    setUpdatesDialogOpen,
    toggleFavorite,
    updatesDialogNode,
    updatesDialogOpen,
  } = props

  // Track active rolling update for this cluster (from global context)
  const { hasActiveUpdate, openMonitor } = useRollingUpdates()
  const clusterConnId = selection?.type === 'cluster' ? selection.id : ''
  const activeRollingUpdateId = hasActiveUpdate(clusterConnId)

  const drsHealth = useMemo(() => {
    if (!isEnterprise || !(drsStatus as any)?.enabled || !metricsData) return null
    const connId = selection?.type === 'cluster' ? selection.id : ''
    // Hide DRS status for clusters excluded from DRS
    if ((drsSettings as any)?.excluded_clusters?.includes(connId)) return null
    const clusterMetrics = (metricsData as any)?.[connId]
    if (!clusterMetrics?.summary) return null
    return computeDrsHealthScore(clusterMetrics.summary, clusterMetrics.nodes)
  }, [isEnterprise, drsStatus, drsSettings, metricsData, selection])

  const maxPendingRecs = drsSettings?.max_pending_recommendations || 10

  const clusterRecs = useMemo(() => {
    if (!drsRecommendations || !Array.isArray(drsRecommendations)) return []
    const connId = selection?.type === 'cluster' ? selection.id : ''
    return drsRecommendations
      .filter((r: any) => r.connection_id === connId && r.status === 'pending' && !executedRecIds.has(r.id))
      .sort((a: any, b: any) => (b.score || 0) - (a.score || 0))
      .slice(0, maxPendingRecs)
  }, [drsRecommendations, selection, executedRecIds, maxPendingRecs])

  // VMs/CTs available for HA (not already in HA resources, filtered by current cluster)
  const availableVmsForHa = useMemo(() => {
    const connId = selection?.type === 'cluster' ? selection.id : ''
    const existingSids = new Set((clusterHaResources || []).map((r: any) => r.sid))
    return (allVms || []).filter((vm: any) => {
      if (vm.connId !== connId) return false
      const sid = `${vm.type === 'lxc' ? 'ct' : 'vm'}:${vm.vmid}`
      return !existingSids.has(sid)
    })
  }, [allVms, clusterHaResources, selection])

  const handleAddHaResource = useCallback(async () => {
    if (!addHaSid) return
    setAddHaSaving(true)
    try {
      const connId = selection?.type === 'cluster' ? selection.id : ''
      const body: any = { state: addHaState, max_restart: addHaMaxRestart, max_relocate: addHaMaxRelocate }
      if (addHaGroup) body.group = addHaGroup
      if (addHaComment) body.comment = addHaComment
      const res = await fetch(`/api/v1/connections/${connId}/ha/${encodeURIComponent(addHaSid)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to create HA resource')
      }
      setAddHaDialogOpen(false)
      setAddHaSid('')
      setAddHaState('started')
      setAddHaMaxRestart(1)
      setAddHaMaxRelocate(1)
      setAddHaGroup('')
      setAddHaComment('')
      loadClusterHa(connId)
      toast.success(t('common.success'))
    } catch (e: any) {
      toast.error(e.message || t('errors.genericError'))
    } finally {
      setAddHaSaving(false)
    }
  }, [addHaSid, addHaState, addHaMaxRestart, addHaMaxRelocate, addHaGroup, addHaComment, selection, loadClusterHa, toast, t])

  const handleEvaluate = useCallback(async () => {
    setEvaluating(true)
    try {
      await fetch('/api/v1/orchestrator/drs/evaluate', { method: 'POST' })
      // Wait briefly for evaluation to produce results
      setTimeout(() => mutateRecs(), 3000)
    } catch { /* ignore */ } finally {
      setEvaluating(false)
    }
  }, [mutateRecs])

  const handleExecuteRec = useCallback(async (id: string, vmName: string) => {
    setExecutingRecId(id)
    try {
      const res = await fetch(`/api/v1/orchestrator/drs/recommendations/${id}/execute`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Action failed')
      }
      setExecutedRecIds(prev => new Set(prev).add(id))
      toast.success(t('inventory.drsExecSuccess', { vm: vmName }))
      setTimeout(() => mutateRecs(), 2000)
    } catch (e: any) {
      const msg = e.message || ''
      if (msg.includes('has moved') || msg.includes('stale')) {
        toast.warning(t('inventory.drsRecStale'))
        mutateRecs()
      } else if (msg.includes('not found')) {
        setExecutedRecIds(prev => new Set(prev).add(id))
        toast.warning(t('inventory.drsRecExpired'))
        mutateRecs()
      } else if (msg.includes('already on target')) {
        setExecutedRecIds(prev => new Set(prev).add(id))
        toast.info(t('inventory.drsAlreadyOnTarget'))
        mutateRecs()
      } else {
        toast.error(t('inventory.drsExecError', { error: msg }))
      }
    } finally {
      setExecutingRecId(null)
    }
  }, [mutateRecs, toast, t])

  const handleExecuteAll = useCallback(async () => {
    setExecutingAll(true)
    const recsToExecute = [...clusterRecs]
    let success = 0
    let errors = 0
    for (const rec of recsToExecute) {
      try {
        const res = await fetch(`/api/v1/orchestrator/drs/recommendations/${rec.id}/execute`, { method: 'POST' })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || 'Action failed')
        }
        setExecutedRecIds(prev => new Set(prev).add(rec.id))
        success++
      } catch {
        errors++
      }
    }
    if (errors === 0) {
      toast.success(t('inventory.drsExecAllSuccess', { count: success }))
    } else {
      toast.warning(t('inventory.drsExecAllPartial', { success, errors }))
    }
    setTimeout(() => mutateRecs(), 2000)
    setExecutingAll(false)
  }, [clusterRecs, mutateRecs, toast, t])

  // Auto-HA state
  const connId = selection?.type === 'cluster' ? selection.id : ''
  const [autoHaSettings, setAutoHaSettings] = useState<any>(null)
  const [autoHaLoading, setAutoHaLoading] = useState(false)
  const [autoHaSaving, setAutoHaSaving] = useState(false)
  const [autoHaSyncing, setAutoHaSyncing] = useState(false)
  const [autoHaSyncResult, setAutoHaSyncResult] = useState<any>(null)

  const loadAutoHaSettings = useCallback(async () => {
    if (!connId) return
    setAutoHaLoading(true)
    try {
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/ha/auto-ha`)
      const json = await res.json()
      setAutoHaSettings(json.data)
    } catch { /* ignore */ }
    setAutoHaLoading(false)
  }, [connId])

  const saveAutoHaSettings = useCallback(async (data: any) => {
    if (!connId) return
    setAutoHaSaving(true)
    try {
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/ha/auto-ha`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const json = await res.json()
      setAutoHaSettings(json.data)
    } catch { /* ignore */ }
    setAutoHaSaving(false)
  }, [connId])

  const syncAutoHa = useCallback(async () => {
    if (!connId) return
    setAutoHaSyncing(true)
    setAutoHaSyncResult(null)
    try {
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/ha/auto-ha/sync`, { method: 'POST' })
      const json = await res.json()
      setAutoHaSyncResult(json.data || json.error)
    } catch (e: any) {
      setAutoHaSyncResult({ error: e?.message })
    }
    setAutoHaSyncing(false)
  }, [connId])

  // Load Auto-HA settings when HA tab is activated
  useEffect(() => {
    if (clusterTab === 3 && connId && !autoHaSettings && !autoHaLoading) {
      loadAutoHaSettings()
    }
  }, [clusterTab, connId])

  // Fetch RRD data for all nodes when in Summary tab
  const [clusterNodeRrd, setClusterNodeRrd] = useState<Record<string, any[]>>({})
  const [clusterNodeRrdLoading, setClusterNodeRrdLoading] = useState(false)
  const [clusterNodeRrdTf, setClusterNodeRrdTf] = useState<'hour' | 'day' | 'week' | 'month' | 'year'>('hour')

  useEffect(() => {
    if (clusterTab !== 0 || !connId || !data.nodesData?.length) return
    const onlineNodes = (data.nodesData as any[]).filter((n: any) => n.status === 'online')
    if (onlineNodes.length === 0) return

    let cancelled = false
    setClusterNodeRrdLoading(true)

    ;(async () => {
      const result: Record<string, any[]> = {}
      await Promise.all(onlineNodes.map(async (node: any) => {
        try {
          const raw = await fetchRrd(connId, `/nodes/${node.node}`, clusterNodeRrdTf)
          if (!cancelled) result[node.node] = buildSeriesFromRrd(raw)
        } catch { /* ignore */ }
      }))
      if (!cancelled) {
        setClusterNodeRrd(result)
        setClusterNodeRrdLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [clusterTab, connId, data.nodesData?.length, clusterNodeRrdTf])

  // Merge RRD data into unified series with per-node keys
  const clusterRrdSeries = useMemo(() => {
    const nodeNames = Object.keys(clusterNodeRrd)
    if (nodeNames.length === 0) return []

    // Collect all timestamps
    const tsMap = new Map<number, any>()
    for (const nodeName of nodeNames) {
      for (const point of clusterNodeRrd[nodeName] || []) {
        if (!point.t) continue
        if (!tsMap.has(point.t)) tsMap.set(point.t, { t: point.t })
        const row = tsMap.get(point.t)!
        if (point.cpuPct !== undefined) row[`cpu_${nodeName}`] = point.cpuPct
        if (point.ramPct !== undefined) row[`ram_${nodeName}`] = point.ramPct
        if (point.netInBps !== undefined) row[`netIn_${nodeName}`] = point.netInBps
        if (point.netOutBps !== undefined) row[`netOut_${nodeName}`] = point.netOutBps
        if (point.loadAvg !== undefined) row[`load_${nodeName}`] = point.loadAvg
      }
    }
    return Array.from(tsMap.values()).sort((a, b) => a.t - b.t)
  }, [clusterNodeRrd])

  const clusterRrdNodeNames = useMemo(() => Object.keys(clusterNodeRrd), [clusterNodeRrd])

  // Colors for each node — distinct palette
  const nodeColors = useMemo(() => {
    const palette = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#8b5cf6', '#14b8a6']
    const map: Record<string, string> = {}
    clusterRrdNodeNames.forEach((name, i) => { map[name] = palette[i % palette.length] })
    return map
  }, [clusterRrdNodeNames])

  // Lazy-load subscription status when Nodes tab is opened
  const [nodeSubscriptions, setNodeSubscriptions] = useState<Record<string, string>>({})
  const [subscriptionsLoaded, setSubscriptionsLoaded] = useState(false)
  useEffect(() => {
    if (clusterTab !== 1 || !connId || subscriptionsLoaded || !data.nodesData?.length) return
    setSubscriptionsLoaded(true)

    const onlineNodes = (data.nodesData as any[]).filter((n: any) => n.status === 'online')
    if (onlineNodes.length === 0) return

    ;(async () => {
      const updates: Record<string, string> = {}
      await Promise.all(onlineNodes.map(async (node: any) => {
        try {
          const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node.node)}/subscription`, { cache: 'no-store' })
          if (res.ok) {
            const json = await res.json()
            updates[node.node] = json?.data?.status || 'notfound'
          }
        } catch { /* ignore */ }
      }))
      if (Object.keys(updates).length > 0) setNodeSubscriptions(updates)
    })()
  }, [clusterTab, connId, subscriptionsLoaded, data.nodesData?.length])

  // Reset subscription loaded flag on selection change
  useEffect(() => { setSubscriptionsLoaded(false); setNodeSubscriptions({}) }, [selection?.id])

  // Load cluster tags from connection
  useEffect(() => {
    const connId = selection?.type === 'cluster' ? selection.id : ''
    if (!connId || clusterTagsLoaded === connId) return
    setClusterTagsLoaded(connId)
    fetch(`/api/v1/connections/${encodeURIComponent(connId)}`)
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        const tags = json?.data?.tags
        setClusterTags(tags ? String(tags).split(';').filter(Boolean) : [])
      })
      .catch(() => {})
  }, [selection?.id, selection?.type, clusterTagsLoaded])

  // Enrich nodesData with subscription info for NodesTable
  const enrichedNodesData = useMemo(() => {
    if (!data.nodesData || Object.keys(nodeSubscriptions).length === 0) return data.nodesData
    return (data.nodesData as any[]).map((n: any) => nodeSubscriptions[n.node] ? { ...n, subscription: nodeSubscriptions[n.node] } : n)
  }, [data.nodesData, nodeSubscriptions])

  // Fetch Ceph OSD flags when in summary tab and ceph is available
  useEffect(() => {
    if (clusterTab !== 0 || !['HEALTH_OK', 'HEALTH_WARN', 'HEALTH_ERR'].includes(data.cephHealth) || !connId) return
    let cancelled = false
    setCephOsdFlagsLoading(true)
    fetch(`/api/v1/connections/${connId}/ceph/flags`)
      .then(res => res.json())
      .then(json => {
        if (!cancelled) setCephOsdFlags(json.data?.flags || [])
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setCephOsdFlagsLoading(false) })
    return () => { cancelled = true }
  }, [clusterTab, data.cephHealth, connId])

  const handleRemoveCephFlag = useCallback(async (flag: string) => {
    if (!connId) return
    setCephFlagToggling(flag)
    try {
      const res = await fetch(`/api/v1/connections/${connId}/ceph/flags`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flag }),
      })
      if (res.ok) {
        setCephOsdFlags(prev => prev.filter(f => f !== flag))
        toast.success(t('ceph.flagUnset', { flag }))
      }
    } catch { /* ignore */ }
    setCephFlagToggling(null)
  }, [connId, toast, t])

  const TrendIcon = ({ trend }: { trend: 'up' | 'down' | 'stable' }) => {
    if (trend === 'up') return <i className="ri-arrow-up-line" style={{ color: '#4caf50', fontSize: 14 }} />
    if (trend === 'down') return <i className="ri-arrow-down-line" style={{ color: '#f44336', fontSize: 14 }} />
    return <i className="ri-arrow-right-line" style={{ color: '#9e9e9e', fontSize: 14 }} />
  }

  return (
    <>
          {/* Onglets pour Cluster: Summary / Nodes / VMs / HA / Backups / Notes / Ceph / Storage / Firewall / Rolling Update / Cluster */}
          {selection?.type === 'cluster' && data.nodesData ? (
            <Card variant="outlined" sx={{ width: '100%', borderRadius: 2, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <Tabs
                value={clusterTab}
                onChange={(_e, v) => setClusterTab(v)}
                sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}
                variant="scrollable"
                scrollButtons="auto"
              >
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-dashboard-line" style={{ fontSize: 16 }} />
                      {t('inventory.tabSummary')}
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-server-line" style={{ fontSize: 16 }} />
                      {t('inventory.tabNodes')}
                      <Chip size="small" label={data.nodesData.length} sx={{ height: 18, fontSize: 11 }} />
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-computer-line" style={{ fontSize: 16 }} />
                      {t('inventory.guests')}
                      {data.vmsCount !== undefined && (
                        <Chip size="small" label={data.vmsCount} sx={{ height: 18, fontSize: 11 }} />
                      )}
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-shield-check-line" style={{ fontSize: 16 }} />
                      {t('inventory.tabHighAvailability')}
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-calendar-schedule-line" style={{ fontSize: 16 }} />
                      {t('inventory.tabBackups')}
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-camera-line" style={{ fontSize: 16 }} />
                      {t('inventory.tabSnapshots')}
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-file-text-line" style={{ fontSize: 16 }} />
                      {t('inventory.tabNotes')}
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-database-2-line" style={{ fontSize: 16 }} />
                      {t('inventory.tabCeph')}
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-hard-drive-2-line" style={{ fontSize: 16 }} />
                      {t('inventory.tabStorage')}
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-shield-keyhole-line" style={{ fontSize: 16 }} />
                      {t('inventory.tabFirewall')}
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-git-branch-line" style={{ fontSize: 16 }} />
                      {t('inventory.tabCluster')}
                    </Box>
                  }
                />
                <Tab
                  disabled={!rollingUpdateAvailable}
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, opacity: rollingUpdateAvailable ? 1 : 0.4 }}>
                      <i className="ri-refresh-line" style={{ fontSize: 16 }} />
                      {t('inventory.tabRollingUpdate')}
                      {!rollingUpdateAvailable && (
                        <Chip
                          size="small"
                          label="Enterprise"
                          sx={{
                            height: 18,
                            fontSize: '0.6rem',
                            fontWeight: 600,
                            bgcolor: 'primary.main',
                            color: 'primary.contrastText',
                            ml: 0.5,
                            '& .MuiChip-label': { px: 0.75 }
                          }}
                        />
                      )}
                    </Box>
                  }
                />
                <Tab
                  disabled={!cveAvailable}
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, opacity: cveAvailable ? 1 : 0.4 }}>
                      <i className="ri-shield-cross-line" style={{ fontSize: 16 }} />
                      CVE
                      {!cveAvailable && (
                        <Chip
                          size="small"
                          label="Enterprise"
                          sx={{
                            height: 18,
                            fontSize: '0.6rem',
                            fontWeight: 600,
                            bgcolor: 'primary.main',
                            color: 'primary.contrastText',
                            ml: 0.5,
                            '& .MuiChip-label': { px: 0.75 }
                          }}
                        />
                      )}
                    </Box>
                  }
                />
                <Tab
                  disabled={!hasFeature(Features.CHANGE_TRACKING)}
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, opacity: hasFeature(Features.CHANGE_TRACKING) ? 1 : 0.4 }}>
                      <i className="ri-git-commit-line" style={{ fontSize: 16 }} />
                      {t('inventory.tabChangeTracking')}
                      {!hasFeature(Features.CHANGE_TRACKING) && (
                        <Chip
                          size="small"
                          label="Enterprise"
                          sx={{
                            height: 18,
                            fontSize: '0.6rem',
                            fontWeight: 600,
                            bgcolor: 'primary.main',
                            color: 'primary.contrastText',
                            ml: 0.5,
                            '& .MuiChip-label': { px: 0.75 }
                          }}
                        />
                      )}
                    </Box>
                  }
                />
                <Tab
                  disabled={!hasFeature(Features.COMPLIANCE)}
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, opacity: hasFeature(Features.COMPLIANCE) ? 1 : 0.4 }}>
                      <i className="ri-shield-check-line" style={{ fontSize: 16 }} />
                      {t('inventory.tabCompliance')}
                      {!hasFeature(Features.COMPLIANCE) && (
                        <Chip
                          size="small"
                          label="Enterprise"
                          sx={{
                            height: 18,
                            fontSize: '0.6rem',
                            fontWeight: 600,
                            bgcolor: 'primary.main',
                            color: 'primary.contrastText',
                            ml: 0.5,
                            '& .MuiChip-label': { px: 0.75 }
                          }}
                        />
                      )}
                    </Box>
                  }
                />
              </Tabs>
              
              <CardContent sx={{ p: 0, '&:last-child': { pb: 0 }, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
                {/* Onglet Summary - Index 0 */}
                {clusterTab === 0 && (
                  <Box sx={{ p: 2, overflow: 'auto' }}>
                    {/* Ligne 1: Health, Guests, Resources */}
                    <Box sx={{ 
                      display: 'grid', 
                      gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, 
                      gap: 2,
                      mb: 2
                    }}>
                      {/* Section Health */}
                      <Card variant="outlined" sx={{ height: '100%' }}>
                        <CardContent sx={{ p: 2 }}>
                          <Typography variant="subtitle2" color="primary" fontWeight={700} sx={{ mb: 2 }}>
                            {t('inventory.healthLabel')}
                          </Typography>
                          <Grid container spacing={3}>
                              {/* Status */}
                              <Grid size={4} sx={{ textAlign: 'center' }}>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>{t('inventory.statusLabel')}</Typography>
                                <Box sx={{ 
                                  width: 48, 
                                  height: 48, 
                                  borderRadius: '50%', 
                                  bgcolor: data.status === 'ok' ? 'success.main' : data.status === 'warn' ? 'warning.main' : 'error.main', 
                                  display: 'flex', 
                                  alignItems: 'center', 
                                  justifyContent: 'center',
                                  mx: 'auto',
                                  mb: 1
                                }}>
                                  <i className={data.status === 'ok' ? "ri-check-line" : "ri-alert-line"} style={{ fontSize: 24, color: '#fff' }} />
                                </Box>
                                <Typography variant="caption" sx={{ display: 'block' }}>
                                  {t('inventory.tabCluster')}: {data.title}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {t('inventory.quorateYes')}
                                </Typography>
                              </Grid>
                              {/* Nodes */}
                              <Grid size={4} sx={{ textAlign: 'center' }}>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>{t('inventory.nodesLabel')}</Typography>
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'success.main' }} />
                                    <Typography variant="body2">{t('inventory.online')}</Typography>
                                    <Typography variant="body2" fontWeight={700}>
                                      {(data.nodesData as any[])?.filter((n: any) => n.status === 'online').length || 0}
                                    </Typography>
                                  </Box>
                                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'error.main' }} />
                                    <Typography variant="body2">{t('inventory.offline')}</Typography>
                                    <Typography variant="body2" fontWeight={700}>
                                      {(data.nodesData as any[])?.filter((n: any) => n.status !== 'online').length || 0}
                                    </Typography>
                                  </Box>
                                </Box>
                              </Grid>
                              {/* Ceph */}
                              <Grid size={4} sx={{ textAlign: 'center' }}>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>{t('inventory.cephLabel')}</Typography>
                                <Box sx={{
                                  width: 48,
                                  height: 48,
                                  borderRadius: '50%',
                                  bgcolor: data.cephHealth === 'HEALTH_OK' ? 'success.main' :
                                           data.cephHealth === 'HEALTH_WARN' ? 'warning.dark' :
                                           data.cephHealth ? 'error.main' : 'action.disabledBackground',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  mx: 'auto',
                                  mb: 1
                                }}>
                                  <i className={data.cephHealth === 'HEALTH_OK' ? "ri-check-line" : data.cephHealth === 'HEALTH_WARN' ? "ri-alert-line" : data.cephHealth ? "ri-close-line" : "ri-question-line"} style={{ fontSize: 24, color: '#fff' }} />
                                </Box>
                                <Typography variant="caption" sx={{
                                  fontWeight: 600,
                                  color: data.cephHealth === 'HEALTH_OK' ? 'success.main' :
                                         data.cephHealth === 'HEALTH_WARN' ? 'warning.main' :
                                         data.cephHealth ? 'error.main' : 'text.secondary'
                                }}>
                                  {data.cephHealth === 'HEALTH_OK' ? t('inventory.healthy') :
                                   data.cephHealth === 'HEALTH_WARN' ? t('inventory.warning') :
                                   data.cephHealth ? t('inventory.error') : t('inventory.notAvailable')}
                                </Typography>
                              </Grid>
                            </Grid>
                          </CardContent>
                        </Card>

                      {/* Section Guests */}
                      <Card variant="outlined" sx={{ height: '100%' }}>
                        <CardContent sx={{ p: 2 }}>
                            <Typography variant="subtitle2" color="primary" fontWeight={700} sx={{ mb: 2 }}>
                              {t('inventory.guests')}
                            </Typography>
                            <Grid container spacing={2}>
                              {/* Virtual Machines */}
                              <Grid size={6}>
                                <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>{t('inventory.virtualMachines')}</Typography>
                                {(() => {
                                  const allVms = (data as any).allVms || []
                                  const qemuVms = allVms.filter((v: any) => v.type === 'qemu')
                                  const running = qemuVms.filter((v: any) => v.status === 'running').length
                                  const stopped = qemuVms.filter((v: any) => v.status === 'stopped').length
                                  const templates = qemuVms.filter((v: any) => v.template).length
                                  return (
                                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'success.main' }} />
                                        <Typography variant="body2">{t('inventory.running')}</Typography>
                                        <Typography variant="body2" fontWeight={700} sx={{ ml: 'auto' }}>{running}</Typography>
                                      </Box>
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'text.disabled' }} />
                                        <Typography variant="body2">{t('inventory.stopped')}</Typography>
                                        <Typography variant="body2" fontWeight={700} sx={{ ml: 'auto' }}>{stopped}</Typography>
                                      </Box>
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'transparent', border: '1px solid', borderColor: 'text.disabled' }} />
                                        <Typography variant="body2">{t('inventory.templates')}</Typography>
                                        <Typography variant="body2" fontWeight={700} sx={{ ml: 'auto' }}>{templates}</Typography>
                                      </Box>
                                    </Box>
                                  )
                                })()}
                              </Grid>
                              {/* LXC Containers */}
                              <Grid size={6}>
                                <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>{t('inventory.lxcContainers')}</Typography>
                                {(() => {
                                  const allVms = (data as any).allVms || []
                                  const lxcVms = allVms.filter((v: any) => v.type === 'lxc')
                                  const running = lxcVms.filter((v: any) => v.status === 'running').length
                                  const stopped = lxcVms.filter((v: any) => v.status === 'stopped').length
                                  return (
                                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'success.main' }} />
                                        <Typography variant="body2">{t('inventory.running')}</Typography>
                                        <Typography variant="body2" fontWeight={700} sx={{ ml: 'auto' }}>{running}</Typography>
                                      </Box>
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'text.disabled' }} />
                                        <Typography variant="body2">{t('inventory.stopped')}</Typography>
                                        <Typography variant="body2" fontWeight={700} sx={{ ml: 'auto' }}>{stopped}</Typography>
                                      </Box>
                                    </Box>
                                  )
                                })()}
                              </Grid>
                            </Grid>
                          </CardContent>
                        </Card>

                      {/* Section Resources */}
                      <Card variant="outlined" sx={{ height: '100%' }}>
                        <CardContent sx={{ p: 2 }}>
                          <Typography variant="subtitle2" color="primary" fontWeight={700} sx={{ mb: 2 }}>
                            {t('inventory.resources')}
                          </Typography>
                          <Grid container spacing={3}>
                              {(() => {
                                // Utiliser data.metrics qui contient les vraies valeurs
                                const cpuPercent = data.metrics?.cpu?.pct || 0
                                const memPercent = data.metrics?.ram?.pct || 0
                                const usedMem = data.metrics?.ram?.used || 0
                                const totalMem = data.metrics?.ram?.max || 0
                                const storagePercent = data.metrics?.storage?.pct || 0
                                const usedStorage = data.metrics?.storage?.used || 0
                                const totalStorage = data.metrics?.storage?.max || 0
                                
                                // Compter les CPU totaux depuis nodesData
                                const nodes = (data.nodesData as any[]) || []
                                const totalCpuCores = nodes.length > 0 ? nodes.length * 8 : 0 // Approximation, ou utiliser les vraies valeurs si disponibles
                                
                                return (
                                  <>
                                    {/* CPU */}
                                    <Grid size={{ xs: 12, md: 4 }} sx={{ textAlign: 'center' }}>
                                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>CPU</Typography>
                                      <Box sx={{ position: 'relative', display: 'inline-flex', mb: 1 }}>
                                        <CircularProgress
                                          variant="determinate"
                                          value={cpuPercent}
                                          size={80}
                                          thickness={22}
                                          sx={{ color: cpuPercent > 80 ? 'error.main' : cpuPercent > 60 ? 'warning.main' : 'success.main' }}
                                        />
                                        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                          <Typography variant="h6" fontWeight={700}>{cpuPercent}%</Typography>
                                        </Box>
                                      </Box>
                                      <Typography variant="caption" sx={{ display: 'block' }}>
                                        {t('cluster.nodesCount', { count: nodes.length })}
                                      </Typography>
                                    </Grid>
                                    {/* Memory */}
                                    <Grid size={{ xs: 12, md: 4 }} sx={{ textAlign: 'center' }}>
                                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>{t('inventory.memoryLabel')}</Typography>
                                      <Box sx={{ position: 'relative', display: 'inline-flex', mb: 1 }}>
                                        <CircularProgress
                                          variant="determinate"
                                          value={memPercent}
                                          size={80}
                                          thickness={22}
                                          sx={{ color: memPercent > 80 ? 'error.main' : memPercent > 60 ? 'warning.main' : 'success.main' }}
                                        />
                                        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                          <Typography variant="h6" fontWeight={700}>{memPercent}%</Typography>
                                        </Box>
                                      </Box>
                                      <Typography variant="caption" sx={{ display: 'block' }}>
                                        {t('cluster.usageOf', { used: formatBytes(usedMem), total: formatBytes(totalMem) })}
                                      </Typography>
                                    </Grid>
                                    {/* Storage */}
                                    <Grid size={{ xs: 12, md: 4 }} sx={{ textAlign: 'center' }}>
                                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>{t('inventory.storageLabel')}</Typography>
                                      <Box sx={{ position: 'relative', display: 'inline-flex', mb: 1 }}>
                                        <CircularProgress
                                          variant="determinate"
                                          value={storagePercent}
                                          size={80}
                                          thickness={22}
                                          sx={{ color: storagePercent > 80 ? 'error.main' : storagePercent > 60 ? 'warning.main' : 'success.main' }}
                                        />
                                        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                          <Typography variant="h6" fontWeight={700}>{storagePercent}%</Typography>
                                        </Box>
                                      </Box>
                                      <Typography variant="caption" sx={{ display: 'block' }}>
                                        {t('cluster.usageOf', { used: formatBytes(usedStorage), total: formatBytes(totalStorage) })}
                                      </Typography>
                                    </Grid>
                                  </>
                                )
                              })()}
                            </Grid>
                          </CardContent>
                        </Card>
                    </Box>

                    {/* Ceph OSD Flags */}
                    {['HEALTH_OK', 'HEALTH_WARN', 'HEALTH_ERR'].includes(data.cephHealth) && cephOsdFlags.length > 0 && (
                      <Card variant="outlined" sx={{ mb: 2 }}>
                        <CardContent sx={{ py: 1.5, px: 2 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <img src="/images/ceph-logo.svg" alt="Ceph" width={18} height={18} />
                              <Typography variant="subtitle2" fontWeight={700}>{t('ceph.osdFlags')}</Typography>
                            </Box>
                            {cephOsdFlagsLoading && <CircularProgress size={16} />}
                          </Box>
                          {!cephOsdFlagsLoading && cephOsdFlags.length === 0 && (
                            <Typography variant="body2" color="text.secondary" sx={{ opacity: 0.6 }}>
                              {t('ceph.noOsdFlagsActive')}
                            </Typography>
                          )}
                          {cephOsdFlags.length > 0 && (
                            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                              {cephOsdFlags.map(flag => (
                                <Chip
                                  key={flag}
                                  label={flag}
                                  size="small"
                                  color="warning"
                                  onDelete={() => handleRemoveCephFlag(flag)}
                                  disabled={cephFlagToggling === flag}
                                  deleteIcon={cephFlagToggling === flag ? <CircularProgress size={14} /> : undefined}
                                  sx={{ fontFamily: 'monospace', fontSize: 11, height: 24 }}
                                />
                              ))}
                            </Box>
                          )}
                        </CardContent>
                      </Card>
                    )}

                    {/* DRS Status */}
                    {drsHealth !== null && (
                      <Card variant="outlined" sx={{ mb: 2 }}>
                        <CardContent sx={{ py: 1.5, px: 2 }}>
                          {/* Header row: score ring + title + breakdown + actions */}
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                            <Box sx={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
                              <CircularProgress
                                variant="determinate"
                                value={drsHealth.score}
                                size={48}
                                thickness={5}
                                sx={{ color: drsHealth.score >= 85 ? 'success.main' : drsHealth.score >= 60 ? 'warning.main' : 'error.main' }}
                              />
                              <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Typography variant="caption" fontWeight={700} sx={{ fontSize: 11 }}>{drsHealth.score}</Typography>
                              </Box>
                            </Box>
                            <Box sx={{ minWidth: 100 }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Typography variant="subtitle2" fontWeight={700}>{t('inventory.drsStatusTitle')}</Typography>
                                {(() => {
                                  const connId = selection?.type === 'cluster' ? selection.id : ''
                                  const effectiveMode = (drsSettings as any)?.cluster_modes?.[connId] || (drsSettings as any)?.mode || 'manual'
                                  const modeColor = effectiveMode === 'automatic' ? 'success' : effectiveMode === 'partial' ? 'warning' : 'info'
                                  const modeLabel = effectiveMode.charAt(0).toUpperCase() + effectiveMode.slice(1)
                                  return <Chip size="small" label={modeLabel} color={modeColor as any} variant="outlined" />
                                })()}
                              </Box>
                              <Typography variant="body2" color="text.secondary" sx={{ fontSize: 11 }}>
                                {drsHealth.score} / 100 — {drsHealth.score >= 85 ? t('drsPage.balanced') : drsHealth.score >= 60 ? t('drsPage.toOptimize') : t('drsPage.unbalanced')}
                              </Typography>
                            </Box>

                            {/* Score breakdown - inline */}
                            <Box sx={{ display: 'flex', gap: 1, flex: 1, minWidth: 0 }}>
                              {[
                                { label: t('inventory.drsAvgMemory'), value: drsHealth.avgMem, penalty: drsHealth.memPenalty },
                                { label: t('inventory.drsAvgCpu'), value: drsHealth.avgCpu, penalty: drsHealth.cpuPenalty },
                                { label: t('inventory.drsImbalance'), value: drsHealth.imbalance, penalty: drsHealth.imbalancePenalty },
                              ].map((item) => (
                                <Box
                                  key={item.label}
                                  sx={{
                                    flex: 1,
                                    minWidth: 0,
                                    px: 1,
                                    py: 0.5,
                                    borderRadius: 1,
                                    bgcolor: (t) => alpha(t.palette.divider, 0.3),
                                    textAlign: 'center',
                                  }}
                                >
                                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.2, fontSize: 10 }}>
                                    {item.label}
                                  </Typography>
                                  <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 0.5 }}>
                                    <Typography variant="body2" fontWeight={600} sx={{ fontSize: 12 }}>
                                      {item.value.toFixed(1)}%
                                    </Typography>
                                    {item.penalty !== 0 ? (
                                      <Typography variant="caption" color="error.main" fontWeight={600} sx={{ fontSize: 10 }}>
                                        {item.penalty}
                                      </Typography>
                                    ) : (
                                      <Typography variant="caption" color="success.main" fontWeight={600} sx={{ fontSize: 10 }}>
                                        OK
                                      </Typography>
                                    )}
                                  </Box>
                                </Box>
                              ))}
                            </Box>

                            <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
                              <MuiTooltip title={t('inventory.drsEvaluate')}>
                                <span>
                                  <IconButton size="small" onClick={handleEvaluate} disabled={evaluating} sx={{ width: 32, height: 32 }}>
                                    {evaluating ? <CircularProgress size={16} /> : <i className="ri-refresh-line" style={{ fontSize: 18 }} />}
                                  </IconButton>
                                </span>
                              </MuiTooltip>
                              <MuiTooltip title={t('inventory.drsGoToDrs')}>
                                <IconButton size="small" onClick={() => router.push('/automation/drs')} sx={{ width: 32, height: 32 }}>
                                  <i className="ri-settings-3-line" style={{ fontSize: 18 }} />
                                </IconButton>
                              </MuiTooltip>
                            </Stack>
                          </Box>

                          {/* Recommendations for this cluster */}
                          {clusterRecs.length > 0 && (
                            <>
                              <Divider sx={{ my: 1.5 }} />
                              <Box
                                sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none' }}
                                onClick={() => setRecsExpanded(prev => !prev)}
                              >
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <i
                                    className={recsExpanded ? 'ri-subtract-line' : 'ri-add-line'}
                                    style={{ fontSize: 18, opacity: 0.6 }}
                                  />
                                  <Typography variant="caption" color="text.secondary" fontWeight={600}>
                                    {t('inventory.drsPendingRecs', { count: clusterRecs.length })}
                                  </Typography>
                                </Box>
                              </Box>
                              <Collapse in={recsExpanded} timeout="auto">
                                <Stack spacing={0.75} sx={{ mt: 1 }}>
                                  {clusterRecs.map((rec: any) => {
                                    const pColor = rec.priority === 'critical' || rec.priority === 3 ? 'error'
                                      : rec.priority === 'high' || rec.priority === 2 ? 'warning'
                                      : rec.priority === 'medium' || rec.priority === 1 ? 'info' : 'default'
                                    const isExecuting = executingRecId === rec.id
                                    const isExpanded = expandedRecId === rec.id
                                    return (
                                      <Box key={rec.id}>
                                        <Box
                                          sx={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 1.5,
                                            py: 0.75,
                                            px: 1.5,
                                            borderRadius: 1,
                                            border: '1px solid',
                                            borderColor: isExpanded ? 'primary.main' : 'divider',
                                            cursor: 'pointer',
                                            '&:hover': { borderColor: 'primary.main', bgcolor: (t) => alpha(t.palette.primary.main, 0.03) },
                                          }}
                                          onClick={async () => {
                                            if (isExpanded) {
                                              setExpandedRecId(null)
                                              setRecSeries([])
                                              return
                                            }
                                            setExpandedRecId(rec.id)
                                            setRecSeries([])
                                            setRecRrdLoading(true)
                                            try {
                                              const guestType = rec.guest_type || 'qemu'
                                              const data = await fetchRrd(rec.connection_id, `/nodes/${rec.source_node}/${guestType}/${rec.vmid}`, 'hour')
                                              setRecSeries(buildSeriesFromRrd(data))
                                            } catch {
                                              setRecSeries([])
                                            } finally {
                                              setRecRrdLoading(false)
                                            }
                                          }}
                                        >
                                          <i className={isExpanded ? 'ri-arrow-down-s-line' : 'ri-swap-line'} style={{ fontSize: 16, opacity: 0.5 }} />
                                          <Typography variant="body2" fontWeight={600} noWrap sx={{ flex: 1, minWidth: 0, fontSize: '0.8rem' }}>
                                            {rec.vm_name || `VM ${rec.vmid}`}{' '}
                                            <Typography component="span" variant="caption" color="text.secondary" sx={{ fontWeight: 400 }}>
                                              ({rec.reason})
                                            </Typography>
                                          </Typography>
                                          <Chip
                                            size="small"
                                            label={rec.source_node}
                                            sx={{ height: 20, fontSize: 10, bgcolor: (t) => alpha(t.palette.error.main, 0.1), color: 'error.main', fontWeight: 500 }}
                                          />
                                          <Typography variant="caption" sx={{ opacity: 0.4 }}>→</Typography>
                                          <Chip
                                            size="small"
                                            label={rec.target_node}
                                            sx={{ height: 20, fontSize: 10, bgcolor: (t) => alpha(t.palette.success.main, 0.1), color: 'success.main', fontWeight: 500 }}
                                          />
                                          <Chip size="small" color={pColor as any} label={(typeof rec.priority === 'number' ? ['low', 'medium', 'high', 'critical'][rec.priority] : rec.priority).toUpperCase()} sx={{ height: 20, fontSize: 10, minWidth: 50 }} />
                                          <MuiTooltip title={t('inventory.drsExecOne')}>
                                            <span>
                                              <IconButton
                                                size="small"
                                                color="primary"
                                                disabled={isExecuting || executingAll || (executingRecId !== null && !isExecuting)}
                                                onClick={(e) => { e.stopPropagation(); handleExecuteRec(rec.id, rec.vm_name || `VM ${rec.vmid}`) }}
                                                sx={{ width: 28, height: 28 }}
                                              >
                                                {isExecuting ? <CircularProgress size={14} /> : <i className="ri-play-line" style={{ fontSize: 16 }} />}
                                              </IconButton>
                                            </span>
                                          </MuiTooltip>
                                        </Box>
                                        <Collapse in={isExpanded} timeout="auto">
                                          <Box sx={{ px: 1.5, py: 1.5 }}>
                                            {recRrdLoading ? (
                                              <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                                                <CircularProgress size={20} />
                                              </Box>
                                            ) : recSeries.length > 0 ? (
                                              <Grid container spacing={2}>
                                                <Grid size={{ xs: 6 }}>
                                                  <AreaPctChart title="CPU" data={recSeries} dataKey="cpuPct" height={140} />
                                                </Grid>
                                                <Grid size={{ xs: 6 }}>
                                                  <AreaPctChart title="RAM" data={recSeries} dataKey="ramPct" height={140} />
                                                </Grid>
                                              </Grid>
                                            ) : (
                                              <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                                                No RRD data available
                                              </Typography>
                                            )}
                                          </Box>
                                        </Collapse>
                                      </Box>
                                    )
                                  })}
                                </Stack>
                              </Collapse>
                            </>
                          )}
                          {clusterRecs.length === 0 && drsHealth.score >= 85 && (
                            <>
                              <Divider sx={{ my: 1.5 }} />
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
                                <i className="ri-checkbox-circle-line" style={{ fontSize: 16, color: theme.palette.success.main }} />
                                <Typography variant="caption" color="success.main" fontWeight={500}>
                                  {t('inventory.drsClusterBalanced')}
                                </Typography>
                              </Box>
                            </>
                          )}
                        </CardContent>
                      </Card>
                    )}

                    {/* Section Nodes Table removed — now in dedicated Nodes tab */}
                    {/* Cluster RRD Charts — all nodes overlaid */}
                    {clusterRrdSeries.length > 0 && (
                      <>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 2, mb: 1.5 }}>
                        <Typography fontWeight={700} fontSize={14}>{t('inventory.performances')}</Typography>
                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                          {([
                            { label: '1h', value: 'hour' as const },
                            { label: '24h', value: 'day' as const },
                            { label: '7d', value: 'week' as const },
                            { label: '30d', value: 'month' as const },
                            { label: '1y', value: 'year' as const },
                          ]).map(opt => (
                            <Chip
                              key={opt.value}
                              label={opt.label}
                              size="small"
                              onClick={() => setClusterNodeRrdTf(opt.value)}
                              sx={{
                                height: 24, fontSize: 11, fontWeight: 600,
                                bgcolor: clusterNodeRrdTf === opt.value ? 'primary.main' : 'action.hover',
                                color: clusterNodeRrdTf === opt.value ? 'primary.contrastText' : 'text.secondary',
                                '&:hover': { bgcolor: clusterNodeRrdTf === opt.value ? 'primary.dark' : 'action.selected' },
                                cursor: 'pointer',
                              }}
                            />
                          ))}
                        </Box>
                      </Box>
                      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
                        {/* CPU Usage */}
                        <ExpandableChart title={t('inventory.cpuUsage')} height={185}>
                          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                            <AreaChart data={clusterRrdSeries} margin={{ top: 2, right: 4, bottom: 0, left: 4 }}>
                              <defs>
                                {clusterRrdNodeNames.map(name => (
                                  <linearGradient key={name} id={`cGradCpu_${name}`} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor={nodeColors[name]} stopOpacity={0.25} />
                                    <stop offset="100%" stopColor={nodeColors[name]} stopOpacity={0} />
                                  </linearGradient>
                                ))}
                              </defs>
                              <XAxis dataKey="t" tickFormatter={v => formatTime(Number(v))} minTickGap={40} tick={{ fontSize: 9 }} />
                              <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 9 }} width={30} />
                              <Tooltip
                                wrapperStyle={{ zIndex: 10 }}
                                content={({ active, payload, label }) => {
                                  if (!active || !payload?.length) return null
                                  const sorted = [...payload].sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0))
                                  return (
                                    <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1, boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11 }}>
                                      <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', mb: 0.5 }}>{new Date(Number(label)).toLocaleString()}</Typography>
                                      {sorted.map(entry => (
                                        <Box key={String(entry.dataKey)} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, py: 0.1 }}>
                                          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                                          <Typography variant="caption" sx={{ flex: 1 }}>{String(entry.name).replaceAll('cpu_', '')}</Typography>
                                          <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>{Number(entry.value).toFixed(1)}%</Typography>
                                        </Box>
                                      ))}
                                    </Box>
                                  )
                                }}
                              />
                              {clusterRrdNodeNames.map(name => (
                                <Area key={name} type="monotone" dataKey={`cpu_${name}`} stroke={nodeColors[name]} fill={`url(#cGradCpu_${name})`} strokeWidth={1.5} isAnimationActive={false} connectNulls />
                              ))}
                            </AreaChart>
                          </ResponsiveContainer>
                        </ExpandableChart>

                        {/* Memory Usage */}
                        <ExpandableChart title={t('inventory.memoryUsage')} height={185}>
                          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                            <AreaChart data={clusterRrdSeries} margin={{ top: 2, right: 4, bottom: 0, left: 4 }}>
                              <defs>
                                {clusterRrdNodeNames.map(name => (
                                  <linearGradient key={name} id={`cGradRam_${name}`} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor={nodeColors[name]} stopOpacity={0.25} />
                                    <stop offset="100%" stopColor={nodeColors[name]} stopOpacity={0} />
                                  </linearGradient>
                                ))}
                              </defs>
                              <XAxis dataKey="t" tickFormatter={v => formatTime(Number(v))} minTickGap={40} tick={{ fontSize: 9 }} />
                              <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 9 }} width={30} />
                              <Tooltip
                                wrapperStyle={{ zIndex: 10 }}
                                content={({ active, payload, label }) => {
                                  if (!active || !payload?.length) return null
                                  const sorted = [...payload].sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0))
                                  return (
                                    <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1, boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11 }}>
                                      <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', mb: 0.5 }}>{new Date(Number(label)).toLocaleString()}</Typography>
                                      {sorted.map(entry => (
                                        <Box key={String(entry.dataKey)} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, py: 0.1 }}>
                                          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                                          <Typography variant="caption" sx={{ flex: 1 }}>{String(entry.name).replaceAll('ram_', '')}</Typography>
                                          <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>{Number(entry.value).toFixed(1)}%</Typography>
                                        </Box>
                                      ))}
                                    </Box>
                                  )
                                }}
                              />
                              {clusterRrdNodeNames.map(name => (
                                <Area key={name} type="monotone" dataKey={`ram_${name}`} stroke={nodeColors[name]} fill={`url(#cGradRam_${name})`} strokeWidth={1.5} isAnimationActive={false} connectNulls />
                              ))}
                            </AreaChart>
                          </ResponsiveContainer>
                        </ExpandableChart>

                        {/* Network Traffic */}
                        <ExpandableChart title={t('inventory.networkTrafficChart')} height={185}>
                          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                            <AreaChart data={clusterRrdSeries} margin={{ top: 2, right: 4, bottom: 0, left: 4 }}>
                              <defs>
                                {clusterRrdNodeNames.map(name => (
                                  <linearGradient key={name} id={`cGradNet_${name}`} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor={nodeColors[name]} stopOpacity={0.25} />
                                    <stop offset="100%" stopColor={nodeColors[name]} stopOpacity={0} />
                                  </linearGradient>
                                ))}
                              </defs>
                              <XAxis dataKey="t" tickFormatter={v => formatTime(Number(v))} minTickGap={40} tick={{ fontSize: 9 }} />
                              <YAxis tickFormatter={v => formatBps(Number(v))} tick={{ fontSize: 9 }} width={50} domain={[0, 'auto']} />
                              <Tooltip
                                wrapperStyle={{ zIndex: 10 }}
                                content={({ active, payload, label }) => {
                                  if (!active || !payload?.length) return null
                                  const sorted = [...payload].sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0))
                                  return (
                                    <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1, boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11 }}>
                                      <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', mb: 0.5 }}>{new Date(Number(label)).toLocaleString()}</Typography>
                                      {sorted.map(entry => {
                                        const isOut = String(entry.name).startsWith('netOut_')
                                        const nodeName = String(entry.name).replace(/^net(In|Out)_/, '')
                                        return (
                                          <Box key={String(entry.dataKey)} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, py: 0.1 }}>
                                            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                                            <Typography variant="caption" sx={{ flex: 1 }}>{nodeName} {isOut ? '↑ Out' : '↓ In'}</Typography>
                                            <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>{formatBps(Number(entry.value))}</Typography>
                                          </Box>
                                        )
                                      })}
                                    </Box>
                                  )
                                }}
                              />
                              {clusterRrdNodeNames.map(name => (
                                <Area key={`in_${name}`} type="monotone" dataKey={`netIn_${name}`} stroke={nodeColors[name]} fill={`url(#cGradNet_${name})`} strokeWidth={1.5} isAnimationActive={false} connectNulls />
                              ))}
                              {clusterRrdNodeNames.map(name => (
                                <Area key={`out_${name}`} type="monotone" dataKey={`netOut_${name}`} stroke={nodeColors[name]} fill="none" strokeWidth={1} strokeDasharray="4 2" isAnimationActive={false} connectNulls />
                              ))}
                            </AreaChart>
                          </ResponsiveContainer>
                        </ExpandableChart>

                        {/* Server Load */}
                        <ExpandableChart title={t('inventory.serverLoad')} height={185}>
                          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                            <AreaChart data={clusterRrdSeries} margin={{ top: 2, right: 4, bottom: 0, left: 4 }}>
                              <defs>
                                {clusterRrdNodeNames.map(name => (
                                  <linearGradient key={name} id={`cGradLoad_${name}`} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor={nodeColors[name]} stopOpacity={0.25} />
                                    <stop offset="100%" stopColor={nodeColors[name]} stopOpacity={0} />
                                  </linearGradient>
                                ))}
                              </defs>
                              <XAxis dataKey="t" tickFormatter={v => formatTime(Number(v))} minTickGap={40} tick={{ fontSize: 9 }} />
                              <YAxis tick={{ fontSize: 9 }} width={30} domain={[0, 'auto']} />
                              <Tooltip
                                wrapperStyle={{ zIndex: 10 }}
                                content={({ active, payload, label }) => {
                                  if (!active || !payload?.length) return null
                                  const sorted = [...payload].sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0))
                                  return (
                                    <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1, boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11 }}>
                                      <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', mb: 0.5 }}>{new Date(Number(label)).toLocaleString()}</Typography>
                                      {sorted.map(entry => (
                                        <Box key={String(entry.dataKey)} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, py: 0.1 }}>
                                          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                                          <Typography variant="caption" sx={{ flex: 1 }}>{String(entry.name).replaceAll('load_', '')}</Typography>
                                          <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>{Number(entry.value).toFixed(2)}</Typography>
                                        </Box>
                                      ))}
                                    </Box>
                                  )
                                }}
                              />
                              {clusterRrdNodeNames.map(name => (
                                <Area key={name} type="monotone" dataKey={`load_${name}`} stroke={nodeColors[name]} fill={`url(#cGradLoad_${name})`} strokeWidth={1.5} isAnimationActive={false} connectNulls />
                              ))}
                            </AreaChart>
                          </ResponsiveContainer>
                        </ExpandableChart>
                      </Box>
                    </>)}
                    {clusterNodeRrdLoading && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 2, opacity: 0.6 }}>
                        <CircularProgress size={16} />
                        <Typography variant="caption">{t('common.loading')}</Typography>
                      </Box>
                    )}
                  </Box>
                )}

                {/* Onglet Nodes - Index 1 */}
                {clusterTab === 1 && data.nodesData.length > 0 && (
                  <NodesTable
                    nodes={enrichedNodesData as NodeRow[]}
                    compact
                    maxHeight="auto"
                    onNodeClick={(node) => {
                      onSelect?.({ type: 'node', id: node.id })
                    }}
                    onBulkAction={handleNodeBulkAction}
                    showMigrateOption={data.nodesData.length > 1}
                  />
                )}

                {/* Onglet VMs - Liste complète avec collapse par node - Index 2 */}
                {clusterTab === 2 && (
                  <Box sx={{ p: 0 }}>
                    {data.nodesData && data.nodesData.length > 0 ? (
                      <Box>
                        {(data.nodesData as NodeRow[]).map((node) => {
                          const nodeVms = (data.allVms || []).filter((vm: any) => vm.node === node.name)
                          const isExpanded = expandedClusterNodes.has(node.name)
                          
                          return (
                            <Box key={node.id} sx={{ borderBottom: '1px solid', borderColor: 'divider', '&:last-child': { borderBottom: 'none' } }}>
                              {/* Header du node (cliquable pour expand/collapse) */}
                              <Box 
                                sx={{ 
                                  px: 2, 
                                  py: 1.5, 
                                  display: 'flex', 
                                  alignItems: 'center', 
                                  justifyContent: 'space-between',
                                  cursor: 'pointer',
                                  '&:hover': { bgcolor: 'action.hover' },
                                  bgcolor: isExpanded ? 'action.selected' : 'transparent'
                                }}
                                onClick={() => {
                                  setExpandedClusterNodes(prev => {
                                    const newSet = new Set(prev)
                                    if (newSet.has(node.name)) {
                                      newSet.delete(node.name)
                                    } else {
                                      newSet.add(node.name)
                                    }
                                    return newSet
                                  })
                                }}
                              >
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                  <i 
                                    className={isExpanded ? 'ri-subtract-line' : 'ri-add-line'} 
                                    style={{ fontSize: 18, opacity: 0.7 }} 
                                  />
                                  <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                    <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" style={{ width: 16, height: 16, opacity: 0.8 }} />
                                    <Box sx={{ position: 'absolute', bottom: -2, right: -2, width: 8, height: 8, borderRadius: '50%', bgcolor: node.status === 'online' ? 'success.main' : 'error.main', border: '1.5px solid', borderColor: 'background.paper' }} />
                                  </Box>
                                  <Typography fontWeight={600}>{node.name}</Typography>
                                  <Chip 
                                    size="small" 
                                    label={`${nodeVms.length} VMs`} 
                                    sx={{ height: 20, fontSize: 11 }} 
                                  />
                                </Box>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                  {[
                                    { label: 'CPU', value: node.cpu || 0 },
                                    { label: 'RAM', value: node.ram || 0 },
                                  ].map(({ label, value }) => (
                                    <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                      <Typography variant="caption" sx={{ opacity: 0.6, fontSize: 11 }}>{label}</Typography>
                                      <Box sx={{ position: 'relative', width: 60 }}>
                                        <LinearProgress
                                          variant="determinate"
                                          value={Math.min(value, 100)}
                                          sx={{
                                            height: 14, borderRadius: 0,
                                            bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.12)',
                                            '& .MuiLinearProgress-bar': {
                                              borderRadius: 0,
                                              background: 'linear-gradient(90deg, #22c55e 0%, #eab308 50%, #ef4444 100%)',
                                              backgroundSize: value > 0 ? `${(100 / value) * 100}% 100%` : '100% 100%',
                                            }
                                          }}
                                        />
                                        <Typography variant="caption" sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.55rem', fontWeight: 700, color: '#fff', lineHeight: 1, textShadow: '0 0 2px rgba(0,0,0,0.5)' }}>
                                          {value.toFixed(1)}%
                                        </Typography>
                                      </Box>
                                    </Box>
                                  ))}
                                </Box>
                              </Box>
                              
                              {/* Liste des VMs du node (collapsible) */}
                              {isExpanded && nodeVms.length > 0 && (
                                <Box sx={{
                                  bgcolor: 'background.default',
                                }}>
                                  <VmsTable
                                    vms={nodeVms as VmRow[]}
                                    compact
                                    showTrends
                                    maxHeight="auto"
                                    showActions={true}
                                    onLoadTrendsBatch={props.loadVmTrendsBatch}
                                    onVmClick={(vm) => {
                                      if (vm.template) return
                                      onSelect?.({ type: 'vm', id: vm.id })
                                    }}
                                    onVmAction={handleTableVmAction}
                                    onMigrate={handleTableMigrate}
                                    favorites={favorites}
                                    onToggleFavorite={toggleFavorite}
                                    migratingVmIds={migratingVmIds}
                                  />
                                </Box>
                              )}
                              
                              {isExpanded && nodeVms.length === 0 && (
                                <Box sx={{ px: 4, py: 2, bgcolor: 'background.default', opacity: 0.5 }}>
                                  <Typography variant="body2">{t('inventory.noVmsOnNode')}</Typography>
                                </Box>
                              )}
                            </Box>
                          )
                        })}
                      </Box>
                    ) : (
                      <Box sx={{ p: 4, textAlign: 'center', opacity: 0.5 }}>
                        <i className="ri-computer-line" style={{ fontSize: 48, marginBottom: 8 }} />
                        <Typography>{t('common.noData')}</Typography>
                      </Box>
                    )}
                  </Box>
                )}

                {/* Onglet HA - Index 3 */}
                {clusterTab === 3 && (
                  <Box sx={{ p: 2 }}>
                    {(clusterHaLoading || !clusterHaLoaded) ? (
                      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                        <CircularProgress size={24} />
                      </Box>
                    ) : (
                      <Stack spacing={3}>
                        {/* Auto-HA */}
                        {autoHaSettings && (
                          <Card variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
                            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: autoHaSettings.enabled ? 2 : 0 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                  <i className="ri-shield-star-line" style={{ fontSize: 20, opacity: 0.7 }} />
                                  <Typography variant="subtitle2" fontWeight={700}>Auto-HA</Typography>
                                  <Typography variant="caption" sx={{ opacity: 0.5 }}>
                                    {autoHaSettings.enabled ? t('cluster.autoHaEnabled') : t('cluster.autoHaDisabled')}
                                  </Typography>
                                </Box>
                                <Switch
                                  checked={autoHaSettings.enabled}
                                  onChange={(e) => saveAutoHaSettings({ ...autoHaSettings, enabled: e.target.checked })}
                                  disabled={autoHaSaving}
                                />
                              </Box>

                              {autoHaSettings.enabled && (
                                <Stack spacing={2}>
                                  <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                                    <FormControl size="small" sx={{ flex: 1 }}>
                                      <InputLabel>{t('cluster.autoHaDefaultState')}</InputLabel>
                                      <Select
                                        value={autoHaSettings.state || 'started'}
                                        label={t('cluster.autoHaDefaultState')}
                                        onChange={(e) => setAutoHaSettings((prev: any) => ({ ...prev, state: e.target.value }))}
                                      >
                                        <MenuItem value="started">Started</MenuItem>
                                        <MenuItem value="stopped">Stopped</MenuItem>
                                        <MenuItem value="enabled">Enabled</MenuItem>
                                        <MenuItem value="disabled">Disabled</MenuItem>
                                      </Select>
                                    </FormControl>

                                    {clusterPveMajorVersion < 9 && clusterHaGroups.length > 0 && (
                                      <FormControl size="small" sx={{ flex: 1 }}>
                                        <InputLabel>{t('common.group')}</InputLabel>
                                        <Select
                                          value={autoHaSettings.group || ''}
                                          label={t('common.group')}
                                          onChange={(e) => setAutoHaSettings((prev: any) => ({ ...prev, group: e.target.value }))}
                                        >
                                          <MenuItem value=""><em>{t('common.none')}</em></MenuItem>
                                          {clusterHaGroups.map((g: any) => (
                                            <MenuItem key={g.group} value={g.group}>{g.group}</MenuItem>
                                          ))}
                                        </Select>
                                      </FormControl>
                                    )}

                                    <TextField
                                      size="small"
                                      type="number"
                                      label="Max Restart"
                                      value={autoHaSettings.max_restart ?? 1}
                                      onChange={(e) => setAutoHaSettings((prev: any) => ({ ...prev, max_restart: parseInt(e.target.value) || 0 }))}
                                      inputProps={{ min: 0, max: 10 }}
                                      sx={{ flex: 1 }}
                                    />
                                    <TextField
                                      size="small"
                                      type="number"
                                      label="Max Relocate"
                                      value={autoHaSettings.max_relocate ?? 1}
                                      onChange={(e) => setAutoHaSettings((prev: any) => ({ ...prev, max_relocate: parseInt(e.target.value) || 0 }))}
                                      inputProps={{ min: 0, max: 10 }}
                                      sx={{ flex: 1 }}
                                    />
                                    <Button
                                      size="small"
                                      variant="outlined"
                                      onClick={() => saveAutoHaSettings(autoHaSettings)}
                                      disabled={autoHaSaving}
                                      startIcon={autoHaSaving ? <CircularProgress size={14} /> : <i className="ri-save-line" />}
                                    >
                                      {t('common.save')}
                                    </Button>
                                    <Button
                                      size="small"
                                      variant="contained"
                                      onClick={syncAutoHa}
                                      disabled={autoHaSyncing}
                                      startIcon={autoHaSyncing ? <CircularProgress size={14} /> : <i className="ri-refresh-line" />}
                                    >
                                      {t('cluster.autoHaSyncNow')}
                                    </Button>
                                  </Box>
                                  {autoHaSyncResult && !autoHaSyncResult.error && (
                                    <Alert severity="success" sx={{ py: 0.5 }}>
                                      {t('cluster.autoHaSyncSuccess', { added: autoHaSyncResult.added, skipped: autoHaSyncResult.skipped })}
                                      {autoHaSyncResult.errors?.length > 0 && ` (${autoHaSyncResult.errors.length} errors)`}
                                    </Alert>
                                  )}
                                  {autoHaSyncResult?.error && (
                                    <Alert severity="error" sx={{ py: 0.5 }}>{autoHaSyncResult.error}</Alert>
                                  )}
                                </Stack>
                              )}
                            </CardContent>
                          </Card>
                        )}

                        {/* Section Ressources HA */}
                        <Box>
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                            <Typography variant="subtitle1" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <i className="ri-stack-line" style={{ fontSize: 18, opacity: 0.7 }} />
                              {t('cluster.haResources')} ({clusterHaResources.length})
                            </Typography>
                            <Button
                              size="small"
                              variant="contained"
                              startIcon={<AddIcon />}
                              onClick={() => setAddHaDialogOpen(true)}
                            >
                              {t('common.add')}
                            </Button>
                          </Box>
                          
                          {clusterHaResources.length === 0 ? (
                            <Alert severity="info" sx={{ py: 1 }}>
                              {t('common.noData')}
                            </Alert>
                          ) : (
                            <Box sx={{ 
                              border: '1px solid', 
                              borderColor: 'divider', 
                              borderRadius: 1,
                              overflow: 'hidden'
                            }}>
                              {/* Header */}
                              <Box sx={{
                                display: 'grid',
                                gridTemplateColumns: clusterPveMajorVersion >= 9
                                  ? '1fr 100px 150px 100px 100px 200px'
                                  : '1fr 100px 150px 100px 100px 1fr 200px',
                                gap: 1,
                                px: 1.5,
                                py: 1,
                                bgcolor: 'action.hover',
                                borderBottom: '1px solid',
                                borderColor: 'divider',
                                '& > *': { fontWeight: 600, fontSize: 12, opacity: 0.8 }
                              }}>
                                <Typography variant="caption">{t('inventory.name')}</Typography>
                                <Typography variant="caption">{t('cluster.state')}</Typography>
                                <Typography variant="caption">{t('cluster.nodeCol')}</Typography>
                                <Typography variant="caption">{t('cluster.maxRestart')}</Typography>
                                <Typography variant="caption">{t('cluster.maxRelocate')}</Typography>
                                {clusterPveMajorVersion < 9 && <Typography variant="caption">{t('cluster.group')}</Typography>}
                                <Typography variant="caption">{t('common.description')}</Typography>
                              </Box>
                              {/* Rows */}
                              {clusterHaResources.map((res: any) => (
                                <Box 
                                  key={res.sid}
                                  sx={{ 
                                    display: 'grid',
                                    gridTemplateColumns: clusterPveMajorVersion >= 9
                                      ? '1fr 100px 150px 100px 100px 200px'
                                      : '1fr 100px 150px 100px 100px 1fr 200px',
                                    gap: 1,
                                    px: 1.5,
                                    py: 0.75,
                                    borderBottom: '1px solid',
                                    borderColor: 'divider',
                                    '&:last-child': { borderBottom: 'none' },
                                    '&:hover': { bgcolor: 'action.hover' }
                                  }}
                                >
                                  {(() => {
                                    const sidParts = String(res.sid).split(':')
                                    const vmType = sidParts[0] === 'ct' ? 'lxc' : 'qemu'
                                    const vmid = sidParts[1]
                                    const vm = (allVms || []).find((v: any) => String(v.vmid) === vmid)
                                    const vmStatus = vm?.status || 'unknown'
                                    const iconClass = vm?.template ? 'ri-file-copy-fill' : vmType === 'lxc' ? 'ri-instance-fill' : 'ri-computer-fill'
                                    const dotColor = vm?.template ? 'transparent' : vmStatus === 'running' ? '#4caf50' : vmStatus === 'paused' ? '#ed6c02' : '#f44336'

                                    return (
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, overflow: 'hidden' }}>
                                        <Box sx={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
                                          <i className={iconClass} style={{ fontSize: 16, opacity: 0.7 }} />
                                          {!vm?.template && (
                                            <Box sx={{
                                              position: 'absolute', bottom: -1, right: -2,
                                              width: 7, height: 7, borderRadius: '50%',
                                              bgcolor: dotColor,
                                              border: '1.5px solid', borderColor: 'background.paper',
                                              boxShadow: vmStatus === 'running' ? `0 0 4px ${dotColor}` : 'none',
                                            }} />
                                          )}
                                        </Box>
                                        <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                          {vm?.name || res.sid}
                                        </Typography>
                                      </Box>
                                    )
                                  })()}
                                  <HaResourceStateCell
                                    sid={res.sid}
                                    state={res.state || 'started'}
                                    group={res.group}
                                    connId={connId}
                                    t={t}
                                  />
                                  <Typography variant="body2" sx={{ opacity: 0.8 }}>
                                    {res.node || '-'}
                                  </Typography>
                                  <Typography variant="body2" sx={{ textAlign: 'center' }}>
                                    {res.max_restart ?? 1}
                                  </Typography>
                                  <Typography variant="body2" sx={{ textAlign: 'center' }}>
                                    {res.max_relocate ?? 1}
                                  </Typography>
                                  {clusterPveMajorVersion < 9 && (
                                    <Typography variant="body2" sx={{ color: 'info.main' }}>
                                      {res.group || '-'}
                                    </Typography>
                                  )}
                                  <Typography variant="body2" sx={{ opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {res.comment || '-'}
                                  </Typography>
                                </Box>
                              ))}
                            </Box>
                          )}
                        </Box>

                        {/* PVE 8: Section Groupes HA */}
                        {clusterPveMajorVersion < 9 && (
                          <Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                              <Typography variant="subtitle1" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <i className="ri-group-line" style={{ fontSize: 18, opacity: 0.7 }} />
                                {t('cluster.groups')} ({clusterHaGroups.length})
                              </Typography>
                              <Button
                                size="small"
                                variant="contained"
                                startIcon={<AddIcon />}
                                onClick={() => {
                                  setEditingHaGroup(null)
                                  setHaGroupDialogOpen(true)
                                }}
                              >
                                {t('common.create')}
                              </Button>
                            </Box>
                            
                            {clusterHaGroups.length === 0 ? (
                              <Alert severity="info" sx={{ py: 1 }}>
                                {t('common.noData')}
                              </Alert>
                            ) : (
                              <Box sx={{ 
                                border: '1px solid', 
                                borderColor: 'divider', 
                                borderRadius: 1,
                                overflow: 'hidden'
                              }}>
                                {/* Header */}
                                <Box sx={{ 
                                  display: 'grid', 
                                  gridTemplateColumns: '150px 80px 80px 1fr 200px 80px',
                                  gap: 1,
                                  px: 1.5,
                                  py: 1,
                                  bgcolor: 'action.hover',
                                  borderBottom: '1px solid',
                                  borderColor: 'divider',
                                  '& > *': { fontWeight: 600, fontSize: 12, opacity: 0.8 }
                                }}>
                                  <Typography variant="caption">{t('cluster.group')}</Typography>
                                  <Typography variant="caption">{t('cluster.restricted')}</Typography>
                                  <Typography variant="caption">{t('cluster.nofailback')}</Typography>
                                  <Typography variant="caption">{t('inventory.nodesLabel')}</Typography>
                                  <Typography variant="caption">{t('inventory.commentHeader')}</Typography>
                                  <Typography variant="caption" sx={{ textAlign: 'center' }}>{t('common.actions')}</Typography>
                                </Box>
                                {/* Rows */}
                                {clusterHaGroups.map((group: any) => (
                                  <Box 
                                    key={group.group}
                                    sx={{ 
                                      display: 'grid', 
                                      gridTemplateColumns: '150px 80px 80px 1fr 200px 80px',
                                      gap: 1,
                                      px: 1.5,
                                      py: 0.75,
                                      borderBottom: '1px solid',
                                      borderColor: 'divider',
                                      '&:last-child': { borderBottom: 'none' },
                                      '&:hover': { bgcolor: 'action.hover' }
                                    }}
                                  >
                                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                      {group.group}
                                    </Typography>
                                    <Typography variant="body2">
                                      {group.restricted ? t('common.yes') : t('common.no')}
                                    </Typography>
                                    <Typography variant="body2">
                                      {group.nofailback ? t('common.yes') : t('common.no')}
                                    </Typography>
                                    <Typography variant="body2" sx={{ opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {group.nodes || '-'}
                                    </Typography>
                                    <Typography variant="body2" sx={{ opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {group.comment || '-'}
                                    </Typography>
                                    <Box sx={{ display: 'flex', justifyContent: 'center', gap: 0.5 }}>
                                      <MuiTooltip title={t('common.edit')}>
                                        <IconButton 
                                          size="small" 
                                          onClick={() => {
                                            setEditingHaGroup(group)
                                            setHaGroupDialogOpen(true)
                                          }}
                                        >
                                          <i className="ri-edit-line" style={{ fontSize: 16 }} />
                                        </IconButton>
                                      </MuiTooltip>
                                      <MuiTooltip title={t('common.delete')}>
                                        <IconButton 
                                          size="small" 
                                          color="error"
                                          onClick={() => setDeleteHaGroupDialog(group)}
                                        >
                                          <i className="ri-delete-bin-line" style={{ fontSize: 16 }} />
                                        </IconButton>
                                      </MuiTooltip>
                                    </Box>
                                  </Box>
                                ))}
                              </Box>
                            )}
                          </Box>
                        )}

                        {/* PVE 9+: Section Affinity Rules */}
                        {clusterPveMajorVersion >= 9 && (
                          <>
                            {/* Node Affinity Rules */}
                            <Box>
                              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                                <Typography variant="subtitle1" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <i className="ri-node-tree" style={{ fontSize: 18, opacity: 0.7 }} />
                                  {t('cluster.nodeAffinityRules')} ({clusterHaRules.filter((r: any) => r.type === 'node-affinity').length})
                                </Typography>
                                <Button
                                  size="small"
                                  variant="contained"
                                  startIcon={<AddIcon />}
                                  onClick={() => {
                                    setHaRuleType('node-affinity')
                                    setEditingHaRule(null)
                                    setHaRuleDialogOpen(true)
                                  }}
                                >
                                  {t('common.add')}
                                </Button>
                              </Box>
                              
                              {clusterHaRules.filter((r: any) => r.type === 'node-affinity').length === 0 ? (
                                <Alert severity="info" sx={{ py: 1 }}>
                                  {t('common.noData')}
                                </Alert>
                              ) : (
                                <Box sx={{ 
                                  border: '1px solid', 
                                  borderColor: 'divider', 
                                  borderRadius: 1,
                                  overflow: 'hidden'
                                }}>
                                  {/* Header */}
                                  <Box sx={{ 
                                    display: 'grid', 
                                    gridTemplateColumns: '60px 80px 80px 1fr 1fr 80px',
                                    gap: 1,
                                    px: 1.5,
                                    py: 1,
                                    bgcolor: 'action.hover',
                                    borderBottom: '1px solid',
                                    borderColor: 'divider',
                                    '& > *': { fontWeight: 600, fontSize: 12, opacity: 0.8 }
                                  }}>
                                    <Typography variant="caption">{t('common.enabled')}</Typography>
                                    <Typography variant="caption">{t('cluster.state')}</Typography>
                                    <Typography variant="caption">{t('cluster.strict')}</Typography>
                                    <Typography variant="caption">{t('cluster.haResourcesCol')}</Typography>
                                    <Typography variant="caption">{t('inventory.nodesLabel')}</Typography>
                                    <Typography variant="caption" sx={{ textAlign: 'center' }}>{t('common.actions')}</Typography>
                                  </Box>
                                  {/* Rows */}
                                  {clusterHaRules.filter((r: any) => r.type === 'node-affinity').map((rule: any) => (
                                    <Box 
                                      key={rule.rule}
                                      sx={{ 
                                        display: 'grid', 
                                        gridTemplateColumns: '60px 80px 80px 1fr 1fr 80px',
                                        gap: 1,
                                        px: 1.5,
                                        py: 0.75,
                                        borderBottom: '1px solid',
                                        borderColor: 'divider',
                                        '&:last-child': { borderBottom: 'none' },
                                        '&:hover': { bgcolor: 'action.hover' }
                                      }}
                                    >
                                      <Box>
                                        <Chip 
                                          size="small" 
                                          label={rule.disable ? t('common.no') : t('common.yes')}
                                          color={rule.disable ? 'default' : 'success'}
                                          sx={{ height: 20, fontSize: 11 }}
                                        />
                                      </Box>
                                      <Typography variant="body2" sx={{ opacity: 0.8 }}>
                                        {rule.disable ? t('common.disabled') : t('common.enabled')}
                                      </Typography>
                                      <Typography variant="body2">
                                        {rule.strict ? t('common.yes') : t('common.no')}
                                      </Typography>
                                      <Typography variant="body2" sx={{ opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {rule.resources || '-'}
                                      </Typography>
                                      <Typography variant="body2" sx={{ opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {rule.nodes || '-'}
                                      </Typography>
                                      <Box sx={{ display: 'flex', justifyContent: 'center', gap: 0.5 }}>
                                        <MuiTooltip title={t('common.edit')}>
                                          <IconButton
                                            size="small"
                                            onClick={() => {
                                              setHaRuleType('node-affinity')
                                              setEditingHaRule(rule)
                                              setHaRuleDialogOpen(true)
                                            }}
                                          >
                                            <i className="ri-edit-line" style={{ fontSize: 16 }} />
                                          </IconButton>
                                        </MuiTooltip>
                                        <MuiTooltip title={t('common.delete')}>
                                          <IconButton 
                                            size="small" 
                                            color="error"
                                            onClick={() => setDeleteHaRuleDialog(rule)}
                                          >
                                            <i className="ri-delete-bin-line" style={{ fontSize: 16 }} />
                                          </IconButton>
                                        </MuiTooltip>
                                      </Box>
                                    </Box>
                                  ))}
                                </Box>
                              )}
                            </Box>

                            {/* Resource Affinity Rules */}
                            <Box>
                              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                                <Typography variant="subtitle1" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <i className="ri-links-line" style={{ fontSize: 18, opacity: 0.7 }} />
                                  {t('cluster.resourceAffinityRules')} ({clusterHaRules.filter((r: any) => r.type === 'resource-affinity').length})
                                </Typography>
                                <Button
                                  size="small"
                                  variant="contained"
                                  startIcon={<AddIcon />}
                                  onClick={() => {
                                    setHaRuleType('resource-affinity')
                                    setEditingHaRule(null)
                                    setHaRuleDialogOpen(true)
                                  }}
                                >
                                  {t('common.add')}
                                </Button>
                              </Box>
                              
                              {clusterHaRules.filter((r: any) => r.type === 'resource-affinity').length === 0 ? (
                                <Alert severity="info" sx={{ py: 1 }}>
                                  {t('common.noData')}
                                </Alert>
                              ) : (
                                <Box sx={{ 
                                  border: '1px solid', 
                                  borderColor: 'divider', 
                                  borderRadius: 1,
                                  overflow: 'hidden'
                                }}>
                                  {/* Header */}
                                  <Box sx={{ 
                                    display: 'grid', 
                                    gridTemplateColumns: '60px 80px 120px 1fr 80px',
                                    gap: 1,
                                    px: 1.5,
                                    py: 1,
                                    bgcolor: 'action.hover',
                                    borderBottom: '1px solid',
                                    borderColor: 'divider',
                                    '& > *': { fontWeight: 600, fontSize: 12, opacity: 0.8 }
                                  }}>
                                    <Typography variant="caption">{t('common.enabled')}</Typography>
                                    <Typography variant="caption">{t('cluster.state')}</Typography>
                                    <Typography variant="caption">{t('cluster.affinity')}</Typography>
                                    <Typography variant="caption">{t('cluster.haResourcesCol')}</Typography>
                                    <Typography variant="caption" sx={{ textAlign: 'center' }}>{t('common.actions')}</Typography>
                                  </Box>
                                  {/* Rows */}
                                  {clusterHaRules.filter((r: any) => r.type === 'resource-affinity').map((rule: any) => (
                                    <Box 
                                      key={rule.rule}
                                      sx={{ 
                                        display: 'grid', 
                                        gridTemplateColumns: '60px 80px 120px 1fr 80px',
                                        gap: 1,
                                        px: 1.5,
                                        py: 0.75,
                                        borderBottom: '1px solid',
                                        borderColor: 'divider',
                                        '&:last-child': { borderBottom: 'none' },
                                        '&:hover': { bgcolor: 'action.hover' }
                                      }}
                                    >
                                      <Box>
                                        <Chip 
                                          size="small" 
                                          label={rule.disable ? t('common.no') : t('common.yes')}
                                          color={rule.disable ? 'default' : 'success'}
                                          sx={{ height: 20, fontSize: 11 }}
                                        />
                                      </Box>
                                      <Typography variant="body2" sx={{ opacity: 0.8 }}>
                                        {rule.disable ? t('common.disabled') : t('common.enabled')}
                                      </Typography>
                                      <Chip
                                        size="small"
                                        label={rule.affinity === 'positive' ? t('cluster.keepTogether') : t('cluster.keepSeparate')}
                                        color={rule.affinity === 'positive' ? 'info' : 'warning'}
                                        sx={{ height: 20, fontSize: 10 }} 
                                      />
                                      <Typography variant="body2" sx={{ opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {rule.resources || '-'}
                                      </Typography>
                                      <Box sx={{ display: 'flex', justifyContent: 'center', gap: 0.5 }}>
                                        <MuiTooltip title={t('common.edit')}>
                                          <IconButton 
                                            size="small" 
                                            onClick={() => {
                                              setHaRuleType('resource-affinity')
                                              setEditingHaRule(rule)
                                              setHaRuleDialogOpen(true)
                                            }}
                                          >
                                            <i className="ri-edit-line" style={{ fontSize: 16 }} />
                                          </IconButton>
                                        </MuiTooltip>
                                        <MuiTooltip title={t('common.delete')}>
                                          <IconButton 
                                            size="small" 
                                            color="error"
                                            onClick={() => setDeleteHaRuleDialog(rule)}
                                          >
                                            <i className="ri-delete-bin-line" style={{ fontSize: 16 }} />
                                          </IconButton>
                                        </MuiTooltip>
                                      </Box>
                                    </Box>
                                  ))}
                                </Box>
                              )}
                            </Box>
                          </>
                        )}
                      </Stack>
                    )}
                  </Box>
                )}

                {/* Onglet Backups - Index 4 */}
                {clusterTab === 4 && (
                  <BackupJobsPanel connectionId={selection?.id?.split(':')[0] || ''} />
                )}

                {/* Onglet Snapshots - Index 5 */}
                {clusterTab === 5 && (
                  <Box sx={{ overflow: 'auto' }}>
                    <SnapshotsTab connectionId={selection?.id?.split(':')[0] || ''} />
                  </Box>
                )}

                {/* Onglet Notes - Index 6 */}
                {clusterTab === 6 && (
                  <Box sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                      <Typography variant="subtitle1" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <i className="ri-file-text-line" style={{ fontSize: 20 }} />
                        {t('cluster.datacenterNotes')}
                      </Typography>
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<i className="ri-edit-line" />}
                        onClick={() => setClusterNotesEditMode(!clusterNotesEditMode)}
                      >
                        {clusterNotesEditMode ? t('common.cancel') : t('common.edit')}
                      </Button>
                    </Box>
                    
                    {clusterNotesLoading ? (
                      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                        <CircularProgress size={24} />
                      </Box>
                    ) : clusterNotesEditMode ? (
                      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <TextField
                          multiline
                          fullWidth
                          minRows={10}
                          value={clusterNotesContent}
                          onChange={(e) => setClusterNotesContent(e.target.value)}
                          placeholder={t('cluster.enterNotesPlaceholder')}
                          sx={{ flex: 1, fontFamily: 'monospace' }}
                        />
                        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                          <Button
                            variant="contained"
                            startIcon={<i className="ri-save-line" />}
                            onClick={handleSaveClusterNotes}
                            disabled={clusterNotesSaving}
                          >
                            {clusterNotesSaving ? t('common.saving') : t('common.save')}
                          </Button>
                        </Box>
                      </Box>
                    ) : (
                      <Box 
                        sx={{ 
                          flex: 1, 
                          p: 2, 
                          bgcolor: 'background.paper', 
                          border: '1px solid', 
                          borderColor: 'divider',
                          borderRadius: 1,
                          overflow: 'auto'
                        }}
                      >
                        {clusterNotesContent ? (
                          <Box 
                            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(parseMarkdown(clusterNotesContent)) }}
                            sx={markdownSx}
                          />
                        ) : (
                          <Box sx={{ textAlign: 'center', py: 4, opacity: 0.5 }}>
                            <i className="ri-file-text-line" style={{ fontSize: 48 }} />
                            <Typography sx={{ mt: 1 }}>{t('cluster.noNotes')}</Typography>
                          </Box>
                        )}
                      </Box>
                    )}
                  </Box>
                )}

                {/* Onglet Ceph - Index 7 */}
                {clusterTab === 7 && (
                  <Box sx={{ p: 2, overflow: 'auto', flex: 1, minHeight: 0 }}>
                    {clusterCephLoading ? (
                      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                        <CircularProgress size={24} />
                      </Box>
                    ) : clusterCephData ? (
                      <Stack spacing={3}>
                        {/* Health & Status */}
                        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
                          {/* Health Card - avec Summary comme Proxmox */}
                          <Card variant="outlined">
                            <CardContent>
                              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>{t('inventory.healthLabel')}</Typography>
                              <Box sx={{ display: 'flex', gap: 3 }}>
                                {/* Status avec icône */}
                                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 100 }}>
                                  <Typography variant="caption" fontWeight={600} sx={{ mb: 1 }}>{t('inventory.statusLabel')}</Typography>
                                  <Box sx={{ 
                                    width: 56, 
                                    height: 56, 
                                    borderRadius: '50%', 
                                    bgcolor: clusterCephData.health?.status === 'HEALTH_OK' ? 'success.main' :
                                             clusterCephData.health?.status === 'HEALTH_WARN' ? 'warning.dark' : 'error.main',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    mb: 1
                                  }}>
                                    <i className={clusterCephData.health?.status === 'HEALTH_OK' ? 'ri-checkbox-circle-fill' : clusterCephData.health?.status === 'HEALTH_WARN' ? 'ri-alert-fill' : 'ri-close-circle-fill'} style={{ fontSize: 28, color: 'white' }} />
                                  </Box>
                                  <Typography variant="body2" fontWeight={700}>
                                    {clusterCephData.health?.status || t('common.unknown')}
                                  </Typography>
                                </Box>
                                
                                {/* Summary - Warnings/Errors */}
                                <Box sx={{ flex: 1, borderLeft: '1px solid', borderColor: 'divider', pl: 2 }}>
                                  <Typography variant="caption" fontWeight={600} sx={{ mb: 1, display: 'block' }}>{t('inventory.tabSummary')}</Typography>
                                  {clusterCephData._normalized?.healthChecks?.length > 0 ? (
                                    <Box sx={{ maxHeight: 120, overflow: 'auto' }}>
                                      {clusterCephData._normalized.healthChecks.map((check: any, idx: number) => (
                                        <Box key={idx} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 0.5 }}>
                                          <i 
                                            className={check.severity === 'HEALTH_ERR' ? 'ri-close-circle-fill' : 'ri-alert-fill'} 
                                            style={{ 
                                              fontSize: 14, 
                                              color: check.severity === 'HEALTH_ERR' ? '#f44336' : '#ff9800',
                                              marginTop: 2
                                            }} 
                                          />
                                          <Typography variant="caption" sx={{ lineHeight: 1.3 }}>
                                            {check.summary}
                                          </Typography>
                                        </Box>
                                      ))}
                                    </Box>
                                  ) : (
                                    <Typography variant="body2" sx={{ opacity: 0.7 }}>
                                      {t('cluster.noWarningsErrors')}
                                    </Typography>
                                  )}
                                </Box>
                              </Box>
                              
                              {/* Ceph Version en bas */}
                              {clusterCephData.version && (
                                <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
                                  <Typography variant="caption" sx={{ opacity: 0.7 }}>{t('cluster.cephVersion')}</Typography>
                                  <Typography variant="body2" fontWeight={600}>{clusterCephData.version}</Typography>
                                </Box>
                              )}
                            </CardContent>
                          </Card>

                          {/* Status Card - OSDs & PGs */}
                          <Card variant="outlined">
                            <CardContent>
                              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>{t('common.status')}</Typography>
                              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                                <Box>
                                  <Typography variant="caption" sx={{ opacity: 0.7 }}>OSDs</Typography>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Chip size="small" label={`${clusterCephData._normalized?.osd?.num_up_osds || clusterCephData.osdmap?.osdmap?.num_up_osds || 0} Up`} color="success" sx={{ height: 20 }} />
                                    <Chip size="small" label={`${clusterCephData._normalized?.osd?.num_in_osds || clusterCephData.osdmap?.osdmap?.num_in_osds || 0} In`} sx={{ height: 20 }} />
                                  </Box>
                                  <Typography variant="caption" sx={{ display: 'block', mt: 0.5, opacity: 0.6 }}>
                                    Total: {clusterCephData._normalized?.osd?.num_osds || clusterCephData.osdmap?.osdmap?.num_osds || 0}
                                  </Typography>
                                </Box>
                                <Box>
                                  <Typography variant="caption" sx={{ opacity: 0.7 }}>PGs</Typography>
                                  <Typography variant="body2" fontWeight={600}>
                                    {clusterCephData.pgmap?.num_pgs || 0}
                                  </Typography>
                                  {clusterCephData.pgmap?.pgs_by_state && (
                                    <Typography variant="caption" sx={{ opacity: 0.6 }}>
                                      {clusterCephData.pgmap.pgs_by_state.map((s: any) => s.state_name).join(', ')}
                                    </Typography>
                                  )}
                                </Box>
                              </Box>
                            </CardContent>
                          </Card>
                        </Box>

                        {/* Services */}
                        <Card variant="outlined">
                          <CardContent>
                            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>{t('cluster.services')}</Typography>
                            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' }, gap: 2 }}>
                              <Box>
                                <Typography variant="caption" sx={{ opacity: 0.7 }}>{t('cluster.monitors')}</Typography>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                                  {clusterCephData.monmap?.mons?.map((mon: any) => (
                                    <MuiTooltip 
                                      key={mon.name} 
                                      title={
                                        <Box sx={{ p: 0.5 }}>
                                          <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>{t('cluster.monitor')}: {mon.name}</Typography>
                                          {mon.addr && <Typography variant="caption" sx={{ display: 'block' }}>{t('cluster.address')}: {mon.addr}</Typography>}
                                          {mon.public_addr && <Typography variant="caption" sx={{ display: 'block' }}>{t('cluster.publicAddr')}: {mon.public_addr}</Typography>}
                                          <Typography variant="caption" sx={{ display: 'block', color: '#4caf50' }}>{t('common.status')}: running</Typography>
                                        </Box>
                                      }
                                      arrow
                                    >
                                      <Chip size="small" label={mon.name} icon={<i className="ri-checkbox-circle-fill" style={{ color: '#4caf50' }} />} sx={{ height: 24, cursor: 'pointer' }} />
                                    </MuiTooltip>
                                  )) || <Typography variant="body2">—</Typography>}
                                </Box>
                              </Box>
                              <Box>
                                <Typography variant="caption" sx={{ opacity: 0.7 }}>{t('cluster.managers')}</Typography>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                                  {clusterCephData.mgrmap?.active_name && (
                                    <MuiTooltip 
                                      title={
                                        <Box sx={{ p: 0.5 }}>
                                          <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>{t('cluster.manager')}: {clusterCephData.mgrmap.active_name}</Typography>
                                          {clusterCephData.mgrmap.active_addr && <Typography variant="caption" sx={{ display: 'block' }}>{t('cluster.address')}: {clusterCephData.mgrmap.active_addr}</Typography>}
                                          <Typography variant="caption" sx={{ display: 'block', color: '#4caf50' }}>{t('common.status')}: {t('common.active').toLowerCase()}</Typography>
                                        </Box>
                                      }
                                      arrow
                                    >
                                      <Chip size="small" label={clusterCephData.mgrmap.active_name} icon={<i className="ri-checkbox-circle-fill" style={{ color: '#4caf50' }} />} sx={{ height: 24, cursor: 'pointer' }} />
                                    </MuiTooltip>
                                  )}
                                  {clusterCephData.mgrmap?.standbys?.map((mgr: any) => (
                                    <MuiTooltip 
                                      key={mgr.name}
                                      title={
                                        <Box sx={{ p: 0.5 }}>
                                          <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>{t('cluster.manager')}: {mgr.name}</Typography>
                                          {mgr.addr && <Typography variant="caption" sx={{ display: 'block' }}>{t('cluster.address')}: {mgr.addr}</Typography>}
                                          <Typography variant="caption" sx={{ display: 'block', color: '#ff9800' }}>{t('common.status')}: standby</Typography>
                                        </Box>
                                      }
                                      arrow
                                    >
                                      <Chip size="small" label={mgr.name} icon={<i className="ri-checkbox-circle-fill" style={{ color: '#4caf50' }} />} sx={{ height: 24, cursor: 'pointer' }} />
                                    </MuiTooltip>
                                  ))}
                                </Box>
                              </Box>
                              <Box>
                                <Typography variant="caption" sx={{ opacity: 0.7 }}>{t('cluster.metadataServers')}</Typography>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                                  {(clusterCephData._normalized?.mds?.length > 0 
                                    ? clusterCephData._normalized.mds 
                                    : clusterCephData.fsmap?.by_rank
                                  )?.map((mds: any) => (
                                    <MuiTooltip 
                                      key={mds.name}
                                      title={
                                        <Box sx={{ p: 0.5 }}>
                                          <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>MDS: {mds.name}</Typography>
                                          {mds.addr && <Typography variant="caption" sx={{ display: 'block' }}>{t('cluster.address')}: {mds.addr}</Typography>}
                                          {mds.host && <Typography variant="caption" sx={{ display: 'block' }}>{t('cluster.host')}: {mds.host}</Typography>}
                                          {mds.rank !== undefined && <Typography variant="caption" sx={{ display: 'block' }}>{t('cluster.rank')}: {mds.rank}</Typography>}
                                          <Typography variant="caption" sx={{ display: 'block', color: mds.state === 'standby' ? '#ff9800' : '#4caf50' }}>
                                            {t('common.status')}: {mds.state || t('common.active').toLowerCase()}
                                          </Typography>
                                        </Box>
                                      }
                                      arrow
                                    >
                                      <Chip size="small" label={mds.name} icon={<i className="ri-checkbox-circle-fill" style={{ color: '#4caf50' }} />} sx={{ height: 24, cursor: 'pointer' }} />
                                    </MuiTooltip>
                                  )) || <Typography variant="body2">—</Typography>}
                                </Box>
                              </Box>
                            </Box>
                          </CardContent>
                        </Card>

                        {/* Performance & Usage */}
                        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
                          {/* Usage */}
                          <Card variant="outlined">
                            <CardContent>
                              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>{t('cluster.usage')}</Typography>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                <Box sx={{ position: 'relative', width: 100, height: 100 }}>
                                  <CircularProgress
                                    variant="determinate"
                                    value={100}
                                    size={100}
                                    thickness={8}
                                    sx={{ color: 'divider', position: 'absolute' }}
                                  />
                                  <CircularProgress
                                    variant="determinate"
                                    value={clusterCephData.pgmap?.bytes_used && clusterCephData.pgmap?.bytes_total 
                                      ? (clusterCephData.pgmap.bytes_used / clusterCephData.pgmap.bytes_total) * 100 
                                      : 0}
                                    size={100}
                                    thickness={8}
                                    sx={{ color: 'success.main', position: 'absolute' }}
                                  />
                                  <Box sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
                                    <Typography variant="h6" fontWeight={700}>
                                      {clusterCephData.pgmap?.bytes_used && clusterCephData.pgmap?.bytes_total 
                                        ? Math.round((clusterCephData.pgmap.bytes_used / clusterCephData.pgmap.bytes_total) * 100) 
                                        : 0}%
                                    </Typography>
                                  </Box>
                                </Box>
                                <Box>
                                  <Typography variant="caption" sx={{ opacity: 0.7 }}>{t('common.used')}</Typography>
                                  <Typography variant="body2" fontWeight={600}>
                                    {clusterCephData.pgmap?.bytes_used ? formatBytes(clusterCephData.pgmap.bytes_used) : '—'}
                                  </Typography>
                                  <Typography variant="caption" sx={{ opacity: 0.7, display: 'block', mt: 1 }}>{t('common.total')}</Typography>
                                  <Typography variant="body2" fontWeight={600}>
                                    {clusterCephData.pgmap?.bytes_total ? formatBytes(clusterCephData.pgmap.bytes_total) : '—'}
                                  </Typography>
                                  <Typography variant="caption" sx={{ opacity: 0.7, display: 'block', mt: 1 }}>{t('dashboard.widgets.provisioned')}</Typography>
                                  <Typography variant="body2" fontWeight={600} sx={{ color: (() => {
                                    const provBytes = (allVms || []).reduce((sum: number, vm: any) => sum + (Number(vm.maxdisk) || 0), 0)
                                    const totalBytes = clusterCephData.pgmap?.bytes_total || 0
                                    return totalBytes > 0 && provBytes > totalBytes ? 'warning.main' : 'text.primary'
                                  })() }}>
                                    {(() => {
                                      const provBytes = (allVms || []).reduce((sum: number, vm: any) => sum + (Number(vm.maxdisk) || 0), 0)
                                      const totalBytes = clusterCephData.pgmap?.bytes_total || 0
                                      const pct = totalBytes > 0 ? Math.round((provBytes / totalBytes) * 100) : 0
                                      return `${formatBytes(provBytes)} (${pct}%)`
                                    })()}
                                  </Typography>
                                </Box>
                              </Box>
                            </CardContent>
                          </Card>

                          {/* Performance - Données en temps réel */}
                          <Card variant="outlined">
                            <CardContent>
                              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>
                                {t('cluster.performance')}
                                <Typography component="span" variant="caption" sx={{ ml: 1, opacity: 0.6 }}>
                                  ({t('cluster.live')})
                                </Typography>
                              </Typography>
                              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                                <Box>
                                  <Typography variant="caption" sx={{ opacity: 0.7 }}>{t('cluster.reads')}:</Typography>
                                  <Typography variant="body1" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    {clusterCephPerf?.read_bytes_sec ? formatBps(clusterCephPerf.read_bytes_sec) : '0 B/s'}
                                    <TrendIcon trend={cephTrends.read_bytes} />
                                  </Typography>
                                </Box>
                                <Box>
                                  <Typography variant="caption" sx={{ opacity: 0.7 }}>{t('cluster.writes')}:</Typography>
                                  <Typography variant="body1" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    {clusterCephPerf?.write_bytes_sec ? formatBps(clusterCephPerf.write_bytes_sec) : '0 B/s'}
                                    <TrendIcon trend={cephTrends.write_bytes} />
                                  </Typography>
                                </Box>
                                <Box>
                                  <Typography variant="caption" sx={{ opacity: 0.7 }}>{t('cluster.iopsReads')}:</Typography>
                                  <Typography variant="body1" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    {clusterCephPerf?.read_op_per_sec?.toLocaleString() || 0}
                                    <TrendIcon trend={cephTrends.read_iops} />
                                  </Typography>
                                </Box>
                                <Box>
                                  <Typography variant="caption" sx={{ opacity: 0.7 }}>{t('cluster.iopsWrites')}:</Typography>
                                  <Typography variant="body1" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    {clusterCephPerf?.write_op_per_sec?.toLocaleString() || 0}
                                    <TrendIcon trend={cephTrends.write_iops} />
                                  </Typography>
                                </Box>
                              </Box>
                            </CardContent>
                          </Card>
                        </Box>

                        {/* Graphiques Performance */}
                        <Card variant="outlined">
                          <CardContent>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                              <Typography variant="subtitle2" fontWeight={700}>
                                {t('cluster.performanceHistory')}
                              </Typography>
                              {/* Sélecteur de timeframe */}
                              <Box sx={{ display: 'flex', gap: 0.5 }}>
                                {[
                                  { value: 60, label: '1m' },
                                  { value: 300, label: '5m' },
                                  { value: 600, label: '10m' },
                                  { value: 1800, label: '30m' },
                                  { value: 3600, label: '1h' },
                                ].map(opt => (
                                  <Chip
                                    key={opt.value}
                                    label={opt.label}
                                    size="small"
                                    onClick={() => setClusterCephTimeframe(opt.value)}
                                    sx={{
                                      height: 24,
                                      fontSize: 11,
                                      fontWeight: 600,
                                      bgcolor: clusterCephTimeframe === opt.value ? 'primary.main' : 'action.hover',
                                      color: clusterCephTimeframe === opt.value ? 'primary.contrastText' : 'text.secondary',
                                      '&:hover': { bgcolor: clusterCephTimeframe === opt.value ? 'primary.dark' : 'action.selected' },
                                      cursor: 'pointer',
                                    }}
                                  />
                                ))}
                              </Box>
                            </Box>
                            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
                              {/* Reads Graph */}
                              <ExpandableChart
                                title={t('cluster.reads')}
                                height={100}
                                header={
                                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flex: 1 }}>
                                    <Typography variant="caption" fontWeight={600} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                      {t('cluster.reads')}:
                                      <TrendIcon trend={cephTrends.read_bytes} />
                                    </Typography>
                                    <Typography variant="caption" fontWeight={700}>
                                      {clusterCephPerf?.read_bytes_sec ? formatBps(clusterCephPerf.read_bytes_sec) : '0 B/s'}
                                    </Typography>
                                  </Box>
                                }
                              >
                                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                                  <AreaChart data={clusterCephPerfFiltered} margin={{ top: 2, right: 4, bottom: 0, left: 4 }}>
                                    <XAxis dataKey="time" tickFormatter={v => new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} minTickGap={40} tick={{ fontSize: 9 }} />
                                    <YAxis tickFormatter={v => formatBps(Number(v))} tick={{ fontSize: 9 }} width={50} domain={[0, 'auto']} />
                                    <Tooltip
                                      wrapperStyle={{ backgroundColor: 'transparent', boxShadow: 'none' }}
                                      content={({ active, payload }) => {
                                        if (!active || !payload?.length) return null
                                        const ts = payload[0]?.payload?.time ? new Date(payload[0].payload.time).toLocaleTimeString() : ''
                                        return (
                                          <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11, minWidth: 160 }}>
                                            <Box sx={{ px: 1.5, py: 0.75, bgcolor: alpha('#3b82f6', 0.1), borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                              <i className="ri-speed-line" style={{ fontSize: 13, color: '#3b82f6' }} />
                                              <Typography variant="caption" sx={{ fontWeight: 700, color: '#3b82f6' }}>Reads</Typography>
                                              <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6 }}>{ts}</Typography>
                                            </Box>
                                            <Box sx={{ px: 1.5, py: 0.75 }}>
                                              {payload.map(entry => (
                                                <Box key={String(entry.dataKey)} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
                                                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                                                  <Typography variant="caption" sx={{ flex: 1 }}>Reads</Typography>
                                                  <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>{formatBps(Number(entry.value))}</Typography>
                                                </Box>
                                              ))}
                                            </Box>
                                          </Box>
                                        )
                                      }}
                                    />
                                    <Area
                                      type="monotone"
                                      dataKey="read_bytes_sec"
                                      stroke={primaryColor}
                                      fill={primaryColor}
                                      fillOpacity={0.4}
                                      strokeWidth={1.5}
                                      isAnimationActive={false}
                                    />
                                  </AreaChart>
                                </ResponsiveContainer>
                              </ExpandableChart>

                              {/* Writes Graph */}
                              <ExpandableChart
                                title={t('cluster.writes')}
                                height={100}
                                header={
                                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flex: 1 }}>
                                    <Typography variant="caption" fontWeight={600} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                      {t('cluster.writes')}:
                                      <TrendIcon trend={cephTrends.write_bytes} />
                                    </Typography>
                                    <Typography variant="caption" fontWeight={700}>
                                      {clusterCephPerf?.write_bytes_sec ? formatBps(clusterCephPerf.write_bytes_sec) : '0 B/s'}
                                    </Typography>
                                  </Box>
                                }
                              >
                                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                                  <AreaChart data={clusterCephPerfFiltered} margin={{ top: 2, right: 4, bottom: 0, left: 4 }}>
                                    <XAxis dataKey="time" tickFormatter={v => new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} minTickGap={40} tick={{ fontSize: 9 }} />
                                    <YAxis tickFormatter={v => formatBps(Number(v))} tick={{ fontSize: 9 }} width={50} domain={[0, 'auto']} />
                                    <Tooltip
                                      wrapperStyle={{ backgroundColor: 'transparent', boxShadow: 'none' }}
                                      content={({ active, payload }) => {
                                        if (!active || !payload?.length) return null
                                        const ts = payload[0]?.payload?.time ? new Date(payload[0].payload.time).toLocaleTimeString() : ''
                                        return (
                                          <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11, minWidth: 160 }}>
                                            <Box sx={{ px: 1.5, py: 0.75, bgcolor: alpha('#10b981', 0.1), borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                              <i className="ri-speed-line" style={{ fontSize: 13, color: '#10b981' }} />
                                              <Typography variant="caption" sx={{ fontWeight: 700, color: '#10b981' }}>Writes</Typography>
                                              <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6 }}>{ts}</Typography>
                                            </Box>
                                            <Box sx={{ px: 1.5, py: 0.75 }}>
                                              {payload.map(entry => (
                                                <Box key={String(entry.dataKey)} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
                                                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                                                  <Typography variant="caption" sx={{ flex: 1 }}>Writes</Typography>
                                                  <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>{formatBps(Number(entry.value))}</Typography>
                                                </Box>
                                              ))}
                                            </Box>
                                          </Box>
                                        )
                                      }}
                                    />
                                    <Area
                                      type="monotone"
                                      dataKey="write_bytes_sec"
                                      stroke={primaryColor}
                                      fill={primaryColor}
                                      fillOpacity={0.4}
                                      strokeWidth={1.5}
                                      isAnimationActive={false}
                                    />
                                  </AreaChart>
                                </ResponsiveContainer>
                              </ExpandableChart>

                              {/* IOPS Reads Graph */}
                              <ExpandableChart
                                title={t('cluster.iopsReads')}
                                height={100}
                                header={
                                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flex: 1 }}>
                                    <Typography variant="caption" fontWeight={600} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                      {t('cluster.iopsReads')}:
                                      <TrendIcon trend={cephTrends.read_iops} />
                                    </Typography>
                                    <Typography variant="caption" fontWeight={700}>
                                      {clusterCephPerf?.read_op_per_sec?.toLocaleString() || 0}
                                    </Typography>
                                  </Box>
                                }
                              >
                                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                                  <AreaChart data={clusterCephPerfFiltered} margin={{ top: 2, right: 4, bottom: 0, left: 4 }}>
                                    <XAxis dataKey="time" tickFormatter={v => new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} minTickGap={40} tick={{ fontSize: 9 }} />
                                    <YAxis tick={{ fontSize: 9 }} width={40} domain={[0, 'auto']} />
                                    <Tooltip
                                      wrapperStyle={{ backgroundColor: 'transparent', boxShadow: 'none' }}
                                      content={({ active, payload }) => {
                                        if (!active || !payload?.length) return null
                                        const ts = payload[0]?.payload?.time ? new Date(payload[0].payload.time).toLocaleTimeString() : ''
                                        return (
                                          <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11, minWidth: 160 }}>
                                            <Box sx={{ px: 1.5, py: 0.75, bgcolor: alpha('#f59e0b', 0.1), borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                              <i className="ri-dashboard-3-line" style={{ fontSize: 13, color: '#f59e0b' }} />
                                              <Typography variant="caption" sx={{ fontWeight: 700, color: '#f59e0b' }}>IOPS Reads</Typography>
                                              <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6 }}>{ts}</Typography>
                                            </Box>
                                            <Box sx={{ px: 1.5, py: 0.75 }}>
                                              {payload.map(entry => (
                                                <Box key={String(entry.dataKey)} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
                                                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                                                  <Typography variant="caption" sx={{ flex: 1 }}>Reads</Typography>
                                                  <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>{Number(entry.value).toLocaleString()} IOPS</Typography>
                                                </Box>
                                              ))}
                                            </Box>
                                          </Box>
                                        )
                                      }}
                                    />
                                    <Area
                                      type="monotone"
                                      dataKey="read_op_per_sec"
                                      stroke={primaryColor}
                                      fill={primaryColor}
                                      fillOpacity={0.4}
                                      strokeWidth={1.5}
                                      isAnimationActive={false}
                                    />
                                  </AreaChart>
                                </ResponsiveContainer>
                              </ExpandableChart>

                              {/* IOPS Writes Graph */}
                              <ExpandableChart
                                title={t('cluster.iopsWrites')}
                                height={100}
                                header={
                                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flex: 1 }}>
                                    <Typography variant="caption" fontWeight={600} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                      {t('cluster.iopsWrites')}:
                                      <TrendIcon trend={cephTrends.write_iops} />
                                    </Typography>
                                    <Typography variant="caption" fontWeight={700}>
                                      {clusterCephPerf?.write_op_per_sec?.toLocaleString() || 0}
                                    </Typography>
                                  </Box>
                                }
                              >
                                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                                  <AreaChart data={clusterCephPerfFiltered} margin={{ top: 2, right: 4, bottom: 0, left: 4 }}>
                                    <XAxis dataKey="time" tickFormatter={v => new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} minTickGap={40} tick={{ fontSize: 9 }} />
                                    <YAxis tick={{ fontSize: 9 }} width={40} domain={[0, 'auto']} />
                                    <Tooltip
                                      wrapperStyle={{ backgroundColor: 'transparent', boxShadow: 'none' }}
                                      content={({ active, payload }) => {
                                        if (!active || !payload?.length) return null
                                        const ts = payload[0]?.payload?.time ? new Date(payload[0].payload.time).toLocaleTimeString() : ''
                                        return (
                                          <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11, minWidth: 160 }}>
                                            <Box sx={{ px: 1.5, py: 0.75, bgcolor: alpha('#ef4444', 0.1), borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                              <i className="ri-dashboard-3-line" style={{ fontSize: 13, color: '#ef4444' }} />
                                              <Typography variant="caption" sx={{ fontWeight: 700, color: '#ef4444' }}>IOPS Writes</Typography>
                                              <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6 }}>{ts}</Typography>
                                            </Box>
                                            <Box sx={{ px: 1.5, py: 0.75 }}>
                                              {payload.map(entry => (
                                                <Box key={String(entry.dataKey)} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
                                                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                                                  <Typography variant="caption" sx={{ flex: 1 }}>Writes</Typography>
                                                  <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>{Number(entry.value).toLocaleString()} IOPS</Typography>
                                                </Box>
                                              ))}
                                            </Box>
                                          </Box>
                                        )
                                      }}
                                    />
                                    <Area
                                      type="monotone"
                                      dataKey="write_op_per_sec"
                                      stroke={primaryColor}
                                      fill={primaryColor}
                                      fillOpacity={0.4}
                                      strokeWidth={1.5}
                                      isAnimationActive={false}
                                    />
                                  </AreaChart>
                                </ResponsiveContainer>
                              </ExpandableChart>
                            </Box>
                          </CardContent>
                        </Card>
                      </Stack>
                    ) : (
                      <Box sx={{ p: 4, textAlign: 'center' }}>
                        <Box sx={{ 
                          width: 80, 
                          height: 80, 
                          borderRadius: '50%', 
                          bgcolor: 'action.hover', 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center',
                          mx: 'auto',
                          mb: 2
                        }}>
                          <i className="ri-database-2-line" style={{ fontSize: 40, opacity: 0.5 }} />
                        </Box>
                        <Typography variant="h6" fontWeight={700} sx={{ mb: 1 }}>
                          {t('cluster.cephNotInstalled')}
                        </Typography>
                        <Typography variant="body2" sx={{ opacity: 0.7, mb: 3, maxWidth: 500, mx: 'auto' }}>
                          {t('cluster.cephDescription')}
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap' }}>
                          <Button
                            variant="contained"
                            startIcon={<i className="ri-download-cloud-line" />}
                            disabled
                          >
                            {t('cluster.installCeph')}
                          </Button>
                          <Button
                            variant="outlined"
                            startIcon={<i className="ri-external-link-line" />}
                            href="https://pve.proxmox.com/wiki/Deploy_Hyper-Converged_Ceph_Cluster"
                            target="_blank"
                          >
                            {t('cluster.documentation')}
                          </Button>
                        </Box>
                        <Typography variant="caption" sx={{ display: 'block', mt: 2, opacity: 0.5 }}>
                          {t('cluster.installWizardComingSoon')}
                        </Typography>
                      </Box>
                    )}
                  </Box>
                )}

                {/* Onglet Storage - Index 8 */}
                {clusterTab === 8 && (
                  <Box sx={{ p: 0 }}>
                    {clusterStorageLoading ? (
                      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                        <CircularProgress size={24} />
                      </Box>
                    ) : (
                      <Box sx={{ width: '100%', overflow: 'auto' }}>
                        <Table size="small" sx={{ minWidth: 800 }}>
                          <TableHead>
                            <TableRow sx={{ bgcolor: 'action.hover' }}>
                              <TableCell sx={{ fontWeight: 700 }}>{t('inventory.id')}</TableCell>
                              <TableCell sx={{ fontWeight: 700 }}>{t('common.type')}</TableCell>
                              <TableCell sx={{ fontWeight: 700 }}>{t('cluster.content')}</TableCell>
                              <TableCell sx={{ fontWeight: 700 }}>{t('cluster.pathTarget')}</TableCell>
                              <TableCell sx={{ fontWeight: 700 }} align="center">{t('cluster.shared')}</TableCell>
                              <TableCell sx={{ fontWeight: 700 }} align="center">{t('common.enabled')}</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {clusterStorageData.length > 0 ? (
                              clusterStorageData.map((storage: any) => (
                                <TableRow key={storage.storage} hover>
                                  <TableCell sx={{ fontWeight: 600 }}>{storage.storage}</TableCell>
                                  <TableCell>
                                    <Chip 
                                      size="small" 
                                      label={storage.type} 
                                      sx={{ 
                                        height: 20, 
                                        fontSize: 11,
                                        bgcolor: storage.type === 'rbd' ? 'info.main' : 
                                                 storage.type === 'cephfs' ? 'secondary.main' :
                                                 storage.type === 'pbs' ? 'warning.main' :
                                                 storage.type === 'dir' ? 'default' : 'action.selected',
                                        color: ['rbd', 'cephfs', 'pbs'].includes(storage.type) ? 'white' : 'inherit'
                                      }} 
                                    />
                                  </TableCell>
                                  <TableCell>
                                    <Typography variant="caption" sx={{ opacity: 0.9 }}>
                                      {typeof storage.content === 'string' ? storage.content.split(',').join(', ') : (storage.content || '—')}
                                    </Typography>
                                  </TableCell>
                                  <TableCell>
                                    <Typography variant="caption" sx={{ fontFamily: 'monospace', opacity: 0.8 }}>
                                      {storage.path || storage.server || storage.pool || '—'}
                                    </Typography>
                                  </TableCell>
                                  <TableCell align="center">
                                    {storage.shared ? (
                                      <i className="ri-checkbox-circle-fill" style={{ color: '#4caf50', fontSize: 18 }} />
                                    ) : (
                                      <Typography variant="caption" sx={{ opacity: 0.5 }}>{t('common.no')}</Typography>
                                    )}
                                  </TableCell>
                                  <TableCell align="center">
                                    {storage.disable ? (
                                      <i className="ri-close-circle-fill" style={{ color: '#f44336', fontSize: 18 }} />
                                    ) : (
                                      <i className="ri-checkbox-circle-fill" style={{ color: '#4caf50', fontSize: 18 }} />
                                    )}
                                  </TableCell>
                                </TableRow>
                              ))
                            ) : (
                              <TableRow>
                                <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                                  <Box sx={{ opacity: 0.5 }}>
                                    <i className="ri-hard-drive-2-line" style={{ fontSize: 48 }} />
                                    <Typography sx={{ mt: 1 }}>{t('cluster.noStorageConfigured')}</Typography>
                                  </Box>
                                </TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </Box>
                    )}
                  </Box>
                )}

                {/* Onglet Firewall - Index 9 */}
                {clusterTab === 9 && (
                  <ClusterFirewallTab
                    connectionId={selection?.id?.split(':')[0] || ''}
                  />
                )}

                {/* Onglet Rolling Update - Index 11 */}
                {clusterTab === 11 && (
                  <Box sx={{ p: 2 }}>
                    <Stack spacing={3}>
                      {/* Header */}
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Typography variant="subtitle1" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <i className="ri-refresh-line" style={{ fontSize: 20 }} />
                          {t('updates.rollingUpdate')}
                        </Typography>
                        <Button
                          variant="outlined"
                          size="small"
                          disabled={refreshingUpdates}
                          startIcon={refreshingUpdates ? <CircularProgress size={16} /> : <i className="ri-refresh-line" />}
                          onClick={async () => {
                            const cId = selection?.type === 'cluster' ? selection.id : ''
                            if (!cId || !data.nodesData?.length) return
                            setRefreshingUpdates(true)
                            try {
                              // Trigger apt update on all online nodes (POST = apt update)
                              await Promise.all(
                                data.nodesData
                                  .filter((n: any) => n.status === 'online')
                                  .map((n: any) =>
                                    fetch(`/api/v1/connections/${encodeURIComponent(cId)}/nodes/${encodeURIComponent(n.node)}/apt`, { method: 'POST' }).catch(() => null)
                                  )
                              )
                              // POST now waits for apt update tasks to complete — reload update lists
                              setNodeUpdates({})
                              setNodeLocalVms({})
                            } finally {
                              setRefreshingUpdates(false)
                            }
                          }}
                        >
                          {refreshingUpdates ? t('updates.checking') : t('updates.refresh')}
                        </Button>
                      </Box>

                      {/* Description */}
                      <Alert severity="info" icon={<i className="ri-information-line" />}>
                        <Typography variant="body2">
                          {t('updates.rollingUpdateDescription')}
                        </Typography>
                      </Alert>

                      {/* Statut des nœuds */}
                      <Card variant="outlined">
                        <CardContent>
                          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                            <i className="ri-server-line" style={{ fontSize: 18 }} />
                            {t('updates.nodesStatus')}
                          </Typography>
                          <TableContainer>
                            <Table size="small">
                              <TableHead>
                                <TableRow>
                                  <TableCell>{t('updates.node')}</TableCell>
                                  <TableCell>{t('updates.version')}</TableCell>
                                  <TableCell align="center">{t('updates.vms')}</TableCell>
                                  <TableCell align="center">{t('updates.availableUpdates')}</TableCell>
                                  <TableCell align="center">{t('updates.estimatedTime')}</TableCell>
                                  <TableCell align="center">{t('updates.status')}</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {data.nodesData.map((node: any) => {
                                  const nodeUpdate = nodeUpdates[node.node]
                                  // Calcul du temps estimé (réaliste pour rolling update)
                                  const hasKernel = nodeUpdate?.updates?.some((u: any) => 
                                    (u.Package || u.package || '').toLowerCase().includes('kernel') ||
                                    (u.Package || u.package || '').toLowerCase().includes('linux-image') ||
                                    (u.Package || u.package || '').toLowerCase().includes('pve-kernel')
                                  )
                                  const pkgCount = nodeUpdate?.count || 0
                                  const vmCount = node.vms || 0
                                  
                                  // Estimation réaliste:
                                  // - Évacuation VMs: 2min + 30s par VM (migration live)
                                  // - Mode maintenance HA + flags Ceph: 2min
                                  // - Téléchargement paquets: 2min
                                  // - Installation: 5min + 3s par paquet
                                  // - Redémarrage si kernel: 5min
                                  // - Retour nœud + vérifs: 2min
                                  // - Suppression flags + sortie maintenance: 1min
                                  // - Vérification santé Ceph: 3min
                                  // - Buffer sécurité: 2min
                                  const estimatedMinutes = pkgCount > 0 
                                    ? Math.ceil(
                                        2 + Math.ceil(vmCount * 0.5) +  // Évacuation VMs
                                        2 +                             // Maintenance + flags Ceph
                                        2 +                             // Téléchargement
                                        5 + Math.ceil(pkgCount * 3 / 60) + // Installation
                                        (hasKernel ? 5 : 0) +           // Redémarrage
                                        2 +                             // Retour nœud
                                        1 +                             // Sortie maintenance
                                        3 +                             // Check santé Ceph
                                        2                               // Buffer sécurité
                                      )
                                    : 0
                                  return (
                                    <TableRow key={node.node}>
                                      <TableCell>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                          <Box sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width: 16, height: 16, flexShrink: 0 }}>
                                            <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={16} height={16} style={{ opacity: 0.8 }} />
                                            <Box sx={{ position: 'absolute', bottom: -2, right: -2, width: 8, height: 8, borderRadius: '50%', bgcolor: node.status === 'online' ? 'success.main' : 'error.main', border: '1.5px solid', borderColor: 'background.paper' }} />
                                          </Box>
                                          <Typography variant="body2" fontWeight={600}>{node.node}</Typography>
                                        </Box>
                                      </TableCell>
                                      <TableCell align="center">
                                        {nodeUpdate?.loading ? (
                                          <CircularProgress size={14} />
                                        ) : (
                                          <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                                            {nodeUpdate?.version || '—'}
                                          </Typography>
                                        )}
                                      </TableCell>
                                      <TableCell align="center">
                                        {(() => {
                                          const localVmData = nodeLocalVms[node.node]
                                          const hasBlockingVms = localVmData && localVmData.blockingMigration > 0
                                          const hasLocalWithReplication = localVmData && localVmData.withReplication > 0
                                          
                                          return (
                                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                                              <Chip 
                                                size="small" 
                                                label={node.vms ?? 0} 
                                                sx={{ height: 20, fontSize: 11, minWidth: 32 }}
                                              />
                                              {localVmData?.loading ? (
                                                <CircularProgress size={12} />
                                              ) : hasBlockingVms ? (
                                                <MuiTooltip title={
                                                  <Box>
                                                    <Typography variant="caption" fontWeight={600} sx={{ display: 'block' }}>
                                                      {t('updates.localStorageWarning')}
                                                    </Typography>
                                                    <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
                                                      {localVmData.blockingMigration} VM(s) {t('updates.cannotMigrate')}
                                                    </Typography>
                                                    {hasLocalWithReplication && (
                                                      <Typography variant="caption" sx={{ display: 'block', color: 'success.light' }}>
                                                        {localVmData.withReplication} VM(s) {t('updates.withReplication')}
                                                      </Typography>
                                                    )}
                                                    <Typography variant="caption" sx={{ display: 'block', mt: 0.5, opacity: 0.8 }}>
                                                      {t('updates.clickForDetails')}
                                                    </Typography>
                                                  </Box>
                                                }>
                                                  <Chip
                                                    size="small"
                                                    icon={<i className="ri-hard-drive-2-line" style={{ fontSize: 12 }} />}
                                                    label={localVmData.blockingMigration}
                                                    color="error"
                                                    sx={{ 
                                                      height: 20, 
                                                      fontSize: 10, 
                                                      cursor: 'pointer',
                                                      '& .MuiChip-icon': { fontSize: 12, ml: 0.5 }
                                                    }}
                                                    onClick={() => {
                                                      setLocalVmsDialogNode(node.node)
                                                      setLocalVmsDialogOpen(true)
                                                    }}
                                                  />
                                                </MuiTooltip>
                                              ) : localVmData && localVmData.total > 0 && localVmData.canMigrate ? (
                                                <MuiTooltip title={
                                                  <Box>
                                                    <Typography variant="caption" fontWeight={600} sx={{ display: 'block' }}>
                                                      {localVmData.total} VM(s) {t('updates.withLocalStorage')}
                                                    </Typography>
                                                    <Typography variant="caption" sx={{ display: 'block', color: 'success.light' }}>
                                                      {t('updates.allCanMigrate')}
                                                    </Typography>
                                                  </Box>
                                                }>
                                                  <Chip
                                                    size="small"
                                                    icon={<i className="ri-hard-drive-2-line" style={{ fontSize: 12 }} />}
                                                    label={localVmData.total}
                                                    color="warning"
                                                    sx={{ 
                                                      height: 20, 
                                                      fontSize: 10,
                                                      cursor: 'pointer',
                                                      '& .MuiChip-icon': { fontSize: 12, ml: 0.5 }
                                                    }}
                                                    onClick={() => {
                                                      setLocalVmsDialogNode(node.node)
                                                      setLocalVmsDialogOpen(true)
                                                    }}
                                                  />
                                                </MuiTooltip>
                                              ) : null}
                                            </Box>
                                          )
                                        })()}
                                      </TableCell>
                                      <TableCell align="center">
                                        {nodeUpdate?.loading ? (
                                          <CircularProgress size={14} />
                                        ) : node.status !== 'online' ? (
                                          <Typography variant="caption" sx={{ opacity: 0.5 }}>—</Typography>
                                        ) : (
                                          <Chip 
                                            size="small" 
                                            label={nodeUpdate?.count ?? 0}
                                            color={nodeUpdate?.count > 0 ? 'warning' : 'success'}
                                            sx={{ 
                                              height: 24, 
                                              fontSize: 11, 
                                              minWidth: 40,
                                              cursor: nodeUpdate?.count > 0 ? 'pointer' : 'default',
                                              fontWeight: 600
                                            }}
                                            onClick={() => {
                                              if (nodeUpdate?.count > 0) {
                                                setUpdatesDialogNode(node.node)
                                                setUpdatesDialogOpen(true)
                                              }
                                            }}
                                            icon={nodeUpdate?.count > 0 ? <i className="ri-arrow-up-circle-fill" style={{ fontSize: 14 }} /> : <i className="ri-checkbox-circle-fill" style={{ fontSize: 14 }} />}
                                          />
                                        )}
                                      </TableCell>
                                      <TableCell align="center">
                                        {nodeUpdate?.loading ? (
                                          <CircularProgress size={14} />
                                        ) : node.status !== 'online' || pkgCount === 0 ? (
                                          <Typography variant="caption" sx={{ opacity: 0.5 }}>—</Typography>
                                        ) : (
                                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                                            <Typography variant="body2" sx={{ fontSize: 12 }}>
                                              ~{estimatedMinutes} min
                                            </Typography>
                                            {hasKernel && (
                                              <MuiTooltip title={t('updates.rebootRequired')}>
                                                <i className="ri-restart-line" style={{ fontSize: 14, color: '#ff9800' }} />
                                              </MuiTooltip>
                                            )}
                                          </Box>
                                        )}
                                      </TableCell>
                                      <TableCell align="center">
                                        {node.status === 'online' ? (
                                          <Chip 
                                            size="small" 
                                            label={t('updates.online')} 
                                            color="success" 
                                            icon={<i className="ri-checkbox-circle-fill" style={{ fontSize: 14 }} />}
                                            sx={{ height: 24 }}
                                          />
                                        ) : (
                                          <Chip 
                                            size="small" 
                                            label={t('updates.offline')} 
                                            color="error"
                                            icon={<i className="ri-close-circle-fill" style={{ fontSize: 14 }} />}
                                            sx={{ height: 24 }}
                                          />
                                        )}
                                      </TableCell>
                                    </TableRow>
                                  )
                                })}
                              </TableBody>
                            </Table>
                          </TableContainer>
                        </CardContent>
                      </Card>

                      {/* Résumé */}
                      {Object.keys(nodeUpdates).length > 0 && (
                        (() => {
                          // Calculer le temps total pour tous les nœuds
                          let totalMinutes = 0
                          let nodesWithUpdates = 0
                          let totalReboots = 0
                          
                          data.nodesData?.forEach((node: any) => {
                            const nodeUpdate = nodeUpdates[node.node]
                            if (nodeUpdate && nodeUpdate.count > 0) {
                              nodesWithUpdates++
                              const hasKernel = nodeUpdate.updates?.some((u: any) => 
                                (u.Package || u.package || '').toLowerCase().includes('kernel') ||
                                (u.Package || u.package || '').toLowerCase().includes('linux-image') ||
                                (u.Package || u.package || '').toLowerCase().includes('pve-kernel')
                              )
                              if (hasKernel) totalReboots++
                              const vmCount = node.vms || 0
                              
                              // Estimation réaliste par nœud:
                              // - Évacuation VMs: 2min + 30s par VM
                              // - Mode maintenance HA + flags Ceph: 2min
                              // - Téléchargement paquets: 2min
                              // - Installation: 5min + 3s par paquet
                              // - Redémarrage si kernel: 5min
                              // - Retour nœud + vérifs: 2min
                              // - Suppression flags + sortie maintenance: 1min
                              // - Vérification santé Ceph: 3min
                              // - Buffer sécurité: 2min
                              totalMinutes += Math.ceil(
                                2 + Math.ceil(vmCount * 0.5) +  // Évacuation VMs
                                2 +                             // Maintenance + flags Ceph
                                2 +                             // Téléchargement
                                5 + Math.ceil(nodeUpdate.count * 3 / 60) + // Installation
                                (hasKernel ? 5 : 0) +           // Redémarrage
                                2 +                             // Retour nœud
                                1 +                             // Sortie maintenance
                                3 +                             // Check santé Ceph
                                2                               // Buffer sécurité
                              )
                            }
                          })
                          
                          const totalUpdates = (Object.values(nodeUpdates) as any[]).reduce((sum: number, n: any) => sum + n.count, 0)
                          const hasUpdates = totalUpdates > 0
                          
                          // Formater le temps total
                          const formatTime = (minutes: number) => {
                            if (minutes < 60) return `~${minutes} min`
                            const hours = Math.floor(minutes / 60)
                            const mins = minutes % 60
                            return mins > 0 ? `~${hours}h ${mins}min` : `~${hours}h`
                          }
                          
                          return (
                            <Alert 
                              severity={hasUpdates ? 'warning' : 'success'}
                              icon={hasUpdates ? <i className="ri-error-warning-line" /> : <i className="ri-checkbox-circle-line" />}
                            >
                              <Box>
                                <Typography variant="body2" fontWeight={600}>
                                  {t('updates.summaryUpdates', { 
                                    count: totalUpdates,
                                    nodes: nodesWithUpdates 
                                  })}
                                </Typography>
                                {hasUpdates && (
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 0.5, flexWrap: 'wrap' }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                      <i className="ri-time-line" style={{ fontSize: 14 }} />
                                      <Typography variant="caption">
                                        {t('updates.totalEstimatedTime')}: {formatTime(totalMinutes)}
                                      </Typography>
                                    </Box>
                                    {totalReboots > 0 && (
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                        <i className="ri-restart-line" style={{ fontSize: 14, color: '#ff9800' }} />
                                        <Typography variant="caption">
                                          {t('updates.rebootsRequired', { count: totalReboots })}
                                        </Typography>
                                      </Box>
                                    )}
                                  </Box>
                                )}
                              </Box>
                            </Alert>
                          )
                        })()
                      )}

                      {/* Active rolling update — monitor button */}
                      {activeRollingUpdateId && (
                        <Button
                          variant="contained"
                          color="info"
                          size="large"
                          startIcon={<i className="ri-eye-line" style={{ fontSize: 20 }} />}
                          onClick={() => openMonitor(activeRollingUpdateId, clusterConnId)}
                          sx={{ alignSelf: 'flex-start' }}
                        >
                          {t('updates.monitorRollingUpdate')}
                        </Button>
                      )}

                      {/* Bouton démarrer le Rolling Update */}
                      {!activeRollingUpdateId && (Object.values(nodeUpdates) as any[]).reduce((sum: number, n: any) => sum + n.count, 0) > 0 ? (
                        <Button
                          variant="contained"
                          color="warning"
                          size="large"
                          startIcon={<i className="ri-play-circle-line" style={{ fontSize: 20 }} />}
                          onClick={() => setRollingUpdateWizardOpen(true)}
                          sx={{ alignSelf: 'flex-start' }}
                        >
                          {t('updates.startRollingUpdate')}
                        </Button>
                      ) : !activeRollingUpdateId && Object.keys(nodeUpdates).length > 0 ? (
                        <Alert severity="success" icon={<i className="ri-checkbox-circle-line" />}>
                          <Typography variant="body2" fontWeight={600}>
                            {t('updates.upToDate')}
                          </Typography>
                        </Alert>
                      ) : null}
                    </Stack>

                    {/* Rolling Update Wizard */}
                    <RollingUpdateWizard
                      open={rollingUpdateWizardOpen}
                      onClose={() => setRollingUpdateWizardOpen(false)}
                      connectionId={selection?.type === 'cluster' ? selection.id : ''}
                      nodes={data.nodesData?.map((n: any) => ({
                        node: n.node,
                        version: nodeUpdates[n.node]?.version || '',
                        vms: n.vms || 0,
                        status: n.status,
                      })) || []}
                      nodeUpdates={nodeUpdates}
                      connectedNode={data.connectedNode || null}
                      hasCeph={!!data.cephHealth}
                    />

                    {/* Dialog pour afficher les mises à jour */}
                    <Dialog 
                      open={updatesDialogOpen} 
                      onClose={() => setUpdatesDialogOpen(false)}
                      maxWidth="md"
                      fullWidth
                    >
                      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <i className="ri-download-cloud-line" style={{ fontSize: 24, color: '#ff9800' }} />
                        {t('updates.updatesOn', { node: updatesDialogNode })}
                      </DialogTitle>
                      <DialogContent>
                        {updatesDialogNode && nodeUpdates[updatesDialogNode]?.updates?.length > 0 ? (
                          <>
                            {/* Résumé avec détection kernel */}
                            {(() => {
                              const updates = nodeUpdates[updatesDialogNode]?.updates || []
                              const hasKernelUpdate = updates.some((u: any) => 
                                (u.Package || u.package || '').toLowerCase().includes('kernel') ||
                                (u.Package || u.package || '').toLowerCase().includes('linux-image')
                              )
                              return (
                                <Alert 
                                  severity={hasKernelUpdate ? 'warning' : 'info'} 
                                  sx={{ mb: 2 }}
                                  icon={hasKernelUpdate ? <i className="ri-restart-line" style={{ fontSize: 20 }} /> : <i className="ri-information-line" style={{ fontSize: 20 }} />}
                                >
                                  <Box>
                                    <Typography variant="body2" fontWeight={600}>
                                      {updates.length} {t('updates.packagesToUpdate')}
                                    </Typography>
                                    {hasKernelUpdate && (
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                                        <i className="ri-error-warning-line" style={{ fontSize: 14 }} />
                                        <Typography variant="caption">
                                          {t('updates.rebootRequiredKernel')}
                                        </Typography>
                                      </Box>
                                    )}
                                  </Box>
                                </Alert>
                              )
                            })()}

                            {/* Liste des paquets */}
                            <Box sx={{ 
                              maxHeight: 350, 
                              overflow: 'auto', 
                              border: '1px solid', 
                              borderColor: 'divider', 
                              borderRadius: 1
                            }}>
                              {/* Header */}
                              <Box sx={{ 
                                display: 'grid', 
                                gridTemplateColumns: '1fr 140px 140px',
                                gap: 1,
                                px: 1.5,
                                py: 0.75,
                                bgcolor: 'action.hover',
                                borderBottom: '1px solid',
                                borderColor: 'divider',
                                position: 'sticky',
                                top: 0,
                                zIndex: 1
                              }}>
                                <Typography variant="caption" fontWeight={600}>{t('updates.package')}</Typography>
                                <Typography variant="caption" fontWeight={600}>{t('updates.currentVersion')}</Typography>
                                <Typography variant="caption" fontWeight={600}>{t('updates.newVersion')}</Typography>
                              </Box>
                              {/* Rows */}
                              {nodeUpdates[updatesDialogNode]?.updates.map((upd: any, idx: number) => {
                                const pkgName = upd.Package || upd.package || ''
                                const isKernel = pkgName.toLowerCase().includes('kernel') || pkgName.toLowerCase().includes('linux-image')
                                return (
                                  <Box 
                                    key={idx}
                                    sx={{ 
                                      display: 'grid', 
                                      gridTemplateColumns: '1fr 140px 140px',
                                      gap: 1,
                                      px: 1.5,
                                      py: 0.5,
                                      borderBottom: '1px solid',
                                      borderColor: 'divider',
                                      '&:last-child': { borderBottom: 'none' },
                                      '&:hover': { bgcolor: 'action.hover' },
                                      bgcolor: isKernel ? 'rgba(255, 152, 0, 0.1)' : 'transparent'
                                    }}
                                  >
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                                      {isKernel && (
                                        <i className="ri-restart-line" style={{ fontSize: 12, color: '#ff9800', flexShrink: 0 }} />
                                      )}
                                      <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
                                        {pkgName}
                                      </Typography>
                                    </Box>
                                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 10, opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                      {upd.OldVersion || upd.old_version || '—'}
                                    </Typography>
                                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 10, color: 'success.main', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                      {upd.Version || upd.version || upd.new_version || '—'}
                                    </Typography>
                                  </Box>
                                )
                              })}
                            </Box>
                          </>
                        ) : (
                          <Typography variant="body2" sx={{ opacity: 0.6 }}>{t('updates.upToDate')}</Typography>
                        )}
                      </DialogContent>
                      <DialogActions>
                        <Button onClick={() => setUpdatesDialogOpen(false)}>{t('updates.close')}</Button>
                      </DialogActions>
                    </Dialog>

                    {/* Dialog pour afficher les VMs avec stockage local */}
                    <Dialog 
                      open={localVmsDialogOpen} 
                      onClose={() => setLocalVmsDialogOpen(false)}
                      maxWidth="md"
                      fullWidth
                    >
                      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <i className="ri-hard-drive-2-line" style={{ fontSize: 24, color: '#f44336' }} />
                        {t('updates.localVmsOn', { node: localVmsDialogNode })}
                      </DialogTitle>
                      <DialogContent>
                        {localVmsDialogNode && nodeLocalVms[localVmsDialogNode]?.vms?.length > 0 ? (
                          <>
                            {/* Résumé */}
                            <Alert 
                              severity={nodeLocalVms[localVmsDialogNode]?.canMigrate ? 'warning' : 'error'} 
                              sx={{ mb: 2 }}
                              icon={<i className="ri-error-warning-line" style={{ fontSize: 20 }} />}
                            >
                              <Box>
                                <Typography variant="body2" fontWeight={600}>
                                  {nodeLocalVms[localVmsDialogNode]?.total} VM(s) {t('updates.withLocalStorage')}
                                </Typography>
                                {nodeLocalVms[localVmsDialogNode]?.blockingMigration > 0 && (
                                  <Box sx={{ mt: 0.5 }}>
                                    <Typography variant="caption" sx={{ display: 'block', color: 'error.light' }}>
                                      <i className="ri-close-circle-fill" style={{ fontSize: 12, marginRight: 4 }} />
                                      {nodeLocalVms[localVmsDialogNode]?.blockingMigration} VM(s) {t('updates.cannotMigrateLive')}
                                    </Typography>
                                  </Box>
                                )}
                                {nodeLocalVms[localVmsDialogNode]?.withReplication > 0 && (
                                  <Typography variant="caption" sx={{ display: 'block', color: 'success.light' }}>
                                    <i className="ri-checkbox-circle-fill" style={{ fontSize: 12, marginRight: 4 }} />
                                    {nodeLocalVms[localVmsDialogNode]?.withReplication} VM(s) {t('updates.withReplication')}
                                  </Typography>
                                )}
                              </Box>
                            </Alert>

                            {/* Stratégies possibles */}
                            {nodeLocalVms[localVmsDialogNode]?.blockingMigration > 0 && (
                              <Alert severity="info" sx={{ mb: 2 }} icon={<i className="ri-lightbulb-line" style={{ fontSize: 20 }} />}>
                                <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
                                  {t('updates.migrationStrategies')}
                                </Typography>
                                <Box component="ul" sx={{ m: 0, pl: 2, '& li': { mb: 0.25 } }}>
                                  <li><Typography variant="caption">{t('updates.strategyShutdown')}</Typography></li>
                                  <li><Typography variant="caption">{t('updates.strategyMoveStorage')}</Typography></li>
                                  <li><Typography variant="caption">{t('updates.strategyReplication')}</Typography></li>
                                  <li><Typography variant="caption">{t('updates.strategyAcceptDowntime')}</Typography></li>
                                </Box>
                              </Alert>
                            )}

                            {/* Liste des VMs */}
                            <Box sx={{ 
                              maxHeight: 300, 
                              overflow: 'auto', 
                              border: '1px solid', 
                              borderColor: 'divider', 
                              borderRadius: 1
                            }}>
                              {/* Header */}
                              <Box sx={{ 
                                display: 'grid', 
                                gridTemplateColumns: '80px 1fr 1fr 100px',
                                gap: 1,
                                px: 1.5,
                                py: 0.75,
                                bgcolor: 'action.hover',
                                borderBottom: '1px solid',
                                borderColor: 'divider',
                                position: 'sticky',
                                top: 0,
                                zIndex: 1
                              }}>
                                <Typography variant="caption" fontWeight={600}>VMID</Typography>
                                <Typography variant="caption" fontWeight={600}>{t('updates.vmName')}</Typography>
                                <Typography variant="caption" fontWeight={600}>{t('updates.localDisks')}</Typography>
                                <Typography variant="caption" fontWeight={600}>{t('updates.status')}</Typography>
                              </Box>
                              {/* Rows */}
                              {nodeLocalVms[localVmsDialogNode]?.vms.map((vm: any) => (
                                <Box 
                                  key={vm.vmid}
                                  sx={{ 
                                    display: 'grid', 
                                    gridTemplateColumns: '80px 1fr 1fr 100px',
                                    gap: 1,
                                    px: 1.5,
                                    py: 0.5,
                                    borderBottom: '1px solid',
                                    borderColor: 'divider',
                                    '&:last-child': { borderBottom: 'none' },
                                    '&:hover': { bgcolor: 'action.hover' },
                                    bgcolor: vm.status === 'running' && !vm.hasReplication ? 'rgba(244, 67, 54, 0.1)' : 'transparent'
                                  }}
                                >
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <i className={vm.type === 'qemu' ? 'ri-computer-line' : 'ri-instance-line'} style={{ fontSize: 14, opacity: 0.7 }} />
                                    <Typography variant="body2" fontWeight={600} sx={{ fontSize: 12 }}>
                                      {vm.vmid}
                                    </Typography>
                                  </Box>
                                  <Typography variant="body2" sx={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {vm.name}
                                  </Typography>
                                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                    {vm.localDisks?.map((disk: string, idx: number) => (
                                      <Chip 
                                        key={idx}
                                        size="small" 
                                        label={disk} 
                                        sx={{ height: 18, fontSize: 10 }}
                                      />
                                    ))}
                                  </Box>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    {vm.status === 'running' ? (
                                      <Chip 
                                        size="small" 
                                        label={vm.hasReplication ? t('updates.replicationOk') : t('updates.running')}
                                        color={vm.hasReplication ? 'success' : 'error'}
                                        icon={vm.hasReplication ? <i className="ri-checkbox-circle-fill" style={{ fontSize: 12 }} /> : <i className="ri-error-warning-fill" style={{ fontSize: 12 }} />}
                                        sx={{ height: 20, fontSize: 10 }}
                                      />
                                    ) : (
                                      <Chip 
                                        size="small" 
                                        label={t('updates.stopped')}
                                        color="default"
                                        sx={{ height: 20, fontSize: 10 }}
                                      />
                                    )}
                                  </Box>
                                </Box>
                              ))}
                            </Box>
                          </>
                        ) : (
                          <Typography variant="body2" sx={{ opacity: 0.6 }}>{t('updates.noLocalVms')}</Typography>
                        )}
                      </DialogContent>
                      <DialogActions>
                        <Button onClick={() => setLocalVmsDialogOpen(false)}>{t('updates.close')}</Button>
                      </DialogActions>
                    </Dialog>
                  </Box>
                )}

                {/* Onglet CVE - Index 12 */}
                {clusterTab === 12 && (
                  <Box sx={{ p: 2, overflow: 'auto' }}>
                    <CveTab connectionId={selection?.id?.split(':')[0] || ''} available={cveAvailable} />
                  </Box>
                )}

                {/* Onglet Cluster - Index 10 */}
                {clusterTab === 10 && (
                  <Box sx={{ p: 2 }}>
                    {(clusterConfigLoading || !clusterConfigLoaded) ? (
                      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                        <CircularProgress size={24} />
                      </Box>
                    ) : (
                      <Stack spacing={3}>
                        {/* Header avec boutons */}
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Typography variant="subtitle1" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <i className="ri-information-line" style={{ fontSize: 20 }} />
                            {t('cluster.clusterInformation')}
                          </Typography>
                          <Stack direction="row" spacing={1}>
                            {clusterConfig?.isCluster && (
                              <Button
                                variant="outlined"
                                size="small"
                                startIcon={<i className="ri-key-line" />}
                                onClick={() => setJoinInfoDialogOpen(true)}
                              >
                                {t('cluster.joinInformation')}
                              </Button>
                            )}
                          </Stack>
                        </Box>

                        {/* Info Cluster ou Standalone */}
                        <Card variant="outlined">
                          <CardContent>
                            {clusterConfig?.isCluster ? (
                              <>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                                  <Chip 
                                    icon={<i className="ri-checkbox-circle-fill" />}
                                    label={t('cluster.clusterActive')}
                                    color="success" 
                                    size="small"
                                  />
                                  <Typography variant="h6" fontWeight={700}>
                                    {clusterConfig?.clusterName || t('cluster.unnamedCluster')}
                                  </Typography>
                                </Box>
                                {clusterConfig?.clusterStatus && (
                                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2 }}>
                                    <Box>
                                      <Typography variant="caption" sx={{ opacity: 0.7 }}>{t('cluster.configVersion')}</Typography>
                                      <Typography variant="body2" fontWeight={600}>
                                        {clusterConfig.clusterStatus.version || '—'}
                                      </Typography>
                                    </Box>
                                    <Box>
                                      <Typography variant="caption" sx={{ opacity: 0.7 }}>{t('cluster.quorum')}</Typography>
                                      <Typography variant="body2" fontWeight={600}>
                                        <Chip 
                                          size="small" 
                                          label={clusterConfig.clusterStatus.quorate ? t('common.yes') : t('common.no')}
                                          color={clusterConfig.clusterStatus.quorate ? 'success' : 'error'}
                                          sx={{ height: 20, fontSize: 11 }}
                                        />
                                      </Typography>
                                    </Box>
                                    <Box>
                                      <Typography variant="caption" sx={{ opacity: 0.7 }}>{t('inventory.nodesLabel')}</Typography>
                                      <Typography variant="body2" fontWeight={600}>
                                        {clusterConfig.clusterStatus.nodes || clusterConfig?.nodes?.length || 0}
                                      </Typography>
                                    </Box>
                                  </Box>
                                )}
                              </>
                            ) : (
                              <Box sx={{ textAlign: 'center', py: 2 }}>
                                <i className="ri-server-line" style={{ fontSize: 48, opacity: 0.3 }} />
                                <Typography variant="body1" sx={{ mt: 1, fontWeight: 600 }}>
                                  {t('cluster.standaloneNode')}
                                </Typography>
                                <Typography variant="caption" sx={{ opacity: 0.6 }}>
                                  {t('cluster.createOrJoin')}
                                </Typography>
                                <Stack direction="row" spacing={2} justifyContent="center" sx={{ mt: 3 }}>
                                  <Button
                                    variant="contained"
                                    startIcon={<i className="ri-add-circle-line" />}
                                    onClick={() => setCreateClusterDialogOpen(true)}
                                  >
                                    {t('cluster.createCluster')}
                                  </Button>
                                  <Button
                                    variant="outlined"
                                    startIcon={<i className="ri-links-line" />}
                                    onClick={() => setJoinClusterDialogOpen(true)}
                                  >
                                    {t('cluster.joinCluster')}
                                  </Button>
                                </Stack>
                              </Box>
                            )}
                          </CardContent>
                        </Card>

                        {/* Liste des Cluster Nodes */}
                        {clusterConfig?.nodes && clusterConfig.nodes.length > 0 && (
                          <Card variant="outlined">
                            <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                              <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                                <Typography fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <i className="ri-server-line" style={{ fontSize: 18 }} />
                                  {t('cluster.clusterNodes')}
                                </Typography>
                              </Box>
                              <Box>
                                {/* Header */}
                                <Box sx={{
                                  display: 'grid',
                                  gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr',
                                  gap: 2,
                                  px: 2,
                                  py: 1,
                                  bgcolor: 'action.hover',
                                  borderBottom: '1px solid',
                                  borderColor: 'divider'
                                }}>
                                  <Typography variant="caption" fontWeight={600}>{t('cluster.nodename')}</Typography>
                                  <Typography variant="caption" fontWeight={600}>{t('inventory.id')}</Typography>
                                  <Typography variant="caption" fontWeight={600}>{t('common.status')}</Typography>
                                  <Typography variant="caption" fontWeight={600}>{t('cluster.votes')}</Typography>
                                  <Typography variant="caption" fontWeight={600}>{t('cluster.ipAddress')}</Typography>
                                </Box>
                                {/* Rows */}
                                {clusterConfig.nodes.map((node: any) => (
                                  <Box
                                    key={node.name}
                                    sx={{
                                      display: 'grid',
                                      gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr',
                                      gap: 2,
                                      px: 2,
                                      py: 1.5,
                                      borderBottom: '1px solid',
                                      borderColor: 'divider',
                                      '&:last-child': { borderBottom: 'none' },
                                      '&:hover': { bgcolor: 'action.hover' },
                                      bgcolor: node.local ? 'action.selected' : 'transparent'
                                    }}
                                  >
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                      <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={16} height={16} style={{ opacity: 0.8 }} />
                                      <Box
                                        sx={{
                                          width: 8,
                                          height: 8,
                                          borderRadius: '50%',
                                          bgcolor: node.maintenance ? 'warning.main' : node.online ? 'success.main' : 'error.main'
                                        }}
                                      />
                                      <Typography variant="body2" fontWeight={node.local ? 700 : 400}>
                                        {node.name}
                                        {node.local && <Chip size="small" label="local" sx={{ ml: 1, height: 16, fontSize: 9 }} />}
                                      </Typography>
                                    </Box>
                                    <Typography variant="body2">{node.id}</Typography>
                                    <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center' }}>
                                      {node.maintenance ? (
                                        <i className="ri-tools-fill" style={{ fontSize: 16, color: '#ff9800' }} />
                                      ) : node.online ? (
                                        <Chip size="small" color="success" label="UP" sx={{ height: 20, fontSize: '0.7rem' }} />
                                      ) : (
                                        <Chip size="small" color="error" label="DOWN" sx={{ height: 20, fontSize: '0.7rem' }} />
                                      )}
                                    </Typography>
                                    <Typography variant="body2">1</Typography>
                                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                                      {node.ip || '—'}
                                    </Typography>
                                  </Box>
                                ))}
                              </Box>
                            </CardContent>
                          </Card>
                        )}
                      </Stack>
                    )}
                  </Box>
                )}

                {/* Onglet Change Tracking - Index 13 */}
                {clusterTab === 13 && (
                  <ChangeTrackingTab
                    connectionId={selection?.id || ''}
                  />
                )}

                {/* Onglet Compliance - Index 14 */}
                {clusterTab === 14 && (
                  <ComplianceTab
                    connectionId={selection?.id || ''}
                  />
                )}
              </CardContent>
            </Card>
          ) : null}

          {/* Dialog Join Information */}
          <Dialog open={joinInfoDialogOpen} onClose={() => setJoinInfoDialogOpen(false)} maxWidth="md" fullWidth>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <i className="ri-key-line" style={{ color: '#2196f3' }} />
              {t('cluster.clusterJoinInformation')}
            </DialogTitle>
            <DialogContent>
              <Typography variant="body2" sx={{ mb: 2 }}>
                {t('cluster.copyJoinInfoDescription')}
              </Typography>
              {clusterConfig?.joinInfo && (
                <Stack spacing={2.5}>
                  <Box>
                    <Typography variant="caption" fontWeight={600} sx={{ color: 'text.secondary' }}>{t('cluster.ipAddress')}:</Typography>
                    <Box sx={{ 
                      mt: 0.5, 
                      p: 1.5, 
                      bgcolor: 'action.hover', 
                      borderRadius: 1, 
                      fontFamily: 'monospace',
                      fontSize: 14 
                    }}>
                      {clusterConfig.joinInfo.ipAddress || '—'}
                    </Box>
                  </Box>
                  <Box>
                    <Typography variant="caption" fontWeight={600} sx={{ color: 'text.secondary' }}>{t('cluster.fingerprint')}:</Typography>
                    <Box sx={{ 
                      mt: 0.5, 
                      p: 1.5, 
                      bgcolor: 'action.hover', 
                      borderRadius: 1, 
                      fontFamily: 'monospace',
                      fontSize: 12,
                      wordBreak: 'break-all'
                    }}>
                      {clusterConfig.joinInfo.fingerprint || '—'}
                    </Box>
                  </Box>
                  <Box>
                    <Typography variant="caption" fontWeight={600} sx={{ color: 'text.secondary' }}>{t('cluster.joinInformation')}:</Typography>
                    <Box sx={{ 
                      mt: 0.5, 
                      p: 1.5, 
                      bgcolor: 'grey.900', 
                      borderRadius: 1, 
                      fontFamily: 'monospace',
                      fontSize: 11,
                      wordBreak: 'break-all',
                      color: 'grey.300',
                      maxHeight: 120,
                      overflow: 'auto'
                    }}>
                      {clusterConfig.joinInfo.encoded || '—'}
                    </Box>
                  </Box>
                </Stack>
              )}
            </DialogContent>
            <DialogActions>
              <Button
                variant="contained"
                startIcon={<i className="ri-file-copy-line" />}
                onClick={() => {
                  navigator.clipboard.writeText(clusterConfig?.joinInfo?.encoded || '')
                }}
              >
                {t('cluster.copyInformation')}
              </Button>
              <Button onClick={() => setJoinInfoDialogOpen(false)}>
                {t('common.close')}
              </Button>
            </DialogActions>
          </Dialog>

          {/* Dialog Create Cluster */}
          <Dialog open={createClusterDialogOpen} onClose={() => setCreateClusterDialogOpen(false)} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <i className="ri-add-circle-line" style={{ color: '#4caf50' }} />
              {t('cluster.createCluster')}
            </DialogTitle>
            <DialogContent>
              {clusterActionError && (
                <Alert severity="error" sx={{ mb: 2 }} onClose={() => setClusterActionError(null)}>
                  {clusterActionError}
                </Alert>
              )}
              <Stack spacing={2} sx={{ mt: 1 }}>
                <TextField
                  label={t('cluster.clusterName')}
                  value={newClusterName}
                  onChange={(e) => setNewClusterName(e.target.value)}
                  size="small"
                  fullWidth
                  required
                  placeholder="my-cluster"
                />
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('cluster.clusterNetwork')}</Typography>
                  {clusterConfig?.networks && clusterConfig.networks.length > 0 ? (
                    <FormControl fullWidth size="small">
                      <InputLabel>Link 0</InputLabel>
                      <Select
                        value={newClusterLinks[0]?.address || ''}
                        onChange={(e) => setNewClusterLinks([{ linkNumber: 0, address: e.target.value }])}
                        label="Link 0"
                      >
                        {clusterConfig.networks.map((net: any) => (
                          <MenuItem key={net.iface} value={net.address}>
                            {net.cidr} - {net.iface} {net.comments && `(${net.comments})`}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  ) : (
                    <Typography variant="caption" sx={{ opacity: 0.6 }}>
                      {t('cluster.noNetworkInterfaces')}
                    </Typography>
                  )}
                </Box>
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setCreateClusterDialogOpen(false)} disabled={clusterActionLoading}>
                {t('common.cancel')}
              </Button>
              <Button 
                variant="contained" 
                onClick={() => handleCreateCluster(selection?.id?.split(':')[0] || '')}
                disabled={clusterActionLoading || !newClusterName}
              >
                {clusterActionLoading ? <CircularProgress size={20} /> : t('common.create')}
              </Button>
            </DialogActions>
          </Dialog>

          {/* Dialog Join Cluster */}
          <Dialog open={joinClusterDialogOpen} onClose={() => setJoinClusterDialogOpen(false)} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <i className="ri-links-line" style={{ color: '#2196f3' }} />
              {t('cluster.clusterJoin')}
            </DialogTitle>
            <DialogContent>
              {clusterActionError && (
                <Alert severity="error" sx={{ mb: 2 }} onClose={() => setClusterActionError(null)}>
                  {clusterActionError}
                </Alert>
              )}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <i className="ri-checkbox-circle-line" style={{ color: '#4caf50' }} />
                <Typography variant="body2">
                  {t('cluster.assistedJoinDescription')}
                </Typography>
              </Box>
              <Stack spacing={2}>
                <TextField
                  label={t('common.info')}
                  value={joinClusterInfo}
                  onChange={(e) => setJoinClusterInfo(e.target.value)}
                  size="small"
                  fullWidth
                  multiline
                  rows={4}
                  placeholder={t('cluster.pasteJoinInfoPlaceholder')}
                  required
                />
                <TextField
                  label={t('cluster.password')}
                  type="password"
                  value={joinClusterPassword}
                  onChange={(e) => setJoinClusterPassword(e.target.value)}
                  size="small"
                  fullWidth
                  required
                  helperText={t('cluster.rootPasswordHelper')}
                />
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setJoinClusterDialogOpen(false)} disabled={clusterActionLoading}>
                {t('common.cancel')}
              </Button>
              <Button 
                variant="contained" 
                onClick={() => handleJoinCluster(selection?.id?.split(':')[0] || '')}
                disabled={clusterActionLoading || !joinClusterInfo || !joinClusterPassword}
              >
                {clusterActionLoading ? <CircularProgress size={20} /> : t('cluster.join')}
              </Button>
            </DialogActions>
          </Dialog>

          {/* Add HA Resource Dialog */}
          <Dialog open={addHaDialogOpen} onClose={() => setAddHaDialogOpen(false)} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <i className="ri-shield-check-line" style={{ fontSize: 20 }} />
              {t('cluster.addHaResource')}
            </DialogTitle>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}>
              <FormControl fullWidth size="small">
                <InputLabel>{t('cluster.selectVm')}</InputLabel>
                <Select
                  value={addHaSid}
                  label={t('cluster.selectVm')}
                  onChange={(e) => setAddHaSid(e.target.value)}
                >
                  {availableVmsForHa.map((vm: any) => {
                    const sid = `${vm.type === 'lxc' ? 'ct' : 'vm'}:${vm.vmid}`
                    return (
                      <MenuItem key={sid} value={sid}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: vm.status === 'running' ? '#4caf50' : '#9e9e9e', flexShrink: 0 }} />
                          <i className={vm.type === 'lxc' ? 'ri-instance-line' : 'ri-computer-line'} style={{ fontSize: 14, opacity: 0.6 }} />
                          <Typography variant="body2">{vm.name || vm.vmid}</Typography>
                          <Typography variant="caption" sx={{ opacity: 0.5, ml: 'auto' }}>{vm.node}</Typography>
                        </Box>
                      </MenuItem>
                    )
                  })}
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel>{t('cluster.state')}</InputLabel>
                <Select value={addHaState} label={t('cluster.state')} onChange={(e) => setAddHaState(e.target.value)}>
                  <MenuItem value="started">started</MenuItem>
                  <MenuItem value="stopped">stopped</MenuItem>
                  <MenuItem value="enabled">enabled</MenuItem>
                  <MenuItem value="disabled">disabled</MenuItem>
                  <MenuItem value="ignored">ignored</MenuItem>
                </Select>
              </FormControl>
              <Box sx={{ display: 'flex', gap: 2 }}>
                <TextField
                  fullWidth size="small" type="number" label={t('cluster.maxRestart')}
                  value={addHaMaxRestart} onChange={(e) => setAddHaMaxRestart(Number(e.target.value))}
                  inputProps={{ min: 0, max: 10 }}
                />
                <TextField
                  fullWidth size="small" type="number" label={t('cluster.maxRelocate')}
                  value={addHaMaxRelocate} onChange={(e) => setAddHaMaxRelocate(Number(e.target.value))}
                  inputProps={{ min: 0, max: 10 }}
                />
              </Box>
              {clusterPveMajorVersion < 9 && clusterHaGroups.length > 0 && (
                <FormControl fullWidth size="small">
                  <InputLabel>{t('cluster.group')}</InputLabel>
                  <Select value={addHaGroup} label={t('cluster.group')} onChange={(e) => setAddHaGroup(e.target.value)}>
                    <MenuItem value="">{t('common.none')}</MenuItem>
                    {clusterHaGroups.map((g: any) => (
                      <MenuItem key={g.group} value={g.group}>{g.group}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
              <TextField
                fullWidth size="small" label={t('common.description')}
                value={addHaComment} onChange={(e) => setAddHaComment(e.target.value)}
              />
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setAddHaDialogOpen(false)} disabled={addHaSaving}>
                {t('common.cancel')}
              </Button>
              <Button variant="contained" onClick={handleAddHaResource} disabled={!addHaSid || addHaSaving}>
                {addHaSaving ? <CircularProgress size={20} /> : t('common.add')}
              </Button>
            </DialogActions>
          </Dialog>
    </>
  )
}
