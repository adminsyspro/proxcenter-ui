'use client'

import React, { useCallback, useEffect, useImperativeHandle, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'

import { formatBytes } from '@/utils/format'
import { getDateLocale } from '@/lib/i18n/date'
import { useToast } from '@/contexts/ToastContext'
import { useTaskTracker } from '@/hooks/useTaskTracker'

import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
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
  FormControl,
  FormControlLabel,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip as MuiTooltip,
  Typography,
  useTheme,
} from '@mui/material'
import { lighten, alpha } from '@mui/material/styles'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts'

import type { InventorySelection, DetailsPayload } from '../types'

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface PbsServerPanelHandle {
  openRestoreDialog: (backup: any, si: any) => void
  openFileRestore: (backup: any, si: any) => void
}

interface PbsServerPanelProps {
  selection: InventorySelection | null
  data: DetailsPayload | null
  onSelect?: (sel: InventorySelection) => void
  // From useHardwareHandlers
  pbsTab: number
  setPbsTab: (v: number) => void
  pbsBackupSearch: string
  setPbsBackupSearch: (v: string) => void
  pbsBackupPage: number
  setPbsBackupPage: (v: number | ((p: number) => number)) => void
  pbsTimeframe: 'hour' | 'day' | 'week' | 'month' | 'year'
  setPbsTimeframe: (v: 'hour' | 'day' | 'week' | 'month' | 'year') => void
  pbsRrdData: any[]
  setPbsRrdData: (v: any[]) => void
  datastoreRrdData: any[]
  setDatastoreRrdData: (v: any[]) => void
  expandedBackupGroups: Set<string>
  setExpandedBackupGroups: (v: Set<string> | ((prev: Set<string>) => Set<string>)) => void
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

const PbsServerPanel = React.forwardRef<PbsServerPanelHandle, PbsServerPanelProps>(function PbsServerPanel({
  selection,
  data,
  onSelect,
  pbsTab, setPbsTab,
  pbsBackupSearch, setPbsBackupSearch,
  pbsBackupPage, setPbsBackupPage,
  pbsTimeframe, setPbsTimeframe,
  pbsRrdData, setPbsRrdData,
  datastoreRrdData, setDatastoreRrdData,
  expandedBackupGroups, setExpandedBackupGroups,
}, ref) {
  const t = useTranslations()
  const dateLocale = getDateLocale(useLocale())
  const theme = useTheme()
  const toast = useToast()
  const { trackTask } = useTaskTracker()
  const primaryColor = theme.palette.primary.main
  const primaryColorLight = lighten(primaryColor, 0.3)

  // PBS storage backup panel states
  const [pbsRestoreDialog, setPbsRestoreDialog] = useState<{
    open: boolean
    backup: any
    storageType: 'qemu' | 'lxc'
  }>({ open: false, backup: null, storageType: 'qemu' })
  const [pbsRestoreStorage, setPbsRestoreStorage] = useState('')
  const [pbsRestoreVmId, setPbsRestoreVmId] = useState('')
  const [pbsRestoreBwLimit, setPbsRestoreBwLimit] = useState('')
  const [pbsRestoreUnique, setPbsRestoreUnique] = useState(false)
  const [pbsRestoreStart, setPbsRestoreStart] = useState(false)
  const [pbsRestoreLive, setPbsRestoreLive] = useState(false)
  const [pbsRestoreOverride, setPbsRestoreOverride] = useState(false)
  const [pbsRestoreName, setPbsRestoreName] = useState('')
  const [pbsRestoreMemory, setPbsRestoreMemory] = useState('')
  const [pbsRestoreCores, setPbsRestoreCores] = useState('')
  const [pbsRestoreSockets, setPbsRestoreSockets] = useState('')
  const [pbsRestoring, setPbsRestoring] = useState(false)
  const [pbsRestoreStorages, setPbsRestoreStorages] = useState<any[]>([])
  const [pbsRestoreNodes, setPbsRestoreNodes] = useState<any[]>([])
  const [pbsRestoreNode, setPbsRestoreNode] = useState('')
  const [pbsFileRestoreDialog, setPbsFileRestoreDialog] = useState<{ open: boolean; backup: any }>({ open: false, backup: null })
  const [pbsFileLoading, setPbsFileLoading] = useState(false)
  const [pbsFileError, setPbsFileError] = useState<string | null>(null)
  const [pbsFilePveStorage, setPbsFilePveStorage] = useState<any>(null)
  // Tree state: each node has { name, type, size, mtime, browsable, isRawDiskImage, children?: [], expanded?, loaded?, loading? }
  const [pbsFileTree, setPbsFileTree] = useState<any[]>([])
  const [pbsFileExpandedPaths, setPbsFileExpandedPaths] = useState<Set<string>>(new Set())
  const [pbsFileSearch, setPbsFileSearch] = useState('')
  const [pbsFileDownloading, setPbsFileDownloading] = useState<string | null>(null)

  // PBS storage: open restore dialog
  const openPbsRestoreDialog = useCallback(async (backup: any, si: any) => {
    const vmType = backup.format === 'pbs-ct' ? 'lxc' : 'qemu'
    setPbsRestoreDialog({ open: true, backup, storageType: vmType })
    setPbsRestoreVmId(backup.vmid ? String(backup.vmid) : '')
    setPbsRestoreStorage('')
    setPbsRestoreBwLimit('')
    setPbsRestoreUnique(false)
    setPbsRestoreStart(false)
    setPbsRestoreLive(false)
    setPbsRestoreOverride(false)
    setPbsRestoreName('')
    setPbsRestoreMemory('')
    setPbsRestoreCores('')
    setPbsRestoreSockets('')
    setPbsRestoreNode(si.node || '')

    // Load nodes and storages for restore target
    try {
      const nodesR = await fetch(`/api/v1/connections/${encodeURIComponent(si.connId)}/nodes`, { cache: 'no-store' })
      if (nodesR.ok) {
        const json = await nodesR.json()
        const nodes = Array.isArray(json) ? json : (json?.data || [])
        setPbsRestoreNodes(nodes.filter((n: any) => n.status === 'online'))
      }
    } catch {}

    // Load storages on the target node
    const node = si.node || ''
    if (node) {
      try {
        const storR = await fetch(`/api/v1/connections/${encodeURIComponent(si.connId)}/nodes/${encodeURIComponent(node)}/storages?content=${vmType === 'lxc' ? 'rootdir' : 'images'}`, { cache: 'no-store' })
        if (storR.ok) {
          const json = await storR.json()
          setPbsRestoreStorages(json?.data || [])
        }
      } catch {}
    }
  }, [])

  // PBS storage: load storages when node changes
  const loadPbsRestoreStoragesForNode = useCallback(async (node: string, connId: string, vmType: string) => {
    setPbsRestoreNode(node)
    setPbsRestoreStorage('')
    setPbsRestoreStorages([])
    if (!node) return
    try {
      const storR = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/storages?content=${vmType === 'lxc' ? 'rootdir' : 'images'}`, { cache: 'no-store' })
      if (storR.ok) {
        const json = await storR.json()
        setPbsRestoreStorages(json?.data || [])
      }
    } catch {}
  }, [])

  // PBS storage: execute restore
  const handlePbsRestore = useCallback(async () => {
    if (!pbsRestoreDialog.backup || !data?.storageInfo) return
    const si = data.storageInfo
    const backup = pbsRestoreDialog.backup
    const node = pbsRestoreNode || si.node
    if (!node) return

    setPbsRestoring(true)
    try {
      const body: Record<string, any> = {
        vmid: parseInt(pbsRestoreVmId) || backup.vmid,
        archive: backup.volid,
        type: pbsRestoreDialog.storageType,
      }
      if (pbsRestoreStorage) body.storage = pbsRestoreStorage
      if (pbsRestoreBwLimit) body.bwlimit = parseInt(pbsRestoreBwLimit)
      if (pbsRestoreUnique) body.unique = true
      if (pbsRestoreStart) body.start = true
      if (pbsRestoreLive) body.live = true
      if (pbsRestoreOverride) {
        if (pbsRestoreName) body.name = pbsRestoreName
        if (pbsRestoreMemory) body.memory = parseInt(pbsRestoreMemory)
        if (pbsRestoreCores) body.cores = parseInt(pbsRestoreCores)
        if (pbsRestoreSockets) body.sockets = parseInt(pbsRestoreSockets)
      }

      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(si.connId)}/nodes/${encodeURIComponent(node)}/restore`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)

      if (json.data) trackTask({ upid: json.data, connId: si.connId, node, description: `Restore ${pbsRestoreDialog.storageType === 'lxc' ? 'CT' : 'VM'} ${pbsRestoreVmId}` })
      toast.success(t('inventory.pbsRestoreStarted'))
      setPbsRestoreDialog({ open: false, backup: null, storageType: 'qemu' })
    } catch (e: any) {
      toast.error(e.message || t('common.error'))
    } finally {
      setPbsRestoring(false)
    }
  }, [pbsRestoreDialog, pbsRestoreVmId, pbsRestoreStorage, pbsRestoreBwLimit, pbsRestoreUnique, pbsRestoreStart, pbsRestoreLive, pbsRestoreOverride, pbsRestoreName, pbsRestoreMemory, pbsRestoreCores, pbsRestoreSockets, pbsRestoreNode, data, trackTask, toast, t])

  // PBS file restore: helper to parse files from API response
  const parsePbsFiles = useCallback((files: any[]) => {
    return files.map((f: any) => {
      const fileName = (f.name || '').replace(/^\//, '')
      const isBrowsable = f.browsable || f.type === 'virtual' || f.type === 'directory' || f.leaf === 0 || f.leaf === false
      const isRawDiskImage = !isBrowsable && fileName && (
        fileName.endsWith('.img.fidx') || fileName.endsWith('.img.didx') ||
        fileName.endsWith('.raw.fidx') || fileName.endsWith('.raw.didx')
      )
      return { ...f, isRawDiskImage, browsable: isBrowsable, children: isBrowsable ? [] : undefined, loaded: false, loading: false }
    })
  }, [])

  // PBS storage: open file restore dialog
  const openPbsFileRestore = useCallback(async (backup: any, si: any) => {
    setPbsFileRestoreDialog({ open: true, backup })
    setPbsFileTree([])
    setPbsFileExpandedPaths(new Set())
    setPbsFileSearch('')
    setPbsFileLoading(true)
    setPbsFileError(null)
    setPbsFilePveStorage({ storage: si.storage, connId: si.connId, node: si.node })

    try {
      const params = new URLSearchParams({ storage: si.storage, volume: backup.volid, filepath: '/' })
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(si.connId)}/file-restore?${params}`)
      const json = await res.json()
      if (json.error && !json.data?.files?.length) {
        setPbsFileError(json.error)
      } else {
        setPbsFileTree(parsePbsFiles(json.data?.files || []))
        if (json.error) setPbsFileError(json.error)
      }
    } catch (e: any) {
      setPbsFileError(e.message || 'Error')
    } finally {
      setPbsFileLoading(false)
    }
  }, [parsePbsFiles])

  // PBS file restore: toggle expand a tree node (load children on first expand)
  const pbsToggleTreeNode = useCallback(async (treePath: string) => {
    const dialog = pbsFileRestoreDialog
    if (!dialog.backup || !data?.storageInfo) return
    const si = data.storageInfo

    // If already expanded, just collapse
    if (pbsFileExpandedPaths.has(treePath)) {
      setPbsFileExpandedPaths(prev => { const next = new Set(prev); next.delete(treePath); return next })
      return
    }

    // Find the node in the tree and check if already loaded
    const pathParts = treePath.split('/').filter(Boolean)
    let nodes = pbsFileTree
    let targetNode: any = null
    for (const part of pathParts) {
      targetNode = nodes.find((n: any) => n.name === part)
      if (!targetNode) return
      nodes = targetNode.children || []
    }

    // Expand it
    setPbsFileExpandedPaths(prev => { const next = new Set(prev); next.add(treePath); return next })

    // If children already loaded, done
    if (targetNode.loaded) return

    // Mark as loading
    const updateNodeInTree = (tree: any[], parts: string[], updater: (node: any) => any): any[] => {
      return tree.map(n => {
        if (n.name === parts[0]) {
          if (parts.length === 1) return updater(n)
          return { ...n, children: updateNodeInTree(n.children || [], parts.slice(1), updater) }
        }
        return n
      })
    }

    setPbsFileTree(prev => updateNodeInTree(prev, pathParts, n => ({ ...n, loading: true })))

    try {
      const params = new URLSearchParams({
        storage: si.storage,
        volume: dialog.backup.volid,
        filepath: `/${treePath}`,
      })
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(si.connId)}/file-restore?${params}`)
      const json = await res.json()
      const children = parsePbsFiles(json.data?.files || [])

      setPbsFileTree(prev => updateNodeInTree(prev, pathParts, n => ({
        ...n, children, loaded: true, loading: false,
      })))
    } catch (e: any) {
      setPbsFileTree(prev => updateNodeInTree(prev, pathParts, n => ({ ...n, loading: false })))
      setPbsFileError(e.message)
    }
  }, [pbsFileRestoreDialog, data, pbsFileTree, pbsFileExpandedPaths, parsePbsFiles])

  // PBS file restore: download
  const pbsDownloadFile = useCallback(async (treePath: string, isDirectory = false) => {
    if (!pbsFileRestoreDialog.backup) return
    const si = data?.storageInfo || pbsFilePveStorage
    if (!si) return
    const params = new URLSearchParams({
      storage: si.storage,
      volume: pbsFileRestoreDialog.backup.volid,
      filepath: `/${treePath}`,
    })
    if (isDirectory) params.set('directory', '1')
    const url = `/api/v1/connections/${encodeURIComponent(si.connId)}/file-restore/download?${params}`

    setPbsFileDownloading(treePath)
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Download failed: ${res.status}`)
      const blob = await res.blob()
      const fileName = treePath.split('/').pop() || 'download'
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = isDirectory ? `${fileName}.tar.zst` : fileName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(a.href)
    } catch (e: any) {
      console.error('Download error:', e)
    } finally {
      setPbsFileDownloading(null)
    }
  }, [pbsFileRestoreDialog, data, pbsFilePveStorage])

  // Expose handlers to parent via ref
  useImperativeHandle(ref, () => ({
    openRestoreDialog: openPbsRestoreDialog,
    openFileRestore: openPbsFileRestore,
  }), [openPbsRestoreDialog, openPbsFileRestore])

  // Recharger les données RRD PBS/Datastore quand le timeframe change
  useEffect(() => {
    let alive = true

    async function reloadPbsRrd() {
      if (!selection) return

      // Pour un serveur PBS
      if (selection.type === 'pbs') {
        try {
          const rrdR = await fetch(`/api/v1/pbs/${encodeURIComponent(selection.id)}/rrd?timeframe=${pbsTimeframe}`, { cache: 'no-store' })
          if (rrdR.ok && alive) {
            const json = await rrdR.json()
            setPbsRrdData(json?.data || [])
          }
        } catch (e) {
          console.error('Error loading PBS RRD:', e)
        }
      }

      // Pour un datastore
      if (selection.type === 'datastore') {
        const [pbsId, datastoreName] = selection.id.split(':')
        try {
          const rrdR = await fetch(
            `/api/v1/pbs/${encodeURIComponent(pbsId)}/datastores/${encodeURIComponent(datastoreName)}/rrd?timeframe=${pbsTimeframe}`,
            { cache: 'no-store' }
          )
          if (rrdR.ok && alive) {
            const json = await rrdR.json()
            setDatastoreRrdData(json?.data || [])
          }
        } catch (e) {
          console.error('Error loading Datastore RRD:', e)
        }
      }
    }

    reloadPbsRrd()

    return () => {
      alive = false
    }
  }, [selection?.type, selection?.id, pbsTimeframe])

  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */

  return (
    <>
      {/* Affichage PBS Server - Datastores puis graphiques en dessous */}
      {selection?.type === 'pbs' && data?.pbsInfo && (
        <Stack spacing={2} sx={{ flex: 1 }}>
          {/* Liste des Datastores EN PREMIER */}
          <Card variant="outlined" sx={{ width: '100%', borderRadius: 2 }}>
            <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
              <Box sx={{
                px: 2,
                py: 1.5,
                borderBottom: '1px solid',
                borderColor: 'divider',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <Typography fontWeight={900} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className="ri-database-2-line" style={{ fontSize: 18, opacity: 0.7 }} />
                  Datastores ({data.pbsInfo.datastores.length})
                </Typography>
              </Box>
              <Box sx={{ maxHeight: 250, overflow: 'auto' }}>
                {data.pbsInfo.datastores.map((ds: any) => (
                  <Box
                    key={ds.name}
                    sx={{
                      px: 2,
                      py: 1.5,
                      borderBottom: '1px solid',
                      borderColor: 'divider',
                      '&:last-child': { borderBottom: 'none' },
                      '&:hover': { bgcolor: 'action.hover' },
                      cursor: 'pointer'
                    }}
                    onClick={() => {
                      onSelect?.({ type: 'datastore', id: `${selection.id}:${ds.name}` })
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <i className="ri-hard-drive-2-line" style={{ fontSize: 16, opacity: 0.7 }} />
                        <Typography variant="body2" fontWeight={600}>{ds.name}</Typography>
                        {ds.comment && (
                          <Typography variant="caption" sx={{ opacity: 0.5 }}>({ds.comment})</Typography>
                        )}
                      </Box>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box sx={{ flex: 1, height: 14, bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.12)', borderRadius: 0, overflow: 'hidden' }}>
                        <Box
                          sx={{
                            width: `${ds.usagePercent || 0}%`,
                            height: '100%',
                            background: 'linear-gradient(90deg, #22c55e 0%, #eab308 50%, #ef4444 100%)',
                            backgroundSize: (ds.usagePercent || 0) > 0 ? `${(100 / (ds.usagePercent || 1)) * 100}% 100%` : '100% 100%',
                            transition: 'width 0.3s ease'
                          }}
                        />
                      </Box>
                      <Typography variant="caption" sx={{ opacity: 0.6, minWidth: 50 }}>
                        {ds.usagePercent || 0}%
                      </Typography>
                      <Typography variant="caption" sx={{ opacity: 0.5, minWidth: 140, textAlign: 'right' }}>
                        {ds.usedFormatted || formatBytes(ds.used || 0)} / {ds.totalFormatted || formatBytes(ds.total || 0)}
                      </Typography>
                    </Box>
                  </Box>
                ))}
              </Box>
            </CardContent>
          </Card>

          {/* 6 Graphiques PBS Server comme dans Proxmox - EN DESSOUS des Datastores */}
          {(() => {
            const rrdDataToUse = pbsRrdData.length > 0 ? pbsRrdData : (data.pbsInfo?.rrdData || [])
            return rrdDataToUse.length > 0 && (
            <Card variant="outlined" sx={{ width: '100%', borderRadius: 2 }}>
              <CardContent sx={{ p: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                  <Typography fontWeight={900} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <i className="ri-line-chart-line" style={{ fontSize: 18 }} />
                    Server Statistics
                  </Typography>
                  {/* Sélecteur de timeframe */}
                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                    {[
                      { value: 'hour', label: '1h' },
                      { value: 'day', label: '24h' },
                      { value: 'week', label: t('inventory.pbsTimeWeek') },
                      { value: 'month', label: t('inventory.pbsTimeMonth') },
                      { value: 'year', label: t('inventory.pbsTimeYear') },
                    ].map(opt => (
                      <Chip
                        key={opt.value}
                        label={opt.label}
                        size="small"
                        onClick={() => setPbsTimeframe(opt.value as any)}
                        sx={{
                          height: 24,
                          fontSize: 11,
                          fontWeight: 600,
                          bgcolor: pbsTimeframe === opt.value ? 'primary.main' : 'action.hover',
                          color: pbsTimeframe === opt.value ? 'primary.contrastText' : 'text.secondary',
                          '&:hover': { bgcolor: pbsTimeframe === opt.value ? 'primary.dark' : 'action.selected' },
                          cursor: 'pointer',
                        }}
                      />
                    ))}
                  </Box>
                </Box>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr', lg: '1fr 1fr 1fr' }, gap: 2 }}>
                  {/* 1. CPU Usage */}
                  <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                    <Typography variant="caption" fontWeight={600} sx={{ mb: 1, display: 'block' }}>
                      CPU Usage
                    </Typography>
                    <Box sx={{ height: 160 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={rrdDataToUse}>
                          <XAxis dataKey="time" tickFormatter={v => new Date(v * 1000).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })} minTickGap={40} tick={{ fontSize: 9 }} />
                          <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 9 }} width={30} />
                          <Tooltip
                            wrapperStyle={{ backgroundColor: 'transparent', boxShadow: 'none' }}
                            content={({ active, payload, label }) => {
                              if (!active || !payload?.length) return null
                              return (
                                <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11, minWidth: 180 }}>
                                  <Box sx={{ px: 1.5, py: 0.75, bgcolor: alpha('#2196f3', 0.1), borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                    <i className="ri-cpu-line" style={{ fontSize: 13, color: '#2196f3' }} />
                                    <Typography variant="caption" sx={{ fontWeight: 700, color: '#2196f3' }}>CPU</Typography>
                                    <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6 }}>{new Date(Number(label) * 1000).toLocaleTimeString()}</Typography>
                                  </Box>
                                  <Box sx={{ px: 1.5, py: 0.75 }}>
                                    {payload.map(entry => (
                                      <Box key={entry.dataKey} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
                                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                                        <Typography variant="caption" sx={{ flex: 1 }}>{entry.name === 'cpu' ? 'CPU' : 'IO Wait'}</Typography>
                                        <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>{Number(entry.value).toFixed(1)}%</Typography>
                                      </Box>
                                    ))}
                                  </Box>
                                </Box>
                              )
                            }}
                          />
                          <Area type="monotone" dataKey="cpu" stroke={primaryColor} fill={primaryColor} fillOpacity={0.4} strokeWidth={1.5} isAnimationActive={false} name="cpu" />
                          <Area type="monotone" dataKey="iowait" stroke={primaryColorLight} fill={primaryColorLight} fillOpacity={0.3} strokeWidth={1} isAnimationActive={false} name="iowait" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </Box>
                  </Box>

                  {/* 2. Server Load */}
                  <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                    <Typography variant="caption" fontWeight={600} sx={{ mb: 1, display: 'block' }}>
                      Server Load
                    </Typography>
                    <Box sx={{ height: 160 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={rrdDataToUse}>
                          <XAxis dataKey="time" tickFormatter={v => new Date(v * 1000).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })} minTickGap={40} tick={{ fontSize: 9 }} />
                          <YAxis tick={{ fontSize: 9 }} width={30} />
                          <Tooltip
                            wrapperStyle={{ backgroundColor: 'transparent', boxShadow: 'none' }}
                            content={({ active, payload, label }) => {
                              if (!active || !payload?.length) return null
                              return (
                                <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11, minWidth: 180 }}>
                                  <Box sx={{ px: 1.5, py: 0.75, bgcolor: alpha('#f59e0b', 0.1), borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                    <i className="ri-bar-chart-line" style={{ fontSize: 13, color: '#f59e0b' }} />
                                    <Typography variant="caption" sx={{ fontWeight: 700, color: '#f59e0b' }}>Server Load</Typography>
                                    <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6 }}>{new Date(Number(label) * 1000).toLocaleTimeString()}</Typography>
                                  </Box>
                                  <Box sx={{ px: 1.5, py: 0.75 }}>
                                    {payload.map(entry => (
                                      <Box key={entry.dataKey} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
                                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                                        <Typography variant="caption" sx={{ flex: 1 }}>Load Average</Typography>
                                        <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>{Number(entry.value).toFixed(2)}</Typography>
                                      </Box>
                                    ))}
                                  </Box>
                                </Box>
                              )
                            }}
                          />
                          <Area type="monotone" dataKey="loadavg" stroke={primaryColor} fill={primaryColor} fillOpacity={0.4} strokeWidth={1.5} isAnimationActive={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </Box>
                  </Box>

                  {/* 3. Memory Usage */}
                  <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                    <Typography variant="caption" fontWeight={600} sx={{ mb: 1, display: 'block' }}>
                      Memory Usage
                    </Typography>
                    <Box sx={{ height: 160 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={rrdDataToUse}>
                          <XAxis dataKey="time" tickFormatter={v => new Date(v * 1000).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })} minTickGap={40} tick={{ fontSize: 9 }} />
                          <YAxis tickFormatter={v => formatBytes(v)} tick={{ fontSize: 9 }} width={45} />
                          <Tooltip
                            wrapperStyle={{ backgroundColor: 'transparent', boxShadow: 'none' }}
                            content={({ active, payload, label }) => {
                              if (!active || !payload?.length) return null
                              return (
                                <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11, minWidth: 180 }}>
                                  <Box sx={{ px: 1.5, py: 0.75, bgcolor: alpha('#10b981', 0.1), borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                    <i className="ri-ram-line" style={{ fontSize: 13, color: '#10b981' }} />
                                    <Typography variant="caption" sx={{ fontWeight: 700, color: '#10b981' }}>Memory</Typography>
                                    <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6 }}>{new Date(Number(label) * 1000).toLocaleTimeString()}</Typography>
                                  </Box>
                                  <Box sx={{ px: 1.5, py: 0.75 }}>
                                    {payload.map(entry => (
                                      <Box key={entry.dataKey} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
                                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                                        <Typography variant="caption" sx={{ flex: 1 }}>{entry.name === 'memused' ? 'Usage' : 'Total'}</Typography>
                                        <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>{formatBytes(Number(entry.value))}</Typography>
                                      </Box>
                                    ))}
                                  </Box>
                                </Box>
                              )
                            }}
                          />
                          <Area type="monotone" dataKey="memtotal" stroke={primaryColor} fill={primaryColor} fillOpacity={0.2} strokeWidth={1} isAnimationActive={false} name="memtotal" />
                          <Area type="monotone" dataKey="memused" stroke={primaryColor} fill={primaryColor} fillOpacity={0.5} strokeWidth={1.5} isAnimationActive={false} name="memused" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </Box>
                  </Box>

                  {/* 4. Swap Usage */}
                  <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                    <Typography variant="caption" fontWeight={600} sx={{ mb: 1, display: 'block' }}>
                      Swap Usage
                    </Typography>
                    <Box sx={{ height: 160 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={rrdDataToUse}>
                          <XAxis dataKey="time" tickFormatter={v => new Date(v * 1000).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })} minTickGap={40} tick={{ fontSize: 9 }} />
                          <YAxis tickFormatter={v => formatBytes(v)} tick={{ fontSize: 9 }} width={45} />
                          <Tooltip
                            wrapperStyle={{ backgroundColor: 'transparent', boxShadow: 'none' }}
                            content={({ active, payload, label }) => {
                              if (!active || !payload?.length) return null
                              return (
                                <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11, minWidth: 180 }}>
                                  <Box sx={{ px: 1.5, py: 0.75, bgcolor: alpha('#8b5cf6', 0.1), borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                    <i className="ri-swap-line" style={{ fontSize: 13, color: '#8b5cf6' }} />
                                    <Typography variant="caption" sx={{ fontWeight: 700, color: '#8b5cf6' }}>Swap</Typography>
                                    <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6 }}>{new Date(Number(label) * 1000).toLocaleTimeString()}</Typography>
                                  </Box>
                                  <Box sx={{ px: 1.5, py: 0.75 }}>
                                    {payload.map(entry => (
                                      <Box key={entry.dataKey} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
                                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                                        <Typography variant="caption" sx={{ flex: 1 }}>{entry.name === 'swapused' ? 'Usage' : 'Total'}</Typography>
                                        <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>{formatBytes(Number(entry.value))}</Typography>
                                      </Box>
                                    ))}
                                  </Box>
                                </Box>
                              )
                            }}
                          />
                          <Area type="monotone" dataKey="swaptotal" stroke={primaryColor} fill={primaryColor} fillOpacity={0.2} strokeWidth={1} isAnimationActive={false} name="swaptotal" />
                          <Area type="monotone" dataKey="swapused" stroke={primaryColor} fill={primaryColor} fillOpacity={0.5} strokeWidth={1.5} isAnimationActive={false} name="swapused" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </Box>
                  </Box>

                  {/* 5. Network Traffic */}
                  <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                    <Typography variant="caption" fontWeight={600} sx={{ mb: 1, display: 'block' }}>
                      Network Traffic
                    </Typography>
                    <Box sx={{ height: 160 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={rrdDataToUse}>
                          <XAxis dataKey="time" tickFormatter={v => new Date(v * 1000).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })} minTickGap={40} tick={{ fontSize: 9 }} />
                          <YAxis tickFormatter={v => formatBytes(v) + '/s'} tick={{ fontSize: 9 }} width={55} />
                          <Tooltip
                            wrapperStyle={{ backgroundColor: 'transparent', boxShadow: 'none' }}
                            content={({ active, payload, label }) => {
                              if (!active || !payload?.length) return null
                              return (
                                <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11, minWidth: 180 }}>
                                  <Box sx={{ px: 1.5, py: 0.75, bgcolor: alpha('#06b6d4', 0.1), borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                    <i className="ri-exchange-line" style={{ fontSize: 13, color: '#06b6d4' }} />
                                    <Typography variant="caption" sx={{ fontWeight: 700, color: '#06b6d4' }}>Network</Typography>
                                    <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6 }}>{new Date(Number(label) * 1000).toLocaleTimeString()}</Typography>
                                  </Box>
                                  <Box sx={{ px: 1.5, py: 0.75 }}>
                                    {payload.map(entry => (
                                      <Box key={entry.dataKey} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
                                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                                        <Typography variant="caption" sx={{ flex: 1 }}>{entry.name === 'netin' ? 'In' : 'Out'}</Typography>
                                        <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>{formatBytes(Number(entry.value))}/s</Typography>
                                      </Box>
                                    ))}
                                  </Box>
                                </Box>
                              )
                            }}
                          />
                          <Area type="monotone" dataKey="netin" stroke={primaryColor} fill={primaryColor} fillOpacity={0.4} strokeWidth={1.5} isAnimationActive={false} name="netin" />
                          <Area type="monotone" dataKey="netout" stroke={primaryColorLight} fill={primaryColorLight} fillOpacity={0.3} strokeWidth={1} isAnimationActive={false} name="netout" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </Box>
                  </Box>

                  {/* 6. Root Disk Usage */}
                  <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                    <Typography variant="caption" fontWeight={600} sx={{ mb: 1, display: 'block' }}>
                      Root Disk Usage
                    </Typography>
                    <Box sx={{ height: 160 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={rrdDataToUse}>
                          <XAxis dataKey="time" tickFormatter={v => new Date(v * 1000).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })} minTickGap={40} tick={{ fontSize: 9 }} />
                          <YAxis tickFormatter={v => formatBytes(v)} tick={{ fontSize: 9 }} width={45} />
                          <Tooltip
                            wrapperStyle={{ backgroundColor: 'transparent', boxShadow: 'none' }}
                            content={({ active, payload, label }) => {
                              if (!active || !payload?.length) return null
                              return (
                                <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11, minWidth: 180 }}>
                                  <Box sx={{ px: 1.5, py: 0.75, bgcolor: alpha('#ef4444', 0.1), borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                    <i className="ri-hard-drive-2-line" style={{ fontSize: 13, color: '#ef4444' }} />
                                    <Typography variant="caption" sx={{ fontWeight: 700, color: '#ef4444' }}>Root Disk</Typography>
                                    <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6 }}>{new Date(Number(label) * 1000).toLocaleTimeString()}</Typography>
                                  </Box>
                                  <Box sx={{ px: 1.5, py: 0.75 }}>
                                    {payload.map(entry => (
                                      <Box key={entry.dataKey} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
                                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                                        <Typography variant="caption" sx={{ flex: 1 }}>{entry.name === 'rootused' ? 'Usage' : 'Total'}</Typography>
                                        <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>{formatBytes(Number(entry.value))}</Typography>
                                      </Box>
                                    ))}
                                  </Box>
                                </Box>
                              )
                            }}
                          />
                          <Area type="monotone" dataKey="roottotal" stroke={primaryColor} fill={primaryColor} fillOpacity={0.2} strokeWidth={1} isAnimationActive={false} name="roottotal" />
                          <Area type="monotone" dataKey="rootused" stroke={primaryColor} fill={primaryColor} fillOpacity={0.5} strokeWidth={1.5} isAnimationActive={false} name="rootused" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </Box>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          )
          })()}
        </Stack>
      )}

      {/* Affichage Datastore - Onglets Summary / Backups */}
      {selection?.type === 'datastore' && data?.datastoreInfo && (
        <Card variant="outlined" sx={{ width: '100%', borderRadius: 2, display: 'flex', flexDirection: 'column' }}>
          <Tabs
            value={pbsTab}
            onChange={(_, v) => setPbsTab(v)}
            sx={{
              borderBottom: '1px solid',
              borderColor: 'divider',
              minHeight: 40,
              flexShrink: 0,
              '& .MuiTab-root': { minHeight: 40, py: 0 }
            }}
          >
            <Tab
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <i className="ri-pie-chart-line" style={{ fontSize: 16 }} />
                  {t('inventory.pbsSummary')}
                </Box>
              }
            />
            <Tab
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <i className="ri-archive-line" style={{ fontSize: 16 }} />
                  {t('pbs.backups')}
                  <Chip size="small" label={data.datastoreInfo.stats?.total || 0} sx={{ height: 18, fontSize: 10 }} />
                </Box>
              }
            />
          </Tabs>

          <CardContent sx={{ p: 0, '&:last-child': { pb: 0 }, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'auto' }}>
            {/* Onglet Summary avec graphiques */}
            {pbsTab === 0 && (
              <Box sx={{ p: 2, flex: 1, overflow: 'auto' }}>
                <Stack spacing={3}>
                  {/* Stats en haut */}
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 2 }}>
                    <Box sx={{ textAlign: 'center', p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                      <Typography variant="h4" fontWeight={700} color="primary.main">
                        {data.datastoreInfo.stats?.vmCount || 0}
                      </Typography>
                      <Typography variant="caption" sx={{ opacity: 0.7 }}>{t('inventory.pbsVms')}</Typography>
                    </Box>
                    <Box sx={{ textAlign: 'center', p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                      <Typography variant="h4" fontWeight={700} color="secondary.main">
                        {data.datastoreInfo.stats?.ctCount || 0}
                      </Typography>
                      <Typography variant="caption" sx={{ opacity: 0.7 }}>{t('inventory.pbsContainers')}</Typography>
                    </Box>
                    <Box sx={{ textAlign: 'center', p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                      <Typography variant="h4" fontWeight={700}>
                        {data.datastoreInfo.stats?.total || 0}
                      </Typography>
                      <Typography variant="caption" sx={{ opacity: 0.7 }}>{t('inventory.pbsTotalSnapshots')}</Typography>
                    </Box>
                    <Box sx={{ textAlign: 'center', p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                      <Typography variant="h4" fontWeight={700} color="success.main">
                        {data.datastoreInfo.stats?.verifiedCount || 0}
                      </Typography>
                      <Typography variant="caption" sx={{ opacity: 0.7 }}>{t('inventory.pbsVerified')}</Typography>
                    </Box>
                  </Box>

                  {/* Graphique de stockage style Proxmox */}
                  <Box sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                    <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                      <i className="ri-hard-drive-2-line" style={{ fontSize: 18 }} />
                      {t('inventory.pbsStorageUsage')}
                    </Typography>

                    {/* Progress bar large style Proxmox */}
                    <Box sx={{ position: 'relative', height: 40, bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.12)', borderRadius: 0, overflow: 'hidden', mb: 2 }}>
                      <Box
                        sx={{
                          position: 'absolute',
                          left: 0,
                          top: 0,
                          bottom: 0,
                          width: `${data.datastoreInfo.usagePercent || 0}%`,
                          background: 'linear-gradient(90deg, #22c55e 0%, #eab308 50%, #ef4444 100%)',
                          backgroundSize: (data.datastoreInfo.usagePercent || 0) > 0 ? `${(100 / (data.datastoreInfo.usagePercent || 1)) * 100}% 100%` : '100% 100%',
                          transition: 'width 0.5s ease'
                        }}
                      />
                      <Box sx={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        color: 'white',
                        textShadow: '0 1px 2px rgba(0,0,0,0.5)'
                      }}>
                        <Typography variant="h6">
                          {data.datastoreInfo.usagePercent || 0}% ({formatBytes(data.datastoreInfo.used || 0)} / {formatBytes(data.datastoreInfo.total || 0)})
                        </Typography>
                      </Box>
                    </Box>

                    {/* Détails en dessous */}
                    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2, textAlign: 'center' }}>
                      <Box>
                        <Typography variant="body2" fontWeight={600} color="primary.main">
                          {formatBytes(data.datastoreInfo.used || 0)}
                        </Typography>
                        <Typography variant="caption" sx={{ opacity: 0.6 }}>{t('common.used')}</Typography>
                      </Box>
                      <Box>
                        <Typography variant="body2" fontWeight={600} color="success.main">
                          {formatBytes(data.datastoreInfo.available || 0)}
                        </Typography>
                        <Typography variant="caption" sx={{ opacity: 0.6 }}>{t('common.available')}</Typography>
                      </Box>
                      <Box>
                        <Typography variant="body2" fontWeight={600}>
                          {formatBytes(data.datastoreInfo.total || 0)}
                        </Typography>
                        <Typography variant="caption" sx={{ opacity: 0.6 }}>{t('common.total')}</Typography>
                      </Box>
                    </Box>
                  </Box>

                  {/* Graphiques RRD du datastore - 3 graphiques comme Proxmox */}
                  {(() => {
                    const dsRrdData = datastoreRrdData.length > 0 ? datastoreRrdData : (data.datastoreInfo?.rrdData || [])
                    return dsRrdData.length > 0 && (
                    <Box sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                        <Typography variant="subtitle2" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <i className="ri-line-chart-line" style={{ fontSize: 18 }} />
                          {t('inventory.pbsDatastoreStatistics')}
                        </Typography>
                        {/* Sélecteur de timeframe */}
                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                          {[
                            { value: 'hour', label: '1h' },
                            { value: 'day', label: '24h' },
                            { value: 'week', label: t('inventory.pbsTimeWeek') },
                            { value: 'month', label: t('inventory.pbsTimeMonth') },
                            { value: 'year', label: t('inventory.pbsTimeYear') },
                          ].map(opt => (
                            <Chip
                              key={opt.value}
                              label={opt.label}
                              size="small"
                              onClick={() => setPbsTimeframe(opt.value as any)}
                              sx={{
                                height: 22,
                                fontSize: 10,
                                fontWeight: 600,
                                bgcolor: pbsTimeframe === opt.value ? 'primary.main' : 'action.hover',
                                color: pbsTimeframe === opt.value ? 'primary.contrastText' : 'text.secondary',
                                '&:hover': { bgcolor: pbsTimeframe === opt.value ? 'primary.dark' : 'action.selected' },
                                cursor: 'pointer',
                              }}
                            />
                          ))}
                        </Box>
                      </Box>
                      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr 1fr' }, gap: 2 }}>
                        {/* 1. Storage Usage (bytes) */}
                        <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                          <Typography variant="caption" fontWeight={600} sx={{ mb: 1, display: 'block' }}>
                            {t('inventory.pbsStorageUsageBytes')}
                          </Typography>
                          <Box sx={{ height: 180 }}>
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={dsRrdData}>
                                <XAxis dataKey="time" tickFormatter={v => new Date(v * 1000).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })} minTickGap={40} tick={{ fontSize: 9 }} />
                                <YAxis tickFormatter={v => formatBytes(v)} tick={{ fontSize: 9 }} width={50} />
                                <Tooltip
                                  wrapperStyle={{ backgroundColor: 'transparent', boxShadow: 'none' }}
                                  content={({ active, payload, label }) => {
                                    if (!active || !payload?.length) return null
                                    return (
                                      <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11, minWidth: 180 }}>
                                        <Box sx={{ px: 1.5, py: 0.75, bgcolor: alpha('#3b82f6', 0.1), borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                          <i className="ri-database-2-line" style={{ fontSize: 13, color: '#3b82f6' }} />
                                          <Typography variant="caption" sx={{ fontWeight: 700, color: '#3b82f6' }}>{t('inventory.pbsStorageUsageBytes')}</Typography>
                                          <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6 }}>{new Date(Number(label) * 1000).toLocaleTimeString()}</Typography>
                                        </Box>
                                        <Box sx={{ px: 1.5, py: 0.75 }}>
                                          {payload.map(entry => (
                                            <Box key={entry.dataKey} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
                                              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                                              <Typography variant="caption" sx={{ flex: 1 }}>{entry.name === 'used' ? t('inventory.pbsStorageUsageLabel') : t('common.total')}</Typography>
                                              <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>{formatBytes(Number(entry.value))}</Typography>
                                            </Box>
                                          ))}
                                        </Box>
                                      </Box>
                                    )
                                  }}
                                />
                                <Area type="monotone" dataKey="total" stroke={primaryColor} fill={primaryColor} fillOpacity={0.2} strokeWidth={1} isAnimationActive={false} name="total" />
                                <Area type="monotone" dataKey="used" stroke={primaryColor} fill={primaryColor} fillOpacity={0.5} strokeWidth={1.5} isAnimationActive={false} name="used" />
                              </AreaChart>
                            </ResponsiveContainer>
                          </Box>
                        </Box>

                        {/* 2. Transfer Rate (bytes/second) */}
                        <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                          <Typography variant="caption" fontWeight={600} sx={{ mb: 1, display: 'block' }}>
                            {t('inventory.pbsTransferRate')}
                          </Typography>
                          <Box sx={{ height: 180 }}>
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={dsRrdData}>
                                <XAxis dataKey="time" tickFormatter={v => new Date(v * 1000).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })} minTickGap={40} tick={{ fontSize: 9 }} />
                                <YAxis tickFormatter={v => formatBytes(v) + '/s'} tick={{ fontSize: 9 }} width={55} />
                                <Tooltip
                                  wrapperStyle={{ backgroundColor: 'transparent', boxShadow: 'none' }}
                                  content={({ active, payload, label }) => {
                                    if (!active || !payload?.length) return null
                                    return (
                                      <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11, minWidth: 180 }}>
                                        <Box sx={{ px: 1.5, py: 0.75, bgcolor: alpha('#10b981', 0.1), borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                          <i className="ri-speed-line" style={{ fontSize: 13, color: '#10b981' }} />
                                          <Typography variant="caption" sx={{ fontWeight: 700, color: '#10b981' }}>{t('inventory.pbsTransferRate')}</Typography>
                                          <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6 }}>{new Date(Number(label) * 1000).toLocaleTimeString()}</Typography>
                                        </Box>
                                        <Box sx={{ px: 1.5, py: 0.75 }}>
                                          {payload.map(entry => (
                                            <Box key={entry.dataKey} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
                                              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                                              <Typography variant="caption" sx={{ flex: 1 }}>{entry.name === 'read' ? t('inventory.pbsRead') : t('inventory.pbsWrite')}</Typography>
                                              <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>{formatBytes(Number(entry.value))}/s</Typography>
                                            </Box>
                                          ))}
                                        </Box>
                                      </Box>
                                    )
                                  }}
                                />
                                <Area type="monotone" dataKey="read" stroke={primaryColor} fill={primaryColor} fillOpacity={0.4} strokeWidth={1.5} isAnimationActive={false} name="read" />
                                <Area type="monotone" dataKey="write" stroke={primaryColorLight} fill={primaryColorLight} fillOpacity={0.3} strokeWidth={1} isAnimationActive={false} name="write" />
                              </AreaChart>
                            </ResponsiveContainer>
                          </Box>
                        </Box>

                        {/* 3. Input/Output Operations per Second (IOPS) */}
                        <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                          <Typography variant="caption" fontWeight={600} sx={{ mb: 1, display: 'block' }}>
                            {t('inventory.pbsIops')}
                          </Typography>
                          <Box sx={{ height: 180 }}>
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={dsRrdData}>
                                <XAxis dataKey="time" tickFormatter={v => new Date(v * 1000).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })} minTickGap={40} tick={{ fontSize: 9 }} />
                                <YAxis tick={{ fontSize: 9 }} width={40} />
                                <Tooltip
                                  wrapperStyle={{ backgroundColor: 'transparent', boxShadow: 'none' }}
                                  content={({ active, payload, label }) => {
                                    if (!active || !payload?.length) return null
                                    return (
                                      <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11, minWidth: 180 }}>
                                        <Box sx={{ px: 1.5, py: 0.75, bgcolor: alpha('#f59e0b', 0.1), borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                          <i className="ri-dashboard-3-line" style={{ fontSize: 13, color: '#f59e0b' }} />
                                          <Typography variant="caption" sx={{ fontWeight: 700, color: '#f59e0b' }}>{t('inventory.pbsIops')}</Typography>
                                          <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6 }}>{new Date(Number(label) * 1000).toLocaleTimeString()}</Typography>
                                        </Box>
                                        <Box sx={{ px: 1.5, py: 0.75 }}>
                                          {payload.map(entry => (
                                            <Box key={entry.dataKey} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
                                              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                                              <Typography variant="caption" sx={{ flex: 1 }}>{entry.name === 'readIops' ? t('inventory.pbsRead') : t('inventory.pbsWrite')}</Typography>
                                              <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>{Number(entry.value).toFixed(0)}</Typography>
                                            </Box>
                                          ))}
                                        </Box>
                                      </Box>
                                    )
                                  }}
                                />
                                <Area type="monotone" dataKey="readIops" stroke={primaryColor} fill={primaryColor} fillOpacity={0.4} strokeWidth={1.5} isAnimationActive={false} name="readIops" />
                                <Area type="monotone" dataKey="writeIops" stroke={primaryColorLight} fill={primaryColorLight} fillOpacity={0.3} strokeWidth={1} isAnimationActive={false} name="writeIops" />
                              </AreaChart>
                            </ResponsiveContainer>
                          </Box>
                        </Box>
                      </Box>
                    </Box>
                  )
                  })()}

                  {/* Informations complémentaires */}
                  <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                    {/* GC Status */}
                    <Box sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                        <i className="ri-recycle-line" style={{ fontSize: 18 }} />
                        {t('inventory.pbsGarbageCollection')}
                      </Typography>
                      {data.datastoreInfo.gcStatus ? (
                        <Stack spacing={0.5}>
                          <Typography variant="caption">
                            <strong>{t('common.status')}:</strong> {data.datastoreInfo.gcStatus?.upid ? t('inventory.pbsCompleted') : t('inventory.pbsNotAvailable')}
                          </Typography>
                        </Stack>
                      ) : (
                        <Typography variant="caption" sx={{ opacity: 0.5 }}>{t('inventory.pbsNoGcData')}</Typography>
                      )}
                    </Box>

                    {/* Verify Status */}
                    <Box sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                        <i className="ri-checkbox-circle-line" style={{ fontSize: 18 }} />
                        {t('inventory.pbsVerification')}
                      </Typography>
                      <Stack spacing={0.5}>
                        <Typography variant="caption">
                          <strong>{t('inventory.pbsVerified')}:</strong> {data.datastoreInfo.stats?.verifiedCount || 0} / {data.datastoreInfo.stats?.total || 0}
                        </Typography>
                      </Stack>
                    </Box>
                  </Box>

                  {/* Path info */}
                  {data.datastoreInfo.path && (
                    <Box sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
                      <Typography variant="caption" sx={{ opacity: 0.6 }}>
                        <i className="ri-folder-line" style={{ marginRight: 6 }} />
                        {t('inventory.pbsPath')} <code style={{ opacity: 1 }}>{data.datastoreInfo.path}</code>
                      </Typography>
                    </Box>
                  )}
                </Stack>
              </Box>
            )}

            {/* Onglet Backups - Groupés par ID avec recherche */}
            {pbsTab === 1 && (
              <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                {/* Barre de recherche */}
                <Box sx={{ p: 1.5, borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0 }}>
                  <TextField
                    size="small"
                    fullWidth
                    placeholder={t('common.search') + '...'}
                    value={pbsBackupSearch}
                    onChange={(e) => { setPbsBackupSearch(e.target.value); setPbsBackupPage(0) }}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <i className="ri-search-line" style={{ fontSize: 18, opacity: 0.5 }} />
                        </InputAdornment>
                      ),
                      endAdornment: pbsBackupSearch && (
                        <InputAdornment position="end">
                          <IconButton size="small" onClick={() => setPbsBackupSearch('')}>
                            <i className="ri-close-line" style={{ fontSize: 16 }} />
                          </IconButton>
                        </InputAdornment>
                      ),
                    }}
                    sx={{ '& .MuiOutlinedInput-root': { bgcolor: 'background.paper' } }}
                  />
                </Box>

                {/* Liste des backups groupés */}
                {(() => {
                  // Grouper les backups par backupId
                  const backupGroups = new Map<string, any[]>()

                  for (const backup of (data.datastoreInfo.backups || [])) {
                    const groupKey = backup.backupId
                    if (!backupGroups.has(groupKey)) {
                      backupGroups.set(groupKey, [])
                    }
                    backupGroups.get(groupKey)!.push(backup)
                  }

                  // Trier chaque groupe par date (plus récent en premier)
                  for (const [, group] of backupGroups) {
                    group.sort((a: any, b: any) => b.backupTime - a.backupTime)
                  }

                  // Convertir en array et trier les groupes par date du backup le plus récent
                  let sortedGroups = Array.from(backupGroups.entries())
                    .sort((a, b) => (b[1][0]?.backupTime || 0) - (a[1][0]?.backupTime || 0))

                  // Filtrer par recherche
                  if (pbsBackupSearch.trim()) {
                    const search = pbsBackupSearch.toLowerCase()
                    sortedGroups = sortedGroups.filter(([groupId, groupBackups]) => {
                      const latestBackup = groupBackups[0]
                      return groupId.toLowerCase().includes(search) ||
                             (latestBackup?.vmName || '').toLowerCase().includes(search) ||
                             (latestBackup?.backupType || '').toLowerCase().includes(search)
                    })
                  }

                  const pbsGroupPageSize = 25
                  const pbsGroupTotalPages = Math.max(1, Math.ceil(sortedGroups.length / pbsGroupPageSize))
                  const pbsGroupCurrentPage = Math.min(pbsBackupPage, pbsGroupTotalPages - 1)
                  const paginatedGroups = sortedGroups.slice(pbsGroupCurrentPage * pbsGroupPageSize, (pbsGroupCurrentPage + 1) * pbsGroupPageSize)

                  return (
                    <>
                      <Box sx={{ overflow: 'auto', minHeight: 0, maxHeight: 'calc(100vh - 330px)' }}>
                        {sortedGroups.length === 0 ? (
                          <Box sx={{ p: 4, textAlign: 'center' }}>
                            <i className="ri-inbox-line" style={{ fontSize: 48, opacity: 0.3 }} />
                            <Typography variant="body2" sx={{ opacity: 0.5, mt: 1 }}>
                              {pbsBackupSearch ? t('common.noResults') : t('inventory.pbsNoBackupsFound')}
                            </Typography>
                          </Box>
                        ) : paginatedGroups.map(([groupId, groupBackups]) => {
                      const latestBackup = groupBackups[0]
                      const isExpanded = expandedBackupGroups.has(groupId)
                      const totalSize = groupBackups.reduce((sum: number, b: any) => sum + (b.size || 0), 0)
                      const verifiedCount = groupBackups.filter((b: any) => b.verified).length
                      const backupType = latestBackup.backupType || 'vm'
                      const isVm = backupType === 'vm'
                      const isCt = backupType === 'ct'

                      return (
                        <Box key={groupId}>
                          {/* Header du groupe */}
                          <Box
                            onClick={() => {
                              setExpandedBackupGroups(prev => {
                                const next = new Set(prev)
                                if (next.has(groupId)) next.delete(groupId)
                                else next.add(groupId)
                                return next
                              })
                            }}
                            sx={{
                              display: 'flex', alignItems: 'center', gap: 1,
                              px: 1.5, py: 0.4,
                              borderBottom: '1px solid', borderColor: 'divider',
                              cursor: 'pointer',
                              '&:hover': { bgcolor: 'action.hover' },
                              bgcolor: isExpanded ? 'action.selected' : 'transparent'
                            }}
                          >
                            <i className={isExpanded ? 'ri-subtract-line' : 'ri-add-line'} style={{ fontSize: 16, opacity: 0.5 }} />
                            <i
                              className={isVm ? 'ri-computer-line' : isCt ? 'ri-instance-line' : 'ri-server-line'}
                              style={{ fontSize: 14, color: isVm ? '#ff9800' : isCt ? '#9c27b0' : '#757575' }}
                            />
                            <Typography variant="body2" fontWeight={600} noWrap sx={{ fontSize: 11, flex: 1, minWidth: 0 }}>
                              {latestBackup.vmName || groupId} <Typography component="span" sx={{ opacity: 0.4, fontSize: 9 }}>({groupId})</Typography>
                            </Typography>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Typography variant="caption" sx={{ opacity: 0.7, fontSize: 11 }}>
                                {groupBackups.length} snapshot{groupBackups.length > 1 ? 's' : ''}
                              </Typography>
                              <Typography variant="caption" sx={{ opacity: 0.6, minWidth: 60, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 10 }}>
                                {formatBytes(totalSize)}
                              </Typography>
                              {verifiedCount === groupBackups.length ? (
                                <MuiTooltip title={t('inventory.pbsAllVerified')}>
                                  <i className="ri-checkbox-circle-fill" style={{ fontSize: 16, color: '#4caf50' }} />
                                </MuiTooltip>
                              ) : verifiedCount > 0 ? (
                                <MuiTooltip title={t('inventory.pbsPartiallyVerified', { count: verifiedCount, total: groupBackups.length })}>
                                  <i className="ri-checkbox-circle-line" style={{ fontSize: 16, color: '#ff9800' }} />
                                </MuiTooltip>
                              ) : (
                                <MuiTooltip title={t('inventory.pbsNotVerified')}>
                                  <i className="ri-checkbox-blank-circle-line" style={{ fontSize: 16, opacity: 0.3 }} />
                                </MuiTooltip>
                              )}
                            </Box>
                          </Box>

                          {/* Expanded snapshots */}
                          {isExpanded && (
                            <Box sx={{ bgcolor: 'action.hover' }}>
                              {/* Column headers */}
                              <Box sx={{
                                display: 'grid',
                                gridTemplateColumns: '1fr 80px 30px 80px 30px',
                                gap: 0.25, px: 1.5, pl: 5, py: 0.3,
                                borderBottom: '1px solid', borderColor: 'divider',
                                bgcolor: 'background.paper'
                              }}>
                                <Typography variant="caption" fontWeight={600} sx={{ opacity: 0.6, fontSize: 10 }}>{t('inventory.pbsDateTime')}</Typography>
                                <Typography variant="caption" fontWeight={600} sx={{ opacity: 0.6, fontSize: 10 }}>{t('inventory.pbsSize')}</Typography>
                                <Typography variant="caption" fontWeight={600} sx={{ opacity: 0.6, fontSize: 10, textAlign: 'center' }}><i className="ri-lock-line" style={{ fontSize: 10 }} /></Typography>
                                <Typography variant="caption" fontWeight={600} sx={{ opacity: 0.6, fontSize: 10, textAlign: 'center' }}>{t('common.actions')}</Typography>
                                <Typography variant="caption" fontWeight={600} sx={{ opacity: 0.6, fontSize: 10, textAlign: 'center' }}><i className="ri-checkbox-circle-line" style={{ fontSize: 10 }} /></Typography>
                              </Box>
                              {groupBackups.map((backup: any, idx: number) => (
                                <Box
                                  key={backup.id || idx}
                                  sx={{
                                    display: 'grid',
                                    gridTemplateColumns: '1fr 80px 30px 80px 30px',
                                    gap: 0.25, px: 1.5, pl: 5, py: 0.15,
                                    borderBottom: idx < groupBackups.length - 1 ? '1px solid' : 'none',
                                    borderColor: 'divider',
                                    alignItems: 'center',
                                    '&:hover': { bgcolor: 'action.focus' },
                                    minHeight: 24,
                                  }}
                                >
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                    <i className="ri-time-line" style={{ fontSize: 12, opacity: 0.5 }} />
                                    <Typography variant="body2" noWrap sx={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>
                                      {backup.backupTimeFormatted}
                                    </Typography>
                                  </Box>
                                  <Typography variant="body2" sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, opacity: 0.7 }}>
                                    {backup.sizeFormatted}
                                  </Typography>
                                  <Box sx={{ textAlign: 'center' }}>
                                    {backup.protected ? (
                                      <MuiTooltip title={t('pbs.protected')}>
                                        <i className="ri-lock-fill" style={{ fontSize: 12, color: '#ff9800' }} />
                                      </MuiTooltip>
                                    ) : (
                                      <i className="ri-lock-unlock-line" style={{ fontSize: 12, opacity: 0.15 }} />
                                    )}
                                  </Box>
                                  <Box sx={{ display: 'flex', justifyContent: 'center', gap: 0 }}>
                                    <MuiTooltip title={backup.backupType === 'ct' ? t('inventory.pbsRestoreCt') : t('inventory.pbsRestoreVm')}>
                                      <IconButton size="small" sx={{ p: 0.15 }} onClick={() => {
                                        // Build a pseudo storageInfo-like item for the restore dialog
                                        const vmType = backup.backupType === 'ct' ? 'lxc' : 'qemu'
                                        setPbsRestoreDialog({ open: true, backup: { ...backup, format: backup.backupType === 'ct' ? 'pbs-ct' : 'pbs-vm', vmid: backup.backupId }, storageType: vmType })
                                        setPbsRestoreVmId(backup.backupId || '')
                                        setPbsRestoreStorage('')
                                        setPbsRestoreBwLimit('')
                                        setPbsRestoreUnique(false)
                                        setPbsRestoreStart(false)
                                        setPbsRestoreLive(false)
                                        setPbsRestoreOverride(false)
                                        setPbsRestoreName('')
                                        setPbsRestoreMemory('')
                                        setPbsRestoreCores('')
                                        setPbsRestoreSockets('')
                                        setPbsRestoreNode('')
                                        // Load nodes
                                        fetch('/api/v1/nodes').then(r => r.json()).then(j => setPbsRestoreNodes(j.data || [])).catch(() => {})
                                      }}>
                                        <i className="ri-inbox-unarchive-line" style={{ fontSize: 13, color: '#2196f3' }} />
                                      </IconButton>
                                    </MuiTooltip>
                                    <MuiTooltip title={t('common.delete')}>
                                      <IconButton
                                        size="small"
                                        color="error"
                                        disabled={backup.protected}
                                        sx={{ p: 0.15, opacity: 0.5, '&:hover': { opacity: 1 } }}
                                      >
                                        <i className="ri-delete-bin-line" style={{ fontSize: 13 }} />
                                      </IconButton>
                                    </MuiTooltip>
                                  </Box>
                                  <Box sx={{ textAlign: 'center' }}>
                                    {backup.verified ? (
                                      <MuiTooltip title={t('pbs.verified')}>
                                        <i className="ri-checkbox-circle-fill" style={{ fontSize: 12, color: '#4caf50' }} />
                                      </MuiTooltip>
                                    ) : (
                                      <i className="ri-checkbox-blank-circle-line" style={{ fontSize: 12, opacity: 0.15 }} />
                                    )}
                                  </Box>
                                </Box>
                              ))}
                            </Box>
                          )}
                        </Box>
                      )
                    })}
                      </Box>
                      {pbsGroupTotalPages > 1 && (
                        <Box sx={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          px: 1.5, py: 0.5, borderTop: '1px solid', borderColor: 'divider',
                          bgcolor: 'action.hover', flexShrink: 0,
                        }}>
                          <Typography variant="caption" sx={{ opacity: 0.5, fontSize: 10 }}>
                            {pbsGroupCurrentPage * pbsGroupPageSize + 1}-{Math.min((pbsGroupCurrentPage + 1) * pbsGroupPageSize, sortedGroups.length)} / {sortedGroups.length}
                          </Typography>
                          <Box sx={{ display: 'flex', gap: 0.5 }}>
                            <IconButton size="small" disabled={pbsGroupCurrentPage === 0} onClick={() => setPbsBackupPage(0)} sx={{ p: 0.25 }}>
                              <i className="ri-skip-back-line" style={{ fontSize: 14 }} />
                            </IconButton>
                            <IconButton size="small" disabled={pbsGroupCurrentPage === 0} onClick={() => setPbsBackupPage(p => Math.max(0, p - 1))} sx={{ p: 0.25 }}>
                              <i className="ri-arrow-left-s-line" style={{ fontSize: 14 }} />
                            </IconButton>
                            <Typography variant="caption" sx={{ opacity: 0.7, display: 'flex', alignItems: 'center', px: 0.5, fontSize: 10 }}>
                              {pbsGroupCurrentPage + 1} / {pbsGroupTotalPages}
                            </Typography>
                            <IconButton size="small" disabled={pbsGroupCurrentPage >= pbsGroupTotalPages - 1} onClick={() => setPbsBackupPage(p => Math.min(pbsGroupTotalPages - 1, p + 1))} sx={{ p: 0.25 }}>
                              <i className="ri-arrow-right-s-line" style={{ fontSize: 14 }} />
                            </IconButton>
                            <IconButton size="small" disabled={pbsGroupCurrentPage >= pbsGroupTotalPages - 1} onClick={() => setPbsBackupPage(pbsGroupTotalPages - 1)} sx={{ p: 0.25 }}>
                              <i className="ri-skip-forward-line" style={{ fontSize: 14 }} />
                            </IconButton>
                          </Box>
                        </Box>
                      )}
                    </>
                  )
                })()}
              </Box>
            )}
          </CardContent>
        </Card>
      )}

      {/* PBS Restore VM/CT Dialog */}
      <Dialog open={pbsRestoreDialog.open} onClose={() => setPbsRestoreDialog({ open: false, backup: null, storageType: 'qemu' })} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 1 }}>
          <Box sx={{
            width: 36, height: 36, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center',
            bgcolor: pbsRestoreDialog.storageType === 'lxc' ? alpha('#9c27b0', 0.15) : alpha('#ff9800', 0.15),
          }}>
            <i
              className={pbsRestoreDialog.storageType === 'lxc' ? 'ri-instance-line' : 'ri-computer-line'}
              style={{ fontSize: 20, color: pbsRestoreDialog.storageType === 'lxc' ? '#9c27b0' : '#ff9800' }}
            />
          </Box>
          {t('inventory.pbsRestoreTitle', {
            type: pbsRestoreDialog.storageType === 'lxc' ? 'CT' : 'VM',
            vmid: pbsRestoreDialog.backup?.vmid || '',
          })}
        </DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {/* Source */}
            <TextField
              label={t('inventory.pbsRestoreSource')}
              value={pbsRestoreDialog.backup?.volid || ''}
              disabled
              size="small"
              fullWidth
              InputProps={{
                sx: { fontFamily: 'JetBrains Mono, monospace', fontSize: 12 },
              }}
            />

            {/* Target node */}
            <FormControl size="small" fullWidth>
              <InputLabel>Node</InputLabel>
              <Select
                value={pbsRestoreNode}
                label="Node"
                onChange={e => {
                  const node = e.target.value
                  if (data?.storageInfo) {
                    loadPbsRestoreStoragesForNode(node, data.storageInfo.connId, pbsRestoreDialog.storageType)
                  }
                }}
              >
                {pbsRestoreNodes.map((n: any) => (
                  <MenuItem key={n.node} value={n.node}>{n.node}</MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* Target storage */}
            <FormControl size="small" fullWidth>
              <InputLabel>{t('inventory.pbsRestoreStorage')}</InputLabel>
              <Select
                value={pbsRestoreStorage}
                label={t('inventory.pbsRestoreStorage')}
                onChange={e => setPbsRestoreStorage(e.target.value)}
              >
                <MenuItem value="">({t('common.default')})</MenuItem>
                {pbsRestoreStorages.map((s: any) => (
                  <MenuItem key={s.storage} value={s.storage}>{s.storage} ({formatBytes(s.avail || 0)} free)</MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* VM ID */}
            <TextField
              label={t('inventory.pbsRestoreVmId')}
              value={pbsRestoreVmId}
              onChange={e => setPbsRestoreVmId(e.target.value.replace(/\D/g, ''))}
              size="small"
              fullWidth
              type="number"
            />

            {/* Bandwidth limit */}
            <TextField
              label={t('inventory.pbsRestoreBwLimit')}
              value={pbsRestoreBwLimit}
              onChange={e => setPbsRestoreBwLimit(e.target.value.replace(/\D/g, ''))}
              size="small"
              fullWidth
              type="number"
              placeholder="0 = unlimited"
            />

            {/* Checkboxes */}
            <Box>
              <FormControlLabel
                control={<Checkbox checked={pbsRestoreUnique} onChange={e => setPbsRestoreUnique(e.target.checked)} size="small" />}
                label={<Typography variant="body2">{t('inventory.pbsRestoreUnique')}</Typography>}
              />
              <FormControlLabel
                control={<Checkbox checked={pbsRestoreStart} onChange={e => setPbsRestoreStart(e.target.checked)} size="small" />}
                label={<Typography variant="body2">{t('inventory.pbsRestoreStart')}</Typography>}
              />
              {pbsRestoreDialog.storageType !== 'lxc' && (
                <FormControlLabel
                  control={<Checkbox checked={pbsRestoreLive} onChange={e => setPbsRestoreLive(e.target.checked)} size="small" />}
                  label={<Typography variant="body2">{t('inventory.pbsRestoreLive')}</Typography>}
                />
              )}
            </Box>

            {/* Override settings */}
            <Accordion
              expanded={pbsRestoreOverride}
              onChange={(_, expanded) => setPbsRestoreOverride(expanded)}
              variant="outlined"
              sx={{ borderRadius: '8px !important', '&:before': { display: 'none' } }}
            >
              <AccordionSummary expandIcon={<i className="ri-subtract-line" style={{ fontSize: 14, opacity: 0.5 }} />}>
                <Typography variant="body2" fontWeight={600}>
                  <i className="ri-settings-3-line" style={{ marginRight: 8 }} />
                  {t('inventory.pbsRestoreOverride')}
                </Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={2}>
                  <TextField
                    label={t('inventory.pbsRestoreName')}
                    value={pbsRestoreName}
                    onChange={e => setPbsRestoreName(e.target.value)}
                    size="small"
                    fullWidth
                    placeholder={pbsRestoreDialog.backup?.notes || ''}
                  />
                  <TextField
                    label={t('inventory.pbsRestoreMemory')}
                    value={pbsRestoreMemory}
                    onChange={e => setPbsRestoreMemory(e.target.value.replace(/\D/g, ''))}
                    size="small"
                    fullWidth
                    type="number"
                  />
                  <Box sx={{ display: 'flex', gap: 2 }}>
                    <TextField
                      label={t('inventory.pbsRestoreCores')}
                      value={pbsRestoreCores}
                      onChange={e => setPbsRestoreCores(e.target.value.replace(/\D/g, ''))}
                      size="small"
                      fullWidth
                      type="number"
                    />
                    <TextField
                      label={t('inventory.pbsRestoreSockets')}
                      value={pbsRestoreSockets}
                      onChange={e => setPbsRestoreSockets(e.target.value.replace(/\D/g, ''))}
                      size="small"
                      fullWidth
                      type="number"
                    />
                  </Box>
                </Stack>
              </AccordionDetails>
            </Accordion>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setPbsRestoreDialog({ open: false, backup: null, storageType: 'qemu' })}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="contained"
            onClick={handlePbsRestore}
            disabled={pbsRestoring || !pbsRestoreVmId}
            startIcon={pbsRestoring ? <CircularProgress size={16} /> : <i className="ri-inbox-unarchive-line" />}
          >
            {pbsRestoreDialog.storageType === 'lxc' ? t('inventory.pbsRestoreCt') : t('inventory.pbsRestoreVm')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* PBS File Restore Dialog — Tree View */}
      <Dialog
        open={pbsFileRestoreDialog.open}
        onClose={() => setPbsFileRestoreDialog({ open: false, backup: null })}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 1, pr: 5 }}>
          <Box sx={{ width: 36, height: 36, borderRadius: 2, bgcolor: alpha('#ff9800', 0.15), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <i className="ri-folder-open-line" style={{ fontSize: 20, color: '#ff9800' }} />
          </Box>
          {t('inventory.pbsFileRestore')}
          <IconButton onClick={() => setPbsFileRestoreDialog({ open: false, backup: null })} sx={{ position: 'absolute', right: 8, top: 8 }}>
            <i className="ri-close-line" style={{ fontSize: 20 }} />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <Typography variant="caption" sx={{ opacity: 0.5, fontFamily: 'JetBrains Mono, monospace', display: 'block', mb: 1.5 }}>
            {pbsFileRestoreDialog.backup?.volid}
          </Typography>

          {/* Search bar */}
          {pbsFileTree.length > 0 && (
            <Box sx={{
              display: 'flex', alignItems: 'center', gap: 0.5,
              border: '1px solid', borderColor: 'divider', borderRadius: 1,
              px: 1, py: 0.5, mb: 1.5,
            }}>
              <i className="ri-search-line" style={{ fontSize: 14, opacity: 0.4 }} />
              <input
                type="text"
                value={pbsFileSearch}
                onChange={e => setPbsFileSearch(e.target.value)}
                placeholder={t('common.search') + '...'}
                style={{
                  border: 'none', outline: 'none', background: 'transparent',
                  fontSize: 12, width: '100%', color: 'inherit',
                  fontFamily: 'Inter, sans-serif',
                }}
              />
              {pbsFileSearch && (
                <i className="ri-close-line" style={{ fontSize: 14, opacity: 0.4, cursor: 'pointer' }} onClick={() => setPbsFileSearch('')} />
              )}
            </Box>
          )}

          {pbsFileLoading && pbsFileTree.length === 0 && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={32} />
            </Box>
          )}

          {pbsFileError && (
            <Alert severity="warning" sx={{ mb: 2 }}>{pbsFileError}</Alert>
          )}

          {/* Tree table */}
          {pbsFileTree.length > 0 && (
            <TableContainer sx={{ maxHeight: 'calc(100vh - 300px)', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>{t('inventory.pbsName')}</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 11, width: 90 }}>{t('inventory.pbsSize')}</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 11, width: 140 }}>Modified</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 11, width: 50 }}></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(() => {
                    const searchQ = pbsFileSearch.trim().toLowerCase()

                    // Collect all matching nodes from expanded tree (recursive search)
                    const collectMatches = (nodes: any[], parentPath: string): Array<{ node: any; nodePath: string; depth: number }> => {
                      const results: Array<{ node: any; nodePath: string; depth: number }> = []
                      const walk = (ns: any[], pp: string, d: number) => {
                        for (const n of ns) {
                          const np = pp ? `${pp}/${n.name}` : n.name
                          if (n.name.toLowerCase().includes(searchQ)) {
                            results.push({ node: n, nodePath: np, depth: 0 })
                          }
                          if (n.children?.length) walk(n.children, np, d + 1)
                        }
                      }
                      walk(nodes, parentPath, 0)
                      return results
                    }

                    // If searching, show flat filtered results
                    if (searchQ) {
                      const matches = collectMatches(pbsFileTree, '')
                      if (matches.length === 0) {
                        return (
                          <TableRow>
                            <TableCell colSpan={4}>
                              <Typography variant="body2" sx={{ opacity: 0.4, textAlign: 'center', py: 2 }}>
                                {t('common.noResults')}
                              </Typography>
                            </TableCell>
                          </TableRow>
                        )
                      }
                      return matches.map(({ node, nodePath }) => {
                        const isDir = node.browsable
                        return (
                          <TableRow key={nodePath} hover sx={{ '& td': { py: 0.25 } }}>
                            <TableCell>
                              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                {node.type === 'virtual' ? (
                                  <i className="ri-hard-drive-2-fill" style={{ color: '#42A5F5', fontSize: 16, marginRight: 6, flexShrink: 0 }} />
                                ) : node.type === 'directory' || isDir ? (
                                  <i className="ri-folder-fill" style={{ color: '#FFB74D', fontSize: 16, marginRight: 6, flexShrink: 0 }} />
                                ) : (
                                  <i className="ri-file-fill" style={{ color: '#90A4AE', fontSize: 16, marginRight: 6, flexShrink: 0 }} />
                                )}
                                <Typography variant="body2" noWrap sx={{ fontSize: 12 }}>
                                  {nodePath}
                                </Typography>
                              </Box>
                            </TableCell>
                            <TableCell>
                              <Typography variant="body2" sx={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', opacity: 0.7 }}>
                                {node.size ? formatBytes(node.size) : '-'}
                              </Typography>
                            </TableCell>
                            <TableCell>
                              <Typography variant="body2" sx={{ fontSize: 11, opacity: 0.6 }}>
                                {node.mtime ? new Date(node.mtime * 1000).toLocaleString() : '-'}
                              </Typography>
                            </TableCell>
                            <TableCell>
                              {pbsFileDownloading === nodePath ? (
                                <CircularProgress size={14} />
                              ) : (
                                <MuiTooltip title={isDir ? `${t('common.download')} (.tar.zst)` : t('common.download')}>
                                  <IconButton size="small" sx={{ p: 0.25 }} disabled={!!pbsFileDownloading} onClick={() => pbsDownloadFile(nodePath, isDir)}>
                                    <i className="ri-download-2-line" style={{ fontSize: 15, opacity: isDir ? 0.4 : 0.7 }} />
                                  </IconButton>
                                </MuiTooltip>
                              )}
                            </TableCell>
                          </TableRow>
                        )
                      })
                    }

                    // Normal tree rendering
                    const rows: React.ReactNode[] = []
                    const renderNodes = (nodes: any[], parentPath: string, depth: number) => {
                      for (const node of nodes) {
                        const nodePath = parentPath ? `${parentPath}/${node.name}` : node.name
                        const isExpanded = pbsFileExpandedPaths.has(nodePath)
                        const isDir = node.browsable
                        const hasChildren = node.children && node.children.length > 0

                        rows.push(
                          <TableRow
                            key={nodePath}
                            hover
                            sx={{
                              cursor: isDir ? 'pointer' : 'default',
                              '& td': { py: 0.25 },
                            }}
                            onClick={() => isDir && pbsToggleTreeNode(nodePath)}
                          >
                            <TableCell>
                              <Box sx={{ display: 'flex', alignItems: 'center', pl: depth * 2.5 }}>
                                {/* Expand/collapse arrow */}
                                {isDir ? (
                                  <Box sx={{ width: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                    {node.loading ? (
                                      <CircularProgress size={12} />
                                    ) : (
                                      <i className={isExpanded ? 'ri-arrow-down-s-fill' : 'ri-arrow-right-s-fill'} style={{ fontSize: 16, opacity: 0.5 }} />
                                    )}
                                  </Box>
                                ) : (
                                  <Box sx={{ width: 20, flexShrink: 0 }} />
                                )}
                                {/* Icon */}
                                {node.type === 'virtual' ? (
                                  <i className="ri-hard-drive-2-fill" style={{ color: '#42A5F5', fontSize: 16, marginRight: 6, flexShrink: 0 }} />
                                ) : node.type === 'directory' || (isDir && !node.isRawDiskImage) ? (
                                  <i className={isExpanded ? 'ri-folder-open-fill' : 'ri-folder-fill'} style={{ color: '#FFB74D', fontSize: 16, marginRight: 6, flexShrink: 0 }} />
                                ) : node.isRawDiskImage ? (
                                  <i className="ri-hard-drive-2-fill" style={{ color: '#90A4AE', fontSize: 16, marginRight: 6, flexShrink: 0 }} />
                                ) : (
                                  <i className="ri-file-fill" style={{ color: '#90A4AE', fontSize: 16, marginRight: 6, flexShrink: 0 }} />
                                )}
                                <Typography variant="body2" noWrap sx={{ fontSize: 12 }}>{node.name}</Typography>
                              </Box>
                            </TableCell>
                            <TableCell>
                              <Typography variant="body2" sx={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', opacity: 0.7 }}>
                                {node.size ? formatBytes(node.size) : '-'}
                              </Typography>
                            </TableCell>
                            <TableCell>
                              <Typography variant="body2" sx={{ fontSize: 11, opacity: 0.6 }}>
                                {node.mtime ? new Date(node.mtime * 1000).toLocaleString() : '-'}
                              </Typography>
                            </TableCell>
                            <TableCell>
                              {pbsFileDownloading === nodePath ? (
                                <CircularProgress size={14} />
                              ) : (
                                <MuiTooltip title={isDir ? `${t('common.download')} (.tar.zst)` : t('common.download')}>
                                  <IconButton
                                    size="small"
                                    sx={{ p: 0.25 }}
                                    disabled={!!pbsFileDownloading}
                                    onClick={(e) => { e.stopPropagation(); pbsDownloadFile(nodePath, isDir) }}
                                  >
                                    <i className="ri-download-2-line" style={{ fontSize: 15, opacity: isDir ? 0.4 : 0.7 }} />
                                  </IconButton>
                                </MuiTooltip>
                              )}
                            </TableCell>
                          </TableRow>
                        )

                        // Render children if expanded
                        if (isExpanded && hasChildren) {
                          renderNodes(node.children, nodePath, depth + 1)
                        }
                      }
                    }
                    renderNodes(pbsFileTree, '', 0)
                    return rows
                  })()}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
})

export default PbsServerPanel
