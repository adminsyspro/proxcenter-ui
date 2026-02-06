'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Autocomplete,
  Box,
  Breadcrumbs,
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
  Grid,
  IconButton,
  InputAdornment,
  InputLabel,
  LinearProgress,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Popover,
  Select,
  Slider,
  Stack,
  Step,
  StepLabel,
  Stepper,
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
  ToggleButton,
  ToggleButtonGroup,
  Tooltip as MuiTooltip,
  Typography,
  useTheme,
} from '@mui/material'
import { lighten } from '@mui/material/styles'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import StopIcon from '@mui/icons-material/Stop'
import PauseIcon from '@mui/icons-material/Pause'
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew'
import MoveUpIcon from '@mui/icons-material/MoveUp'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DescriptionIcon from '@mui/icons-material/Description'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import SaveIcon from '@mui/icons-material/Save'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts'

import NodesTable, { NodeRow, BulkAction } from '@/components/NodesTable'
import VmsTable, { VmRow, TrendPoint } from '@/components/VmsTable'
import { 
  AddDiskDialog, 
  AddNetworkDialog, 
  EditDiskDialog, 
  EditNetworkDialog,
  EditScsiControllerDialog,
  CloneVmDialog
} from '@/components/HardwareModals'
import { MigrateVmDialog, CrossClusterMigrateParams } from '@/components/MigrateVmDialog'
import VmFirewallTab from '@/components/VmFirewallTab'
import ClusterFirewallTab from '@/components/ClusterFirewallTab'
import BackupJobsPanel from './BackupJobsPanel'
import RollingUpdateWizard from '@/components/RollingUpdateWizard'
import { useLicense, Features } from '@/contexts/LicenseContext'
import { useToast } from '@/contexts/ToastContext'
import { useTaskTracker } from '@/hooks/useTaskTracker'

/* ------------------------------------------------------------------ */
/* Tag colors (stable "random")                                       */
/* ------------------------------------------------------------------ */

const TAG_PALETTE = [
  '#e57000',
  '#2e7d32',
  '#1565c0',
  '#6a1b9a',
  '#00838f',
  '#c62828',
  '#ad1457',
  '#4e342e',
  '#455a64',
  '#7a7a00',
]

function hashStringToInt(str: string) {
  let h = 0

  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0
  
return Math.abs(h)
}

function tagColor(tag: string) {
  const idx = hashStringToInt(tag.toLowerCase()) % TAG_PALETTE.length

  
return TAG_PALETTE[idx]
}

/* ------------------------------------------------------------------ */
/* TagManager Component                                               */
/* ------------------------------------------------------------------ */

type TagManagerProps = {
  tags: string[]
  connId: string
  node: string
  type: string
  vmid: string
  onTagsChange: (newTags: string[]) => void
}

function TagManager({ tags, connId, node, type, vmid, onTagsChange }: TagManagerProps) {
  const t = useTranslations()
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null)
  const [availableTags, setAvailableTags] = useState<string[]>([])
  const [loadingTags, setLoadingTags] = useState(false)
  const [newTagInput, setNewTagInput] = useState('')
  const [busy, setBusy] = useState(false)

  const open = Boolean(anchorEl)

  // Charger les tags existants dans Proxmox quand on ouvre le popover
  const handleOpenAdd = async (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget)
    setLoadingTags(true)

    try {
      // Récupérer tous les guests pour extraire les tags uniques
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/guests`, { cache: 'no-store' })

      if (res.ok) {
        const json = await res.json()
        const guests = Array.isArray(json?.data) ? json.data : []
        const allTags = new Set<string>()

        guests.forEach((g: any) => {
          if (g.tags) {
            String(g.tags).split(/[;,]+/).forEach(t => {
              const trimmed = t.trim()

              if (trimmed) allTags.add(trimmed)
            })
          }
        })
        setAvailableTags(Array.from(allTags).sort())
      }
    } catch (e) {
      console.error('Failed to load tags', e)
    } finally {
      setLoadingTags(false)
    }
  }

  const handleClose = () => {
    setAnchorEl(null)
    setNewTagInput('')
  }

  // Ajouter un tag
  const handleAddTag = async (tagToAdd: string) => {
    if (!tagToAdd.trim() || tags.includes(tagToAdd.trim())) return
    
    setBusy(true)

    try {
      const newTags = [...tags, tagToAdd.trim()]
      const tagsString = newTags.join(';')
      
      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/config`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tags: tagsString })
        }
      )
      
      if (res.ok) {
        onTagsChange(newTags)
        setNewTagInput('')
      } else {
        const err = await res.json().catch(() => ({}))

        alert(`${t('common.error')}: ${err?.error || res.status}`)
      }
    } catch (e: any) {
      alert(`${t('common.error')}: ${e?.message || e}`)
    } finally {
      setBusy(false)
    }
  }

  // Supprimer un tag
  const handleRemoveTag = async (tagToRemove: string) => {
    setBusy(true)

    try {
      const newTags = tags.filter(t => t !== tagToRemove)
      const tagsString = newTags.join(';')
      
      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/config`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tags: tagsString })
        }
      )
      
      if (res.ok) {
        onTagsChange(newTags)
      } else {
        const err = await res.json().catch(() => ({}))

        alert(`${t('common.error')}: ${err?.error || res.status}`)
      }
    } catch (e: any) {
      alert(`${t('common.error')}: ${e?.message || e}`)
    } finally {
      setBusy(false)
    }
  }

  // Tags disponibles mais pas encore sur cette VM
  const suggestedTags = availableTags.filter(t => !tags.includes(t))

  return (
    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center' }}>
      {/* Tags existants avec bouton × */}
      {tags.map(t => {
        const c = tagColor(t)

        
return (
          <Chip
            key={t}
            size="small"
            label={t}
            disabled={busy}
            onDelete={() => handleRemoveTag(t)}
            deleteIcon={
              <CloseIcon 
                sx={{ 
                  fontSize: '14px !important',
                  color: `${c} !important`,
                  '&:hover': { color: `${c} !important`, opacity: 0.7 }
                }} 
              />
            }
            sx={{
              height: 22,
              '& .MuiChip-label': { px: 1, fontSize: 12, fontWeight: 800 },
              '& .MuiChip-deleteIcon': { mr: 0.5 },
              bgcolor: `${c}22`,
              color: c,
              border: '1px solid',
              borderColor: `${c}66`,
            }}
          />
        )
      })}

      {/* Bouton + pour ajouter */}
      <MuiTooltip title={t('inventory.addTag')}>
        <IconButton
          size="small"
          onClick={handleOpenAdd}
          disabled={busy}
          sx={{
            width: 22,
            height: 22,
            border: '1px dashed',
            borderColor: 'divider',
            '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' }
          }}
        >
          <AddIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </MuiTooltip>

      {/* Popover pour ajouter un tag */}
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <Box sx={{ p: 2, minWidth: 280 }}>
          <Typography variant="subtitle2" fontWeight={900} sx={{ mb: 1.5 }}>
            {t('inventory.addTag')}
          </Typography>

          {/* Input pour nouveau tag */}
          <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
            <TextField
              size="small"
              placeholder={t('inventoryPage.newTag')}
              value={newTagInput}
              onChange={e => setNewTagInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newTagInput.trim()) {
                  handleAddTag(newTagInput)
                }
              }}
              disabled={busy}
              sx={{ flex: 1 }}
            />
            <Button
              size="small"
              variant="contained"
              disabled={!newTagInput.trim() || busy}
              onClick={() => handleAddTag(newTagInput)}
            >
              {t('common.add')}
            </Button>
          </Box>

          <Divider sx={{ my: 1.5 }} />

          {/* Tags suggérés */}
          <Typography variant="caption" sx={{ opacity: 0.7, display: 'block', mb: 1 }}>
            {t('inventoryPage.existingTagsProxmox')}
          </Typography>

          {loadingTags ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
              <CircularProgress size={16} />
              <Typography variant="caption">{t('common.loading')}</Typography>
            </Box>
          ) : suggestedTags.length === 0 ? (
            <Typography variant="caption" sx={{ opacity: 0.5 }}>
              {t('common.noResults')}
            </Typography>
          ) : (
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', maxHeight: 150, overflow: 'auto' }}>
              {suggestedTags.map(t => {
                const c = tagColor(t)

                
return (
                  <Chip
                    key={t}
                    size="small"
                    label={t}
                    onClick={() => handleAddTag(t)}
                    disabled={busy}
                    sx={{
                      height: 22,
                      cursor: 'pointer',
                      '& .MuiChip-label': { px: 1, fontSize: 11, fontWeight: 700 },
                      bgcolor: `${c}15`,
                      color: c,
                      border: '1px solid',
                      borderColor: `${c}44`,
                      '&:hover': { bgcolor: `${c}30` }
                    }}
                  />
                )
              })}
            </Box>
          )}
        </Box>
      </Popover>
    </Box>
  )
}

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

type Status = 'ok' | 'warn' | 'crit' | 'unknown'

export type InventorySelection =
  | { type: 'root'; id: 'root' }
  | { type: 'cluster'; id: string }
  | { type: 'node'; id: string }
  | { type: 'vm'; id: string }
  | { type: 'storage'; id: string }
  | { type: 'pbs'; id: string }
  | { type: 'pbs-datastore'; id: string }
  | { type: 'datastore'; id: string }

type Kpi = { label: string; value: string; hint?: string }
type KV = { k: string; v: string }

type UtilMetric = {
  label: string
  pct: number
  used?: number
  max?: number
  unitHint?: string
}

type DetailsPayload = {
  kindLabel: string
  title: string
  subtitle?: string
  breadcrumb: string[]
  status: Status
  vmRealStatus?: string  // Le vrai statut de la VM (running, stopped, etc.) pour les boutons et la console
  tags: string[]
  kpis: Kpi[]
  properties: KV[]
  metrics?: {
    cpu?: UtilMetric
    ram?: UtilMetric
    storage?: UtilMetric
    swap?: UtilMetric
  }
  lastUpdated: string
  isCluster?: boolean  // true si multi-nodes, false si standalone (pour migration)
  vmType?: 'qemu' | 'lxc'  // type de VM pour l'icône
  name?: string
  description?: string

  // Infos matérielles (onglet Matériel)
  cpuInfo?: {
    sockets: number
    cores: number
    type: string
    cpulimit?: number
    cpuunits?: number
    numa?: boolean
    pending?: {  // Changements en attente de reboot
      sockets?: number
      cores?: number
      cpu?: string
      cpulimit?: number
    }
  }
  memoryInfo?: {
    memory: number
    balloon?: number
    shares?: number
    pending?: {  // Changements en attente de reboot
      memory?: number
      balloon?: number
    }
  }
  disksInfo?: Array<{
    id: string
    storage: string
    size: string
    format?: string
    cache?: string
    iothread?: boolean
  }>
  networkInfo?: Array<{
    id: string
    model: string
    bridge: string
    macaddr?: string
    tag?: number
    firewall?: boolean
    rate?: number
  }>

  // Infos options (onglet Options)
  optionsInfo?: {
    onboot?: boolean
    protection?: boolean
    startAtBoot?: boolean
    startupOrder?: string
    ostype?: string
    bootOrder?: string
    useTablet?: boolean
    hotplug?: string
    acpi?: boolean
    kvmEnabled?: boolean
    freezeCpu?: boolean
    useLocalTime?: string
    rtcStartDate?: string
    smbiosUuid?: string
    agentEnabled?: boolean
    spiceEnhancements?: string
    vmStateStorage?: string
    amdSEV?: string
    scsihw?: string
  }
  nodeCapacity?: {
    maxCpu: number
    maxMem: number
  }
  hostInfo?: {
    uptime?: number
    cpuModel?: string
    cpuCores?: number
    cpuSockets?: number
    kernelVersion?: string
    pveVersion?: string
    bootMode?: string
    loadAvg?: string
    ioDelay?: number
    ksmSharing?: number
    updates?: Array<{ package?: string; version?: string }>
    subscription?: {
      status?: string
      nextDueDate?: string
      productName?: string
      key?: string
      type?: string
      serverId?: string
      sockets?: number
      lastChecked?: string
    }
  }

  // Données pour les tableaux intégrés
  nodesData?: Array<{
    id: string
    connId: string
    node: string
    name: string
    status: 'online' | 'offline' | 'maintenance'
    cpu: number
    ram: number
    storage: number
    vms?: number
    uptime?: number
  }>
  vmsData?: Array<{
    id: string
    connId: string
    node: string
    vmid: string | number
    name: string
    type: 'qemu' | 'lxc'
    status: string
    cpu?: number
    ram?: number
    maxmem?: number
    maxdisk?: number
    uptime?: number
    tags?: string[]
    template?: boolean
  }>

  // Ceph health status
  cephHealth?: string  // HEALTH_OK, HEALTH_WARN, HEALTH_ERR

  // All VMs data for cluster view
  allVms?: Array<{
    id: string
    connId: string
    connName?: string
    node: string
    vmid: number | string
    name: string
    status: string
    type: 'qemu' | 'lxc'
    template?: boolean
    cpu?: number
    cpuPct?: number
    ram?: number
    memPct?: number
    maxmem?: number
    disk?: number
    maxdisk?: number
    uptime?: number
    tags?: string[]
    isCluster?: boolean
  }>
  vmsCount?: number
  clusterName?: string | null

  // PBS (Proxmox Backup Server) data
  pbsInfo?: {
    version?: string
    uptime?: number
    cpuInfo?: any
    memory?: any
    load?: any
    datastores: Array<{
      name: string
      path?: string
      comment?: string
      total: number
      used: number
      available: number
      usagePercent: number
      backupCount: number
      vmCount?: number
      ctCount?: number
      hostCount?: number
    }>
    backups: Array<{
      id: string
      datastore: string
      backupType: string
      backupId: string
      vmName?: string
      backupTime: number
      backupTimeFormatted: string
      size: number
      sizeFormatted: string
      verified?: boolean
      protected?: boolean
    }>
    stats: {
      total?: number
      vmCount?: number
      ctCount?: number
      hostCount?: number
      totalSize?: number
      totalSizeFormatted?: string
    }
    rrdData?: Array<{
      time: number
      cpu: number
      iowait: number
      loadavg: number
      memtotal: number
      memused: number
      memUsedPercent: number
      swaptotal: number
      swapused: number
      swapUsedPercent: number
      netin: number
      netout: number
      diskread: number
      diskwrite: number
      roottotal: number
      rootused: number
      rootUsedPercent: number
    }>
  }

  // Datastore PBS data
  datastoreInfo?: {
    pbsId: string
    pbsName?: string
    name: string
    path?: string
    comment?: string
    total: number
    used: number
    available?: number
    usagePercent: number
    gcStatus?: any
    verifyStatus?: any
    backups: Array<{
      id: string
      datastore: string
      backupType: string
      backupId: string
      vmName?: string
      backupTime: number
      backupTimeFormatted: string
      size: number
      sizeFormatted: string
      verified?: boolean
      protected?: boolean
    }>
    stats: {
      total?: number
      vmCount?: number
      ctCount?: number
      hostCount?: number
      totalSize?: number
      totalSizeFormatted?: string
      verifiedCount?: number
      protectedCount?: number
    }
    pagination?: {
      page?: number
      pageSize?: number
      totalPages?: number
      totalItems?: number
    }
    rrdData?: Array<{
      time: number
      total: number
      used: number
      available: number
      usedPercent: number
      read: number
      write: number
      readIops: number
      writeIops: number
    }>
  }
}

/* ------------------------------------------------------------------ */
/* Helpers JSON / Array                                               */
/* ------------------------------------------------------------------ */

function safeJson<T>(input: any): T {
  let cur = input

  while (cur && typeof cur === 'object' && 'data' in cur) cur = (cur as any).data
  
return cur as T
}

function asArray<T>(input: any): T[] {
  if (Array.isArray(input)) return input

  if (input && typeof input === 'object') {
    if (Array.isArray((input as any).items)) return (input as any).items
    if (Array.isArray((input as any).guests)) return (input as any).guests
  }

  
return []
}

function parseTags(tags?: string): string[] {
  if (!tags) return []
  
return String(tags)
    .split(/[;,]+/)
    .map(s => s.trim())
    .filter(Boolean)
}

/* ------------------------------------------------------------------ */
/* Utils                                                              */
/* ------------------------------------------------------------------ */

function pct(used: number, max: number) {
  if (!max || max <= 0) return 0
  
return Math.round((used / max) * 100)
}

function cpuPct(v: any) {
  const n = Number(v ?? 0)

  if (!Number.isFinite(n)) return 0
  
return Math.round(n * 100)
}

function formatBytes(bytes: number) {
  if (!bytes || !Number.isFinite(bytes)) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let i = 0
  let v = bytes

  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }

  
return `${v.toFixed(i === 0 ? 0 : 1)} ${u[i]}`
}

function formatBps(bps: number) {
  if (!Number.isFinite(bps) || bps <= 0) return '0 B/s'
  const u = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let i = 0
  let v = bps

  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }

  
return `${v.toFixed(i === 0 ? 0 : 1)} ${u[i]}`
}

function formatTime(tsMs: number) {
  const d = new Date(tsMs)

  
return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatUptime(seconds: number): string {
  if (!seconds || seconds <= 0) return '—'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  
  if (days > 0) {
    return `${days} days ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }

  
return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

// Simple Markdown parser
function parseMarkdown(md: string): string {
  if (!md) return ''
  
  let html = md
    // Escape HTML first
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Code blocks (before other parsing)
    .replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Headers
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>')
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    // Images (Markdown syntax)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width: 100%;" />')
    // Horizontal rule
    .replace(/^---$/gm, '<hr />')
    .replace(/^\*\*\*$/gm, '<hr />')
    // Blockquotes
    .replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>')
    // Unordered lists
    .replace(/^[\*\-] (.*)$/gm, '<li>$1</li>')
    // Ordered lists
    .replace(/^\d+\. (.*)$/gm, '<li>$1</li>')
    // Paragraphs (double newlines)
    .replace(/\n\n/g, '</p><p>')
    // Single newlines to <br>
    .replace(/\n/g, '<br />')
  
  // Wrap consecutive <li> in <ul>
  html = html.replace(/(<li>.*?<\/li>)+/g, '<ul>$&</ul>')
  
  // Wrap in paragraph if not already wrapped
  if (!html.startsWith('<')) {
    html = '<p>' + html + '</p>'
  }
  
  return html
}

/* ------------------------------------------------------------------ */
/* Parsing IDs                                                        */
/* ------------------------------------------------------------------ */

function parseNodeId(id: string) {
  const [connId, ...rest] = id.split(':')

  
return { connId, node: rest.join(':') }
}

function parseVmId(id: string) {
  const [connId, node, type, vmid] = id.split(':')

  
return { connId, node, type, vmid }
}

/* ------------------------------------------------------------------ */
/* Small UI                                                           */
/* ------------------------------------------------------------------ */

function StatusChip({ status }: { status: Status }) {
  const map: Record<Status, { label: string; color: any }> = {
    ok: { label: 'OK', color: 'success' },
    warn: { label: 'WARN', color: 'warning' },
    crit: { label: 'CRIT', color: 'error' },
    unknown: { label: 'UNKNOWN', color: 'default' },
  }

  
return <Chip size="small" label={map[status].label} color={map[status].color} variant="outlined" />
}

/* ------------------------------------------------------------------ */
/* Actions bar (top right)                                            */
/* ------------------------------------------------------------------ */

function VmActions({
  disabled,
  vmStatus,
  isCluster,
  isLocked,
  lockType,
  onStart,
  onShutdown,
  onStop,
  onPause,
  onMigrate,
  onClone,
  onConvertTemplate,
  onDelete,
  onUnlock,
}: {
  disabled?: boolean
  vmStatus?: string
  isCluster?: boolean
  isLocked?: boolean
  lockType?: string
  onStart: () => void
  onShutdown: () => void
  onStop: () => void
  onPause: () => void
  onMigrate: () => void
  onClone: () => void
  onConvertTemplate: () => void
  onDelete: () => void
  onUnlock?: () => void
}) {
  const t = useTranslations()
  const isRunning = vmStatus === 'running'
  const isStopped = vmStatus === 'stopped' || vmStatus === 'unknown'

  return (
    <Stack direction="row" spacing={0.25} alignItems="center" sx={{ ml: 'auto' }}>
      {/* Start */}
      <MuiTooltip title={t('audit.actions.start')}>
        <span>
          <IconButton
            size="small"
            onClick={onStart}
            disabled={disabled || isRunning}
            sx={{ color: '#2e7d32', '&:hover': { bgcolor: 'rgba(46,125,50,0.12)' } }}
          >
            <PlayArrowIcon fontSize="small" />
          </IconButton>
        </span>
      </MuiTooltip>

      {/* Shutdown */}
      <MuiTooltip title={t('inventoryPage.shutdownClean')}>
        <span>
          <IconButton
            size="small"
            onClick={onShutdown}
            disabled={disabled || !isRunning}
            sx={{ color: '#f59e0b', '&:hover': { bgcolor: 'rgba(245,158,11,0.12)' } }}
          >
            <PowerSettingsNewIcon fontSize="small" />
          </IconButton>
        </span>
      </MuiTooltip>

      {/* Stop */}
      <MuiTooltip title={t('audit.actions.stop')}>
        <span>
          <IconButton
            size="small"
            onClick={onStop}
            disabled={disabled || !isRunning}
            sx={{ color: '#c62828', '&:hover': { bgcolor: 'rgba(198,40,40,0.12)' } }}
          >
            <StopIcon fontSize="small" />
          </IconButton>
        </span>
      </MuiTooltip>

      {/* Pause */}
      <MuiTooltip title={t('audit.actions.suspend')}>
        <span>
          <IconButton
            size="small"
            onClick={onPause}
            disabled={disabled || !isRunning}
            sx={{ color: '#1976d2', '&:hover': { bgcolor: 'rgba(25,118,210,0.12)' } }}
          >
            <PauseIcon fontSize="small" />
          </IconButton>
        </span>
      </MuiTooltip>

      <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

      {/* Migrate - uniquement pour les clusters */}
      {isCluster ? (
        <MuiTooltip title={t('audit.actions.migrate')}>
          <span>
            <IconButton
              size="small"
              onClick={onMigrate}
              disabled={disabled}
              sx={{ color: 'text.secondary', '&:hover': { bgcolor: 'action.hover' } }}
            >
              <MoveUpIcon fontSize="small" />
            </IconButton>
          </span>
        </MuiTooltip>
      ) : null}

      {/* Clone */}
      <MuiTooltip title={t('audit.actions.clone')}>
        <span>
          <IconButton
            size="small"
            onClick={onClone}
            disabled={disabled}
            sx={{ color: 'text.secondary', '&:hover': { bgcolor: 'action.hover' } }}
          >
            <ContentCopyIcon fontSize="small" />
          </IconButton>
        </span>
      </MuiTooltip>

      {/* Convert to Template */}
      <MuiTooltip title={t('templates.fromVm')}>
        <span>
          <IconButton
            size="small"
            onClick={onConvertTemplate}
            disabled={disabled || isRunning}
            sx={{ color: 'text.secondary', '&:hover': { bgcolor: 'action.hover' } }}
          >
            <DescriptionIcon fontSize="small" />
          </IconButton>
        </span>
      </MuiTooltip>

      <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

      {/* Delete VM */}
      <MuiTooltip title={isRunning ? t('inventory.vmRunningWarning') : t('inventory.deleteVm')}>
        <span>
          <IconButton
            size="small"
            onClick={onDelete}
            disabled={disabled || isRunning}
            sx={{ 
              color: isRunning ? 'text.disabled' : 'error.main', 
              '&:hover': { bgcolor: 'rgba(244,67,54,0.12)' } 
            }}
          >
            <i className="ri-delete-bin-line" style={{ fontSize: 18 }} />
          </IconButton>
        </span>
      </MuiTooltip>

      {/* Unlock - Only shown when VM is locked */}
      {isLocked && onUnlock && (
        <>
          <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
          <MuiTooltip title={`${t('inventory.unlock')} (${lockType || 'locked'})`}>
            <span>
              <IconButton
                size="small"
                onClick={onUnlock}
                disabled={disabled}
                sx={{ 
                  color: '#f59e0b',
                  '&:hover': { bgcolor: 'rgba(245,158,11,0.12)' } 
                }}
              >
                <i className="ri-lock-unlock-line" style={{ fontSize: 18 }} />
              </IconButton>
            </span>
          </MuiTooltip>
        </>
      )}
    </Stack>
  )
}

/* ------------------------------------------------------------------ */
/* Summary (PKI expands, Console untouched, readable text)             */
/* ------------------------------------------------------------------ */

// Icônes pour chaque type de métrique
function getMetricIcon(label: string): string {
  const l = label.toLowerCase()

  if (l.includes('cpu')) return 'ri-cpu-line'
  if (l.includes('ram') || l.includes('memory')) return 'ri-database-2-line'
  if (l.includes('storage') || l.includes('hd') || l.includes('disk')) return 'ri-hard-drive-2-line'
  if (l.includes('swap')) return 'ri-swap-line'
  if (l.includes('load')) return 'ri-dashboard-3-line'
  if (l.includes('io')) return 'ri-time-line'
  
return 'ri-bar-chart-line'
}

function UsageBar({
  label,
  used,
  capacity,
  mode,
  icon,
  themeColor,
}: {
  label: string
  used: number
  capacity: number
  mode: 'bytes' | 'pct'
  icon?: string
  themeColor: string
}) {
  const iconClass = icon || getMetricIcon(label)

  if (mode === 'pct') {
    const u = Math.max(0, Math.min(100, Number(used || 0)))
    const free = Math.max(0, 100 - u)

    return (
      <Box sx={{ mb: 1.5 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <i className={iconClass} style={{ fontSize: 14, color: themeColor }} />
            <Typography variant="body2" sx={{ fontWeight: 700, color: 'text.primary' }}>
              {label}
            </Typography>
          </Box>
          <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.secondary' }}>
            Free: {Math.round(free)}%
          </Typography>
        </Box>

        <Box
          sx={{
            height: 6,
            borderRadius: 999,
            bgcolor: 'rgba(255,255,255,0.12)',
            overflow: 'hidden',
          }}
        >
          <Box
            sx={{
              height: '100%',
              width: `${u}%`,
              bgcolor: themeColor,
              borderRadius: 999,
              transition: 'all 300ms ease',
            }}
          />
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, mt: 0.5 }}>
          <Typography variant="caption" sx={{ color: 'text.primary', fontWeight: 500 }}>
            Used: {Math.round(u)}%
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Capacity: 100%
          </Typography>
        </Box>
      </Box>
    )
  }

  const cap = Math.max(0, Number(capacity || 0))
  const u = Math.max(0, Math.min(Number(used || 0), cap || Number(used || 0)))
  const free = Math.max(0, cap - u)
  const pctVal = cap > 0 ? Math.round((u / cap) * 100) : 0

  return (
    <Box sx={{ mb: 1.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <i className={iconClass} style={{ fontSize: 14, color: themeColor }} />
          <Typography variant="body2" sx={{ fontWeight: 700, color: 'text.primary' }}>
            {label}
          </Typography>
        </Box>
        <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.secondary' }}>
          Free: {formatBytes(free)}
        </Typography>
      </Box>

      <Box
        sx={{
          height: 6,
          borderRadius: 999,
          bgcolor: 'rgba(255,255,255,0.12)',
          overflow: 'hidden',
        }}
      >
        <Box
          sx={{
            height: '100%',
            width: `${pctVal}%`,
            bgcolor: themeColor,
            borderRadius: 999,
            transition: 'all 300ms ease',
          }}
        />
      </Box>

      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, mt: 0.5 }}>
        <Typography variant="caption" sx={{ color: 'text.primary', fontWeight: 500 }}>
          Used: {formatBytes(u)}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Capacity: {formatBytes(cap)}
        </Typography>
      </Box>
    </Box>
  )
}

function ConsolePreview({ 
  height = 210, 
  connId, 
  node, 
  type, 
  vmid,
  vmStatus,
  osInfo,
  osLoading
}: { 
  height?: number
  connId?: string
  node?: string
  type?: string
  vmid?: string
  vmStatus?: string
  osInfo?: { type: 'linux' | 'windows' | 'other'; name: string | null; version: string | null; kernel: string | null } | null
  osLoading?: boolean
}) {
  const t = useTranslations()
  const isRunning = vmStatus?.toLowerCase() === 'running'
  
  // URL de la page console fullscreen (noVNC)
  const consoleUrl = connId && node && type && vmid 
    ? `/novnc/console.html?connId=${encodeURIComponent(connId)}&type=${encodeURIComponent(type)}&node=${encodeURIComponent(node)}&vmid=${encodeURIComponent(vmid)}`
    : null

  const handleOpenConsole = () => {
    if (consoleUrl) {
      window.open(
        consoleUrl, 
        `console-${vmid}`,
        'width=1024,height=768,menubar=no,toolbar=no,location=no,status=no'
      )
    }
  }

  // Déterminer l'icône Remix Icon à afficher selon l'OS
  const getOsIcon = () => {
    if (!osInfo?.name && !osInfo?.type) return null
    
    const osName = (osInfo?.name || '').toLowerCase()
    const osType = osInfo?.type
    
    // Windows
    if (osType === 'windows' || osName.includes('windows')) {
      return 'ri-windows-fill'
    }
    // Ubuntu
    if (osName.includes('ubuntu')) {
      return 'ri-ubuntu-fill'
    }
    // Debian, Linux générique et autres distributions
    if (osType === 'linux' || osName.includes('linux') || osName.includes('debian') || 
        osName.includes('centos') || osName.includes('fedora') || osName.includes('arch') ||
        osName.includes('alpine') || osName.includes('suse') || osName.includes('red hat') ||
        osName.includes('rhel')) {
      return 'ri-ubuntu-fill' // Utiliser ubuntu comme icône Linux générique
    }
    // macOS
    if (osName.includes('mac') || osName.includes('darwin')) {
      return 'ri-apple-fill'
    }
    // FreeBSD et autres
    if (osName.includes('bsd')) {
      return 'ri-terminal-box-fill'
    }
    
    return 'ri-computer-fill'
  }

  const osIcon = getOsIcon()

  return (
    <Box sx={{ width: '100%', height: '100%' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
        <Typography variant="caption" sx={{ fontWeight: 900, opacity: 0.9 }}>
          Console
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {isRunning && consoleUrl && (
            <Typography variant="caption" sx={{ opacity: 0.6 }}>
              noVNC
            </Typography>
          )}
        </Box>
      </Box>

      <Box
        onClick={isRunning ? handleOpenConsole : undefined}
        sx={{
          width: '100%',
          height,
          borderRadius: 2,
          border: '1px solid',
          borderColor: 'divider',
          overflow: 'hidden',
          bgcolor: '#0b1220',
          position: 'relative',
          cursor: isRunning && consoleUrl ? 'pointer' : 'default',
          transition: 'all 0.2s ease',
          '&:hover': isRunning && consoleUrl ? {
            borderColor: 'primary.main',
            boxShadow: '0 0 0 1px rgba(99, 102, 241, 0.3)',
          } : {},
        }}
      >
        {/* Icône OS en fond */}
        {osIcon && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <Box
              component="i"
              className={osIcon}
              sx={{
                fontSize: 100,
                color: 'rgba(255, 255, 255, 0.12)',
              }}
            />
          </Box>
        )}

        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            color: 'rgba(255,255,255,0.65)',
            px: 2,
            textAlign: 'center',
          }}
        >
          {isRunning ? (
            <Box>
              {/* Zone cliquable vide - juste l'icône OS en fond suffit */}
            </Box>
          ) : (
            <Box>
              <Box 
                component="i" 
                className="ri-shut-down-line" 
                sx={{ fontSize: 40, color: 'rgba(255,255,255,0.25)', mb: 1, display: 'block' }} 
              />
              <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.5)' }}>
                {t('common.offline')}
              </Typography>
              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.35)' }}>
                {t('audit.actions.start')}
              </Typography>
            </Box>
          )}
        </Box>
      </Box>

      {/* OS Info en dessous de la console */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 0.5, mt: 0.5 }}>
        {osLoading ? (
          <>
            <CircularProgress size={10} />
            <Typography variant="caption" sx={{ opacity: 0.5 }}>{t('common.loading')}</Typography>
          </>
        ) : osInfo ? (
          <MuiTooltip 
            title={
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{osInfo.name || 'Unknown OS'}</Typography>
                {osInfo.version && <Typography variant="caption" sx={{ display: 'block' }}>Version: {osInfo.version}</Typography>}
                {osInfo.kernel && <Typography variant="caption" sx={{ display: 'block', opacity: 0.8 }}>Kernel: {osInfo.kernel}</Typography>}
              </Box>
            }
            arrow
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <i className="ri-computer-line" style={{ fontSize: 12, opacity: 0.5 }} />
              <Typography variant="caption" sx={{ opacity: 0.6 }}>OS:</Typography>
              <i 
                className={osInfo.type === 'windows' ? 'ri-windows-fill' : osInfo.type === 'linux' ? 'ri-ubuntu-fill' : 'ri-terminal-box-line'} 
                style={{ 
                  fontSize: 12, 
                  color: osInfo.type === 'windows' ? '#0078D4' : osInfo.type === 'linux' ? '#E95420' : undefined 
                }} 
              />
              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                {osInfo.name || 'Unknown'}
              </Typography>
            </Box>
          </MuiTooltip>
        ) : null}
      </Box>
    </Box>
  )
}

function VCenterSummary({
  kindLabel,
  status,
  subtitle,
  metrics,
  vmState,
  showConsole,
  hostInfo,
  kpis,
  vmInfo,
  guestInfo,
  guestInfoLoading,
  clusterPveVersion,
  connId,
  nodeName,
  onRefreshSubscription,
  cephHealth,
  nodesOnline,
  nodesTotal,
}: {
  kindLabel: string
  status: Status
  subtitle?: string
  metrics?: DetailsPayload['metrics']
  vmState?: string | null
  showConsole?: boolean
  hostInfo?: DetailsPayload['hostInfo']
  kpis?: Kpi[]
  vmInfo?: { connId: string; node: string; type: string; vmid: string } | null
  guestInfo?: { ip?: string; uptime?: number; osInfo?: { type: 'linux' | 'windows' | 'other'; name: string | null; version: string | null; kernel: string | null } | null } | null
  guestInfoLoading?: boolean
  clusterPveVersion?: string
  connId?: string
  nodeName?: string
  onRefreshSubscription?: () => void
  cephHealth?: string
  nodesOnline?: number
  nodesTotal?: number
}) {
  const t = useTranslations()
  const theme = useTheme()
  const primaryColor = theme.palette.primary.main
  const primaryColorLight = lighten(primaryColor, 0.3)
  
  const state = (vmState || '').toLowerCase()

  const stateColor =
    state.includes('running') ? '#2e7d32' : state.includes('stopped') || state.includes('shutdown') ? '#6b7280' : undefined

  const cpuNowPct = metrics?.cpu?.pct ?? 0
  const memUsed = metrics?.ram?.used ?? 0
  const memCap = metrics?.ram?.max ?? 0
  const diskUsed = metrics?.storage?.used ?? 0
  const diskCap = metrics?.storage?.max ?? 0
  const swapUsed = metrics?.swap?.used ?? 0
  const swapCap = metrics?.swap?.max ?? 0

  const consoleWidth = { xs: '100%', md: 360 }
  
  // État pour les blocs collapsibles dans la vue host
  const [hostBlocksCollapsed, setHostBlocksCollapsed] = useState<{
    updates: boolean
    subscription: boolean
  }>({
    updates: true,
    subscription: true,
  })

  // États pour les modales
  const [upgradeDialogOpen, setUpgradeDialogOpen] = useState(false)
  const [changelogDialogOpen, setChangelogDialogOpen] = useState(false)
  const [upgradeConsoleOpen, setUpgradeConsoleOpen] = useState(false)
  const [upgradeTaskId, setUpgradeTaskId] = useState<string | null>(null)
  const [checkingSubscription, setCheckingSubscription] = useState(false)

  // Vérifier si un reboot est nécessaire (présence de kernel dans les updates)
  const hasKernelUpdate = hostInfo?.updates?.some((u: any) => 
    u.package?.toLowerCase().includes('kernel') || 
    u.package?.toLowerCase().includes('linux-image') ||
    u.package?.toLowerCase().includes('proxmox-kernel')
  ) || false

  // Handler pour lancer la mise à jour
  const handleStartUpgrade = async (consoleType: 'novnc' | 'xterm') => {
    if (!connId || !nodeName) return
    
    try {
      // Appel API pour lancer apt upgrade
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(nodeName)}/apt/upgrade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: consoleType })
      })
      
      if (res.ok) {
        const data = await res.json()
        setUpgradeTaskId(data.data || data.upid)
        setUpgradeDialogOpen(false)
        setUpgradeConsoleOpen(true)
      }
    } catch (err) {
      console.error('Failed to start upgrade:', err)
    }
  }

  // Handler pour vérifier la subscription
  const handleCheckSubscription = async () => {
    if (!connId || !nodeName) return
    setCheckingSubscription(true)
    
    try {
      // Appel API pour rafraîchir la subscription
      await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(nodeName)}/subscription`, {
        method: 'POST'
      })
      // Callback pour rafraîchir les données
      onRefreshSubscription?.()
    } catch (err) {
      console.error('Failed to check subscription:', err)
    } finally {
      setCheckingSubscription(false)
    }
  }
  
  // Formater l'uptime
  const formatUptime = (secs?: number) => {
    if (!secs) return null
    const days = Math.floor(secs / 86400)
    const hours = Math.floor((secs % 86400) / 3600)
    const mins = Math.floor((secs % 3600) / 60)

    if (days > 0) return `${days}j ${hours}h ${mins}m`
    if (hours > 0) return `${hours}h ${mins}m`
    
return `${mins}m`
  }

  // Composant pour une ligne d'info host
  const InfoRow = ({ icon, label, value }: { icon: string; label: string; value: React.ReactNode }) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.5 }}>
      <i className={icon} style={{ opacity: 0.6, fontSize: 14, width: 16 }} />
      <Typography variant="body2" sx={{ opacity: 0.7, minWidth: 120 }}>{label}</Typography>
      <Typography variant="body2" sx={{ fontWeight: 600, textAlign: 'right', flex: 1 }}>{value}</Typography>
    </Box>
  )

  return (
    <Card variant="outlined" sx={{ width: '100%', borderRadius: 2 }}>
      <CardContent sx={{ p: 1.5 }}>
        {/* Header seulement pour les Clusters (pas pour les VMs ni les hosts) */}
        {!showConsole && !hostInfo ? (
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1, gap: 1, flexWrap: 'wrap' }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
              <Typography fontWeight={900}>Summary</Typography>
              <Chip size="small" label={kindLabel} variant="outlined" />
              {vmState ? (
                <Chip
                  size="small"
                  label={vmState}
                  variant="outlined"
                  sx={{
                    borderColor: stateColor ? stateColor : 'divider',
                    color: stateColor ? stateColor : 'text.secondary',
                    bgcolor: stateColor ? `${stateColor}14` : 'transparent',
                    fontWeight: 800,
                  }}
                />
              ) : (
                <StatusChip status={status} />
              )}
              {/* KPIs pour les clusters */}
              {kpis && kpis.length > 0 ? (
                kpis.map((kpi, idx) => (
                  <Chip
                    key={idx}
                    size="small"
                    label={`${kpi.label}: ${kpi.value}`}
                    variant="outlined"
                    sx={{ fontWeight: 600 }}
                  />
                ))
              ) : null}
              {/* Version PVE pour les clusters */}
              {clusterPveVersion && (
                <Chip
                  size="small"
                  icon={<i className="ri-server-line" style={{ fontSize: 12 }} />}
                  label={`PVE ${clusterPveVersion.split('.')[0]}.x`}
                  variant="outlined"
                  color="primary"
                  sx={{ fontWeight: 600 }}
                />
              )}
            </Stack>
          </Stack>
        ) : null}

        {showConsole ? (
          <Box
            sx={{
              width: '100%',
              display: 'flex',
              gap: 2,
              alignItems: 'stretch',
              flexDirection: { xs: 'column', md: 'row' },
            }}
          >
            <Box
              sx={{
                flex: 1,
                minWidth: 0,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2,
                p: 1.25,
                pb: 1,
              }}
            >
              <UsageBar themeColor={primaryColor} label="CPU" used={cpuNowPct} capacity={100} mode="pct" />
              <UsageBar themeColor={primaryColor} label="Memory" used={memUsed} capacity={memCap} mode="bytes" />
              <UsageBar themeColor={primaryColor} label="Storage" used={diskUsed} capacity={diskCap} mode="bytes" />
              
              {/* IP et Uptime */}
              <Box sx={{ mt: 1.5, pt: 1.5, borderTop: '1px solid', borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className="ri-global-line" style={{ fontSize: 14, opacity: 0.6 }} />
                  <Typography variant="body2" sx={{ opacity: 0.7 }}>IP:</Typography>
                  {guestInfoLoading ? (
                    <CircularProgress size={12} />
                  ) : guestInfo?.ip ? (
                    <Chip 
                      size="small" 
                      label={guestInfo.ip} 
                      sx={{ 
                        height: 20, 
                        fontSize: '0.75rem', 
                        fontFamily: 'monospace',
                        cursor: 'pointer',
                        '&:hover': { bgcolor: 'action.hover' }
                      }}
                      onClick={() => navigator.clipboard.writeText(guestInfo.ip!)}
                      title={t('inventoryPage.clickToCopy')}
                    />
                  ) : (
                    <Typography variant="body2" sx={{ opacity: 0.4 }}>—</Typography>
                  )}
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className="ri-time-line" style={{ fontSize: 14, opacity: 0.6 }} />
                  <Typography variant="body2" sx={{ opacity: 0.7 }}>Uptime:</Typography>
                  {guestInfoLoading ? (
                    <CircularProgress size={12} />
                  ) : formatUptime(guestInfo?.uptime) ? (
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {formatUptime(guestInfo?.uptime)}
                    </Typography>
                  ) : (
                    <Typography variant="body2" sx={{ opacity: 0.4 }}>—</Typography>
                  )}
                </Box>
              </Box>
            </Box>

            <Box sx={{ width: consoleWidth, flex: '0 0 auto' }}>
              <ConsolePreview 
                height={210} 
                connId={vmInfo?.connId}
                node={vmInfo?.node}
                type={vmInfo?.type}
                vmid={vmInfo?.vmid}
                vmStatus={vmState || undefined}
                osInfo={guestInfo?.osInfo}
                osLoading={guestInfoLoading}
              />
            </Box>
          </Box>
        ) : hostInfo ? (

          /* Affichage détaillé pour les Hosts - 3 colonnes */
          <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', xl: 'row' } }}>
            {/* Colonne 1 - CPU, Load, RAM, HD */}
            <Box
              sx={{
                flex: 1,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2,
                p: 1.25,
              }}
            >
              <UsageBar themeColor={primaryColor} label="CPU usage" used={cpuNowPct} capacity={100} mode="pct" />
              {hostInfo.loadAvg ? (
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <i className="ri-dashboard-3-line" style={{ fontSize: 14, color: primaryColor }} />
                    <Typography variant="body2" sx={{ fontWeight: 700, color: 'text.primary' }}>
                      Load average
                    </Typography>
                  </Box>
                  <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>{hostInfo.loadAvg}</Typography>
                </Box>
              ) : null}
              <UsageBar themeColor={primaryColor} label="RAM usage" used={memUsed} capacity={memCap} mode="bytes" />
              <UsageBar themeColor={primaryColor} label="HD space" used={diskUsed} capacity={diskCap} mode="bytes" />
            </Box>

            {/* Colonne 2 - IO delay, KSM, SWAP */}
            <Box
              sx={{
                flex: 1,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2,
                p: 1.25,
              }}
            >
              {hostInfo.ioDelay != null ? (
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <i className="ri-time-line" style={{ fontSize: 14, color: primaryColor }} />
                    <Typography variant="body2" sx={{ fontWeight: 700, color: 'text.primary' }}>
                      IO delay
                    </Typography>
                  </Box>
                  <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>{hostInfo.ioDelay.toFixed(2)}%</Typography>
                </Box>
              ) : null}
              {hostInfo.ksmSharing != null ? (
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <i className="ri-share-line" style={{ fontSize: 14, color: primaryColor }} />
                    <Typography variant="body2" sx={{ fontWeight: 700, color: 'text.primary' }}>
                      KSM sharing
                    </Typography>
                  </Box>
                  <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>{formatBytes(hostInfo.ksmSharing)}</Typography>
                </Box>
              ) : null}
              {swapCap > 0 ? (
                <UsageBar themeColor={primaryColor} label="SWAP usage" used={swapUsed} capacity={swapCap} mode="bytes" />
              ) : null}
            </Box>

            {/* Colonne 3 - Informations système */}
            <Box
              sx={{
                flex: 1,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2,
                p: 1.25,
              }}
            >
              <Stack spacing={1.25}>
                {hostInfo.cpuModel ? (
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                    <i className="ri-cpu-line" style={{ fontSize: 14, color: primaryColor, marginTop: 2 }} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>CPU(s)</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary', wordBreak: 'break-word' }}>{hostInfo.cpuModel}</Typography>
                    </Box>
                  </Box>
                ) : null}
                {hostInfo.kernelVersion ? (
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                    <i className="ri-terminal-box-line" style={{ fontSize: 14, color: primaryColor, marginTop: 2 }} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>Kernel Version</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary', wordBreak: 'break-word' }}>{hostInfo.kernelVersion}</Typography>
                    </Box>
                  </Box>
                ) : null}
                {hostInfo.bootMode ? (
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                    <i className="ri-restart-line" style={{ fontSize: 14, color: primaryColor, marginTop: 2 }} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>Boot Mode</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>{hostInfo.bootMode}</Typography>
                    </Box>
                  </Box>
                ) : null}
                {hostInfo.pveVersion ? (
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                    <i className="ri-server-line" style={{ fontSize: 14, color: primaryColor, marginTop: 2 }} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>Manager Version</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary', wordBreak: 'break-word' }}>{hostInfo.pveVersion}</Typography>
                    </Box>
                  </Box>
                ) : null}
              </Stack>
            </Box>

            {/* Colonne 4 - Mises à jour disponibles */}
            {hostInfo.updates && hostInfo.updates.length > 0 && (
              <Box
                sx={{
                  flex: hostBlocksCollapsed.updates ? '0 0 auto' : 1,
                  width: hostBlocksCollapsed.updates ? 44 : 'auto',
                  minWidth: hostBlocksCollapsed.updates ? 44 : undefined,
                  border: '1px solid',
                  borderColor: 'warning.main',
                  borderRadius: 2,
                  bgcolor: 'rgba(255, 152, 0, 0.05)',
                  overflow: 'hidden',
                  transition: 'all 0.3s ease',
                }}
              >
                {hostBlocksCollapsed.updates ? (
                  // Mode collapsé vertical - juste une icône cliquable
                  <Box 
                    onClick={() => setHostBlocksCollapsed(prev => ({ ...prev, updates: false }))}
                    sx={{ 
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: '100%',
                      minHeight: 150,
                      cursor: 'pointer',
                      '&:hover': { bgcolor: 'rgba(255, 152, 0, 0.1)' }
                    }}
                  >
                    <i className="ri-download-cloud-line" style={{ fontSize: 20, color: '#ff9800' }} />
                    <Chip 
                      size="small" 
                      label={hostInfo.updates.length} 
                      color="warning"
                      sx={{ height: 18, fontSize: 11, fontWeight: 700, mt: 1 }}
                    />
                    <i className="ri-arrow-right-s-line" style={{ fontSize: 16, opacity: 0.5, marginTop: 8 }} />
                  </Box>
                ) : (
                  // Mode étendu
                  <>
                    <Box 
                      onClick={() => setHostBlocksCollapsed(prev => ({ ...prev, updates: true }))}
                      sx={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'space-between',
                        p: 1.25,
                        pb: 0.75,
                        cursor: 'pointer',
                        '&:hover': { bgcolor: 'rgba(255, 152, 0, 0.08)' }
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <i className="ri-download-cloud-line" style={{ fontSize: 16, color: '#ff9800' }} />
                        <Typography variant="body2" sx={{ fontWeight: 700, color: 'warning.main' }}>
                          {t('updates.availableUpdates')}
                        </Typography>
                        <Chip 
                          size="small" 
                          label={hostInfo.updates.length} 
                          color="warning"
                          sx={{ height: 18, fontSize: 11, fontWeight: 700 }}
                        />
                      </Box>
                      <i className="ri-arrow-left-s-line" style={{ fontSize: 18, opacity: 0.5 }} />
                    </Box>
                    
                    <Box sx={{ px: 1.25, pb: 1.25 }}>
                      <Box sx={{ maxHeight: 120, overflow: 'auto', mb: 1.5 }}>
                        {hostInfo.updates.slice(0, 5).map((update: any, idx: number) => (
                          <Box 
                            key={idx} 
                            sx={{ 
                              display: 'flex', 
                              justifyContent: 'space-between', 
                              alignItems: 'center',
                              py: 0.5,
                              borderBottom: idx < Math.min(hostInfo.updates.length, 5) - 1 ? '1px solid' : 'none',
                              borderColor: 'divider'
                            }}
                          >
                            <Typography variant="caption" sx={{ fontWeight: 500, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {update.package}
                            </Typography>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 1 }}>
                              <Typography variant="caption" sx={{ opacity: 0.5 }}>{update.currentVersion}</Typography>
                              <i className="ri-arrow-right-line" style={{ fontSize: 10, opacity: 0.5 }} />
                              <Typography variant="caption" sx={{ color: 'success.main', fontWeight: 600 }}>{update.newVersion}</Typography>
                            </Box>
                          </Box>
                        ))}
                        {hostInfo.updates.length > 5 && (
                          <Typography variant="caption" sx={{ opacity: 0.6, display: 'block', mt: 0.5 }}>
                            +{hostInfo.updates.length - 5} {t('updates.morePackages')}
                          </Typography>
                        )}
                      </Box>
                      
                      <Stack direction="row" spacing={1}>
                        <Button 
                          size="small" 
                          variant="contained" 
                          color="warning"
                          startIcon={<i className="ri-download-line" />}
                          sx={{ flex: 1, fontSize: '0.7rem' }}
                          onClick={() => setUpgradeDialogOpen(true)}
                        >
                          {t('updates.upgrade')}
                        </Button>
                        <Button 
                          size="small" 
                          variant="outlined" 
                          color="warning"
                          startIcon={<i className="ri-file-list-line" />}
                          sx={{ fontSize: '0.7rem' }}
                          onClick={() => setChangelogDialogOpen(true)}
                        >
                          Changelog
                        </Button>
                      </Stack>
                    </Box>
                  </>
                )}
              </Box>
            )}

            {/* Colonne 5 - Subscription Status */}
            {hostInfo.subscription && (() => {
              // Calculer si l'échéance est proche (moins de 30 jours)
              const isActive = hostInfo.subscription.status === 'active'
              const nextDueDate = hostInfo.subscription.nextDueDate ? new Date(hostInfo.subscription.nextDueDate) : null
              const daysUntilDue = nextDueDate ? Math.ceil((nextDueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null
              const isExpiringSoon = isActive && daysUntilDue !== null && daysUntilDue <= 30 && daysUntilDue > 0
              const isExpired = !isActive || (daysUntilDue !== null && daysUntilDue <= 0)
              
              // Déterminer la couleur selon le statut
              const statusColor = isExpired ? '#f44336' : isExpiringSoon ? '#ff9800' : '#4caf50'
              const statusBgColor = isExpired ? 'rgba(244, 67, 54, 0.05)' : isExpiringSoon ? 'rgba(255, 152, 0, 0.05)' : 'rgba(76, 175, 80, 0.05)'
              const statusHoverBgColor = isExpired ? 'rgba(244, 67, 54, 0.1)' : isExpiringSoon ? 'rgba(255, 152, 0, 0.1)' : 'rgba(76, 175, 80, 0.1)'
              const chipColor = isExpired ? 'error' : isExpiringSoon ? 'warning' : 'success'
              
              return (
              <Box
                sx={{
                  flex: hostBlocksCollapsed.subscription ? '0 0 auto' : 1,
                  width: hostBlocksCollapsed.subscription ? 44 : 'auto',
                  minWidth: hostBlocksCollapsed.subscription ? 44 : undefined,
                  border: '1px solid',
                  borderColor: statusColor,
                  borderRadius: 2,
                  bgcolor: statusBgColor,
                  overflow: 'hidden',
                  transition: 'all 0.3s ease',
                }}
              >
                {hostBlocksCollapsed.subscription ? (
                  // Mode collapsé vertical - juste une icône cliquable
                  <Box 
                    onClick={() => setHostBlocksCollapsed(prev => ({ ...prev, subscription: false }))}
                    sx={{ 
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: '100%',
                      minHeight: 150,
                      cursor: 'pointer',
                      '&:hover': { bgcolor: statusHoverBgColor }
                    }}
                  >
                    <i className="ri-vip-crown-line" style={{ fontSize: 20, color: statusColor }} />
                    <Chip 
                      size="small" 
                      label={isExpired ? '✗' : isExpiringSoon ? '!' : '✓'}
                      color={chipColor}
                      sx={{ height: 18, fontSize: 11, fontWeight: 700, mt: 1 }}
                    />
                    <i className="ri-arrow-right-s-line" style={{ fontSize: 16, opacity: 0.5, marginTop: 8 }} />
                  </Box>
                ) : (
                  // Mode étendu
                  <>
                    <Box 
                      onClick={() => setHostBlocksCollapsed(prev => ({ ...prev, subscription: true }))}
                      sx={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'space-between',
                        p: 1.25,
                        pb: 0.75,
                        cursor: 'pointer',
                        '&:hover': { bgcolor: statusHoverBgColor }
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <i className="ri-vip-crown-line" style={{ fontSize: 16, color: statusColor }} />
                        <Typography variant="body2" sx={{ fontWeight: 700, color: statusColor }}>
                          Subscription
                        </Typography>
                        <Chip 
                          size="small" 
                          label={isExpired ? t('subscription.inactive') : isExpiringSoon ? t('subscription.expiringSoon') : t('subscription.active')}
                          color={chipColor}
                          sx={{ height: 18, fontSize: 11, fontWeight: 700 }}
                        />
                      </Box>
                      <i className="ri-arrow-left-s-line" style={{ fontSize: 18, opacity: 0.5 }} />
                    </Box>
                    
                    <Box sx={{ px: 1.25, pb: 1.25 }}>
                      <Stack spacing={1}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Typography variant="caption" sx={{ opacity: 0.6 }}>{t('subscription.type')}</Typography>
                          <Typography variant="caption" sx={{ fontWeight: 600, textAlign: 'right', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hostInfo.subscription.type}</Typography>
                        </Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Typography variant="caption" sx={{ opacity: 0.6 }}>{t('subscription.key')}</Typography>
                          <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: 10 }}>{hostInfo.subscription.key}</Typography>
                        </Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Typography variant="caption" sx={{ opacity: 0.6 }}>{t('subscription.serverId')}</Typography>
                          <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: 9, opacity: 0.8 }}>{hostInfo.subscription.serverId?.substring(0, 16)}...</Typography>
                        </Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Typography variant="caption" sx={{ opacity: 0.6 }}>{t('subscription.sockets')}</Typography>
                          <Typography variant="caption" sx={{ fontWeight: 600 }}>{hostInfo.subscription.sockets}</Typography>
                        </Box>
                        <Divider sx={{ my: 0.5 }} />
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Typography variant="caption" sx={{ opacity: 0.6 }}>{t('subscription.lastChecked')}</Typography>
                          <Typography variant="caption">{hostInfo.subscription.lastChecked}</Typography>
                        </Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Typography variant="caption" sx={{ opacity: 0.6 }}>{t('subscription.nextDueDate')}</Typography>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            {isExpiringSoon && <i className="ri-error-warning-line" style={{ fontSize: 12, color: '#ff9800' }} />}
                            <Typography variant="caption" sx={{ fontWeight: 600, color: statusColor }}>
                              {hostInfo.subscription.nextDueDate}
                              {isExpiringSoon && daysUntilDue !== null && ` (${daysUntilDue}j)`}
                            </Typography>
                          </Box>
                        </Box>
                      </Stack>
                      
                      <Box sx={{ mt: 1.5 }}>
                        <Button 
                          size="small" 
                          variant="outlined"
                          fullWidth
                          startIcon={checkingSubscription ? <CircularProgress size={12} /> : <i className="ri-refresh-line" />}
                          sx={{ fontSize: '0.65rem', borderColor: statusColor, color: statusColor }}
                          onClick={handleCheckSubscription}
                          disabled={checkingSubscription}
                        >
                          {t('subscription.check')}
                        </Button>
                      </Box>
                    </Box>
                  </>
                )}
              </Box>
              )
            })()}
          </Box>
        ) : (
          <Box
            sx={{
              width: '100%',
              display: 'flex',
              gap: 2,
              alignItems: 'stretch',
              flexDirection: { xs: 'column', md: 'row' },
            }}
          >
            {/* Bloc CPU/RAM/Storage */}
            <Box
              sx={{
                flex: 1,
                minWidth: 0,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2,
                p: 1.25,
              }}
            >
              {/* Pour PBS et Datastore, n'afficher que Storage */}
              {kindLabel === 'PBS' || kindLabel === 'DATASTORE' ? (
                <UsageBar themeColor={primaryColor} label="Storage" used={diskUsed} capacity={diskCap} mode="bytes" />
              ) : (
                <>
                  <UsageBar themeColor={primaryColor} label="CPU" used={cpuNowPct} capacity={100} mode="pct" />
                  <UsageBar themeColor={primaryColor} label="Memory" used={memUsed} capacity={memCap} mode="bytes" />
                  <UsageBar themeColor={primaryColor} label="Storage" used={diskUsed} capacity={diskCap} mode="bytes" />
                </>
              )}
            </Box>

            {/* Bloc Health (uniquement pour CLUSTER) */}
          </Box>
        )}
      </CardContent>

      {/* Modal de mise à jour */}
      <Dialog 
        open={upgradeDialogOpen} 
        onClose={() => setUpgradeDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-download-cloud-line" style={{ fontSize: 24, color: '#ff9800' }} />
          {t('updates.upgradeTitle')}
        </DialogTitle>
        <DialogContent>
          {/* Résumé des mises à jour */}
          <Alert 
            severity={hasKernelUpdate ? 'warning' : 'info'} 
            sx={{ mb: 2 }}
            icon={hasKernelUpdate ? <i className="ri-restart-line" style={{ fontSize: 20 }} /> : <i className="ri-information-line" style={{ fontSize: 20 }} />}
          >
            <Box>
              <Typography variant="body2" fontWeight={600}>
                {hostInfo?.updates?.length || 0} {t('updates.packagesToUpdate')}
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

          {/* Liste des paquets */}
          <Box sx={{ 
            maxHeight: 300, 
            overflow: 'auto', 
            border: '1px solid', 
            borderColor: 'divider', 
            borderRadius: 1,
            mb: 2
          }}>
            {/* Header */}
            <Box sx={{ 
              display: 'grid', 
              gridTemplateColumns: '1fr 120px 120px',
              gap: 1,
              px: 1.5,
              py: 1,
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
            {hostInfo?.updates?.map((update: any, idx: number) => (
              <Box 
                key={idx}
                sx={{ 
                  display: 'grid', 
                  gridTemplateColumns: '1fr 120px 120px',
                  gap: 1,
                  px: 1.5,
                  py: 0.75,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  '&:last-child': { borderBottom: 'none' },
                  '&:hover': { bgcolor: 'action.hover' },
                  bgcolor: update.package?.toLowerCase().includes('kernel') ? 'rgba(255, 152, 0, 0.1)' : 'transparent'
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  {update.package?.toLowerCase().includes('kernel') && (
                    <i className="ri-restart-line" style={{ fontSize: 12, color: '#ff9800' }} />
                  )}
                  <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {update.package}
                  </Typography>
                </Box>
                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 11, opacity: 0.6 }}>
                  {update.currentVersion}
                </Typography>
                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 11, color: 'success.main', fontWeight: 600 }}>
                  {update.newVersion}
                </Typography>
              </Box>
            ))}
          </Box>

          {/* Sélection du type de console */}
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            {t('updates.selectConsole')}
          </Typography>
          <Stack direction="row" spacing={2}>
            <Button
              variant="contained"
              color="warning"
              startIcon={<i className="ri-terminal-box-line" />}
              onClick={() => handleStartUpgrade('xterm')}
              sx={{ flex: 1 }}
            >
              xterm.js
            </Button>
            <Button
              variant="outlined"
              color="warning"
              startIcon={<i className="ri-computer-line" />}
              onClick={() => handleStartUpgrade('novnc')}
              sx={{ flex: 1 }}
            >
              noVNC
            </Button>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUpgradeDialogOpen(false)}>
            {t('common.cancel')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Modal Changelog */}
      <Dialog 
        open={changelogDialogOpen} 
        onClose={() => setChangelogDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-file-list-line" style={{ fontSize: 24, color: '#ff9800' }} />
          Changelog
        </DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          {/* Liste des paquets avec changelog */}
          <Box sx={{ maxHeight: 500, overflow: 'auto' }}>
            {hostInfo?.updates?.map((update: any, idx: number) => (
              <Accordion 
                key={idx} 
                disableGutters
                elevation={0}
                square
                sx={{ 
                  '&:before': { display: 'none' },
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  '&:last-child': { borderBottom: 'none' }
                }}
              >
                <AccordionSummary 
                  expandIcon={<i className="ri-arrow-down-s-line" />}
                  sx={{ minHeight: 44, '& .MuiAccordionSummary-content': { my: 0 } }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                    <Typography variant="body2" fontWeight={600} sx={{ flex: 1 }}>
                      {update.package}
                    </Typography>
                    <Chip 
                      size="small" 
                      label={`${update.currentVersion || 'null'} → ${update.newVersion}`}
                      sx={{ height: 20, fontSize: 10, fontFamily: 'monospace' }}
                    />
                  </Box>
                </AccordionSummary>
                <AccordionDetails sx={{ bgcolor: 'action.hover', py: 1.5 }}>
                  <Typography variant="caption" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', opacity: 0.8 }}>
                    {update.description || t('updates.noChangelogAvailable')}
                  </Typography>
                </AccordionDetails>
              </Accordion>
            ))}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setChangelogDialogOpen(false)}>
            {t('common.close')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Console de mise à jour (xterm/VNC) */}
      <Dialog 
        open={upgradeConsoleOpen} 
        onClose={() => setUpgradeConsoleOpen(false)}
        maxWidth="lg"
        fullWidth
        PaperProps={{ sx: { height: '80vh' } }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className="ri-terminal-box-line" style={{ fontSize: 24 }} />
            {t('updates.upgradeInProgress')}
          </Box>
          <IconButton onClick={() => setUpgradeConsoleOpen(false)} size="small">
            <i className="ri-close-line" />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 0, display: 'flex', flexDirection: 'column' }}>
          {connId && nodeName && upgradeTaskId && (
            <Box sx={{ flex: 1, bgcolor: '#000', p: 1 }}>
              <iframe
                src={`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(nodeName)}/console?type=xterm`}
                style={{ 
                  width: '100%', 
                  height: '100%', 
                  border: 'none',
                  backgroundColor: '#000'
                }}
                title="Upgrade Console"
              />
            </Box>
          )}
          {!upgradeTaskId && (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
              <CircularProgress />
            </Box>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* RRD time-series helpers                                            */
/* ------------------------------------------------------------------ */

type RrdTimeframe = 'hour' | 'day' | 'week' | 'month' | 'year'

type SeriesPoint = {
  t: number
  cpuPct?: number
  ramPct?: number
  loadAvg?: number        // Pour les nodes
  netInBps?: number
  netOutBps?: number
  diskReadBps?: number    // Pour les VMs
  diskWriteBps?: number   // Pour les VMs
}

function pickNumber(obj: any, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj?.[k]
    const n = Number(v)

    if (Number.isFinite(n)) return n
  }

  
return null
}

async function fetchRrd(connectionId: string, path: string, timeframe: RrdTimeframe) {
  const res = await fetch(
    `/api/v1/connections/${encodeURIComponent(connectionId)}/rrd?path=${encodeURIComponent(path)}&timeframe=${encodeURIComponent(timeframe)}`,
    { cache: 'no-store' }
  )

  const json = await res.json()

  if (!res.ok) throw new Error(json?.error || `RRD HTTP ${res.status}`)
  
return asArray<any>(safeJson<any>(json))
}

function buildSeriesFromRrd(raw: any[], maxMem?: number): SeriesPoint[] {
  const out: SeriesPoint[] = []

  for (const p of raw) {
    const tSec = pickNumber(p, ['time', 't', 'timestamp'])

    if (!tSec) continue
    const t = Math.round(tSec) * 1000

    const cpuRaw = pickNumber(p, ['cpu', 'cpu_avg', 'cpuutil', 'cpuused'])

    const cpuPctVal =
      cpuRaw == null ? undefined : Math.max(0, Math.min(100, Math.round(cpuRaw <= 1.5 ? cpuRaw * 100 : cpuRaw)))

    // Pour la RAM, Proxmox peut retourner:
    // - mem: valeur en bytes (pour les VMs)
    // - mem: fraction 0-1 (pour certains contexts)
    // On doit aussi récupérer maxmem pour calculer le pourcentage
    const memRaw = pickNumber(p, ['mem', 'mem_avg', 'memory', 'memused', 'memtotal'])
    const maxMemRaw = pickNumber(p, ['maxmem', 'max_mem', 'memtotal', 'total']) || maxMem
    
    let ramPctVal: number | undefined = undefined

    if (memRaw != null) {
      // Si memRaw est très petit (< 2), c'est probablement une fraction
      if (memRaw <= 1.5) {
        ramPctVal = Math.max(0, Math.min(100, Math.round(memRaw * 100)))
      } else if (maxMemRaw && maxMemRaw > 0) {
        // memRaw est en bytes, calculer le pourcentage
        ramPctVal = Math.max(0, Math.min(100, Math.round((memRaw / maxMemRaw) * 100)))
      }
    }

    // Network: Proxmox peut retourner différents noms selon le contexte
    // Pour les nodes: netin/netout peuvent être absents ou nommés différemment
    // Pour les VMs: netin/netout sont généralement présents
    const netIn = pickNumber(p, ['netin', 'net_in', 'nics_netin', 'network_in'])
    const netOut = pickNumber(p, ['netout', 'net_out', 'nics_netout', 'network_out'])

    // Server Load (pour les nodes uniquement)
    const loadAvg = pickNumber(p, ['loadavg', 'load_avg', 'load'])

    // Disk I/O (pour les VMs uniquement)
    const diskRead = pickNumber(p, ['diskread', 'disk_read'])
    const diskWrite = pickNumber(p, ['diskwrite', 'disk_write'])

    out.push({
      t,
      cpuPct: cpuPctVal,
      ramPct: ramPctVal,
      loadAvg: loadAvg ?? undefined,
      netInBps: netIn ?? undefined,
      netOutBps: netOut ?? undefined,
      diskReadBps: diskRead ?? undefined,
      diskWriteBps: diskWrite ?? undefined,
    })
  }

  out.sort((a, b) => a.t - b.t)
  
return out
}

/* ---------------------- Charts (filled areas) ---------------------- */

function AreaPctChart({
  title,
  data,
  dataKey,
  color,
  height = 240,
}: {
  title: string
  data: SeriesPoint[]
  dataKey: 'cpuPct' | 'ramPct'
  color?: string
  height?: number
}) {
  const theme = useTheme()
  const chartColor = color || theme.palette.primary.main
  
  return (
    <Card variant="outlined" sx={{ width: '100%', borderRadius: 2 }}>
      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Typography fontWeight={700} fontSize={13} sx={{ mb: 0.5 }}>
          {title}
        </Typography>

        <Box sx={{ width: '100%', height }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <XAxis dataKey="t" tickFormatter={v => formatTime(Number(v))} minTickGap={24} tick={{ fontSize: 10 }} />
              <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 10 }} width={35} />
              <Tooltip
                labelFormatter={v => new Date(Number(v)).toLocaleString()}
                formatter={(v: any) => {
                  const n = Number(v)

                  
return [Number.isFinite(n) ? `${n}%` : '—', '']
                }}
              />
              <Area
                type="monotone"
                dataKey={dataKey}
                dot={false}
                stroke={chartColor}
                fill={chartColor}
                fillOpacity={0.18}
                strokeWidth={2}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </Box>
      </CardContent>
    </Card>
  )
}

function AreaBpsChart2({
  title,
  data,
  keyA,
  keyB,
  labelA,
  labelB,
  colorA,
  colorB,
  height = 260,
}: {
  title: string
  data: SeriesPoint[]
  keyA: keyof SeriesPoint
  keyB: keyof SeriesPoint
  labelA: string
  labelB: string
  colorA?: string
  colorB?: string
  height?: number
}) {
  const theme = useTheme()
  const chartColorA = colorA || theme.palette.primary.main
  const chartColorB = colorB || lighten(theme.palette.primary.main, 0.3)
  
  return (
    <Card variant="outlined" sx={{ width: '100%', borderRadius: 2 }}>
      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Typography fontWeight={700} fontSize={13} sx={{ mb: 0.5 }}>
          {title}
        </Typography>

        <Box sx={{ width: '100%', height }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <XAxis dataKey="t" tickFormatter={v => formatTime(Number(v))} minTickGap={24} tick={{ fontSize: 10 }} />
              <YAxis tickFormatter={v => formatBps(Number(v))} tick={{ fontSize: 10 }} width={50} />
              <Tooltip
                labelFormatter={v => new Date(Number(v)).toLocaleString()}
                formatter={(v: any, name: any) => {
                  const n = Number(v)

                  
return [Number.isFinite(n) ? formatBps(n) : '—', name]
                }}
              />
              <Area
                type="monotone"
                dataKey={keyA as any}
                name={labelA}
                dot={false}
                stroke={chartColorA}
                fill={chartColorA}
                fillOpacity={0.14}
                strokeWidth={2}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey={keyB as any}
                name={labelB}
                dot={false}
                stroke={chartColorB}
                fill={chartColorB}
                fillOpacity={0.14}
                strokeWidth={2}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </Box>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Fetch details (cluster/node/vm)                                     */
/* ------------------------------------------------------------------ */

async function fetchDetails(sel: InventorySelection): Promise<DetailsPayload> {
  const lastUpdated = new Date().toLocaleString()

  if (sel.type === 'cluster') {
    const [connR, nodesR, resourcesR, cephR] = await Promise.all([
      fetch(`/api/v1/connections/${encodeURIComponent(sel.id)}`, { cache: 'no-store' }),
      fetch(`/api/v1/connections/${encodeURIComponent(sel.id)}/nodes`, { cache: 'no-store' }),
      fetch(`/api/v1/connections/${encodeURIComponent(sel.id)}/resources`, { cache: 'no-store' }),
      fetch(`/api/v1/connections/${encodeURIComponent(sel.id)}/ceph/status`, { cache: 'no-store' }).catch(() => null),
    ])
    
    let connName = sel.id
    let cephHealth: string | undefined

    try {
      const connData = await connR.json()

      connName = connData?.name || connData?.data?.name || sel.id
    } catch {}

    // Récupérer le statut Ceph
    if (cephR?.ok) {
      try {
        const cephData = await cephR.json()
        const healthData = cephData.data?.health || cephData.health
        if (typeof healthData === 'string') {
          cephHealth = healthData
        } else if (healthData?.status) {
          cephHealth = healthData.status
        }
      } catch {}
    }
    
    const nodes = asArray<any>(safeJson(await nodesR.json()))
    const guests = asArray<any>(safeJson(await resourcesR.json()))

    const onlineNodes = nodes.filter((n: any) => n.status === 'online').length
    const runningVMs = guests.filter((g: any) => g.status === 'running').length
    const totalVMs = guests.length

    // Calculer les moyennes/totaux des ressources des nodes
    let totalCpu = 0
    let totalMem = 0
    let totalMaxMem = 0
    let totalDisk = 0
    let totalMaxDisk = 0

    for (const n of nodes) {
      totalCpu += Number(n.cpu ?? 0)
      totalMem += Number(n.mem ?? 0)
      totalMaxMem += Number(n.maxmem ?? 0)
      totalDisk += Number(n.disk ?? 0)
      totalMaxDisk += Number(n.maxdisk ?? 0)
    }

    const avgCpuPct = nodes.length > 0 ? cpuPct(totalCpu / nodes.length) : 0
    const memPct = totalMaxMem > 0 ? pct(totalMem, totalMaxMem) : 0
    const diskPct = totalMaxDisk > 0 ? pct(totalDisk, totalMaxDisk) : 0

    // Préparer les données des nodes pour le tableau
    const nodesData = nodes.map((n: any) => {
      const vmCount = guests.filter((g: any) => g.node === n.node).length

      
return {
        id: `${sel.id}:${n.node}`,
        connId: sel.id,
        node: n.node,
        name: n.node,
        status: n.status === 'online' ? 'online' as const : 'offline' as const,
        cpu: cpuPct(n.cpu),
        ram: pct(Number(n.mem ?? 0), Number(n.maxmem ?? 0)),
        storage: pct(Number(n.disk ?? 0), Number(n.maxdisk ?? 0)),
        vms: vmCount,
        uptime: Number(n.uptime ?? 0),
        ip: n.ip || undefined,
      }
    })

    // Préparer les données des VMs pour l'onglet VMs
    const allVms = guests.map((g: any) => ({
      id: `${sel.id}:${g.node}:${g.type}:${g.vmid}`,
      connId: sel.id,
      node: g.node,
      vmid: g.vmid,
      name: g.name || `VM ${g.vmid}`,
      status: g.status,
      type: g.type,
      template: g.template === 1,
      cpu: cpuPct(g.cpu),
      cpuPct: cpuPct(g.cpu),
      ram: pct(Number(g.mem ?? 0), Number(g.maxmem ?? 0)),
      memPct: pct(Number(g.mem ?? 0), Number(g.maxmem ?? 0)),
      maxmem: Number(g.maxmem ?? 0),
      disk: Number(g.disk ?? 0),
      maxdisk: Number(g.maxdisk ?? 0),
      uptime: Number(g.uptime ?? 0),
      tags: g.tags ? String(g.tags).split(';').filter(Boolean) : [],
    }))

    return {
      kindLabel: 'CLUSTER',
      title: connName,
      subtitle: undefined,
      breadcrumb: ['Infrastructure', 'Inventaire', 'Cluster', connName],
      status: onlineNodes === nodes.length ? 'ok' : onlineNodes > 0 ? 'warn' : 'crit',
      tags: [],
      kpis: [
        { label: 'Nodes', value: `${onlineNodes}/${nodes.length}` },
        { label: 'VMs', value: `${runningVMs}/${totalVMs}` },
      ],
      metrics: {
        cpu: { label: 'CPU (avg)', pct: avgCpuPct, used: avgCpuPct, max: 100 },
        ram: { label: 'RAM (total)', pct: memPct, used: totalMem, max: totalMaxMem },
        storage: { label: 'Storage (total)', pct: diskPct, used: totalDisk, max: totalMaxDisk },
      },
      properties: [],
      lastUpdated,
      nodesData,
      allVms,
      vmsCount: totalVMs,
      cephHealth,
    }
  }

  if (sel.type === 'node') {
    const { connId, node } = parseNodeId(sel.id)

    // Récupérer les infos de base + les infos détaillées du node + les VMs + la version + subscription + updates
    const [nodesR, statusR, resourcesR, versionR, subscriptionR, updatesR] = await Promise.all([
      fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes`, { cache: 'no-store' }),
      fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/status`, { cache: 'no-store' }).catch(() => null),
      fetch(`/api/v1/connections/${encodeURIComponent(connId)}/resources`, { cache: 'no-store' }).catch(() => null),
      fetch(`/api/v1/connections/${encodeURIComponent(connId)}/version`, { cache: 'no-store' }).catch(() => null),
      fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/subscription`, { cache: 'no-store' }).catch(() => null),
      fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/apt`, { cache: 'no-store' }).catch(() => null),
    ])
    
    const nodes = asArray<any>(safeJson(await nodesR.json()))
    const n = nodes.find((x: any) => String(x.node) === String(node))

    if (!n) throw new Error('Node not found')

    // Récupérer les VMs de ce node
    let vmsData: DetailsPayload['vmsData'] = []

    if (resourcesR && resourcesR.ok) {
      try {
        const resources = asArray<any>(safeJson(await resourcesR.json()))

        const nodeVms = resources.filter((r: any) => 
          r.node === node && (r.type === 'qemu' || r.type === 'lxc')
        )

        vmsData = nodeVms.map((vm: any) => ({
          id: `${connId}:${vm.node}:${vm.type}:${vm.vmid}`,
          connId,
          node: vm.node,
          vmid: vm.vmid,
          name: vm.name || `VM ${vm.vmid}`,
          type: vm.type as 'qemu' | 'lxc',
          status: vm.status || 'unknown',
          cpu: vm.status === 'running' ? cpuPct(vm.cpu) : undefined,
          ram: vm.status === 'running' ? pct(Number(vm.mem ?? 0), Number(vm.maxmem ?? 0)) : undefined,
          maxmem: Number(vm.maxmem ?? 0),
          maxdisk: Number(vm.maxdisk ?? 0),
          uptime: Number(vm.uptime ?? 0),
          tags: parseTags(vm.tags),
          template: vm.template === 1,
        }))
      } catch {}
    }

    // Infos détaillées du status (peut échouer)
    let statusData: any = null

    if (statusR && statusR.ok) {
      try {
        statusData = safeJson<any>(await statusR.json())
      } catch {}
    }

    // Version PVE depuis /version (plus fiable)
    let versionData: any = null

    if (versionR && versionR.ok) {
      try {
        versionData = safeJson<any>(await versionR.json())
      } catch {}
    }

    // Subscription data
    let subscriptionData: any = null

    if (subscriptionR && subscriptionR.ok) {
      try {
        const subResponse = await subscriptionR.json()
        subscriptionData = subResponse?.data || null
      } catch {}
    }

    // Updates data
    let updatesData: any[] = []

    if (updatesR && updatesR.ok) {
      try {
        const updResponse = await updatesR.json()
        updatesData = updResponse?.data || []
      } catch {}
    }

    const c = cpuPct(n.cpu)
    const r = pct(Number(n.mem ?? 0), Number(n.maxmem ?? 0))
    const d = pct(Number(n.disk ?? 0), Number(n.maxdisk ?? 0))

    // SWAP
    const swapUsed = Number(statusData?.swap?.used ?? 0)
    const swapTotal = Number(statusData?.swap?.total ?? 0)
    const swapPct = swapTotal > 0 ? pct(swapUsed, swapTotal) : 0

    // Uptime formaté
    const uptimeSec = Number(n.uptime ?? statusData?.uptime ?? 0)
    const uptimeStr = uptimeSec > 0 ? formatUptime(uptimeSec) : '—'

    // CPU info
    const cpuInfo = statusData?.cpuinfo || {}
    const cpuModel = cpuInfo.model || cpuInfo.cpus ? `${cpuInfo.cpus || '?'} x ${cpuInfo.model || 'Unknown'}` : null
    const cpuCores = cpuInfo.cores
    const cpuSockets = cpuInfo.sockets

    // Kernel & PVE version
    const kernelVersion = statusData?.kversion || statusData?.['kernel-version'] || null

    // Essayer statusData.pveversion d'abord, sinon utiliser versionData
    let pveVersionRaw = statusData?.pveversion || versionData?.version || null

    // Formater la version: "pve-manager/8.4.14/hash" -> "8.4.14"
    let pveVersion = pveVersionRaw

    if (pveVersionRaw && pveVersionRaw.includes('/')) {
      const parts = pveVersionRaw.split('/')

      pveVersion = parts[1] || pveVersionRaw // Prendre la 2ème partie (le numéro de version)
    }

    // Boot mode
    const bootMode = statusData?.['boot-info']?.mode?.toUpperCase() || null

    // Load average
    let loadAvg: string | null = null

    if (statusData?.loadavg) {
      if (Array.isArray(statusData.loadavg)) {
        loadAvg = statusData.loadavg
          .map((v: any) => {
            const num = Number(v)

            
return Number.isFinite(num) ? num.toFixed(2) : String(v)
          })
          .join(', ')
      } else {
        loadAvg = String(statusData.loadavg)
      }
    }

    // IO delay
    const ioDelayRaw = statusData?.wait
    const ioDelay = ioDelayRaw != null && Number.isFinite(Number(ioDelayRaw)) ? Number(ioDelayRaw) * 100 : null

    // KSM sharing
    const ksmSharing = statusData?.ksm?.shared ?? null

    // Un cluster a plus d'un node - récupérer le nom du cluster
    const isPartOfCluster = nodes.length > 1
    let clusterName: string | null = null
    
    if (isPartOfCluster) {
      try {
        // Essayer de récupérer le nom du cluster via /cluster/status
        const clusterStatusR = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/cluster`, { cache: 'no-store' })
        if (clusterStatusR.ok) {
          const clusterData = await clusterStatusR.json()
          clusterName = clusterData?.data?.name || 'Cluster'
        }
      } catch {
        clusterName = 'Cluster' // Fallback si on ne peut pas récupérer le nom
      }
    }

    return {
      kindLabel: 'HOST',
      title: node,
      subtitle: undefined,  // L'uptime est maintenant affiché en haut à droite
      breadcrumb: ['Infrastructure', 'Inventaire', 'Host', node],
      status: n.status === 'online' ? 'ok' : 'crit',
      tags: [],
      kpis: [],
      metrics: {
        cpu: { label: 'CPU', pct: c, used: c, max: 100 },
        ram: { label: 'RAM', pct: r, used: Number(n.mem ?? 0), max: Number(n.maxmem ?? 0) },
        storage: { label: 'Storage', pct: d, used: Number(n.disk ?? 0), max: Number(n.maxdisk ?? 0) },
        swap: swapTotal > 0 ? { label: 'SWAP', pct: swapPct, used: swapUsed, max: swapTotal } : undefined,
      },
      properties: [],
      lastUpdated,
      hostInfo: {
        uptime: uptimeSec,
        cpuModel: cpuModel,
        cpuCores,
        cpuSockets,
        kernelVersion,
        pveVersion,
        bootMode,
        loadAvg,
        ioDelay,
        ksmSharing,
        // Données de mises à jour depuis l'API
        updates: updatesData || [],
        // Données de subscription depuis l'API
        subscription: subscriptionData,
      },
      vmsData,
      clusterName, // null si standalone, nom du cluster sinon
    }
  }

  if (sel.type === 'vm') {
    const { connId, node, type, vmid } = parseVmId(sel.id)

    // Optimisation: utiliser /cluster/resources au lieu de /guests (qui est très lent)
    // /guests fait des appels pour snapshots + IP pour CHAQUE VM
    const [resourcesR, nodesR, configR] = await Promise.all([
      fetch(`/api/v1/connections/${encodeURIComponent(connId)}/resources`, { cache: 'no-store' }),
      fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes`, { cache: 'no-store' }),
      fetch(`/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/config`, { cache: 'no-store' }).catch(() => null),
    ])
    
    const resources = asArray<any>(safeJson(await resourcesR.json()))
    const nodes = asArray<any>(safeJson(await nodesR.json()))

    // Un cluster a plus d'un node
    const isCluster = nodes.length > 1

    // Trouver le nœud hébergeant la VM pour récupérer ses capacités
    const hostNode = nodes.find((n: any) => n.node === node)
    const nodeCapacity = {
      maxCpu: hostNode?.maxcpu || 128,
      maxMem: hostNode?.maxmem || 128 * 1024 * 1024 * 1024, // 128 GB par défaut
    }

    // Trouver la VM dans les resources
    const g = resources.find(
      (x: any) => String(x.node) === String(node) && String(x.type) === String(type) && String(x.vmid) === String(vmid)
    )

    if (!g) throw new Error('VM not found')

    const c = cpuPct(g.cpu)
    const r = pct(Number(g.mem ?? 0), Number(g.maxmem ?? 0))
    const d = pct(Number(g.disk ?? 0), Number(g.maxdisk ?? 0))

    const vmTags = parseTags(g.tags)

    // Parser la configuration pour extraire les infos matérielles et options
    let cpuInfo: any = {}
    let memoryInfo: any = {}
    let disksInfo: any[] = []
    let networkInfo: any[] = []
    let optionsInfo: any = {}
    let name = g.name || `VM ${vmid}`
    let description = ''
    
    if (configR && configR.ok) {
      try {
        const configData = await configR.json()
        const config = configData?.data || configData
        
        // Nom et description
        name = config.name || name
        description = config.description || ''
        
        // Extraire les pending changes (format: config.pending ou config[key] avec [pending] dans le nom)
        // Proxmox retourne les pending dans un objet séparé
        const pending = config.pending || {}
        
        // CPU Info avec pending
        cpuInfo = {
          sockets: config.sockets || 1,
          cores: config.cores || 1,
          type: config.cpu || 'kvm64',
          cpulimit: config.cpulimit,
          cpuunits: config.cpuunits,
          numa: config.numa === 1 || config.numa === true,
          pending: (pending.sockets !== undefined || pending.cores !== undefined || pending.cpu !== undefined || pending.cpulimit !== undefined) ? {
            sockets: pending.sockets,
            cores: pending.cores,
            cpu: pending.cpu,
            cpulimit: pending.cpulimit,
          } : undefined,
        }
        
        // Memory Info avec pending
        memoryInfo = {
          memory: config.memory || 512,
          balloon: config.balloon !== undefined ? config.balloon : config.memory,
          shares: config.shares,
          pending: (pending.memory !== undefined || pending.balloon !== undefined) ? {
            memory: pending.memory,
            balloon: pending.balloon,
          } : undefined,
        }
        
        // Disks
        Object.keys(config).forEach(key => {
          if (key.match(/^(scsi|ide|sata|virtio)\d+$/)) {
            const diskStr = config[key]

            // Parse format: "local-lvm:vm-100-disk-0,size=32G"
            const parts = String(diskStr).split(',')
            const storagePart = parts[0].split(':')
            const sizeMatch = diskStr.match(/size=(\d+[GMT]?)/i)
            
            disksInfo.push({
              id: key,
              storage: storagePart[0] || 'unknown',
              size: sizeMatch ? sizeMatch[1] : 'unknown',
              format: diskStr.includes('format=') ? diskStr.match(/format=(\w+)/)?.[1] : 'raw',
              cache: diskStr.match(/cache=(\w+)/)?.[1],
              iothread: diskStr.includes('iothread=1'),
            })
          }
        })
        
        // Network
        Object.keys(config).forEach(key => {
          if (key.match(/^net\d+$/)) {
            const netStr = config[key]

            // Parse format: "virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0,firewall=1,tag=100"
            const parts = String(netStr).split(',')
            const netInfo: any = { id: key }
            
            parts.forEach(part => {
              const [k, v] = part.split('=')

              if (k === 'bridge') netInfo.bridge = v
              else if (k === 'tag') netInfo.tag = Number(v)
              else if (k === 'firewall') netInfo.firewall = v === '1'
              else if (k === 'rate') netInfo.rate = Number(v)
              else if (['virtio', 'e1000', 'rtl8139', 'vmxnet3'].includes(k)) {
                netInfo.model = k
                netInfo.macaddr = v
              }
            })
            
            networkInfo.push(netInfo)
          }
        })
        
        // Options
        optionsInfo = {
          onboot: config.onboot === 1 || config.onboot === true,
          protection: config.protection === 1 || config.protection === true,
          startAtBoot: config.onboot === 1 || config.onboot === true,
          startupOrder: config.startup || 'order=any',
          ostype: config.ostype || 'other',
          bootOrder: config.boot || '',
          useTablet: config.tablet !== 0 && config.tablet !== false,
          hotplug: config.hotplug || 'Disk, Network, USB',
          acpi: config.acpi !== 0 && config.acpi !== false,
          kvmEnabled: config.kvm !== 0 && config.kvm !== false,
          freezeCpu: config.freeze === 1 || config.freeze === true,
          useLocalTime: config.localtime === 1 || config.localtime === true ? 'yes' : 'default',
          rtcStartDate: config.startdate || 'now',
          smbiosUuid: config.smbios1?.match(/uuid=([^,]+)/)?.[1] || 'Auto-generated',
          agentEnabled: config.agent && String(config.agent).includes('enabled=1'),
          spiceEnhancements: config.spice_enhancements || 'none',
          vmStateStorage: config.vmstatestorage || 'Automatic',
          amdSEV: config.sev ? 'enabled' : 'default',
        }
      } catch (e) {
        console.error('Error parsing config:', e)
      }
    }

    return {
      kindLabel: type === 'lxc' ? 'LXC' : 'VM',
      title: name,
      subtitle: `${String(type).toUpperCase()} • ${node} • #${vmid}`,
      breadcrumb: ['Infrastructure', 'Inventaire', 'VM', String(vmid)],
      status: g.status === 'running' ? 'ok' : 'unknown',
      vmRealStatus: g.status,  // Le vrai statut pour les boutons et la console
      tags: vmTags,
      kpis: [{ label: 'State', value: g.status === 'running' ? 'Running' : 'Stopped' }],
      metrics: {
        cpu: { label: 'CPU', pct: c },
        ram: { label: 'RAM', pct: r, used: Number(g.mem ?? 0), max: Number(g.maxmem ?? 0) },
        storage: { label: 'Storage', pct: d, used: Number(g.disk ?? 0), max: Number(g.maxdisk ?? 0) },
      },
      properties: [],
      lastUpdated,
      isCluster,
      vmType: type as 'qemu' | 'lxc',
      name,
      description,
      cpuInfo,
      memoryInfo,
      disksInfo,
      networkInfo,
      optionsInfo,
      nodeCapacity,
    }
  }

  // Support PBS (Proxmox Backup Server)
  if (sel.type === 'pbs') {
    const pbsId = sel.id

    // Charger les infos de connexion, status et datastores du serveur PBS
    const [connR, statusR, datastoresR] = await Promise.all([
      fetch(`/api/v1/connections/${encodeURIComponent(pbsId)}`, { cache: 'no-store' }).catch(() => null),
      fetch(`/api/v1/pbs/${encodeURIComponent(pbsId)}/status`, { cache: 'no-store' }).catch(() => null),
      fetch(`/api/v1/pbs/${encodeURIComponent(pbsId)}/datastores`, { cache: 'no-store' }).catch(() => null),
    ])

    let connName = pbsId
    let statusData: any = null
    let datastoresData: any[] = []

    if (connR && connR.ok) {
      try {
        const json = await connR.json()
        connName = json?.name || json?.data?.name || pbsId
      } catch {}
    }

    if (statusR && statusR.ok) {
      try {
        const json = await statusR.json()
        statusData = json?.data || json
      } catch {}
    }

    if (datastoresR && datastoresR.ok) {
      try {
        const json = await datastoresR.json()
        datastoresData = json?.data || []
      } catch {}
    }

    // Charger les données RRD du serveur PBS
    let rrdData: any[] = []
    try {
      const rrdR = await fetch(`/api/v1/pbs/${encodeURIComponent(pbsId)}/rrd?timeframe=hour`, { cache: 'no-store' })
      if (rrdR.ok) {
        const json = await rrdR.json()
        rrdData = json?.data || []
      }
    } catch {}

    // Calculer les métriques de stockage
    const totalSize = statusData?.totalSize || 0
    const totalUsed = statusData?.totalUsed || 0
    const usagePercent = totalSize > 0 ? Math.round((totalUsed / totalSize) * 100) : 0

    // Calculer le nombre total de backups depuis les datastores
    let totalBackups = 0
    let totalVms = 0
    let totalCts = 0

    for (const ds of datastoresData) {
      totalBackups += ds.backupCount || 0
      totalVms += ds.vmCount || 0
      totalCts += ds.ctCount || 0
    }

    return {
      kindLabel: 'PBS',
      title: connName,
      subtitle: statusData?.version ? `Proxmox Backup Server ${statusData.version}` : 'Proxmox Backup Server',
      breadcrumb: ['Infrastructure', 'Inventaire', 'PBS', connName],
      status: statusData ? 'ok' : 'crit',
      tags: [],
      kpis: [
        { label: 'Datastores', value: String(datastoresData.length) },
        { label: 'Backups', value: String(totalBackups) },
        { label: 'VMs', value: String(totalVms) },
        { label: 'CTs', value: String(totalCts) },
      ],
      metrics: {
        storage: { label: 'Storage', pct: usagePercent, used: totalUsed, max: totalSize },
      },
      properties: [],
      lastUpdated,
      pbsInfo: {
        version: statusData?.version,
        uptime: statusData?.uptime,
        cpuInfo: statusData?.cpuInfo,
        memory: statusData?.memory,
        load: statusData?.load,
        datastores: datastoresData,
        // Plus de backups ici - ils seront affichés dans le datastore
        backups: [],
        stats: { total: totalBackups, vmCount: totalVms, ctCount: totalCts },
        rrdData,
      },
    }
  }

  // Support Datastore PBS
  if (sel.type === 'datastore') {
    const [pbsId, datastoreName] = sel.id.split(':')

    // Charger les infos de connexion, datastore status et backups en parallèle
    const [connR, datastoresR, backupsR] = await Promise.all([
      fetch(`/api/v1/connections/${encodeURIComponent(pbsId)}`, { cache: 'no-store' }).catch(() => null),
      fetch(`/api/v1/pbs/${encodeURIComponent(pbsId)}/datastores`, { cache: 'no-store' }).catch(() => null),
      fetch(`/api/v1/pbs/${encodeURIComponent(pbsId)}/backups?datastore=${encodeURIComponent(datastoreName)}&pageSize=5000`, { cache: 'no-store' }).catch(() => null),
    ])

    let connName = pbsId
    let datastoreData: any = null
    let backupsData: any = null

    if (connR && connR.ok) {
      try {
        const json = await connR.json()
        connName = json?.name || json?.data?.name || pbsId
      } catch {}
    }

    if (datastoresR && datastoresR.ok) {
      try {
        const json = await datastoresR.json()
        const datastores = json?.data || []
        datastoreData = datastores.find((ds: any) => ds.name === datastoreName) || null
      } catch {}
    }

    if (backupsR && backupsR.ok) {
      try {
        const json = await backupsR.json()
        backupsData = json?.data || null
      } catch {}
    }

    // Charger les données RRD du datastore
    let rrdData: any[] = []
    try {
      const rrdR = await fetch(
        `/api/v1/pbs/${encodeURIComponent(pbsId)}/datastores/${encodeURIComponent(datastoreName)}/rrd?timeframe=hour`,
        { cache: 'no-store' }
      )
      if (rrdR.ok) {
        const json = await rrdR.json()
        rrdData = json?.data || []
      }
    } catch {}

    // Métriques de stockage du datastore
    const total = datastoreData?.total || 0
    const used = datastoreData?.used || 0
    const usagePercent = total > 0 ? Math.round((used / total) * 100) : 0

    return {
      kindLabel: 'DATASTORE',
      title: datastoreName,
      subtitle: connName,
      breadcrumb: ['Infrastructure', 'Inventaire', 'PBS', connName, datastoreName],
      status: 'ok',
      tags: [],
      kpis: [
        { label: 'Backups', value: backupsData?.stats?.total || 0 },
        { label: 'VMs', value: backupsData?.stats?.vmCount || 0 },
        { label: 'CTs', value: backupsData?.stats?.ctCount || 0 },
        { label: 'Size', value: backupsData?.stats?.totalSizeFormatted || '0 B' },
      ],
      metrics: {
        storage: { label: 'Storage', pct: usagePercent, used, max: total },
      },
      properties: [],
      lastUpdated,
      datastoreInfo: {
        pbsId,
        pbsName: connName,
        name: datastoreName,
        path: datastoreData?.path || '',
        comment: datastoreData?.comment || '',
        total,
        used,
        available: datastoreData?.available || 0,
        usagePercent,
        gcStatus: datastoreData?.gcStatus,
        verifyStatus: datastoreData?.verifyStatus,
        backups: backupsData?.backups || [],
        stats: backupsData?.stats || {},
        pagination: backupsData?.pagination || {},
        rrdData,
      },
    }
  }

  return {
    kindLabel: 'STORAGE',
    title: sel.id,
    subtitle: 'To implement',
    breadcrumb: ['Infrastructure', 'Inventaire', 'Storage', sel.id],
    status: 'unknown',
    tags: [],
    kpis: [],
    properties: [],
    lastUpdated,
  }
}

/* ------------------------------------------------------------------ */
/* GroupedVmsView - Affiche les VMs groupées par host/pool/tag        */
/* ------------------------------------------------------------------ */

type GroupedVmsViewProps = {
  title: string
  icon: string
  groups: {
    key: string
    label: string
    sublabel?: string
    color?: string
    vms: AllVmItem[]
  }[]
  allVms: AllVmItem[]
  onVmClick?: (vm: VmRow) => void
  onVmAction: (vm: VmRow, action: 'start' | 'shutdown' | 'stop' | 'pause' | 'console' | 'details') => void
  onMigrate?: (vm: VmRow) => void
  onLoadTrendsBatch: (vms: VmRow[]) => Promise<Record<string, TrendPoint[]>>
  onSelect?: (sel: InventorySelection) => void
  favorites?: Set<string>
  onToggleFavorite?: (vm: VmRow) => void
  migratingVmIds?: Set<string>
}

function GroupedVmsView({ title, icon, groups, allVms, onVmClick, onVmAction, onMigrate, onLoadTrendsBatch, onSelect, favorites, onToggleFavorite, migratingVmIds }: GroupedVmsViewProps) {
  const t = useTranslations()
  // Par défaut, TOUS les groupes sont repliés
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  
  const toggleGroup = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev)

      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }

      
return next
    })
  }
  
  const expandAll = () => setExpanded(new Set(groups.map(g => g.key)))
  const collapseAll = () => setExpanded(new Set())
  
  // Convertir AllVmItem en VmRow
  const toVmRow = (vm: AllVmItem): VmRow => ({
    id: `${vm.connId}:${vm.node}:${vm.type}:${vm.vmid}`,
    connId: vm.connId,
    node: vm.node,
    vmid: vm.vmid,
    name: vm.name,
    type: vm.type,
    status: vm.status || 'unknown',
    cpu: vm.status === 'running' && vm.cpu !== undefined ? Math.min(100, vm.cpu * 100) : undefined,
    ram: vm.status === 'running' && vm.mem !== undefined && vm.maxmem ? (vm.mem / vm.maxmem) * 100 : undefined,
    maxmem: vm.maxmem,
    maxdisk: vm.maxdisk,
    uptime: vm.uptime,
    ip: vm.ip,
    snapshots: vm.snapshots,
    tags: vm.tags,
    template: vm.template,
    hastate: vm.hastate,
    hagroup: vm.hagroup,
    isCluster: vm.isCluster,
    osInfo: vm.osInfo,
  })
  
  return (
    <Box sx={{ p: 2, height: '100%', overflow: 'auto' }}>
      <Card variant="outlined" sx={{ width: '100%', borderRadius: 2 }}>
        <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
          {/* Header */}
          <Box sx={{ 
            px: 2, 
            py: 1.5, 
            borderBottom: '1px solid', 
            borderColor: 'divider',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <Typography fontWeight={900} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <i className={icon} style={{ fontSize: 20, opacity: 0.7 }} />
              {title} ({groups.length} {t('inventoryPage.groups')}, {allVms.length} VMs)
            </Typography>
            <Stack direction="row" spacing={0.5}>
              <MuiTooltip title={t('inventoryPage.expandAll')}>
                <IconButton size="small" onClick={expandAll}>
                  <i className="ri-expand-up-down-line" style={{ fontSize: 16 }} />
                </IconButton>
              </MuiTooltip>
              <MuiTooltip title={t('inventoryPage.collapseAll')}>
                <IconButton size="small" onClick={collapseAll}>
                  <i className="ri-collapse-vertical-line" style={{ fontSize: 16 }} />
                </IconButton>
              </MuiTooltip>
            </Stack>
          </Box>
          
          {/* Groups */}
          <Box sx={{ maxHeight: 'calc(100vh - 280px)', overflow: 'auto' }}>
            {groups.map(group => {
              const isExpanded = expanded.has(group.key)
              const runningCount = group.vms.filter(v => v.status === 'running').length
              
              return (
                <Box key={group.key}>
                  {/* Group Header */}
                  <Box
                    onClick={() => toggleGroup(group.key)}
                    sx={{
                      px: 2,
                      py: 1,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      cursor: 'pointer',
                      bgcolor: isExpanded ? 'action.selected' : 'action.hover',
                      borderBottom: '1px solid',
                      borderColor: 'divider',
                      '&:hover': { bgcolor: 'action.selected' }
                    }}
                  >
                    <i 
                      className={isExpanded ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} 
                      style={{ fontSize: 18, opacity: 0.7 }} 
                    />
                    {group.color && (
                      <Box sx={{ 
                        width: 12, 
                        height: 12, 
                        borderRadius: 0.5, 
                        bgcolor: group.color 
                      }} />
                    )}
                    <Typography fontWeight={700} sx={{ flex: 1 }}>
                      {group.label}
                    </Typography>
                    {group.sublabel && (
                      <Typography variant="caption" sx={{ opacity: 0.6 }}>
                        {group.sublabel}
                      </Typography>
                    )}
                    <Chip 
                      size="small" 
                      label={`${runningCount}/${group.vms.length}`}
                      color={runningCount > 0 ? 'success' : 'default'}
                      sx={{ height: 20, fontSize: '0.7rem' }}
                    />
                  </Box>
                  
                  {/* VMs Table - seulement si expanded (les trends ne se chargent que si visible) */}
                  {isExpanded && (
                    <Box sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
                      <VmsTable
                        vms={group.vms.map(toVmRow)}
                        compact
                        showTrends
                        showActions
                        onLoadTrendsBatch={onLoadTrendsBatch}
                        onVmClick={onVmClick}
                        onVmAction={onVmAction}
                        onMigrate={onMigrate}
                        maxHeight="auto"
                        favorites={favorites}
                        onToggleFavorite={onToggleFavorite}
                        migratingVmIds={migratingVmIds}
                      />
                    </Box>
                  )}
                </Box>
              )
            })}
          </Box>
        </CardContent>
      </Card>
    </Box>
  )
}

/* ------------------------------------------------------------------ */
/* CreateVmDialog - Dialog de création de VM (style Proxmox)          */
/* ------------------------------------------------------------------ */

function CreateVmDialog({
  open,
  onClose,
  allVms = [],
  onCreated
}: {
  open: boolean
  onClose: () => void
  allVms: AllVmItem[]
  onCreated?: (vmid: string, connId: string, node: string) => void
}) {
  const t = useTranslations()
  const theme = useTheme()
  
  // États du formulaire
  const [activeTab, setActiveTab] = useState(0)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // Données dynamiques
  const [connections, setConnections] = useState<any[]>([])
  const [nodes, setNodes] = useState<any[]>([])
  const [storages, setStorages] = useState<any[]>([])
  const [isoImages, setIsoImages] = useState<any[]>([])
  const [networks, setNetworks] = useState<any[]>([])
  const [pools, setPools] = useState<any[]>([])
  const [loadingData, setLoadingData] = useState(false)
  
  // Formulaire - Général
  const [selectedConnection, setSelectedConnection] = useState('')
  const [selectedNode, setSelectedNode] = useState('')
  const [vmid, setVmid] = useState('')
  const [vmidError, setVmidError] = useState<string | null>(null)
  const [vmName, setVmName] = useState('')
  const [resourcePool, setResourcePool] = useState('')
  const [startOnBoot, setStartOnBoot] = useState(false)
  const [startupOrder, setStartupOrder] = useState('')
  const [startupDelay, setStartupDelay] = useState('')
  const [shutdownTimeout, setShutdownTimeout] = useState('')
  
  // Formulaire - OS
  const [osMediaType, setOsMediaType] = useState<'iso' | 'none'>('iso')
  const [isoStorage, setIsoStorage] = useState('')
  const [isoImage, setIsoImage] = useState('')
  const [guestOsType, setGuestOsType] = useState('Linux')
  const [guestOsVersion, setGuestOsVersion] = useState('l26')
  
  // Formulaire - System
  const [graphicCard, setGraphicCard] = useState('default')
  const [machine, setMachine] = useState('i440fx')
  const [bios, setBios] = useState('seabios')
  const [scsiController, setScsiController] = useState('virtio-scsi-single')
  const [qemuAgent, setQemuAgent] = useState(false)
  const [addTpm, setAddTpm] = useState(false)
  
  // Formulaire - Disks
  const [diskBus, setDiskBus] = useState('scsi')
  const [diskStorage, setDiskStorage] = useState('')
  const [diskSize, setDiskSize] = useState(32)
  const [diskFormat, setDiskFormat] = useState('raw')
  const [diskCache, setDiskCache] = useState('none')
  const [diskDiscard, setDiskDiscard] = useState(false)
  const [diskIoThread, setDiskIoThread] = useState(true)
  const [diskSsd, setDiskSsd] = useState(false)
  const [diskBackup, setDiskBackup] = useState(true)
  
  // Formulaire - CPU
  const [cpuSockets, setCpuSockets] = useState(1)
  const [cpuCores, setCpuCores] = useState(1)
  const [cpuType, setCpuType] = useState('x86-64-v2-AES')
  const [cpuUnits, setCpuUnits] = useState(100)
  const [cpuLimit, setCpuLimit] = useState(0)
  const [enableNuma, setEnableNuma] = useState(false)
  
  // Formulaire - Memory
  const [memorySize, setMemorySize] = useState(2048)
  const [minMemory, setMinMemory] = useState(2048)
  const [ballooning, setBallooning] = useState(true)
  
  // Formulaire - Network
  const [noNetwork, setNoNetwork] = useState(false)
  const [networkBridge, setNetworkBridge] = useState('vmbr0')
  const [networkModel, setNetworkModel] = useState('virtio')
  const [vlanTag, setVlanTag] = useState('')
  const [macAddress, setMacAddress] = useState('auto')
  const [firewall, setFirewall] = useState(true)
  const [networkDisconnect, setNetworkDisconnect] = useState(false)
  const [rateLimit, setRateLimit] = useState('')
  const [mtu, setMtu] = useState('1500')

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setActiveTab(0)
      setError(null)
      loadAllData()
    }
  }, [open])

  // Charger les storages quand un node est sélectionné
  useEffect(() => {
    if (selectedConnection && selectedNode) {
      loadStorages(selectedConnection)
    }
  }, [selectedConnection, selectedNode])

  // Charger les ISOs quand un storage ISO est sélectionné
  useEffect(() => {
    if (selectedConnection && isoStorage && selectedNode) {
      loadIsoImages(selectedConnection, selectedNode, isoStorage)
    }
  }, [selectedConnection, selectedNode, isoStorage])

  // Calculer le prochain VMID disponible (global sur toutes les connexions)
  useEffect(() => {
    if (allVms.length > 0) {
      const usedVmids = allVms.map(vm => parseInt(String(vm.vmid), 10))
      
      let nextId = 100

      while (usedVmids.includes(nextId)) {
        nextId++
      }

      setVmid(String(nextId))
      setVmidError(null)
    }
  }, [allVms])

  // Valider le VMID quand il change
  const handleVmidChange = (value: string) => {
    // Autoriser uniquement les chiffres
    const numericValue = value.replace(/[^0-9]/g, '')

    setVmid(numericValue)
    
    // Vérifier si le VMID est valide
    if (!numericValue) {
      setVmidError(null)
      
return
    }
    
    const vmidNum = parseInt(numericValue, 10)
    
    // Vérifier les limites Proxmox (100-999999999)
    if (vmidNum < 100) {
      setVmidError('VM ID must be >= 100')
      
return
    }

    if (vmidNum > 999999999) {
      setVmidError('VM ID must be <= 999999999')
      
return
    }
    
    // Vérifier si le VMID est déjà utilisé
    const isUsed = allVms.some(vm => parseInt(String(vm.vmid), 10) === vmidNum)

    if (isUsed) {
      setVmidError(`VM ID ${vmidNum} is already in use`)
      
return
    }
    
    setVmidError(null)
  }

  // Charger toutes les connexions et tous leurs nodes
  const loadAllData = async () => {
    setLoadingData(true)

    try {
      // 1. Charger les connexions
      const connRes = await fetch('/api/v1/connections?type=pve')
      const connJson = await connRes.json()
      const connectionsList = connJson.data || []

      setConnections(connectionsList)
      
      // 2. Charger les nodes de toutes les connexions en parallèle
      const allNodes: any[] = []

      await Promise.all(
        connectionsList.map(async (conn: any) => {
          try {
            const nodesRes = await fetch(`/api/v1/connections/${encodeURIComponent(conn.id)}/nodes`)
            const nodesJson = await nodesRes.json()
            const nodesList = nodesJson.data || []
            
            // Ajouter l'info de connexion à chaque node
            nodesList.forEach((node: any) => {
              allNodes.push({
                ...node,
                connId: conn.id,
                connName: conn.name,
              })
            })
          } catch (e) {
            console.error(`Error loading nodes for connection ${conn.id}:`, e)
          }
        })
      )
      
      setNodes(allNodes)
      
      // 3. Sélectionner le premier node par défaut
      if (allNodes.length > 0 && !selectedNode) {
        setSelectedNode(allNodes[0].node)
        setSelectedConnection(allNodes[0].connId)
      }
      
    } catch (e) {
      console.error('Error loading data:', e)
    } finally {
      setLoadingData(false)
    }
  }

  // Quand on sélectionne un node, mettre à jour la connexion associée
  const handleNodeChange = (nodeName: string) => {
    setSelectedNode(nodeName)
    const nodeData = nodes.find(n => n.node === nodeName)

    if (nodeData) {
      setSelectedConnection(nodeData.connId)
    }
  }

  const loadStorages = async (connId: string) => {
    try {
      const storagesRes = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/storage`)
      const storagesJson = await storagesRes.json()
      
      setStorages(storagesJson.data || [])
      
      // Sélectionner les storages par défaut
      const isoStorages = (storagesJson.data || []).filter((s: any) => s.content?.includes('iso'))

      const diskStorages = (storagesJson.data || []).filter((s: any) => 
        s.content?.includes('images') || s.content?.includes('rootdir')
      )
      
      if (isoStorages.length > 0 && !isoStorage) {
        setIsoStorage(isoStorages[0].storage)
      }

      if (diskStorages.length > 0 && !diskStorage) {
        setDiskStorage(diskStorages[0].storage)
      }
    } catch (e) {
      console.error('Error loading storages:', e)
    }
  }

  const loadIsoImages = async (connId: string, node: string, storage: string) => {
    try {
      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/content?content=iso`
      )

      if (res.ok) {
        const json = await res.json()

        setIsoImages(json.data || [])
      }
    } catch (e) {
      // API might not exist, fallback to empty
      setIsoImages([])
    }
  }

  const handleCreate = async () => {
    setCreating(true)
    setError(null)
    
    try {
      const payload: any = {
        vmid: parseInt(vmid, 10),
        ostype: guestOsVersion,
        sockets: cpuSockets,
        cores: cpuCores,
        memory: memorySize,
        scsihw: scsiController,
        agent: qemuAgent ? 1 : 0,
        onboot: startOnBoot ? 1 : 0,
      }

      // Nom (optionnel)
      if (vmName) payload.name = vmName

      // CPU type (seulement si différent de défaut)
      if (cpuType && cpuType !== 'kvm64') payload.cpu = cpuType

      // Ballooning
      if (ballooning && minMemory < memorySize) {
        payload.balloon = minMemory
      }

      // BIOS (seulement si OVMF/UEFI)
      if (bios === 'ovmf') payload.bios = 'ovmf'

      // Machine type - utiliser le format Proxmox correct
      if (machine === 'q35') payload.machine = 'q35'

      // i440fx est le défaut, pas besoin de l'envoyer

      // Disque
      if (diskStorage) {
        let diskConfig = `${diskStorage}:${diskSize}`

        if (diskFormat !== 'raw') diskConfig += `,format=${diskFormat}`
        if (diskCache !== 'none') diskConfig += `,cache=${diskCache}`
        if (diskDiscard) diskConfig += ',discard=on'
        if (diskIoThread) diskConfig += ',iothread=1'
        if (diskSsd) diskConfig += ',ssd=1'
        if (!diskBackup) diskConfig += ',backup=0'
        
        payload[`${diskBus}0`] = diskConfig
      }

      // ISO
      if (osMediaType === 'iso' && isoStorage && isoImage) {
        payload.cdrom = `${isoStorage}:iso/${isoImage}`
      }

      // Réseau
      if (!noNetwork) {
        let net0 = `${networkModel},bridge=${networkBridge}`

        if (vlanTag) net0 += `,tag=${vlanTag}`
        if (macAddress && macAddress !== 'auto') net0 += `,macaddr=${macAddress}`
        if (firewall) net0 += ',firewall=1'
        if (rateLimit) net0 += `,rate=${rateLimit}`
        if (networkDisconnect) net0 += ',link_down=1'
        payload.net0 = net0
      }

      // CPU
      if (cpuUnits !== 1024) payload.cpuunits = cpuUnits
      if (cpuLimit > 0) payload.cpulimit = cpuLimit
      if (enableNuma) payload.numa = 1

      // Startup
      if (startupOrder || startupDelay || shutdownTimeout) {
        const parts = []

        if (startupOrder) parts.push(`order=${startupOrder}`)
        if (startupDelay) parts.push(`up=${startupDelay}`)
        if (shutdownTimeout) parts.push(`down=${shutdownTimeout}`)
        payload.startup = parts.join(',')
      }

      // Pool
      if (resourcePool) payload.pool = resourcePool

      console.log('Creating VM with payload:', payload)

      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(selectedConnection)}/guests/qemu/${encodeURIComponent(selectedNode)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }
      )

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))

        throw new Error(err?.error || `HTTP ${res.status}`)
      }

      // Appeler le callback avec les infos de la VM créée
      onCreated?.(vmid, selectedConnection, selectedNode)
      onClose()
    } catch (e: any) {
      setError(e?.message || t('errors.addError'))
    } finally {
      setCreating(false)
    }
  }

  const tabs = ['General', 'OS', 'System', 'Disks', 'CPU', 'Memory', 'Network', 'Confirm']
  
  // Filtrer les storages selon leur contenu
  const isoStoragesList = storages.filter(s => s.content?.includes('iso'))
  const diskStoragesList = storages.filter(s => s.content?.includes('images') || s.content?.includes('rootdir'))

  const renderTabContent = () => {
    switch (activeTab) {
      case 0: // General
        return (
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Node</InputLabel>
              <Select value={selectedNode} onChange={(e) => handleNodeChange(e.target.value)} label="Node">
                {nodes.map(n => (
                  <MenuItem key={`${n.connId}-${n.node}`} value={n.node}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {n.node}
                      <Typography component="span" sx={{ opacity: 0.6, fontSize: '0.8em' }}>
                        ({n.connName})
                      </Typography>
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>Resource Pool</InputLabel>
              <Select value={resourcePool} onChange={(e) => setResourcePool(e.target.value)} label="Resource Pool">
                <MenuItem value="">({t('common.none')})</MenuItem>
              </Select>
            </FormControl>
            <TextField 
              label="VM ID" 
              value={vmid} 
              onChange={(e) => handleVmidChange(e.target.value)} 
              size="small" 
              error={!!vmidError}
              helperText={vmidError}
              inputProps={{ inputMode: 'numeric', pattern: '[0-9]*' }}
            />
            <Box />
            <TextField label="Name" value={vmName} onChange={(e) => setVmName(e.target.value)} size="small" fullWidth />
            <Box />
            <FormControlLabel 
              control={<Switch checked={startOnBoot} onChange={(e) => setStartOnBoot(e.target.checked)} size="small" />} 
              label="Start at boot" 
            />
            <Box />
            <TextField label="Start/Shutdown order" value={startupOrder} onChange={(e) => setStartupOrder(e.target.value)} size="small" placeholder="any" />
            <Box />
            <TextField label="Startup delay" value={startupDelay} onChange={(e) => setStartupDelay(e.target.value)} size="small" placeholder="default" />
            <Box />
            <TextField label="Shutdown timeout" value={shutdownTimeout} onChange={(e) => setShutdownTimeout(e.target.value)} size="small" placeholder="default" />
          </Box>
        )

      case 1: // OS
        return (
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <Box sx={{ gridColumn: '1 / -1' }}>
              <FormControl component="fieldset">
                <Stack spacing={1}>
                  <FormControlLabel
                    control={<Switch checked={osMediaType === 'iso'} onChange={(e) => setOsMediaType(e.target.checked ? 'iso' : 'none')} size="small" />}
                    label="Use CD/DVD disc image file (iso)"
                  />
                </Stack>
              </FormControl>
            </Box>
            
            {osMediaType === 'iso' && (
              <>
                <FormControl fullWidth size="small">
                  <InputLabel>Storage</InputLabel>
                  <Select value={isoStorage} onChange={(e) => setIsoStorage(e.target.value)} label="Storage">
                    {isoStoragesList.map(s => <MenuItem key={s.storage} value={s.storage}>{s.storage}</MenuItem>)}
                  </Select>
                </FormControl>
                <Typography variant="subtitle2" sx={{ alignSelf: 'center', fontWeight: 600 }}>Guest OS:</Typography>
                
                <FormControl fullWidth size="small">
                  <InputLabel>ISO image</InputLabel>
                  <Select value={isoImage} onChange={(e) => setIsoImage(e.target.value)} label="ISO image">
                    {isoImages.length > 0 ? (
                      isoImages.map((iso: any) => (
                        <MenuItem key={iso.volid || iso.name} value={iso.name || iso.volid?.split('/').pop()}>
                          {iso.name || iso.volid?.split('/').pop()}
                        </MenuItem>
                      ))
                    ) : (
                      <MenuItem value="" disabled>{t('common.noData')}</MenuItem>
                    )}
                  </Select>
                </FormControl>
                <FormControl fullWidth size="small">
                  <InputLabel>Type</InputLabel>
                  <Select value={guestOsType} onChange={(e) => setGuestOsType(e.target.value)} label="Type">
                    <MenuItem value="Linux">Linux</MenuItem>
                    <MenuItem value="Windows">Windows</MenuItem>
                    <MenuItem value="Solaris">Solaris</MenuItem>
                    <MenuItem value="Other">Other</MenuItem>
                  </Select>
                </FormControl>
                
                <Box />
                <FormControl fullWidth size="small">
                  <InputLabel>Version</InputLabel>
                  <Select value={guestOsVersion} onChange={(e) => setGuestOsVersion(e.target.value)} label="Version">
                    {guestOsType === 'Linux' && [
                      <MenuItem key="l26" value="l26">6.x - 2.6 Kernel</MenuItem>,
                      <MenuItem key="l24" value="l24">2.4 Kernel</MenuItem>,
                    ]}
                    {guestOsType === 'Windows' && [
                      <MenuItem key="win11" value="win11">11/2022</MenuItem>,
                      <MenuItem key="win10" value="win10">10/2016/2019</MenuItem>,
                      <MenuItem key="win8" value="win8">8/2012</MenuItem>,
                      <MenuItem key="win7" value="win7">7/2008r2</MenuItem>,
                    ]}
                    {guestOsType === 'Solaris' && <MenuItem value="solaris">Solaris Kernel</MenuItem>}
                    {guestOsType === 'Other' && <MenuItem value="other">Other</MenuItem>}
                  </Select>
                </FormControl>
              </>
            )}
            
            {osMediaType === 'none' && (
              <Typography variant="body2" color="text.secondary" sx={{ gridColumn: '1 / -1' }}>
                Do not use any media
              </Typography>
            )}
          </Box>
        )

      case 2: // System
        return (
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Graphic card</InputLabel>
              <Select value={graphicCard} onChange={(e) => setGraphicCard(e.target.value)} label="Graphic card">
                <MenuItem value="default">Default</MenuItem>
                <MenuItem value="std">Standard VGA</MenuItem>
                <MenuItem value="vmware">VMware compatible</MenuItem>
                <MenuItem value="qxl">SPICE (qxl)</MenuItem>
                <MenuItem value="virtio">VirtIO-GPU</MenuItem>
                <MenuItem value="none">None</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>SCSI Controller</InputLabel>
              <Select value={scsiController} onChange={(e) => setScsiController(e.target.value)} label="SCSI Controller">
                <MenuItem value="virtio-scsi-single">VirtIO SCSI single</MenuItem>
                <MenuItem value="virtio-scsi-pci">VirtIO SCSI</MenuItem>
                <MenuItem value="lsi">LSI 53C895A</MenuItem>
                <MenuItem value="lsi53c810">LSI 53C810</MenuItem>
                <MenuItem value="megasas">MegaRAID SAS</MenuItem>
                <MenuItem value="pvscsi">VMware PVSCSI</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>Machine</InputLabel>
              <Select value={machine} onChange={(e) => setMachine(e.target.value)} label="Machine">
                <MenuItem value="i440fx">Default (i440fx)</MenuItem>
                <MenuItem value="q35">q35</MenuItem>
              </Select>
            </FormControl>
            <FormControlLabel 
              control={<Switch checked={qemuAgent} onChange={(e) => setQemuAgent(e.target.checked)} size="small" />} 
              label="Qemu Agent" 
            />
            <Typography variant="body2" sx={{ fontWeight: 600, mt: 1 }}>Firmware</Typography>
            <Box />
            <FormControl fullWidth size="small">
              <InputLabel>BIOS</InputLabel>
              <Select value={bios} onChange={(e) => setBios(e.target.value)} label="BIOS">
                <MenuItem value="seabios">Default (SeaBIOS)</MenuItem>
                <MenuItem value="ovmf">OVMF (UEFI)</MenuItem>
              </Select>
            </FormControl>
            <FormControlLabel 
              control={<Switch checked={addTpm} onChange={(e) => setAddTpm(e.target.checked)} size="small" />} 
              label="Add TPM" 
            />
          </Box>
        )

      case 3: // Disks
        return (
          <Box>
            <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
              <Chip label="scsi0" variant="outlined" sx={{ fontFamily: 'monospace' }} />
              <Tabs value={0} sx={{ minHeight: 32, '& .MuiTab-root': { minHeight: 32, py: 0.5 } }}>
                <Tab label="Disk" />
                <Tab label="Bandwidth" disabled />
              </Tabs>
            </Box>
            
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="body2" sx={{ minWidth: 100 }}>Bus/Device:</Typography>
                <FormControl size="small" sx={{ minWidth: 100 }}>
                  <Select value={diskBus} onChange={(e) => setDiskBus(e.target.value)}>
                    <MenuItem value="scsi">SCSI</MenuItem>
                    <MenuItem value="virtio">VirtIO Block</MenuItem>
                    <MenuItem value="sata">SATA</MenuItem>
                    <MenuItem value="ide">IDE</MenuItem>
                  </Select>
                </FormControl>
                <TextField size="small" value="0" disabled sx={{ width: 60 }} />
              </Stack>
              <FormControl fullWidth size="small">
                <InputLabel>Cache</InputLabel>
                <Select value={diskCache} onChange={(e) => setDiskCache(e.target.value)} label="Cache">
                  <MenuItem value="none">Default (No cache)</MenuItem>
                  <MenuItem value="directsync">Direct sync</MenuItem>
                  <MenuItem value="writethrough">Write through</MenuItem>
                  <MenuItem value="writeback">Write back</MenuItem>
                  <MenuItem value="unsafe">Write back (unsafe)</MenuItem>
                </Select>
              </FormControl>
              
              <Typography variant="body2">SCSI Controller: {scsiController}</Typography>
              <FormControlLabel 
                control={<Switch checked={diskDiscard} onChange={(e) => setDiskDiscard(e.target.checked)} size="small" />} 
                label="Discard" 
              />
              
              <FormControl fullWidth size="small">
                <InputLabel>Storage</InputLabel>
                <Select value={diskStorage} onChange={(e) => setDiskStorage(e.target.value)} label="Storage">
                  {diskStoragesList.map(s => (
                    <MenuItem key={s.storage} value={s.storage}>
                      {s.storage} ({s.type})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControlLabel 
                control={<Switch checked={diskIoThread} onChange={(e) => setDiskIoThread(e.target.checked)} size="small" />} 
                label="IO thread" 
              />
              
              <TextField 
                label="Disk size (GiB)" 
                value={diskSize} 
                onChange={(e) => setDiskSize(parseInt(e.target.value) || 0)} 
                size="small" 
                type="number" 
              />
              <Box />
              
              <Typography variant="body2" sx={{ opacity: 0.7 }}>Format: {diskFormat}</Typography>
              <Box />
              
              <Divider sx={{ gridColumn: '1 / -1', my: 1 }} />
              
              <FormControlLabel 
                control={<Switch checked={diskSsd} onChange={(e) => setDiskSsd(e.target.checked)} size="small" />} 
                label="SSD emulation" 
              />
              <FormControlLabel 
                control={<Switch checked={diskBackup} onChange={(e) => setDiskBackup(e.target.checked)} size="small" />} 
                label="Backup" 
              />
            </Box>
          </Box>
        )

      case 4: // CPU
        return (
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <TextField 
              label="Sockets" 
              value={cpuSockets} 
              onChange={(e) => setCpuSockets(parseInt(e.target.value) || 1)} 
              size="small" 
              type="number"
              inputProps={{ min: 1, max: 4 }}
            />
            <FormControl fullWidth size="small">
              <InputLabel>Type</InputLabel>
              <Select value={cpuType} onChange={(e) => setCpuType(e.target.value)} label="Type">
                <MenuItem value="x86-64-v2-AES">x86-64-v2-AES</MenuItem>
                <MenuItem value="host">host</MenuItem>
                <MenuItem value="kvm64">kvm64</MenuItem>
                <MenuItem value="qemu64">qemu64</MenuItem>
                <MenuItem value="max">max</MenuItem>
              </Select>
            </FormControl>
            
            <TextField 
              label="Cores" 
              value={cpuCores} 
              onChange={(e) => setCpuCores(parseInt(e.target.value) || 1)} 
              size="small" 
              type="number"
              inputProps={{ min: 1, max: 128 }}
            />
            <Typography variant="body2" sx={{ alignSelf: 'center' }}>
              Total cores: <b>{cpuSockets * cpuCores}</b>
            </Typography>
            
            <Divider sx={{ gridColumn: '1 / -1', my: 1 }} />
            
            <TextField 
              label="VCPUs" 
              value={cpuSockets * cpuCores} 
              size="small" 
              disabled
            />
            <TextField 
              label="CPU units" 
              value={cpuUnits} 
              onChange={(e) => setCpuUnits(parseInt(e.target.value) || 100)} 
              size="small" 
              type="number"
            />
            
            <TextField 
              label="CPU limit" 
              value={cpuLimit === 0 ? 'unlimited' : cpuLimit} 
              onChange={(e) => setCpuLimit(e.target.value === 'unlimited' ? 0 : parseFloat(e.target.value) || 0)} 
              size="small" 
              placeholder="unlimited"
            />
            <FormControlLabel 
              control={<Switch checked={enableNuma} onChange={(e) => setEnableNuma(e.target.checked)} size="small" />} 
              label="Enable NUMA" 
            />
          </Box>
        )

      case 5: // Memory
        return (
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <TextField 
              label="Memory (MiB)" 
              value={memorySize} 
              onChange={(e) => setMemorySize(parseInt(e.target.value) || 512)} 
              size="small" 
              type="number"
              inputProps={{ min: 16, step: 128 }}
            />
            <Box />
            
            <TextField 
              label="Minimum memory (MiB)" 
              value={minMemory} 
              onChange={(e) => setMinMemory(parseInt(e.target.value) || 512)} 
              size="small" 
              type="number"
              inputProps={{ min: 16, step: 128 }}
              disabled={!ballooning}
            />
            <Box />
            
            <Typography variant="body2" sx={{ opacity: 0.7 }}>Shares: Default (1000)</Typography>
            <Box />
            
            <FormControlLabel 
              control={<Switch checked={ballooning} onChange={(e) => setBallooning(e.target.checked)} size="small" />} 
              label="Ballooning Device" 
            />
          </Box>
        )

      case 6: // Network
        return (
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <FormControlLabel 
              control={<Switch checked={noNetwork} onChange={(e) => setNoNetwork(e.target.checked)} size="small" />} 
              label="No network device" 
              sx={{ gridColumn: '1 / -1' }}
            />
            
            {!noNetwork && (
              <>
                <TextField 
                  label="Bridge" 
                  value={networkBridge} 
                  onChange={(e) => setNetworkBridge(e.target.value)} 
                  size="small"
                />
                <FormControl fullWidth size="small">
                  <InputLabel>Model</InputLabel>
                  <Select value={networkModel} onChange={(e) => setNetworkModel(e.target.value)} label="Model">
                    <MenuItem value="virtio">VirtIO (paravirtualized)</MenuItem>
                    <MenuItem value="e1000">Intel E1000</MenuItem>
                    <MenuItem value="rtl8139">Realtek RTL8139</MenuItem>
                    <MenuItem value="vmxnet3">VMware vmxnet3</MenuItem>
                  </Select>
                </FormControl>
                
                <TextField 
                  label="VLAN Tag" 
                  value={vlanTag} 
                  onChange={(e) => setVlanTag(e.target.value)} 
                  size="small"
                  placeholder="no VLAN"
                />
                <TextField 
                  label="MAC address" 
                  value={macAddress} 
                  onChange={(e) => setMacAddress(e.target.value)} 
                  size="small"
                  placeholder="auto"
                />
                
                <FormControlLabel 
                  control={<Switch checked={firewall} onChange={(e) => setFirewall(e.target.checked)} size="small" />} 
                  label="Firewall" 
                />
                <Box />
                
                <Divider sx={{ gridColumn: '1 / -1', my: 1 }} />
                
                <FormControlLabel 
                  control={<Switch checked={networkDisconnect} onChange={(e) => setNetworkDisconnect(e.target.checked)} size="small" />} 
                  label="Disconnect" 
                />
                <TextField 
                  label="Rate limit (MB/s)" 
                  value={rateLimit} 
                  onChange={(e) => setRateLimit(e.target.value)} 
                  size="small"
                  placeholder="unlimited"
                />
                
                <TextField 
                  label="MTU" 
                  value={mtu} 
                  onChange={(e) => setMtu(e.target.value)} 
                  size="small"
                  placeholder="1500 (1 = bridge MTU)"
                />
              </>
            )}
          </Box>
        )

      case 7: // Confirm
        return (
          <Box>
            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
            <Alert severity="info" sx={{ mb: 2 }}>
              Review your settings before creating the VM
            </Alert>
            <Box sx={{ bgcolor: 'action.hover', p: 2, borderRadius: 1, fontFamily: 'monospace', fontSize: '0.85rem' }}>
              <Typography variant="body2"><b>Node:</b> {selectedNode}</Typography>
              <Typography variant="body2"><b>VM ID:</b> {vmid}</Typography>
              <Typography variant="body2"><b>Name:</b> {vmName}</Typography>
              <Divider sx={{ my: 1 }} />
              <Typography variant="body2"><b>OS:</b> {guestOsType} {guestOsVersion}</Typography>
              {osMediaType === 'iso' && <Typography variant="body2"><b>ISO:</b> {isoStorage}:iso/{isoImage}</Typography>}
              <Divider sx={{ my: 1 }} />
              <Typography variant="body2"><b>Machine:</b> {machine} / {bios}</Typography>
              <Typography variant="body2"><b>SCSI:</b> {scsiController}</Typography>
              <Divider sx={{ my: 1 }} />
              <Typography variant="body2"><b>Disk:</b> {diskBus}0 - {diskStorage}:{diskSize}GB</Typography>
              <Divider sx={{ my: 1 }} />
              <Typography variant="body2"><b>CPU:</b> {cpuSockets} socket(s) × {cpuCores} core(s) = {cpuSockets * cpuCores} vCPU(s), type={cpuType}</Typography>
              <Divider sx={{ my: 1 }} />
              <Typography variant="body2"><b>Memory:</b> {memorySize} MiB {ballooning ? `(balloon min: ${minMemory} MiB)` : ''}</Typography>
              <Divider sx={{ my: 1 }} />
              {!noNetwork ? (
                <Typography variant="body2"><b>Network:</b> {networkModel} on {networkBridge}{vlanTag ? ` (VLAN ${vlanTag})` : ''}</Typography>
              ) : (
                <Typography variant="body2"><b>Network:</b> None</Typography>
              )}
            </Box>
          </Box>
        )

      default:
        return null
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ 
        bgcolor: theme.palette.mode === 'dark' ? 'rgba(0,150,200,0.15)' : 'primary.light',
        color: theme.palette.mode === 'dark' ? 'primary.light' : 'primary.contrastText',
        display: 'flex', 
        alignItems: 'center', 
        gap: 1,
        py: 1.5
      }}>
        <i className="ri-computer-line" style={{ fontSize: 20 }} />
        Create: Virtual Machine
      </DialogTitle>
      
      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs 
          value={activeTab} 
          onChange={(_, v) => setActiveTab(v)}
          variant="scrollable"
          scrollButtons="auto"
        >
          {tabs.map((label, idx) => (
            <Tab 
              key={label} 
              label={label} 
              sx={{ 
                minWidth: 80,
                fontWeight: activeTab === idx ? 700 : 400,
              }} 
            />
          ))}
        </Tabs>
      </Box>
      
      <DialogContent sx={{ minHeight: 350, pt: 3 }}>
        {loadingData ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          renderTabContent()
        )}
      </DialogContent>
      
      <DialogActions sx={{ px: 3, py: 2, borderTop: 1, borderColor: 'divider' }}>
        <Button onClick={onClose} disabled={creating}>Cancel</Button>
        <Box sx={{ flex: 1 }} />
        <Button 
          onClick={() => setActiveTab(prev => Math.max(0, prev - 1))} 
          disabled={activeTab === 0 || creating}
        >
          Back
        </Button>
        {activeTab < tabs.length - 1 ? (
          <Button onClick={() => setActiveTab(prev => prev + 1)} variant="contained">
            Next
          </Button>
        ) : (
          <Button 
            onClick={handleCreate} 
            variant="contained" 
            color="primary"
            disabled={creating || !vmid || !selectedNode || !!vmidError}
            startIcon={creating ? <CircularProgress size={16} /> : null}
          >
            Create
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* CreateLxcDialog - Dialog de création de conteneur LXC (style Proxmox) */
/* ------------------------------------------------------------------ */

function CreateLxcDialog({ 
  open, 
  onClose,
  allVms = [],
  onCreated
}: { 
  open: boolean
  onClose: () => void
  allVms: AllVmItem[]
  onCreated?: (vmid: string, connId: string, node: string) => void
}) {
  const theme = useTheme()
  
  const [activeTab, setActiveTab] = useState(0)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // Données dynamiques
  const [connections, setConnections] = useState<any[]>([])
  const [nodes, setNodes] = useState<any[]>([])
  const [storages, setStorages] = useState<any[]>([])
  const [templates, setTemplates] = useState<any[]>([])
  const [loadingData, setLoadingData] = useState(false)
  
  // Formulaire - Général
  const [selectedConnection, setSelectedConnection] = useState('')
  const [selectedNode, setSelectedNode] = useState('')
  const [ctid, setCtid] = useState('')
  const [ctidError, setCtidError] = useState<string | null>(null)
  const [hostname, setHostname] = useState('')
  const [unprivileged, setUnprivileged] = useState(true)
  const [nesting, setNesting] = useState(false)
  const [resourcePool, setResourcePool] = useState('')
  const [rootPassword, setRootPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [sshKeys, setSshKeys] = useState('')
  const [startOnBoot, setStartOnBoot] = useState(false)
  
  // Formulaire - Template
  const [templateStorage, setTemplateStorage] = useState('')
  const [template, setTemplate] = useState('')
  
  // Formulaire - Disks
  const [rootStorage, setRootStorage] = useState('')
  const [rootSize, setRootSize] = useState(8)
  
  // Formulaire - CPU
  const [cpuCores, setCpuCores] = useState(1)
  const [cpuLimit, setCpuLimit] = useState(0)
  const [cpuUnits, setCpuUnits] = useState(1024)
  
  // Formulaire - Memory
  const [memorySize, setMemorySize] = useState(512)
  const [swapSize, setSwapSize] = useState(512)
  
  // Formulaire - Network
  const [networkName, setNetworkName] = useState('eth0')
  const [networkBridge, setNetworkBridge] = useState('vmbr0')
  const [ipConfig, setIpConfig] = useState('dhcp')
  const [ip4, setIp4] = useState('')
  const [gw4, setGw4] = useState('')
  const [ip6Config, setIp6Config] = useState('auto')
  const [ip6, setIp6] = useState('')
  const [gw6, setGw6] = useState('')
  const [firewall, setFirewall] = useState(true)
  const [vlanTag, setVlanTag] = useState('')
  const [mtu, setMtu] = useState('')
  const [rateLimit, setRateLimit] = useState('')
  
  // Formulaire - DNS
  const [dnsServer, setDnsServer] = useState('')
  const [searchDomain, setSearchDomain] = useState('')

  // Calculer le prochain CTID disponible (global sur toutes les VMs)
  useEffect(() => {
    if (allVms.length > 0) {
      const usedIds = allVms.map(vm => parseInt(String(vm.vmid), 10))
      
      let nextId = 100

      while (usedIds.includes(nextId)) {
        nextId++
      }

      setCtid(String(nextId))
      setCtidError(null)
    }
  }, [allVms])

  // Valider le CTID quand il change
  const handleCtidChange = (value: string) => {
    const numericValue = value.replace(/[^0-9]/g, '')

    setCtid(numericValue)
    
    if (!numericValue) {
      setCtidError(null)
      
return
    }
    
    const ctidNum = parseInt(numericValue, 10)
    
    if (ctidNum < 100) {
      setCtidError('CT ID must be >= 100')
      
return
    }

    if (ctidNum > 999999999) {
      setCtidError('CT ID must be <= 999999999')
      
return
    }
    
    const isUsed = allVms.some(vm => parseInt(String(vm.vmid), 10) === ctidNum)

    if (isUsed) {
      setCtidError(`CT ID ${ctidNum} is already in use`)
      
return
    }
    
    setCtidError(null)
  }

  // Charger toutes les connexions et tous leurs nodes
  const loadAllData = async () => {
    setLoadingData(true)

    try {
      const connRes = await fetch('/api/v1/connections?type=pve')
      const connJson = await connRes.json()
      const connectionsList = connJson.data || []

      setConnections(connectionsList)
      
      const allNodes: any[] = []

      await Promise.all(
        connectionsList.map(async (conn: any) => {
          try {
            const nodesRes = await fetch(`/api/v1/connections/${encodeURIComponent(conn.id)}/nodes`)
            const nodesJson = await nodesRes.json()
            const nodesList = nodesJson.data || []
            
            nodesList.forEach((node: any) => {
              allNodes.push({
                ...node,
                connId: conn.id,
                connName: conn.name,
              })
            })
          } catch (e) {
            console.error(`Error loading nodes for connection ${conn.id}:`, e)
          }
        })
      )
      
      setNodes(allNodes)
      
      if (allNodes.length > 0 && !selectedNode) {
        setSelectedNode(allNodes[0].node)
        setSelectedConnection(allNodes[0].connId)
      }
      
    } catch (e) {
      console.error('Error loading data:', e)
    } finally {
      setLoadingData(false)
    }
  }

  useEffect(() => {
    if (open) {
      setActiveTab(0)
      setError(null)
      loadAllData()
    }
  }, [open])

  useEffect(() => {
    if (selectedConnection && selectedNode) {
      loadStorages(selectedConnection)
    }
  }, [selectedConnection, selectedNode])

  const handleNodeChange = (nodeName: string) => {
    setSelectedNode(nodeName)
    const nodeData = nodes.find(n => n.node === nodeName)

    if (nodeData) {
      setSelectedConnection(nodeData.connId)
    }
  }

  const loadStorages = async (connId: string) => {
    try {
      const storagesRes = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/storage`)
      const storagesJson = await storagesRes.json()
      
      setStorages(storagesJson.data || [])
      
      const templateStorages = (storagesJson.data || []).filter((s: any) => s.content?.includes('vztmpl'))

      const diskStorages = (storagesJson.data || []).filter((s: any) => 
        s.content?.includes('rootdir') || s.content?.includes('images')
      )
      
      if (templateStorages.length > 0 && !templateStorage) {
        setTemplateStorage(templateStorages[0].storage)
      }

      if (diskStorages.length > 0 && !rootStorage) {
        setRootStorage(diskStorages[0].storage)
      }
    } catch (e) {
      console.error('Error loading storages:', e)
    }
  }

  const handleCreate = async () => {
    setCreating(true)
    setError(null)
    
    try {
      if (rootPassword && rootPassword !== confirmPassword) {
        throw new Error('Passwords do not match')
      }

      const payload: any = {
        vmid: parseInt(ctid, 10),
        hostname: hostname,
        cores: cpuCores,
        memory: memorySize,
        swap: swapSize,
        unprivileged: unprivileged ? 1 : 0,
        onboot: startOnBoot ? 1 : 0,
        rootfs: `${rootStorage}:${rootSize}`,
      }

      if (templateStorage && template) {
        payload.ostemplate = `${templateStorage}:vztmpl/${template}`
      }

      if (cpuLimit > 0) payload.cpulimit = cpuLimit
      if (cpuUnits !== 1024) payload.cpuunits = cpuUnits
      if (nesting) payload.features = 'nesting=1'

      // Network
      let net0 = `name=${networkName},bridge=${networkBridge}`

      if (ipConfig === 'static' && ip4) {
        net0 += `,ip=${ip4}`
        if (gw4) net0 += `,gw=${gw4}`
      } else if (ipConfig === 'dhcp') {
        net0 += ',ip=dhcp'
      }

      if (ip6Config === 'static' && ip6) {
        net0 += `,ip6=${ip6}`
        if (gw6) net0 += `,gw6=${gw6}`
      } else if (ip6Config === 'auto') {
        net0 += ',ip6=auto'
      } else if (ip6Config === 'dhcp') {
        net0 += ',ip6=dhcp'
      }

      if (firewall) net0 += ',firewall=1'
      if (vlanTag) net0 += `,tag=${vlanTag}`
      if (rateLimit) net0 += `,rate=${rateLimit}`
      payload.net0 = net0

      if (dnsServer) payload.nameserver = dnsServer
      if (searchDomain) payload.searchdomain = searchDomain
      if (rootPassword) payload.password = rootPassword
      if (sshKeys) payload['ssh-public-keys'] = sshKeys
      if (resourcePool) payload.pool = resourcePool

      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(selectedConnection)}/guests/lxc/${encodeURIComponent(selectedNode)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }
      )

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))

        throw new Error(err?.error || `HTTP ${res.status}`)
      }

      onCreated?.(ctid, selectedConnection, selectedNode)
      onClose()
    } catch (e: any) {
      setError(e?.message || 'Error creating container')
    } finally {
      setCreating(false)
    }
  }

  const tabs = ['General', 'Template', 'Disks', 'CPU', 'Memory', 'Network', 'DNS', 'Confirm']
  
  const templateStoragesList = storages.filter(s => s.content?.includes('vztmpl'))
  const diskStoragesList = storages.filter(s => s.content?.includes('rootdir') || s.content?.includes('images'))

  const renderTabContent = () => {
    switch (activeTab) {
      case 0: // General
        return (
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Node</InputLabel>
              <Select value={selectedNode} onChange={(e) => handleNodeChange(e.target.value)} label="Node">
                {nodes.map(n => (
                  <MenuItem key={`${n.connId}-${n.node}`} value={n.node}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {n.node}
                      <Typography component="span" sx={{ opacity: 0.6, fontSize: '0.8em' }}>
                        ({n.connName})
                      </Typography>
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>Resource Pool</InputLabel>
              <Select value={resourcePool} onChange={(e) => setResourcePool(e.target.value)} label="Resource Pool">
                <MenuItem value="">(None)</MenuItem>
              </Select>
            </FormControl>
            
            <TextField 
              label="CT ID" 
              value={ctid} 
              onChange={(e) => handleCtidChange(e.target.value)} 
              size="small" 
              error={!!ctidError}
              helperText={ctidError}
              inputProps={{ inputMode: 'numeric', pattern: '[0-9]*' }}
            />
            <Box />
            
            <TextField label="Hostname" value={hostname} onChange={(e) => setHostname(e.target.value)} size="small" />
            <Box />
            
            <FormControlLabel 
              control={<Switch checked={unprivileged} onChange={(e) => setUnprivileged(e.target.checked)} size="small" />} 
              label="Unprivileged container" 
            />
            <FormControlLabel 
              control={<Switch checked={nesting} onChange={(e) => setNesting(e.target.checked)} size="small" />} 
              label="Nesting" 
            />
            
            <Divider sx={{ gridColumn: '1 / -1', my: 1 }} />
            
            <TextField 
              label="Password" 
              value={rootPassword} 
              onChange={(e) => setRootPassword(e.target.value)} 
              size="small" 
              type="password"
            />
            <TextField 
              label="Confirm password" 
              value={confirmPassword} 
              onChange={(e) => setConfirmPassword(e.target.value)} 
              size="small" 
              type="password"
              error={confirmPassword !== '' && rootPassword !== confirmPassword}
            />
            
            <TextField 
              label="SSH public key" 
              value={sshKeys} 
              onChange={(e) => setSshKeys(e.target.value)} 
              size="small" 
              multiline
              rows={2}
              sx={{ gridColumn: '1 / -1' }}
              placeholder="ssh-rsa AAAA..."
            />
          </Box>
        )

      case 1: // Template
        return (
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Storage</InputLabel>
              <Select value={templateStorage} onChange={(e) => setTemplateStorage(e.target.value)} label="Storage">
                {templateStoragesList.map(s => <MenuItem key={s.storage} value={s.storage}>{s.storage}</MenuItem>)}
              </Select>
            </FormControl>
            <Box />
            
            <TextField 
              label="Template" 
              value={template} 
              onChange={(e) => setTemplate(e.target.value)} 
              size="small" 
              sx={{ gridColumn: '1 / -1' }}
              placeholder="debian-12-standard_12.2-1_amd64.tar.zst"
              helperText="Enter the template filename (must be downloaded on the storage first)"
            />
          </Box>
        )

      case 2: // Disks
        return (
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Storage</InputLabel>
              <Select value={rootStorage} onChange={(e) => setRootStorage(e.target.value)} label="Storage">
                {diskStoragesList.map(s => (
                  <MenuItem key={s.storage} value={s.storage}>{s.storage} ({s.type})</MenuItem>
                ))}
              </Select>
            </FormControl>
            <Box />
            
            <TextField 
              label="Disk size (GiB)" 
              value={rootSize} 
              onChange={(e) => setRootSize(parseInt(e.target.value) || 1)} 
              size="small" 
              type="number"
              inputProps={{ min: 1, max: 1000 }}
            />
          </Box>
        )

      case 3: // CPU
        return (
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <TextField 
              label="Cores" 
              value={cpuCores} 
              onChange={(e) => setCpuCores(parseInt(e.target.value) || 1)} 
              size="small" 
              type="number"
              inputProps={{ min: 1, max: 128 }}
            />
            <Box />
            
            <TextField 
              label="CPU limit" 
              value={cpuLimit === 0 ? '' : cpuLimit} 
              onChange={(e) => setCpuLimit(parseFloat(e.target.value) || 0)} 
              size="small" 
              type="number"
              placeholder="unlimited"
              inputProps={{ min: 0, max: cpuCores, step: 0.1 }}
            />
            <TextField 
              label="CPU units" 
              value={cpuUnits} 
              onChange={(e) => setCpuUnits(parseInt(e.target.value) || 1024)} 
              size="small" 
              type="number"
            />
          </Box>
        )

      case 4: // Memory
        return (
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <TextField 
              label="Memory (MiB)" 
              value={memorySize} 
              onChange={(e) => setMemorySize(parseInt(e.target.value) || 128)} 
              size="small" 
              type="number"
              inputProps={{ min: 16, step: 32 }}
            />
            <Box />
            
            <TextField 
              label="Swap (MiB)" 
              value={swapSize} 
              onChange={(e) => setSwapSize(parseInt(e.target.value) || 0)} 
              size="small" 
              type="number"
              inputProps={{ min: 0, step: 32 }}
            />
          </Box>
        )

      case 5: // Network
        return (
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <TextField 
              label="Name" 
              value={networkName} 
              onChange={(e) => setNetworkName(e.target.value)} 
              size="small"
            />
            <TextField 
              label="Bridge" 
              value={networkBridge} 
              onChange={(e) => setNetworkBridge(e.target.value)} 
              size="small"
            />
            
            <FormControl fullWidth size="small">
              <InputLabel>IPv4</InputLabel>
              <Select value={ipConfig} onChange={(e) => setIpConfig(e.target.value)} label="IPv4">
                <MenuItem value="dhcp">DHCP</MenuItem>
                <MenuItem value="static">Static</MenuItem>
                <MenuItem value="manual">Manual</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>IPv6</InputLabel>
              <Select value={ip6Config} onChange={(e) => setIp6Config(e.target.value)} label="IPv6">
                <MenuItem value="auto">SLAAC</MenuItem>
                <MenuItem value="dhcp">DHCP</MenuItem>
                <MenuItem value="static">Static</MenuItem>
                <MenuItem value="manual">Manual</MenuItem>
              </Select>
            </FormControl>
            
            {ipConfig === 'static' && (
              <>
                <TextField 
                  label="IPv4/CIDR" 
                  value={ip4} 
                  onChange={(e) => setIp4(e.target.value)} 
                  size="small"
                  placeholder="192.168.1.100/24"
                />
                <TextField 
                  label="Gateway (IPv4)" 
                  value={gw4} 
                  onChange={(e) => setGw4(e.target.value)} 
                  size="small"
                  placeholder="192.168.1.1"
                />
              </>
            )}
            
            {ip6Config === 'static' && (
              <>
                <TextField 
                  label="IPv6/CIDR" 
                  value={ip6} 
                  onChange={(e) => setIp6(e.target.value)} 
                  size="small"
                />
                <TextField 
                  label="Gateway (IPv6)" 
                  value={gw6} 
                  onChange={(e) => setGw6(e.target.value)} 
                  size="small"
                />
              </>
            )}
            
            <Divider sx={{ gridColumn: '1 / -1', my: 1 }} />
            
            <FormControlLabel 
              control={<Switch checked={firewall} onChange={(e) => setFirewall(e.target.checked)} size="small" />} 
              label="Firewall" 
            />
            <TextField 
              label="VLAN Tag" 
              value={vlanTag} 
              onChange={(e) => setVlanTag(e.target.value)} 
              size="small"
              placeholder="no VLAN"
            />
            
            <TextField 
              label="MTU" 
              value={mtu} 
              onChange={(e) => setMtu(e.target.value)} 
              size="small"
              placeholder="same as bridge"
            />
            <TextField 
              label="Rate limit (MB/s)" 
              value={rateLimit} 
              onChange={(e) => setRateLimit(e.target.value)} 
              size="small"
              placeholder="unlimited"
            />
          </Box>
        )

      case 6: // DNS
        return (
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <TextField 
              label="DNS domain" 
              value={searchDomain} 
              onChange={(e) => setSearchDomain(e.target.value)} 
              size="small"
              placeholder="use host settings"
            />
            <Box />
            
            <TextField 
              label="DNS servers" 
              value={dnsServer} 
              onChange={(e) => setDnsServer(e.target.value)} 
              size="small"
              placeholder="use host settings"
            />
          </Box>
        )

      case 7: // Confirm
        return (
          <Box>
            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
            <Alert severity="info" sx={{ mb: 2 }}>
              Review your settings before creating the container
            </Alert>
            <Box sx={{ bgcolor: 'action.hover', p: 2, borderRadius: 1, fontFamily: 'monospace', fontSize: '0.85rem' }}>
              <Typography variant="body2"><b>Node:</b> {selectedNode}</Typography>
              <Typography variant="body2"><b>CT ID:</b> {ctid}</Typography>
              <Typography variant="body2"><b>Hostname:</b> {hostname}</Typography>
              <Typography variant="body2"><b>Unprivileged:</b> {unprivileged ? 'Yes' : 'No'}</Typography>
              <Divider sx={{ my: 1 }} />
              <Typography variant="body2"><b>Template:</b> {templateStorage}:vztmpl/{template || '(none)'}</Typography>
              <Divider sx={{ my: 1 }} />
              <Typography variant="body2"><b>Root disk:</b> {rootStorage}:{rootSize}GB</Typography>
              <Divider sx={{ my: 1 }} />
              <Typography variant="body2"><b>CPU:</b> {cpuCores} core(s){cpuLimit > 0 ? `, limit: ${cpuLimit}` : ''}</Typography>
              <Divider sx={{ my: 1 }} />
              <Typography variant="body2"><b>Memory:</b> {memorySize} MiB, Swap: {swapSize} MiB</Typography>
              <Divider sx={{ my: 1 }} />
              <Typography variant="body2"><b>Network:</b> {networkName} on {networkBridge} ({ipConfig})</Typography>
            </Box>
          </Box>
        )

      default:
        return null
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ 
        bgcolor: theme.palette.mode === 'dark' ? 'rgba(0,150,200,0.15)' : 'primary.light',
        color: theme.palette.mode === 'dark' ? 'primary.light' : 'primary.contrastText',
        display: 'flex', 
        alignItems: 'center', 
        gap: 1,
        py: 1.5
      }}>
        <i className="ri-instance-line" style={{ fontSize: 20 }} />
        Create: LXC Container
      </DialogTitle>
      
      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs 
          value={activeTab} 
          onChange={(_, v) => setActiveTab(v)}
          variant="scrollable"
          scrollButtons="auto"
        >
          {tabs.map((label, idx) => (
            <Tab 
              key={label} 
              label={label} 
              sx={{ 
                minWidth: 80,
                fontWeight: activeTab === idx ? 700 : 400,
              }} 
            />
          ))}
        </Tabs>
      </Box>
      
      <DialogContent sx={{ minHeight: 350, pt: 3 }}>
        {loadingData ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          renderTabContent()
        )}
      </DialogContent>
      
      <DialogActions sx={{ px: 3, py: 2, borderTop: 1, borderColor: 'divider' }}>
        <Button onClick={onClose} disabled={creating}>Cancel</Button>
        <Box sx={{ flex: 1 }} />
        <Button 
          onClick={() => setActiveTab(prev => Math.max(0, prev - 1))} 
          disabled={activeTab === 0 || creating}
        >
          Back
        </Button>
        {activeTab < tabs.length - 1 ? (
          <Button onClick={() => setActiveTab(prev => prev + 1)} variant="contained">
            Next
          </Button>
        ) : (
          <Button 
            onClick={handleCreate} 
            variant="contained" 
            color="primary"
            disabled={creating || !ctid || !selectedNode || !!ctidError}
            startIcon={creating ? <CircularProgress size={16} /> : null}
          >
            Create
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* HA Group Dialog                                                     */
/* ------------------------------------------------------------------ */

type HaGroupDialogProps = {
  open: boolean
  onClose: () => void
  group: any | null // null = création, sinon = édition
  connId: string
  availableNodes: string[]
  onSaved: () => void
}

function HaGroupDialog({ open, onClose, group, connId, availableNodes, onSaved }: HaGroupDialogProps) {
  const t = useTranslations()
  const [name, setName] = useState('')
  const [selectedNodes, setSelectedNodes] = useState<string[]>([])
  const [restricted, setRestricted] = useState(false)
  const [nofailback, setNofailback] = useState(false)
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Initialiser les valeurs quand le dialog s'ouvre
  useEffect(() => {
    if (open) {
      if (group) {
        // Mode édition
        setName(group.group || '')

        // Parser les nodes (format: "node1:1,node2:2" ou "node1,node2")
        const nodesStr = group.nodes || ''
        const nodesList = nodesStr.split(',').map((n: string) => n.split(':')[0].trim()).filter(Boolean)

        setSelectedNodes(nodesList)
        setRestricted(!!group.restricted)
        setNofailback(!!group.nofailback)
        setComment(group.comment || '')
      } else {
        // Mode création
        setName('')
        setSelectedNodes([])
        setRestricted(false)
        setNofailback(false)
        setComment('')
      }

      setError(null)
    }
  }, [open, group])

  const handleSave = async () => {
    if (!name.trim()) {
      setError(t('inventoryPage.groupNameRequired'))
      
return
    }

    if (selectedNodes.length === 0) {
      setError(t('inventoryPage.selectAtLeastOneNode'))
      
return
    }

    setSaving(true)
    setError(null)

    try {
      const nodesString = selectedNodes.join(',')
      
      const url = group
        ? `/api/v1/connections/${encodeURIComponent(connId)}/ha/groups/${encodeURIComponent(group.group)}`
        : `/api/v1/connections/${encodeURIComponent(connId)}/ha/groups`
      
      const method = group ? 'PUT' : 'POST'
      
      const body: any = {
        nodes: nodesString,
        restricted,
        nofailback,
        comment: comment || undefined
      }
      
      if (!group) {
        body.group = name.trim()
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })

      if (!res.ok) {
        const err = await res.json()

        setError(err.error || t('errors.updateError'))
        
return
      }

      onSaved()
    } catch (e: any) {
      setError(e.message || t('errors.updateError'))
    } finally {
      setSaving(false)
    }
  }

  const toggleNode = (node: string) => {
    setSelectedNodes(prev => 
      prev.includes(node) 
        ? prev.filter(n => n !== node)
        : [...prev, node]
    )
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <i className="ri-group-line" style={{ fontSize: 20 }} />
        {group ? t('drs.editHaGroup') : t('drs.createHaGroup')}
      </DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
        )}

        <TextField
          fullWidth
          label={t('inventoryPage.groupName')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!!group || saving}
          sx={{ mt: 1, mb: 2 }}
          placeholder="Ex: HA-3AZ"
          helperText={group ? t('inventoryPage.nameCannotBeModified') : t('inventoryPage.uniqueGroupId')}
        />

        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          {t('inventoryPage.nodesCount', { selected: selectedNodes.length, total: availableNodes.length })}
        </Typography>
        
        <Box sx={{ 
          border: '1px solid', 
          borderColor: 'divider', 
          borderRadius: 1, 
          maxHeight: 200, 
          overflow: 'auto',
          mb: 2
        }}>
          <List dense disablePadding>
            {availableNodes.map(node => (
              <ListItemButton 
                key={node} 
                onClick={() => toggleNode(node)}
                sx={{ py: 0.5 }}
              >
                <ListItemIcon sx={{ minWidth: 36 }}>
                  <Switch 
                    size="small" 
                    checked={selectedNodes.includes(node)} 
                    onChange={() => toggleNode(node)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </ListItemIcon>
                <ListItemText 
                  primary={node} 
                  primaryTypographyProps={{ variant: 'body2' }}
                />
              </ListItemButton>
            ))}
          </List>
        </Box>

        <Stack direction="row" spacing={3} sx={{ mb: 2 }}>
          <FormControlLabel
            control={
              <Switch 
                checked={restricted} 
                onChange={(e) => setRestricted(e.target.checked)}
                disabled={saving}
              />
            }
            label={
              <Box>
                <Typography variant="body2">Restricted</Typography>
                <Typography variant="caption" sx={{ opacity: 0.6 }}>
                  {t('inventoryPage.resourcesCanOnlyMigrate')}
                </Typography>
              </Box>
            }
          />
          <FormControlLabel
            control={
              <Switch 
                checked={nofailback} 
                onChange={(e) => setNofailback(e.target.checked)}
                disabled={saving}
              />
            }
            label={
              <Box>
                <Typography variant="body2">No Failback</Typography>
                <Typography variant="caption" sx={{ opacity: 0.6 }}>
                  {t('inventoryPage.doNotReturnToPreferred')}
                </Typography>
              </Box>
            }
          />
        </Stack>

        <TextField
          fullWidth
          label={t('inventoryPage.comment')}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          disabled={saving}
          multiline
          rows={2}
          placeholder={t('inventoryPage.optionalGroupDescription')}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
        <Button 
          variant="contained" 
          onClick={handleSave}
          disabled={saving || !name.trim() || selectedNodes.length === 0}
          startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
        >
          {saving ? t('common.saving') : group ? t('common.edit') : t('common.create')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* HA Rule Dialog (PVE 9+ Affinity Rules)                              */
/* ------------------------------------------------------------------ */

type HaRuleDialogProps = {
  open: boolean
  onClose: () => void
  rule: any | null // null = création, sinon = édition
  ruleType: 'node-affinity' | 'resource-affinity'
  connId: string
  availableNodes: string[]
  availableResources: any[] // HA resources
  onSaved: () => void
}

function HaRuleDialog({ open, onClose, rule, ruleType, connId, availableNodes, availableResources, onSaved }: HaRuleDialogProps) {
  const t = useTranslations()
  const [name, setName] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [strict, setStrict] = useState(false)
  const [affinity, setAffinity] = useState<'positive' | 'negative'>('positive')
  const [selectedNodes, setSelectedNodes] = useState<string[]>([])
  const [selectedResources, setSelectedResources] = useState<string[]>([])
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Initialiser les valeurs quand le dialog s'ouvre
  useEffect(() => {
    if (open) {
      if (rule) {
        // Mode édition
        setName(rule.rule || '')
        setEnabled(rule.state !== 'disabled')
        setStrict(!!rule.strict)
        setAffinity(rule.affinity === 'negative' ? 'negative' : 'positive')

        // Parser les nodes
        const nodesStr = rule.nodes || ''
        const nodesList = nodesStr.split(',').map((n: string) => n.split(':')[0].trim()).filter(Boolean)

        setSelectedNodes(nodesList)

        // Parser les resources
        const resourcesStr = rule.resources || ''
        const resourcesList = resourcesStr.split(',').map((r: string) => r.trim()).filter(Boolean)

        setSelectedResources(resourcesList)
        setComment(rule.comment || '')
      } else {
        // Mode création
        setName('')
        setEnabled(true)
        setStrict(false)
        setAffinity('positive')
        setSelectedNodes([])
        setSelectedResources([])
        setComment('')
      }

      setError(null)
    }
  }, [open, rule])

  const handleSave = async () => {
    if (!name.trim() && !rule) {
      setError(t('inventoryPage.ruleNameRequired'))
      
return
    }

    if (ruleType === 'node-affinity' && selectedNodes.length === 0) {
      setError(t('inventoryPage.selectAtLeastOneNode'))
      
return
    }

    if (selectedResources.length === 0) {
      setError(t('inventoryPage.selectAtLeastOneResource'))
      
return
    }

    setSaving(true)
    setError(null)

    try {
      const nodesString = selectedNodes.join(',')
      const resourcesString = selectedResources.join(',')
      
      const url = rule
        ? `/api/v1/connections/${encodeURIComponent(connId)}/ha/affinity-rules/${encodeURIComponent(rule.rule)}`
        : `/api/v1/connections/${encodeURIComponent(connId)}/ha/affinity-rules`
      
      const method = rule ? 'PUT' : 'POST'
      
      const body: any = {
        resources: resourcesString,
        state: enabled ? 'enabled' : 'disabled',
        comment: comment || undefined
      }
      
      if (!rule) {
        body.type = ruleType
        body.rule = name.trim()
      }
      
      if (ruleType === 'node-affinity') {
        body.nodes = nodesString
        body.strict = strict
      } else {
        body.affinity = affinity
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })

      if (!res.ok) {
        const err = await res.json()

        setError(err.error || t('errors.updateError'))
        
return
      }

      onSaved()
    } catch (e: any) {
      setError(e.message || t('errors.updateError'))
    } finally {
      setSaving(false)
    }
  }

  const toggleNode = (node: string) => {
    setSelectedNodes(prev => 
      prev.includes(node) 
        ? prev.filter(n => n !== node)
        : [...prev, node]
    )
  }

  const toggleResource = (resource: string) => {
    setSelectedResources(prev => 
      prev.includes(resource) 
        ? prev.filter(r => r !== resource)
        : [...prev, resource]
    )
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <i className={ruleType === 'node-affinity' ? 'ri-node-tree' : 'ri-links-line'} style={{ fontSize: 20 }} />
        {rule ? t('common.edit') : t('common.create')} {ruleType === 'node-affinity' ? 'Node Affinity Rule' : 'Resource Affinity Rule'}
      </DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
        )}

        <TextField
          fullWidth
          label={t('inventoryPage.ruleName')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!!rule || saving}
          sx={{ mt: 1, mb: 2 }}
          placeholder="Ex: ha-rule-web-servers"
          helperText={rule ? t('inventoryPage.nameCannotBeModified') : t('inventoryPage.uniqueRuleId')}
        />

        <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
          <FormControlLabel
            control={
              <Switch 
                checked={enabled} 
                onChange={(e) => setEnabled(e.target.checked)}
                disabled={saving}
              />
            }
            label={t('common.enabled')}
          />
          
          {ruleType === 'node-affinity' && (
            <FormControlLabel
              control={
                <Switch 
                  checked={strict} 
                  onChange={(e) => setStrict(e.target.checked)}
                  disabled={saving}
                />
              }
              label={
                <Box>
                  <Typography variant="body2">Strict</Typography>
                  <Typography variant="caption" sx={{ opacity: 0.6 }}>
                    {t('inventoryPage.restrictToSelectedNodes')}
                  </Typography>
                </Box>
              }
            />
          )}
          
          {ruleType === 'resource-affinity' && (
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel>Affinity</InputLabel>
              <Select
                value={affinity}
                onChange={(e) => setAffinity(e.target.value as 'positive' | 'negative')}
                label="Affinity"
                disabled={saving}
              >
                <MenuItem value="positive">Keep Together</MenuItem>
                <MenuItem value="negative">Keep Separate</MenuItem>
              </Select>
            </FormControl>
          )}
        </Stack>

        {/* Sélection des ressources HA */}
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          HA Resources ({selectedResources.length})
        </Typography>
        
        <Box sx={{ 
          border: '1px solid', 
          borderColor: 'divider', 
          borderRadius: 1, 
          maxHeight: 150, 
          overflow: 'auto',
          mb: 2
        }}>
          {availableResources.length === 0 ? (
            <Box sx={{ p: 2, textAlign: 'center', opacity: 0.6 }}>
              <Typography variant="body2">{t('common.noData')}</Typography>
              <Typography variant="caption">{t('inventoryPage.addHaResourcesFirst')}</Typography>
            </Box>
          ) : (
            <List dense disablePadding>
              {availableResources.map((res: any) => (
                <ListItemButton 
                  key={res.sid} 
                  onClick={() => toggleResource(res.sid)}
                  sx={{ py: 0.5 }}
                >
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <Switch 
                      size="small" 
                      checked={selectedResources.includes(res.sid)} 
                      onChange={() => toggleResource(res.sid)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </ListItemIcon>
                  <ListItemText 
                    primary={res.sid} 
                    primaryTypographyProps={{ variant: 'body2', fontFamily: 'monospace' }}
                  />
                </ListItemButton>
              ))}
            </List>
          )}
        </Box>

        {/* Sélection des nœuds (uniquement pour node-affinity) */}
        {ruleType === 'node-affinity' && (
          <>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Nodes ({selectedNodes.length}/{availableNodes.length})
            </Typography>
            
            <Box sx={{ 
              border: '1px solid', 
              borderColor: 'divider', 
              borderRadius: 1, 
              maxHeight: 150, 
              overflow: 'auto',
              mb: 2
            }}>
              <List dense disablePadding>
                {availableNodes.map(node => (
                  <ListItemButton 
                    key={node} 
                    onClick={() => toggleNode(node)}
                    sx={{ py: 0.5 }}
                  >
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      <Switch 
                        size="small" 
                        checked={selectedNodes.includes(node)} 
                        onChange={() => toggleNode(node)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </ListItemIcon>
                    <ListItemText 
                      primary={node} 
                      primaryTypographyProps={{ variant: 'body2' }}
                    />
                  </ListItemButton>
                ))}
              </List>
            </Box>
          </>
        )}

        <TextField
          fullWidth
          label={t('inventoryPage.comment')}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          disabled={saving}
          multiline
          rows={2}
          placeholder={t('inventoryPage.optionalRuleDescription')}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving || (!rule && !name.trim()) || selectedResources.length === 0 || (ruleType === 'node-affinity' && selectedNodes.length === 0)}
          startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
        >
          {saving ? t('common.saving') : rule ? t('common.edit') : t('common.create')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* RootInventoryView - Vue racine avec Clusters/Hosts/VMs collapsables*/
/* ------------------------------------------------------------------ */

import { ViewMode, AllVmItem, HostItem, PoolItem, TagItem } from './InventoryTree'

function RootInventoryView({
  allVms,
  hosts,
  pbsServers,
  onVmClick,
  onVmAction,
  onMigrate,
  onNodeClick,
  onSelect,
  favorites,
  onToggleFavorite,
  migratingVmIds,
  onLoadTrendsBatch,
  showIpSnap,
  ipSnapLoading,
  onLoadIpSnap,
}: {
  allVms: AllVmItem[]
  hosts: HostItem[]
  pbsServers?: { connId: string; name: string; status: string; backupCount: number }[]
  onVmClick: (vm: VmRow) => void
  onVmAction: (vm: VmRow, action: any) => void
  onMigrate: (vm: { connId: string; node: string; type: string; vmid: string | number; name: string }) => void
  onNodeClick: (connId: string, node: string) => void
  onSelect?: (sel: InventorySelection) => void
  favorites?: Set<string>
  onToggleFavorite?: (vm: { id: string; connId: string; node: string; type: string; vmid: string | number; name?: string }) => void
  migratingVmIds?: Set<string>
  onLoadTrendsBatch?: (vms: VmRow[]) => Promise<Record<string, TrendPoint[]>>
  showIpSnap?: boolean
  ipSnapLoading?: boolean
  onLoadIpSnap?: () => void
}) {
  const t = useTranslations()
  const theme = useTheme()
  
  // Grouper les VMs par cluster (connexion)
  const clusters = useMemo(() => {
    const map = new Map<string, { connId: string; connName: string; vms: AllVmItem[] }>()
    
    allVms.forEach(vm => {
      if (!map.has(vm.connId)) {
        map.set(vm.connId, { connId: vm.connId, connName: vm.connName, vms: [] })
      }
      map.get(vm.connId)!.vms.push(vm)
    })
    
    return Array.from(map.values()).sort((a, b) => a.connName.localeCompare(b.connName))
  }, [allVms])

  // État pour sections collapsed - par défaut tout est replié (on stocke les IDs dépliés, pas repliés)
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set())
  const [expandedHosts, setExpandedHosts] = useState<Set<string>>(new Set())

  // Wrapper pour onToggleFavorite qui passe le VmRow directement
  const handleToggleFavorite = useCallback((vm: VmRow) => {
    onToggleFavorite?.({
      id: vm.id,
      connId: vm.connId,
      node: vm.node,
      type: vm.type,
      vmid: vm.vmid,
      name: vm.name
    })
  }, [onToggleFavorite])
  
  // Helper pour calculer les stats CPU/RAM d'un groupe de VMs
  const calculateStats = (vms: AllVmItem[]) => {
    const runningVms = vms.filter(vm => vm.status === 'running')
    if (runningVms.length === 0) return { avgCpu: 0, avgRam: 0, totalMem: 0, usedMem: 0 }
    
    let totalCpu = 0
    let totalMem = 0
    let usedMem = 0
    let cpuCount = 0
    let memCount = 0
    
    runningVms.forEach(vm => {
      if (vm.cpu !== undefined) {
        totalCpu += vm.cpu * 100
        cpuCount++
      }
      if (vm.mem !== undefined && vm.maxmem !== undefined && vm.maxmem > 0) {
        usedMem += vm.mem
        totalMem += vm.maxmem
        memCount++
      }
    })
    
    return {
      avgCpu: cpuCount > 0 ? totalCpu / cpuCount : 0,
      avgRam: totalMem > 0 ? (usedMem / totalMem) * 100 : 0,
      totalMem,
      usedMem
    }
  }
  
  // Compter les VMs par statut
  const vmStats = useMemo(() => {
    const running = allVms.filter(vm => vm.status === 'running').length
    const stopped = allVms.filter(vm => vm.status === 'stopped').length
    const other = allVms.length - running - stopped
    return { running, stopped, other, total: allVms.length }
  }, [allVms])
  
  const toggleCluster = (connId: string) => {
    setExpandedClusters(prev => {
      const next = new Set(prev)
      if (next.has(connId)) next.delete(connId)
      else next.add(connId)
      return next
    })
  }
  
  const toggleHost = (key: string) => {
    setExpandedHosts(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  
  // Expand/Collapse all
  const expandAll = () => {
    setExpandedClusters(new Set(clusters.map(c => c.connId)))
    setExpandedHosts(new Set(hosts.map(h => h.key)))
  }
  
  const collapseAll = () => {
    setExpandedClusters(new Set())
    setExpandedHosts(new Set())
  }
  
  // Composant mini barre de progression
  const MiniProgressBar = ({ value, color, label }: { value: number; color: string; label: string }) => (
    <MuiTooltip title={`${label}: ${value.toFixed(1)}%`}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 120 }}>
        <Typography variant="caption" sx={{ fontSize: 11, opacity: 0.7, minWidth: 28 }}>{label}</Typography>
        <Box sx={{ 
          width: 60,
          height: 8, 
          bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)', 
          borderRadius: 1,
          overflow: 'hidden'
        }}>
          <Box sx={{ 
            width: `${Math.min(100, value)}%`, 
            height: '100%', 
            bgcolor: value > 90 ? 'error.main' : value > 70 ? 'warning.main' : color,
            borderRadius: 1,
            transition: 'width 0.3s ease'
          }} />
        </Box>
        <Typography variant="caption" sx={{ fontSize: 11, fontWeight: 600, minWidth: 32, textAlign: 'right' }}>
          {value.toFixed(0)}%
        </Typography>
      </Box>
    </MuiTooltip>
  )

  return (
    <Box sx={{ height: '100%', overflow: 'auto', p: 2.5 }}>
      {/* Header */}
      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={2}>
            <Stack direction="row" alignItems="center" spacing={2}>
              <Box sx={{ 
                width: 48, 
                height: 48, 
                borderRadius: 2, 
                bgcolor: 'primary.main', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center' 
              }}>
                <i className="ri-stack-fill" style={{ fontSize: 24, color: 'white' }} />
              </Box>
              <Box>
                <Typography variant="h5" fontWeight={900}>{t('navigation.inventory')}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {clusters.length} {clusters.length > 1 ? 'clusters' : 'cluster'} • {hosts.length} {t('inventory.nodes')} • {vmStats.total} VMs{pbsServers && pbsServers.length > 0 ? ` • ${pbsServers.length} PBS` : ''}
                </Typography>
              </Box>
            </Stack>
            
            {/* Stats rapides */}
            <Stack direction="row" spacing={3}>
              <Box sx={{ textAlign: 'center' }}>
                <Typography variant="h4" fontWeight={900} color="success.main">{vmStats.running}</Typography>
                <Typography variant="caption" color="text.secondary">Running</Typography>
              </Box>
              <Box sx={{ textAlign: 'center' }}>
                <Typography variant="h4" fontWeight={900} color="text.disabled">{vmStats.stopped}</Typography>
                <Typography variant="caption" color="text.secondary">Stopped</Typography>
              </Box>
              <Box sx={{ textAlign: 'center' }}>
                <Typography variant="h4" fontWeight={900} color="primary.main">{hosts.length}</Typography>
                <Typography variant="caption" color="text.secondary">{t('inventory.nodes')}</Typography>
              </Box>
              {pbsServers && pbsServers.length > 0 && (
                <Box sx={{ textAlign: 'center' }}>
                  <Typography variant="h4" fontWeight={900} sx={{ color: '#2196f3' }}>{pbsServers.length}</Typography>
                  <Typography variant="caption" color="text.secondary">PBS</Typography>
                </Box>
              )}
            </Stack>
            
            {/* Actions */}
            <Stack direction="row" spacing={1}>
              <Button size="small" variant="outlined" onClick={expandAll} startIcon={<i className="ri-expand-diagonal-line" />}>
                {t('common.expandAll')}
              </Button>
              <Button size="small" variant="outlined" onClick={collapseAll} startIcon={<i className="ri-collapse-diagonal-line" />}>
                {t('common.collapseAll')}
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>
      
      {/* Séparateur PVE */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <i className="ri-server-fill" style={{ fontSize: 16, color: '#F29221' }} />
        <Typography variant="subtitle2" fontWeight={700} sx={{ opacity: 0.7 }}>Proxmox VE</Typography>
        <Box sx={{ flex: 1, height: 1, bgcolor: 'divider', ml: 1 }} />
      </Box>

      {/* Liste des Clusters avec leurs Hosts et VMs */}
      <Stack spacing={2}>
        {clusters.map(cluster => {
          const isClusterCollapsed = !expandedClusters.has(cluster.connId)
          const clusterHosts = hosts.filter(h => h.connId === cluster.connId)
          const runningCount = cluster.vms.filter(vm => vm.status === 'running').length
          const clusterStats = calculateStats(cluster.vms)
          const isRealCluster = clusterHosts.length > 1 // Vrai cluster si plusieurs nodes
          
          return (
            <Card key={cluster.connId} variant="outlined">
              {/* Header Cluster */}
              <Box 
                onClick={() => toggleCluster(cluster.connId)}
                sx={{ 
                  px: 2, 
                  py: 1.5, 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: 1.5,
                  cursor: 'pointer',
                  bgcolor: theme.palette.mode === 'dark' ? 'rgba(242, 146, 33, 0.08)' : 'rgba(242, 146, 33, 0.05)',
                  borderBottom: isClusterCollapsed ? 'none' : '1px solid',
                  borderColor: 'divider',
                  '&:hover': { bgcolor: theme.palette.mode === 'dark' ? 'rgba(242, 146, 33, 0.12)' : 'rgba(242, 146, 33, 0.08)' }
                }}
              >
                <i 
                  className={isClusterCollapsed ? "ri-arrow-right-s-line" : "ri-arrow-down-s-line"} 
                  style={{ fontSize: 20, opacity: 0.7 }} 
                />
                <i className={isRealCluster ? "ri-cloud-fill" : "ri-server-fill"} style={{ fontSize: 18, color: '#F29221' }} />
                <Typography fontWeight={700}>{cluster.connName}</Typography>
                <Chip 
                  size="small" 
                  label={`${clusterHosts.length} ${t('inventory.nodes')}`} 
                  sx={{ height: 20, fontSize: 11 }} 
                />
                <Chip 
                  size="small" 
                  label={`${cluster.vms.length} VMs`} 
                  sx={{ height: 20, fontSize: 11 }} 
                />
                <Chip 
                  size="small" 
                  label={`${runningCount} running`} 
                  color="success"
                  variant="outlined"
                  sx={{ height: 20, fontSize: 11 }} 
                />
                
                {/* Indicateurs CPU/RAM du cluster */}
                <Box sx={{ ml: 'auto', display: 'flex', gap: 2 }} onClick={(e) => e.stopPropagation()}>
                  <MiniProgressBar value={clusterStats.avgCpu} color="info.main" label="CPU" />
                  <MiniProgressBar value={clusterStats.avgRam} color="secondary.main" label="RAM" />
                </Box>
              </Box>
              
              {/* Contenu Cluster (Hosts) */}
              {!isClusterCollapsed && (
                <Box sx={{ pl: 2 }}>
                  {clusterHosts.map(host => {
                    const isHostCollapsed = !expandedHosts.has(host.key)
                    const hostRunning = host.vms.filter(vm => vm.status === 'running').length
                    const hostStats = calculateStats(host.vms)
                    
                    return (
                      <Box key={host.key}>
                        {/* Header Host */}
                        <Box 
                          onClick={() => toggleHost(host.key)}
                          sx={{ 
                            px: 2, 
                            py: 1, 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: 1.5,
                            cursor: 'pointer',
                            borderBottom: '1px solid',
                            borderColor: 'divider',
                            '&:hover': { bgcolor: 'action.hover' }
                          }}
                        >
                          <i 
                            className={isHostCollapsed ? "ri-arrow-right-s-line" : "ri-arrow-down-s-line"} 
                            style={{ fontSize: 18, opacity: 0.7 }} 
                          />
                          <i className="ri-server-fill" style={{ fontSize: 16, opacity: 0.7 }} />
                          <Typography 
                            variant="body2" 
                            fontWeight={600}
                            sx={{ 
                              cursor: 'pointer',
                              '&:hover': { color: 'primary.main', textDecoration: 'underline' }
                            }}
                            onClick={(e) => {
                              e.stopPropagation()
                              onNodeClick(host.connId, host.node)
                            }}
                          >
                            {host.node}
                          </Typography>
                          <Typography variant="caption" sx={{ opacity: 0.5 }}>
                            ({host.vms.length} VMs, {hostRunning} running)
                          </Typography>
                          
                          {/* Indicateurs CPU/RAM du host */}
                          <Box sx={{ ml: 'auto', display: 'flex', gap: 2 }} onClick={(e) => e.stopPropagation()}>
                            <MiniProgressBar value={hostStats.avgCpu} color="info.main" label="CPU" />
                            <MiniProgressBar value={hostStats.avgRam} color="secondary.main" label="RAM" />
                          </Box>
                        </Box>
                        
                        {/* VMs du Host */}
                        {!isHostCollapsed && host.vms.length > 0 && (
                          <Box sx={{ pl: 2, py: 1 }}>
                            <VmsTable
                              vms={host.vms.map(vm => ({
                                id: `${vm.connId}:${vm.node}:${vm.type}:${vm.vmid}`,
                                connId: vm.connId,
                                node: vm.node,
                                vmid: vm.vmid,
                                name: vm.name,
                                type: vm.type,
                                status: vm.status || 'unknown',
                                cpu: vm.status === 'running' && vm.cpu !== undefined ? Math.min(100, vm.cpu * 100) : undefined,
                                ram: vm.status === 'running' && vm.mem !== undefined && vm.maxmem ? (vm.mem / vm.maxmem) * 100 : undefined,
                                maxmem: vm.maxmem,
                                maxdisk: vm.maxdisk,
                                uptime: vm.uptime,
                                ip: vm.ip,
                                snapshots: vm.snapshots,
                                tags: vm.tags,
                                template: vm.template,
                                isCluster: vm.isCluster,
                                osInfo: vm.osInfo,
                              }))}
                              compact
                              showActions
                              onVmClick={onVmClick}
                              onVmAction={onVmAction}
                              onMigrate={onMigrate}
                              maxHeight={300}
                              favorites={favorites}
                              onToggleFavorite={handleToggleFavorite}
                              migratingVmIds={migratingVmIds}
                            />
                          </Box>
                        )}
                      </Box>
                    )
                  })}
                </Box>
              )}
            </Card>
          )
        })}

        {/* Séparateur PBS */}
        {pbsServers && pbsServers.length > 0 && (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 3, mb: 1 }}>
              <i className="ri-hard-drive-2-fill" style={{ fontSize: 16, color: '#2196f3' }} />
              <Typography variant="subtitle2" fontWeight={700} sx={{ opacity: 0.7 }}>Proxmox Backup Server</Typography>
              <Chip size="small" label={`${pbsServers.reduce((acc, pbs) => acc + pbs.backupCount, 0)} backups`} sx={{ height: 18, fontSize: 10, ml: 1 }} />
              <Box sx={{ flex: 1, height: 1, bgcolor: 'divider', ml: 1 }} />
            </Box>

            <Stack spacing={1}>
              {pbsServers.map(pbs => (
                <Card 
                  key={pbs.connId}
                  variant="outlined"
                  onClick={() => onSelect?.({ type: 'pbs', id: pbs.connId })}
                  sx={{ 
                    cursor: 'pointer',
                    '&:hover': { bgcolor: 'action.hover' }
                  }}
                >
                  <Box 
                    sx={{ 
                      px: 2, 
                      py: 1.5, 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: 1.5,
                      bgcolor: theme.palette.mode === 'dark' ? 'rgba(33, 150, 243, 0.08)' : 'rgba(33, 150, 243, 0.05)',
                    }}
                  >
                    <i className="ri-hard-drive-2-fill" style={{ fontSize: 18, color: '#2196f3' }} />
                    <Typography fontWeight={700}>{pbs.name}</Typography>
                    <Typography variant="caption" sx={{ opacity: 0.6, ml: 'auto' }}>
                      {pbs.backupCount} backups
                    </Typography>
                  </Box>
                </Card>
              ))}
            </Stack>
          </>
        )}
      </Stack>
    </Box>
  )
}

/* ------------------------------------------------------------------ */
/* Main component                                                     */
/* ------------------------------------------------------------------ */

export default function InventoryDetails({ 
  selection,
  onSelect,
  onBack,
  viewMode = 'tree',
  onViewModeChange,
  allVms = [],
  hosts = [],
  pools = [],
  tags = [],
  pbsServers = [],
  showIpSnap = false,
  ipSnapLoading = false,
  onLoadIpSnap,
  onRefresh,
  favorites: propFavorites,
  onToggleFavorite: propToggleFavorite,
  migratingVmIds
}: { 
  selection: InventorySelection | null
  onSelect?: (sel: InventorySelection) => void
  onBack?: () => void
  viewMode?: ViewMode
  onViewModeChange?: (mode: ViewMode) => void
  allVms?: AllVmItem[]
  hosts?: HostItem[]
  pools?: PoolItem[]
  tags?: TagItem[]
  pbsServers?: { connId: string; name: string; status: string; stats?: { backupCount?: number } }[]
  showIpSnap?: boolean
  ipSnapLoading?: boolean
  onLoadIpSnap?: () => void
  onRefresh?: () => Promise<void>  // Callback pour rafraîchir les données
  favorites?: Set<string>  // Favoris partagés depuis le parent
  onToggleFavorite?: (vm: { connId: string; node: string; type: string; vmid: string | number; name?: string }) => void
  migratingVmIds?: Set<string>  // IDs des VMs en cours de migration
}) {
  const t = useTranslations()
  const theme = useTheme()
  const { hasFeature, loading: licenseLoading } = useLicense()
  const toast = useToast()
  const { trackTask } = useTaskTracker()
  const primaryColor = theme.palette.primary.main
  const primaryColorLight = lighten(primaryColor, 0.3)

  // Check license features
  const rollingUpdateAvailable = !licenseLoading && hasFeature(Features.ROLLING_UPDATES)
  const crossClusterMigrationAvailable = !licenseLoading && hasFeature(Features.CROSS_CLUSTER_MIGRATION)

  const [data, setData] = useState<DetailsPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [localTags, setLocalTags] = useState<string[]>([])

  const [tf, setTf] = useState<RrdTimeframe>('hour')
  const [rrdLoading, setRrdLoading] = useState(false)
  const [rrdError, setRrdError] = useState<string | null>(null)
  const [series, setSeries] = useState<SeriesPoint[]>([])
  
  // État pour le mode tableau VMs étendu
  const [expandedVmsTable, setExpandedVmsTable] = useState(false)

  // États pour les sliders CPU et RAM (onglet Matériel)
  const [cpuSockets, setCpuSockets] = useState(1)
  const [cpuCores, setCpuCores] = useState(1)
  const [cpuType, setCpuType] = useState('kvm64')
  const [cpuLimit, setCpuLimit] = useState(0)
  const [cpuLimitEnabled, setCpuLimitEnabled] = useState(false)
  const [memory, setMemory] = useState(2048) // en MB
  const [balloon, setBalloon] = useState(0) // en MB
  const [balloonEnabled, setBalloonEnabled] = useState(false)
  const [savingCpu, setSavingCpu] = useState(false)
  const [savingMemory, setSavingMemory] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  
  // État pour le lock de la VM
  const [vmLock, setVmLock] = useState<{ locked: boolean; lockType?: string }>({ locked: false })
  const [unlocking, setUnlocking] = useState(false)
  const [unlockErrorDialog, setUnlockErrorDialog] = useState<{
    open: boolean
    error: string
    hint?: string
    lockType?: string
  }>({ open: false, error: '' })

  // États pour les dialogs de création VM/LXC
  const [createVmDialogOpen, setCreateVmDialogOpen] = useState(false)
  const [createLxcDialogOpen, setCreateLxcDialogOpen] = useState(false)
  const [highlightedVmId, setHighlightedVmId] = useState<string | null>(null)
  const [creationPending, setCreationPending] = useState<{ vmid: string; connId: string; node: string; type: 'qemu' | 'lxc' } | null>(null)

  // États pour les dialogs hardware (disques, réseau, SCSI)
  const [addDiskDialogOpen, setAddDiskDialogOpen] = useState(false)
  const [addNetworkDialogOpen, setAddNetworkDialogOpen] = useState(false)
  const [editScsiControllerDialogOpen, setEditScsiControllerDialogOpen] = useState(false)
  const [editDiskDialogOpen, setEditDiskDialogOpen] = useState(false)
  const [editNetworkDialogOpen, setEditNetworkDialogOpen] = useState(false)
  const [selectedDisk, setSelectedDisk] = useState<any>(null)
  const [selectedNetwork, setSelectedNetwork] = useState<any>(null)
  const [migrateDialogOpen, setMigrateDialogOpen] = useState(false)
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false)
  
  // État pour le dialog de confirmation d'action VM
  const [confirmAction, setConfirmAction] = useState<{
    action: string
    title: string
    message: string
    vmName?: string
    onConfirm: () => Promise<void>
  } | null>(null)

  const [confirmActionLoading, setConfirmActionLoading] = useState(false)
  
  // État pour le dialog de création de backup
  const [createBackupDialogOpen, setCreateBackupDialogOpen] = useState(false)
  const [backupStorage, setBackupStorage] = useState('')
  const [backupMode, setBackupMode] = useState<'snapshot' | 'suspend' | 'stop'>('snapshot')
  const [backupCompress, setBackupCompress] = useState<'zstd' | 'lzo' | 'gzip' | 'none'>('zstd')
  const [backupNote, setBackupNote] = useState('')
  const [creatingBackup, setCreatingBackup] = useState(false)
  const [backupStorages, setBackupStorages] = useState<any[]>([])
  
  // État pour le dialog de suppression de VM
  const [deleteVmDialogOpen, setDeleteVmDialogOpen] = useState(false)
  const [deleteVmConfirmText, setDeleteVmConfirmText] = useState('')
  const [deletingVm, setDeletingVm] = useState(false)
  const [deleteVmPurge, setDeleteVmPurge] = useState(true) // Supprimer aussi les disques
  
  // État pour l'édition d'option VM
  const [editOptionDialog, setEditOptionDialog] = useState<{ 
    key: string; 
    label: string; 
    value: any; 
    type: 'text' | 'boolean' | 'select';
    options?: { value: string; label: string }[];
  } | null>(null)

  const [editOptionValue, setEditOptionValue] = useState<any>('')
  const [editOptionSaving, setEditOptionSaving] = useState(false)
  
  // État pour la migration depuis la table (VM sélectionnée pour migrer)
  const [tableMigrateVm, setTableMigrateVm] = useState<{ connId: string; node: string; type: string; vmid: string; name: string; status: string } | null>(null)

  // État pour le clonage depuis la table (VM/Template sélectionné pour cloner)
  const [tableCloneVm, setTableCloneVm] = useState<{ connId: string; node: string; type: string; vmid: string; name: string } | null>(null)

  // Initialiser la valeur quand le dialog d'édition d'option s'ouvre
  useEffect(() => {
    if (editOptionDialog) {
      setEditOptionValue(editOptionDialog.value)
    }
  }, [editOptionDialog])

  // Handler pour sauvegarder une option VM
  const handleSaveOption = useCallback(async () => {
    if (!editOptionDialog || !selection || selection.type !== 'vm') return
    
    const { connId, node, type, vmid } = parseVmId(selection.id)
    
    setEditOptionSaving(true)

    try {
      const body: Record<string, any> = {}

      body[editOptionDialog.key] = editOptionValue
      
      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/config`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }
      )
      
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))

        throw new Error(err?.error || `HTTP ${res.status}`)
      }
      
      // Recharger les données
      const payload = await fetchDetails(selection)

      setData(payload)
      setEditOptionDialog(null)
    } catch (e: any) {
      console.error('Error saving option:', e)
      alert(`${t('common.error')}: ${e.message}`)
    } finally {
      setEditOptionSaving(false)
    }
  }, [editOptionDialog, editOptionValue, selection])

  // Favoris : utiliser les props si fournies, sinon état local
  const [localFavorites, setLocalFavorites] = useState<Set<string>>(new Set())
  const favorites = propFavorites ?? localFavorites

  // Charger les favoris (mode local seulement)
  const loadFavorites = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/favorites', { cache: 'no-store' })

      if (res.ok) {
        const json = await res.json()
        const favSet = new Set<string>((json.data || []).map((f: any) => f.vm_key))

        setLocalFavorites(favSet)
      }
    } catch (e) {
      console.error('Error loading favorites:', e)
    }
  }, [])

  // Toggle favori - wrapper pour VmsTable (qui passe un objet vm)
  const toggleFavorite = useCallback((vm: { id: string; connId: string; node: string; type: string; vmid: string | number; name?: string }) => {
    const vmidStr = String(vm.vmid)


    // Si la prop onToggleFavorite est fournie, l'utiliser
    if (propToggleFavorite) {
      propToggleFavorite({ connId: vm.connId, node: vm.node, type: vm.type, vmid: vm.vmid, name: vm.name })

return
    }
    
    // Sinon, gérer localement (fallback)
    const vmKey = `${vm.connId}:${vm.node}:${vm.type}:${vmidStr}`
    const isFav = favorites.has(vmKey)
    
    const doToggle = async () => {
      try {
        if (isFav) {
          const res = await fetch(`/api/v1/favorites?vmKey=${encodeURIComponent(vmKey)}`, { method: 'DELETE' })

          if (res.ok) {
            setLocalFavorites(prev => {
              const next = new Set(prev)

              next.delete(vmKey)
              
return next
            })
          }
        } else {
          const res = await fetch('/api/v1/favorites', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              connectionId: vm.connId,
              node: vm.node,
              vmType: vm.type,
              vmid: vmidStr,
              vmName: vm.name
            })
          })

          if (res.ok) {
            setLocalFavorites(prev => new Set(prev).add(vmKey))
          }
        }
      } catch (e) {
        console.error('Error toggling favorite:', e)
      }
    }

    doToggle()
  }, [favorites, propToggleFavorite])

  // Charger les favoris au mount (seulement si pas de prop favorites)
  useEffect(() => {
    if (!propFavorites) {
      loadFavorites()
    }
  }, [propFavorites, loadFavorites])

  // Quand une création est en attente, poll pour voir si la VM apparaît
  useEffect(() => {
    if (!creationPending) return

    const { vmid, connId, node, type } = creationPending
    const fullId = `${connId}:${node}:${type}:${vmid}`
    
    // Vérifier si la VM est apparue dans la liste
    const vmExists = allVms.some(vm => 
      vm.connId === connId && 
      String(vm.vmid) === vmid
    )
    
    if (vmExists) {
      // La VM est apparue, appliquer le highlight
      setHighlightedVmId(fullId)
      setCreationPending(null)
      
      // Supprimer le highlight après 5 secondes
      setTimeout(() => {
        setHighlightedVmId(null)
      }, 5000)
    }
  }, [allVms, creationPending])

  // Callback quand une VM/LXC est créée - lance le polling
  const handleVmCreated = useCallback(async (vmid: string, connId: string, node: string) => {
    // Stocker les infos de la VM en attente
    setCreationPending({ vmid, connId, node, type: 'qemu' })
    
    // Attendre un peu que Proxmox traite la création
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    // Déclencher un refresh des données
    if (onRefresh) {
      await onRefresh()
    }
    
    // Si la VM n'apparaît toujours pas, réessayer quelques fois
    let attempts = 0
    const maxAttempts = 10

    const pollInterval = setInterval(async () => {
      attempts++

      if (onRefresh) {
        await onRefresh()
      }

      if (attempts >= maxAttempts) {
        clearInterval(pollInterval)
        setCreationPending(null)
      }
    }, 3000)
    
    // Cleanup après 30 secondes max
    setTimeout(() => {
      clearInterval(pollInterval)
    }, 30000)
  }, [onRefresh])

  const handleLxcCreated = useCallback(async (ctid: string, connId: string, node: string) => {
    setCreationPending({ vmid: ctid, connId, node, type: 'lxc' })
    
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    if (onRefresh) {
      await onRefresh()
    }
    
    let attempts = 0
    const maxAttempts = 10

    const pollInterval = setInterval(async () => {
      attempts++

      if (onRefresh) {
        await onRefresh()
      }

      if (attempts >= maxAttempts) {
        clearInterval(pollInterval)
        setCreationPending(null)
      }
    }, 3000)
    
    setTimeout(() => {
      clearInterval(pollInterval)
    }, 30000)
  }, [onRefresh])

  // ==================== HARDWARE HANDLERS ====================
  
  // Sauvegarder un nouveau disque
  const handleSaveDisk = useCallback(async (diskConfig: any) => {
    if (!selection || selection.type !== 'vm') throw new Error('No VM selected')
    
    const { connId, node, type, vmid } = parseVmId(selection.id)
    
    const res = await fetch(
      `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/config`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(diskConfig)
      }
    )
    
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))

      throw new Error(err?.error || `HTTP ${res.status}`)
    }
    
    // Recharger les données
    const payload = await fetchDetails(selection)

    setData(payload)
  }, [selection])

  // Sauvegarder un nouveau réseau
  const handleSaveNetwork = useCallback(async (networkConfig: any) => {
    if (!selection || selection.type !== 'vm') throw new Error('No VM selected')
    
    const { connId, node, type, vmid } = parseVmId(selection.id)
    
    const res = await fetch(
      `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/config`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(networkConfig)
      }
    )
    
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))

      throw new Error(err?.error || `HTTP ${res.status}`)
    }
    
    // Recharger les données
    const payload = await fetchDetails(selection)

    setData(payload)
  }, [selection])

  // Sauvegarder le contrôleur SCSI
  const handleSaveScsiController = useCallback(async (controller: string) => {
    if (!selection || selection.type !== 'vm') throw new Error('No VM selected')
    
    const { connId, node, type, vmid } = parseVmId(selection.id)
    
    const res = await fetch(
      `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/config`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scsihw: controller })
      }
    )
    
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))

      throw new Error(err?.error || `HTTP ${res.status}`)
    }
    
    // Recharger les données
    const payload = await fetchDetails(selection)

    setData(payload)
  }, [selection])

  // Modifier un disque existant
  const handleEditDisk = useCallback(async (diskConfig: any) => {
    if (!selection || selection.type !== 'vm' || !selectedDisk) throw new Error('No disk selected')
    
    const { connId, node, type, vmid } = parseVmId(selection.id)
    
    // Pour modifier un disque, on doit reconstruire sa config complète
    // Pour l'instant, on ne modifie que les options (cache, iothread, etc.)
    // La vraie modification nécessite de connaître le chemin complet du disque
    
    const res = await fetch(
      `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/config`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [selectedDisk.id]: diskConfig })
      }
    )
    
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))

      throw new Error(err?.error || `HTTP ${res.status}`)
    }
    
    // Recharger les données
    const payload = await fetchDetails(selection)

    setData(payload)
  }, [selection, selectedDisk])

  // Supprimer un disque
  const handleDeleteDisk = useCallback(async () => {
    if (!selection || selection.type !== 'vm' || !selectedDisk) throw new Error('No disk selected')
    
    const { connId, node, type, vmid } = parseVmId(selection.id)
    
    const res = await fetch(
      `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/config`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delete: selectedDisk.id })
      }
    )
    
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))

      throw new Error(err?.error || `HTTP ${res.status}`)
    }
    
    // Recharger les données
    const payload = await fetchDetails(selection)

    setData(payload)
    setSelectedDisk(null)
  }, [selection, selectedDisk])

  // Redimensionner un disque
  const handleResizeDisk = useCallback(async (newSize: string) => {
    if (!selection || selection.type !== 'vm' || !selectedDisk) throw new Error('No disk selected')
    
    const { connId, node, type, vmid } = parseVmId(selection.id)
    
    const res = await fetch(
      `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/disk/resize`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disk: selectedDisk.id, size: newSize })
      }
    )
    
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))

      throw new Error(err?.error || `HTTP ${res.status}`)
    }
    
    // Recharger les données
    const payload = await fetchDetails(selection)

    setData(payload)
  }, [selection, selectedDisk])

  // Déplacer un disque vers un autre stockage
  const handleMoveDisk = useCallback(async (targetStorage: string, deleteSource: boolean, format?: string) => {
    if (!selection || selection.type !== 'vm' || !selectedDisk) throw new Error('No disk selected')
    
    const { connId, node, type, vmid } = parseVmId(selection.id)
    
    const body: Record<string, any> = {
      disk: selectedDisk.id,
      storage: targetStorage,
      deleteSource
    }

    if (format) {
      body.format = format
    }
    
    const res = await fetch(
      `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/disk/move`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }
    )
    
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))

      throw new Error(err?.error || `HTTP ${res.status}`)
    }
    
    // Recharger les données
    const payload = await fetchDetails(selection)

    setData(payload)
  }, [selection, selectedDisk])

  // Supprimer une interface réseau
  const handleDeleteNetwork = useCallback(async () => {
    if (!selection || selection.type !== 'vm' || !selectedNetwork) throw new Error('No network selected')
    
    const { connId, node, type, vmid } = parseVmId(selection.id)
    
    const res = await fetch(
      `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/config`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delete: selectedNetwork.id })
      }
    )
    
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))

      throw new Error(err?.error || `HTTP ${res.status}`)
    }
    
    // Recharger les données
    const payload = await fetchDetails(selection)

    setData(payload)
    setSelectedNetwork(null)
  }, [selection, selectedNetwork])

  // Handler pour la migration de VM
  const handleMigrateVm = useCallback(async (targetNode: string, online: boolean, targetStorage?: string, withLocalDisks?: boolean) => {
    if (!selection || selection.type !== 'vm') throw new Error('No VM selected')
    
    const { connId, node, type, vmid } = parseVmId(selection.id)
    
    const body: Record<string, any> = { target: targetNode, online }

    if (targetStorage) {
      body['targetstorage'] = targetStorage
    }

    if (withLocalDisks) {
      body['withLocalDisks'] = true
    }
    
    const res = await fetch(
      `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/migrate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }
    )
    
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))

      throw new Error(err?.error || `HTTP ${res.status}`)
    }

    toast.success(t('vmActions.migrateSuccess'))

    // Désélectionner la VM pour éviter les erreurs 404 pendant la migration
    // Le polling des tâches en cours marquera la VM comme "en cours de migration"
    if (onSelect) {
      onSelect({ type: 'cluster', id: connId })
    }

    // Attendre un peu puis rafraîchir l'inventaire
    await new Promise(resolve => setTimeout(resolve, 1500))

    if (onRefresh) {
      await onRefresh()
    }
  }, [selection, onRefresh, onSelect, toast, t])

  // Handler pour la migration cross-cluster
  const handleCrossClusterMigrate = useCallback(async (params: CrossClusterMigrateParams) => {
    if (!selection || selection.type !== 'vm') throw new Error('No VM selected')
    
    const { connId, node, type, vmid } = parseVmId(selection.id)
    
    const res = await fetch(
      `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/remote-migrate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetConnectionId: params.targetConnectionId,
          targetNode: params.targetNode,
          targetVmid: params.targetVmid,
          targetStorage: params.targetStorage,
          targetBridge: params.targetBridge,
          online: params.online,
          delete: params.deleteSource,
          bwlimit: params.bwlimit
        })
      }
    )
    
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err?.error || `HTTP ${res.status}`)
    }

    toast.success(t('vmActions.migrateSuccess'))

    // Désélectionner la VM
    if (onSelect) {
      onSelect({ type: 'cluster', id: connId })
    }

    // Attendre puis rafraîchir
    await new Promise(resolve => setTimeout(resolve, 2000))

    if (onRefresh) {
      await onRefresh()
    }
  }, [selection, onRefresh, onSelect, toast, t])

  // Handler pour le clonage de VM
  const handleCloneVm = useCallback(async (params: { targetNode: string; newVmid: number; name: string; targetStorage?: string; format?: string; pool?: string; full: boolean }) => {
    if (!selection || selection.type !== 'vm') throw new Error('No VM selected')
    
    const { connId, node, type, vmid } = parseVmId(selection.id)
    
    const res = await fetch(
      `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/clone`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newvmid: params.newVmid,
          name: params.name || undefined,
          target: params.targetNode !== node ? params.targetNode : undefined,
          storage: params.targetStorage || undefined,
          format: params.format || undefined,
          pool: params.pool || undefined,
          full: params.full
        })
      }
    )
    
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))

      throw new Error(err?.error || `HTTP ${res.status}`)
    }

    toast.success(t('vmActions.cloneSuccess'))

    // Attendre un peu puis rafraîchir
    await new Promise(resolve => setTimeout(resolve, 2000))

    if (onRefresh) {
      await onRefresh()
    }
  }, [selection, onRefresh, toast, t])

  // Handler pour ouvrir le dialog de migration depuis la table
  const handleTableMigrate = useCallback((vm: any) => {
    setTableMigrateVm({
      connId: vm.connId,
      node: vm.node,
      type: vm.type,
      vmid: String(vm.vmid),
      name: vm.name || `VM ${vm.vmid}`,
      status: vm.status || 'unknown'
    })
  }, [])

  // Handler pour la migration de VM depuis la table
  const handleTableMigrateVm = useCallback(async (targetNode: string, online: boolean, targetStorage?: string, withLocalDisks?: boolean) => {
    if (!tableMigrateVm) throw new Error('No VM selected for migration')
    
    const { connId, node, type, vmid } = tableMigrateVm
    
    const body: Record<string, any> = { target: targetNode, online }

    if (targetStorage) {
      body['targetstorage'] = targetStorage
    }

    if (withLocalDisks) {
      body['withLocalDisks'] = true
    }
    
    const res = await fetch(
      `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/migrate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }
    )
    
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))

      throw new Error(err?.error || `HTTP ${res.status}`)
    }

    toast.success(t('vmActions.migrateSuccess'))

    // Attendre un peu puis rafraîchir
    await new Promise(resolve => setTimeout(resolve, 2000))

    if (onRefresh) {
      await onRefresh()
    }

    setTableMigrateVm(null)
  }, [tableMigrateVm, onRefresh, toast, t])

  // Handler pour la migration cross-cluster depuis la table
  const handleTableCrossClusterMigrate = useCallback(async (params: CrossClusterMigrateParams) => {
    if (!tableMigrateVm) throw new Error('No VM selected for migration')
    
    const { connId, node, type, vmid } = tableMigrateVm
    
    const res = await fetch(
      `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/remote-migrate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetConnectionId: params.targetConnectionId,
          targetNode: params.targetNode,
          targetVmid: params.targetVmid,
          targetStorage: params.targetStorage,
          targetBridge: params.targetBridge,
          online: params.online,
          delete: params.deleteSource,
          bwlimit: params.bwlimit
        })
      }
    )
    
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err?.error || `HTTP ${res.status}`)
    }

    toast.success(t('vmActions.migrateSuccess'))

    // Attendre puis rafraîchir
    await new Promise(resolve => setTimeout(resolve, 2000))

    if (onRefresh) {
      await onRefresh()
    }

    setTableMigrateVm(null)
  }, [tableMigrateVm, onRefresh, toast, t])

  // Handler pour le clonage depuis le tableau
  const handleTableCloneVm = useCallback(async (params: { targetNode: string; newVmid: number; name: string; targetStorage?: string; format?: string; pool?: string; full: boolean }) => {
    if (!tableCloneVm) throw new Error('No VM selected for cloning')
    
    const { connId, node, type, vmid } = tableCloneVm
    
    const body: Record<string, any> = {
      newid: params.newVmid,
      name: params.name,
      target: params.targetNode,
      full: params.full ? 1 : 0
    }
    
    if (params.targetStorage) {
      body.storage = params.targetStorage
    }

    if (params.format) {
      body.format = params.format
    }

    if (params.pool) {
      body.pool = params.pool
    }
    
    const res = await fetch(
      `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/clone`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }
    )
    
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))

      throw new Error(err?.error || `HTTP ${res.status}`)
    }

    toast.success(t('vmActions.cloneSuccess'))

    // Attendre un peu puis rafraîchir
    await new Promise(resolve => setTimeout(resolve, 2000))

    if (onRefresh) {
      await onRefresh()
    }

    setTableCloneVm(null)
  }, [tableCloneVm, onRefresh, toast, t])

  // États pour le bulk action dialog
  const [bulkActionDialog, setBulkActionDialog] = useState<{
    open: boolean
    action: BulkAction | null
    node: NodeRow | null
    targetNode: string
  }>({ open: false, action: null, node: null, targetNode: '' })

  // Handler pour les actions bulk sur les nodes
  const handleNodeBulkAction = useCallback((node: NodeRow, action: BulkAction) => {
    setBulkActionDialog({ open: true, action, node, targetNode: '' })
  }, [])

  // Exécuter l'action bulk
  const executeBulkAction = useCallback(async () => {
    const { action, node, targetNode } = bulkActionDialog
    if (!action || !node || !data?.allVms) return

    // Récupérer les VMs du node
    const nodeVms = (data.allVms as any[]).filter((vm: any) =>
      vm.node === node.name && !vm.template
    )

    if (nodeVms.length === 0) {
      toast.warning(t('common.noData'))
      setBulkActionDialog({ open: false, action: null, node: null, targetNode: '' })
      return
    }

    // Filtrer les VMs selon l'action
    let vmsToProcess: any[] = []
    let apiAction = ''
    let description = ''

    switch (action) {
      case 'start-all':
        vmsToProcess = nodeVms.filter((vm: any) => vm.status === 'stopped')
        apiAction = 'start'
        description = t('bulkActions.startingVms')
        break
      case 'shutdown-all':
        vmsToProcess = nodeVms.filter((vm: any) => vm.status === 'running')
        apiAction = 'shutdown'
        description = t('bulkActions.stoppingVms')
        break
      case 'stop-all':
        vmsToProcess = nodeVms.filter((vm: any) => vm.status === 'running')
        apiAction = 'stop'
        description = t('bulkActions.stoppingVms')
        break
      case 'migrate-all':
        if (!targetNode) {
          toast.error(t('bulkActions.selectTargetNode'))
          return
        }
        vmsToProcess = nodeVms.filter((vm: any) => vm.status !== 'stopped' || true) // All VMs
        apiAction = 'migrate'
        description = t('bulkActions.migratingVms')
        break
    }

    if (vmsToProcess.length === 0) {
      toast.info(t('common.noData'))
      setBulkActionDialog({ open: false, action: null, node: null, targetNode: '' })
      return
    }

    setBulkActionDialog({ open: false, action: null, node: null, targetNode: '' })
    toast.info(`${description} (${vmsToProcess.length} VMs)...`)

    // Exécuter les actions en parallèle (max 5 à la fois)
    const batchSize = 5
    let successCount = 0
    let errorCount = 0

    for (let i = 0; i < vmsToProcess.length; i += batchSize) {
      const batch = vmsToProcess.slice(i, i + batchSize)

      await Promise.all(batch.map(async (vm: any) => {
        try {
          let url: string
          let body: any = undefined

          if (apiAction === 'migrate') {
            url = `/api/v1/connections/${encodeURIComponent(vm.connId)}/guests/${vm.type}/${encodeURIComponent(vm.node)}/${encodeURIComponent(vm.vmid)}/migrate`
            body = JSON.stringify({ target: targetNode, online: vm.status === 'running' })
          } else {
            url = `/api/v1/connections/${encodeURIComponent(vm.connId)}/guests/${vm.type}/${encodeURIComponent(vm.node)}/${encodeURIComponent(vm.vmid)}/${apiAction}`
          }

          const res = await fetch(url, {
            method: 'POST',
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body,
          })

          if (res.ok) {
            successCount++
          } else {
            errorCount++
          }
        } catch {
          errorCount++
        }
      }))
    }

    // Afficher le résultat
    if (errorCount === 0) {
      toast.success(`${description} - ${successCount} VMs`)
    } else if (successCount > 0) {
      toast.warning(`${description} - ${successCount} OK, ${errorCount} erreurs`)
    } else {
      toast.error(`${description} - ${errorCount} erreurs`)
    }

    // Rafraîchir les données
    if (onRefresh) {
      setTimeout(() => onRefresh(), 2000)
    }
  }, [bulkActionDialog, data?.allVms, t, toast, onRefresh])

  // États pour les sauvegardes
  // 0 = Résumé, 1 = Matériel, 2 = Options, 3 = Historique, 4 = Sauvegardes, 5 = Snapshots, 6 = Notes, 7 = Réplication, 8 = HA (si cluster), 9 = Firewall
  const [detailTab, setDetailTab] = useState(0)
  const [clusterTab, setClusterTab] = useState(0) // 0 = Nodes, 1 = VMs, 2 = HA, 3 = Backups, 4 = Cluster

  // États pour la réplication VM
  const [replicationJobs, setReplicationJobs] = useState<any[]>([])
  const [replicationLoading, setReplicationLoading] = useState(false)
  const [replicationLoaded, setReplicationLoaded] = useState(false)
  const [addReplicationDialogOpen, setAddReplicationDialogOpen] = useState(false)
  const [replicationTargetNode, setReplicationTargetNode] = useState('')
  const [replicationSchedule, setReplicationSchedule] = useState('*/15')
  const [replicationRateLimit, setReplicationRateLimit] = useState('')
  const [replicationComment, setReplicationComment] = useState('')
  const [availableTargetNodes, setAvailableTargetNodes] = useState<string[]>([])
  const [savingReplication, setSavingReplication] = useState(false)
  const [deleteReplicationId, setDeleteReplicationId] = useState<string | null>(null)
  
  // États pour la réplication Ceph
  const [sourceCephAvailable, setSourceCephAvailable] = useState(false)
  const [cephClusters, setCephClusters] = useState<any[]>([])
  const [cephClustersLoading, setCephClustersLoading] = useState(false)
  const [addCephReplicationDialogOpen, setAddCephReplicationDialogOpen] = useState(false)
  const [selectedCephCluster, setSelectedCephCluster] = useState('')
  const [cephReplicationSchedule, setCephReplicationSchedule] = useState('*/15')
  const [cephReplicationJobs, setCephReplicationJobs] = useState<any[]>([])
  const [expandedClusterNodes, setExpandedClusterNodes] = useState<Set<string>>(new Set()) // Nodes expanded dans l'onglet VMs du cluster
  const [pbsTab, setPbsTab] = useState(0) // 0 = Summary, 1 = Backups (pour datastore)
  const [pbsBackupSearch, setPbsBackupSearch] = useState('')
  const [pbsTimeframe, setPbsTimeframe] = useState<'hour' | 'day' | 'week' | 'month' | 'year'>('hour') // Timeframe pour les graphiques PBS
  const [pbsRrdData, setPbsRrdData] = useState<any[]>([]) // Données RRD du serveur PBS
  const [datastoreRrdData, setDatastoreRrdData] = useState<any[]>([]) // Données RRD du datastore
  const [expandedBackupGroups, setExpandedBackupGroups] = useState<Set<string>>(new Set())
  const [backups, setBackups] = useState<any[]>([])
  const [backupsLoading, setBackupsLoading] = useState(false)
  const [backupsError, setBackupsError] = useState<string | null>(null)
  const [backupsStats, setBackupsStats] = useState<any>(null)
  const [backupsPreloaded, setBackupsPreloaded] = useState(false)
  const [selectedBackup, setSelectedBackup] = useState<any>(null)

  // État pour les onglets node (host standalone)
  const [nodeTab, setNodeTab] = useState(0) // 0 = Summary, 1 = VMs, 2 = Disks, 3 = Ceph (cluster), 4 = Backups (standalone), 5 = Cluster (standalone)
  
  // États pour les disques du node
  const [nodeDisksData, setNodeDisksData] = useState<any>(null)
  const [nodeDisksLoading, setNodeDisksLoading] = useState(false)
  const [nodeDisksLoaded, setNodeDisksLoaded] = useState(false)
  const [nodeDisksSubTab, setNodeDisksSubTab] = useState(0) // 0=Disks, 1=LVM, 2=LVM-Thin, 3=Directory, 4=ZFS
  
  // États pour la subscription du node
  const [nodeSubscriptionData, setNodeSubscriptionData] = useState<any>(null)
  const [nodeSubscriptionLoading, setNodeSubscriptionLoading] = useState(false)
  const [nodeSubscriptionLoaded, setNodeSubscriptionLoaded] = useState(false)
  const [subscriptionKeyDialogOpen, setSubscriptionKeyDialogOpen] = useState(false)
  const [subscriptionKeyInput, setSubscriptionKeyInput] = useState('')
  const [subscriptionKeySaving, setSubscriptionKeySaving] = useState(false)
  const [removeSubscriptionDialogOpen, setRemoveSubscriptionDialogOpen] = useState(false)
  const [removeSubscriptionLoading, setRemoveSubscriptionLoading] = useState(false)
  const [systemReportDialogOpen, setSystemReportDialogOpen] = useState(false)
  const [systemReportData, setSystemReportData] = useState<string | null>(null)
  const [systemReportLoading, setSystemReportLoading] = useState(false)
  
  // États pour la réplication du node
  const [nodeReplicationData, setNodeReplicationData] = useState<any>(null)
  const [nodeReplicationLoading, setNodeReplicationLoading] = useState(false)
  const [nodeReplicationLoaded, setNodeReplicationLoaded] = useState(false)
  const [replicationDialogOpen, setReplicationDialogOpen] = useState(false)
  const [replicationDialogMode, setReplicationDialogMode] = useState<'create' | 'edit'>('create')
  const [editingReplicationJob, setEditingReplicationJob] = useState<any>(null)
  const [replicationSaving, setReplicationSaving] = useState(false)
  const [deleteReplicationDialogOpen, setDeleteReplicationDialogOpen] = useState(false)
  const [deletingReplicationJob, setDeletingReplicationJob] = useState<any>(null)
  const [replicationDeleting, setReplicationDeleting] = useState(false)
  const [replicationLogDialogOpen, setReplicationLogDialogOpen] = useState(false)
  const [replicationLogData, setReplicationLogData] = useState<string[]>([])
  const [replicationLogLoading, setReplicationLogLoading] = useState(false)
  const [replicationLogJob, setReplicationLogJob] = useState<any>(null)
  const [replicationFormData, setReplicationFormData] = useState({
    guest: '',
    target: '',
    schedule: '*/15',
    rate: '',
    comment: '',
    enabled: true
  })
  
  // États pour System du node
  const [nodeSystemData, setNodeSystemData] = useState<any>(null)
  const [nodeSystemLoading, setNodeSystemLoading] = useState(false)
  const [nodeSystemLoaded, setNodeSystemLoaded] = useState(false)
  const [nodeSystemSubTab, setNodeSystemSubTab] = useState(0) // 0=Network, 1=Certificates, 2=DNS, 3=Hosts, 4=Options, 5=Time, 6=Syslog
  const [nodeSyslogData, setNodeSyslogData] = useState<string[]>([])
  const [nodeSyslogLoading, setNodeSyslogLoading] = useState(false)
  const [nodeSyslogLive, setNodeSyslogLive] = useState(false)
  const [editDnsDialogOpen, setEditDnsDialogOpen] = useState(false)
  const [editHostsDialogOpen, setEditHostsDialogOpen] = useState(false)
  const [editTimeDialogOpen, setEditTimeDialogOpen] = useState(false)
  const [systemSaving, setSystemSaving] = useState(false)
  const [dnsFormData, setDnsFormData] = useState({ search: '', dns1: '', dns2: '', dns3: '' })
  const [hostsFormData, setHostsFormData] = useState({ data: '', digest: '' })
  const [timeFormData, setTimeFormData] = useState({ timezone: '' })
  const [timezonesList, setTimezonesList] = useState<string[]>([])
  
  // États pour Notes du node
  const [nodeNotesData, setNodeNotesData] = useState<string>('')
  const [nodeNotesLoading, setNodeNotesLoading] = useState(false)
  const [nodeNotesLoaded, setNodeNotesLoaded] = useState(false)
  const [nodeNotesEditing, setNodeNotesEditing] = useState(false)
  const [nodeNotesEditValue, setNodeNotesEditValue] = useState('')
  const [nodeNotesSaving, setNodeNotesSaving] = useState(false)
  
  // États pour Shell du node
  const [nodeShellData, setNodeShellData] = useState<any>(null)
  const [nodeShellLoading, setNodeShellLoading] = useState(false)
  const [nodeShellConnected, setNodeShellConnected] = useState(false)
  
  // États pour Ceph au niveau node
  const [nodeCephData, setNodeCephData] = useState<any>(null)
  const [nodeCephLoading, setNodeCephLoading] = useState(false)
  const [nodeCephLoaded, setNodeCephLoaded] = useState(false)
  const [nodeCephSubTab, setNodeCephSubTab] = useState(0) // 0=Config, 1=Monitor, 2=OSD, 3=CephFS, 4=Pools, 5=Log
  const [nodeCephLogLive, setNodeCephLogLive] = useState(false)

  // États pour les backup jobs PVE (cluster et node)
  const [backupJobs, setBackupJobs] = useState<any[]>([])
  const [backupJobsStorages, setBackupJobsStorages] = useState<any[]>([])
  const [backupJobsNodes, setBackupJobsNodes] = useState<any[]>([])
  const [backupJobsVms, setBackupJobsVms] = useState<any[]>([])
  const [backupJobsLoading, setBackupJobsLoading] = useState(false)
  const [backupJobsLoaded, setBackupJobsLoaded] = useState(false)
  const [backupJobsError, setBackupJobsError] = useState<string | null>(null)
  const [backupJobDialogOpen, setBackupJobDialogOpen] = useState(false)
  const [backupJobDialogMode, setBackupJobDialogMode] = useState<'create' | 'edit'>('create')
  const [editingBackupJob, setEditingBackupJob] = useState<any>(null)
  const [backupJobSaving, setBackupJobSaving] = useState(false)
  const [deleteBackupJobDialog, setDeleteBackupJobDialog] = useState<any>(null)
  const [backupJobDeleting, setBackupJobDeleting] = useState(false)
  const [backupJobFormData, setBackupJobFormData] = useState({
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

  // États pour la HA du cluster
  const [clusterHaResources, setClusterHaResources] = useState<any[]>([])
  const [clusterHaGroups, setClusterHaGroups] = useState<any[]>([])
  const [clusterHaRules, setClusterHaRules] = useState<any[]>([]) // PVE 9+
  const [clusterPveMajorVersion, setClusterPveMajorVersion] = useState<number>(8)
  const [clusterPveVersion, setClusterPveVersion] = useState<string>('') // Version exacte
  const [clusterHaLoading, setClusterHaLoading] = useState(false)
  const [clusterHaLoaded, setClusterHaLoaded] = useState(false)
  const [haGroupDialogOpen, setHaGroupDialogOpen] = useState(false)
  const [editingHaGroup, setEditingHaGroup] = useState<any>(null)
  const [deleteHaGroupDialog, setDeleteHaGroupDialog] = useState<any>(null)
  const [haRuleDialogOpen, setHaRuleDialogOpen] = useState(false)
  const [editingHaRule, setEditingHaRule] = useState<any>(null)
  const [deleteHaRuleDialog, setDeleteHaRuleDialog] = useState<any>(null)
  const [haRuleType, setHaRuleType] = useState<'node-affinity' | 'resource-affinity'>('node-affinity')

  // États pour la gestion du cluster (config, join, create)
  const [clusterConfig, setClusterConfig] = useState<any>(null)
  const [clusterConfigLoading, setClusterConfigLoading] = useState(false)
  const [clusterConfigLoaded, setClusterConfigLoaded] = useState(false)
  const [createClusterDialogOpen, setCreateClusterDialogOpen] = useState(false)
  const [joinClusterDialogOpen, setJoinClusterDialogOpen] = useState(false)
  const [joinInfoDialogOpen, setJoinInfoDialogOpen] = useState(false)
  const [clusterActionLoading, setClusterActionLoading] = useState(false)
  const [clusterActionError, setClusterActionError] = useState<string | null>(null)
  const [newClusterName, setNewClusterName] = useState('')
  const [newClusterLinks, setNewClusterLinks] = useState<{ linkNumber: number; address: string }[]>([])
  const [joinClusterInfo, setJoinClusterInfo] = useState('')
  const [joinClusterPassword, setJoinClusterPassword] = useState('')

  // États pour les Notes du cluster/datacenter
  const [clusterNotesContent, setClusterNotesContent] = useState('')
  const [clusterNotesLoading, setClusterNotesLoading] = useState(false)
  const [clusterNotesEditMode, setClusterNotesEditMode] = useState(false)
  const [clusterNotesSaving, setClusterNotesSaving] = useState(false)
  const [clusterNotesLoaded, setClusterNotesLoaded] = useState(false)

  // États pour Ceph
  const [clusterCephData, setClusterCephData] = useState<any>(null)
  const [clusterCephLoading, setClusterCephLoading] = useState(false)
  const [clusterCephLoaded, setClusterCephLoaded] = useState(false)
  const [clusterCephPerf, setClusterCephPerf] = useState<any>(null) // Données de performance en temps réel
  const [clusterCephPerfHistory, setClusterCephPerfHistory] = useState<any[]>([]) // Historique pour les graphiques
  const [clusterCephTimeframe, setClusterCephTimeframe] = useState<number>(60) // Durée en secondes (60s, 300s=5min, 600s=10min, 1800s=30min)

  // États pour Storage du cluster
  const [clusterStorageData, setClusterStorageData] = useState<any[]>([])
  const [clusterStorageLoading, setClusterStorageLoading] = useState(false)
  const [clusterStorageLoaded, setClusterStorageLoaded] = useState(false)

  // États pour Firewall du cluster
  const [clusterFirewallLoaded, setClusterFirewallLoaded] = useState(false)

  // États pour Rolling Update
  const [nodeUpdates, setNodeUpdates] = useState<Record<string, { count: number; updates: any[]; version: string | null; loading: boolean }>>({})
  const [nodeLocalVms, setNodeLocalVms] = useState<Record<string, { 
    total: number; 
    running: number; 
    blockingMigration: number; 
    withReplication: number;
    canMigrate: boolean;
    vms: any[];
    loading: boolean 
  }>>({})
  const [updatesDialogOpen, setUpdatesDialogOpen] = useState(false)
  const [updatesDialogNode, setUpdatesDialogNode] = useState<string | null>(null)
  const [localVmsDialogOpen, setLocalVmsDialogOpen] = useState(false)
  const [localVmsDialogNode, setLocalVmsDialogNode] = useState<string | null>(null)
  const [rollingUpdateWizardOpen, setRollingUpdateWizardOpen] = useState(false)

  // États pour les infos guest (IP, uptime, OS)
  const [guestInfo, setGuestInfo] = useState<{ ip?: string; uptime?: number; osInfo?: { type: 'linux' | 'windows' | 'other'; name: string | null; version: string | null; kernel: string | null } | null } | null>(null)
  const [guestInfoLoading, setGuestInfoLoading] = useState(false)

  // États pour l'explorateur de fichiers
  const [explorerLoading, setExplorerLoading] = useState(false)
  const [explorerError, setExplorerError] = useState<string | null>(null)
  const [explorerFiles, setExplorerFiles] = useState<any[]>([])
  const [explorerArchive, setExplorerArchive] = useState<string | null>(null)
  const [explorerPath, setExplorerPath] = useState('/')
  const [explorerArchives, setExplorerArchives] = useState<any[]>([])
  const [pveStorages, setPveStorages] = useState<any[]>([])
  const [compatibleStorages, setCompatibleStorages] = useState<any[]>([])
  const [selectedPveStorage, setSelectedPveStorage] = useState<any>(null)
  const [explorerMode, setExplorerMode] = useState<'pbs' | 'pve'>('pbs')

  // Charger les sauvegardes d'une VM
  const loadBackups = useCallback(async (vmid: string, type: string) => {
    if (!vmid) return
    
    setBackupsLoading(true)
    setBackupsError(null)
    setBackups([])
    setBackupsStats(null)
    
    try {
      const params = new URLSearchParams()

      if (type === 'lxc') params.set('type', 'ct')
      else if (type === 'qemu') params.set('type', 'vm')
      
      const res = await fetch(`/api/v1/guests/${encodeURIComponent(vmid)}/backups?${params}`, { cache: 'no-store' })
      const json = await res.json()
      
      if (json.error) {
        setBackupsError(json.error)
      } else {
        setBackups(json.data?.backups || [])
        setBackupsStats(json.data?.stats || null)
      }
    } catch (e: any) {
      setBackupsError(e.message || t('errors.loadingError'))
    } finally {
      setBackupsLoading(false)
    }
  }, [])

  // Charger les données HA du cluster (ressources, groupes et règles)
  const loadClusterHa = useCallback(async (connId: string) => {
    if (!connId) return
    
    setClusterHaLoading(true)
    
    try {
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/ha`, { cache: 'no-store' })
      const json = await res.json()
      
      if (json.error) {
        console.error('Error loading cluster HA:', json.error)
      } else {
        setClusterHaResources(json.data?.resources || [])
        setClusterHaGroups(json.data?.groups || [])
        setClusterHaRules(json.data?.rules || [])
        setClusterPveMajorVersion(json.data?.majorVersion || 8)
        setClusterPveVersion(json.data?.pveVersion || '')
      }
    } catch (e: any) {
      console.error('Error loading cluster HA:', e)
    } finally {
      setClusterHaLoading(false)
      setClusterHaLoaded(true)
    }
  }, [])

  // Charger la configuration du cluster (nodes, join info, networks)
  const loadClusterConfig = useCallback(async (connId: string) => {
    if (!connId) return
    
    setClusterConfigLoading(true)
    
    try {
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/cluster/config`, { cache: 'no-store' })
      const json = await res.json()
      
      if (json.error) {
        console.error('Error loading cluster config:', json.error)
      } else {
        setClusterConfig(json.data)
      }
    } catch (e: any) {
      console.error('Error loading cluster config:', e)
    } finally {
      setClusterConfigLoading(false)
      setClusterConfigLoaded(true)
    }
  }, [])

  // Charger les notes du datacenter
  const loadClusterNotes = useCallback(async (connId: string) => {
    if (!connId) return
    
    setClusterNotesLoading(true)
    
    try {
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/cluster/options`, { cache: 'no-store' })
      const json = await res.json()
      
      if (json.data?.description) {
        setClusterNotesContent(json.data.description)
      } else {
        setClusterNotesContent('')
      }
    } catch (e: any) {
      console.error('Error loading cluster notes:', e)
      setClusterNotesContent('')
    } finally {
      setClusterNotesLoading(false)
      setClusterNotesLoaded(true)
    }
  }, [])

  // Sauvegarder les notes du datacenter
  const handleSaveClusterNotes = async () => {
    if (!selection?.id) return
    
    const connId = selection.id.split(':')[0]
    setClusterNotesSaving(true)
    
    try {
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/cluster/options`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: clusterNotesContent })
      })
      
      const json = await res.json()
      
      if (!json.error) {
        setClusterNotesEditMode(false)
      }
    } catch (e: any) {
      console.error('Error saving cluster notes:', e)
    } finally {
      setClusterNotesSaving(false)
    }
  }

  // Charger les données Ceph
  const loadClusterCeph = useCallback(async (connId: string) => {
    if (!connId) return
    
    setClusterCephLoading(true)
    
    try {
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/ceph/status`, { cache: 'no-store' })
      const json = await res.json()
      
      if (json.error) {
        console.error('Error loading Ceph data:', json.error)
        setClusterCephData(null)
      } else {
        setClusterCephData(json.data)
      }
    } catch (e: any) {
      console.error('Error loading Ceph data:', e)
      setClusterCephData(null)
    } finally {
      setClusterCephLoading(false)
      setClusterCephLoaded(true)
    }
  }, [])

  // Charger les storages du cluster
  const loadClusterStorage = useCallback(async (connId: string) => {
    if (!connId) return
    
    setClusterStorageLoading(true)
    
    try {
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/storage`, { cache: 'no-store' })
      const json = await res.json()
      
      if (json.error) {
        console.error('Error loading storage data:', json.error)
        setClusterStorageData([])
      } else {
        setClusterStorageData(json.data || [])
      }
    } catch (e: any) {
      console.error('Error loading storage data:', e)
      setClusterStorageData([])
    } finally {
      setClusterStorageLoading(false)
      setClusterStorageLoaded(true)
    }
  }, [])

  // Créer un cluster
  const handleCreateCluster = async (connId: string) => {
    if (!connId || !newClusterName) return
    
    setClusterActionLoading(true)
    setClusterActionError(null)
    
    try {
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/cluster/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          clusterName: newClusterName,
          links: newClusterLinks,
        })
      })
      
      const json = await res.json()
      
      if (json.error) {
        setClusterActionError(json.error)
      } else {
        setCreateClusterDialogOpen(false)
        setNewClusterName('')
        setNewClusterLinks([])
        // Recharger la config
        loadClusterConfig(connId)
      }
    } catch (e: any) {
      setClusterActionError(e?.message || 'Failed to create cluster')
    } finally {
      setClusterActionLoading(false)
    }
  }

  // Joindre un cluster
  const handleJoinCluster = async (connId: string) => {
    if (!connId || !joinClusterInfo || !joinClusterPassword) return
    
    setClusterActionLoading(true)
    setClusterActionError(null)
    
    try {
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/cluster/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'join',
          joinInfo: { information: joinClusterInfo },
          password: joinClusterPassword,
        })
      })
      
      const json = await res.json()
      
      if (json.error) {
        setClusterActionError(json.error)
      } else {
        setJoinClusterDialogOpen(false)
        setJoinClusterInfo('')
        setJoinClusterPassword('')
        // Recharger la config
        loadClusterConfig(connId)
      }
    } catch (e: any) {
      setClusterActionError(e?.message || 'Failed to join cluster')
    } finally {
      setClusterActionLoading(false)
    }
  }

  // Charger les backup jobs PVE
  const loadBackupJobs = useCallback(async (connId: string) => {
    if (!connId) return
    
    setBackupJobsLoading(true)
    setBackupJobsError(null)
    
    try {
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/backup-jobs`, { cache: 'no-store' })
      const json = await res.json()
      
      if (json.error) {
        setBackupJobsError(json.error)
      } else {
        setBackupJobs(json.data?.jobs || [])
        setBackupJobsStorages(json.data?.storages || [])
        setBackupJobsNodes(json.data?.nodes || [])
      }
    } catch (e: any) {
      console.error('Error loading backup jobs:', e)
      setBackupJobsError(e?.message || 'Failed to load backup jobs')
    } finally {
      setBackupJobsLoading(false)
      setBackupJobsLoaded(true)
    }
  }, [])

  // Charger les VMs pour la sélection dans le dialog backup job
  const loadBackupJobsVms = useCallback(async (connId: string) => {
    if (!connId) return
    
    try {
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/resources?type=vm`, { cache: 'no-store' })
      const json = await res.json()
      
      if (!json.error) {
        const allVms = (json.data || []).filter((r: any) => r.type === 'qemu' || r.type === 'lxc')
        setBackupJobsVms(allVms.map((vm: any) => ({
          vmid: vm.vmid,
          name: vm.name,
          type: vm.type,
          node: vm.node,
          status: vm.status
        })))
      }
    } catch (e) {
      console.error('Error loading VMs for backup jobs:', e)
    }
  }, [])

  // Créer un backup job
  const handleCreateBackupJob = () => {
    setBackupJobFormData({
      enabled: true,
      storage: backupJobsStorages[0]?.id || '',
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
    setBackupJobDialogMode('create')
    setEditingBackupJob(null)
    setBackupJobDialogOpen(true)
  }

  // Éditer un backup job
  const handleEditBackupJob = (job: any) => {
    // Parser les vmids depuis la chaîne
    let vmids: number[] = []
    let excludedVmids: number[] = []
    let selMode: 'all' | 'include' | 'exclude' = 'all'
    
    if (job.all === 1 || job.all === true) {
      selMode = 'all'
      if (job.exclude) {
        excludedVmids = String(job.exclude).split(',').map((v: string) => parseInt(v.trim())).filter((v: number) => !isNaN(v))
      }
    } else if (job.vmid) {
      selMode = 'include'
      vmids = String(job.vmid).split(',').map((v: string) => parseInt(v.trim())).filter((v: number) => !isNaN(v))
    }

    setBackupJobFormData({
      enabled: job.enabled !== false && job.enabled !== 0,
      storage: job.storage || '',
      schedule: job.schedule || '00:00',
      node: job.node || '',
      mode: job.mode || 'snapshot',
      compress: job.compress || 'zstd',
      selectionMode: selMode,
      vmids,
      excludedVmids,
      comment: job.comment || '',
      mailto: job.mailto || '',
      mailnotification: job.mailnotification || 'always',
      maxfiles: job.maxfiles || 1,
      namespace: job.prune_backups?.namespace || ''
    })
    setBackupJobDialogMode('edit')
    setEditingBackupJob(job)
    setBackupJobDialogOpen(true)
  }

  // Sauvegarder un backup job
  const handleSaveBackupJob = async (connId: string) => {
    if (!connId) return
    
    setBackupJobSaving(true)
    
    try {
      const url = backupJobDialogMode === 'create'
        ? `/api/v1/connections/${encodeURIComponent(connId)}/backup-jobs`
        : `/api/v1/connections/${encodeURIComponent(connId)}/backup-jobs/${encodeURIComponent(editingBackupJob?.id)}`
      
      const res = await fetch(url, {
        method: backupJobDialogMode === 'create' ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(backupJobFormData)
      })
      
      const json = await res.json()
      
      if (json.error) {
        setBackupJobsError(json.error)
      } else {
        setBackupJobDialogOpen(false)
        loadBackupJobs(connId)
      }
    } catch (e: any) {
      setBackupJobsError(e?.message || 'Failed to save backup job')
    } finally {
      setBackupJobSaving(false)
    }
  }

  // Supprimer un backup job
  const handleDeleteBackupJob = async (connId: string) => {
    if (!connId || !deleteBackupJobDialog) return
    
    setBackupJobDeleting(true)
    
    try {
      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(connId)}/backup-jobs/${encodeURIComponent(deleteBackupJobDialog.id)}`,
        { method: 'DELETE' }
      )
      
      const json = await res.json()
      
      if (json.error) {
        setBackupJobsError(json.error)
      } else {
        setDeleteBackupJobDialog(null)
        loadBackupJobs(connId)
      }
    } catch (e: any) {
      setBackupJobsError(e?.message || 'Failed to delete backup job')
    } finally {
      setBackupJobDeleting(false)
    }
  }

  // Charger les storages PBS configurés sur la connexion PVE
  const loadPveStorages = useCallback(async (connId: string) => {
    if (!connId) return []

    try {
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/storage`, { cache: 'no-store' })
      const json = await res.json()
      const storages = json?.data || []

      
return storages.filter((s: any) => s.type === 'pbs')
    } catch (e) {
      console.warn('Failed to load PVE storages:', e)
      
return []
    }
  }, [])

  // Trouver les storages PVE compatibles avec le backup PBS
  const findAllCompatibleStorages = useCallback((backup: any, storages: any[]) => {
    if (!backup || !storages || storages.length === 0) return []
    
    const exactMatch: any[] = []
    const datastoreMatch: any[] = []
    
    for (const storage of storages) {
      if (storage.datastore === backup.datastore) {
        if (backup.pbsUrl && storage.server) {
          const backupHost = backup.pbsUrl.replace(/^https?:\/\//, '').split(':')[0].split('/')[0]
          const storageHost = storage.server.replace(/^https?:\/\//, '').split(':')[0].split('/')[0]

          if (backupHost === storageHost) {
            exactMatch.push({ ...storage, matchType: 'exact' })
            continue
          }
        }

        datastoreMatch.push({ ...storage, matchType: 'datastore' })
      }
    }
    
    return [...exactMatch, ...datastoreMatch]
  }, [])

  // Explorer le backup avec un storage PVE
  const exploreWithPveStorage = useCallback(async (backup: any, storage: any) => {
    if (!backup || !storage || !selection) return

    setExplorerLoading(true)
    setExplorerError(null)
    setExplorerMode('pve')
    setSelectedPveStorage(storage)

    try {
      const { connId } = parseVmId(selection.id)

      const params = new URLSearchParams({
        storage: storage.storage,
        volume: backup.backupPath,
        filepath: '/',
      })

      const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/file-restore?${params}`)
      const json = await res.json()

      if (json.error && !json.data?.files?.length) {
        console.warn('PVE file-restore failed, falling back to PBS:', json.error)
        setExplorerError(`Échec via PVE: ${json.error}. Basculement sur PBS...`)
        setExplorerLoading(false)
        await loadBackupContentViaPbs(backup)
        
return
      } else {
        const files = (json.data?.files || []).map((f: any) => ({
          ...f,
          browsable: f.type === 'directory' || f.type === 'virtual' || 
                     f.leaf === false || f.leaf === 0 ||
                     (f.leaf === undefined && f.type !== 'file'),
        }))

        setExplorerArchives(files)
        if (json.error) setExplorerError(json.error)
      }
    } catch (e: any) {
      setExplorerError(e.message || t('errors.loadingError'))
    }

    setExplorerLoading(false)
  }, [selection])

  // Charger le contenu via PBS (fallback)
  const loadBackupContentViaPbs = useCallback(async (backup: any) => {
    setExplorerMode('pbs')
    setSelectedPveStorage(null)
    setExplorerLoading(true)
    
    try {
      const backupId = encodeURIComponent(backup.id)
      const res = await fetch(`/api/v1/pbs/${encodeURIComponent(backup.pbsId)}/backups/${backupId}/content`)
      const json = await res.json()

      if (json.error && !json.data) {
        setExplorerError(json.error)
      } else {
        setExplorerArchives(json.data?.files || [])
        if (json.error) setExplorerError(json.error)
      }
    } catch (e: any) {
      setExplorerError(e.message || t('errors.loadingError'))
    } finally {
      setExplorerLoading(false)
    }
  }, [])

  // Charger le contenu d'un backup
  const loadBackupContent = useCallback(async (backup: any) => {
    if (!backup || !selection) return

    setExplorerLoading(true)
    setExplorerError(null)
    setExplorerArchive(null)
    setExplorerPath('/')
    setExplorerFiles([])
    setExplorerArchives([])
    setCompatibleStorages([])
    setSelectedPveStorage(null)

    try {
      const { connId } = parseVmId(selection.id)
      const storages = await loadPveStorages(connId)

      setPveStorages(storages)

      const compatible = findAllCompatibleStorages(backup, storages)

      setCompatibleStorages(compatible)

      if (compatible.length === 1 && compatible[0].matchType === 'exact') {
        await exploreWithPveStorage(backup, compatible[0])
      } else if (compatible.length > 0) {
        setExplorerMode('pve')
        setExplorerLoading(false)
      } else {
        await loadBackupContentViaPbs(backup)
      }
    } catch (e: any) {
      setExplorerError(e.message || t('errors.loadingError'))
      setExplorerLoading(false)
    }
  }, [selection, loadPveStorages, findAllCompatibleStorages, exploreWithPveStorage, loadBackupContentViaPbs])

  // Naviguer dans une archive/dossier
  const browseArchive = useCallback(async (archiveName: string, path = '/') => {
    if (!selectedBackup || !selection) return

    setExplorerLoading(true)
    setExplorerError(null)

    try {
      if (explorerMode === 'pve' && selectedPveStorage) {
        const { connId } = parseVmId(selection.id)
        const fullPath = path === '/' ? `/${archiveName}` : `/${archiveName}${path}`
        
        const params = new URLSearchParams({
          storage: selectedPveStorage.storage,
          volume: selectedBackup.backupPath,
          filepath: fullPath,
        })

        const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/file-restore?${params}`)
        const json = await res.json()

        if (json.error && !json.data?.files?.length) {
          setExplorerError(json.error)
        } else {
          setExplorerFiles(json.data?.files || [])
          setExplorerArchive(archiveName)
          setExplorerPath(path)
          if (json.error) setExplorerError(json.error)
        }
      } else {
        const backupId = encodeURIComponent(selectedBackup.id)

        const params = new URLSearchParams({
          archive: archiveName,
          filepath: path,
        })

        const res = await fetch(`/api/v1/pbs/${encodeURIComponent(selectedBackup.pbsId)}/backups/${backupId}/content?${params}`)
        const json = await res.json()

        if (json.error && !json.data) {
          setExplorerError(json.error)
        } else {
          setExplorerFiles(json.data?.files || [])
          setExplorerArchive(archiveName)
          setExplorerPath(path)
          if (json.error) setExplorerError(json.error)
        }
      }
    } catch (e: any) {
      setExplorerError(e.message || t('errors.loadingError'))
    } finally {
      setExplorerLoading(false)
    }
  }, [selectedBackup, selection, explorerMode, selectedPveStorage])

  // Naviguer dans un dossier
  const navigateToFolder = useCallback((folderName: string) => {
    if (!explorerArchive) return
    setExplorerSearch('') // Reset la recherche
    const newPath = explorerPath === '/' ? `/${folderName}` : `${explorerPath}/${folderName}`

    browseArchive(explorerArchive, newPath)
  }, [explorerArchive, explorerPath, browseArchive])

  // Remonter d'un niveau
  const navigateUp = useCallback(() => {
    if (!explorerArchive || explorerPath === '/') return
    setExplorerSearch('') // Reset la recherche
    const parts = explorerPath.split('/').filter(Boolean)

    parts.pop()
    const newPath = parts.length ? '/' + parts.join('/') : '/'

    browseArchive(explorerArchive, newPath)
  }, [explorerArchive, explorerPath, browseArchive])

  // Naviguer vers un chemin du breadcrumb
  const navigateToBreadcrumb = useCallback((index: number) => {
    if (!explorerArchive) return
    setExplorerSearch('') // Reset la recherche
    const parts = explorerPath.split('/').filter(Boolean)
    const newPath = '/' + parts.slice(0, index + 1).join('/')

    browseArchive(explorerArchive, newPath)
  }, [explorerArchive, explorerPath, browseArchive])

  // Retourner à la liste des backups
  const backToBackupsList = useCallback(() => {
    setSelectedBackup(null)
    setExplorerArchive(null)
    setExplorerPath('/')
    setExplorerFiles([])
    setExplorerArchives([])
    setExplorerError(null)
    setCompatibleStorages([])
    setSelectedPveStorage(null)
  }, [])

  // Retourner à la liste des archives
  const backToArchives = useCallback(() => {
    setExplorerArchive(null)
    setExplorerPath('/')
    setExplorerFiles([])
  }, [])

  // Télécharger un fichier ou dossier depuis le backup
  const downloadFile = useCallback(async (fileName: string, isDirectory = false) => {
    if (!selectedBackup || !selection || !selectedPveStorage || !explorerArchive) return

    try {
      const { connId } = parseVmId(selection.id)
      
      // Construire le chemin complet du fichier
      const fullPath = explorerPath === '/' 
        ? `/${explorerArchive}${explorerPath}${fileName}`
        : `/${explorerArchive}${explorerPath}/${fileName}`

      // Construire l'URL de téléchargement
      const params = new URLSearchParams({
        storage: selectedPveStorage.storage,
        volume: selectedBackup.backupPath,
        filepath: fullPath,
      })
      
      // Indiquer si c'est un dossier pour forcer le .zip
      if (isDirectory) {
        params.set('directory', '1')
      }

      const downloadUrl = `/api/v1/connections/${encodeURIComponent(connId)}/file-restore/download?${params}`

      // Ouvrir le téléchargement dans un nouvel onglet/téléchargement
      window.open(downloadUrl, '_blank')
    } catch (e: any) {
      console.error('Download error:', e)
      setExplorerError(`${t('errors.loadingError')}: ${e.message}`)
    }
  }, [selectedBackup, selection, selectedPveStorage, explorerArchive, explorerPath])

  // État pour le filtre de recherche dans l'explorateur
  const [explorerSearch, setExplorerSearch] = useState('')

  // Fichiers filtrés par la recherche
  const filteredExplorerFiles = useMemo(() => {
    if (!explorerSearch.trim()) return explorerFiles
    const search = explorerSearch.toLowerCase()

    
return explorerFiles.filter((file: any) => 
      file.name?.toLowerCase().includes(search)
    )
  }, [explorerFiles, explorerSearch])

  // ==================== SNAPSHOTS ====================
  const [snapshots, setSnapshots] = useState<any[]>([])
  const [snapshotsLoading, setSnapshotsLoading] = useState(false)
  const [snapshotsError, setSnapshotsError] = useState<string | null>(null)
  const [snapshotsLoaded, setSnapshotsLoaded] = useState(false)
  const [snapshotActionBusy, setSnapshotActionBusy] = useState(false)
  const [showCreateSnapshot, setShowCreateSnapshot] = useState(false)
  const [newSnapshotName, setNewSnapshotName] = useState('')
  const [newSnapshotDesc, setNewSnapshotDesc] = useState('')
  const [newSnapshotRam, setNewSnapshotRam] = useState(false)

  const loadSnapshots = useCallback(async () => {
    if (!selection || selection.type !== 'vm') return
    
    const { connId, type, node, vmid } = parseVmId(selection.id)
    const vmKey = `${connId}:${type}:${node}:${vmid}`
    
    setSnapshotsLoading(true)
    setSnapshotsError(null)
    
    try {
      const res = await fetch(
        `/api/v1/guests/${encodeURIComponent(vmKey)}/snapshots`,
        { cache: 'no-store' }
      )

      const json = await res.json()
      
      if (json.error) {
        setSnapshotsError(json.error)
      } else {
        setSnapshots(json.data?.snapshots || [])
        setSnapshotsLoaded(true)
      }
    } catch (e: any) {
      setSnapshotsError(e.message || t('errors.loadingError'))
    } finally {
      setSnapshotsLoading(false)
    }
  }, [selection])

  const createSnapshot = useCallback(async () => {
    if (!selection || selection.type !== 'vm' || !newSnapshotName.trim()) return
    
    const { connId, type, node, vmid } = parseVmId(selection.id)
    const vmKey = `${connId}:${type}:${node}:${vmid}`
    
    setSnapshotActionBusy(true)
    
    try {
      const res = await fetch(
        `/api/v1/guests/${encodeURIComponent(vmKey)}/snapshots`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: newSnapshotName.trim(),
            description: newSnapshotDesc.trim(),
            vmstate: newSnapshotRam,
          }),
        }
      )

      const json = await res.json()
      
      if (json.error) {
        setSnapshotsError(json.error)
        toast.error(json.error)
      } else {
        setShowCreateSnapshot(false)
        setNewSnapshotName('')
        setNewSnapshotDesc('')
        setNewSnapshotRam(false)
        toast.success(t('inventory.snapshotCreated'))

        // Recharger après un délai
        setTimeout(loadSnapshots, 2000)
      }
    } catch (e: any) {
      const errorMsg = e.message || t('errors.addError')
      setSnapshotsError(errorMsg)
      toast.error(errorMsg)
    } finally {
      setSnapshotActionBusy(false)
    }
  }, [selection, newSnapshotName, newSnapshotDesc, newSnapshotRam, loadSnapshots, toast, t])

  const deleteSnapshot = useCallback(async (snapname: string) => {
    if (!selection || selection.type !== 'vm') return
    
    const { connId, type, node, vmid } = parseVmId(selection.id)
    const vmKey = `${connId}:${type}:${node}:${vmid}`
    
    setConfirmAction({
      action: 'delete-snapshot',
      title: t('inventory.deleteSnapshot'),
      message: `${t('common.deleteConfirmation')} "${snapname}"`,
      vmName: data?.title || `VM ${vmid}`,
      onConfirm: async () => {
        setConfirmActionLoading(true)
        setSnapshotActionBusy(true)
        
        try {
          const res = await fetch(
            `/api/v1/guests/${encodeURIComponent(vmKey)}/snapshots?name=${encodeURIComponent(snapname)}`,
            { method: 'DELETE' }
          )

          const json = await res.json()
          
          if (json.error) {
            setSnapshotsError(json.error)
            toast.error(json.error)
          } else {
            toast.success(t('inventory.snapshotDeleted'))
            setTimeout(loadSnapshots, 2000)
          }

          setConfirmAction(null)
        } catch (e: any) {
          const errorMsg = e.message || t('errors.deleteError')
          setSnapshotsError(errorMsg)
          toast.error(errorMsg)
        } finally {
          setSnapshotActionBusy(false)
          setConfirmActionLoading(false)
        }
      }
    })
  }, [selection, loadSnapshots, data?.title, toast, t])

  const rollbackSnapshot = useCallback(async (snapname: string, hasVmstate?: boolean) => {
    if (!selection || selection.type !== 'vm') return
    
    const { connId, type, node, vmid } = parseVmId(selection.id)
    const vmKey = `${connId}:${type}:${node}:${vmid}`
    
    setConfirmAction({
      action: 'restore-snapshot',
      title: t('audit.actions.restore'),
      message: `${t('audit.actions.restore')} "${snapname}"?`,
      vmName: data?.title || `VM ${vmid}`,
      onConfirm: async () => {
        setConfirmActionLoading(true)
        setSnapshotActionBusy(true)
        
        try {
          const res = await fetch(
            `/api/v1/guests/${encodeURIComponent(vmKey)}/snapshots/${encodeURIComponent(snapname)}`,
            { method: 'POST' }
          )

          const json = await res.json()
          
          if (json.error) {
            setSnapshotsError(json.error)
            toast.error(json.error)
          } else {
            toast.success(t('inventory.snapshotRestored'))
            setConfirmAction(null)
          }
        } catch (e: any) {
          const errorMsg = e.message || t('errors.updateError')
          setSnapshotsError(errorMsg)
          toast.error(errorMsg)
        } finally {
          setSnapshotActionBusy(false)
          setConfirmActionLoading(false)
        }
      }
    })
  }, [selection, data?.title, toast, t])

  // ==================== TASKS (Historique des tâches) ====================
  const [tasks, setTasks] = useState<any[]>([])
  const [tasksLoading, setTasksLoading] = useState(false)
  const [tasksError, setTasksError] = useState<string | null>(null)
  const [tasksLoaded, setTasksLoaded] = useState(false)

  const loadTasks = useCallback(async () => {
    if (!selection || selection.type !== 'vm') return
    
    const { connId, type, node, vmid } = parseVmId(selection.id)
    const vmKey = `${connId}:${type}:${node}:${vmid}`
    
    setTasksLoading(true)
    setTasksError(null)
    
    try {
      const res = await fetch(
        `/api/v1/guests/${encodeURIComponent(vmKey)}/tasks`,
        { cache: 'no-store' }
      )

      const json = await res.json()
      
      if (json.error) {
        setTasksError(json.error)
      } else {
        setTasks(json.data?.tasks || [])
        setTasksLoaded(true)
      }
    } catch (e: any) {
      setTasksError(e.message || t('errors.loadingError'))
    } finally {
      setTasksLoading(false)
    }
  }, [selection])

  // ==================== NOTES ====================
  const [vmNotes, setVmNotes] = useState('')
  const [notesLoading, setNotesLoading] = useState(false)
  const [notesSaving, setNotesSaving] = useState(false)
  const [notesError, setNotesError] = useState<string | null>(null)
  const [notesEditing, setNotesEditing] = useState(false)
  const [notesLoaded, setNotesLoaded] = useState(false)

  const loadNotes = useCallback(async () => {
    if (!selection || selection.type !== 'vm') return
    
    const { connId, type, node, vmid } = parseVmId(selection.id)
    const vmKey = `${connId}:${type}:${node}:${vmid}`
    
    setNotesLoading(true)
    setNotesError(null)
    
    try {
      const res = await fetch(
        `/api/v1/guests/${encodeURIComponent(vmKey)}/notes`,
        { cache: 'no-store' }
      )

      const json = await res.json()
      
      if (json.error) {
        setNotesError(json.error)
      } else {
        setVmNotes(json.data?.content || '')
        setNotesLoaded(true)
      }
    } catch (e: any) {
      setNotesError(e.message || t('errors.loadingError'))
    } finally {
      setNotesLoading(false)
    }
  }, [selection])

  const saveNotes = useCallback(async () => {
    if (!selection || selection.type !== 'vm') return
    
    const { connId, type, node, vmid } = parseVmId(selection.id)
    const vmKey = `${connId}:${type}:${node}:${vmid}`
    
    setNotesSaving(true)
    setNotesError(null)
    
    try {
      const res = await fetch(
        `/api/v1/guests/${encodeURIComponent(vmKey)}/notes`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: vmNotes }),
        }
      )

      const json = await res.json()
      
      if (json.error) {
        setNotesError(json.error)
      } else {
        setNotesEditing(false)
      }
    } catch (e: any) {
      setNotesError(e.message || t('errors.updateError'))
    } finally {
      setNotesSaving(false)
    }
  }, [selection, vmNotes])

  // ==================== HIGH AVAILABILITY (HA) ====================
  const [haConfig, setHaConfig] = useState<any>(null)
  const [haGroups, setHaGroups] = useState<any[]>([])
  const [haLoading, setHaLoading] = useState(false)
  const [haSaving, setHaSaving] = useState(false)
  const [haError, setHaError] = useState<string | null>(null)
  const [haLoaded, setHaLoaded] = useState(false)
  const [haEditing, setHaEditing] = useState(false)
  
  // Formulaire HA
  const [haState, setHaState] = useState<string>('started')
  const [haGroup, setHaGroup] = useState<string>('')
  const [haMaxRestart, setHaMaxRestart] = useState<number>(1)
  const [haMaxRelocate, setHaMaxRelocate] = useState<number>(1)
  const [haComment, setHaComment] = useState<string>('')

  const loadHaConfig = useCallback(async () => {
    if (!selection || selection.type !== 'vm') return
    
    const { connId, type, vmid } = parseVmId(selection.id)
    const haSid = `${type === 'lxc' ? 'ct' : 'vm'}:${vmid}`
    
    setHaLoading(true)
    setHaError(null)
    
    try {
      // Charger la config HA et les groupes en parallèle
      const [configRes, groupsRes] = await Promise.all([
        fetch(`/api/v1/connections/${encodeURIComponent(connId)}/ha/${encodeURIComponent(haSid)}`, { cache: 'no-store' }),
        fetch(`/api/v1/connections/${encodeURIComponent(connId)}/ha`, { cache: 'no-store' })
      ])
      
      const configJson = await configRes.json()
      const groupsJson = await groupsRes.json()
      
      if (configJson.error) {
        setHaError(configJson.error)
      } else {
        setHaConfig(configJson.data)


        // Remplir le formulaire si la config existe
        if (configJson.data) {
          setHaState(configJson.data.state || 'started')
          setHaGroup(configJson.data.group || '')
          setHaMaxRestart(configJson.data.max_restart ?? 1)
          setHaMaxRelocate(configJson.data.max_relocate ?? 1)
          setHaComment(configJson.data.comment || '')
        } else {
          // Reset le formulaire si pas de config
          setHaState('started')
          setHaGroup('')
          setHaMaxRestart(1)
          setHaMaxRelocate(1)
          setHaComment('')
        }
      }
      
      if (groupsJson.data?.groups) {
        setHaGroups(groupsJson.data.groups)
      }
      
      setHaLoaded(true)
    } catch (e: any) {
      setHaError(e.message || t('errors.loadingError'))
    } finally {
      setHaLoading(false)
    }
  }, [selection])

  const saveHaConfig = useCallback(async () => {
    if (!selection || selection.type !== 'vm') return
    
    const { connId, type, vmid } = parseVmId(selection.id)
    const haSid = `${type === 'lxc' ? 'ct' : 'vm'}:${vmid}`
    
    setHaSaving(true)
    setHaError(null)
    
    try {
      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(connId)}/ha/${encodeURIComponent(haSid)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            state: haState,
            group: haGroup || undefined,
            max_restart: haMaxRestart,
            max_relocate: haMaxRelocate,
            comment: haComment || undefined,
          }),
        }
      )

      const json = await res.json()
      
      if (json.error) {
        setHaError(json.error)
      } else {
        setHaEditing(false)

        // Recharger la config
        loadHaConfig()
      }
    } catch (e: any) {
      setHaError(e.message || t('errors.updateError'))
    } finally {
      setHaSaving(false)
    }
  }, [selection, haState, haGroup, haMaxRestart, haMaxRelocate, haComment, loadHaConfig])

  const removeHaConfig = useCallback(async () => {
    if (!selection || selection.type !== 'vm') return
    
    const { connId, type, vmid } = parseVmId(selection.id)
    const haSid = `${type === 'lxc' ? 'ct' : 'vm'}:${vmid}`
    
    setConfirmAction({
      action: 'disable-ha',
      title: t('audit.actions.disable'),
      message: t('common.deleteConfirmation'),
      vmName: data?.title || `VM ${vmid}`,
      onConfirm: async () => {
        setConfirmActionLoading(true)
        setHaSaving(true)
        setHaError(null)
        
        try {
          const res = await fetch(
            `/api/v1/connections/${encodeURIComponent(connId)}/ha/${encodeURIComponent(haSid)}`,
            { method: 'DELETE' }
          )

          const json = await res.json()
          
          if (json.error) {
            setHaError(json.error)
          } else {
            setHaConfig(null)
            setHaEditing(false)

            // Reset formulaire
            setHaState('started')
            setHaGroup('')
            setHaMaxRestart(1)
            setHaMaxRelocate(1)
            setHaComment('')
          }

          setConfirmAction(null)
        } catch (e: any) {
          setHaError(e.message || t('errors.deleteError'))
        } finally {
          setHaSaving(false)
          setConfirmActionLoading(false)
        }
      }
    })
  }, [selection, data?.title])

  // ==================== PREVIEW ====================
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewData, setPreviewData] = useState<any>(null)

  const previewFile = useCallback(async (fileName: string) => {
    if (!selectedBackup || !selection || !selectedPveStorage || !explorerArchive) return

    const { connId } = parseVmId(selection.id)
    
    const fullPath = explorerPath === '/' 
      ? `/${explorerArchive}${explorerPath}${fileName}`
      : `/${explorerArchive}${explorerPath}/${fileName}`

    setPreviewOpen(true)
    setPreviewLoading(true)
    setPreviewError(null)
    setPreviewData(null)

    try {
      const params = new URLSearchParams({
        storage: selectedPveStorage.storage,
        volume: selectedBackup.backupPath,
        filepath: fullPath,
      })

      const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/file-restore/preview?${params}`)
      const json = await res.json()

      if (json.error) {
        setPreviewError(json.error)
      } else {
        setPreviewData(json.data)
      }
    } catch (e: any) {
      setPreviewError(e.message || t('errors.loadingError'))
    } finally {
      setPreviewLoading(false)
    }
  }, [selectedBackup, selection, selectedPveStorage, explorerArchive, explorerPath])

  // Extensions supportées pour la preview
  const canPreview = useCallback((fileName: string) => {
    const ext = ('.' + fileName.split('.').pop()?.toLowerCase()) || ''
    const textExts = ['.txt', '.log', '.conf', '.cfg', '.ini', '.yaml', '.yml', '.json', '.xml', '.sh', '.py', '.js', '.md', '.csv', '.env', '.sql', '.html', '.css']
    const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico']

    
return textExts.includes(ext) || imageExts.includes(ext) || fileName.startsWith('.')
  }, [])

  // Fonction pour charger les trends de plusieurs VMs en batch (groupées par connexion)
  const loadVmTrendsBatch = useCallback(async (vms: VmRow[]): Promise<Record<string, TrendPoint[]>> => {
    if (vms.length === 0) return {}
    
    // Grouper les VMs par connexion
    const byConnection: Record<string, VmRow[]> = {}

    vms.forEach(vm => {
      if (!byConnection[vm.connId]) {
        byConnection[vm.connId] = []
      }

      byConnection[vm.connId].push(vm)
    })
    
    // Faire un appel par connexion (en parallèle)
    const results: Record<string, TrendPoint[]> = {}
    
    await Promise.all(
      Object.entries(byConnection).map(async ([connId, connVms]) => {
        try {
          const res = await fetch(
            `/api/v1/connections/${encodeURIComponent(connId)}/guests/trends`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                items: connVms.map(vm => ({ type: vm.type, node: vm.node, vmid: vm.vmid })),
                timeframe: 'day'  // day donne ~24h de données, on prendra les 3 dernières heures
              }),
              cache: 'no-store'
            }
          )
          
          if (!res.ok) return
          
          const json = await res.json()
          const data = json?.data || {}
          
          // Mapper les résultats vers les IDs de VMs
          connVms.forEach(vm => {
            const key = `${vm.type}:${vm.node}:${vm.vmid}`
            const points = data[key] || []


            // Prendre les ~36 derniers points (~3h de données avec résolution 5min du timeframe day)
            results[vm.id] = points.slice(-36)
          })
        } catch (e) {
          console.error('Failed to batch load trends for connection', connId, e)
        }
      })
    )
    
    return results
  }, [])

  useEffect(() => {
    let alive = true

    async function run() {
      setError(null)
      setData(null)
      setSeries([])
      setRrdError(null)
      setLocalTags([])
      setExpandedVmsTable(false)  // Réinitialiser le mode expanded
      
      // Réinitialiser les états spécifiques aux VMs
      setTasksLoaded(false)
      setTasks([])
      setTasksError(null)
      setSnapshotsLoaded(false)
      setSnapshots([])
      setSnapshotsError(null)
      setNotesLoaded(false)
      setVmNotes('')
      setNotesError(null)
      setNotesEditing(false)
      setBackups([])
      setBackupsStats(null)
      setBackupsError(null)
      setBackupsPreloaded(false)
      setGuestInfo(null)

      // Réinitialiser les états HA
      setHaLoaded(false)
      setHaConfig(null)
      setHaGroups([])
      setHaError(null)
      setHaEditing(false)

      // Réinitialiser les états de réplication
      setReplicationLoaded(false)
      setReplicationJobs([])
      setAvailableTargetNodes([])
      setSourceCephAvailable(false)
      setCephClusters([])
      setCephReplicationJobs([])

      if (!selection) return

      setLoading(true)

      try {
        const payload = await fetchDetails(selection)

        if (!alive) return
        setData(payload)
        setLocalTags(payload.tags || [])
      } catch (e: any) {
        if (!alive) return
        setError(e?.message || String(e))
      } finally {
        if (!alive) return
        setLoading(false)
      }
    }

    run()

    
return () => {
      alive = false
    }
  }, [selection?.type, selection?.id])

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

  // Initialiser les sliders CPU et RAM quand les données sont chargées
  useEffect(() => {
    if (data?.cpuInfo) {
      setCpuSockets(data.cpuInfo.sockets || 1)
      setCpuCores(data.cpuInfo.cores || 1)
      setCpuType(data.cpuInfo.type || 'kvm64')
      setCpuLimit(data.cpuInfo.cpulimit || 0)
      setCpuLimitEnabled(!!data.cpuInfo.cpulimit)
    }

    if (data?.memoryInfo) {
      setMemory(data.memoryInfo.memory || 2048)
      setBalloon(data.memoryInfo.balloon || 0)
      setBalloonEnabled(data.memoryInfo.balloon !== 0 && data.memoryInfo.balloon !== undefined)
    }
  }, [data?.cpuInfo, data?.memoryInfo])

  // Mémoriser maxMem pour éviter les re-renders inutiles
  const maxMem = data?.metrics?.ram?.max
  const maxMemRef = React.useRef<number | undefined>(undefined)
  
  // Mettre à jour la ref seulement si maxMem change vraiment
  React.useEffect(() => {
    if (maxMem !== undefined && maxMem !== maxMemRef.current) {
      maxMemRef.current = maxMem
    }
  }, [maxMem])

  useEffect(() => {
    let alive = true

    async function runRrd() {
      setRrdError(null)

      // Ne pas reset series immédiatement pour éviter le flash
      // setSeries([])

      if (!selection) return
      if (selection.type !== 'node' && selection.type !== 'vm') return

      try {
        setRrdLoading(true)

        let connectionId = ''
        let path = ''

        if (selection.type === 'node') {
          const { connId, node } = parseNodeId(selection.id)

          connectionId = connId
          path = `/nodes/${node}`
        } else {
          const { connId, node, type, vmid } = parseVmId(selection.id)

          connectionId = connId
          path = `/nodes/${node}/${type}/${vmid}`
        }

        const raw = await fetchRrd(connectionId, path, tf)
        const built = buildSeriesFromRrd(raw, maxMemRef.current)

        if (!alive) return
        setSeries(built)
      } catch (e: any) {
        if (!alive) return
        setRrdError(e?.message || String(e))
      } finally {
        if (!alive) return
        setRrdLoading(false)
      }
    }

    // Petit délai pour laisser l'UI s'afficher d'abord
    const timer = setTimeout(runRrd, 50)

    
return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [selection?.type, selection?.id, tf]) // Retirer data?.metrics?.ram?.max des dépendances

  const progress = useMemo(() => (loading ? <LinearProgress /> : null), [loading])

  const canShowRrd = selection && (selection.type === 'node' || selection.type === 'vm')

  // Charger les backups quand on sélectionne l'onglet Sauvegardes (index 4) OU pré-charger pour le badge
  useEffect(() => {
    if (selection?.type === 'vm' && !backupsPreloaded && !backupsLoading) {
      const { type, vmid } = parseVmId(selection.id)

      loadBackups(vmid, type)
      setBackupsPreloaded(true)
    }
  }, [selection?.type, selection?.id, backupsPreloaded, backupsLoading, loadBackups])

  // Charger les snapshots quand une VM est sélectionnée (pré-chargement pour le badge)
  useEffect(() => {
    if (selection?.type === 'vm' && !snapshotsLoaded && !snapshotsLoading) {
      loadSnapshots()
    }
  }, [selection?.type, selection?.id, snapshotsLoaded, snapshotsLoading, loadSnapshots])

  // Charger les infos guest (IP, uptime) quand une VM est sélectionnée
  useEffect(() => {
    if (selection?.type !== 'vm') {
      setGuestInfo(null)
      
return
    }
    
    const loadGuestInfo = async () => {
      const { connId, type, node, vmid } = parseVmId(selection.id)

      setGuestInfoLoading(true)
      
      try {
        const res = await fetch(
          `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/guest`,
          { cache: 'no-store' }
        )
        
        if (res.ok) {
          const json = await res.json()
          const data = json.data || {}
          
          setGuestInfo({
            ip: data.ip,
            uptime: data.uptime,
            osInfo: data.osInfo
          })
        } else {
          setGuestInfo(null)
        }
      } catch (e) {
        console.error('Error loading guest info:', e)
        setGuestInfo(null)
      } finally {
        setGuestInfoLoading(false)
      }
    }
    
    loadGuestInfo()
  }, [selection?.type, selection?.id])

  // Charger les tâches quand on sélectionne l'onglet Historique des tâches (index 3)
  useEffect(() => {
    if (detailTab === 3 && selection?.type === 'vm' && !tasksLoaded && !tasksLoading) {
      loadTasks()
    }
  }, [detailTab, selection?.type, selection?.id, tasksLoaded, tasksLoading, loadTasks])

  // Charger les notes quand on sélectionne l'onglet Résumé (0) ou Notes (6)
  useEffect(() => {
    if ((detailTab === 0 || detailTab === 6) && selection?.type === 'vm' && !notesLoaded && !notesLoading) {
      loadNotes()
    }
  }, [detailTab, selection?.type, selection?.id, notesLoaded, notesLoading, loadNotes])

  // Charger la config HA quand on sélectionne l'onglet HA (index 8)
  useEffect(() => {
    if (detailTab === 8 && selection?.type === 'vm' && !haLoaded && !haLoading) {
      loadHaConfig()
    }
  }, [detailTab, selection?.type, selection?.id, haLoaded, haLoading, loadHaConfig])

  // Charger le lock status quand une VM est sélectionnée
  useEffect(() => {
    if (selection?.type === 'vm') {
      const { connId, node, type, vmid } = parseVmId(selection.id)
      
      fetch(`/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/unlock`, { 
        cache: 'no-store' 
      })
        .then(res => res.ok ? res.json() : null)
        .then(json => {
          if (json?.data) {
            setVmLock({
              locked: json.data.locked || false,
              lockType: json.data.lockType || undefined
            })
          } else {
            setVmLock({ locked: false })
          }
        })
        .catch(() => setVmLock({ locked: false }))
    } else {
      setVmLock({ locked: false })
    }
  }, [selection?.type, selection?.id])

  // Charger les jobs de réplication quand on sélectionne l'onglet Réplication (index 7)
  useEffect(() => {
    if (detailTab === 7 && selection?.type === 'vm' && !replicationLoaded && !replicationLoading) {
      setReplicationLoading(true)
      const { connId, node, vmid } = parseVmId(selection.id)
      
      // Charger les jobs de réplication, les nœuds disponibles et vérifier Ceph
      Promise.all([
        fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/replication?guest=${vmid}`, { cache: 'no-store' }).catch(() => null),
        fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes`, { cache: 'no-store' }).catch(() => null),
        fetch(`/api/v1/connections/${encodeURIComponent(connId)}/ceph/status`, { cache: 'no-store' }).catch(() => null),
      ]).then(async ([replicationRes, nodesRes, cephRes]) => {
        let jobs: any[] = []
        let nodes: string[] = []
        let hasCeph = false
        
        if (replicationRes?.ok) {
          try {
            const json = await replicationRes.json()
            jobs = (json.data || json || []).filter((j: any) => String(j.guest) === String(vmid))
          } catch {}
        }
        
        if (nodesRes?.ok) {
          try {
            const json = await nodesRes.json()
            const allNodes = json.data || json || []
            nodes = allNodes
              .filter((n: any) => n.node !== node && n.status === 'online')
              .map((n: any) => n.node)
          } catch {}
        }
        
        // Vérifier si Ceph est disponible sur ce cluster
        if (cephRes?.ok) {
          try {
            const json = await cephRes.json()
            // Si on a un statut Ceph valide (health défini), Ceph est disponible
            hasCeph = !!(json.data?.health || json.health)
          } catch {}
        }
        
        setReplicationJobs(jobs)
        setAvailableTargetNodes(nodes)
        setSourceCephAvailable(hasCeph)
        setReplicationLoaded(true)
        setReplicationLoading(false)
      }).catch(() => {
        setReplicationLoading(false)
        setReplicationLoaded(true)
      })
    }
  }, [detailTab, selection?.type, selection?.id, replicationLoaded, replicationLoading])

  // Charger les clusters Ceph disponibles quand on ouvre le dialog
  useEffect(() => {
    if (addCephReplicationDialogOpen && !cephClustersLoading && cephClusters.length === 0) {
      setCephClustersLoading(true)
      const { connId } = parseVmId(selection?.id || '')
      
      // Récupérer toutes les connexions et filtrer celles avec Ceph
      fetch('/api/v1/connections', { cache: 'no-store' })
        .then(async (res) => {
          if (!res.ok) return
          const json = await res.json()
          const connections = json.data || json || []
          
          // Pour chaque connexion (sauf la source), vérifier si Ceph est disponible
          const cephChecks = await Promise.all(
            connections
              .filter((c: any) => c.id !== connId && c.type === 'pve')
              .map(async (c: any) => {
                try {
                  const cephRes = await fetch(`/api/v1/connections/${encodeURIComponent(c.id)}/ceph/status`, { cache: 'no-store' })
                  if (cephRes.ok) {
                    const cephJson = await cephRes.json()
                    const healthData = cephJson.data?.health || cephJson.health
                    const hasCeph = !!healthData
                    if (hasCeph) {
                      // S'assurer que cephHealth est une string
                      let healthStatus = 'Unknown'
                      if (typeof healthData === 'string') {
                        healthStatus = healthData
                      } else if (typeof healthData === 'object' && healthData.status) {
                        healthStatus = healthData.status
                      }
                      return {
                        id: c.id,
                        name: c.name || c.id,
                        host: c.host,
                        cephHealth: healthStatus,
                      }
                    }
                  }
                } catch {}
                return null
              })
          )
          
          setCephClusters(cephChecks.filter(Boolean))
          setCephClustersLoading(false)
        })
        .catch(() => {
          setCephClustersLoading(false)
        })
    }
  }, [addCephReplicationDialogOpen, cephClustersLoading, cephClusters.length, selection?.id])

  // Charger les données HA du cluster dès la sélection (pour avoir la version) et quand on sélectionne l'onglet HA
  useEffect(() => {
    if (selection?.type === 'cluster' && !clusterHaLoaded && !clusterHaLoading) {
      loadClusterHa(selection.id)
    }
  }, [selection?.type, selection?.id, clusterHaLoaded, clusterHaLoading, loadClusterHa])

  // Charger la config du cluster quand on sélectionne l'onglet Cluster
  useEffect(() => {
    if (selection?.type === 'cluster' && clusterTab === 10 && !clusterConfigLoaded && !clusterConfigLoading) {
      loadClusterConfig(selection.id?.split(':')[0] || '')
    }
  }, [selection?.type, selection?.id, clusterTab, clusterConfigLoaded, clusterConfigLoading, loadClusterConfig])

  // Charger les notes quand on sélectionne l'onglet Notes
  useEffect(() => {
    if (selection?.type === 'cluster' && clusterTab === 5 && !clusterNotesLoaded && !clusterNotesLoading) {
      loadClusterNotes(selection.id?.split(':')[0] || '')
    }
  }, [selection?.type, selection?.id, clusterTab, clusterNotesLoaded, clusterNotesLoading, loadClusterNotes])

  // Charger Ceph quand on sélectionne l'onglet Ceph
  useEffect(() => {
    if (selection?.type === 'cluster' && clusterTab === 6 && !clusterCephLoaded && !clusterCephLoading) {
      loadClusterCeph(selection.id?.split(':')[0] || '')
    }
  }, [selection?.type, selection?.id, clusterTab, clusterCephLoaded, clusterCephLoading, loadClusterCeph])

  // Calculer les tendances Ceph basées sur l'historique
  const cephTrends = useMemo((): { read_bytes: 'stable' | 'up' | 'down'; write_bytes: 'stable' | 'up' | 'down'; read_iops: 'stable' | 'up' | 'down'; write_iops: 'stable' | 'up' | 'down' } => {
    if (clusterCephPerfHistory.length < 5) {
      return { read_bytes: 'stable', write_bytes: 'stable', read_iops: 'stable', write_iops: 'stable' }
    }
    
    // Prendre les 10 derniers points (ou moins si pas assez)
    const recentCount = Math.min(10, Math.floor(clusterCephPerfHistory.length / 2))
    const recent = clusterCephPerfHistory.slice(-recentCount)
    const older = clusterCephPerfHistory.slice(-recentCount * 2, -recentCount)
    
    if (older.length === 0) {
      return { read_bytes: 'stable', write_bytes: 'stable', read_iops: 'stable', write_iops: 'stable' }
    }
    
    const avgRecent = {
      read_bytes: recent.reduce((sum, p) => sum + (p.read_bytes_sec || 0), 0) / recent.length,
      write_bytes: recent.reduce((sum, p) => sum + (p.write_bytes_sec || 0), 0) / recent.length,
      read_iops: recent.reduce((sum, p) => sum + (p.read_op_per_sec || 0), 0) / recent.length,
      write_iops: recent.reduce((sum, p) => sum + (p.write_op_per_sec || 0), 0) / recent.length,
    }
    
    const avgOlder = {
      read_bytes: older.reduce((sum, p) => sum + (p.read_bytes_sec || 0), 0) / older.length,
      write_bytes: older.reduce((sum, p) => sum + (p.write_bytes_sec || 0), 0) / older.length,
      read_iops: older.reduce((sum, p) => sum + (p.read_op_per_sec || 0), 0) / older.length,
      write_iops: older.reduce((sum, p) => sum + (p.write_op_per_sec || 0), 0) / older.length,
    }
    
    const getTrend = (recent: number, older: number): 'up' | 'down' | 'stable' => {
      if (older === 0) return recent > 0 ? 'up' : 'stable'
      const change = ((recent - older) / older) * 100
      if (change > 10) return 'up'
      if (change < -10) return 'down'
      return 'stable'
    }
    
    return {
      read_bytes: getTrend(avgRecent.read_bytes, avgOlder.read_bytes),
      write_bytes: getTrend(avgRecent.write_bytes, avgOlder.write_bytes),
      read_iops: getTrend(avgRecent.read_iops, avgOlder.read_iops),
      write_iops: getTrend(avgRecent.write_iops, avgOlder.write_iops),
    }
  }, [clusterCephPerfHistory])

  // Filtrer les données affichées selon le timeframe sélectionné
  const clusterCephPerfFiltered = useMemo(() => {
    const now = Date.now()
    const cutoff = now - (clusterCephTimeframe * 1000)
    return clusterCephPerfHistory.filter(p => p.time > cutoff)
  }, [clusterCephPerfHistory, clusterCephTimeframe])

  // Composant icône de tendance
  const TrendIcon = ({ trend }: { trend: 'up' | 'down' | 'stable' }) => {
    if (trend === 'up') return <i className="ri-arrow-up-line" style={{ color: '#4caf50', fontSize: 14 }} />
    if (trend === 'down') return <i className="ri-arrow-down-line" style={{ color: '#f44336', fontSize: 14 }} />
    return <i className="ri-arrow-right-line" style={{ color: '#9e9e9e', fontSize: 14 }} />
  }

  // Rafraîchir les données de performance Ceph toutes les secondes
  useEffect(() => {
    if (selection?.type !== 'cluster' || clusterTab !== 6 || !clusterCephData) return

    const connId = selection.id?.split(':')[0] || ''
    
    const fetchCephPerf = async () => {
      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/ceph/status`, { cache: 'no-store' })
        const json = await res.json()
        
        if (json.data?.pgmap) {
          const now = Date.now()
          const perfData = {
            time: now,
            read_bytes_sec: json.data.pgmap.read_bytes_sec || 0,
            write_bytes_sec: json.data.pgmap.write_bytes_sec || 0,
            read_op_per_sec: json.data.pgmap.read_op_per_sec || 0,
            write_op_per_sec: json.data.pgmap.write_op_per_sec || 0,
          }
          
          setClusterCephPerf(perfData)
          
          // Ajouter à l'historique (toujours garder 1h de données max)
          setClusterCephPerfHistory(prev => {
            const newHistory = [...prev, perfData]
            // Toujours garder 1h de données (3600 secondes)
            const cutoff = now - 3600000
            return newHistory.filter(p => p.time > cutoff)
          })
        }
      } catch (e) {
        console.error('Error fetching Ceph perf:', e)
      }
    }

    // Premier fetch immédiat
    fetchCephPerf()
    
    // Puis toutes les secondes
    const interval = setInterval(fetchCephPerf, 2000)
    
    return () => clearInterval(interval)
  }, [selection?.type, selection?.id, clusterTab, clusterCephData])

  // Charger la config du cluster pour les nodes standalone quand on sélectionne l'onglet Cluster
  useEffect(() => {
    if (selection?.type === 'node' && nodeTab === 7 && !clusterConfigLoaded && !clusterConfigLoading) {
      loadClusterConfig(parseNodeId(selection.id).connId)
    }
  }, [selection?.type, selection?.id, nodeTab, clusterConfigLoaded, clusterConfigLoading, loadClusterConfig])

  // Charger les Notes quand on sélectionne l'onglet Notes (nodeTab === 1)
  useEffect(() => {
    const loadNodeNotes = async () => {
      if (selection?.type !== 'node' || nodeNotesLoaded || nodeNotesLoading) return
      if (nodeTab !== 1) return

      setNodeNotesLoading(true)
      const { connId, node } = parseNodeId(selection.id)

      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/notes`, { cache: 'no-store' })
        if (res.ok) {
          const json = await res.json()
          setNodeNotesData(json.data?.notes || '')
        }
      } catch (e) {
        console.error('Failed to load node notes:', e)
      } finally {
        setNodeNotesLoading(false)
        setNodeNotesLoaded(true)
      }
    }

    loadNodeNotes()
  }, [selection?.type, selection?.id, nodeTab, nodeNotesLoaded, nodeNotesLoading])

  // Reset des états Notes quand on change de node
  useEffect(() => {
    setNodeNotesData('')
    setNodeNotesLoaded(false)
    setNodeNotesLoading(false)
    setNodeNotesEditing(false)
  }, [selection?.id])

  // Reset des états Shell quand on change de node
  useEffect(() => {
    setNodeShellData(null)
    setNodeShellConnected(false)
  }, [selection?.id])

  // Charger les disques pour les nodes quand on sélectionne l'onglet Disks (nodeTab === 4)
  useEffect(() => {
    const loadNodeDisks = async () => {
      if (selection?.type !== 'node' || nodeDisksLoaded || nodeDisksLoading) return
      if (nodeTab !== 4) return // Onglet Disks est à l'index 4

      setNodeDisksLoading(true)
      const { connId, node } = parseNodeId(selection.id)

      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/disks`, { cache: 'no-store' })
        if (res.ok) {
          const json = await res.json()
          setNodeDisksData(json.data || json)
        } else {
          setNodeDisksData(null)
        }
      } catch (e) {
        console.error('Failed to load node disks:', e)
        setNodeDisksData(null)
      } finally {
        setNodeDisksLoading(false)
        setNodeDisksLoaded(true)
      }
    }

    loadNodeDisks()
  }, [selection?.type, selection?.id, nodeTab, nodeDisksLoaded, nodeDisksLoading])

  // Reset des états disques quand on change de node
  useEffect(() => {
    setNodeDisksData(null)
    setNodeDisksLoaded(false)
    setNodeDisksLoading(false)
    setNodeDisksSubTab(0)
  }, [selection?.id])

  // Charger la subscription quand on sélectionne l'onglet Subscription
  // L'index de l'onglet Subscription dépend de la configuration:
  // - Cluster: 0=Summary, 1=VMs, 2=Disks, 3=Ceph, 4=Replication, 5=Subscription
  // - Standalone: 0=Summary, 1=VMs, 2=Disks, 3=Backups, 4=Cluster, 5=Replication, 6=Subscription
  useEffect(() => {
    const loadNodeSubscription = async () => {
      if (selection?.type !== 'node' || nodeSubscriptionLoaded || nodeSubscriptionLoading) return
      
      const isInCluster = !!data?.clusterName
      const subscriptionTabIndex = isInCluster ? 8 : 9
      
      if (nodeTab !== subscriptionTabIndex) return

      setNodeSubscriptionLoading(true)
      const { connId, node } = parseNodeId(selection.id)

      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/subscription`, { cache: 'no-store' })
        if (res.ok) {
          const json = await res.json()
          setNodeSubscriptionData(json.data || json)
        } else {
          setNodeSubscriptionData(null)
        }
      } catch (e) {
        console.error('Failed to load node subscription:', e)
        setNodeSubscriptionData(null)
      } finally {
        setNodeSubscriptionLoading(false)
        setNodeSubscriptionLoaded(true)
      }
    }

    loadNodeSubscription()
  }, [selection?.type, selection?.id, nodeTab, nodeSubscriptionLoaded, nodeSubscriptionLoading, data?.clusterName])

  // Reset des états subscription quand on change de node
  useEffect(() => {
    setNodeSubscriptionData(null)
    setNodeSubscriptionLoaded(false)
    setNodeSubscriptionLoading(false)
  }, [selection?.id])

  // Charger la réplication quand on sélectionne l'onglet Replication
  // - Cluster: index 4
  // - Standalone: index 5
  useEffect(() => {
    const loadNodeReplication = async () => {
      if (selection?.type !== 'node' || nodeReplicationLoaded || nodeReplicationLoading) return
      
      const isInCluster = !!data?.clusterName
      const replicationTabIndex = isInCluster ? 7 : 8
      
      if (nodeTab !== replicationTabIndex) return

      setNodeReplicationLoading(true)
      const { connId, node } = parseNodeId(selection.id)

      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/replication`, { cache: 'no-store' })
        if (res.ok) {
          const json = await res.json()
          setNodeReplicationData(json.data || json)
        } else {
          setNodeReplicationData(null)
        }
      } catch (e) {
        console.error('Failed to load node replication:', e)
        setNodeReplicationData(null)
      } finally {
        setNodeReplicationLoading(false)
        setNodeReplicationLoaded(true)
      }
    }

    loadNodeReplication()
  }, [selection?.type, selection?.id, nodeTab, nodeReplicationLoaded, nodeReplicationLoading, data?.clusterName])

  // Reset des états réplication quand on change de node
  useEffect(() => {
    setNodeReplicationData(null)
    setNodeReplicationLoaded(false)
    setNodeReplicationLoading(false)
  }, [selection?.id])

  // Charger System quand on sélectionne l'onglet System
  // - Cluster: index 3 (après Disks)
  // - Standalone: index 3 (après Disks)
  useEffect(() => {
    const loadNodeSystem = async () => {
      if (selection?.type !== 'node' || nodeSystemLoaded || nodeSystemLoading) return
      
      const systemTabIndex = 5 // System est à l'index 5
      
      if (nodeTab !== systemTabIndex) return

      setNodeSystemLoading(true)
      const { connId, node } = parseNodeId(selection.id)

      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/system`, { cache: 'no-store' })
        if (res.ok) {
          const json = await res.json()
          setNodeSystemData(json.data || json)
        } else {
          setNodeSystemData(null)
        }
      } catch (e) {
        console.error('Failed to load node system:', e)
        setNodeSystemData(null)
      } finally {
        setNodeSystemLoading(false)
        setNodeSystemLoaded(true)
      }
    }

    loadNodeSystem()
  }, [selection?.type, selection?.id, nodeTab, nodeSystemLoaded, nodeSystemLoading])

  // Reset des états System quand on change de node
  useEffect(() => {
    setNodeSystemData(null)
    setNodeSystemLoaded(false)
    setNodeSystemLoading(false)
    setNodeSystemSubTab(0)
    setNodeSyslogData([])
  }, [selection?.id])

  // Charger Syslog quand on sélectionne le sous-onglet Syslog
  useEffect(() => {
    const loadSyslog = async () => {
      if (selection?.type !== 'node' || nodeTab !== 5 || nodeSystemSubTab !== 6) return
      
      setNodeSyslogLoading(true)
      const { connId, node } = parseNodeId(selection.id)

      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/syslog?limit=200&_t=${Date.now()}`, { cache: 'no-store' })
        if (res.ok) {
          const json = await res.json()
          setNodeSyslogData(json.data || [])
        }
      } catch (e) {
        console.error('Failed to load syslog:', e)
      } finally {
        setNodeSyslogLoading(false)
      }
    }

    loadSyslog()
  }, [selection?.type, selection?.id, nodeTab, nodeSystemSubTab])

  // Mode live pour syslog
  useEffect(() => {
    if (!nodeSyslogLive || selection?.type !== 'node' || nodeTab !== 5 || nodeSystemSubTab !== 6) return
    
    const { connId, node: nodeName } = parseNodeId(selection.id)
    
    const fetchLogs = async () => {
      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(nodeName)}/syslog?limit=200&_t=${Date.now()}`, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache' }
        })
        if (res.ok) {
          const json = await res.json()
          setNodeSyslogData(json.data || [])
        }
      } catch (e) {
        console.error('Failed to refresh syslog:', e)
      }
    }
    
    fetchLogs()
    const interval = setInterval(fetchLogs, 2000)
    return () => clearInterval(interval)
  }, [nodeSyslogLive, selection?.type, selection?.id, nodeTab, nodeSystemSubTab])

  // Charger Ceph pour les nodes quand on sélectionne l'onglet Ceph (nodeTab === 4 pour les clusters)
  useEffect(() => {
    const loadNodeCeph = async () => {
      if (selection?.type !== 'node' || nodeCephLoaded || nodeCephLoading) return
      
      // Déterminer l'index de l'onglet Ceph (dépend de si c'est standalone ou cluster)
      const isInCluster = !!data?.clusterName
      const cephTabIndex = isInCluster ? 6 : -1 // Pour cluster: après System (index 6). Pour standalone: pas d'onglet Ceph
      
      if (!isInCluster) return // Pas d'onglet Ceph pour les standalones
      if (nodeTab !== cephTabIndex) return

      setNodeCephLoading(true)
      const { connId, node } = parseNodeId(selection.id)

      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/ceph`, { cache: 'no-store' })
        if (res.ok) {
          const json = await res.json()
          setNodeCephData(json.data || json)
        } else {
          setNodeCephData({ hasCeph: false })
        }
      } catch (e) {
        console.error('Failed to load node Ceph:', e)
        setNodeCephData({ hasCeph: false })
      } finally {
        setNodeCephLoading(false)
        setNodeCephLoaded(true)
      }
    }

    loadNodeCeph()
  }, [selection?.type, selection?.id, nodeTab, nodeCephLoaded, nodeCephLoading, data?.clusterName])

  // Mode live pour les logs Ceph du node
  useEffect(() => {
    if (!nodeCephLogLive || selection?.type !== 'node' || !data?.clusterName) return
    
    const { connId, node: nodeName } = parseNodeId(selection.id)
    
    const fetchLogs = async () => {
      try {
        // Ajouter un timestamp pour éviter le cache
        const timestamp = Date.now()
        const res = await fetch(
          `/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(nodeName)}/ceph?section=log&logLines=100&_t=${timestamp}`, 
          { 
            cache: 'no-store',
            headers: {
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              'Pragma': 'no-cache'
            }
          }
        )
        if (res.ok) {
          const json = await res.json()
          if (json.data?.log) {
            setNodeCephData((prev: any) => ({ ...prev, log: json.data.log }))
          }
        }
      } catch (e) {
        console.error('Failed to fetch live logs:', e)
      }
    }
    
    // Fetch immédiatement puis toutes les 2 secondes
    fetchLogs()
    const interval = setInterval(fetchLogs, 2000)
    
    return () => clearInterval(interval)
  }, [nodeCephLogLive, selection?.type, selection?.id, data?.clusterName])

  // Charger Storage quand on sélectionne l'onglet Storage
  useEffect(() => {
    if (selection?.type === 'cluster' && clusterTab === 7 && !clusterStorageLoaded && !clusterStorageLoading) {
      loadClusterStorage(selection.id?.split(':')[0] || '')
    }
  }, [selection?.type, selection?.id, clusterTab, clusterStorageLoaded, clusterStorageLoading, loadClusterStorage])

  // Charger les mises à jour quand on sélectionne l'onglet Rolling Update
  useEffect(() => {
    if (selection?.type === 'cluster' && clusterTab === 9 && data?.nodesData?.length > 0) {
      const connId = selection.id?.split(':')[0] || ''
      // Charger les mises à jour et les VMs locales pour chaque nœud
      data.nodesData.forEach((node: any) => {
        // Charger les mises à jour
        if (node.status === 'online' && !nodeUpdates[node.node]?.loading && nodeUpdates[node.node] === undefined) {
          setNodeUpdates(prev => ({
            ...prev,
            [node.node]: { count: 0, updates: [], version: null, loading: true }
          }))
          
          fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node.node)}/updates`)
            .then(res => res.json())
            .then(json => {
              setNodeUpdates(prev => ({
                ...prev,
                [node.node]: {
                  count: json.data?.count || 0,
                  updates: json.data?.updates || [],
                  version: json.data?.version || null,
                  loading: false
                }
              }))
            })
            .catch(() => {
              setNodeUpdates(prev => ({
                ...prev,
                [node.node]: { count: 0, updates: [], version: null, loading: false }
              }))
            })
        }
        
        // Charger les VMs avec stockage local
        if (node.status === 'online' && !nodeLocalVms[node.node]?.loading && nodeLocalVms[node.node] === undefined) {
          setNodeLocalVms(prev => ({
            ...prev,
            [node.node]: { total: 0, running: 0, blockingMigration: 0, withReplication: 0, canMigrate: true, vms: [], loading: true }
          }))
          
          fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node.node)}/local-vms`)
            .then(res => res.json())
            .then(json => {
              setNodeLocalVms(prev => ({
                ...prev,
                [node.node]: {
                  total: json.data?.summary?.total || 0,
                  running: json.data?.summary?.running || 0,
                  blockingMigration: json.data?.summary?.blockingMigration || 0,
                  withReplication: json.data?.summary?.withReplication || 0,
                  canMigrate: json.data?.summary?.canMigrate ?? true,
                  vms: json.data?.localVms || [],
                  loading: false
                }
              }))
            })
            .catch(() => {
              setNodeLocalVms(prev => ({
                ...prev,
                [node.node]: { total: 0, running: 0, blockingMigration: 0, withReplication: 0, canMigrate: true, vms: [], loading: false }
              }))
            })
        }
      })
    }
  }, [selection?.type, selection?.id, clusterTab, data?.nodesData, nodeUpdates, nodeLocalVms])

  // Reset clusterTab et clusterHaLoaded quand la sélection change
  useEffect(() => {
    setClusterTab(0)
    setNodeTab(0)
    setClusterHaLoaded(false)
    setClusterHaResources([])
    setClusterHaGroups([])
    setClusterHaRules([])
    setClusterPveMajorVersion(8)
    setClusterPveVersion('')
    setClusterConfigLoaded(false)
    setClusterConfig(null)
    setClusterNotesLoaded(false)
    setClusterNotesContent('')
    setClusterNotesEditMode(false)
    setClusterCephLoaded(false)
    setClusterCephData(null)
    setClusterCephPerf(null)
    setClusterCephPerfHistory([])
    setClusterStorageLoaded(false)
    setClusterStorageData([])
    // Reset Ceph node
    setNodeCephLoaded(false)
    setNodeCephData(null)
    setNodeCephSubTab(0)
    setNodeCephLogLive(false)
    setNodeUpdates({})
    setNodeLocalVms({})
    setClusterFirewallLoaded(false)
  }, [selection?.id])

  // Détecter si les valeurs CPU ont été modifiées
  const cpuModified = useMemo(() => {
    if (!data?.cpuInfo) return false
    
return (
      cpuSockets !== (data.cpuInfo.sockets || 1) ||
      cpuCores !== (data.cpuInfo.cores || 1) ||
      cpuType !== (data.cpuInfo.type || 'kvm64') ||
      cpuLimit !== (data.cpuInfo.cpulimit || 0) ||
      cpuLimitEnabled !== !!data.cpuInfo.cpulimit
    )
  }, [data?.cpuInfo, cpuSockets, cpuCores, cpuType, cpuLimit, cpuLimitEnabled])

  // Détecter si les valeurs RAM ont été modifiées
  const memoryModified = useMemo(() => {
    if (!data?.memoryInfo) return false
    
return (
      memory !== (data.memoryInfo.memory || 2048) ||
      balloon !== (data.memoryInfo.balloon || 0) ||
      balloonEnabled !== (data.memoryInfo.balloon !== 0 && data.memoryInfo.balloon !== undefined)
    )
  }, [data?.memoryInfo, memory, balloon, balloonEnabled])

  // Sauvegarder la configuration CPU
  const saveCpuConfig = async () => {
    if (!selection || selection.type !== 'vm') return
    
    const { connId, node, type, vmid } = parseVmId(selection.id)
    
    // Capturer le statut AVANT la sauvegarde (utiliser vmRealStatus si disponible)
    const wasRunning = (data?.vmRealStatus || data?.status) === 'running'
    const vmTitle = data?.title
    
    setSavingCpu(true)

    try {
      const configUpdate: any = {
        sockets: cpuSockets,
        cores: cpuCores,
        cpu: cpuType,
      }
      
      if (cpuLimitEnabled && cpuLimit > 0) {
        configUpdate.cpulimit = cpuLimit
      } else {
        configUpdate.cpulimit = 0
      }
      
      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/config`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(configUpdate)
        }
      )
      
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))

        throw new Error(err?.error || `HTTP ${res.status}`)
      }
      
      // Recharger les données
      const payload = await fetchDetails(selection)

      setData(payload)
      setLocalTags(payload.tags || [])
      
      // Message de succès avec avertissement si VM était running
      if (wasRunning) {
        setConfirmAction({
          action: 'info',
          title: t('inventoryPage.cpuConfigSaved'),
          message: `⚠️ ${t('inventoryPage.vmRunningCpuRestartRequired')}`,
          vmName: vmTitle,
          onConfirm: async () => setConfirmAction(null)
        })
      } else {
        setConfirmAction({
          action: 'info',
          title: t('inventoryPage.cpuConfigSaved'),
          message: t('inventoryPage.changesAppliedSuccessfully'),
          vmName: vmTitle,
          onConfirm: async () => setConfirmAction(null)
        })
      }
    } catch (e: any) {
      alert(`${t('inventoryPage.errorWhileSaving')}: ${e?.message || e}`)
    } finally {
      setSavingCpu(false)
    }
  }

  // Sauvegarder la configuration RAM
  const saveMemoryConfig = async () => {
    if (!selection || selection.type !== 'vm') return
    
    const { connId, node, type, vmid } = parseVmId(selection.id)
    
    // Capturer le statut AVANT la sauvegarde (utiliser vmRealStatus si disponible)
    const wasRunning = (data?.vmRealStatus || data?.status) === 'running'
    const vmTitle = data?.title
    
    setSavingMemory(true)

    try {
      const configUpdate: any = {
        memory: memory,
      }
      
      if (balloonEnabled) {
        configUpdate.balloon = balloon
      } else {
        configUpdate.balloon = 0
      }
      
      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/config`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(configUpdate)
        }
      )
      
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))

        throw new Error(err?.error || `HTTP ${res.status}`)
      }
      
      // Recharger les données
      const payload = await fetchDetails(selection)

      setData(payload)
      setLocalTags(payload.tags || [])
      
      // Message de succès avec avertissement si VM était running
      if (wasRunning) {
        setConfirmAction({
          action: 'info',
          title: t('inventoryPage.ramConfigSaved'),
          message: `⚠️ ${t('inventoryPage.vmRunningRamRestartRequired')}`,
          vmName: vmTitle,
          onConfirm: async () => setConfirmAction(null)
        })
      } else {
        setConfirmAction({
          action: 'info',
          title: t('inventoryPage.ramConfigSaved'),
          message: t('inventoryPage.changesAppliedSuccessfully'),
          vmName: vmTitle,
          onConfirm: async () => setConfirmAction(null)
        })
      }
    } catch (e: any) {
      alert(`${t('inventoryPage.errorWhileSaving')}: ${e?.message || e}`)
    } finally {
      setSavingMemory(false)
    }
  }

  // Exécuter une action sur la VM
  const handleVmAction = async (action: string) => {
    if (!selection || selection.type !== 'vm') return
    
    const { connId, node, type, vmid } = parseVmId(selection.id)

    // Actions nécessitant confirmation via dialog MUI
    if (['shutdown', 'stop', 'suspend', 'reboot'].includes(action)) {
      const actionLabels: Record<string, { title: string; message: string; icon: string }> = {
        shutdown: { title: t('audit.actions.stop'), message: 'ACPI shutdown', icon: '⏻' },
        stop: { title: t('audit.actions.stop'), message: t('common.warning'), icon: '⛔' },
        suspend: { title: t('audit.actions.suspend'), message: t('audit.actions.suspend'), icon: '⏸️' },
        reboot: { title: t('audit.actions.restart'), message: 'ACPI reboot', icon: '🔄' },
      }
      
      const label = actionLabels[action]

      setConfirmAction({
        action,
        title: label.title,
        message: label.message,
        vmName: data?.title || `VM ${vmid}`,
        onConfirm: async () => {
          setConfirmActionLoading(true)

          try {
            const url = `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/${action}`
            const res = await fetch(url, { method: 'POST' })
            const json = await res.json()

            if (!res.ok || json.error) {
              throw new Error(json?.error || `HTTP ${res.status}`)
            }

            // Track the task if we got an UPID
            const upid = json.data
            if (upid && typeof upid === 'string' && upid.startsWith('UPID:')) {
              trackTask({
                upid,
                connId,
                node,
                description: `${data?.title || `VM ${vmid}`}: ${t(`vmActions.${action}`)}`,
                onSuccess: () => {
                  // Recharger les données après la completion
                  fetchDetails(selection).then(payload => {
                    setData(payload)
                    setLocalTags(payload.tags || [])
                  })
                },
              })
            } else {
              // Pas d'UPID, afficher le toast de succès direct
              toast.success(t(`vmActions.${action}Success`))
            }

            setConfirmAction(null)
          } catch (e: any) {
            const errorMsg = e?.message || e
            toast.error(`${t('common.error')} (${action}): ${errorMsg}`)
          } finally {
            setConfirmActionLoading(false)
          }
        }
      })

return
    }

    // Actions sans confirmation (start, etc.)
    setActionBusy(true)

    try {
      const url = `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/${action}`
      const res = await fetch(url, { method: 'POST' })
      const json = await res.json()

      if (!res.ok || json.error) {
        throw new Error(json?.error || `HTTP ${res.status}`)
      }

      // Track the task if we got an UPID
      const upid = json.data
      if (upid && typeof upid === 'string' && upid.startsWith('UPID:')) {
        trackTask({
          upid,
          connId,
          node,
          description: `${data?.title || `VM ${vmid}`}: ${t(`vmActions.${action}`)}`,
          onSuccess: () => {
            // Recharger les données après la completion
            fetchDetails(selection).then(payload => {
              setData(payload)
              setLocalTags(payload.tags || [])
            })
          },
        })
      } else {
        // Pas d'UPID, afficher le toast de succès direct
        toast.success(t(`vmActions.${action}Success`))
      }
    } catch (e: any) {
      const errorMsg = e?.message || e
      toast.error(`${t('common.error')} (${action}): ${errorMsg}`)
    } finally {
      setActionBusy(false)
    }
  }

  // Exécuter une action sur une VM depuis le tableau
  const handleTableVmAction = useCallback(async (vm: VmRow, action: 'start' | 'shutdown' | 'stop' | 'pause' | 'console' | 'details' | 'clone' | 'reboot' | 'suspend') => {
    // Si c'est l'action détails, naviguer vers la VM
    if (action === 'details') {
      onSelect?.({ type: 'vm', id: vm.id })
      
return
    }

    // Si c'est l'action console, ouvrir la console
    if (action === 'console') {
      const url = `/infrastructure/vms/console/${encodeURIComponent(vm.type)}/${encodeURIComponent(vm.node)}/${encodeURIComponent(vm.vmid)}?conn=${encodeURIComponent(vm.connId)}`

      window.open(url, '_blank')
      
return
    }

    // Si c'est l'action clone, ouvrir le dialog de clonage
    if (action === 'clone') {
      setTableCloneVm({
        connId: vm.connId,
        node: vm.node,
        type: vm.type,
        vmid: String(vm.vmid),
        name: vm.name
      })
      
return
    }

    // Mapper l'action pause vers suspend pour l'API
    const apiAction = action === 'pause' ? 'suspend' : action

    // Actions nécessitant confirmation via dialog MUI
    if (['shutdown', 'stop', 'suspend', 'reboot'].includes(apiAction)) {
      const actionLabels: Record<string, { title: string; message: string }> = {
        shutdown: { title: t('audit.actions.stop'), message: 'ACPI shutdown' },
        stop: { title: t('audit.actions.stop'), message: t('common.warning') },
        suspend: { title: t('audit.actions.suspend'), message: t('audit.actions.suspend') },
        reboot: { title: t('audit.actions.restart'), message: 'ACPI reboot' },
      }
      
      const label = actionLabels[apiAction]

      setConfirmAction({
        action: apiAction,
        title: label.title,
        message: label.message,
        vmName: vm.name,
        onConfirm: async () => {
          setConfirmActionLoading(true)

          try {
            const url = `/api/v1/connections/${encodeURIComponent(vm.connId)}/guests/${vm.type}/${encodeURIComponent(vm.node)}/${encodeURIComponent(vm.vmid)}/${apiAction}`
            const res = await fetch(url, { method: 'POST' })
            const json = await res.json()

            if (!res.ok || json.error) {
              throw new Error(json?.error || `HTTP ${res.status}`)
            }

            // Track the task if we got an UPID
            const upid = json.data
            if (upid && typeof upid === 'string' && upid.startsWith('UPID:')) {
              trackTask({
                upid,
                connId: vm.connId,
                node: vm.node,
                description: `${vm.name}: ${t(`vmActions.${apiAction}`)}`,
              })
            } else {
              toast.success(t(`vmActions.${apiAction}Success`))
            }

            setConfirmAction(null)
          } catch (e: any) {
            const errorMsg = e?.message || e
            toast.error(`${t('common.error')} (${apiAction}): ${errorMsg}`)
          } finally {
            setConfirmActionLoading(false)
          }
        }
      })

return
    }

    // Actions sans confirmation (start)
    try {
      const url = `/api/v1/connections/${encodeURIComponent(vm.connId)}/guests/${vm.type}/${encodeURIComponent(vm.node)}/${encodeURIComponent(vm.vmid)}/${apiAction}`
      const res = await fetch(url, { method: 'POST' })
      const json = await res.json()

      if (!res.ok || json.error) {
        throw new Error(json?.error || `HTTP ${res.status}`)
      }

      // Track the task if we got an UPID
      const upid = json.data
      if (upid && typeof upid === 'string' && upid.startsWith('UPID:')) {
        trackTask({
          upid,
          connId: vm.connId,
          node: vm.node,
          description: `${vm.name}: ${t(`vmActions.${apiAction}`)}`,
        })
      } else {
        toast.success(t(`vmActions.${apiAction}Success`))
      }
    } catch (e: any) {
      const errorMsg = e?.message || e
      toast.error(`${t('common.error')} (${apiAction}) ${vm.name}: ${errorMsg}`)
    }
  }, [onSelect, t, toast, trackTask])

  // Handler pour le clic sur une VM dans le tableau (pour afficher les détails)
  const handleVmClick = useCallback((vm: VmRow) => {
    // Ne pas ouvrir les détails pour les templates
    if (vm.template) return
    onSelect?.({ type: 'vm', id: vm.id })
  }, [onSelect])

  // Handler pour le clic sur un node dans le tableau
  const handleNodeClick = useCallback((connId: string, node: string) => {
    // Passer en vue "hosts" et sélectionner le node
    onViewModeChange?.('hosts')
    onSelect?.({ type: 'node', id: `${connId}:${node}` })
  }, [onSelect, onViewModeChange])

  // Actions placeholders
  const handleNotImplemented = (action: string) => {
    alert(`${action}: ${t('common.notAvailable')}`)
  }

  // Handlers
  const onStart = () => handleVmAction('start')
  const onShutdown = () => handleVmAction('shutdown')
  const onStop = () => handleVmAction('stop')
  const onPause = () => handleVmAction('suspend')

  const onUnlock = async () => {
    if (!selection || selection.type !== 'vm') return
    
    const { connId, node, type, vmid } = parseVmId(selection.id)
    
    setUnlocking(true)
    try {
      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/unlock`,
        { method: 'POST' }
      )
      
      if (res.ok) {
        const json = await res.json()
        if (json.data?.unlocked) {
          setVmLock({ locked: false })
          // Rafraîchir les données
          if (onRefresh) {
            await onRefresh()
          }
        }
      } else {
        const err = await res.json().catch(() => ({}))
        setUnlockErrorDialog({
          open: true,
          error: err?.error || res.statusText,
          hint: err?.hint,
          lockType: err?.lockType
        })
      }
    } catch (e: any) {
      setUnlockErrorDialog({
        open: true,
        error: e.message || String(e)
      })
    } finally {
      setUnlocking(false)
    }
  }

  const onMigrate = () => {
    // Vérifier si la VM est dans un cluster
    if (selectedVmIsCluster) {
      setMigrateDialogOpen(true)
    } else {
      alert(t('common.notAvailable'))
    }
  }

  const onClone = () => setCloneDialogOpen(true)
  const onConvertTemplate = () => handleNotImplemented(t('templates.fromVm'))

  const onDelete = () => {
    // Vérifier que la VM est arrêtée
    const status = data?.vmRealStatus || data?.status

    if (status === 'running') {
      setConfirmAction({
        action: 'info',
        title: t('inventory.vmRunningWarning'),
        message: t('inventory.vmRunningWarning'),
        vmName: data?.title,
        onConfirm: async () => setConfirmAction(null)
      })
      
return
    }


    // Ouvrir le dialog de confirmation
    setDeleteVmConfirmText('')
    setDeleteVmPurge(true)
    setDeleteVmDialogOpen(true)
  }

  // Fonction de suppression effective de la VM
  const handleDeleteVm = async () => {
    if (!selection || selection.type !== 'vm') return
    
    const { connId, node, type, vmid } = parseVmId(selection.id)
    const vmName = data?.title || vmid
    const confirmTarget = `${vmid}` // On peut aussi utiliser le nom
    
    // Vérifier que le texte de confirmation correspond
    if (deleteVmConfirmText !== confirmTarget && deleteVmConfirmText !== vmName) {
      return // Le bouton sera disabled de toute façon
    }
    
    setDeletingVm(true)

    try {
      const params = new URLSearchParams()

      if (deleteVmPurge) {
        params.append('purge', '1')
        params.append('destroy-unreferenced-disks', '1')
      }
      
      const url = `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}?${params.toString()}`
      const res = await fetch(url, { method: 'DELETE' })
      
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))

        throw new Error(err?.error || `HTTP ${res.status}`)
      }
      
      setDeleteVmDialogOpen(false)
      
      // Retourner à la vue globale et rafraîchir
      onSelect?.(null as any) // Désélectionner
      
      // Afficher un message de succès
      setConfirmAction({
        action: 'info',
        title: t('common.success'),
        message: `${t('common.delete')} "${vmName}" ${t('common.success')}`,
        vmName: undefined,
        onConfirm: async () => {
          setConfirmAction(null)


          // Rafraîchir l'arbre après un court délai
          if (onRefresh) {
            await onRefresh()
          }
        }
      })
    } catch (e: any) {
      alert(`${t('errors.deleteError')}: ${e?.message || e}`)
    } finally {
      setDeletingVm(false)
    }
  }

  // Status de la VM pour les actions et la console
  const vmStatus = data?.vmRealStatus || data?.status
  const vmState = data?.vmRealStatus || data?.status
  const showConsole = selection?.type === 'vm'

  // Vérifier si la VM sélectionnée est sur un cluster (pour HA)
  const selectedVmIsCluster = useMemo(() => {
    if (!selection || selection.type !== 'vm') return false
    const { connId, node, type, vmid } = parseVmId(selection.id)

    const vm = allVms.find(v => 
      v.connId === connId && 
      v.node === node && 
      v.type === type && 
      v.vmid === vmid
    )

    
return vm?.isCluster ?? false
  }, [selection, allVms])

  return (
    <Box sx={{ p: selection && selection.type !== 'root' ? 2.5 : 0, width: '100%', height: '100%' }}>
      {progress}

      {error ? (
        <Alert severity="error" sx={{ mb: 2, mx: selection && selection.type !== 'root' ? 0 : 2 }}>
          Erreur: {error}
        </Alert>
      ) : null}

      {/* Quand sélection root et mode tree: afficher vue hiérarchique collapsable */}
      {selection?.type === 'root' && viewMode === 'tree' ? (
        <RootInventoryView
          allVms={allVms}
          hosts={hosts}
          pbsServers={pbsServers?.map(pbs => ({
            connId: pbs.connId,
            name: pbs.name,
            status: pbs.status,
            backupCount: pbs.stats?.backupCount || 0
          }))}
          onVmClick={handleVmClick}
          onVmAction={handleTableVmAction}
          onMigrate={handleTableMigrate}
          onNodeClick={handleNodeClick}
          onSelect={onSelect}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
          migratingVmIds={migratingVmIds}
          onLoadTrendsBatch={loadVmTrendsBatch}
          showIpSnap={showIpSnap}
          ipSnapLoading={ipSnapLoading}
          onLoadIpSnap={onLoadIpSnap}
        />
      ) : !selection || selection?.type === 'root' ? (
        viewMode === 'vms' && allVms.length > 0 ? (
          <Box sx={{ height: '100%' }}>
            <Card variant="outlined" sx={{ width: '100%', borderRadius: 0, height: '100%', border: 'none' }}>
              <CardContent sx={{ p: 0, '&:last-child': { pb: 0 }, height: '100%', display: 'flex', flexDirection: 'column' }}>
                <Box sx={{ 
                  px: 2, 
                  py: 1.5, 
                  borderBottom: '1px solid', 
                  borderColor: 'divider',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexShrink: 0
                }}>
                  <Typography fontWeight={900} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <i className="ri-computer-line" style={{ fontSize: 20, opacity: 0.7 }} />
                    {t('inventory.vms')} ({allVms.length})
                  </Typography>
                  <Stack direction="row" spacing={1}>
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={<i className="ri-add-line" />}
                      onClick={() => setCreateVmDialogOpen(true)}
                      sx={{ textTransform: 'none' }}
                    >
                      {t('common.create')} VM
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<i className="ri-add-line" />}
                      onClick={() => setCreateLxcDialogOpen(true)}
                      sx={{ textTransform: 'none' }}
                    >
                      {t('common.create')} LXC
                    </Button>
                  </Stack>
                </Box>
                <Box sx={{ flex: 1, minHeight: 0 }}>
                  <VmsTable
                    vms={allVms.map(vm => ({
                      id: `${vm.connId}:${vm.node}:${vm.type}:${vm.vmid}`,
                      connId: vm.connId,
                      node: vm.node,
                      vmid: vm.vmid,
                      name: vm.name,
                      type: vm.type,
                      status: vm.status || 'unknown',
                      cpu: vm.status === 'running' && vm.cpu !== undefined ? Math.min(100, vm.cpu * 100) : undefined,
                      ram: vm.status === 'running' && vm.mem !== undefined && vm.maxmem ? (vm.mem / vm.maxmem) * 100 : undefined,
                      maxmem: vm.maxmem,
                      maxdisk: vm.maxdisk,
                      uptime: vm.uptime,
                      ip: vm.ip,
                      snapshots: vm.snapshots,
                      tags: vm.tags,
                      template: vm.template,
                      hastate: vm.hastate,
                      hagroup: vm.hagroup,
                      isCluster: vm.isCluster,
                      osInfo: vm.osInfo,
                    }))}
                    expanded
                    showNode
                    showTrends
                    showActions
                    showIpSnap={showIpSnap}
                    ipSnapLoading={ipSnapLoading}
                    onLoadIpSnap={onLoadIpSnap}
                    onLoadTrendsBatch={loadVmTrendsBatch}
                    onVmClick={handleVmClick}
                    onVmAction={handleTableVmAction}
                    onMigrate={handleTableMigrate}
                    onNodeClick={handleNodeClick}
                    maxHeight="100%"
                    autoPageSize
                    showDensityToggle
                    highlightedId={highlightedVmId}
                    favorites={favorites}
                    onToggleFavorite={toggleFavorite}
                    migratingVmIds={migratingVmIds}
                  />
                </Box>
              </CardContent>
            </Card>
          </Box>
        ) : viewMode === 'hosts' && hosts.length > 0 ? (
          <GroupedVmsView
            title={t('inventory.nodes')}
            icon="ri-server-line"
            groups={hosts.map(h => ({
              key: h.key,
              label: h.node,
              sublabel: h.connName,
              vms: h.vms
            }))}
            allVms={allVms}
            onVmClick={handleVmClick}
            onVmAction={handleTableVmAction}
            onMigrate={handleTableMigrate}
            onLoadTrendsBatch={loadVmTrendsBatch}
            onSelect={onSelect}
            favorites={favorites}
            onToggleFavorite={toggleFavorite}
            migratingVmIds={migratingVmIds}
          />
        ) : viewMode === 'pools' && pools.length > 0 ? (
          <GroupedVmsView
            title="Par pool"
            icon="ri-folder-line"
            groups={pools.map(p => ({
              key: p.pool,
              label: p.pool,
              vms: p.vms
            }))}
            allVms={allVms}
            onVmClick={handleVmClick}
            onVmAction={handleTableVmAction}
            onMigrate={handleTableMigrate}
            onLoadTrendsBatch={loadVmTrendsBatch}
            onSelect={onSelect}
            favorites={favorites}
            onToggleFavorite={toggleFavorite}
            migratingVmIds={migratingVmIds}
          />
        ) : viewMode === 'tags' && tags.length > 0 ? (
          <GroupedVmsView
            title="Par tag"
            icon="ri-price-tag-3-line"
            groups={tags.map(t => ({
              key: t.tag,
              label: t.tag,
              color: tagColor(t.tag),
              vms: t.vms
            }))}
            allVms={allVms}
            onVmClick={handleVmClick}
            onVmAction={handleTableVmAction}
            onMigrate={handleTableMigrate}
            onLoadTrendsBatch={loadVmTrendsBatch}
            onSelect={onSelect}
            favorites={favorites}
            onToggleFavorite={toggleFavorite}
            migratingVmIds={migratingVmIds}
          />
        ) : viewMode === 'templates' ? (

          /* Mode Templates */
          <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Card variant="outlined" sx={{ flex: 1, display: 'flex', flexDirection: 'column', borderRadius: 2 }}>
              <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column', p: 0, '&:last-child': { pb: 0 } }}>
                {/* Header */}
                <Box sx={{ 
                  px: 2, 
                  py: 1.5, 
                  borderBottom: '1px solid', 
                  borderColor: 'divider',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 2
                }}>
                  <Stack direction="row" spacing={1.5} alignItems="center">
                    <i className="ri-file-copy-line" style={{ fontSize: 20, opacity: 0.7 }} />
                    <Typography variant="h6" fontWeight={700}>
                      Templates ({allVms.filter(vm => vm.template).length})
                    </Typography>
                  </Stack>
                </Box>
                <Box sx={{ flex: 1, minHeight: 0 }}>
                  <VmsTable
                    vms={allVms.filter(vm => vm.template).map(vm => ({
                      id: `${vm.connId}:${vm.node}:${vm.type}:${vm.vmid}`,
                      connId: vm.connId,
                      node: vm.node,
                      vmid: vm.vmid,
                      name: vm.name,
                      type: vm.type,
                      status: vm.status || 'unknown',
                      cpu: vm.status === 'running' && vm.cpu !== undefined ? Math.min(100, vm.cpu * 100) : undefined,
                      ram: vm.status === 'running' && vm.mem !== undefined && vm.maxmem ? (vm.mem / vm.maxmem) * 100 : undefined,
                      maxmem: vm.maxmem,
                      maxdisk: vm.maxdisk,
                      uptime: vm.uptime,
                      ip: vm.ip,
                      snapshots: vm.snapshots,
                      tags: vm.tags,
                      template: vm.template,
                      isCluster: vm.isCluster,
                      osInfo: vm.osInfo,
                    }))}
                    expanded
                    showNode
                    showActions
                    onVmAction={handleTableVmAction}
                    onNodeClick={handleNodeClick}
                    maxHeight="100%"
                    autoPageSize
                    showDensityToggle
                    favorites={favorites}
                    onToggleFavorite={toggleFavorite}
                    migratingVmIds={migratingVmIds}
                  />
                </Box>
              </CardContent>
            </Card>
          </Box>
        ) : (
          <Box 
            sx={{ 
              display: 'flex', 
              flexDirection: 'column', 
              alignItems: 'center', 
              justifyContent: 'center',
              height: '100%',
              minHeight: 'calc(100vh - 200px)',
              opacity: 0.35,
              gap: 2
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <svg 
                width={48} 
                height={37} 
                viewBox="0 0 220 170" 
                fill="none" 
                xmlns="http://www.w3.org/2000/svg"
              >
                <path 
                  d="M 174.30 158.91 C160.99,140.34 155.81,133.18 151.52,127.42 C149.04,124.08 147.00,120.78 147.00,120.10 C147.00,119.42 148.91,116.47 151.25,113.55 C153.59,110.63 157.44,105.71 159.81,102.62 C162.18,99.53 164.71,97.00 165.44,97.00 C166.58,97.00 182.93,119.09 200.79,144.77 C203.71,148.95 208.32,155.38 211.04,159.06 C213.77,162.74 216.00,166.03 216.00,166.37 C216.00,166.72 207.92,167.00 198.05,167.00 L 180.10 167.00 Z M 164.11 69.62 C161.87,67.24 159.22,63.61 151.44,52.29 L 147.85 47.07 L 153.79 39.29 C157.05,35.00 161.25,29.62 163.11,27.32 C164.98,25.02 169.65,19.08 173.50,14.11 L 180.50 5.08 L 199.25 5.04 C209.56,5.02 218.00,5.23 218.00,5.51 C218.00,5.79 214.51,10.42 210.25,15.81 C205.99,21.19 199.80,29.11 196.50,33.41 C193.20,37.71 189.15,42.92 187.50,44.98 C183.18,50.39 169.32,68.18 167.76,70.30 C166.52,72.01 166.33,71.98 164.11,69.62 Z" 
                  fill="#F29221"
                />
                <path 
                  d="M 0.03 164.75 C0.05,162.18 2.00,159.04 9.28,149.83 C19.92,136.37 45.56,103.43 54.84,91.32 L 61.17 83.05 L 58.87 79.77 C49.32,66.18 11.10,12.77 8.83,9.86 C7.28,7.85 6.00,5.94 6.00,5.61 C6.00,5.27 14.21,5.01 24.25,5.03 L 42.50 5.06 L 53.50 20.63 C59.55,29.20 65.44,37.40 66.58,38.85 C72.16,45.97 97.33,81.69 97.70,83.02 C98.13,84.59 95.40,88.27 63.50,129.06 C53.05,142.42 42.77,155.64 40.66,158.43 C32.84,168.76 34.77,168.00 16.33,168.00 L 0.00 168.00 L 0.03 164.75 Z M 55.56 167.09 C55.25,166.59 56.95,163.78 59.33,160.84 C61.71,157.90 66.10,152.33 69.08,148.46 C72.06,144.59 81.47,132.50 90.00,121.60 C98.53,110.69 106.38,100.58 107.46,99.13 C108.54,97.69 111.81,93.49 114.72,89.80 L 120.00 83.10 L 115.25 76.47 C112.64,72.82 109.82,68.83 109.00,67.61 C108.18,66.38 105.73,62.93 103.57,59.94 C101.41,56.95 96.88,50.67 93.51,46.00 C77.15,23.36 65.00,6.12 65.00,5.57 C65.00,5.23 73.21,5.08 83.24,5.23 L 101.49 5.50 L 124.77 38.00 C137.58,55.88 150.09,73.37 152.58,76.88 C155.08,80.39 156.91,83.79 156.66,84.44 C156.41,85.09 153.55,88.97 150.30,93.06 C147.06,97.15 137.93,108.82 130.02,119.00 C122.12,129.18 110.29,144.36 103.75,152.75 L 91.85 168.00 L 73.98 168.00 C64.16,168.00 55.87,167.59 55.56,167.09 Z" 
                  fill="currentColor"
                  opacity="0.5"
                />
              </svg>
              <Typography 
                variant="h4" 
                fontWeight={900} 
                sx={{ 
                  letterSpacing: -1,
                  color: 'text.secondary'
                }}
              >
                ProxCenter
              </Typography>
            </Box>
            <Typography 
              variant="body2" 
              sx={{ 
                color: 'text.secondary',
                textAlign: 'center',
                maxWidth: 300
              }}
            >
              {t('common.select')}
            </Typography>
          </Box>
        )
      ) : null}

      {selection && data ? (
        <Stack spacing={2} sx={{ width: '100%' }}>
          {/* Header title + tags (VM only) + ACTIONS TOP RIGHT */}
          {selection?.type === 'vm' ? (

            /* Format VM: #102 VM OK AGENCE State: running on : Proxmox-3AZ-1-A */
            (() => {
              const { connId, node, type, vmid } = parseVmId(selection.id)

              const stateColor = vmState?.toLowerCase().includes('running') ? '#2e7d32' : 
                               vmState?.toLowerCase().includes('stopped') ? '#6b7280' : undefined
              
              return (
                <>
                  <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'center', flexWrap: 'wrap' }}>
                    {/* Bouton retour */}
                    {onBack && (
                      <IconButton 
                        onClick={onBack}
                        size="small"
                        sx={{ 
                          mr: 0.5,
                          bgcolor: 'action.hover',
                          '&:hover': { bgcolor: 'action.selected' }
                        }}
                      >
                        <i className="ri-arrow-left-line" style={{ fontSize: 18 }} />
                      </IconButton>
                    )}
                    
                    {/* #VMID */}
                    <Typography variant="body2" sx={{ fontWeight: 700, opacity: 0.6 }}>
                      #{vmid}
                    </Typography>
                    
                    {/* Type (VM/LXC) */}
                    <Chip 
                      size="small" 
                      label={data.kindLabel} 
                      variant="filled"
                      icon={
                        data.vmType === 'lxc' ? (
                          <i className="ri-instance-fill" style={{ fontSize: 14, marginLeft: 8 }} />
                        ) : (
                          <i className="ri-computer-fill" style={{ fontSize: 14, marginLeft: 8 }} />
                        )
                      }
                    />
                    
                    {/* Status OK/WARN/etc */}
                    <StatusChip status={data.status} />

                    {/* Nom de la VM */}
                    <Typography variant="h6" fontWeight={900}>
                      {data.title}
                    </Typography>

                    {/* State: running */}
                    {vmState && (
                      <Chip
                        size="small"
                        label={`State: ${vmState}`}
                        variant="outlined"
                        sx={{
                          height: 24,
                          borderColor: stateColor || 'divider',
                          color: stateColor || 'text.secondary',
                          bgcolor: stateColor ? `${stateColor}14` : 'transparent',
                          fontWeight: 600,
                        }}
                      />
                    )}

                    {/* on : Node-Name (cliquable) */}
                    <Typography variant="body2" sx={{ color: 'text.secondary', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      on :
                      <Typography
                        component="span"
                        sx={{
                          color: 'primary.main',
                          cursor: 'pointer',
                          fontWeight: 600,
                          '&:hover': { textDecoration: 'underline' }
                        }}
                        onClick={() => {
                          onViewModeChange?.('hosts')
                          onSelect?.({ type: 'node', id: `${connId}:${node}` })
                        }}
                      >
                        {node}
                      </Typography>
                    </Typography>

                    {/* Tags */}
                    <TagManager
                      tags={localTags}
                      connId={connId}
                      node={node}
                      type={type}
                      vmid={vmid}
                      onTagsChange={setLocalTags}
                    />

                    {/* Actions en haut à droite */}
                    <VmActions
                      disabled={actionBusy || unlocking}
                      vmStatus={vmStatus}
                      isCluster={data.isCluster}
                      isLocked={vmLock.locked}
                      lockType={vmLock.lockType}
                      onStart={onStart}
                      onShutdown={onShutdown}
                      onStop={onStop}
                      onPause={onPause}
                      onMigrate={onMigrate}
                      onClone={onClone}
                      onConvertTemplate={onConvertTemplate}
                      onDelete={onDelete}
                      onUnlock={onUnlock}
                    />
                  </Box>
                </>
              )
            })()
          ) : (

            /* Format non-VM (Host, Cluster, Storage) */
            <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'center', flexWrap: 'wrap' }}>
              {/* Bouton retour */}
              {onBack && (
                <IconButton 
                  onClick={onBack}
                  size="small"
                  sx={{ 
                    mr: 0.5,
                    bgcolor: 'action.hover',
                    '&:hover': { bgcolor: 'action.selected' }
                  }}
                >
                  <i className="ri-arrow-left-line" style={{ fontSize: 18 }} />
                </IconButton>
              )}
              
              <Chip 
                size="small" 
                label={data.kindLabel} 
                variant="filled"
                icon={
                  data.kindLabel === 'HOST' ? (
                    <i className="ri-server-fill" style={{ fontSize: 14, marginLeft: 8 }} />
                  ) : data.kindLabel === 'CLUSTER' ? (
                    <i className="ri-cloud-fill" style={{ fontSize: 14, marginLeft: 8 }} />
                  ) : undefined
                }
              />
              <StatusChip status={data.status} />

              <Typography variant="h6" fontWeight={900}>
                {data.title}
              </Typography>

              {/* Warning Ceph */}
              {data.cephHealth && data.cephHealth !== 'HEALTH_OK' && (
                <MuiTooltip title={`Ceph: ${data.cephHealth === 'HEALTH_WARN' ? t('common.warning') : t('common.error')}`}>
                  <Box 
                    component="span" 
                    sx={{ 
                      display: 'flex', 
                      alignItems: 'center',
                      px: 1,
                      py: 0.5,
                      borderRadius: 1,
                      bgcolor: data.cephHealth === 'HEALTH_ERR' ? 'error.main' : 'warning.main',
                      color: 'white',
                      gap: 0.5,
                    }}
                  >
                    <i 
                      className={data.cephHealth === 'HEALTH_ERR' ? 'ri-close-circle-fill' : 'ri-alert-fill'} 
                      style={{ fontSize: 14 }} 
                    />
                    <Typography variant="caption" fontWeight={600}>
                      Ceph
                    </Typography>
                  </Box>
                </MuiTooltip>
              )}

              {/* Uptime en haut à droite (HOST uniquement) */}
              {data.hostInfo?.uptime ? (
                <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <i className="ri-time-line" style={{ fontSize: 14, color: primaryColor }} />
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    Uptime: {formatUptime(data.hostInfo.uptime)}
                  </Typography>
                </Box>
              ) : null}
            </Box>
          )}

          <Divider />

          <VCenterSummary
            kindLabel={data.kindLabel}
            status={data.status}
            subtitle={data.subtitle}
            metrics={data.metrics}
            vmState={vmState}
            showConsole={showConsole}
            hostInfo={data.hostInfo}
            kpis={data.kpis}
            vmInfo={selection?.type === 'vm' ? parseVmId(selection.id) : null}
            guestInfo={guestInfo}
            guestInfoLoading={guestInfoLoading}
            clusterPveVersion={selection?.type === 'cluster' ? clusterPveVersion : undefined}
            connId={selection?.type === 'node' ? parseNodeId(selection.id).connId : undefined}
            nodeName={selection?.type === 'node' ? parseNodeId(selection.id).node : undefined}
            onRefreshSubscription={async () => {
              if (selection) {
                const payload = await fetchDetails(selection)
                setData(payload)
              }
            }}
            cephHealth={data.cephHealth}
            nodesOnline={data.nodesData?.filter(n => n.status === 'online').length}
            nodesTotal={data.nodesData?.length}
          />

          {/* Onglets pour VMs: Résumé / Matériel / Options / Historique / Sauvegardes / Snapshots / Notes / HA */}
          {selection?.type === 'vm' && (
            <>
              <Tabs
                value={detailTab}
                onChange={(_e, v) => setDetailTab(v)}
                sx={{ borderBottom: 1, borderColor: 'divider' }}
                variant="scrollable"
                scrollButtons="auto"
              >
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-dashboard-line" style={{ fontSize: 16 }} />
                      {t('inventory.tabs.summary')}
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-cpu-line" style={{ fontSize: 16 }} />
                      {t('inventory.tabs.hardware')}
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-settings-3-line" style={{ fontSize: 16 }} />
                      Options
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-history-line" style={{ fontSize: 16 }} />
                      {t('inventory.tabs.history')}
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-hard-drive-2-line" style={{ fontSize: 16 }} />
                      {t('inventory.tabs.backups')}
                      {backupsStats?.total > 0 && (
                        <Chip size="small" label={backupsStats.total} sx={{ height: 18, fontSize: 11, ml: 0.5 }} />
                      )}
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-camera-line" style={{ fontSize: 16 }} />
                      Snapshots
                      {snapshots.length > 0 && (
                        <Chip size="small" label={snapshots.length} sx={{ height: 18, fontSize: 11, ml: 0.5 }} />
                      )}
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-sticky-note-line" style={{ fontSize: 16 }} />
                      Notes
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-repeat-line" style={{ fontSize: 16 }} />
                      {t('replication.title')}
                      {replicationJobs.length > 0 && (
                        <Chip size="small" label={replicationJobs.length} sx={{ height: 18, fontSize: 11, ml: 0.5 }} />
                      )}
                    </Box>
                  }
                />
                {selectedVmIsCluster && (
                  <Tab
                    label={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <i className="ri-shield-check-line" style={{ fontSize: 16 }} />
                        HA
                      </Box>
                    }
                  />
                )}
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-shield-keyhole-line" style={{ fontSize: 16 }} />
                      Firewall
                    </Box>
                  }
                />
              </Tabs>

              {/* ==================== ONGLET 0 - RÉSUMÉ ==================== */}
              {detailTab === 0 && (
                <Box sx={{ py: 2 }}>
                  {/* Graphiques de performances (RRD) - dans le résumé */}
                  {canShowRrd && (
                    <Card variant="outlined" sx={{ width: '100%', borderRadius: 2 }}>
                      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
                          <Typography fontWeight={700} fontSize={14}>
                            <i className="ri-line-chart-line" style={{ fontSize: 16, marginRight: 6 }} />
                            {t('inventory.performances')}
                          </Typography>
                          <Box sx={{ display: 'flex', gap: 0.5 }}>
                            {[
                              { label: '1h', value: 'hour' as RrdTimeframe },
                              { label: '24h', value: 'day' as RrdTimeframe },
                              { label: '7j', value: 'week' as RrdTimeframe },
                              { label: '30j', value: 'month' as RrdTimeframe },
                              { label: '1an', value: 'year' as RrdTimeframe },
                            ].map(opt => (
                              <Chip
                                key={opt.value}
                                label={opt.label}
                                size="small"
                                onClick={() => setTf(opt.value)}
                                sx={{
                                  height: 24,
                                  fontSize: 11,
                                  fontWeight: 600,
                                  bgcolor: tf === opt.value ? 'primary.main' : 'action.hover',
                                  color: tf === opt.value ? 'primary.contrastText' : 'text.secondary',
                                  '&:hover': { bgcolor: tf === opt.value ? 'primary.dark' : 'action.selected' },
                                  cursor: 'pointer',
                                }}
                              />
                            ))}
                          </Box>
                        </Box>

                        {rrdLoading ? <LinearProgress sx={{ mb: 2 }} /> : null}
                        {rrdError ? (
                          <Alert severity="warning" sx={{ mb: 2 }}>
                            RRD: {rrdError}
                          </Alert>
                        ) : null}

                        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
                          {/* CPU Usage */}
                          <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                            <Typography variant="caption" fontWeight={600} sx={{ mb: 1, display: 'block' }}>
                              CPU Usage
                            </Typography>
                            <Box sx={{ height: 160 }}>
                              <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={series}>
                                  <XAxis dataKey="t" tickFormatter={v => formatTime(Number(v))} minTickGap={40} tick={{ fontSize: 9 }} />
                                  <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 9 }} width={30} />
                                  <Tooltip
                                    labelFormatter={v => new Date(Number(v)).toLocaleString()}
                                    formatter={(v: any) => [`${Number(v).toFixed(1)}%`, 'CPU']}
                                  />
                                  <Area type="monotone" dataKey="cpuPct" stroke={primaryColor} fill={primaryColor} fillOpacity={0.4} strokeWidth={1.5} isAnimationActive={false} />
                                </AreaChart>
                              </ResponsiveContainer>
                            </Box>
                          </Box>

                          {/* Memory Usage */}
                          <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                            <Typography variant="caption" fontWeight={600} sx={{ mb: 1, display: 'block' }}>
                              Memory Usage
                            </Typography>
                            <Box sx={{ height: 160 }}>
                              <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={series}>
                                  <XAxis dataKey="t" tickFormatter={v => formatTime(Number(v))} minTickGap={40} tick={{ fontSize: 9 }} />
                                  <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 9 }} width={30} />
                                  <Tooltip
                                    labelFormatter={v => new Date(Number(v)).toLocaleString()}
                                    formatter={(v: any) => [`${Number(v).toFixed(1)}%`, 'Memory']}
                                  />
                                  <Area type="monotone" dataKey="ramPct" stroke={primaryColor} fill={primaryColor} fillOpacity={0.4} strokeWidth={1.5} isAnimationActive={false} />
                                </AreaChart>
                              </ResponsiveContainer>
                            </Box>
                          </Box>

                          {/* Network Traffic */}
                          <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                            <Typography variant="caption" fontWeight={600} sx={{ mb: 1, display: 'block' }}>
                              {t('inventoryPage.networkTraffic')}
                            </Typography>
                            <Box sx={{ height: 160 }}>
                              <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={series}>
                                  <XAxis dataKey="t" tickFormatter={v => formatTime(Number(v))} minTickGap={40} tick={{ fontSize: 9 }} />
                                  <YAxis tickFormatter={v => formatBps(Number(v))} tick={{ fontSize: 9 }} width={50} domain={[0, 'auto']} />
                                  <Tooltip
                                    labelFormatter={v => new Date(Number(v)).toLocaleString()}
                                    formatter={(v: any, name: string) => [formatBps(Number(v)), name === 'netInBps' ? 'In' : 'Out']}
                                  />
                                  <Area type="monotone" dataKey="netInBps" stroke={primaryColor} fill={primaryColor} fillOpacity={0.4} strokeWidth={1.5} isAnimationActive={false} name="netInBps" connectNulls />
                                  <Area type="monotone" dataKey="netOutBps" stroke={primaryColorLight} fill={primaryColorLight} fillOpacity={0.4} strokeWidth={1.5} isAnimationActive={false} name="netOutBps" connectNulls />
                                </AreaChart>
                              </ResponsiveContainer>
                            </Box>
                          </Box>

                          {/* Disk I/O (VMs) */}
                          <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                            <Typography variant="caption" fontWeight={600} sx={{ mb: 1, display: 'block' }}>
                              Disk I/O
                            </Typography>
                            <Box sx={{ height: 160 }}>
                              <ResponsiveContainer width="100%" height="100%">
                                {(
                                  <AreaChart data={series}>
                                    <XAxis dataKey="t" tickFormatter={v => formatTime(Number(v))} minTickGap={40} tick={{ fontSize: 9 }} />
                                    <YAxis tickFormatter={v => formatBps(Number(v))} tick={{ fontSize: 9 }} width={50} domain={[0, 'auto']} />
                                    <Tooltip
                                      labelFormatter={v => new Date(Number(v)).toLocaleString()}
                                      formatter={(v: any, name: string) => [formatBps(Number(v)), name === 'diskReadBps' ? 'Read' : 'Write']}
                                    />
                                    <Area type="monotone" dataKey="diskReadBps" stroke={primaryColor} fill={primaryColor} fillOpacity={0.4} strokeWidth={1.5} isAnimationActive={false} name="diskReadBps" connectNulls />
                                    <Area type="monotone" dataKey="diskWriteBps" stroke={primaryColorLight} fill={primaryColorLight} fillOpacity={0.4} strokeWidth={1.5} isAnimationActive={false} name="diskWriteBps" connectNulls />
                                  </AreaChart>
                                )}
                              </ResponsiveContainer>
                            </Box>
                          </Box>
                        </Box>
                      </CardContent>
                    </Card>
                  )}
                </Box>
              )}

              {/* ==================== ONGLET 1 - MATÉRIEL ==================== */}
              {detailTab === 1 && (
                <Box sx={{ py: 2 }}>
                  {loading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                      <CircularProgress />
                    </Box>
                  ) : (
                    <Stack spacing={2}>
                      {/* Ligne 1: CPU et RAM côte à côte */}
                      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 2 }}>
                        {/* CPU */}
                        <Card variant="outlined" sx={{ borderRadius: 2 }}>
                          <CardContent>
                            <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                              <i className="ri-cpu-line" style={{ fontSize: 20 }} />
                              Processeur (CPU)
                            </Typography>
                          
                          {/* Avertissement si config CPU en attente de reboot */}
                          {data?.cpuInfo?.pending && (
                            <Alert 
                              severity="warning" 
                              sx={{ mb: 2 }}
                              icon={<i className="ri-restart-line" style={{ fontSize: 20 }} />}
                            >
                              <Typography variant="body2" fontWeight={600}>
                                {t('inventory.pendingRestart')}
                              </Typography>
                              <Typography variant="body2" sx={{ mt: 0.5, opacity: 0.9 }}>
                                {data.cpuInfo.pending.sockets !== undefined && `Sockets: ${data.cpuInfo.sockets} → ${data.cpuInfo.pending.sockets}`}
                                {data.cpuInfo.pending.sockets !== undefined && data.cpuInfo.pending.cores !== undefined && ' • '}
                                {data.cpuInfo.pending.cores !== undefined && `Cores: ${data.cpuInfo.cores} → ${data.cpuInfo.pending.cores}`}
                                {(data.cpuInfo.pending.sockets !== undefined || data.cpuInfo.pending.cores !== undefined) && data.cpuInfo.pending.cpu !== undefined && ' • '}
                                {data.cpuInfo.pending.cpu !== undefined && `Type: ${data.cpuInfo.pending.cpu}`}
                              </Typography>
                            </Alert>
                          )}
                          
                          {/* Sockets Slider */}
                          <Box sx={{ mb: 3 }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                              <Typography variant="body2" fontWeight={600}>Sockets</Typography>
                              <TextField
                                size="small"
                                type="number"
                                value={cpuSockets}
                                onChange={(e) => setCpuSockets(Number(e.target.value))}
                                sx={{ width: 100 }}
                                inputProps={{ min: 1, max: 4 }}
                              />
                            </Box>
                            <Slider
                              value={cpuSockets}
                              onChange={(_, val) => setCpuSockets(val as number)}
                              min={1}
                              max={4}
                              step={1}
                              marks={[
                                { value: 1, label: '1' },
                                { value: 2, label: '2' },
                                { value: 3, label: '3' },
                                { value: 4, label: '4' },
                              ]}
                              valueLabelDisplay="auto"
                            />
                          </Box>

                          {/* Cores Slider */}
                          <Box sx={{ mb: 3 }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                              <Typography variant="body2" fontWeight={600}>Cores par socket</Typography>
                              <TextField
                                size="small"
                                type="number"
                                value={cpuCores}
                                onChange={(e) => setCpuCores(Math.max(1, Number(e.target.value)))}
                                sx={{ width: 100 }}
                                inputProps={{ min: 1 }}
                              />
                            </Box>
                            {(() => {
                              const hostCores = data.nodeCapacity?.maxCpu || 32
                              const sliderMax = Math.min(hostCores, 64) // Limiter à 64 pour le slider
                              const marks = [
                                { value: 1, label: '1' },
                                ...(sliderMax >= 8 ? [{ value: Math.floor(sliderMax / 4), label: String(Math.floor(sliderMax / 4)) }] : []),
                                ...(sliderMax >= 16 ? [{ value: Math.floor(sliderMax / 2), label: String(Math.floor(sliderMax / 2)) }] : []),
                                { value: sliderMax, label: String(sliderMax) },
                              ]
                              return (
                                <Slider
                                  value={Math.min(cpuCores, sliderMax)}
                                  onChange={(_, val) => setCpuCores(val as number)}
                                  min={1}
                                  max={sliderMax}
                                  step={1}
                                  marks={marks}
                                  valueLabelDisplay="auto"
                                />
                              )
                            })()}
                          </Box>

                          {/* CPU Type */}
                          <FormControl fullWidth sx={{ mb: 3 }}>
                            <InputLabel>Type CPU</InputLabel>
                            <Select
                              value={cpuType}
                              label="Type CPU"
                              onChange={(e) => setCpuType(e.target.value)}
                            >
                              <MenuItem value="host">host ({t('inventory.performances')} maximales)</MenuItem>
                              <MenuItem value="kvm64">kvm64 (Compatible)</MenuItem>
                              <MenuItem value="qemu64">qemu64 (Émulation)</MenuItem>
                              <MenuItem value="Broadwell">Intel Broadwell</MenuItem>
                              <MenuItem value="Haswell">Intel Haswell</MenuItem>
                              <MenuItem value="IvyBridge">Intel IvyBridge</MenuItem>
                              <MenuItem value="SandyBridge">Intel SandyBridge</MenuItem>
                              <MenuItem value="Skylake-Client">Intel Skylake</MenuItem>
                              <MenuItem value="EPYC">AMD EPYC</MenuItem>
                              <MenuItem value="Opteron_G5">AMD Opteron G5</MenuItem>
                            </Select>
                          </FormControl>

                          {/* CPU Limit (optionnel) */}
                          <Box sx={{ mb: 2 }}>
                            <FormControlLabel
                              control={
                                <Switch
                                  checked={cpuLimitEnabled}
                                  onChange={(e) => setCpuLimitEnabled(e.target.checked)}
                                />
                              }
                              label="Limiter l'utilisation CPU"
                            />
                            {cpuLimitEnabled && (
                              <Box sx={{ mt: 2 }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                  <Typography variant="body2" fontWeight={600}>Limite CPU</Typography>
                                  <TextField
                                    size="small"
                                    type="number"
                                    value={cpuLimit}
                                    onChange={(e) => setCpuLimit(Number(e.target.value))}
                                    sx={{ width: 100 }}
                                    inputProps={{ min: 0, max: 128, step: 0.5 }}
                                  />
                                </Box>
                                <Slider
                                  value={cpuLimit}
                                  onChange={(_, val) => setCpuLimit(val as number)}
                                  min={0}
                                  max={128}
                                  step={0.5}
                                  valueLabelDisplay="auto"
                                />
                                <Typography variant="caption" color="text.secondary">
                                  0 = Pas de limite. Valeur max : {cpuSockets * cpuCores}
                                </Typography>
                              </Box>
                            )}
                          </Box>

                          {/* Résumé */}
                          <Box sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 1, mb: 2 }}>
                            <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
                              Total : {cpuSockets * cpuCores} vCPUs
                            </Typography>
                            <Typography variant="caption" sx={{ opacity: 0.7 }}>
                              {cpuSockets} socket(s) × {cpuCores} core(s)
                            </Typography>
                          </Box>

                          {/* Bouton Sauvegarder */}
                          <Button
                            variant="contained"
                            fullWidth
                            disabled={savingCpu || !cpuModified}
                            onClick={saveCpuConfig}
                            startIcon={savingCpu ? <CircularProgress size={16} /> : <SaveIcon />}
                          >
                            {savingCpu ? t('common.saving') : t('inventory.saveCpuChanges')}
                          </Button>
                        </CardContent>
                      </Card>

                        {/* Mémoire */}
                        <Card variant="outlined" sx={{ borderRadius: 2 }}>
                          <CardContent>
                            <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                              <i className="ri-database-2-line" style={{ fontSize: 20 }} />
                              {t('inventory.memory')}
                            </Typography>
                          
                          {/* Avertissement si config RAM en attente de reboot */}
                          {data?.memoryInfo?.pending && (
                            <Alert 
                              severity="warning" 
                              sx={{ mb: 2 }}
                              icon={<i className="ri-restart-line" style={{ fontSize: 20 }} />}
                            >
                              <Typography variant="body2" fontWeight={600}>
                                {t('inventory.pendingRestart')}
                              </Typography>
                              <Typography variant="body2" sx={{ mt: 0.5, opacity: 0.9 }}>
                                {data.memoryInfo.pending.memory !== undefined && `${t('inventoryPage.memoryLabel')} ${(data.memoryInfo.memory / 1024).toFixed(0)} GB → ${(data.memoryInfo.pending.memory / 1024).toFixed(0)} GB`}
                                {data.memoryInfo.pending.memory !== undefined && data.memoryInfo.pending.balloon !== undefined && ' • '}
                                {data.memoryInfo.pending.balloon !== undefined && `Balloon: ${((data.memoryInfo.balloon || 0) / 1024).toFixed(0)} GB → ${(data.memoryInfo.pending.balloon / 1024).toFixed(0)} GB`}
                              </Typography>
                            </Alert>
                          )}
                          
                          {/* RAM Slider */}
                          <Box sx={{ mb: 3 }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                              <Typography variant="body2" fontWeight={600}>{t('inventoryPage.memory')}</Typography>
                              <TextField
                                size="small"
                                type="number"
                                value={(memory / 1024).toFixed(0)}
                                onChange={(e) => setMemory(Math.max(512, Number(e.target.value) * 1024))}
                                InputProps={{
                                  endAdornment: <InputAdornment position="end">GB</InputAdornment>,
                                }}
                                sx={{ width: 120 }}
                                inputProps={{ min: 0.5 }}
                              />
                            </Box>
                            {(() => {
                              const hostMemGb = Math.floor((data.nodeCapacity?.maxMem || 64 * 1024 * 1024 * 1024) / (1024 * 1024 * 1024))
                              const sliderMax = Math.min(hostMemGb, 128) // Limiter à 128 GB pour le slider
                              const step = sliderMax > 32 ? 2 : 1
                              const marks = [
                                { value: 1, label: '1 GB' },
                                ...(sliderMax >= 16 ? [{ value: Math.floor(sliderMax / 4), label: `${Math.floor(sliderMax / 4)} GB` }] : []),
                                ...(sliderMax >= 32 ? [{ value: Math.floor(sliderMax / 2), label: `${Math.floor(sliderMax / 2)} GB` }] : []),
                                { value: sliderMax, label: `${sliderMax} GB` },
                              ]
                              return (
                                <Slider
                                  value={Math.min(memory / 1024, sliderMax)}
                                  onChange={(_, val) => setMemory((val as number) * 1024)}
                                  min={1}
                                  max={sliderMax}
                                  step={step}
                                  marks={marks}
                                  valueLabelDisplay="auto"
                                  valueLabelFormat={(v) => `${v} GB`}
                                />
                              )
                            })()}
                          </Box>

                          {/* Ballooning */}
                          <Box sx={{ mb: 3 }}>
                            <FormControlLabel
                              control={
                                <Switch
                                  checked={balloonEnabled}
                                  onChange={(e) => setBalloonEnabled(e.target.checked)}
                                />
                              }
                              label={t('inventory.enableBallooning')}
                            />
                            {balloonEnabled && (
                              <Box sx={{ mt: 2 }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                  <Typography variant="body2" fontWeight={600}>{t('inventory.minMemoryBalloon')}</Typography>
                                  <TextField
                                    size="small"
                                    type="number"
                                    value={(balloon / 1024).toFixed(0)}
                                    onChange={(e) => setBalloon(Number(e.target.value) * 1024)}
                                    InputProps={{
                                      endAdornment: <InputAdornment position="end">GB</InputAdornment>,
                                    }}
                                    sx={{ width: 120 }}
                                    inputProps={{ min: 0, max: memory / 1024 }}
                                  />
                                </Box>
                                <Slider
                                  value={balloon / 1024}
                                  onChange={(_, val) => setBalloon((val as number) * 1024)}
                                  min={0}
                                  max={memory / 1024}
                                  step={1}
                                  valueLabelDisplay="auto"
                                  valueLabelFormat={(v) => `${v} GB`}
                                />
                                <Typography variant="caption" color="text.secondary">
                                  {t('inventory.balloonMinHint')}
                                </Typography>
                              </Box>
                            )}
                          </Box>

                          <Alert severity="info" sx={{ mb: 2 }}>
                            <Typography variant="caption">
                              {t('inventory.balloonInfo')}
                            </Typography>
                          </Alert>

                          {/* Bouton Sauvegarder */}
                          <Button
                            variant="contained"
                            fullWidth
                            disabled={savingMemory || !memoryModified}
                            onClick={saveMemoryConfig}
                            startIcon={savingMemory ? <CircularProgress size={16} /> : <SaveIcon />}
                          >
                            {savingMemory ? t('common.saving') : t('inventory.saveMemoryChanges')}
                          </Button>
                        </CardContent>
                      </Card>
                      </Box>

                      {/* Ligne 2: Disques et Réseau côte à côte */}
                      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 2 }}>
                        {/* Disques */}
                        <Card variant="outlined" sx={{ borderRadius: 2 }}>
                          <CardContent>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                              <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <i className="ri-hard-drive-line" style={{ fontSize: 20 }} />
                                Disques ({data.disksInfo?.length || 0})
                              </Typography>
                              <Stack direction="row" spacing={1}>
                                {data.optionsInfo?.scsihw && (
                                  <MuiTooltip title={t('inventory.editScsiController')}>
                                    <Button
                                      size="small"
                                      variant="outlined"
                                    onClick={() => setEditScsiControllerDialogOpen(true)}
                                    startIcon={<i className="ri-settings-3-line" />}
                                  >
                                    {data.optionsInfo.scsihw}
                                  </Button>
                                </MuiTooltip>
                              )}
                              <Button
                                size="small"
                                variant="contained"
                                startIcon={<AddIcon />}
                                onClick={() => setAddDiskDialogOpen(true)}
                              >
                                {t('common.add')}
                              </Button>
                            </Stack>
                          </Box>
                          {data.disksInfo && data.disksInfo.length > 0 ? (
                            <List dense>
                              {data.disksInfo.map((disk: any, idx: number) => (
                                <ListItemButton
                                  key={idx}
                                  sx={{
                                    bgcolor: 'action.hover',
                                    borderRadius: 1,
                                    mb: 1,
                                    '&:last-child': { mb: 0 }
                                  }}
                                  onClick={() => {
                                    setSelectedDisk(disk)
                                    setEditDiskDialogOpen(true)
                                  }}
                                >
                                  <ListItemIcon sx={{ minWidth: 40 }}>
                                    <i className="ri-hard-drive-2-fill" style={{ fontSize: 24, opacity: 0.7 }} />
                                  </ListItemIcon>
                                  <ListItemText
                                    primary={
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Typography variant="body2" fontWeight={600}>
                                          {disk.id}
                                        </Typography>
                                        <Chip label={disk.size} size="small" sx={{ height: 20, fontSize: 11 }} />
                                      </Box>
                                    }
                                    secondary={
                                      <Typography variant="caption" sx={{ opacity: 0.7 }}>
                                        {disk.storage} • {disk.format || 'raw'}
                                        {disk.cache && ` • Cache: ${disk.cache}`}
                                        {disk.iothread && ' • IOThread'}
                                      </Typography>
                                    }
                                  />
                                  <i className="ri-pencil-line" style={{ fontSize: 16, opacity: 0.5 }} />
                                </ListItemButton>
                              ))}
                            </List>
                          ) : (
                            <Alert severity="info">{t('common.noData')}</Alert>
                          )}
                        </CardContent>
                        </Card>

                        {/* Interfaces réseau */}
                        <Card variant="outlined" sx={{ borderRadius: 2 }}>
                          <CardContent>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                              <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <i className="ri-network-line" style={{ fontSize: 20 }} />
                                {t('inventory.tabs.network')} ({data.networkInfo?.length || 0})
                              </Typography>
                              <Button
                                size="small"
                                variant="contained"
                                startIcon={<AddIcon />}
                                onClick={() => setAddNetworkDialogOpen(true)}
                              >
                                {t('common.add')}
                              </Button>
                            </Box>
                            {data.networkInfo && data.networkInfo.length > 0 ? (
                              <List dense>
                                {data.networkInfo.map((net: any, idx: number) => (
                                  <ListItemButton
                                    key={idx}
                                    sx={{
                                      bgcolor: 'action.hover',
                                      borderRadius: 1,
                                      mb: 1,
                                      '&:last-child': { mb: 0 }
                                    }}
                                    onClick={() => {
                                      setSelectedNetwork({
                                        id: net.id,
                                        model: net.model,
                                        bridge: net.bridge,
                                        mac: net.macaddr,
                                        vlan: net.tag,
                                        firewall: net.firewall,
                                        linkDown: net.linkDown,
                                        rate: net.rate,
                                        mtu: net.mtu,
                                      queues: net.queues
                                    })
                                    setEditNetworkDialogOpen(true)
                                  }}
                                >
                                  <ListItemIcon sx={{ minWidth: 40 }}>
                                    <i className="ri-ethernet-fill" style={{ fontSize: 24, opacity: 0.7 }} />
                                  </ListItemIcon>
                                  <ListItemText
                                    primary={
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Typography variant="body2" fontWeight={600}>
                                          {net.id}
                                        </Typography>
                                        <Chip label={net.model} size="small" sx={{ height: 20, fontSize: 11 }} />
                                        {net.firewall && (
                                          <Chip
                                            icon={<i className="ri-shield-check-line" style={{ fontSize: 12 }} />}
                                            label="Firewall"
                                            size="small"
                                            color="success"
                                            sx={{ height: 20, fontSize: 11 }}
                                          />
                                        )}
                                      </Box>
                                    }
                                    secondary={
                                      <Typography variant="caption" sx={{ opacity: 0.7 }}>
                                        Bridge: {net.bridge}
                                        {net.tag && ` • VLAN: ${net.tag}`}
                                        {net.rate && ` • Limit: ${net.rate} MB/s`}
                                        {net.macaddr && (
                                          <>
                                            <br />
                                            MAC: {net.macaddr}
                                          </>
                                        )}
                                      </Typography>
                                    }
                                  />
                                  <i className="ri-pencil-line" style={{ fontSize: 16, opacity: 0.5 }} />
                                </ListItemButton>
                              ))}
                            </List>
                          ) : (
                            <Alert severity="info">{t('common.noData')}</Alert>
                          )}
                        </CardContent>
                      </Card>
                      </Box>
                    </Stack>
                  )}
                </Box>
              )}

              {/* ==================== ONGLET 2 - OPTIONS ==================== */}
              {detailTab === 2 && (
                <Box sx={{ py: 2 }}>
                  {loading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                      <CircularProgress />
                    </Box>
                  ) : (
                    <Card variant="outlined" sx={{ borderRadius: 2 }}>
                      <CardContent sx={{ p: 0 }}>
                        <Box sx={{ overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                              <tr style={{ backgroundColor: 'rgba(0,0,0,0.04)' }}>
                                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, borderBottom: '1px solid rgba(0,0,0,0.2)', width: '30%' }}>Option</th>
                                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, borderBottom: '1px solid rgba(0,0,0,0.2)' }}>Valeur</th>
                                <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 600, borderBottom: '1px solid rgba(0,0,0,0.2)', width: '60px' }}>Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontWeight: 500 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <i className="ri-file-text-line" style={{ fontSize: 16, opacity: 0.6 }} />
                                    Nom
                                  </Box>
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)' }}>{data.name || data.title || 'N/A'}</td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', textAlign: 'center' }}>
                                  <MuiTooltip title="Éditer">
                                    <IconButton size="small" onClick={() => setEditOptionDialog({ key: 'name', label: 'Nom', value: data.name || '', type: 'text' })}>
                                      <i className="ri-pencil-line" style={{ fontSize: 16 }} />
                                    </IconButton>
                                  </MuiTooltip>
                                </td>
                              </tr>
                              <tr>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontWeight: 500 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <i className="ri-sticky-note-line" style={{ fontSize: 16, opacity: 0.6 }} />
                                    Description
                                  </Box>
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', opacity: data.description ? 1 : 0.5, fontStyle: data.description ? 'normal' : 'italic' }}>
                                  {data.description || t('common.noData')}
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', textAlign: 'center' }}>
                                  <MuiTooltip title="Éditer">
                                    <IconButton size="small" onClick={() => setEditOptionDialog({ key: 'description', label: 'Description', value: data.description || '', type: 'text' })}>
                                      <i className="ri-pencil-line" style={{ fontSize: 16 }} />
                                    </IconButton>
                                  </MuiTooltip>
                                </td>
                              </tr>
                              <tr>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontWeight: 500 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <i className="ri-price-tag-3-line" style={{ fontSize: 16, opacity: 0.6 }} />
                                    Tags
                                  </Box>
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)' }}>
                                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                                    {localTags && localTags.length > 0 ? (
                                      localTags.map(tag => {
                                        const c = tagColor(tag)

                                        
return (
                                          <Chip
                                            key={tag}
                                            size="small"
                                            label={tag}
                                            sx={{
                                              height: 22,
                                              bgcolor: `${c}22`,
                                              color: c,
                                              border: '1px solid',
                                              borderColor: `${c}66`,
                                            }}
                                          />
                                        )
                                      })
                                    ) : (
                                      <Typography variant="caption" sx={{ opacity: 0.5 }}>{t('common.none')}</Typography>
                                    )}
                                  </Box>
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', textAlign: 'center' }}>
                                  <MuiTooltip title={t('common.edit')}>
                                    <IconButton size="small" onClick={() => setEditOptionDialog({ key: 'tags', label: 'Tags', value: (localTags || []).join(','), type: 'text' })}>
                                      <i className="ri-pencil-line" style={{ fontSize: 16 }} />
                                    </IconButton>
                                  </MuiTooltip>
                                </td>
                              </tr>
                              <tr>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontWeight: 500 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <i className="ri-play-circle-line" style={{ fontSize: 16, opacity: 0.6 }} />
                                    {t('common.enabled')} boot
                                  </Box>
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)' }}>
                                  <Chip
                                    size="small"
                                    label={data.optionsInfo?.onboot ? t('common.yes') : t('common.no')}
                                    color={data.optionsInfo?.onboot ? 'success' : 'default'}
                                    variant="outlined"
                                  />
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', textAlign: 'center' }}>
                                  <MuiTooltip title={t('common.edit')}>
                                    <IconButton size="small" onClick={() => setEditOptionDialog({ key: 'onboot', label: t('common.enabled'), value: data.optionsInfo?.onboot ? '1' : '0', type: 'select', options: [{ value: '1', label: t('common.yes') }, { value: '0', label: t('common.no') }] })}>
                                      <i className="ri-pencil-line" style={{ fontSize: 16 }} />
                                    </IconButton>
                                  </MuiTooltip>
                                </td>
                              </tr>
                              <tr>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontWeight: 500 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <i className="ri-sort-asc" style={{ fontSize: 16, opacity: 0.6 }} />
                                    {t('inventory.startupOrder')}
                                  </Box>
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontFamily: 'monospace', fontSize: '0.9rem' }}>
                                  {data.optionsInfo?.startupOrder || 'order=any'}
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', textAlign: 'center' }}>
                                  <MuiTooltip title={t('common.edit')}>
                                    <IconButton size="small" onClick={() => setEditOptionDialog({ key: 'startup', label: t('inventory.startupOrder'), value: data.optionsInfo?.startupOrder || '', type: 'text' })}>
                                      <i className="ri-pencil-line" style={{ fontSize: 16 }} />
                                    </IconButton>
                                  </MuiTooltip>
                                </td>
                              </tr>
                              <tr>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontWeight: 500 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <i className="ri-window-line" style={{ fontSize: 16, opacity: 0.6 }} />
                                    {t('inventory.osType')}
                                  </Box>
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)' }}>
                                  {data.optionsInfo?.ostype || t('common.notAvailable')}
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', textAlign: 'center' }}>
                                  <MuiTooltip title={t('common.edit')}>
                                    <IconButton size="small" onClick={() => setEditOptionDialog({ key: 'ostype', label: t('inventory.osType'), value: data.optionsInfo?.ostype || 'other', type: 'select', options: [
                                      { value: 'other', label: 'Other' },
                                      { value: 'wxp', label: 'Windows XP' },
                                      { value: 'w2k', label: 'Windows 2000' },
                                      { value: 'w2k3', label: 'Windows 2003' },
                                      { value: 'w2k8', label: 'Windows 2008' },
                                      { value: 'wvista', label: 'Windows Vista' },
                                      { value: 'win7', label: 'Windows 7' },
                                      { value: 'win8', label: 'Windows 8/2012' },
                                      { value: 'win10', label: 'Windows 10/2016/2019' },
                                      { value: 'win11', label: 'Windows 11/2022' },
                                      { value: 'l24', label: 'Linux 2.4 Kernel' },
                                      { value: 'l26', label: 'Linux 2.6+ Kernel' },
                                      { value: 'solaris', label: 'Solaris' },
                                    ] })}>
                                      <i className="ri-pencil-line" style={{ fontSize: 16 }} />
                                    </IconButton>
                                  </MuiTooltip>
                                </td>
                              </tr>
                              <tr>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontWeight: 500 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <i className="ri-restart-line" style={{ fontSize: 16, opacity: 0.6 }} />
                                    Boot order
                                  </Box>
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontFamily: 'monospace', fontSize: '0.9rem' }}>
                                  {data.optionsInfo?.bootOrder || t('common.noData')}
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', textAlign: 'center' }}>
                                  <MuiTooltip title="Éditer">
                                    <IconButton size="small" onClick={() => setEditOptionDialog({ key: 'boot', label: 'Ordre de boot', value: data.optionsInfo?.bootOrder || '', type: 'text' })}>
                                      <i className="ri-pencil-line" style={{ fontSize: 16 }} />
                                    </IconButton>
                                  </MuiTooltip>
                                </td>
                              </tr>
                              <tr>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontWeight: 500 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <i className="ri-cursor-line" style={{ fontSize: 16, opacity: 0.6 }} />
                                    Tablette USB
                                  </Box>
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)' }}>
                                  <Chip
                                    size="small"
                                    label={data.optionsInfo?.useTablet !== false ? t('common.enabled') : t('common.disabled')}
                                    color={data.optionsInfo?.useTablet !== false ? 'success' : 'default'}
                                    variant="outlined"
                                  />
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', textAlign: 'center' }}>
                                  <MuiTooltip title={t('common.edit')}>
                                    <IconButton size="small" onClick={() => setEditOptionDialog({ key: 'tablet', label: 'USB Tablet', value: data.optionsInfo?.useTablet !== false ? '1' : '0', type: 'select', options: [{ value: '1', label: t('common.yes') }, { value: '0', label: t('common.no') }] })}>
                                      <i className="ri-pencil-line" style={{ fontSize: 16 }} />
                                    </IconButton>
                                  </MuiTooltip>
                                </td>
                              </tr>
                              <tr>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontWeight: 500 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <i className="ri-plug-line" style={{ fontSize: 16, opacity: 0.6 }} />
                                    Hotplug
                                  </Box>
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)' }}>
                                  {data.optionsInfo?.hotplug || 'disk,network,usb'}
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', textAlign: 'center' }}>
                                  <MuiTooltip title="Éditer">
                                    <IconButton size="small" onClick={() => setEditOptionDialog({ key: 'hotplug', label: 'Hotplug (disk,network,usb,memory,cpu)', value: data.optionsInfo?.hotplug || 'disk,network,usb', type: 'text' })}>
                                      <i className="ri-pencil-line" style={{ fontSize: 16 }} />
                                    </IconButton>
                                  </MuiTooltip>
                                </td>
                              </tr>
                              <tr>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontWeight: 500 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <i className="ri-flashlight-line" style={{ fontSize: 16, opacity: 0.6 }} />
                                    ACPI
                                  </Box>
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)' }}>
                                  <Chip
                                    size="small"
                                    label={data.optionsInfo?.acpi !== false ? t('common.enabled') : t('common.disabled')}
                                    color={data.optionsInfo?.acpi !== false ? 'success' : 'default'}
                                    variant="outlined"
                                  />
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', textAlign: 'center' }}>
                                  <MuiTooltip title={t('common.edit')}>
                                    <IconButton size="small" onClick={() => setEditOptionDialog({ key: 'acpi', label: 'ACPI', value: data.optionsInfo?.acpi !== false ? '1' : '0', type: 'select', options: [{ value: '1', label: t('common.yes') }, { value: '0', label: t('common.no') }] })}>
                                      <i className="ri-pencil-line" style={{ fontSize: 16 }} />
                                    </IconButton>
                                  </MuiTooltip>
                                </td>
                              </tr>
                              <tr>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontWeight: 500 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <i className="ri-speed-line" style={{ fontSize: 16, opacity: 0.6 }} />
                                    KVM Hardware
                                  </Box>
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)' }}>
                                  <Chip
                                    size="small"
                                    label={data.optionsInfo?.kvmEnabled !== false ? t('common.enabled') : t('common.disabled')}
                                    color={data.optionsInfo?.kvmEnabled !== false ? 'success' : 'default'}
                                    variant="outlined"
                                  />
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', textAlign: 'center' }}>
                                  <MuiTooltip title="Éditer">
                                    <IconButton size="small" onClick={() => setEditOptionDialog({ key: 'kvm', label: 'KVM Hardware Virtualization', value: data.optionsInfo?.kvmEnabled !== false ? '1' : '0', type: 'select', options: [{ value: '1', label: t('common.yes') }, { value: '0', label: t('common.no') }] })}>
                                      <i className="ri-pencil-line" style={{ fontSize: 16 }} />
                                    </IconButton>
                                  </MuiTooltip>
                                </td>
                              </tr>
                              <tr>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontWeight: 500 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <i className="ri-snowflake-line" style={{ fontSize: 16, opacity: 0.6 }} />
                                    {t('inventory.freezeCpuOnStartup')}
                                  </Box>
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)' }}>
                                  <Chip 
                                    size="small" 
                                    label={data.optionsInfo?.freezeCpu ? t('common.yes') : t('common.no')} 
                                    color={data.optionsInfo?.freezeCpu ? 'warning' : 'default'}
                                    variant="outlined"
                                  />
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', textAlign: 'center' }}>
                                  <MuiTooltip title={t('common.edit')}>
                                    <IconButton size="small" onClick={() => setEditOptionDialog({ key: 'freeze', label: t('inventory.freezeCpuOnStartup'), value: data.optionsInfo?.freezeCpu ? '1' : '0', type: 'select', options: [{ value: '1', label: t('common.yes') }, { value: '0', label: t('common.no') }] })}>
                                      <i className="ri-pencil-line" style={{ fontSize: 16 }} />
                                    </IconButton>
                                  </MuiTooltip>
                                </td>
                              </tr>
                              <tr>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontWeight: 500 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <i className="ri-time-line" style={{ fontSize: 16, opacity: 0.6 }} />
                                    {t('inventory.rtcLocalTime')}
                                  </Box>
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)' }}>
                                  {data.optionsInfo?.useLocalTime === 'yes' ? t('common.yes') : t('common.no')}
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', textAlign: 'center' }}>
                                  <MuiTooltip title={t('common.edit')}>
                                    <IconButton size="small" onClick={() => setEditOptionDialog({ key: 'localtime', label: 'RTC Local Time', value: data.optionsInfo?.useLocalTime || '', type: 'select', options: [{ value: '', label: 'Default' }, { value: '1', label: t('common.yes') }, { value: '0', label: t('common.no') }] })}>
                                      <i className="ri-pencil-line" style={{ fontSize: 16 }} />
                                    </IconButton>
                                  </MuiTooltip>
                                </td>
                              </tr>
                              <tr>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontWeight: 500 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <i className="ri-calendar-line" style={{ fontSize: 16, opacity: 0.6 }} />
                                    {t('inventory.rtcDate')}
                                  </Box>
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)' }}>
                                  {data.optionsInfo?.rtcStartDate || 'now'}
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', textAlign: 'center' }}>
                                  <MuiTooltip title={t('common.edit')}>
                                    <IconButton size="small" onClick={() => setEditOptionDialog({ key: 'startdate', label: t('inventory.rtcDate'), value: data.optionsInfo?.rtcStartDate || 'now', type: 'text' })}>
                                      <i className="ri-pencil-line" style={{ fontSize: 16 }} />
                                    </IconButton>
                                  </MuiTooltip>
                                </td>
                              </tr>
                              <tr>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontWeight: 500 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <i className="ri-fingerprint-line" style={{ fontSize: 16, opacity: 0.6 }} />
                                    SMBIOS (type1)
                                  </Box>
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontFamily: 'monospace', fontSize: '0.85rem' }}>
                                  {data.optionsInfo?.smbiosUuid ? `uuid=${data.optionsInfo.smbiosUuid}` : t('inventory.autoGenerated')}
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', textAlign: 'center' }}>
                                  <MuiTooltip title={t('inventory.notEditable')}>
                                    <span>
                                      <IconButton size="small" disabled>
                                        <i className="ri-lock-line" style={{ fontSize: 16 }} />
                                      </IconButton>
                                    </span>
                                  </MuiTooltip>
                                </td>
                              </tr>
                              <tr>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontWeight: 500 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <i className="ri-robot-line" style={{ fontSize: 16, opacity: 0.6 }} />
                                    QEMU Guest Agent
                                  </Box>
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)' }}>
                                  <Chip 
                                    size="small" 
                                    label={data.optionsInfo?.agentEnabled ? t('common.enabled') : t('common.disabled')}
                                    color={data.optionsInfo?.agentEnabled ? 'success' : 'warning'}
                                    variant="outlined"
                                  />
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', textAlign: 'center' }}>
                                  <MuiTooltip title="Éditer">
                                    <IconButton size="small" onClick={() => setEditOptionDialog({ key: 'agent', label: 'QEMU Guest Agent', value: data.optionsInfo?.agentEnabled ? '1' : '0', type: 'select', options: [{ value: '1', label: t('common.enabled') }, { value: '0', label: t('common.disabled') }] })}>
                                      <i className="ri-pencil-line" style={{ fontSize: 16 }} />
                                    </IconButton>
                                  </MuiTooltip>
                                </td>
                              </tr>
                              <tr>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontWeight: 500 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <i className="ri-shield-check-line" style={{ fontSize: 16, opacity: 0.6 }} />
                                    Protection
                                  </Box>
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)' }}>
                                  <Chip 
                                    size="small" 
                                    label={data.optionsInfo?.protection ? t('common.enabled') : t('common.disabled')}
                                    color={data.optionsInfo?.protection ? 'success' : 'default'}
                                    variant="outlined"
                                  />
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', textAlign: 'center' }}>
                                  <MuiTooltip title="Éditer">
                                    <IconButton size="small" onClick={() => setEditOptionDialog({ key: 'protection', label: 'Protection', value: data.optionsInfo?.protection ? '1' : '0', type: 'select', options: [{ value: '1', label: t('common.yes') }, { value: '0', label: t('common.no') }] })}>
                                      <i className="ri-pencil-line" style={{ fontSize: 16 }} />
                                    </IconButton>
                                  </MuiTooltip>
                                </td>
                              </tr>
                              <tr>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontWeight: 500 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <i className="ri-tv-line" style={{ fontSize: 16, opacity: 0.6 }} />
                                    Spice Enhancements
                                  </Box>
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)' }}>
                                  {data.optionsInfo?.spiceEnhancements || 'none'}
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', textAlign: 'center' }}>
                                  <MuiTooltip title="Éditer">
                                    <IconButton size="small" onClick={() => setEditOptionDialog({ key: 'spice_enhancements', label: 'Spice Enhancements', value: data.optionsInfo?.spiceEnhancements || '', type: 'text' })}>
                                      <i className="ri-pencil-line" style={{ fontSize: 16 }} />
                                    </IconButton>
                                  </MuiTooltip>
                                </td>
                              </tr>
                              <tr>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontWeight: 500 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <i className="ri-save-line" style={{ fontSize: 16, opacity: 0.6 }} />
                                    VM State Storage
                                  </Box>
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)' }}>
                                  {data.optionsInfo?.vmStateStorage || 'Automatique'}
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', textAlign: 'center' }}>
                                  <MuiTooltip title="Éditer">
                                    <IconButton size="small" onClick={() => setEditOptionDialog({ key: 'vmstatestorage', label: 'VM State Storage', value: data.optionsInfo?.vmStateStorage || '', type: 'text' })}>
                                      <i className="ri-pencil-line" style={{ fontSize: 16 }} />
                                    </IconButton>
                                  </MuiTooltip>
                                </td>
                              </tr>
                              <tr>
                                <td style={{ padding: '10px 16px', fontWeight: 500 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <i className="ri-lock-password-line" style={{ fontSize: 16, opacity: 0.6 }} />
                                    AMD SEV
                                  </Box>
                                </td>
                                <td style={{ padding: '10px 16px' }}>
                                  {data.optionsInfo?.amdSEV === 'enabled' ? t('common.enabled') : t('common.disabled')}
                                </td>
                                <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                                  <MuiTooltip title={t('common.edit')}>
                                    <IconButton size="small" onClick={() => setEditOptionDialog({ key: 'amd_sev', label: 'AMD SEV', value: data.optionsInfo?.amdSEV || '', type: 'select', options: [
                                      { value: '', label: 'Default' },
                                      { value: 'sev', label: 'AMD SEV' },
                                      { value: 'sev-es', label: 'AMD SEV-ES (highly experimental)' },
                                      { value: 'sev-snp', label: 'AMD SEV-SNP (highly experimental)' },
                                    ] })}>
                                      <i className="ri-pencil-line" style={{ fontSize: 16 }} />
                                    </IconButton>
                                  </MuiTooltip>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </Box>
                      </CardContent>
                    </Card>
                  )}
                </Box>
              )}

              {/* ==================== ONGLET 3 - HISTORIQUE DES TÂCHES ==================== */}
              {detailTab === 3 && (
                <Box sx={{ py: 2 }}>
                  <Card variant="outlined" sx={{ borderRadius: 2 }}>
                    <CardContent sx={{ p: 0 }}>
                      <Box sx={{ p: 2, borderBottom: '1px solid rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <i className="ri-history-line" style={{ fontSize: 20 }} />
                          {t('inventory.tabs.history')}
                          {tasks.length > 0 && (
                            <Chip size="small" label={tasks.length} sx={{ height: 20, fontSize: 11, ml: 1 }} />
                          )}
                        </Typography>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={tasksLoading ? <CircularProgress size={14} /> : <i className="ri-refresh-line" />}
                          onClick={() => { setTasksLoaded(false); loadTasks(); }}
                          disabled={tasksLoading}
                        >
                          {t('common.refresh')}
                        </Button>
                      </Box>
                      
                      {/* Loading */}
                      {tasksLoading && tasks.length === 0 && (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                          <CircularProgress size={32} />
                        </Box>
                      )}

                      {/* Error */}
                      {tasksError && (
                        <Alert severity="warning" sx={{ m: 2 }}>{tasksError}</Alert>
                      )}

                      {/* Tableau des tâches - Format Proxmox */}
                      {!tasksLoading && !tasksError && (
                        <Box sx={{ overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                              <tr style={{ backgroundColor: 'rgba(0,0,0,0.04)' }}>
                                <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, borderBottom: '1px solid rgba(0,0,0,0.2)', fontSize: '0.8rem' }}>Start Time</th>
                                <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, borderBottom: '1px solid rgba(0,0,0,0.2)', fontSize: '0.8rem' }}>End Time</th>
                                <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, borderBottom: '1px solid rgba(0,0,0,0.2)', fontSize: '0.8rem' }}>User name</th>
                                <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, borderBottom: '1px solid rgba(0,0,0,0.2)', fontSize: '0.8rem' }}>Description</th>
                                <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, borderBottom: '1px solid rgba(0,0,0,0.2)', fontSize: '0.8rem', width: '180px' }}>Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {tasks.length === 0 ? (
                                <tr>
                                  <td colSpan={5} style={{ padding: '40px 16px', textAlign: 'center' }}>
                                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, opacity: 0.6 }}>
                                      <i className="ri-task-line" style={{ fontSize: 48, opacity: 0.3 }} />
                                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                        {t('common.noData')}
                                      </Typography>
                                      <Typography variant="caption" sx={{ maxWidth: 400 }}>
                                        {t('inventory.tabs.historyEmpty')}
                                      </Typography>
                                    </Box>
                                  </td>
                                </tr>
                              ) : (
                                tasks.map((task, idx) => {
                                  const isError = task.status === 'error'
                                  const rowBgColor = isError ? 'rgba(211, 47, 47, 0.15)' : 'transparent'
                                  
                                  return (
                                    <tr key={task.upid || idx} style={{ backgroundColor: rowBgColor }}>
                                      <td style={{ padding: '8px 12px', borderBottom: '1px solid rgba(0,0,0,0.1)' }}>
                                        <Typography variant="body2" sx={{ fontSize: '0.8rem', fontFamily: 'monospace' }}>
                                          {task.starttimeFormatted}
                                        </Typography>
                                      </td>
                                      <td style={{ padding: '8px 12px', borderBottom: '1px solid rgba(0,0,0,0.1)' }}>
                                        <Typography variant="body2" sx={{ fontSize: '0.8rem', fontFamily: 'monospace' }}>
                                          {task.endtimeFormatted || '-'}
                                        </Typography>
                                      </td>
                                      <td style={{ padding: '8px 12px', borderBottom: '1px solid rgba(0,0,0,0.1)' }}>
                                        <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>
                                          {task.user}
                                        </Typography>
                                      </td>
                                      <td style={{ padding: '8px 12px', borderBottom: '1px solid rgba(0,0,0,0.1)' }}>
                                        <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>
                                          {data?.kindLabel}/{data?.vmType?.toUpperCase()} {selection?.id?.split(':').pop()} - {task.label}
                                        </Typography>
                                      </td>
                                      <td style={{ padding: '8px 12px', borderBottom: '1px solid rgba(0,0,0,0.1)' }}>
                                        <Typography 
                                          variant="body2" 
                                          sx={{ 
                                            fontSize: '0.8rem',
                                            color: isError ? 'error.main' : 'inherit',
                                            fontWeight: isError ? 500 : 400
                                          }}
                                        >
                                          {task.statusText}
                                        </Typography>
                                      </td>
                                    </tr>
                                  )
                                })
                              )}
                            </tbody>
                          </table>
                        </Box>
                      )}
                    </CardContent>
                  </Card>
                </Box>
              )}

              {/* ==================== ONGLET 4 - SAUVEGARDES ==================== */}
              {detailTab === 4 && (
                <Box>
                  {/* Header avec bouton de création */}
                  {!selectedBackup && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                      <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <i className="ri-hard-drive-2-line" style={{ fontSize: 20 }} />
                        Sauvegardes
                      </Typography>
                      <Button
                        variant="contained"
                        size="small"
                        startIcon={<AddIcon />}
                        onClick={() => {
                          // Charger les storages de backup disponibles
                          if (selection?.type === 'vm') {
                            const { connId, node } = parseVmId(selection.id)

                            fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/storages?content=backup`)
                              .then(res => res.json())
                              .then(json => setBackupStorages(json.data || []))
                              .catch(() => setBackupStorages([]))
                          }

                          setBackupStorage('')
                          setBackupMode('snapshot')
                          setBackupCompress('zstd')
                          setBackupNote('')
                          setCreateBackupDialogOpen(true)
                        }}
                      >
                        Nouvelle sauvegarde
                      </Button>
                    </Box>
                  )}
                  
                  {/* Loading */}
                  {backupsLoading && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                      <CircularProgress size={32} />
                    </Box>
                  )}

                  {/* Error */}
                  {backupsError && (
                    <Alert severity="warning" sx={{ mb: 2 }}>{backupsError}</Alert>
                  )}

                  {/* Stats */}
                  {!backupsLoading && backupsStats && backupsStats.total > 0 && !selectedBackup && (
                    <Card variant="outlined" sx={{ mb: 2 }}>
                      <CardContent sx={{ pb: '16px !important' }}>
                        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 2 }}>
                          <Box sx={{ textAlign: 'center', p: 1, bgcolor: 'action.hover', borderRadius: 2 }}>
                            <Typography variant="h6" sx={{ fontWeight: 700, color: primaryColor }}>{backupsStats.total}</Typography>
                            <Typography variant="caption" sx={{ opacity: 0.6 }}>Total</Typography>
                          </Box>
                          <Box sx={{ textAlign: 'center', p: 1, bgcolor: 'action.hover', borderRadius: 2 }}>
                            <Typography variant="h6" sx={{ fontWeight: 700, color: 'success.main' }}>{backupsStats.verifiedCount || 0}</Typography>
                            <Typography variant="caption" sx={{ opacity: 0.6 }}>{t('backups.verified')}</Typography>
                          </Box>
                          <Box sx={{ textAlign: 'center', p: 1, bgcolor: 'action.hover', borderRadius: 2 }}>
                            <Typography variant="h6" sx={{ fontWeight: 700 }}>{backupsStats.totalSizeFormatted}</Typography>
                            <Typography variant="caption" sx={{ opacity: 0.6 }}>Total</Typography>
                          </Box>
                        </Box>
                      </CardContent>
                    </Card>
                  )}

                  {/* Liste des backups */}
                  {!backupsLoading && !selectedBackup && (
                    <>
                      {backups.length === 0 ? (
                        <Alert severity="info" sx={{ mt: 2 }}>
                          {t('common.noData')}
                        </Alert>
                      ) : (
                        <List dense sx={{ mx: -1 }}>
                          {backups.map((backup, idx) => (
                            <ListItem key={idx} disablePadding>
                              <ListItemButton
                                onClick={() => {
                                  setSelectedBackup(backup)
                                  loadBackupContent(backup)
                                }}
                                sx={{ borderRadius: 1, py: 1.5 }}
                              >
                                <ListItemIcon sx={{ minWidth: 40 }}>
                                  <i
                                    className="ri-hard-drive-2-fill"
                                    style={{
                                      fontSize: 24,
                                      color: backup.verified ? '#66BB6A' : '#90A4AE'
                                    }}
                                  />
                                </ListItemIcon>
                                <ListItemText
                                  primary={
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                        {backup.backupTimeFormatted}
                                      </Typography>
                                      {backup.protected && (
                                        <i className="ri-lock-fill" style={{ fontSize: 14, color: '#FFB74D' }} />
                                      )}
                                    </Box>
                                  }
                                  secondary={
                                    <Typography variant="caption" sx={{ opacity: 0.7 }}>
                                      {backup.pbsName} • {backup.datastore} • {backup.sizeFormatted}
                                    </Typography>
                                  }
                                />
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  {backup.verified && (
                                    <Chip size="small" color="success" label="✓" sx={{ height: 20, minWidth: 24 }} />
                                  )}
                                  <i className="ri-arrow-right-s-line" style={{ opacity: 0.5 }} />
                                </Box>
                              </ListItemButton>
                            </ListItem>
                          ))}
                        </List>
                      )}
                    </>
                  )}

                  {/* Détails d'un backup sélectionné */}
                  {selectedBackup && (
                    <>
                      {/* Header avec bouton retour */}
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                        <IconButton size="small" onClick={backToBackupsList}>
                          <i className="ri-arrow-left-line" />
                        </IconButton>
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                            {selectedBackup.backupTimeFormatted}
                          </Typography>
                          <Typography variant="caption" sx={{ opacity: 0.6 }}>
                            {selectedBackup.pbsName} • {selectedBackup.datastore}
                          </Typography>
                        </Box>
                        <Chip size="small" label={selectedBackup.sizeFormatted} variant="outlined" />
                      </Box>

                      {/* Explorateur de fichiers */}
                      <Card variant="outlined">
                        <CardContent sx={{ pb: '16px !important' }}>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                              <i className="ri-folder-open-line" style={{ marginRight: 8 }} />
                              Contenu du backup
                            </Typography>
                            <Stack direction="row" spacing={1} alignItems="center">
                              {selectedPveStorage && (
                                <Chip
                                  size="small"
                                  label={selectedPveStorage.storage}
                                  color="primary"
                                  variant="outlined"
                                  onDelete={() => {
                                    setSelectedPveStorage(null)
                                    setExplorerArchives([])
                                    setExplorerFiles([])
                                    setExplorerArchive(null)
                                  }}
                                  sx={{ height: 20, fontSize: 10 }}
                                />
                              )}
                              <Chip
                                size="small"
                                label={explorerMode === 'pve' ? 'via PVE' : 'via PBS'}
                                color={explorerMode === 'pve' ? 'success' : 'default'}
                                variant="outlined"
                                sx={{ height: 20, fontSize: 10 }}
                              />
                            </Stack>
                          </Box>

                          {explorerLoading && (
                            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                              <CircularProgress size={24} />
                            </Box>
                          )}

                          {explorerError && (
                            <Alert severity="warning" sx={{ mb: 2 }}>{explorerError}</Alert>
                          )}

                          {/* Sélecteur de storage PVE */}
                          {!explorerLoading && !explorerArchive && compatibleStorages.length > 0 && !selectedPveStorage && (
                            <Box sx={{ mb: 2 }}>
                              <Alert 
                                severity={compatibleStorages[0]?.matchType === 'exact' ? 'success' : 'info'} 
                                sx={{ mb: 2 }}
                              >
                                <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
                                  {compatibleStorages.length === 1 ? 'PBS Storage' : 'PBS Storages'}
                                </Typography>
                                <Typography variant="caption">
                                  {t('common.select')}:
                                </Typography>
                              </Alert>
                              <List dense sx={{ mx: -1 }}>
                                {compatibleStorages.map((storage: any, idx: number) => (
                                  <ListItem key={idx} disablePadding>
                                    <ListItemButton
                                      onClick={() => exploreWithPveStorage(selectedBackup, storage)}
                                      sx={{ borderRadius: 1 }}
                                    >
                                      <ListItemIcon sx={{ minWidth: 36 }}>
                                        <i className="ri-database-2-line" style={{ 
                                          color: storage.matchType === 'exact' ? '#66BB6A' : '#42A5F5', 
                                          fontSize: 20 
                                        }} />
                                      </ListItemIcon>
                                      <ListItemText
                                        primary={
                                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            {storage.storage}
                                            {storage.matchType === 'exact' && (
                                              <Chip label="Recommended" size="small" color="success" sx={{ height: 18, fontSize: 10 }} />
                                            )}
                                          </Box>
                                        }
                                        secondary={`${storage.server || '?'} → ${storage.datastore || '?'}`}
                                      />
                                      <i className="ri-arrow-right-s-line" style={{ opacity: 0.5 }} />
                                    </ListItemButton>
                                  </ListItem>
                                ))}
                              </List>
                              <Button
                                size="small"
                                variant="text"
                                onClick={() => loadBackupContentViaPbs(selectedBackup)}
                                sx={{ mt: 1 }}
                              >
                                Utiliser PBS directement
                              </Button>
                            </Box>
                          )}

                          {/* Liste des archives (niveau racine) */}
                          {!explorerArchive && !explorerLoading && (explorerArchives.length > 0 || explorerMode === 'pbs' || selectedPveStorage) && (
                            <>
                              <Typography variant="caption" sx={{ opacity: 0.6, display: 'block', mb: 1 }}>
                                {explorerMode === 'pve' ? 'Drives et archives du backup' : 'Archives du backup'}
                              </Typography>
                              <List dense sx={{ mx: -1 }}>
                                {explorerArchives.map((file: any, idx: number) => (
                                  <ListItem key={idx} disablePadding>
                                    <ListItemButton
                                      onClick={() => file.browsable && browseArchive(file.name, '/')}
                                      disabled={!file.browsable}
                                      sx={{ borderRadius: 1 }}
                                    >
                                      <ListItemIcon sx={{ minWidth: 36 }}>
                                        {file.type === 'virtual' ? (
                                          <i className="ri-hard-drive-2-fill" style={{ color: '#42A5F5', fontSize: 20 }} />
                                        ) : file.type === 'directory' ? (
                                          <i className="ri-folder-fill" style={{ color: '#FFB74D', fontSize: 20 }} />
                                        ) : (
                                          <i className="ri-file-fill" style={{ color: '#90A4AE', fontSize: 20 }} />
                                        )}
                                      </ListItemIcon>
                                      <ListItemText
                                        primary={file.name}
                                        secondary={
                                          file.type === 'virtual' ? 'Drive / Partition' :
                                          file.browsable ? 'Cliquer pour explorer' : 
                                          file.sizeFormatted || 'Non explorable'
                                        }
                                      />
                                      {file.browsable && (
                                        <i className="ri-arrow-right-s-line" style={{ opacity: 0.5 }} />
                                      )}
                                    </ListItemButton>
                                  </ListItem>
                                ))}
                                {explorerArchives.length === 0 && !explorerLoading && (
                                  <Typography variant="body2" sx={{ opacity: 0.5, py: 2, textAlign: 'center' }}>
                                    {t('common.noData')}
                                  </Typography>
                                )}
                              </List>
                            </>
                          )}

                          {/* Navigation dans une archive */}
                          {explorerArchive && !explorerLoading && (
                            <>
                              {/* Breadcrumb */}
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                                <IconButton size="small" onClick={backToArchives}>
                                  <i className="ri-arrow-left-line" />
                                </IconButton>
                                <Breadcrumbs separator="›" sx={{ flex: 1, fontSize: 12 }}>
                                  <Typography
                                    variant="body2"
                                    sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
                                    onClick={backToArchives}
                                  >
                                    {explorerArchive.replace('.pxar.didx', '')}
                                  </Typography>
                                  {explorerPath !== '/' && explorerPath.split('/').filter(Boolean).map((part, idx) => (
                                    <Typography
                                      key={idx}
                                      variant="body2"
                                      sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
                                      onClick={() => navigateToBreadcrumb(idx)}
                                    >
                                      {part}
                                    </Typography>
                                  ))}
                                </Breadcrumbs>
                              </Box>

                              {/* Bouton remonter */}
                              {explorerPath !== '/' && (
                                <ListItemButton onClick={navigateUp} sx={{ mb: 1, borderRadius: 1, mx: -1 }}>
                                  <ListItemIcon sx={{ minWidth: 36 }}>
                                    <i className="ri-arrow-up-line" style={{ fontSize: 20 }} />
                                  </ListItemIcon>
                                  <ListItemText primary=".." />
                                </ListItemButton>
                              )}

                              {/* Champ de recherche */}
                              {explorerFiles.length > 5 && (
                                <TextField
                                  size="small"
                                  placeholder="Rechercher un fichier..."
                                  value={explorerSearch}
                                  onChange={(e) => setExplorerSearch(e.target.value)}
                                  InputProps={{
                                    startAdornment: (
                                      <i className="ri-search-line" style={{ marginRight: 8, opacity: 0.5 }} />
                                    ),
                                    endAdornment: explorerSearch && (
                                      <IconButton size="small" onClick={() => setExplorerSearch('')}>
                                        <CloseIcon sx={{ fontSize: 16 }} />
                                      </IconButton>
                                    )
                                  }}
                                  sx={{ mb: 1, width: '100%' }}
                                />
                              )}

                              {/* Compteur de résultats */}
                              {explorerSearch && (
                                <Typography variant="caption" sx={{ opacity: 0.6, display: 'block', mb: 1 }}>
                                  {filteredExplorerFiles.length} / {explorerFiles.length}
                                </Typography>
                              )}

                              {/* Liste des fichiers */}
                              <List dense sx={{ maxHeight: 300, overflow: 'auto', mx: -1 }}>
                                {filteredExplorerFiles.map((file: any, idx: number) => {
                                  const isNavigable = file.type === 'directory' || file.type === 'virtual' || file.leaf === false || file.leaf === 0
                                  const canDownload = explorerMode === 'pve' && selectedPveStorage
                                  const canPreviewFile = canDownload && !isNavigable && canPreview(file.name)

                                  
return (
                                    <ListItem 
                                      key={idx} 
                                      disablePadding
                                      secondaryAction={
                                        canDownload && (
                                          <Stack direction="row" spacing={0}>
                                            {canPreviewFile && (
                                              <MuiTooltip title={t('common.view')}>
                                                <IconButton 
                                                  size="small"
                                                  onClick={(e) => {
                                                    e.stopPropagation()
                                                    previewFile(file.name)
                                                  }}
                                                >
                                                  <i className="ri-eye-line" style={{ fontSize: 18 }} />
                                                </IconButton>
                                              </MuiTooltip>
                                            )}
                                            <MuiTooltip title={t('common.download')}>
                                              <IconButton 
                                                edge="end" 
                                                size="small"
                                                onClick={(e) => {
                                                  e.stopPropagation()
                                                  downloadFile(file.name, isNavigable)
                                                }}
                                              >
                                                <i className="ri-download-2-line" style={{ fontSize: 18 }} />
                                              </IconButton>
                                            </MuiTooltip>
                                          </Stack>
                                        )
                                      }
                                    >
                                      <ListItemButton
                                        onClick={() => isNavigable && navigateToFolder(file.name)}
                                        disabled={!isNavigable && file.type !== 'file'}
                                        sx={{ borderRadius: 1, pr: canDownload ? (canPreviewFile ? 10 : 6) : 2 }}
                                      >
                                        <ListItemIcon sx={{ minWidth: 36 }}>
                                          {file.type === 'directory' || file.type === 'virtual' ? (
                                            <i className="ri-folder-fill" style={{ color: '#FFB74D', fontSize: 20 }} />
                                          ) : (
                                            <i className="ri-file-fill" style={{ color: '#90A4AE', fontSize: 20 }} />
                                          )}
                                        </ListItemIcon>
                                        <ListItemText
                                          primary={file.name}
                                          secondary={
                                            file.sizeFormatted && file.sizeFormatted !== '0 B' 
                                              ? file.sizeFormatted 
                                              : isNavigable ? 'Dossier' : '-'
                                          }
                                        />
                                        {isNavigable && (
                                          <i className="ri-arrow-right-s-line" style={{ opacity: 0.5 }} />
                                        )}
                                      </ListItemButton>
                                    </ListItem>
                                  )
                                })}
                                {filteredExplorerFiles.length === 0 && explorerFiles.length > 0 && (
                                  <Typography variant="body2" sx={{ opacity: 0.5, py: 2, textAlign: 'center' }}>
                                    {t('common.noResults')}
                                  </Typography>
                                )}
                                {explorerFiles.length === 0 && (
                                  <Typography variant="body2" sx={{ opacity: 0.5, py: 2, textAlign: 'center' }}>
                                    Dossier vide
                                  </Typography>
                                )}
                              </List>
                            </>
                          )}
                        </CardContent>
                      </Card>
                    </>
                  )}
                </Box>
              )}

              {/* ==================== ONGLET 5 - SNAPSHOTS ==================== */}
              {detailTab === 5 && (
                <Box>
                  {/* Loading */}
                  {snapshotsLoading && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                      <CircularProgress size={32} />
                    </Box>
                  )}

                  {/* Error */}
                  {snapshotsError && (
                    <Alert severity="warning" sx={{ mb: 2 }}>{snapshotsError}</Alert>
                  )}

                  {/* Header avec bouton créer */}
                  {!snapshotsLoading && (
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <i className="ri-camera-line" style={{ fontSize: 20, opacity: 0.7 }} />
                        <Typography variant="subtitle1" fontWeight={600}>
                          Snapshots
                        </Typography>
                        {snapshots.length > 0 && (
                          <Chip 
                            size="small" 
                            label={`${snapshots.filter(s => s.name !== 'current').length} snapshot${snapshots.filter(s => s.name !== 'current').length > 1 ? 's' : ''}`}
                            sx={{ height: 20, fontSize: '0.7rem' }}
                          />
                        )}
                      </Box>
                      {!showCreateSnapshot && (
                        <Button
                          variant="contained"
                          size="small"
                          startIcon={<i className="ri-add-line" />}
                          onClick={() => setShowCreateSnapshot(true)}
                          disabled={snapshotActionBusy}
                        >
                          {t('common.create')}
                        </Button>
                      )}
                    </Box>
                  )}

                  {/* Formulaire de création */}
                  {!snapshotsLoading && showCreateSnapshot && (
                    <Card variant="outlined" sx={{ mb: 2, bgcolor: 'action.hover' }}>
                      <CardContent sx={{ pb: '16px !important' }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                          <i className="ri-camera-lens-line" style={{ fontSize: 18 }} />
                          {t('audit.actions.snapshot')}
                        </Typography>
                        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                          <TextField
                            size="small"
                            label={t('common.name')}
                            value={newSnapshotName}
                            onChange={(e) => setNewSnapshotName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
                            placeholder="my-snapshot"
                            helperText={t('inventory.snapshotNameHelp')}
                            fullWidth
                          />
                          <TextField
                            size="small"
                            label={`${t('common.description')} (${t('common.optional')})`}
                            value={newSnapshotDesc}
                            onChange={(e) => setNewSnapshotDesc(e.target.value)}
                            fullWidth
                          />
                        </Box>
                        <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <FormControlLabel
                            control={
                              <Switch
                                checked={newSnapshotRam}
                                onChange={(e) => setNewSnapshotRam(e.target.checked)}
                                size="small"
                              />
                            }
                            label={
                              <Typography variant="body2">
                                {t('inventory.includeRam')}
                                <Typography component="span" variant="caption" sx={{ ml: 0.5, opacity: 0.6 }}>
                                  ({t('inventory.vmMustBeRunning')})
                                </Typography>
                              </Typography>
                            }
                          />
                          <Stack direction="row" spacing={1}>
                            <Button
                              variant="outlined"
                              size="small"
                              onClick={() => {
                                setShowCreateSnapshot(false)
                                setNewSnapshotName('')
                                setNewSnapshotDesc('')
                                setNewSnapshotRam(false)
                              }}
                            >
                              {t('common.cancel')}
                            </Button>
                            <Button
                              variant="contained"
                              size="small"
                              onClick={createSnapshot}
                              disabled={!newSnapshotName.trim() || snapshotActionBusy}
                              startIcon={snapshotActionBusy ? <CircularProgress size={14} /> : <i className="ri-camera-line" />}
                            >
                              {t('common.create')}
                            </Button>
                          </Stack>
                        </Box>
                      </CardContent>
                    </Card>
                  )}

                  {/* Timeline des snapshots */}
                  {!snapshotsLoading && (
                    <>
                      {snapshots.filter(s => s.name !== 'current').length === 0 ? (
                        <Card variant="outlined" sx={{ textAlign: 'center', py: 4, bgcolor: 'transparent' }}>
                          <i className="ri-camera-off-line" style={{ fontSize: 48, opacity: 0.2 }} />
                          <Typography variant="body2" sx={{ mt: 1, opacity: 0.6 }}>
                            {t('common.noData')}
                          </Typography>
                          <Typography variant="caption" sx={{ opacity: 0.4, display: 'block', mt: 0.5 }}>
                            {t('inventory.deleteSnapshotDesc')}
                          </Typography>
                        </Card>
                      ) : (
                        <Box sx={{ position: 'relative' }}>
                          {/* Ligne de timeline */}
                          <Box sx={{ 
                            position: 'absolute', 
                            left: 19, 
                            top: 24, 
                            bottom: 24, 
                            width: 2, 
                            bgcolor: 'divider',
                            borderRadius: 1
                          }} />
                          
                          {/* État actuel (current) */}
                          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mb: 1, position: 'relative' }}>
                            <Box sx={{ 
                              width: 40, 
                              height: 40, 
                              borderRadius: '50%', 
                              bgcolor: 'success.main',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: 'success.contrastText',
                              zIndex: 1,
                              boxShadow: 2
                            }}>
                              <i className="ri-play-circle-fill" style={{ fontSize: 20 }} />
                            </Box>
                            <Box sx={{ flex: 1, pt: 0.5 }}>
                              <Typography variant="body2" fontWeight={600}>
                                {t('common.active')}
                              </Typography>
                              <Typography variant="caption" sx={{ opacity: 0.6 }}>
                                {t('common.configuration')}
                              </Typography>
                            </Box>
                          </Box>

                          {/* Liste des snapshots */}
                          {snapshots
                            .filter(s => s.name !== 'current')
                            .sort((a, b) => (b.snaptime || 0) - (a.snaptime || 0))
                            .map((snap, idx, arr) => {
                              const isOldest = idx === arr.length - 1

                              
return (
                                <Box 
                                  key={snap.name}
                                  sx={{ 
                                    display: 'flex', 
                                    alignItems: 'flex-start', 
                                    gap: 2, 
                                    mb: 1,
                                    position: 'relative',
                                    '&:hover .snapshot-actions': { opacity: 1 }
                                  }}
                                >
                                  {/* Point de timeline */}
                                  <Box sx={{ 
                                    width: 40, 
                                    height: 40, 
                                    borderRadius: '50%', 
                                    bgcolor: snap.vmstate ? 'info.main' : 'background.paper',
                                    border: '2px solid',
                                    borderColor: snap.vmstate ? 'info.main' : 'divider',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: snap.vmstate ? 'info.contrastText' : 'text.secondary',
                                    zIndex: 1
                                  }}>
                                    <i className={snap.vmstate ? "ri-save-3-fill" : "ri-camera-fill"} style={{ fontSize: 18 }} />
                                  </Box>
                                  
                                  {/* Contenu */}
                                  <Card 
                                    variant="outlined" 
                                    sx={{ 
                                      flex: 1, 
                                      bgcolor: 'transparent',
                                      '&:hover': { bgcolor: 'action.hover' }
                                    }}
                                  >
                                    <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
                                      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                                        <Box sx={{ flex: 1 }}>
                                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                                            <Typography variant="body2" fontWeight={600}>
                                              {snap.name}
                                            </Typography>
                                            {snap.vmstate && (
                                              <Chip 
                                                size="small" 
                                                label="RAM" 
                                                color="info"
                                                icon={<i className="ri-ram-line" style={{ fontSize: 12 }} />}
                                                sx={{ height: 20, fontSize: '0.65rem' }} 
                                              />
                                            )}
                                            {isOldest && (
                                              <Chip 
                                                size="small" 
                                                label="Plus ancien" 
                                                variant="outlined"
                                                sx={{ height: 20, fontSize: '0.65rem' }} 
                                              />
                                            )}
                                          </Box>
                                          
                                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5, flexWrap: 'wrap' }}>
                                            <Typography variant="caption" sx={{ opacity: 0.6, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                              <i className="ri-time-line" style={{ fontSize: 12 }} />
                                              {snap.snaptimeFormatted || new Date(snap.snaptime * 1000).toLocaleString()}
                                            </Typography>
                                            {snap.description && (
                                              <>
                                                <Typography variant="caption" sx={{ opacity: 0.3 }}>•</Typography>
                                                <Typography variant="caption" sx={{ opacity: 0.7 }}>
                                                  {snap.description}
                                                </Typography>
                                              </>
                                            )}
                                          </Box>
                                        </Box>
                                        
                                        {/* Actions */}
                                        <Stack 
                                          direction="row" 
                                          spacing={0.5} 
                                          className="snapshot-actions"
                                          sx={{ opacity: { xs: 1, md: 0 }, transition: 'opacity 0.2s' }}
                                        >
                                          <MuiTooltip title={t('audit.actions.restore')}>
                                            <IconButton
                                              size="small"
                                              onClick={() => rollbackSnapshot(snap.name, snap.vmstate)}
                                              disabled={snapshotActionBusy}
                                              sx={{
                                                color: 'warning.main',
                                                '&:hover': { bgcolor: 'warning.main', color: 'warning.contrastText' }
                                              }}
                                            >
                                              <i className="ri-history-line" style={{ fontSize: 18 }} />
                                            </IconButton>
                                          </MuiTooltip>
                                          <MuiTooltip title={t('inventory.deleteSnapshot')}>
                                            <IconButton
                                              size="small"
                                              onClick={() => deleteSnapshot(snap.name)}
                                              disabled={snapshotActionBusy}
                                              sx={{
                                                color: 'error.main',
                                                '&:hover': { bgcolor: 'error.main', color: 'error.contrastText' }
                                              }}
                                            >
                                              <i className="ri-delete-bin-line" style={{ fontSize: 18 }} />
                                            </IconButton>
                                          </MuiTooltip>
                                        </Stack>
                                      </Box>
                                    </CardContent>
                                  </Card>
                                </Box>
                              )
                            })}
                        </Box>
                      )}
                    </>
                  )}

                  {/* Info */}
                  {!snapshotsLoading && snapshots.filter(s => s.name !== 'current').length > 0 && (
                    <Alert severity="info" sx={{ mt: 2 }} icon={<i className="ri-information-line" />}>
                      <Typography variant="caption">
                        <strong>{t('audit.actions.restore')}</strong>: {t('inventory.deleteSnapshotDesc')}<br/>
                        <strong>{t('common.delete')}</strong>: {t('inventory.deleteSnapshotDesc')}
                      </Typography>
                    </Alert>
                  )}
                </Box>
              )}

              {/* ==================== ONGLET 6 - NOTES ==================== */}
              {detailTab === 6 && (
                <Box sx={{ py: 2 }}>
                  <Card variant="outlined" sx={{ borderRadius: 2 }}>
                    <CardContent>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                        <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <i className="ri-sticky-note-line" style={{ fontSize: 20 }} />
                          Notes
                        </Typography>
                        {!notesEditing && (
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<i className="ri-edit-line" />}
                            onClick={() => setNotesEditing(true)}
                          >
                            {t('common.edit')}
                          </Button>
                        )}
                      </Box>

                      {/* Loading */}
                      {notesLoading && (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                          <CircularProgress size={32} />
                        </Box>
                      )}

                      {/* Error */}
                      {notesError && (
                        <Alert severity="warning" sx={{ mb: 2 }}>{notesError}</Alert>
                      )}

                      {/* Contenu des notes */}
                      {!notesLoading && !notesError && (
                        <>
                          {notesEditing ? (
                            <Box>
                              <TextField
                                fullWidth
                                multiline
                                minRows={8}
                                maxRows={20}
                                value={vmNotes}
                                onChange={(e) => setVmNotes(e.target.value)}
                                placeholder="Entrez vos notes pour cette VM..."
                                sx={{ mb: 2 }}
                              />
                              <Stack direction="row" spacing={1} justifyContent="flex-end">
                                <Button
                                  variant="outlined"
                                  onClick={() => {
                                    setNotesEditing(false)
                                    loadNotes() // Recharger les notes originales
                                  }}
                                  disabled={notesSaving}
                                >
                                  {t('common.cancel')}
                                </Button>
                                <Button
                                  variant="contained"
                                  onClick={saveNotes}
                                  disabled={notesSaving}
                                  startIcon={notesSaving ? <CircularProgress size={16} /> : <SaveIcon />}
                                >
                                  {notesSaving ? t('common.saving') : t('common.save')}
                                </Button>
                              </Stack>
                            </Box>
                          ) : (
                            <Box
                              sx={{
                                p: 2,
                                bgcolor: 'action.hover',
                                borderRadius: 1,
                                minHeight: 150,
                                whiteSpace: 'pre-wrap',
                                fontFamily: 'inherit',
                              }}
                            >
                              {vmNotes ? (
                                <Typography variant="body2" sx={{ lineHeight: 1.8 }}>
                                  {vmNotes}
                                </Typography>
                              ) : (
                                <Typography variant="body2" sx={{ opacity: 0.5, fontStyle: 'italic' }}>
                                  {t('inventory.noNotes')}
                                </Typography>
                              )}
                            </Box>
                          )}
                        </>
                      )}
                    </CardContent>
                  </Card>
                </Box>
              )}

              {/* ==================== ONGLET 7 - RÉPLICATION ==================== */}
              {detailTab === 7 && (
                <Box sx={{ py: 2 }}>
                  <Stack spacing={2}>
                    {/* ZFS Replication (Native Proxmox) */}
                    <Card variant="outlined" sx={{ borderRadius: 2 }}>
                      <CardContent>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                          <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <i className="ri-database-2-line" style={{ fontSize: 20 }} />
                            {t('replication.zfsReplication')}
                          </Typography>
                          <Button
                            size="small"
                            variant="contained"
                            startIcon={<AddIcon />}
                            onClick={() => {
                              setReplicationTargetNode('')
                              setReplicationSchedule('*/15')
                              setReplicationRateLimit('')
                              setReplicationComment('')
                              setAddReplicationDialogOpen(true)
                            }}
                            disabled={availableTargetNodes.length === 0}
                          >
                            {t('replication.addJob')}
                          </Button>
                        </Box>

                        {replicationLoading ? (
                          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                            <CircularProgress size={24} />
                          </Box>
                        ) : replicationJobs.length > 0 ? (
                          <TableContainer>
                            <Table size="small">
                              <TableHead>
                                <TableRow>
                                  <TableCell>{t('replication.target')}</TableCell>
                                  <TableCell>{t('replication.schedule')}</TableCell>
                                  <TableCell>{t('replication.lastSync')}</TableCell>
                                  <TableCell>{t('replication.nextSync')}</TableCell>
                                  <TableCell align="center">{t('updates.status')}</TableCell>
                                  <TableCell align="center">Actions</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {replicationJobs.map((job: any) => (
                                  <TableRow key={job.id}>
                                    <TableCell>
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <i className="ri-server-line" style={{ fontSize: 16, opacity: 0.7 }} />
                                        <Typography variant="body2" fontWeight={600}>{job.target}</Typography>
                                      </Box>
                                    </TableCell>
                                    <TableCell>
                                      <Chip 
                                        size="small" 
                                        label={job.schedule || '*/15'} 
                                        sx={{ height: 22, fontSize: 11 }}
                                      />
                                    </TableCell>
                                    <TableCell>
                                      <Typography variant="body2" sx={{ fontSize: 12 }}>
                                        {job.last_sync ? new Date(job.last_sync * 1000).toLocaleString() : '—'}
                                      </Typography>
                                    </TableCell>
                                    <TableCell>
                                      <Typography variant="body2" sx={{ fontSize: 12 }}>
                                        {job.next_sync ? new Date(job.next_sync * 1000).toLocaleString() : '—'}
                                      </Typography>
                                    </TableCell>
                                    <TableCell align="center">
                                      {job.error ? (
                                        <MuiTooltip title={typeof job.error === 'string' ? job.error : JSON.stringify(job.error)}>
                                          <Chip 
                                            size="small" 
                                            label={t('replication.error')} 
                                            color="error"
                                            icon={<i className="ri-error-warning-fill" style={{ fontSize: 14 }} />}
                                            sx={{ height: 22 }}
                                          />
                                        </MuiTooltip>
                                      ) : job.disable ? (
                                        <Chip 
                                          size="small" 
                                          label={t('common.disabled')} 
                                          color="default"
                                          sx={{ height: 22 }}
                                        />
                                      ) : (
                                        <Chip 
                                          size="small" 
                                          label={t('replication.active')} 
                                          color="success"
                                          icon={<i className="ri-checkbox-circle-fill" style={{ fontSize: 14 }} />}
                                          sx={{ height: 22 }}
                                        />
                                      )}
                                    </TableCell>
                                    <TableCell align="center">
                                      <Stack direction="row" spacing={0.5} justifyContent="center">
                                        <MuiTooltip title={t('replication.runNow')}>
                                          <IconButton 
                                            size="small"
                                            onClick={async () => {
                                              const { connId, node } = parseVmId(selection?.id || '')
                                              try {
                                                await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/replication/${encodeURIComponent(job.id)}/schedule_now`, {
                                                  method: 'POST'
                                                })
                                                setReplicationLoaded(false)
                                              } catch {}
                                            }}
                                          >
                                            <i className="ri-play-fill" style={{ fontSize: 16 }} />
                                          </IconButton>
                                        </MuiTooltip>
                                        <MuiTooltip title={t('common.delete')}>
                                          <IconButton 
                                            size="small" 
                                            color="error"
                                            onClick={() => setDeleteReplicationId(job.id)}
                                          >
                                            <i className="ri-delete-bin-line" style={{ fontSize: 16 }} />
                                          </IconButton>
                                        </MuiTooltip>
                                      </Stack>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </TableContainer>
                        ) : (
                          <Alert severity="info" icon={<i className="ri-information-line" />}>
                            <Typography variant="body2">
                              {t('replication.noJobs')}
                            </Typography>
                            {availableTargetNodes.length === 0 && (
                              <Typography variant="caption" sx={{ display: 'block', mt: 0.5, opacity: 0.8 }}>
                                {t('replication.noTargetNodes')}
                              </Typography>
                            )}
                          </Alert>
                        )}
                      </CardContent>
                    </Card>

                    {/* Ceph RBD Replication (Crossover) - Affiché uniquement si Ceph est disponible */}
                    {sourceCephAvailable && (
                      <Card variant="outlined" sx={{ borderRadius: 2 }}>
                        <CardContent>
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                            <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <i className="ri-cloud-line" style={{ fontSize: 20 }} />
                              {t('replication.cephReplication')}
                              <Chip size="small" label="Crossover" color="primary" sx={{ height: 20, fontSize: 10 }} />
                            </Typography>
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={<AddIcon />}
                              onClick={() => {
                                setSelectedCephCluster('')
                                setCephReplicationSchedule('*/15')
                                setCephClusters([])
                                setAddCephReplicationDialogOpen(true)
                              }}
                            >
                              {t('replication.addJob')}
                            </Button>
                          </Box>

                          {cephReplicationJobs.length > 0 ? (
                            <TableContainer>
                              <Table size="small">
                                <TableHead>
                                  <TableRow>
                                    <TableCell>{t('replication.targetCluster')}</TableCell>
                                    <TableCell>{t('replication.schedule')}</TableCell>
                                    <TableCell>{t('replication.lastSync')}</TableCell>
                                    <TableCell align="center">{t('updates.status')}</TableCell>
                                    <TableCell align="center">Actions</TableCell>
                                  </TableRow>
                                </TableHead>
                                <TableBody>
                                  {cephReplicationJobs.map((job: any, idx: number) => (
                                    <TableRow key={idx}>
                                      <TableCell>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                          <i className="ri-cloud-line" style={{ fontSize: 16, opacity: 0.7 }} />
                                          <Typography variant="body2" fontWeight={600}>{job.targetCluster}</Typography>
                                        </Box>
                                      </TableCell>
                                      <TableCell>
                                        <Chip size="small" label={job.schedule} sx={{ height: 22, fontSize: 11 }} />
                                      </TableCell>
                                      <TableCell>
                                        <Typography variant="body2" sx={{ fontSize: 12 }}>
                                          {job.lastSync ? new Date(job.lastSync).toLocaleString() : '—'}
                                        </Typography>
                                      </TableCell>
                                      <TableCell align="center">
                                        <Chip 
                                          size="small" 
                                          label={job.status} 
                                          color={job.status === 'active' ? 'success' : 'default'}
                                          sx={{ height: 22 }}
                                        />
                                      </TableCell>
                                      <TableCell align="center">
                                        <IconButton size="small" color="error">
                                          <i className="ri-delete-bin-line" style={{ fontSize: 16 }} />
                                        </IconButton>
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </TableContainer>
                          ) : (
                            <>
                              <Alert severity="info" icon={<i className="ri-information-line" />}>
                                <Typography variant="body2">
                                  {t('replication.noCephJobs')}
                                </Typography>
                              </Alert>

                              <Box sx={{ mt: 2, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                                <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
                                  {t('replication.cephFeatures')}
                                </Typography>
                                <Box component="ul" sx={{ m: 0, pl: 2, '& li': { mb: 0.5 } }}>
                                  <li><Typography variant="caption">{t('replication.featureCrossCluster')}</Typography></li>
                                  <li><Typography variant="caption">{t('replication.featureRbdMirroring')}</Typography></li>
                                  <li><Typography variant="caption">{t('replication.featureAsyncReplication')}</Typography></li>
                                  <li><Typography variant="caption">{t('replication.featureFailover')}</Typography></li>
                                </Box>
                              </Box>
                            </>
                          )}
                        </CardContent>
                      </Card>
                    )}
                  </Stack>

                  {/* Dialog Ajouter Réplication Ceph */}
                  <Dialog 
                    open={addCephReplicationDialogOpen} 
                    onClose={() => setAddCephReplicationDialogOpen(false)}
                    maxWidth="sm"
                    fullWidth
                  >
                    <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <i className="ri-cloud-line" style={{ fontSize: 24, color: '#2196f3' }} />
                      {t('replication.createCephJob')}
                    </DialogTitle>
                    <DialogContent>
                      <Stack spacing={2} sx={{ mt: 1 }}>
                        <Alert severity="info" icon={<i className="ri-information-line" />}>
                          <Typography variant="caption">
                            {t('replication.cephJobDescription')}
                          </Typography>
                        </Alert>

                        <Box>
                          <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
                            {t('replication.sourceVm')}
                          </Typography>
                          <TextField
                            fullWidth
                            size="small"
                            value={`VM ${selection?.id ? parseVmId(selection.id).vmid : ''} - ${data?.name || ''}`}
                            disabled
                          />
                        </Box>

                        <Box>
                          <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
                            {t('replication.selectTargetCluster')}
                          </Typography>
                          {cephClustersLoading ? (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 2 }}>
                              <CircularProgress size={20} />
                              <Typography variant="body2" sx={{ opacity: 0.7 }}>
                                {t('replication.loadingClusters')}
                              </Typography>
                            </Box>
                          ) : cephClusters.length > 0 ? (
                            <Stack spacing={1}>
                              {cephClusters.map((cluster: any) => (
                                <Card 
                                  key={cluster.id}
                                  variant="outlined"
                                  sx={{ 
                                    cursor: 'pointer',
                                    border: selectedCephCluster === cluster.id ? '2px solid' : '1px solid',
                                    borderColor: selectedCephCluster === cluster.id ? 'primary.main' : 'divider',
                                    bgcolor: selectedCephCluster === cluster.id ? 'primary.main' + '10' : 'transparent',
                                    '&:hover': { bgcolor: 'action.hover' }
                                  }}
                                  onClick={() => setSelectedCephCluster(cluster.id)}
                                >
                                  <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                        <i className="ri-cloud-line" style={{ fontSize: 24, opacity: 0.7 }} />
                                        <Box>
                                          <Typography variant="body2" fontWeight={600}>
                                            {cluster.name}
                                          </Typography>
                                          <Typography variant="caption" sx={{ opacity: 0.7 }}>
                                            {cluster.host}
                                          </Typography>
                                        </Box>
                                      </Box>
                                      <Chip 
                                        size="small" 
                                        label={cluster.cephHealth === 'HEALTH_OK' ? 'Healthy' : cluster.cephHealth}
                                        color={cluster.cephHealth === 'HEALTH_OK' ? 'success' : 'warning'}
                                        sx={{ height: 22, fontSize: 10 }}
                                      />
                                    </Box>
                                  </CardContent>
                                </Card>
                              ))}
                            </Stack>
                          ) : (
                            <Alert severity="warning" icon={<i className="ri-error-warning-line" />}>
                              <Typography variant="body2">
                                {t('replication.noCephClusters')}
                              </Typography>
                            </Alert>
                          )}
                        </Box>

                        {cephClusters.length > 0 && (
                          <FormControl fullWidth size="small">
                            <InputLabel>{t('replication.schedule')}</InputLabel>
                            <Select
                              value={cephReplicationSchedule}
                              label={t('replication.schedule')}
                              onChange={(e) => setCephReplicationSchedule(e.target.value)}
                            >
                              <MenuItem value="*/5">*/5 - {t('replication.every5min')}</MenuItem>
                              <MenuItem value="*/15">*/15 - {t('replication.every15min')}</MenuItem>
                              <MenuItem value="*/30">*/30 - {t('replication.every30min')}</MenuItem>
                              <MenuItem value="0">0 - {t('replication.everyHour')}</MenuItem>
                              <MenuItem value="0 */2">0 */2 - {t('replication.every2hours')}</MenuItem>
                              <MenuItem value="0 */6">0 */6 - {t('replication.every6hours')}</MenuItem>
                              <MenuItem value="0 0">0 0 - {t('replication.daily')}</MenuItem>
                            </Select>
                          </FormControl>
                        )}
                      </Stack>
                    </DialogContent>
                    <DialogActions>
                      <Button onClick={() => setAddCephReplicationDialogOpen(false)}>
                        {t('common.cancel')}
                      </Button>
                      <Button
                        variant="contained"
                        disabled={!selectedCephCluster || cephClusters.length === 0}
                        startIcon={<AddIcon />}
                        onClick={() => {
                          // TODO: Implémenter la création du job Ceph via Crossover
                          console.log('Create Ceph replication job:', {
                            vmId: selection?.id ? parseVmId(selection.id).vmid : '',
                            targetCluster: selectedCephCluster,
                            schedule: cephReplicationSchedule,
                          })
                          setAddCephReplicationDialogOpen(false)
                        }}
                      >
                        {t('replication.create')}
                      </Button>
                    </DialogActions>
                  </Dialog>

                  {/* Dialog Ajouter Réplication ZFS */}
                  <Dialog 
                    open={addReplicationDialogOpen} 
                    onClose={() => setAddReplicationDialogOpen(false)}
                    maxWidth="sm"
                    fullWidth
                  >
                    <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <i className="ri-repeat-line" style={{ fontSize: 24 }} />
                      {t('replication.createJob')}
                    </DialogTitle>
                    <DialogContent>
                      <Stack spacing={2} sx={{ mt: 1 }}>
                        <Box>
                          <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
                            CT/VM ID
                          </Typography>
                          <TextField
                            fullWidth
                            size="small"
                            value={selection?.id ? parseVmId(selection.id).vmid : ''}
                            disabled
                          />
                        </Box>

                        <FormControl fullWidth size="small">
                          <InputLabel>{t('replication.target')}</InputLabel>
                          <Select
                            value={replicationTargetNode}
                            label={t('replication.target')}
                            onChange={(e) => setReplicationTargetNode(e.target.value)}
                          >
                            {availableTargetNodes.map((node) => (
                              <MenuItem key={node} value={node}>{node}</MenuItem>
                            ))}
                          </Select>
                        </FormControl>

                        <FormControl fullWidth size="small">
                          <InputLabel>{t('replication.schedule')}</InputLabel>
                          <Select
                            value={replicationSchedule}
                            label={t('replication.schedule')}
                            onChange={(e) => setReplicationSchedule(e.target.value)}
                          >
                            <MenuItem value="*/5">*/5 - {t('replication.every5min')}</MenuItem>
                            <MenuItem value="*/15">*/15 - {t('replication.every15min')}</MenuItem>
                            <MenuItem value="*/30">*/30 - {t('replication.every30min')}</MenuItem>
                            <MenuItem value="0">0 - {t('replication.everyHour')}</MenuItem>
                            <MenuItem value="0 */2">0 */2 - {t('replication.every2hours')}</MenuItem>
                            <MenuItem value="0 */6">0 */6 - {t('replication.every6hours')}</MenuItem>
                            <MenuItem value="0 0">0 0 - {t('replication.daily')}</MenuItem>
                          </Select>
                        </FormControl>

                        <TextField
                          fullWidth
                          size="small"
                          label={t('replication.rateLimit')}
                          value={replicationRateLimit}
                          onChange={(e) => setReplicationRateLimit(e.target.value)}
                          placeholder="unlimited"
                          InputProps={{
                            endAdornment: <InputAdornment position="end">MB/s</InputAdornment>,
                          }}
                        />

                        <TextField
                          fullWidth
                          size="small"
                          label={t('replication.comment')}
                          value={replicationComment}
                          onChange={(e) => setReplicationComment(e.target.value)}
                          multiline
                          rows={2}
                        />
                      </Stack>
                    </DialogContent>
                    <DialogActions>
                      <Button onClick={() => setAddReplicationDialogOpen(false)}>
                        {t('common.cancel')}
                      </Button>
                      <Button
                        variant="contained"
                        disabled={!replicationTargetNode || savingReplication}
                        startIcon={savingReplication ? <CircularProgress size={16} /> : <AddIcon />}
                        onClick={async () => {
                          if (!selection?.id || !replicationTargetNode) return
                          setSavingReplication(true)
                          const { connId, node, vmid } = parseVmId(selection.id)
                          try {
                            const body: any = {
                              target: replicationTargetNode,
                              schedule: replicationSchedule,
                            }
                            if (replicationRateLimit) body.rate = replicationRateLimit
                            if (replicationComment) body.comment = replicationComment

                            const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/replication`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ ...body, guest: vmid }),
                            })
                            
                            if (res.ok) {
                              setAddReplicationDialogOpen(false)
                              setReplicationLoaded(false)
                            }
                          } catch (e) {
                            console.error('Error creating replication job:', e)
                          } finally {
                            setSavingReplication(false)
                          }
                        }}
                      >
                        {t('replication.create')}
                      </Button>
                    </DialogActions>
                  </Dialog>

                  {/* Dialog Confirmer suppression */}
                  <Dialog 
                    open={!!deleteReplicationId} 
                    onClose={() => setDeleteReplicationId(null)}
                    maxWidth="xs"
                    fullWidth
                  >
                    <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <i className="ri-error-warning-line" style={{ fontSize: 24, color: '#f44336' }} />
                      {t('replication.deleteJob')}
                    </DialogTitle>
                    <DialogContent>
                      <Typography variant="body2">
                        {t('replication.confirmDelete')}
                      </Typography>
                    </DialogContent>
                    <DialogActions>
                      <Button onClick={() => setDeleteReplicationId(null)}>
                        {t('common.cancel')}
                      </Button>
                      <Button
                        variant="contained"
                        color="error"
                        onClick={async () => {
                          if (!selection?.id || !deleteReplicationId) return
                          const { connId, node } = parseVmId(selection.id)
                          try {
                            await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/replication/${encodeURIComponent(deleteReplicationId)}`, {
                              method: 'DELETE',
                            })
                            setDeleteReplicationId(null)
                            setReplicationLoaded(false)
                          } catch (e) {
                            console.error('Error deleting replication job:', e)
                          }
                        }}
                      >
                        {t('common.delete')}
                      </Button>
                    </DialogActions>
                  </Dialog>
                </Box>
              )}

              {/* ==================== ONGLET 8 - HA (seulement pour les clusters) ==================== */}
              {detailTab === 8 && selectedVmIsCluster && (
                <Box sx={{ py: 2 }}>
                  <Card variant="outlined" sx={{ borderRadius: 2 }}>
                    <CardContent>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                        <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <i className="ri-shield-check-line" style={{ fontSize: 20 }} />
                          High Availability (HA)
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 1 }}>
                          {haConfig && !haEditing && (
                            <Button
                              size="small"
                              variant="outlined"
                              color="error"
                              startIcon={<i className="ri-delete-bin-line" />}
                              onClick={removeHaConfig}
                              disabled={haSaving}
                            >
                              {t('audit.actions.disable')}
                            </Button>
                          )}
                          {!haEditing && (
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={<i className="ri-edit-line" />}
                              onClick={() => setHaEditing(true)}
                            >
                              {haConfig ? t('common.edit') : t('common.enabled')}
                            </Button>
                          )}
                        </Box>
                      </Box>

                      {/* Loading */}
                      {haLoading && (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                          <CircularProgress size={32} />
                        </Box>
                      )}

                      {/* Error */}
                      {haError && (
                        <Alert severity="error" sx={{ mb: 2 }}>{haError}</Alert>
                      )}

                      {/* Avertissement cluster */}
                      {!haLoading && (
                        <Alert severity="info" sx={{ mb: 2 }}>
                          <Typography variant="body2">
                            {t('inventory.haQuorumRecommendation')}
                          </Typography>
                        </Alert>
                      )}

                      {/* Contenu HA */}
                      {!haLoading && !haError && (
                        <>
                          {haEditing ? (
                            <Box>
                              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mb: 2 }}>
                                <Box>
                                  <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
                                    VM:
                                  </Typography>
                                  <Typography variant="body2" sx={{ opacity: 0.7 }}>
                                    {selection?.type === 'vm' ? parseVmId(selection.id).vmid : ''}
                                  </Typography>
                                </Box>
                                <FormControl fullWidth size="small">
                                  <InputLabel>Group</InputLabel>
                                  <Select
                                    value={haGroup}
                                    onChange={(e) => setHaGroup(e.target.value)}
                                    label="Group"
                                  >
                                    <MenuItem value="">
                                      <em>{t('common.none')}</em>
                                    </MenuItem>
                                    {haGroups.map((g: any) => (
                                      <MenuItem key={g.group} value={g.group}>
                                        {g.group}
                                      </MenuItem>
                                    ))}
                                  </Select>
                                </FormControl>
                                
                                <TextField
                                  label="Max. Restart"
                                  type="number"
                                  size="small"
                                  value={haMaxRestart}
                                  onChange={(e) => setHaMaxRestart(parseInt(e.target.value) || 0)}
                                  inputProps={{ min: 0, max: 10 }}
                                />
                                <FormControl fullWidth size="small">
                                  <InputLabel>Request State</InputLabel>
                                  <Select
                                    value={haState}
                                    onChange={(e) => setHaState(e.target.value)}
                                    label="Request State"
                                  >
                                    <MenuItem value="started">started</MenuItem>
                                    <MenuItem value="stopped">stopped</MenuItem>
                                    <MenuItem value="enabled">enabled</MenuItem>
                                    <MenuItem value="disabled">disabled</MenuItem>
                                    <MenuItem value="ignored">ignored</MenuItem>
                                  </Select>
                                </FormControl>
                                
                                <TextField
                                  label="Max. Relocate"
                                  type="number"
                                  size="small"
                                  value={haMaxRelocate}
                                  onChange={(e) => setHaMaxRelocate(parseInt(e.target.value) || 0)}
                                  inputProps={{ min: 0, max: 10 }}
                                />
                                <Box />
                                
                                <TextField
                                  label="Comment"
                                  size="small"
                                  value={haComment}
                                  onChange={(e) => setHaComment(e.target.value)}
                                  sx={{ gridColumn: '1 / -1' }}
                                />
                              </Box>
                              
                              <Stack direction="row" spacing={1} justifyContent="flex-end">
                                <Button
                                  variant="outlined"
                                  onClick={() => {
                                    setHaEditing(false)
                                    loadHaConfig() // Recharger la config originale
                                  }}
                                  disabled={haSaving}
                                >
                                  {t('common.cancel')}
                                </Button>
                                <Button
                                  variant="contained"
                                  onClick={saveHaConfig}
                                  disabled={haSaving}
                                  startIcon={haSaving ? <CircularProgress size={16} /> : <SaveIcon />}
                                >
                                  {haSaving ? t('common.saving') : (haConfig ? t('common.save') : t('common.enabled'))}
                                </Button>
                              </Stack>
                            </Box>
                          ) : haConfig ? (
                            <Box
                              sx={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(2, 1fr)',
                                gap: 2,
                                p: 2,
                                bgcolor: 'action.hover',
                                borderRadius: 1,
                              }}
                            >
                              <Box>
                                <Typography variant="caption" sx={{ opacity: 0.7 }}>État</Typography>
                                <Typography variant="body2" fontWeight={600}>
                                  <Chip 
                                    label={haConfig.state || 'started'} 
                                    size="small" 
                                    color={haConfig.state === 'started' || haConfig.state === 'enabled' ? 'success' : 'default'}
                                  />
                                </Typography>
                              </Box>
                              <Box>
                                <Typography variant="caption" sx={{ opacity: 0.7 }}>Groupe</Typography>
                                <Typography variant="body2" fontWeight={600}>
                                  {haConfig.group || <span style={{ opacity: 0.5 }}>{t('common.none')}</span>}
                                </Typography>
                              </Box>
                              <Box>
                                <Typography variant="caption" sx={{ opacity: 0.7 }}>Max Restart</Typography>
                                <Typography variant="body2" fontWeight={600}>
                                  {haConfig.max_restart ?? 1}
                                </Typography>
                              </Box>
                              <Box>
                                <Typography variant="caption" sx={{ opacity: 0.7 }}>Max Relocate</Typography>
                                <Typography variant="body2" fontWeight={600}>
                                  {haConfig.max_relocate ?? 1}
                                </Typography>
                              </Box>
                              {haConfig.comment && (
                                <Box sx={{ gridColumn: '1 / -1' }}>
                                  <Typography variant="caption" sx={{ opacity: 0.7 }}>Commentaire</Typography>
                                  <Typography variant="body2">
                                    {haConfig.comment}
                                  </Typography>
                                </Box>
                              )}
                            </Box>
                          ) : (
                            <Box
                              sx={{
                                p: 3,
                                bgcolor: 'action.hover',
                                borderRadius: 1,
                                textAlign: 'center',
                              }}
                            >
                              <i className="ri-shield-cross-line" style={{ fontSize: 48, opacity: 0.3 }} />
                              <Typography variant="body2" sx={{ opacity: 0.5, mt: 1 }}>
                                {t('inventory.haNotEnabled')}
                              </Typography>
                              <Typography variant="caption" sx={{ opacity: 0.4 }}>
                                {t('common.noData')}
                              </Typography>
                            </Box>
                          )}
                        </>
                      )}
                    </CardContent>
                  </Card>
                </Box>
              )}

              {/* ==================== ONGLET FIREWALL (8 si cluster, 7 sinon) ==================== */}
              {((selectedVmIsCluster && detailTab === 9) || (!selectedVmIsCluster && detailTab === 8)) && selection?.type === 'vm' && (
                <VmFirewallTab
                  connectionId={parseVmId(selection.id).connId}
                  node={parseVmId(selection.id).node}
                  vmType={data.vmType as 'qemu' | 'lxc'}
                  vmid={parseInt(parseVmId(selection.id).vmid)}
                  vmName={data.name}
                />
              )}

            </>
          )}

          {/* Onglets pour Cluster: Summary / Nodes / VMs / HA / Backups / Notes / Ceph / Storage / Firewall / Rolling Update / Cluster */}
          {selection?.type === 'cluster' && data.nodesData ? (
            <Card variant="outlined" sx={{ width: '100%', borderRadius: 2, flex: 1, display: 'flex', flexDirection: 'column' }}>
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
                      Summary
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-server-line" style={{ fontSize: 16 }} />
                      Nodes
                      <Chip size="small" label={data.nodesData.length} sx={{ height: 18, fontSize: 11 }} />
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-computer-line" style={{ fontSize: 16 }} />
                      {t('inventory.vms')}
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
                      High Availability
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-calendar-schedule-line" style={{ fontSize: 16 }} />
                      Backups
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-file-text-line" style={{ fontSize: 16 }} />
                      Notes
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-database-2-line" style={{ fontSize: 16 }} />
                      Ceph
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-hard-drive-2-line" style={{ fontSize: 16 }} />
                      Storage
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-shield-keyhole-line" style={{ fontSize: 16 }} />
                      Firewall
                    </Box>
                  }
                />
                <Tab
                  disabled={!rollingUpdateAvailable}
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, opacity: rollingUpdateAvailable ? 1 : 0.4 }}>
                      <i className="ri-refresh-line" style={{ fontSize: 16 }} />
                      Rolling Update
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
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-git-branch-line" style={{ fontSize: 16 }} />
                      Cluster
                    </Box>
                  }
                />
              </Tabs>
              
              <CardContent sx={{ p: 0, '&:last-child': { pb: 0 }, flex: 1, display: 'flex', flexDirection: 'column' }}>
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
                            Health
                          </Typography>
                          <Grid container spacing={3}>
                              {/* Status */}
                              <Grid size={4} sx={{ textAlign: 'center' }}>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>Status</Typography>
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
                                  Cluster: {data.title}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  Quorate: Yes
                                </Typography>
                              </Grid>
                              {/* Nodes */}
                              <Grid size={4} sx={{ textAlign: 'center' }}>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>Nodes</Typography>
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'success.main' }} />
                                    <Typography variant="body2">Online</Typography>
                                    <Typography variant="body2" fontWeight={700}>
                                      {(data.nodesData as any[])?.filter((n: any) => n.status === 'online').length || 0}
                                    </Typography>
                                  </Box>
                                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'error.main' }} />
                                    <Typography variant="body2">Offline</Typography>
                                    <Typography variant="body2" fontWeight={700}>
                                      {(data.nodesData as any[])?.filter((n: any) => n.status !== 'online').length || 0}
                                    </Typography>
                                  </Box>
                                </Box>
                              </Grid>
                              {/* Ceph */}
                              <Grid size={4} sx={{ textAlign: 'center' }}>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>Ceph</Typography>
                                <Box sx={{ 
                                  width: 48, 
                                  height: 48, 
                                  borderRadius: '50%', 
                                  bgcolor: data.cephHealth === 'HEALTH_OK' ? 'success.main' : 
                                           data.cephHealth === 'HEALTH_WARN' ? 'warning.main' : 
                                           data.cephHealth ? 'error.main' : 'action.disabledBackground',
                                  display: 'flex', 
                                  alignItems: 'center', 
                                  justifyContent: 'center',
                                  mx: 'auto',
                                  mb: 1
                                }}>
                                  <i className={data.cephHealth ? "ri-check-line" : "ri-question-line"} style={{ fontSize: 24, color: '#fff' }} />
                                </Box>
                                <Typography variant="caption">
                                  {data.cephHealth === 'HEALTH_OK' ? 'Healthy' : 
                                   data.cephHealth === 'HEALTH_WARN' ? 'Warning' : 
                                   data.cephHealth ? 'Error' : 'N/A'}
                                </Typography>
                              </Grid>
                            </Grid>
                          </CardContent>
                        </Card>

                      {/* Section Guests */}
                      <Card variant="outlined" sx={{ height: '100%' }}>
                        <CardContent sx={{ p: 2 }}>
                            <Typography variant="subtitle2" color="primary" fontWeight={700} sx={{ mb: 2 }}>
                              Guests
                            </Typography>
                            <Grid container spacing={2}>
                              {/* Virtual Machines */}
                              <Grid size={6}>
                                <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>Virtual Machines</Typography>
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
                                        <Typography variant="body2">Running</Typography>
                                        <Typography variant="body2" fontWeight={700} sx={{ ml: 'auto' }}>{running}</Typography>
                                      </Box>
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'text.disabled' }} />
                                        <Typography variant="body2">Stopped</Typography>
                                        <Typography variant="body2" fontWeight={700} sx={{ ml: 'auto' }}>{stopped}</Typography>
                                      </Box>
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'transparent', border: '1px solid', borderColor: 'text.disabled' }} />
                                        <Typography variant="body2">Templates</Typography>
                                        <Typography variant="body2" fontWeight={700} sx={{ ml: 'auto' }}>{templates}</Typography>
                                      </Box>
                                    </Box>
                                  )
                                })()}
                              </Grid>
                              {/* LXC Containers */}
                              <Grid size={6}>
                                <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>LXC Containers</Typography>
                                {(() => {
                                  const allVms = (data as any).allVms || []
                                  const lxcVms = allVms.filter((v: any) => v.type === 'lxc')
                                  const running = lxcVms.filter((v: any) => v.status === 'running').length
                                  const stopped = lxcVms.filter((v: any) => v.status === 'stopped').length
                                  return (
                                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'success.main' }} />
                                        <Typography variant="body2">Running</Typography>
                                        <Typography variant="body2" fontWeight={700} sx={{ ml: 'auto' }}>{running}</Typography>
                                      </Box>
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'text.disabled' }} />
                                        <Typography variant="body2">Stopped</Typography>
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
                            Resources
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
                                
                                const formatBytes = (bytes: number) => {
                                  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(2)} TiB`
                                  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`
                                  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MiB`
                                  return `${bytes} B`
                                }
                                
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
                                          thickness={4}
                                          sx={{ color: cpuPercent > 80 ? 'error.main' : cpuPercent > 60 ? 'warning.main' : 'success.main' }}
                                        />
                                        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                          <Typography variant="h6" fontWeight={700}>{cpuPercent}%</Typography>
                                        </Box>
                                      </Box>
                                      <Typography variant="caption" sx={{ display: 'block' }}>
                                        {nodes.length} nodes
                                      </Typography>
                                    </Grid>
                                    {/* Memory */}
                                    <Grid size={{ xs: 12, md: 4 }} sx={{ textAlign: 'center' }}>
                                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>Memory</Typography>
                                      <Box sx={{ position: 'relative', display: 'inline-flex', mb: 1 }}>
                                        <CircularProgress
                                          variant="determinate"
                                          value={memPercent}
                                          size={80}
                                          thickness={4}
                                          sx={{ color: memPercent > 80 ? 'error.main' : memPercent > 60 ? 'warning.main' : 'success.main' }}
                                        />
                                        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                          <Typography variant="h6" fontWeight={700}>{memPercent}%</Typography>
                                        </Box>
                                      </Box>
                                      <Typography variant="caption" sx={{ display: 'block' }}>
                                        {formatBytes(usedMem)} of {formatBytes(totalMem)}
                                      </Typography>
                                    </Grid>
                                    {/* Storage */}
                                    <Grid size={{ xs: 12, md: 4 }} sx={{ textAlign: 'center' }}>
                                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>Storage</Typography>
                                      <Box sx={{ position: 'relative', display: 'inline-flex', mb: 1 }}>
                                        <CircularProgress
                                          variant="determinate"
                                          value={storagePercent}
                                          size={80}
                                          thickness={4}
                                          sx={{ color: storagePercent > 80 ? 'error.main' : storagePercent > 60 ? 'warning.main' : 'success.main' }}
                                        />
                                        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                          <Typography variant="h6" fontWeight={700}>{storagePercent}%</Typography>
                                        </Box>
                                      </Box>
                                      <Typography variant="caption" sx={{ display: 'block' }}>
                                        {formatBytes(usedStorage)} of {formatBytes(totalStorage)}
                                      </Typography>
                                    </Grid>
                                  </>
                                )
                              })()}
                            </Grid>
                          </CardContent>
                        </Card>
                    </Box>

                    {/* Section Nodes Table */}
                    <Card variant="outlined">
                      <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                        <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}>
                          <Typography variant="subtitle2" color="primary" fontWeight={700}>
                            Nodes
                          </Typography>
                        </Box>
                        <TableContainer>
                              <Table size="small">
                                <TableHead>
                                  <TableRow>
                                    <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                                    <TableCell sx={{ fontWeight: 700 }}>ID</TableCell>
                                    <TableCell sx={{ fontWeight: 700 }}>Online</TableCell>
                                    <TableCell sx={{ fontWeight: 700 }}>Support</TableCell>
                                    <TableCell sx={{ fontWeight: 700 }}>Server Address</TableCell>
                                    <TableCell sx={{ fontWeight: 700 }}>CPU usage</TableCell>
                                    <TableCell sx={{ fontWeight: 700 }}>Memory usage</TableCell>
                                    <TableCell sx={{ fontWeight: 700 }}>Uptime</TableCell>
                                  </TableRow>
                                </TableHead>
                                <TableBody>
                                  {(data.nodesData as any[])?.map((node: any, idx: number) => {
                                    // node.cpu et node.ram sont déjà des pourcentages (0-100)
                                    const cpuPercent = node.cpu || 0
                                    const memPercent = node.ram || 0
                                    const formatUptime = (seconds: number) => {
                                      const days = Math.floor(seconds / 86400)
                                      const hours = Math.floor((seconds % 86400) / 3600)
                                      const mins = Math.floor((seconds % 3600) / 60)
                                      const secs = Math.floor(seconds % 60)
                                      if (days > 0) return `${days} days ${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
                                      return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
                                    }
                                    return (
                                      <TableRow key={idx} hover sx={{ cursor: 'pointer' }} onClick={() => onSelect?.({ type: 'node', id: node.id })}>
                                        <TableCell sx={{ fontWeight: 600 }}>{node.node || node.name}</TableCell>
                                        <TableCell>{idx + 1}</TableCell>
                                        <TableCell>
                                          {node.status === 'online' ? (
                                            <i className="ri-check-line" style={{ color: '#4caf50' }} />
                                          ) : (
                                            <i className="ri-close-line" style={{ color: '#f44336' }} />
                                          )}
                                        </TableCell>
                                        <TableCell>
                                          <Chip size="small" label="Community" sx={{ height: 20, fontSize: 10 }} />
                                        </TableCell>
                                        <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{node.ip || '-'}</TableCell>
                                        <TableCell>{cpuPercent}%</TableCell>
                                        <TableCell>
                                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <LinearProgress 
                                              variant="determinate" 
                                              value={memPercent} 
                                              sx={{ 
                                                width: 60, 
                                                height: 6, 
                                                borderRadius: 1,
                                                bgcolor: 'action.hover',
                                                '& .MuiLinearProgress-bar': {
                                                  bgcolor: memPercent > 80 ? 'error.main' : memPercent > 60 ? 'warning.main' : 'primary.main'
                                                }
                                              }} 
                                            />
                                            <Typography variant="caption">{memPercent}%</Typography>
                                          </Box>
                                        </TableCell>
                                        <TableCell sx={{ fontSize: 12 }}>{node.uptime ? formatUptime(node.uptime) : '-'}</TableCell>
                                      </TableRow>
                                    )
                                  })}
                                </TableBody>
                              </Table>
                        </TableContainer>
                      </CardContent>
                    </Card>
                  </Box>
                )}

                {/* Onglet Nodes - Index 1 */}
                {clusterTab === 1 && data.nodesData.length > 0 && (
                  <NodesTable
                    nodes={data.nodesData as NodeRow[]}
                    compact
                    maxHeight="auto"
                    onNodeClick={(node) => {
                      onSelect?.({ type: 'node', id: node.id })
                    }}
                    onBulkAction={handleNodeBulkAction}
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
                                    className={isExpanded ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} 
                                    style={{ fontSize: 18, opacity: 0.7 }} 
                                  />
                                  <Box 
                                    sx={{ 
                                      width: 8, 
                                      height: 8, 
                                      borderRadius: '50%', 
                                      bgcolor: node.status === 'online' ? 'success.main' : 'error.main' 
                                    }} 
                                  />
                                  <Typography fontWeight={600}>{node.name}</Typography>
                                  <Chip 
                                    size="small" 
                                    label={`${nodeVms.length} VMs`} 
                                    sx={{ height: 20, fontSize: 11 }} 
                                  />
                                </Box>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                  <Typography variant="caption" sx={{ opacity: 0.6 }}>
                                    CPU: {node.cpu?.toFixed(1) || 0}%
                                  </Typography>
                                  <Typography variant="caption" sx={{ opacity: 0.6 }}>
                                    RAM: {node.ram?.toFixed(1) || 0}%
                                  </Typography>
                                </Box>
                              </Box>
                              
                              {/* Liste des VMs du node (collapsible) */}
                              {isExpanded && nodeVms.length > 0 && (
                                <Box sx={{ bgcolor: 'background.default' }}>
                                  <VmsTable
                                    vms={nodeVms as VmRow[]}
                                    compact
                                    maxHeight={400}
                                    showActions={true}
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
                                  <Typography variant="body2">No VMs on this node</Typography>
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
                    {clusterHaLoading ? (
                      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                        <CircularProgress size={24} />
                      </Box>
                    ) : (
                      <Stack spacing={3}>
                        {/* Badge version PVE */}
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Chip 
                            size="small" 
                            label={`Proxmox VE ${clusterPveMajorVersion}.x`}
                            color={clusterPveMajorVersion >= 9 ? 'success' : 'default'}
                            sx={{ height: 22 }}
                          />
                          {clusterPveMajorVersion >= 9 && (
                            <Typography variant="caption" sx={{ opacity: 0.6 }}>
                              {t('drs.affinityRules')}
                            </Typography>
                          )}
                        </Box>

                        {/* Section Ressources HA */}
                        <Box>
                          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                            <i className="ri-stack-line" style={{ fontSize: 18, opacity: 0.7 }} />
                            Ressources ({clusterHaResources.length})
                          </Typography>
                          
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
                                  ? '100px 100px 150px 100px 100px 200px'
                                  : '100px 100px 150px 100px 100px 1fr 200px',
                                gap: 1,
                                px: 1.5,
                                py: 1,
                                bgcolor: 'action.hover',
                                borderBottom: '1px solid',
                                borderColor: 'divider',
                                '& > *': { fontWeight: 600, fontSize: 12, opacity: 0.8 }
                              }}>
                                <Typography variant="caption">ID</Typography>
                                <Typography variant="caption">State</Typography>
                                <Typography variant="caption">Node</Typography>
                                <Typography variant="caption">Max. Restart</Typography>
                                <Typography variant="caption">Max. Reloc.</Typography>
                                {clusterPveMajorVersion < 9 && <Typography variant="caption">Group</Typography>}
                                <Typography variant="caption">Description</Typography>
                              </Box>
                              {/* Rows */}
                              {clusterHaResources.map((res: any) => (
                                <Box 
                                  key={res.sid}
                                  sx={{ 
                                    display: 'grid', 
                                    gridTemplateColumns: clusterPveMajorVersion >= 9 
                                      ? '100px 100px 150px 100px 100px 200px'
                                      : '100px 100px 150px 100px 100px 1fr 200px',
                                    gap: 1,
                                    px: 1.5,
                                    py: 0.75,
                                    borderBottom: '1px solid',
                                    borderColor: 'divider',
                                    '&:last-child': { borderBottom: 'none' },
                                    '&:hover': { bgcolor: 'action.hover' }
                                  }}
                                >
                                  <Typography variant="body2" sx={{ fontFamily: 'monospace', color: 'primary.main' }}>
                                    {res.sid}
                                  </Typography>
                                  <Box>
                                    <Chip 
                                      size="small" 
                                      label={res.state || 'started'} 
                                      color={res.state === 'started' || res.state === 'enabled' ? 'success' : res.state === 'ignored' ? 'warning' : 'default'}
                                      sx={{ height: 20, fontSize: 11 }} 
                                    />
                                  </Box>
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
                                Groupes ({clusterHaGroups.length})
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
                                  <Typography variant="caption">Group</Typography>
                                  <Typography variant="caption">Restricted</Typography>
                                  <Typography variant="caption">Nofailback</Typography>
                                  <Typography variant="caption">Nodes</Typography>
                                  <Typography variant="caption">Comment</Typography>
                                  <Typography variant="caption" sx={{ textAlign: 'center' }}>Actions</Typography>
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
                                      {group.restricted ? 'Yes' : 'No'}
                                    </Typography>
                                    <Typography variant="body2">
                                      {group.nofailback ? 'Yes' : 'No'}
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
                                  Node Affinity Rules ({clusterHaRules.filter((r: any) => r.type === 'node-affinity').length})
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
                                    <Typography variant="caption">Enabled</Typography>
                                    <Typography variant="caption">State</Typography>
                                    <Typography variant="caption">Strict</Typography>
                                    <Typography variant="caption">HA Resources</Typography>
                                    <Typography variant="caption">Nodes</Typography>
                                    <Typography variant="caption" sx={{ textAlign: 'center' }}>Actions</Typography>
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
                                          label={rule.state === 'disabled' ? 'No' : 'Yes'} 
                                          color={rule.state === 'disabled' ? 'default' : 'success'}
                                          sx={{ height: 20, fontSize: 11 }} 
                                        />
                                      </Box>
                                      <Typography variant="body2" sx={{ opacity: 0.8 }}>
                                        {rule.state || 'enabled'}
                                      </Typography>
                                      <Typography variant="body2">
                                        {rule.strict ? 'Yes' : 'No'}
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
                                  Resource Affinity Rules ({clusterHaRules.filter((r: any) => r.type === 'resource-affinity').length})
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
                                    <Typography variant="caption">Enabled</Typography>
                                    <Typography variant="caption">State</Typography>
                                    <Typography variant="caption">Affinity</Typography>
                                    <Typography variant="caption">HA Resources</Typography>
                                    <Typography variant="caption" sx={{ textAlign: 'center' }}>Actions</Typography>
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
                                          label={rule.state === 'disabled' ? 'No' : 'Yes'} 
                                          color={rule.state === 'disabled' ? 'default' : 'success'}
                                          sx={{ height: 20, fontSize: 11 }} 
                                        />
                                      </Box>
                                      <Typography variant="body2" sx={{ opacity: 0.8 }}>
                                        {rule.state || 'enabled'}
                                      </Typography>
                                      <Chip 
                                        size="small" 
                                        label={rule.affinity === 'positive' ? 'Keep Together' : 'Keep Separate'} 
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

                {/* Onglet Notes - Index 5 */}
                {clusterTab === 5 && (
                  <Box sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                      <Typography variant="subtitle1" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <i className="ri-file-text-line" style={{ fontSize: 20 }} />
                        Datacenter Notes
                      </Typography>
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<i className="ri-edit-line" />}
                        onClick={() => setClusterNotesEditMode(!clusterNotesEditMode)}
                      >
                        {clusterNotesEditMode ? 'Cancel' : 'Edit'}
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
                          placeholder="Enter datacenter notes here... (supports Markdown)"
                          sx={{ flex: 1, fontFamily: 'monospace' }}
                        />
                        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                          <Button
                            variant="contained"
                            startIcon={<i className="ri-save-line" />}
                            onClick={handleSaveClusterNotes}
                            disabled={clusterNotesSaving}
                          >
                            {clusterNotesSaving ? 'Saving...' : 'Save'}
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
                            dangerouslySetInnerHTML={{ __html: parseMarkdown(clusterNotesContent) }}
                            sx={{ 
                              '& img': { maxWidth: '100%', height: 'auto' },
                              '& a': { color: 'primary.main' },
                              '& table': { borderCollapse: 'collapse', width: '100%' },
                              '& th, & td': { border: '1px solid', borderColor: 'divider', p: 1 },
                              '& h1': { fontSize: '1.8em', fontWeight: 700, mt: 2, mb: 1 },
                              '& h2': { fontSize: '1.5em', fontWeight: 700, mt: 2, mb: 1 },
                              '& h3': { fontSize: '1.2em', fontWeight: 700, mt: 1.5, mb: 0.5 },
                              '& p': { my: 1 },
                              '& ul, & ol': { pl: 3, my: 1 },
                              '& li': { my: 0.5 },
                              '& code': { bgcolor: 'action.hover', px: 0.5, borderRadius: 0.5, fontFamily: 'monospace', fontSize: '0.9em' },
                              '& pre': { bgcolor: 'grey.900', p: 2, borderRadius: 1, overflow: 'auto', '& code': { bgcolor: 'transparent', p: 0 } },
                              '& blockquote': { borderLeft: '4px solid', borderColor: 'primary.main', pl: 2, ml: 0, opacity: 0.8, fontStyle: 'italic' },
                              '& hr': { border: 'none', borderTop: '1px solid', borderColor: 'divider', my: 2 },
                            }}
                          />
                        ) : (
                          <Box sx={{ textAlign: 'center', py: 4, opacity: 0.5 }}>
                            <i className="ri-file-text-line" style={{ fontSize: 48 }} />
                            <Typography sx={{ mt: 1 }}>No notes</Typography>
                          </Box>
                        )}
                      </Box>
                    )}
                  </Box>
                )}

                {/* Onglet Ceph - Index 6 */}
                {clusterTab === 6 && (
                  <Box sx={{ p: 2 }}>
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
                              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>Health</Typography>
                              <Box sx={{ display: 'flex', gap: 3 }}>
                                {/* Status avec icône */}
                                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 100 }}>
                                  <Typography variant="caption" fontWeight={600} sx={{ mb: 1 }}>Status</Typography>
                                  <Box sx={{ 
                                    width: 56, 
                                    height: 56, 
                                    borderRadius: '50%', 
                                    bgcolor: clusterCephData.health?.status === 'HEALTH_OK' ? 'success.main' : 
                                             clusterCephData.health?.status === 'HEALTH_WARN' ? 'warning.main' : 'error.main',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    mb: 1
                                  }}>
                                    <i className={clusterCephData.health?.status === 'HEALTH_OK' ? 'ri-checkbox-circle-fill' : 'ri-alert-fill'} style={{ fontSize: 28, color: 'white' }} />
                                  </Box>
                                  <Typography variant="body2" fontWeight={700}>
                                    {clusterCephData.health?.status || 'Unknown'}
                                  </Typography>
                                </Box>
                                
                                {/* Summary - Warnings/Errors */}
                                <Box sx={{ flex: 1, borderLeft: '1px solid', borderColor: 'divider', pl: 2 }}>
                                  <Typography variant="caption" fontWeight={600} sx={{ mb: 1, display: 'block' }}>Summary</Typography>
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
                                      No Warnings/Errors
                                    </Typography>
                                  )}
                                </Box>
                              </Box>
                              
                              {/* Ceph Version en bas */}
                              {clusterCephData.version && (
                                <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
                                  <Typography variant="caption" sx={{ opacity: 0.7 }}>Ceph Version</Typography>
                                  <Typography variant="body2" fontWeight={600}>{clusterCephData.version}</Typography>
                                </Box>
                              )}
                            </CardContent>
                          </Card>

                          {/* Status Card - OSDs & PGs */}
                          <Card variant="outlined">
                            <CardContent>
                              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>Status</Typography>
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
                            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>Services</Typography>
                            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' }, gap: 2 }}>
                              <Box>
                                <Typography variant="caption" sx={{ opacity: 0.7 }}>Monitors</Typography>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                                  {clusterCephData.monmap?.mons?.map((mon: any) => (
                                    <MuiTooltip 
                                      key={mon.name} 
                                      title={
                                        <Box sx={{ p: 0.5 }}>
                                          <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>Monitor: {mon.name}</Typography>
                                          {mon.addr && <Typography variant="caption" sx={{ display: 'block' }}>Address: {mon.addr}</Typography>}
                                          {mon.public_addr && <Typography variant="caption" sx={{ display: 'block' }}>Public: {mon.public_addr}</Typography>}
                                          <Typography variant="caption" sx={{ display: 'block', color: '#4caf50' }}>Status: running</Typography>
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
                                <Typography variant="caption" sx={{ opacity: 0.7 }}>Managers</Typography>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                                  {clusterCephData.mgrmap?.active_name && (
                                    <MuiTooltip 
                                      title={
                                        <Box sx={{ p: 0.5 }}>
                                          <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>Manager: {clusterCephData.mgrmap.active_name}</Typography>
                                          {clusterCephData.mgrmap.active_addr && <Typography variant="caption" sx={{ display: 'block' }}>Address: {clusterCephData.mgrmap.active_addr}</Typography>}
                                          <Typography variant="caption" sx={{ display: 'block', color: '#4caf50' }}>Status: active</Typography>
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
                                          <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>Manager: {mgr.name}</Typography>
                                          {mgr.addr && <Typography variant="caption" sx={{ display: 'block' }}>Address: {mgr.addr}</Typography>}
                                          <Typography variant="caption" sx={{ display: 'block', color: '#ff9800' }}>Status: standby</Typography>
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
                                <Typography variant="caption" sx={{ opacity: 0.7 }}>Metadata Servers</Typography>
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
                                          {mds.addr && <Typography variant="caption" sx={{ display: 'block' }}>Address: {mds.addr}</Typography>}
                                          {mds.host && <Typography variant="caption" sx={{ display: 'block' }}>Host: {mds.host}</Typography>}
                                          {mds.rank !== undefined && <Typography variant="caption" sx={{ display: 'block' }}>Rank: {mds.rank}</Typography>}
                                          <Typography variant="caption" sx={{ display: 'block', color: mds.state === 'standby' ? '#ff9800' : '#4caf50' }}>
                                            Status: {mds.state || 'active'}
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
                              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>Usage</Typography>
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
                                  <Typography variant="caption" sx={{ opacity: 0.7 }}>Used</Typography>
                                  <Typography variant="body2" fontWeight={600}>
                                    {clusterCephData.pgmap?.bytes_used ? formatBytes(clusterCephData.pgmap.bytes_used) : '—'}
                                  </Typography>
                                  <Typography variant="caption" sx={{ opacity: 0.7, display: 'block', mt: 1 }}>Total</Typography>
                                  <Typography variant="body2" fontWeight={600}>
                                    {clusterCephData.pgmap?.bytes_total ? formatBytes(clusterCephData.pgmap.bytes_total) : '—'}
                                  </Typography>
                                </Box>
                              </Box>
                            </CardContent>
                          </Card>

                          {/* Performance - Données en temps réel */}
                          <Card variant="outlined">
                            <CardContent>
                              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>
                                Performance
                                <Typography component="span" variant="caption" sx={{ ml: 1, opacity: 0.6 }}>
                                  (live)
                                </Typography>
                              </Typography>
                              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                                <Box>
                                  <Typography variant="caption" sx={{ opacity: 0.7 }}>Reads:</Typography>
                                  <Typography variant="body1" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    {clusterCephPerf?.read_bytes_sec ? formatBps(clusterCephPerf.read_bytes_sec) : '0 B/s'}
                                    <TrendIcon trend={cephTrends.read_bytes} />
                                  </Typography>
                                </Box>
                                <Box>
                                  <Typography variant="caption" sx={{ opacity: 0.7 }}>Writes:</Typography>
                                  <Typography variant="body1" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    {clusterCephPerf?.write_bytes_sec ? formatBps(clusterCephPerf.write_bytes_sec) : '0 B/s'}
                                    <TrendIcon trend={cephTrends.write_bytes} />
                                  </Typography>
                                </Box>
                                <Box>
                                  <Typography variant="caption" sx={{ opacity: 0.7 }}>IOPS Reads:</Typography>
                                  <Typography variant="body1" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    {clusterCephPerf?.read_op_per_sec?.toLocaleString() || 0}
                                    <TrendIcon trend={cephTrends.read_iops} />
                                  </Typography>
                                </Box>
                                <Box>
                                  <Typography variant="caption" sx={{ opacity: 0.7 }}>IOPS Writes:</Typography>
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
                                Performance History
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
                              <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                  <Typography variant="caption" fontWeight={600} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    Reads:
                                    <TrendIcon trend={cephTrends.read_bytes} />
                                  </Typography>
                                  <Typography variant="caption" fontWeight={700}>
                                    {clusterCephPerf?.read_bytes_sec ? formatBps(clusterCephPerf.read_bytes_sec) : '0 B/s'}
                                  </Typography>
                                </Box>
                                <Box sx={{ height: 100 }}>
                                  <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={clusterCephPerfFiltered}>
                                      <YAxis hide domain={[0, 'auto']} />
                                      <Tooltip
                                        contentStyle={{ backgroundColor: '#1e1e2f', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
                                        labelFormatter={(_, payload) => {
                                          if (payload && payload[0]?.payload?.time) {
                                            return new Date(payload[0].payload.time).toLocaleTimeString()
                                          }
                                          return ''
                                        }}
                                        formatter={(value: number) => [formatBps(value), 'Reads']}
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
                                </Box>
                              </Box>

                              {/* Writes Graph */}
                              <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                  <Typography variant="caption" fontWeight={600} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    Writes:
                                    <TrendIcon trend={cephTrends.write_bytes} />
                                  </Typography>
                                  <Typography variant="caption" fontWeight={700}>
                                    {clusterCephPerf?.write_bytes_sec ? formatBps(clusterCephPerf.write_bytes_sec) : '0 B/s'}
                                  </Typography>
                                </Box>
                                <Box sx={{ height: 100 }}>
                                  <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={clusterCephPerfFiltered}>
                                      <YAxis hide domain={[0, 'auto']} />
                                      <Tooltip
                                        contentStyle={{ backgroundColor: '#1e1e2f', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
                                        labelFormatter={(_, payload) => {
                                          if (payload && payload[0]?.payload?.time) {
                                            return new Date(payload[0].payload.time).toLocaleTimeString()
                                          }
                                          return ''
                                        }}
                                        formatter={(value: number) => [formatBps(value), 'Writes']}
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
                                </Box>
                              </Box>

                              {/* IOPS Reads Graph */}
                              <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                  <Typography variant="caption" fontWeight={600} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    IOPS Reads:
                                    <TrendIcon trend={cephTrends.read_iops} />
                                  </Typography>
                                  <Typography variant="caption" fontWeight={700}>
                                    {clusterCephPerf?.read_op_per_sec?.toLocaleString() || 0}
                                  </Typography>
                                </Box>
                                <Box sx={{ height: 100 }}>
                                  <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={clusterCephPerfFiltered}>
                                      <YAxis hide domain={[0, 'auto']} />
                                      <Tooltip
                                        contentStyle={{ backgroundColor: '#1e1e2f', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
                                        labelFormatter={(_, payload) => {
                                          if (payload && payload[0]?.payload?.time) {
                                            return new Date(payload[0].payload.time).toLocaleTimeString()
                                          }
                                          return ''
                                        }}
                                        formatter={(value: number) => [value?.toLocaleString() + ' IOPS', 'Reads']}
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
                                </Box>
                              </Box>

                              {/* IOPS Writes Graph */}
                              <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                  <Typography variant="caption" fontWeight={600} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    IOPS Writes:
                                    <TrendIcon trend={cephTrends.write_iops} />
                                  </Typography>
                                  <Typography variant="caption" fontWeight={700}>
                                    {clusterCephPerf?.write_op_per_sec?.toLocaleString() || 0}
                                  </Typography>
                                </Box>
                                <Box sx={{ height: 100 }}>
                                  <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={clusterCephPerfFiltered}>
                                      <YAxis hide domain={[0, 'auto']} />
                                      <Tooltip
                                        contentStyle={{ backgroundColor: '#1e1e2f', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
                                        labelFormatter={(_, payload) => {
                                          if (payload && payload[0]?.payload?.time) {
                                            return new Date(payload[0].payload.time).toLocaleTimeString()
                                          }
                                          return ''
                                        }}
                                        formatter={(value: number) => [value?.toLocaleString() + ' IOPS', 'Writes']}
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
                                </Box>
                              </Box>
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
                          Ceph not installed on this cluster
                        </Typography>
                        <Typography variant="body2" sx={{ opacity: 0.7, mb: 3, maxWidth: 500, mx: 'auto' }}>
                          Ceph is a distributed storage system that provides high availability, scalability, 
                          and excellent performance. Install Ceph on your cluster nodes to enable distributed 
                          storage with RBD, CephFS, and Object Gateway support.
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap' }}>
                          <Button
                            variant="contained"
                            startIcon={<i className="ri-download-cloud-line" />}
                            disabled
                          >
                            Install Ceph
                          </Button>
                          <Button
                            variant="outlined"
                            startIcon={<i className="ri-external-link-line" />}
                            href="https://pve.proxmox.com/wiki/Deploy_Hyper-Converged_Ceph_Cluster"
                            target="_blank"
                          >
                            Documentation
                          </Button>
                        </Box>
                        <Typography variant="caption" sx={{ display: 'block', mt: 2, opacity: 0.5 }}>
                          Installation wizard coming soon - Use Proxmox VE directly for now
                        </Typography>
                      </Box>
                    )}
                  </Box>
                )}

                {/* Onglet Storage - Index 7 */}
                {clusterTab === 7 && (
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
                              <TableCell sx={{ fontWeight: 700 }}>ID</TableCell>
                              <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
                              <TableCell sx={{ fontWeight: 700 }}>Content</TableCell>
                              <TableCell sx={{ fontWeight: 700 }}>Path/Target</TableCell>
                              <TableCell sx={{ fontWeight: 700 }} align="center">Shared</TableCell>
                              <TableCell sx={{ fontWeight: 700 }} align="center">Enabled</TableCell>
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
                                      <Typography variant="caption" sx={{ opacity: 0.5 }}>No</Typography>
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
                                    <Typography sx={{ mt: 1 }}>No storage configured</Typography>
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

                {/* Onglet Firewall - Index 8 */}
                {clusterTab === 8 && (
                  <ClusterFirewallTab
                    connectionId={selection?.id?.split(':')[0] || ''}
                  />
                )}

                {/* Onglet Rolling Update - Index 9 */}
                {clusterTab === 9 && (
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
                          startIcon={<i className="ri-refresh-line" />}
                          onClick={() => {
                            setNodeUpdates({})
                            setNodeLocalVms({})
                          }}
                        >
                          {t('updates.refresh')}
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
                                          <i className="ri-server-line" style={{ fontSize: 16, opacity: 0.7 }} />
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
                          
                          const totalUpdates = Object.values(nodeUpdates).reduce((sum, n) => sum + n.count, 0)
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

                      {/* Bouton démarrer le Rolling Update */}
                      {Object.values(nodeUpdates).reduce((sum, n) => sum + n.count, 0) > 0 ? (
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
                      ) : Object.keys(nodeUpdates).length > 0 ? (
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

                {/* Onglet Cluster - Index 10 */}
                {clusterTab === 10 && (
                  <Box sx={{ p: 2 }}>
                    {clusterConfigLoading ? (
                      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                        <CircularProgress size={24} />
                      </Box>
                    ) : (
                      <Stack spacing={3}>
                        {/* Header avec boutons */}
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Typography variant="subtitle1" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <i className="ri-information-line" style={{ fontSize: 20 }} />
                            Cluster Information
                          </Typography>
                          <Stack direction="row" spacing={1}>
                            {clusterConfig?.isCluster && (
                              <Button
                                variant="outlined"
                                size="small"
                                startIcon={<i className="ri-key-line" />}
                                onClick={() => setJoinInfoDialogOpen(true)}
                              >
                                Join Information
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
                                    label="Cluster Active" 
                                    color="success" 
                                    size="small"
                                  />
                                  <Typography variant="h6" fontWeight={700}>
                                    {clusterConfig?.clusterName || 'Unnamed Cluster'}
                                  </Typography>
                                </Box>
                                {clusterConfig?.clusterStatus && (
                                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2 }}>
                                    <Box>
                                      <Typography variant="caption" sx={{ opacity: 0.7 }}>Config Version</Typography>
                                      <Typography variant="body2" fontWeight={600}>
                                        {clusterConfig.clusterStatus.version || '—'}
                                      </Typography>
                                    </Box>
                                    <Box>
                                      <Typography variant="caption" sx={{ opacity: 0.7 }}>Quorum</Typography>
                                      <Typography variant="body2" fontWeight={600}>
                                        <Chip 
                                          size="small" 
                                          label={clusterConfig.clusterStatus.quorate ? 'Yes' : 'No'} 
                                          color={clusterConfig.clusterStatus.quorate ? 'success' : 'error'}
                                          sx={{ height: 20, fontSize: 11 }}
                                        />
                                      </Typography>
                                    </Box>
                                    <Box>
                                      <Typography variant="caption" sx={{ opacity: 0.7 }}>Nodes</Typography>
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
                                  Standalone node - no cluster defined
                                </Typography>
                                <Typography variant="caption" sx={{ opacity: 0.6 }}>
                                  Create a new cluster or join an existing one
                                </Typography>
                                <Stack direction="row" spacing={2} justifyContent="center" sx={{ mt: 3 }}>
                                  <Button
                                    variant="contained"
                                    startIcon={<i className="ri-add-circle-line" />}
                                    onClick={() => setCreateClusterDialogOpen(true)}
                                  >
                                    Create Cluster
                                  </Button>
                                  <Button
                                    variant="outlined"
                                    startIcon={<i className="ri-links-line" />}
                                    onClick={() => setJoinClusterDialogOpen(true)}
                                  >
                                    Join Cluster
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
                                  Cluster Nodes
                                </Typography>
                              </Box>
                              <Box>
                                {/* Header */}
                                <Box sx={{ 
                                  display: 'grid', 
                                  gridTemplateColumns: '2fr 1fr 1fr 1fr', 
                                  gap: 2, 
                                  px: 2, 
                                  py: 1, 
                                  bgcolor: 'action.hover',
                                  borderBottom: '1px solid',
                                  borderColor: 'divider'
                                }}>
                                  <Typography variant="caption" fontWeight={600}>Nodename</Typography>
                                  <Typography variant="caption" fontWeight={600}>ID</Typography>
                                  <Typography variant="caption" fontWeight={600}>Votes</Typography>
                                  <Typography variant="caption" fontWeight={600}>Link 0</Typography>
                                </Box>
                                {/* Rows */}
                                {clusterConfig.nodes.map((node: any) => (
                                  <Box 
                                    key={node.name}
                                    sx={{ 
                                      display: 'grid', 
                                      gridTemplateColumns: '2fr 1fr 1fr 1fr', 
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
                                      <Box 
                                        sx={{ 
                                          width: 8, 
                                          height: 8, 
                                          borderRadius: '50%', 
                                          bgcolor: node.online ? 'success.main' : 'error.main' 
                                        }} 
                                      />
                                      <Typography variant="body2" fontWeight={node.local ? 700 : 400}>
                                        {node.name}
                                        {node.local && <Chip size="small" label="local" sx={{ ml: 1, height: 16, fontSize: 9 }} />}
                                      </Typography>
                                    </Box>
                                    <Typography variant="body2">{node.id}</Typography>
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
              </CardContent>
            </Card>
          ) : null}

          {/* Dialog Join Information */}
          <Dialog open={joinInfoDialogOpen} onClose={() => setJoinInfoDialogOpen(false)} maxWidth="md" fullWidth>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <i className="ri-key-line" style={{ color: '#2196f3' }} />
              Cluster Join Information
            </DialogTitle>
            <DialogContent>
              <Typography variant="body2" sx={{ mb: 2 }}>
                Copy the Join Information here and use it on the node you want to add.
              </Typography>
              {clusterConfig?.joinInfo && (
                <Stack spacing={2.5}>
                  <Box>
                    <Typography variant="caption" fontWeight={600} sx={{ color: 'text.secondary' }}>IP Address:</Typography>
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
                    <Typography variant="caption" fontWeight={600} sx={{ color: 'text.secondary' }}>Fingerprint:</Typography>
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
                    <Typography variant="caption" fontWeight={600} sx={{ color: 'text.secondary' }}>Join Information:</Typography>
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
                Copy Information
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
              Create Cluster
            </DialogTitle>
            <DialogContent>
              {clusterActionError && (
                <Alert severity="error" sx={{ mb: 2 }} onClose={() => setClusterActionError(null)}>
                  {clusterActionError}
                </Alert>
              )}
              <Stack spacing={2} sx={{ mt: 1 }}>
                <TextField
                  label="Cluster Name"
                  value={newClusterName}
                  onChange={(e) => setNewClusterName(e.target.value)}
                  size="small"
                  fullWidth
                  required
                  placeholder="my-cluster"
                />
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>Cluster Network</Typography>
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
                      No network interfaces available
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
                {clusterActionLoading ? <CircularProgress size={20} /> : 'Create'}
              </Button>
            </DialogActions>
          </Dialog>

          {/* Dialog Join Cluster */}
          <Dialog open={joinClusterDialogOpen} onClose={() => setJoinClusterDialogOpen(false)} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <i className="ri-links-line" style={{ color: '#2196f3' }} />
              Cluster Join
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
                  Assisted join: Paste encoded cluster join information and enter password.
                </Typography>
              </Box>
              <Stack spacing={2}>
                <TextField
                  label="Information"
                  value={joinClusterInfo}
                  onChange={(e) => setJoinClusterInfo(e.target.value)}
                  size="small"
                  fullWidth
                  multiline
                  rows={4}
                  placeholder="Paste encoded Cluster Information here"
                  required
                />
                <TextField
                  label="Password"
                  type="password"
                  value={joinClusterPassword}
                  onChange={(e) => setJoinClusterPassword(e.target.value)}
                  size="small"
                  fullWidth
                  required
                  helperText="Root password of the node to join"
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
                {clusterActionLoading ? <CircularProgress size={20} /> : 'Join'}
              </Button>
            </DialogActions>
          </Dialog>

          {/* Onglets pour Node: Summary / Notes / Shell / VMs / Disks / System / Ceph (si cluster) / Backups / Cluster (si standalone) / Replication / Subscription */}
          {selection?.type === 'node' && data.vmsData ? (
            <Card variant="outlined" sx={{ width: '100%', borderRadius: 2, flex: 1, display: 'flex', flexDirection: 'column' }}>
              <Tabs
                value={nodeTab}
                onChange={(_e, v) => setNodeTab(v)}
                sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}
                variant="scrollable"
                scrollButtons="auto"
              >
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-line-chart-line" style={{ fontSize: 16 }} />
                      Summary
                    </Box>
                  }
                />
                {/* Onglet Notes */}
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-file-text-line" style={{ fontSize: 16 }} />
                      Notes
                    </Box>
                  }
                />
                {/* Onglet Shell */}
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-terminal-box-line" style={{ fontSize: 16 }} />
                      Shell
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-computer-line" style={{ fontSize: 16 }} />
                      {t('inventory.vms')}
                      <Chip size="small" label={data.vmsData.length} sx={{ height: 18, fontSize: 11 }} />
                    </Box>
                  }
                />
                {/* Onglet Disks pour tous les nodes */}
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-hard-drive-2-line" style={{ fontSize: 16 }} />
                      Disks
                    </Box>
                  }
                />
                {/* Onglet System pour tous les nodes */}
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-settings-3-line" style={{ fontSize: 16 }} />
                      System
                    </Box>
                  }
                />
                {/* Onglet Ceph seulement pour les nodes dans un cluster */}
                {data.clusterName && (
                  <Tab
                    label={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <i className="ri-database-2-line" style={{ fontSize: 16 }} />
                        Ceph
                      </Box>
                    }
                  />
                )}
                {/* Onglet Backups seulement pour les hosts standalone (pas dans un cluster) */}
                {!data.clusterName && (
                  <Tab
                    label={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <i className="ri-calendar-schedule-line" style={{ fontSize: 16 }} />
                        Backups
                      </Box>
                    }
                  />
                )}
                {/* Onglet Cluster seulement pour les hosts standalone */}
                {!data.clusterName && (
                  <Tab
                    label={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <i className="ri-git-branch-line" style={{ fontSize: 16 }} />
                        Cluster
                      </Box>
                    }
                  />
                )}
                {/* Onglet Replication pour tous les nodes */}
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-refresh-line" style={{ fontSize: 16 }} />
                      Replication
                    </Box>
                  }
                />
                {/* Onglet Subscription pour tous les nodes */}
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-vip-crown-line" style={{ fontSize: 16 }} />
                      Subscription
                    </Box>
                  }
                />
              </Tabs>

              <CardContent sx={{ p: 0, '&:last-child': { pb: 0 }, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
                {/* Onglet Summary - Graphiques RRD */}
                {nodeTab === 0 && canShowRrd && (
                  <Box sx={{ p: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
                      <Typography fontWeight={700} fontSize={14}>{t('inventory.performances')}</Typography>
                      <Box sx={{ display: 'flex', gap: 0.5 }}>
                        {[
                          { label: '1h', value: 'hour' as RrdTimeframe },
                          { label: '24h', value: 'day' as RrdTimeframe },
                          { label: '7j', value: 'week' as RrdTimeframe },
                          { label: '30j', value: 'month' as RrdTimeframe },
                          { label: '1an', value: 'year' as RrdTimeframe },
                        ].map(opt => (
                          <Chip
                            key={opt.value}
                            label={opt.label}
                            size="small"
                            onClick={() => setTf(opt.value)}
                            sx={{
                              height: 24,
                              fontSize: 11,
                              fontWeight: 600,
                              bgcolor: tf === opt.value ? 'primary.main' : 'action.hover',
                              color: tf === opt.value ? 'primary.contrastText' : 'text.secondary',
                              '&:hover': { bgcolor: tf === opt.value ? 'primary.dark' : 'action.selected' },
                              cursor: 'pointer',
                            }}
                          />
                        ))}
                      </Box>
                    </Box>

                    {rrdLoading ? (
                      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                        <CircularProgress size={32} />
                      </Box>
                    ) : rrdError ? (
                      <Alert severity="error" sx={{ mb: 2 }}>{rrdError}</Alert>
                    ) : (
                      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
                        {/* CPU Usage */}
                        <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                          <Typography variant="caption" fontWeight={600} sx={{ mb: 1, display: 'block' }}>
                            CPU Usage
                          </Typography>
                          <Box sx={{ height: 160 }}>
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={series}>
                                <XAxis dataKey="t" tickFormatter={v => formatTime(Number(v))} minTickGap={40} tick={{ fontSize: 9 }} />
                                <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 9 }} width={30} />
                                <Tooltip
                                  labelFormatter={v => new Date(Number(v)).toLocaleString()}
                                  formatter={(v: any) => [`${Number(v).toFixed(1)}%`, 'CPU']}
                                />
                                <Area type="monotone" dataKey="cpuPct" stroke={primaryColor} fill={primaryColor} fillOpacity={0.4} strokeWidth={1.5} isAnimationActive={false} />
                              </AreaChart>
                            </ResponsiveContainer>
                          </Box>
                        </Box>

                        {/* Memory Usage */}
                        <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                          <Typography variant="caption" fontWeight={600} sx={{ mb: 1, display: 'block' }}>
                            Memory Usage
                          </Typography>
                          <Box sx={{ height: 160 }}>
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={series}>
                                <XAxis dataKey="t" tickFormatter={v => formatTime(Number(v))} minTickGap={40} tick={{ fontSize: 9 }} />
                                <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 9 }} width={30} />
                                <Tooltip
                                  labelFormatter={v => new Date(Number(v)).toLocaleString()}
                                  formatter={(v: any) => [`${Number(v).toFixed(1)}%`, 'Memory']}
                                />
                                <Area type="monotone" dataKey="ramPct" stroke={primaryColor} fill={primaryColor} fillOpacity={0.4} strokeWidth={1.5} isAnimationActive={false} />
                              </AreaChart>
                            </ResponsiveContainer>
                          </Box>
                        </Box>

                        {/* Network Traffic */}
                        <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                          <Typography variant="caption" fontWeight={600} sx={{ mb: 1, display: 'block' }}>
                            Network Traffic
                          </Typography>
                          <Box sx={{ height: 160 }}>
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={series}>
                                <XAxis dataKey="t" tickFormatter={v => formatTime(Number(v))} minTickGap={40} tick={{ fontSize: 9 }} />
                                <YAxis tickFormatter={v => formatBps(Number(v))} tick={{ fontSize: 9 }} width={50} domain={[0, 'auto']} />
                                <Tooltip
                                  labelFormatter={v => new Date(Number(v)).toLocaleString()}
                                  formatter={(v: any, name: string) => [formatBps(Number(v)), name === 'netInBps' ? 'In' : 'Out']}
                                />
                                <Area type="monotone" dataKey="netInBps" stroke={primaryColor} fill={primaryColor} fillOpacity={0.4} strokeWidth={1.5} isAnimationActive={false} name="netInBps" connectNulls />
                                <Area type="monotone" dataKey="netOutBps" stroke={primaryColorLight} fill={primaryColorLight} fillOpacity={0.4} strokeWidth={1.5} isAnimationActive={false} name="netOutBps" connectNulls />
                              </AreaChart>
                            </ResponsiveContainer>
                          </Box>
                        </Box>

                        {/* Server Load (nodes) ou Disk I/O (VMs) */}
                        <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                          <Typography variant="caption" fontWeight={600} sx={{ mb: 1, display: 'block' }}>
                            {selection?.type === 'node' ? 'Server Load' : 'Disk I/O'}
                          </Typography>
                          <Box sx={{ height: 160 }}>
                            <ResponsiveContainer width="100%" height="100%">
                              {selection?.type === 'node' ? (
                                <AreaChart data={series}>
                                  <XAxis dataKey="t" tickFormatter={v => formatTime(Number(v))} minTickGap={40} tick={{ fontSize: 9 }} />
                                  <YAxis tick={{ fontSize: 9 }} width={30} domain={[0, 'auto']} />
                                  <Tooltip
                                    labelFormatter={v => new Date(Number(v)).toLocaleString()}
                                    formatter={(v: any) => [Number(v).toFixed(2), 'Load']}
                                  />
                                  <Area type="monotone" dataKey="loadAvg" stroke={primaryColor} fill={primaryColor} fillOpacity={0.4} strokeWidth={1.5} isAnimationActive={false} connectNulls />
                                </AreaChart>
                              ) : (
                                <AreaChart data={series}>
                                  <XAxis dataKey="t" tickFormatter={v => formatTime(Number(v))} minTickGap={40} tick={{ fontSize: 9 }} />
                                  <YAxis tickFormatter={v => formatBps(Number(v))} tick={{ fontSize: 9 }} width={50} domain={[0, 'auto']} />
                                  <Tooltip
                                    labelFormatter={v => new Date(Number(v)).toLocaleString()}
                                    formatter={(v: any, name: string) => [formatBps(Number(v)), name === 'diskReadBps' ? 'Read' : 'Write']}
                                  />
                                  <Area type="monotone" dataKey="diskReadBps" stroke={primaryColor} fill={primaryColor} fillOpacity={0.4} strokeWidth={1.5} isAnimationActive={false} name="diskReadBps" connectNulls />
                                  <Area type="monotone" dataKey="diskWriteBps" stroke={primaryColorLight} fill={primaryColorLight} fillOpacity={0.4} strokeWidth={1.5} isAnimationActive={false} name="diskWriteBps" connectNulls />
                                </AreaChart>
                              )}
                            </ResponsiveContainer>
                          </Box>
                        </Box>
                      </Box>
                    )}
                  </Box>
                )}

                {nodeTab === 0 && !canShowRrd && (
                  <Box sx={{ p: 4, textAlign: 'center', opacity: 0.5 }}>
                    <i className="ri-line-chart-line" style={{ fontSize: 48, marginBottom: 8 }} />
                    <Typography>{t('common.noData')}</Typography>
                  </Box>
                )}

                {/* Onglet Notes - Index 1 */}
                {nodeTab === 1 && (
                  <Box sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                      <Typography variant="subtitle2" fontWeight={700}>Node Notes</Typography>
                      {!nodeNotesEditing ? (
                        <Button 
                          size="small" 
                          variant="outlined"
                          startIcon={<i className="ri-edit-line" style={{ fontSize: 14 }} />}
                          onClick={() => {
                            setNodeNotesEditValue(nodeNotesData)
                            setNodeNotesEditing(true)
                          }}
                        >
                          Edit
                        </Button>
                      ) : (
                        <Box sx={{ display: 'flex', gap: 1 }}>
                          <Button 
                            size="small" 
                            variant="outlined"
                            onClick={() => setNodeNotesEditing(false)}
                          >
                            Cancel
                          </Button>
                          <Button 
                            size="small" 
                            variant="contained"
                            disabled={nodeNotesSaving}
                            onClick={async () => {
                              setNodeNotesSaving(true)
                              const { connId, node } = parseNodeId(selection?.id || '')
                              try {
                                const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/notes`, {
                                  method: 'PUT',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ notes: nodeNotesEditValue })
                                })
                                if (res.ok) {
                                  setNodeNotesData(nodeNotesEditValue)
                                  setNodeNotesEditing(false)
                                } else {
                                  const err = await res.json()
                                  alert(err.error || 'Failed to save notes')
                                }
                              } finally {
                                setNodeNotesSaving(false)
                              }
                            }}
                          >
                            {nodeNotesSaving ? <CircularProgress size={20} /> : 'Save'}
                          </Button>
                        </Box>
                      )}
                    </Box>
                    {nodeNotesLoading ? (
                      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                        <CircularProgress size={24} />
                      </Box>
                    ) : nodeNotesEditing ? (
                      <TextField
                        fullWidth
                        multiline
                        rows={15}
                        value={nodeNotesEditValue}
                        onChange={(e) => setNodeNotesEditValue(e.target.value)}
                        placeholder="Enter notes for this node..."
                        sx={{ flex: 1, '& textarea': { fontFamily: 'inherit' } }}
                      />
                    ) : (
                      <Card variant="outlined" sx={{ flex: 1 }}>
                        <CardContent sx={{ height: '100%' }}>
                          {nodeNotesData ? (
                            <Box 
                              sx={{ 
                                whiteSpace: 'pre-wrap', 
                                wordBreak: 'break-word',
                                fontFamily: 'inherit',
                                fontSize: 14
                              }}
                            >
                              {nodeNotesData}
                            </Box>
                          ) : (
                            <Box sx={{ textAlign: 'center', opacity: 0.5, py: 4 }}>
                              <i className="ri-file-text-line" style={{ fontSize: 48 }} />
                              <Typography sx={{ mt: 1 }}>No notes for this node</Typography>
                              <Typography variant="caption">Click Edit to add notes</Typography>
                            </Box>
                          )}
                        </CardContent>
                      </Card>
                    )}
                  </Box>
                )}

                {/* Onglet Shell - Index 2 */}
                {nodeTab === 2 && (
                  <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                    {!nodeShellData ? (
                      // Pas encore de session - afficher le bouton de connexion
                      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#1e1e1e' }}>
                        <Box sx={{ textAlign: 'center' }}>
                          <i className="ri-terminal-box-line" style={{ fontSize: 64, color: '#444' }} />
                          <Typography sx={{ mt: 2, color: '#888' }}>Node Shell</Typography>
                          <Typography variant="caption" sx={{ color: '#666', display: 'block', mt: 1, mb: 3 }}>
                            Connect to the node's command line interface
                          </Typography>
                          <Button 
                            variant="contained"
                            disabled={nodeShellLoading}
                            startIcon={nodeShellLoading ? <CircularProgress size={16} /> : <i className="ri-terminal-box-line" />}
                            onClick={async () => {
                              setNodeShellLoading(true)
                              const { connId, node } = parseNodeId(selection?.id || '')
                              try {
                                const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/terminal`, {
                                  method: 'POST'
                                })
                                if (res.ok) {
                                  const json = await res.json()
                                  setNodeShellData({ ...json.data, node })
                                  setNodeShellConnected(true)
                                } else {
                                  const err = await res.json()
                                  alert(err.error || 'Failed to create terminal session')
                                }
                              } catch (e: any) {
                                alert(e.message || 'Failed to create terminal session')
                              } finally {
                                setNodeShellLoading(false)
                              }
                            }}
                          >
                            {nodeShellLoading ? 'Connecting...' : 'Connect to Shell'}
                          </Button>
                        </Box>
                      </Box>
                    ) : (
                      // Session active - afficher le terminal xterm.js
                      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                        {/* Lazy load du composant XTermShell */}
                        {(() => {
                          const XTermShell = require('@/components/xterm/XTermShell').default
                          return (
                            <XTermShell
                              wsUrl={nodeShellData.wsUrl}
                              host={nodeShellData.host}
                              port={nodeShellData.port}
                              ticket={nodeShellData.ticket}
                              node={nodeShellData.node}
                              pvePort={nodeShellData.nodePort}
                              apiToken={nodeShellData.apiToken}
                              onDisconnect={() => {
                                setNodeShellData(null)
                                setNodeShellConnected(false)
                              }}
                            />
                          )
                        })()}
                      </Box>
                    )}
                  </Box>
                )}

                {/* Onglet VMs - Index 3 */}
                {nodeTab === 3 && (
                  <>
                    <Box sx={{ 
                      px: 2, 
                      py: 1.5, 
                      borderBottom: '1px solid', 
                      borderColor: 'divider',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-end'
                    }}>
                      <Button
                        size="small"
                        variant={expandedVmsTable ? 'contained' : 'outlined'}
                        onClick={() => setExpandedVmsTable(!expandedVmsTable)}
                        startIcon={<i className={expandedVmsTable ? 'ri-collapse-diagonal-line' : 'ri-expand-diagonal-line'} />}
                        sx={{ 
                          textTransform: 'none',
                          fontSize: '0.75rem',
                        }}
                      >
                        {expandedVmsTable ? t('inventory.compactView') : t('inventory.fullView')}
                      </Button>
                    </Box>
                    {data.vmsData.length > 0 ? (
                      <VmsTable
                        vms={data.vmsData as VmRow[]}
                        compact={!expandedVmsTable}
                        expanded={expandedVmsTable}
                        maxHeight={expandedVmsTable ? 500 : 400}
                        showTrends={expandedVmsTable}
                        showActions={true}
                        onLoadTrendsBatch={loadVmTrendsBatch}
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
                    ) : (
                      <Box sx={{ p: 4, textAlign: 'center', opacity: 0.5 }}>
                        <i className="ri-computer-line" style={{ fontSize: 48, marginBottom: 8 }} />
                        <Typography>No VMs on this node</Typography>
                      </Box>
                    )}
                  </>
                )}

                {/* Onglet Disks - Index 4 */}
                {nodeTab === 4 && (
                  <Box sx={{ p: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
                    {nodeDisksLoading ? (
                      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                        <CircularProgress size={24} />
                      </Box>
                    ) : nodeDisksData ? (
                      <>
                        {/* Sous-onglets Disks */}
                        <Tabs
                          value={nodeDisksSubTab}
                          onChange={(_e, v) => setNodeDisksSubTab(v)}
                          sx={{ borderBottom: 1, borderColor: 'divider', px: 2, minHeight: 40 }}
                        >
                          <Tab label="Disks" sx={{ minHeight: 40, py: 0 }} />
                          <Tab label="LVM" sx={{ minHeight: 40, py: 0 }} />
                          <Tab label="LVM-Thin" sx={{ minHeight: 40, py: 0 }} />
                          <Tab label="Directory" sx={{ minHeight: 40, py: 0 }} />
                          <Tab label="ZFS" sx={{ minHeight: 40, py: 0 }} />
                        </Tabs>

                        <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
                          {/* Disks - Liste des disques physiques */}
                          {nodeDisksSubTab === 0 && (
                            <Card variant="outlined">
                              <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                                <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <Typography variant="subtitle2" fontWeight={700}>Physical Disks</Typography>
                                  <Box sx={{ display: 'flex', gap: 1 }}>
                                    <Button size="small" variant="outlined" startIcon={<i className="ri-refresh-line" style={{ fontSize: 14 }} />}
                                      onClick={async () => {
                                        setNodeDisksLoading(true)
                                        const { connId, node } = parseNodeId(selection?.id || '')
                                        try {
                                          const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/disks?section=disks`, { cache: 'no-store' })
                                          if (res.ok) {
                                            const json = await res.json()
                                            setNodeDisksData((prev: any) => ({ ...prev, disks: json.data?.disks || [] }))
                                          }
                                        } finally {
                                          setNodeDisksLoading(false)
                                        }
                                      }}
                                    >
                                      Reload
                                    </Button>
                                  </Box>
                                </Box>
                                {(Array.isArray(nodeDisksData.disks) ? nodeDisksData.disks : []).length > 0 ? (
                                  <TableContainer sx={{ maxHeight: 400 }}>
                                    <Table size="small" stickyHeader>
                                      <TableHead>
                                        <TableRow>
                                          <TableCell sx={{ fontWeight: 700 }}>Device</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Usage</TableCell>
                                          <TableCell sx={{ fontWeight: 700, textAlign: 'right' }}>Size</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Model</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Serial</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Health</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Wearout</TableCell>
                                        </TableRow>
                                      </TableHead>
                                      <TableBody>
                                        {nodeDisksData.disks.map((disk: any, idx: number) => (
                                          <TableRow key={idx} hover>
                                            <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{disk.devpath}</TableCell>
                                            <TableCell>
                                              <Chip 
                                                size="small" 
                                                label={disk.type?.toUpperCase() || 'HDD'} 
                                                color={disk.type === 'nvme' || disk.type === 'ssd' ? 'info' : 'default'}
                                                sx={{ height: 20, fontSize: 10 }}
                                              />
                                            </TableCell>
                                            <TableCell>
                                              {disk.used ? (
                                                <Chip 
                                                  size="small" 
                                                  label={disk.used} 
                                                  color={disk.used === 'unused' ? 'default' : 'primary'}
                                                  variant="outlined"
                                                  sx={{ height: 20, fontSize: 10 }}
                                                />
                                              ) : (
                                                <Typography variant="caption" sx={{ opacity: 0.5 }}>-</Typography>
                                              )}
                                            </TableCell>
                                            <TableCell sx={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>
                                              {disk.size ? `${(disk.size / 1024 / 1024 / 1024).toFixed(1)} GiB` : '-'}
                                            </TableCell>
                                            <TableCell sx={{ fontSize: 12, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                              {disk.model || '-'}
                                            </TableCell>
                                            <TableCell sx={{ fontFamily: 'monospace', fontSize: 11, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                              {disk.serial || '-'}
                                            </TableCell>
                                            <TableCell>
                                              {disk.health ? (
                                                <Chip 
                                                  size="small" 
                                                  label={disk.health} 
                                                  color={disk.health === 'PASSED' ? 'success' : disk.health === 'FAILED' ? 'error' : 'warning'}
                                                  sx={{ height: 20, fontSize: 10 }}
                                                />
                                              ) : (
                                                <Typography variant="caption" sx={{ opacity: 0.5 }}>-</Typography>
                                              )}
                                            </TableCell>
                                            <TableCell>
                                              {disk.wearout !== undefined && disk.wearout !== null ? (
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                  <LinearProgress 
                                                    variant="determinate" 
                                                    value={100 - (disk.wearout || 0)} 
                                                    sx={{ width: 50, height: 6, borderRadius: 1 }}
                                                    color={disk.wearout > 20 ? 'success' : disk.wearout > 5 ? 'warning' : 'error'}
                                                  />
                                                  <Typography variant="caption">{disk.wearout}%</Typography>
                                                </Box>
                                              ) : (
                                                <Typography variant="caption" sx={{ opacity: 0.5 }}>N/A</Typography>
                                              )}
                                            </TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </TableContainer>
                                ) : (
                                  <Box sx={{ p: 4, textAlign: 'center', opacity: 0.5 }}>
                                    <i className="ri-hard-drive-2-line" style={{ fontSize: 32 }} />
                                    <Typography variant="body2" sx={{ mt: 1 }}>No disks found</Typography>
                                  </Box>
                                )}
                              </CardContent>
                            </Card>
                          )}

                          {/* LVM */}
                          {nodeDisksSubTab === 1 && (
                            <Card variant="outlined">
                              <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                                <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <Typography variant="subtitle2" fontWeight={700}>LVM Volume Groups</Typography>
                                  <Box sx={{ display: 'flex', gap: 1 }}>
                                    <Button size="small" variant="outlined" startIcon={<i className="ri-refresh-line" style={{ fontSize: 14 }} />}>Reload</Button>
                                    <Button size="small" variant="outlined" disabled startIcon={<i className="ri-add-line" style={{ fontSize: 14 }} />}>Create: Volume Group</Button>
                                  </Box>
                                </Box>
                                {(Array.isArray(nodeDisksData.lvm) ? nodeDisksData.lvm : []).length > 0 ? (
                                  <TableContainer sx={{ maxHeight: 400 }}>
                                    <Table size="small" stickyHeader>
                                      <TableHead>
                                        <TableRow>
                                          <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                                          <TableCell sx={{ fontWeight: 700, textAlign: 'right' }}>Size</TableCell>
                                          <TableCell sx={{ fontWeight: 700, textAlign: 'right' }}>Free</TableCell>
                                          <TableCell sx={{ fontWeight: 700, textAlign: 'center' }}># LVs</TableCell>
                                          <TableCell sx={{ fontWeight: 700, textAlign: 'center' }}># PVs</TableCell>
                                        </TableRow>
                                      </TableHead>
                                      <TableBody>
                                        {nodeDisksData.lvm.map((vg: any, idx: number) => (
                                          <TableRow key={idx} hover>
                                            <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{vg.name}</TableCell>
                                            <TableCell sx={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>
                                              {vg.size ? `${(vg.size / 1024 / 1024 / 1024).toFixed(2)} GiB` : '-'}
                                            </TableCell>
                                            <TableCell sx={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>
                                              {vg.free ? `${(vg.free / 1024 / 1024 / 1024).toFixed(2)} GiB` : '-'}
                                            </TableCell>
                                            <TableCell sx={{ textAlign: 'center' }}>{vg.lvcount ?? '-'}</TableCell>
                                            <TableCell sx={{ textAlign: 'center' }}>{vg.pvcount ?? '-'}</TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </TableContainer>
                                ) : (
                                  <Box sx={{ p: 4, textAlign: 'center', opacity: 0.5 }}>
                                    <i className="ri-stack-line" style={{ fontSize: 32 }} />
                                    <Typography variant="body2" sx={{ mt: 1 }}>No LVM Volume Groups found</Typography>
                                  </Box>
                                )}
                              </CardContent>
                            </Card>
                          )}

                          {/* LVM-Thin */}
                          {nodeDisksSubTab === 2 && (
                            <Card variant="outlined">
                              <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                                <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <Typography variant="subtitle2" fontWeight={700}>LVM Thin Pools</Typography>
                                  <Box sx={{ display: 'flex', gap: 1 }}>
                                    <Button size="small" variant="outlined" startIcon={<i className="ri-refresh-line" style={{ fontSize: 14 }} />}>Reload</Button>
                                    <Button size="small" variant="outlined" disabled startIcon={<i className="ri-add-line" style={{ fontSize: 14 }} />}>Create: Thinpool</Button>
                                  </Box>
                                </Box>
                                {(Array.isArray(nodeDisksData.lvmthin) ? nodeDisksData.lvmthin : []).length > 0 ? (
                                  <TableContainer sx={{ maxHeight: 400 }}>
                                    <Table size="small" stickyHeader>
                                      <TableHead>
                                        <TableRow>
                                          <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Volume Group</TableCell>
                                          <TableCell sx={{ fontWeight: 700, textAlign: 'right' }}>Size</TableCell>
                                          <TableCell sx={{ fontWeight: 700, textAlign: 'right' }}>Used</TableCell>
                                          <TableCell sx={{ fontWeight: 700, textAlign: 'right' }}>Metadata Size</TableCell>
                                          <TableCell sx={{ fontWeight: 700, textAlign: 'right' }}>Metadata Used</TableCell>
                                        </TableRow>
                                      </TableHead>
                                      <TableBody>
                                        {nodeDisksData.lvmthin.map((tp: any, idx: number) => (
                                          <TableRow key={idx} hover>
                                            <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{tp.lv}</TableCell>
                                            <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{tp.vg}</TableCell>
                                            <TableCell sx={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>
                                              {tp.lv_size ? `${(tp.lv_size / 1024 / 1024 / 1024).toFixed(2)} GiB` : '-'}
                                            </TableCell>
                                            <TableCell sx={{ textAlign: 'right' }}>
                                              {tp.used !== undefined ? `${tp.used.toFixed(1)}%` : '-'}
                                            </TableCell>
                                            <TableCell sx={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>
                                              {tp.metadata_size ? `${(tp.metadata_size / 1024 / 1024).toFixed(2)} MiB` : '-'}
                                            </TableCell>
                                            <TableCell sx={{ textAlign: 'right' }}>
                                              {tp.metadata_used !== undefined ? `${tp.metadata_used.toFixed(1)}%` : '-'}
                                            </TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </TableContainer>
                                ) : (
                                  <Box sx={{ p: 4, textAlign: 'center', opacity: 0.5 }}>
                                    <i className="ri-stack-line" style={{ fontSize: 32 }} />
                                    <Typography variant="body2" sx={{ mt: 1 }}>No Thin-Pool found</Typography>
                                  </Box>
                                )}
                              </CardContent>
                            </Card>
                          )}

                          {/* Directory */}
                          {nodeDisksSubTab === 3 && (
                            <Card variant="outlined">
                              <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                                <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <Typography variant="subtitle2" fontWeight={700}>Directory Storage</Typography>
                                  <Box sx={{ display: 'flex', gap: 1 }}>
                                    <Button size="small" variant="outlined" startIcon={<i className="ri-refresh-line" style={{ fontSize: 14 }} />}>Reload</Button>
                                    <Button size="small" variant="outlined" disabled startIcon={<i className="ri-add-line" style={{ fontSize: 14 }} />}>Create: Directory</Button>
                                  </Box>
                                </Box>
                                {(Array.isArray(nodeDisksData.directory) ? nodeDisksData.directory : []).length > 0 ? (
                                  <TableContainer sx={{ maxHeight: 400 }}>
                                    <Table size="small" stickyHeader>
                                      <TableHead>
                                        <TableRow>
                                          <TableCell sx={{ fontWeight: 700 }}>Path</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Device</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Filesystem</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Options</TableCell>
                                        </TableRow>
                                      </TableHead>
                                      <TableBody>
                                        {nodeDisksData.directory.map((dir: any, idx: number) => (
                                          <TableRow key={idx} hover>
                                            <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{dir.path}</TableCell>
                                            <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{dir.device || '-'}</TableCell>
                                            <TableCell>{dir.type || '-'}</TableCell>
                                            <TableCell sx={{ fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{dir.options || '-'}</TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </TableContainer>
                                ) : (
                                  <Box sx={{ p: 4, textAlign: 'center', opacity: 0.5 }}>
                                    <i className="ri-folder-line" style={{ fontSize: 32 }} />
                                    <Typography variant="body2" sx={{ mt: 1 }}>No Directory storage found</Typography>
                                  </Box>
                                )}
                              </CardContent>
                            </Card>
                          )}

                          {/* ZFS */}
                          {nodeDisksSubTab === 4 && (
                            <Card variant="outlined">
                              <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                                <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <Typography variant="subtitle2" fontWeight={700}>ZFS Pools</Typography>
                                  <Box sx={{ display: 'flex', gap: 1 }}>
                                    <Button size="small" variant="outlined" startIcon={<i className="ri-refresh-line" style={{ fontSize: 14 }} />}>Reload</Button>
                                    <Button size="small" variant="outlined" disabled startIcon={<i className="ri-eye-line" style={{ fontSize: 14 }} />}>Detail</Button>
                                    <Button size="small" variant="outlined" disabled startIcon={<i className="ri-add-line" style={{ fontSize: 14 }} />}>Create: ZFS</Button>
                                  </Box>
                                </Box>
                                {(Array.isArray(nodeDisksData.zfs) ? nodeDisksData.zfs : []).length > 0 ? (
                                  <TableContainer sx={{ maxHeight: 400 }}>
                                    <Table size="small" stickyHeader>
                                      <TableHead>
                                        <TableRow>
                                          <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                                          <TableCell sx={{ fontWeight: 700, textAlign: 'right' }}>Size</TableCell>
                                          <TableCell sx={{ fontWeight: 700, textAlign: 'right' }}>Allocated</TableCell>
                                          <TableCell sx={{ fontWeight: 700, textAlign: 'right' }}>Free</TableCell>
                                          <TableCell sx={{ fontWeight: 700, textAlign: 'center' }}>Frag</TableCell>
                                          <TableCell sx={{ fontWeight: 700, textAlign: 'center' }}>Dedup</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Health</TableCell>
                                        </TableRow>
                                      </TableHead>
                                      <TableBody>
                                        {nodeDisksData.zfs.map((pool: any, idx: number) => (
                                          <TableRow key={idx} hover>
                                            <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{pool.name}</TableCell>
                                            <TableCell sx={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>
                                              {pool.size ? `${(pool.size / 1024 / 1024 / 1024).toFixed(2)} GiB` : '-'}
                                            </TableCell>
                                            <TableCell sx={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>
                                              {pool.alloc ? `${(pool.alloc / 1024 / 1024 / 1024).toFixed(2)} GiB` : '-'}
                                            </TableCell>
                                            <TableCell sx={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>
                                              {pool.free ? `${(pool.free / 1024 / 1024 / 1024).toFixed(2)} GiB` : '-'}
                                            </TableCell>
                                            <TableCell sx={{ textAlign: 'center' }}>{pool.frag ?? '-'}</TableCell>
                                            <TableCell sx={{ textAlign: 'center' }}>{pool.dedup ?? '-'}</TableCell>
                                            <TableCell>
                                              <Chip 
                                                size="small" 
                                                label={pool.health || 'UNKNOWN'} 
                                                color={pool.health === 'ONLINE' ? 'success' : pool.health === 'DEGRADED' ? 'warning' : pool.health === 'FAULTED' ? 'error' : 'default'}
                                                sx={{ height: 20, fontSize: 10 }}
                                              />
                                            </TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </TableContainer>
                                ) : (
                                  <Box sx={{ p: 4, textAlign: 'center', opacity: 0.5 }}>
                                    <i className="ri-database-line" style={{ fontSize: 32 }} />
                                    <Typography variant="body2" sx={{ mt: 1 }}>No ZFS pools found</Typography>
                                  </Box>
                                )}
                              </CardContent>
                            </Card>
                          )}
                        </Box>
                      </>
                    ) : (
                      <Box sx={{ p: 4, textAlign: 'center', opacity: 0.5 }}>
                        <i className="ri-hard-drive-2-line" style={{ fontSize: 48 }} />
                        <Typography sx={{ mt: 1 }}>Unable to load disk data</Typography>
                      </Box>
                    )}
                  </Box>
                )}

                {/* Onglet System - Index 5 pour tous les nodes */}
                {nodeTab === 5 && (
                  <Box sx={{ p: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
                    {nodeSystemLoading ? (
                      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                        <CircularProgress size={24} />
                      </Box>
                    ) : nodeSystemData ? (
                      <>
                        {/* Sous-onglets System */}
                        <Tabs
                          value={nodeSystemSubTab}
                          onChange={(_e, v) => setNodeSystemSubTab(v)}
                          sx={{ borderBottom: 1, borderColor: 'divider', px: 2, minHeight: 40 }}
                        >
                          <Tab label="Network" sx={{ minHeight: 40, py: 0 }} />
                          <Tab label="Certificates" sx={{ minHeight: 40, py: 0 }} />
                          <Tab label="DNS" sx={{ minHeight: 40, py: 0 }} />
                          <Tab label="Hosts" sx={{ minHeight: 40, py: 0 }} />
                          <Tab label="Options" sx={{ minHeight: 40, py: 0 }} />
                          <Tab label="Time" sx={{ minHeight: 40, py: 0 }} />
                          <Tab label="Syslog" sx={{ minHeight: 40, py: 0 }} />
                        </Tabs>

                        <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
                          {/* Network */}
                          {nodeSystemSubTab === 0 && (
                            <Card variant="outlined">
                              <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                                <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <Typography variant="subtitle2" fontWeight={700}>Network Interfaces</Typography>
                                  <Box sx={{ display: 'flex', gap: 1 }}>
                                    <Button size="small" variant="outlined" disabled startIcon={<i className="ri-add-line" style={{ fontSize: 14 }} />}>Create</Button>
                                    <Button size="small" variant="outlined" disabled startIcon={<i className="ri-refresh-line" style={{ fontSize: 14 }} />}>Revert</Button>
                                    <Button size="small" variant="outlined" disabled startIcon={<i className="ri-check-line" style={{ fontSize: 14 }} />}>Apply</Button>
                                  </Box>
                                </Box>
                                {(nodeSystemData.network?.length || 0) > 0 ? (
                                  <TableContainer sx={{ maxHeight: 400 }}>
                                    <Table size="small" stickyHeader>
                                      <TableHead>
                                        <TableRow>
                                          <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Active</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Autostart</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>CIDR</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Gateway</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Ports/Slaves</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Comment</TableCell>
                                        </TableRow>
                                      </TableHead>
                                      <TableBody>
                                        {nodeSystemData.network.map((iface: any, idx: number) => (
                                          <TableRow key={idx} hover>
                                            <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{iface.iface}</TableCell>
                                            <TableCell>
                                              <Chip 
                                                size="small" 
                                                label={iface.type} 
                                                color={iface.type === 'bridge' ? 'primary' : iface.type === 'bond' ? 'secondary' : 'default'}
                                                sx={{ height: 20, fontSize: 10 }}
                                              />
                                            </TableCell>
                                            <TableCell>
                                              <Chip size="small" label={iface.active ? 'Yes' : 'No'} color={iface.active ? 'success' : 'default'} sx={{ height: 20, fontSize: 10 }} />
                                            </TableCell>
                                            <TableCell>
                                              <Chip size="small" label={iface.autostart ? 'Yes' : 'No'} color={iface.autostart ? 'success' : 'default'} sx={{ height: 20, fontSize: 10 }} />
                                            </TableCell>
                                            <TableCell sx={{ fontFamily: 'monospace', fontSize: 11 }}>{iface.cidr || iface.address || '-'}</TableCell>
                                            <TableCell sx={{ fontFamily: 'monospace', fontSize: 11 }}>{iface.gateway || '-'}</TableCell>
                                            <TableCell sx={{ fontSize: 11 }}>{iface.bridge_ports || iface.slaves || '-'}</TableCell>
                                            <TableCell sx={{ fontSize: 11, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>{iface.comments || '-'}</TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </TableContainer>
                                ) : (
                                  <Box sx={{ p: 4, textAlign: 'center', opacity: 0.5 }}>
                                    <Typography variant="body2">No network interfaces found</Typography>
                                  </Box>
                                )}
                              </CardContent>
                            </Card>
                          )}

                          {/* Certificates */}
                          {nodeSystemSubTab === 1 && (
                            <Card variant="outlined">
                              <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                                <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <Typography variant="subtitle2" fontWeight={700}>SSL Certificates</Typography>
                                  <Box sx={{ display: 'flex', gap: 1 }}>
                                    <Button size="small" variant="outlined" disabled startIcon={<i className="ri-upload-line" style={{ fontSize: 14 }} />}>Upload Custom</Button>
                                    <Button size="small" variant="outlined" disabled startIcon={<i className="ri-refresh-line" style={{ fontSize: 14 }} />}>Renew</Button>
                                  </Box>
                                </Box>
                                {(nodeSystemData.certificates?.length || 0) > 0 ? (
                                  <TableContainer>
                                    <Table size="small">
                                      <TableHead>
                                        <TableRow>
                                          <TableCell sx={{ fontWeight: 700 }}>File</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Issuer</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Subject</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Valid From</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Valid Until</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Fingerprint</TableCell>
                                        </TableRow>
                                      </TableHead>
                                      <TableBody>
                                        {nodeSystemData.certificates.map((cert: any, idx: number) => {
                                          const now = Date.now() / 1000
                                          const isExpired = cert.notAfter && cert.notAfter < now
                                          const isExpiringSoon = cert.notAfter && cert.notAfter < now + 30 * 24 * 3600 && !isExpired
                                          return (
                                            <TableRow key={idx} hover>
                                              <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{cert.filename}</TableCell>
                                              <TableCell sx={{ fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{cert.issuer}</TableCell>
                                              <TableCell sx={{ fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{cert.subject}</TableCell>
                                              <TableCell sx={{ fontSize: 11 }}>{cert.notBefore ? new Date(cert.notBefore * 1000).toLocaleDateString() : '-'}</TableCell>
                                              <TableCell>
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                  <Typography sx={{ fontSize: 11, color: isExpired ? 'error.main' : isExpiringSoon ? 'warning.main' : 'inherit' }}>
                                                    {cert.notAfter ? new Date(cert.notAfter * 1000).toLocaleDateString() : '-'}
                                                  </Typography>
                                                  {isExpired && <Chip size="small" label="EXPIRED" color="error" sx={{ height: 16, fontSize: 9 }} />}
                                                  {isExpiringSoon && <Chip size="small" label="EXPIRING" color="warning" sx={{ height: 16, fontSize: 9 }} />}
                                                </Box>
                                              </TableCell>
                                              <TableCell sx={{ fontFamily: 'monospace', fontSize: 10, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>{cert.fingerprint}</TableCell>
                                            </TableRow>
                                          )
                                        })}
                                      </TableBody>
                                    </Table>
                                  </TableContainer>
                                ) : (
                                  <Box sx={{ p: 4, textAlign: 'center', opacity: 0.5 }}>
                                    <Typography variant="body2">No certificates found</Typography>
                                  </Box>
                                )}
                              </CardContent>
                            </Card>
                          )}

                          {/* DNS */}
                          {nodeSystemSubTab === 2 && (
                            <Card variant="outlined">
                              <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                                <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <Typography variant="subtitle2" fontWeight={700}>DNS Configuration</Typography>
                                  <Button 
                                    size="small" 
                                    variant="outlined" 
                                    startIcon={<i className="ri-edit-line" style={{ fontSize: 14 }} />}
                                    onClick={() => {
                                      setDnsFormData({
                                        search: nodeSystemData.dns?.search || '',
                                        dns1: nodeSystemData.dns?.dns1 || '',
                                        dns2: nodeSystemData.dns?.dns2 || '',
                                        dns3: nodeSystemData.dns?.dns3 || '',
                                      })
                                      setEditDnsDialogOpen(true)
                                    }}
                                  >
                                    Edit
                                  </Button>
                                </Box>
                                <TableContainer>
                                  <Table size="small">
                                    <TableBody>
                                      <TableRow>
                                        <TableCell sx={{ fontWeight: 600, width: 200 }}>Search Domain</TableCell>
                                        <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{nodeSystemData.dns?.search || '-'}</TableCell>
                                      </TableRow>
                                      <TableRow>
                                        <TableCell sx={{ fontWeight: 600 }}>DNS Server 1</TableCell>
                                        <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{nodeSystemData.dns?.dns1 || '-'}</TableCell>
                                      </TableRow>
                                      <TableRow>
                                        <TableCell sx={{ fontWeight: 600 }}>DNS Server 2</TableCell>
                                        <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{nodeSystemData.dns?.dns2 || '-'}</TableCell>
                                      </TableRow>
                                      <TableRow>
                                        <TableCell sx={{ fontWeight: 600 }}>DNS Server 3</TableCell>
                                        <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{nodeSystemData.dns?.dns3 || '-'}</TableCell>
                                      </TableRow>
                                    </TableBody>
                                  </Table>
                                </TableContainer>
                              </CardContent>
                            </Card>
                          )}

                          {/* Hosts */}
                          {nodeSystemSubTab === 3 && (
                            <Card variant="outlined">
                              <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                                <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <Typography variant="subtitle2" fontWeight={700}>/etc/hosts</Typography>
                                  <Button 
                                    size="small" 
                                    variant="outlined" 
                                    startIcon={<i className="ri-edit-line" style={{ fontSize: 14 }} />}
                                    onClick={() => {
                                      setHostsFormData({
                                        data: nodeSystemData.hosts?.data || '',
                                        digest: nodeSystemData.hosts?.digest || '',
                                      })
                                      setEditHostsDialogOpen(true)
                                    }}
                                  >
                                    Edit
                                  </Button>
                                </Box>
                                <Box 
                                  component="pre" 
                                  sx={{ 
                                    fontFamily: 'monospace', 
                                    fontSize: 12, 
                                    m: 0, 
                                    p: 2, 
                                    whiteSpace: 'pre-wrap',
                                    bgcolor: 'background.default',
                                    maxHeight: 300,
                                    overflow: 'auto'
                                  }}
                                >
                                  {nodeSystemData.hosts?.data || 'No hosts file content'}
                                </Box>
                              </CardContent>
                            </Card>
                          )}

                          {/* Options */}
                          {nodeSystemSubTab === 4 && (
                            <Card variant="outlined">
                              <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                                <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}>
                                  <Typography variant="subtitle2" fontWeight={700}>Node Options</Typography>
                                </Box>
                                <TableContainer>
                                  <Table size="small">
                                    <TableBody>
                                      <TableRow>
                                        <TableCell sx={{ fontWeight: 600, width: 250 }}>Description</TableCell>
                                        <TableCell>{nodeSystemData.options?.description || '-'}</TableCell>
                                      </TableRow>
                                      <TableRow>
                                        <TableCell sx={{ fontWeight: 600 }}>Wake on LAN</TableCell>
                                        <TableCell>{nodeSystemData.options?.wakeonlan || 'No'}</TableCell>
                                      </TableRow>
                                      <TableRow>
                                        <TableCell sx={{ fontWeight: 600 }}>Start all VMs on boot delay</TableCell>
                                        <TableCell>{nodeSystemData.options?.startall_onboot_delay || '0'} seconds</TableCell>
                                      </TableRow>
                                      <TableRow>
                                        <TableCell sx={{ fontWeight: 600 }}>ACME Account</TableCell>
                                        <TableCell sx={{ fontFamily: 'monospace', fontSize: 11 }}>{nodeSystemData.options?.acme || '-'}</TableCell>
                                      </TableRow>
                                    </TableBody>
                                  </Table>
                                </TableContainer>
                              </CardContent>
                            </Card>
                          )}

                          {/* Time */}
                          {nodeSystemSubTab === 5 && (
                            <Card variant="outlined">
                              <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                                <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <Typography variant="subtitle2" fontWeight={700}>Time Configuration</Typography>
                                  <Button 
                                    size="small" 
                                    variant="outlined" 
                                    startIcon={<i className="ri-edit-line" style={{ fontSize: 14 }} />}
                                    onClick={async () => {
                                      setTimeFormData({ timezone: nodeSystemData.time?.timezone || '' })
                                      // Charger les timezones si pas encore fait
                                      if (timezonesList.length === 0) {
                                        const { connId, node } = parseNodeId(selection?.id || '')
                                        const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/system?section=time`, { cache: 'no-store' })
                                        if (res.ok) {
                                          const json = await res.json()
                                          setTimezonesList(json.data?.timezones || [])
                                        }
                                      }
                                      setEditTimeDialogOpen(true)
                                    }}
                                  >
                                    Edit
                                  </Button>
                                </Box>
                                <TableContainer>
                                  <Table size="small">
                                    <TableBody>
                                      <TableRow>
                                        <TableCell sx={{ fontWeight: 600, width: 200 }}>Timezone</TableCell>
                                        <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{nodeSystemData.time?.timezone || '-'}</TableCell>
                                      </TableRow>
                                      <TableRow>
                                        <TableCell sx={{ fontWeight: 600 }}>Local Time</TableCell>
                                        <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                                          {nodeSystemData.time?.localtime ? new Date(nodeSystemData.time.localtime * 1000).toLocaleString() : '-'}
                                        </TableCell>
                                      </TableRow>
                                      <TableRow>
                                        <TableCell sx={{ fontWeight: 600 }}>UTC Time</TableCell>
                                        <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                                          {nodeSystemData.time?.time ? new Date(nodeSystemData.time.time * 1000).toISOString() : '-'}
                                        </TableCell>
                                      </TableRow>
                                    </TableBody>
                                  </Table>
                                </TableContainer>
                              </CardContent>
                            </Card>
                          )}

                          {/* Syslog */}
                          {nodeSystemSubTab === 6 && (
                            <Card variant="outlined">
                              <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                                <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <Typography variant="subtitle2" fontWeight={700}>System Log</Typography>
                                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                                    {nodeSyslogLive && (
                                      <Chip 
                                        size="small" 
                                        label="LIVE" 
                                        color="success"
                                        sx={{ height: 20, fontSize: 10, animation: 'pulse 1.5s infinite' }}
                                      />
                                    )}
                                    <Button 
                                      size="small" 
                                      variant={nodeSyslogLive ? 'contained' : 'outlined'}
                                      color={nodeSyslogLive ? 'error' : 'primary'}
                                      startIcon={<i className={nodeSyslogLive ? 'ri-stop-line' : 'ri-play-line'} style={{ fontSize: 14 }} />}
                                      onClick={() => setNodeSyslogLive(!nodeSyslogLive)}
                                    >
                                      {nodeSyslogLive ? 'Stop' : 'Live'}
                                    </Button>
                                    <Button 
                                      size="small" 
                                      variant="outlined"
                                      disabled={nodeSyslogLoading}
                                      startIcon={<i className="ri-refresh-line" style={{ fontSize: 14 }} />}
                                      onClick={async () => {
                                        setNodeSyslogLoading(true)
                                        const { connId, node } = parseNodeId(selection?.id || '')
                                        try {
                                          const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/syslog?limit=200&_t=${Date.now()}`, { cache: 'no-store' })
                                          if (res.ok) {
                                            const json = await res.json()
                                            setNodeSyslogData(json.data || [])
                                          }
                                        } finally {
                                          setNodeSyslogLoading(false)
                                        }
                                      }}
                                    >
                                      Refresh
                                    </Button>
                                  </Box>
                                </Box>
                                {nodeSyslogLoading ? (
                                  <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                                    <CircularProgress size={24} />
                                  </Box>
                                ) : nodeSyslogData.length > 0 ? (
                                  <Box 
                                    component="pre" 
                                    sx={{ 
                                      fontFamily: 'monospace', 
                                      fontSize: 11, 
                                      m: 0, 
                                      p: 2, 
                                      whiteSpace: 'pre-wrap',
                                      bgcolor: 'background.default',
                                      maxHeight: 400,
                                      overflow: 'auto'
                                    }}
                                  >
                                    {nodeSyslogData.map((line, i) => {
                                      // Coloration syntaxique basique
                                      const isError = /error|fail|crit/i.test(line)
                                      const isWarning = /warn/i.test(line)
                                      return (
                                        <Box 
                                          key={i} 
                                          component="div"
                                          sx={{ 
                                            color: isError ? 'error.main' : isWarning ? 'warning.main' : 'inherit',
                                            '&:hover': { bgcolor: 'action.hover' }
                                          }}
                                        >
                                          {line}
                                        </Box>
                                      )
                                    })}
                                  </Box>
                                ) : (
                                  <Box sx={{ p: 4, textAlign: 'center', opacity: 0.5 }}>
                                    <Typography variant="body2">No log entries</Typography>
                                  </Box>
                                )}
                              </CardContent>
                            </Card>
                          )}
                        </Box>

                        {/* Dialog Edit DNS */}
                        <Dialog open={editDnsDialogOpen} onClose={() => setEditDnsDialogOpen(false)} maxWidth="sm" fullWidth>
                          <DialogTitle>Edit DNS Configuration</DialogTitle>
                          <DialogContent>
                            <Stack spacing={2} sx={{ mt: 1 }}>
                              <TextField
                                fullWidth
                                size="small"
                                label="Search Domain"
                                value={dnsFormData.search}
                                onChange={(e) => setDnsFormData(prev => ({ ...prev, search: e.target.value }))}
                              />
                              <TextField
                                fullWidth
                                size="small"
                                label="DNS Server 1"
                                value={dnsFormData.dns1}
                                onChange={(e) => setDnsFormData(prev => ({ ...prev, dns1: e.target.value }))}
                              />
                              <TextField
                                fullWidth
                                size="small"
                                label="DNS Server 2"
                                value={dnsFormData.dns2}
                                onChange={(e) => setDnsFormData(prev => ({ ...prev, dns2: e.target.value }))}
                              />
                              <TextField
                                fullWidth
                                size="small"
                                label="DNS Server 3"
                                value={dnsFormData.dns3}
                                onChange={(e) => setDnsFormData(prev => ({ ...prev, dns3: e.target.value }))}
                              />
                            </Stack>
                          </DialogContent>
                          <DialogActions>
                            <Button onClick={() => setEditDnsDialogOpen(false)}>Cancel</Button>
                            <Button 
                              variant="contained"
                              disabled={systemSaving}
                              onClick={async () => {
                                setSystemSaving(true)
                                const { connId, node } = parseNodeId(selection?.id || '')
                                try {
                                  const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/system`, {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ section: 'dns', data: dnsFormData })
                                  })
                                  if (res.ok) {
                                    setEditDnsDialogOpen(false)
                                    setNodeSystemLoaded(false) // Recharger
                                  } else {
                                    const err = await res.json()
                                    alert(err.error || 'Failed to update DNS')
                                  }
                                } finally {
                                  setSystemSaving(false)
                                }
                              }}
                            >
                              {systemSaving ? <CircularProgress size={20} /> : 'Save'}
                            </Button>
                          </DialogActions>
                        </Dialog>

                        {/* Dialog Edit Hosts */}
                        <Dialog open={editHostsDialogOpen} onClose={() => setEditHostsDialogOpen(false)} maxWidth="md" fullWidth>
                          <DialogTitle>Edit /etc/hosts</DialogTitle>
                          <DialogContent>
                            <TextField
                              fullWidth
                              multiline
                              rows={15}
                              value={hostsFormData.data}
                              onChange={(e) => setHostsFormData(prev => ({ ...prev, data: e.target.value }))}
                              sx={{ mt: 1, '& textarea': { fontFamily: 'monospace', fontSize: 12 } }}
                            />
                          </DialogContent>
                          <DialogActions>
                            <Button onClick={() => setEditHostsDialogOpen(false)}>Cancel</Button>
                            <Button 
                              variant="contained"
                              disabled={systemSaving}
                              onClick={async () => {
                                setSystemSaving(true)
                                const { connId, node } = parseNodeId(selection?.id || '')
                                try {
                                  const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/system`, {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ section: 'hosts', data: hostsFormData })
                                  })
                                  if (res.ok) {
                                    setEditHostsDialogOpen(false)
                                    setNodeSystemLoaded(false) // Recharger
                                  } else {
                                    const err = await res.json()
                                    alert(err.error || 'Failed to update hosts')
                                  }
                                } finally {
                                  setSystemSaving(false)
                                }
                              }}
                            >
                              {systemSaving ? <CircularProgress size={20} /> : 'Save'}
                            </Button>
                          </DialogActions>
                        </Dialog>

                        {/* Dialog Edit Time */}
                        <Dialog open={editTimeDialogOpen} onClose={() => setEditTimeDialogOpen(false)} maxWidth="sm" fullWidth>
                          <DialogTitle>Edit Time Configuration</DialogTitle>
                          <DialogContent>
                            <Autocomplete
                              fullWidth
                              size="small"
                              options={timezonesList}
                              value={timeFormData.timezone}
                              onChange={(_, v) => setTimeFormData({ timezone: v || '' })}
                              renderInput={(params) => <TextField {...params} label="Timezone" sx={{ mt: 2 }} />}
                              loading={timezonesList.length === 0}
                            />
                          </DialogContent>
                          <DialogActions>
                            <Button onClick={() => setEditTimeDialogOpen(false)}>Cancel</Button>
                            <Button 
                              variant="contained"
                              disabled={systemSaving || !timeFormData.timezone}
                              onClick={async () => {
                                setSystemSaving(true)
                                const { connId, node } = parseNodeId(selection?.id || '')
                                try {
                                  const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/system`, {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ section: 'time', data: timeFormData })
                                  })
                                  if (res.ok) {
                                    setEditTimeDialogOpen(false)
                                    setNodeSystemLoaded(false) // Recharger
                                  } else {
                                    const err = await res.json()
                                    alert(err.error || 'Failed to update time')
                                  }
                                } finally {
                                  setSystemSaving(false)
                                }
                              }}
                            >
                              {systemSaving ? <CircularProgress size={20} /> : 'Save'}
                            </Button>
                          </DialogActions>
                        </Dialog>
                      </>
                    ) : (
                      <Box sx={{ p: 4, textAlign: 'center', opacity: 0.5 }}>
                        <i className="ri-settings-3-line" style={{ fontSize: 48 }} />
                        <Typography sx={{ mt: 1 }}>Unable to load system data</Typography>
                      </Box>
                    )}
                  </Box>
                )}

                {/* Onglet Ceph (cluster nodes only) - Index 6 */}
                {nodeTab === 6 && data.clusterName && (
                  <Box sx={{ p: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
                    {nodeCephLoading ? (
                      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                        <CircularProgress size={24} />
                      </Box>
                    ) : nodeCephData?.hasCeph === false ? (
                      /* Ceph non installé */
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
                          Ceph not installed
                        </Typography>
                        <Typography variant="body2" sx={{ opacity: 0.7, mb: 3, maxWidth: 400, mx: 'auto' }}>
                          Ceph is a distributed storage system that provides high availability and scalability.
                          Install Ceph to enable distributed storage on this cluster.
                        </Typography>
                        <Button
                          variant="contained"
                          startIcon={<i className="ri-download-cloud-line" />}
                          disabled
                        >
                          Install Ceph
                        </Button>
                        <Typography variant="caption" sx={{ display: 'block', mt: 1, opacity: 0.5 }}>
                          Coming soon - Use Proxmox VE directly for now
                        </Typography>
                      </Box>
                    ) : nodeCephData ? (
                      /* Ceph installé - Sous-onglets */
                      <>
                        <Tabs
                          value={nodeCephSubTab}
                          onChange={(_e, v) => setNodeCephSubTab(v)}
                          sx={{ 
                            borderBottom: 1, 
                            borderColor: 'divider', 
                            minHeight: 36,
                            '& .MuiTab-root': { minHeight: 36, py: 0.5, fontSize: 13 }
                          }}
                        >
                          <Tab label="Configuration" />
                          <Tab label="Monitor" />
                          <Tab label="OSD" />
                          <Tab label="CephFS" />
                          <Tab label="Pools" />
                          <Tab label="Log" />
                        </Tabs>

                        <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
                          {/* Configuration */}
                          {nodeCephSubTab === 0 && (
                            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 300px' }, gap: 2 }}>
                              <Stack spacing={2}>
                                {/* Configuration globale */}
                                <Card variant="outlined">
                                  <CardContent>
                                    <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>Configuration</Typography>
                                    <Box sx={{ 
                                      bgcolor: 'grey.900', 
                                      borderRadius: 1, 
                                      p: 2, 
                                      fontFamily: 'monospace', 
                                      fontSize: 12,
                                      maxHeight: 300,
                                      overflow: 'auto',
                                      whiteSpace: 'pre-wrap',
                                      color: '#e0e0e0'
                                    }}>
                                      {nodeCephData.config?.global ? (
                                        Object.entries(nodeCephData.config.global).map(([section, values]: [string, any]) => (
                                          <Box key={section}>
                                            <Box sx={{ color: '#4fc3f7', fontWeight: 700 }}>[{section}]</Box>
                                            {typeof values === 'object' && values !== null ? (
                                              Object.entries(values).map(([k, v]) => (
                                                <Box key={k} sx={{ pl: 2 }}>
                                                  <span style={{ color: '#81c784' }}>{k}</span> = {String(v)}
                                                </Box>
                                              ))
                                            ) : (
                                              <Box sx={{ pl: 2 }}>{String(values)}</Box>
                                            )}
                                          </Box>
                                        ))
                                      ) : (
                                        <Typography variant="caption" sx={{ opacity: 0.5 }}>No configuration available</Typography>
                                      )}
                                    </Box>
                                  </CardContent>
                                </Card>

                                {/* Configuration Database */}
                                <Card variant="outlined">
                                  <CardContent>
                                    <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>Configuration Database</Typography>
                                    {nodeCephData.config?.database?.length > 0 ? (
                                      <TableContainer sx={{ maxHeight: 250 }}>
                                        <Table size="small" stickyHeader>
                                          <TableHead>
                                            <TableRow>
                                              <TableCell sx={{ fontWeight: 700, width: 120 }}>WHO</TableCell>
                                              <TableCell sx={{ fontWeight: 700 }}>OPTION</TableCell>
                                              <TableCell sx={{ fontWeight: 700, width: 150 }}>VALUE</TableCell>
                                            </TableRow>
                                          </TableHead>
                                          <TableBody>
                                            {nodeCephData.config.database.map((item: any, idx: number) => (
                                              <TableRow key={idx}>
                                                <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{item.section || item.who || 'global'}</TableCell>
                                                <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{item.name || item.option}</TableCell>
                                                <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{item.value}</TableCell>
                                              </TableRow>
                                            ))}
                                          </TableBody>
                                        </Table>
                                      </TableContainer>
                                    ) : (
                                      <Typography variant="body2" sx={{ opacity: 0.5 }}>No custom configuration</Typography>
                                    )}
                                  </CardContent>
                                </Card>
                              </Stack>

                              {/* Crush Map */}
                              <Card variant="outlined">
                                <CardContent>
                                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>Crush Map</Typography>
                                  <Box sx={{ 
                                    bgcolor: 'grey.900', 
                                    borderRadius: 1, 
                                    p: 2, 
                                    fontFamily: 'monospace', 
                                    fontSize: 11,
                                    maxHeight: 500,
                                    overflow: 'auto',
                                    whiteSpace: 'pre-wrap',
                                    color: '#e0e0e0'
                                  }}>
                                    {nodeCephData.config?.crushMap || 'Crush map not available'}
                                  </Box>
                                </CardContent>
                              </Card>
                            </Box>
                          )}

                          {/* Monitor */}
                          {nodeCephSubTab === 1 && (
                            <Stack spacing={2}>
                              {/* Monitors */}
                              <Card variant="outlined">
                                <CardContent>
                                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                                    <Typography variant="subtitle2" fontWeight={700}>Monitor</Typography>
                                    <Box sx={{ display: 'flex', gap: 1 }}>
                                      <Button size="small" variant="outlined" startIcon={<i className="ri-play-line" style={{ fontSize: 14 }} />} disabled>Start</Button>
                                      <Button size="small" variant="outlined" startIcon={<i className="ri-stop-line" style={{ fontSize: 14 }} />} disabled>Stop</Button>
                                      <Button size="small" variant="outlined" startIcon={<i className="ri-restart-line" style={{ fontSize: 14 }} />} disabled>Restart</Button>
                                      <Button size="small" variant="contained" startIcon={<i className="ri-add-line" style={{ fontSize: 14 }} />} disabled>Create</Button>
                                    </Box>
                                  </Box>
                                  <TableContainer>
                                    <Table size="small">
                                      <TableHead>
                                        <TableRow sx={{ bgcolor: 'action.hover' }}>
                                          <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Host</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Address</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Version</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Quorum</TableCell>
                                        </TableRow>
                                      </TableHead>
                                      <TableBody>
                                        {(Array.isArray(nodeCephData.monitors) ? nodeCephData.monitors : []).map((mon: any) => (
                                          <TableRow key={mon.name}>
                                            <TableCell sx={{ fontFamily: 'monospace' }}>{mon.name}</TableCell>
                                            <TableCell>{mon.host}</TableCell>
                                            <TableCell>
                                              <Chip 
                                                size="small" 
                                                label={mon.quorum ? 'running' : 'stopped'} 
                                                color={mon.quorum ? 'success' : 'default'}
                                                sx={{ height: 20, fontSize: 11 }}
                                              />
                                            </TableCell>
                                            <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{mon.addr}</TableCell>
                                            <TableCell>{mon.ceph_version_short || mon.ceph_version?.split(' ')[2]}</TableCell>
                                            <TableCell>
                                              {mon.quorum ? (
                                                <Chip size="small" label="Yes" color="success" sx={{ height: 20, fontSize: 11 }} />
                                              ) : (
                                                <Chip size="small" label="No" color="error" sx={{ height: 20, fontSize: 11 }} />
                                              )}
                                            </TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </TableContainer>
                                </CardContent>
                              </Card>

                              {/* Managers */}
                              <Card variant="outlined">
                                <CardContent>
                                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                                    <Typography variant="subtitle2" fontWeight={700}>Manager</Typography>
                                    <Box sx={{ display: 'flex', gap: 1 }}>
                                      <Button size="small" variant="outlined" startIcon={<i className="ri-play-line" style={{ fontSize: 14 }} />} disabled>Start</Button>
                                      <Button size="small" variant="outlined" startIcon={<i className="ri-stop-line" style={{ fontSize: 14 }} />} disabled>Stop</Button>
                                      <Button size="small" variant="outlined" startIcon={<i className="ri-restart-line" style={{ fontSize: 14 }} />} disabled>Restart</Button>
                                      <Button size="small" variant="contained" startIcon={<i className="ri-add-line" style={{ fontSize: 14 }} />} disabled>Create</Button>
                                    </Box>
                                  </Box>
                                  <TableContainer>
                                    <Table size="small">
                                      <TableHead>
                                        <TableRow sx={{ bgcolor: 'action.hover' }}>
                                          <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Host</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Address</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Version</TableCell>
                                        </TableRow>
                                      </TableHead>
                                      <TableBody>
                                        {nodeCephData.managers?.active && (
                                          <TableRow>
                                            <TableCell sx={{ fontFamily: 'monospace' }}>mgr.{nodeCephData.managers.active}</TableCell>
                                            <TableCell>{nodeCephData.managers.active?.split('.')[0] || nodeCephData.managers.active}</TableCell>
                                            <TableCell>
                                              <Chip size="small" label="active" color="success" sx={{ height: 20, fontSize: 11 }} />
                                            </TableCell>
                                            <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>—</TableCell>
                                            <TableCell>—</TableCell>
                                          </TableRow>
                                        )}
                                        {(nodeCephData.managers?.standbys || []).map((mgr: any) => (
                                          <TableRow key={mgr.name || mgr}>
                                            <TableCell sx={{ fontFamily: 'monospace' }}>mgr.{mgr.name || mgr}</TableCell>
                                            <TableCell>{(mgr.name || mgr)?.split('.')[0] || mgr.name || mgr}</TableCell>
                                            <TableCell>
                                              <Chip size="small" label="standby" color="default" sx={{ height: 20, fontSize: 11 }} />
                                            </TableCell>
                                            <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>—</TableCell>
                                            <TableCell>—</TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </TableContainer>
                                </CardContent>
                              </Card>
                            </Stack>
                          )}

                          {/* OSD */}
                          {nodeCephSubTab === 2 && (
                            <Card variant="outlined">
                              <CardContent>
                                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                                  <Typography variant="subtitle2" fontWeight={700}>OSD (Object Storage Daemon)</Typography>
                                  <Box sx={{ display: 'flex', gap: 1 }}>
                                    <Button size="small" variant="outlined" startIcon={<i className="ri-refresh-line" style={{ fontSize: 14 }} />}>Reload</Button>
                                    <Button size="small" variant="contained" startIcon={<i className="ri-add-line" style={{ fontSize: 14 }} />} disabled>Create OSD</Button>
                                  </Box>
                                </Box>
                                <TableContainer sx={{ maxHeight: 400 }}>
                                  <Table size="small" stickyHeader>
                                    <TableHead>
                                      <TableRow>
                                        <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                                        <TableCell sx={{ fontWeight: 700 }}>Class</TableCell>
                                        <TableCell sx={{ fontWeight: 700 }}>OSD Type</TableCell>
                                        <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                                        <TableCell sx={{ fontWeight: 700 }}>Version</TableCell>
                                        <TableCell sx={{ fontWeight: 700 }} align="right">Weight</TableCell>
                                        <TableCell sx={{ fontWeight: 700 }} align="right">Reweight</TableCell>
                                        <TableCell sx={{ fontWeight: 700 }} align="right">Used (%)</TableCell>
                                        <TableCell sx={{ fontWeight: 700 }} align="right">Total</TableCell>
                                        <TableCell sx={{ fontWeight: 700 }} align="right">PGs</TableCell>
                                      </TableRow>
                                    </TableHead>
                                    <TableBody>
                                      {(Array.isArray(nodeCephData.osds) ? nodeCephData.osds : []).map((osd: any) => (
                                        <TableRow key={osd.id}>
                                          <TableCell sx={{ fontFamily: 'monospace' }}>osd.{osd.id}</TableCell>
                                          <TableCell>{osd.device_class || osd.class || 'nvme'}</TableCell>
                                          <TableCell>{osd.osdtype || 'bluestore'}</TableCell>
                                          <TableCell>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                              <Chip 
                                                size="small" 
                                                label={osd.status === 'up' || osd.in === 1 ? 'up' : 'down'}
                                                color={osd.status === 'up' || osd.in === 1 ? 'success' : 'error'}
                                                sx={{ height: 18, fontSize: 10 }}
                                              />
                                              <span style={{ opacity: 0.5 }}>/</span>
                                              <Chip 
                                                size="small" 
                                                label={osd.in === 1 ? 'in' : 'out'}
                                                color={osd.in === 1 ? 'success' : 'warning'}
                                                sx={{ height: 18, fontSize: 10 }}
                                              />
                                            </Box>
                                          </TableCell>
                                          <TableCell>{osd.ceph_version_short || osd.version}</TableCell>
                                          <TableCell align="right">{osd.crush_weight?.toFixed(2) || '1.00'}</TableCell>
                                          <TableCell align="right">{osd.reweight?.toFixed(2) || '1.00'}</TableCell>
                                          <TableCell align="right">
                                            {osd.percent_used?.toFixed(2) || ((osd.kb_used / osd.kb) * 100).toFixed(2) || '0'}%
                                          </TableCell>
                                          <TableCell align="right" sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                                            {osd.kb ? `${(osd.kb / 1024 / 1024 / 1024).toFixed(2)} TiB` : osd.total_space || '—'}
                                          </TableCell>
                                          <TableCell align="right">{osd.num_pgs || osd.pgs || '—'}</TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </TableContainer>
                              </CardContent>
                            </Card>
                          )}

                          {/* CephFS */}
                          {nodeCephSubTab === 3 && (
                            <Stack spacing={2}>
                              <Card variant="outlined">
                                <CardContent>
                                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                                    <Typography variant="subtitle2" fontWeight={700}>CephFS</Typography>
                                    <Button size="small" variant="contained" startIcon={<i className="ri-add-line" style={{ fontSize: 14 }} />} disabled>Create CephFS</Button>
                                  </Box>
                                  {(Array.isArray(nodeCephData.cephfs) ? nodeCephData.cephfs : []).length > 0 ? (
                                    <TableContainer>
                                      <Table size="small">
                                        <TableHead>
                                          <TableRow sx={{ bgcolor: 'action.hover' }}>
                                            <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                                            <TableCell sx={{ fontWeight: 700 }}>Data Pool</TableCell>
                                            <TableCell sx={{ fontWeight: 700 }}>Metadata Pool</TableCell>
                                          </TableRow>
                                        </TableHead>
                                        <TableBody>
                                          {(Array.isArray(nodeCephData.cephfs) ? nodeCephData.cephfs : []).map((fs: any) => (
                                            <TableRow key={fs.name}>
                                              <TableCell sx={{ fontFamily: 'monospace' }}>{fs.name}</TableCell>
                                              <TableCell>{fs.data_pool}</TableCell>
                                              <TableCell>{fs.metadata_pool}</TableCell>
                                            </TableRow>
                                          ))}
                                        </TableBody>
                                      </Table>
                                    </TableContainer>
                                  ) : (
                                    <Typography variant="body2" sx={{ opacity: 0.5 }}>No CephFS configured</Typography>
                                  )}
                                </CardContent>
                              </Card>

                              <Card variant="outlined">
                                <CardContent>
                                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                                    <Typography variant="subtitle2" fontWeight={700}>Metadata Servers</Typography>
                                    <Box sx={{ display: 'flex', gap: 1 }}>
                                      <Button size="small" variant="outlined" startIcon={<i className="ri-play-line" style={{ fontSize: 14 }} />} disabled>Start</Button>
                                      <Button size="small" variant="outlined" startIcon={<i className="ri-stop-line" style={{ fontSize: 14 }} />} disabled>Stop</Button>
                                      <Button size="small" variant="outlined" startIcon={<i className="ri-restart-line" style={{ fontSize: 14 }} />} disabled>Restart</Button>
                                      <Button size="small" variant="contained" startIcon={<i className="ri-add-line" style={{ fontSize: 14 }} />} disabled>Create</Button>
                                    </Box>
                                  </Box>
                                  {(Array.isArray(nodeCephData.mds) ? nodeCephData.mds : []).length > 0 ? (
                                    <TableContainer>
                                      <Table size="small">
                                        <TableHead>
                                          <TableRow sx={{ bgcolor: 'action.hover' }}>
                                            <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                                            <TableCell sx={{ fontWeight: 700 }}>Host</TableCell>
                                            <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                                            <TableCell sx={{ fontWeight: 700 }}>Address</TableCell>
                                            <TableCell sx={{ fontWeight: 700 }}>Version</TableCell>
                                          </TableRow>
                                        </TableHead>
                                        <TableBody>
                                          {(Array.isArray(nodeCephData.mds) ? nodeCephData.mds : []).map((mds: any) => (
                                            <TableRow key={mds.name}>
                                              <TableCell sx={{ fontFamily: 'monospace' }}>{mds.name}</TableCell>
                                              <TableCell>{mds.host}</TableCell>
                                              <TableCell>
                                                <Chip 
                                                  size="small" 
                                                  label={mds.state || mds.status || 'unknown'}
                                                  color={mds.state?.includes('active') ? 'success' : 'default'}
                                                  sx={{ height: 20, fontSize: 11 }}
                                                />
                                              </TableCell>
                                              <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{mds.addr}</TableCell>
                                              <TableCell>{mds.ceph_version_short}</TableCell>
                                            </TableRow>
                                          ))}
                                        </TableBody>
                                      </Table>
                                    </TableContainer>
                                  ) : (
                                    <Typography variant="body2" sx={{ opacity: 0.5 }}>No MDS configured</Typography>
                                  )}
                                </CardContent>
                              </Card>
                            </Stack>
                          )}

                          {/* Pools */}
                          {nodeCephSubTab === 4 && (
                            <Card variant="outlined">
                              <CardContent>
                                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                                  <Typography variant="subtitle2" fontWeight={700}>Pools</Typography>
                                  <Box sx={{ display: 'flex', gap: 1 }}>
                                    <Button size="small" variant="outlined">Edit</Button>
                                    <Button size="small" variant="outlined" color="error">Destroy</Button>
                                    <Button size="small" variant="contained" startIcon={<i className="ri-add-line" style={{ fontSize: 14 }} />} disabled>Create</Button>
                                  </Box>
                                </Box>
                                <TableContainer sx={{ maxHeight: 400 }}>
                                  <Table size="small" stickyHeader>
                                    <TableHead>
                                      <TableRow>
                                        <TableCell sx={{ fontWeight: 700, width: 60 }}>Pool #</TableCell>
                                        <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                                        <TableCell sx={{ fontWeight: 700 }} align="center">Size/min</TableCell>
                                        <TableCell sx={{ fontWeight: 700 }} align="right"># of PGs</TableCell>
                                        <TableCell sx={{ fontWeight: 700 }} align="right">Optimal # PGs</TableCell>
                                        <TableCell sx={{ fontWeight: 700 }}>Autoscaler</TableCell>
                                        <TableCell sx={{ fontWeight: 700 }}>CRUSH Rule</TableCell>
                                        <TableCell sx={{ fontWeight: 700 }} align="right">Used (%)</TableCell>
                                      </TableRow>
                                    </TableHead>
                                    <TableBody>
                                      {(Array.isArray(nodeCephData.pools) ? nodeCephData.pools : []).map((pool: any) => (
                                        <TableRow key={pool.pool || pool.pool_name}>
                                          <TableCell>{pool.pool}</TableCell>
                                          <TableCell sx={{ fontFamily: 'monospace' }}>{pool.pool_name}</TableCell>
                                          <TableCell align="center">{pool.size}/{pool.min_size}</TableCell>
                                          <TableCell align="right">{pool.pg_num}</TableCell>
                                          <TableCell align="right">{pool.pg_num_target || pool.pg_num}</TableCell>
                                          <TableCell>
                                            <Chip 
                                              size="small" 
                                              label={pool.pg_autoscale_mode || 'on'}
                                              color={pool.pg_autoscale_mode === 'on' ? 'success' : 'default'}
                                              sx={{ height: 18, fontSize: 10 }}
                                            />
                                          </TableCell>
                                          <TableCell>{pool.crush_rule_name || `rule ${pool.crush_rule}`}</TableCell>
                                          <TableCell align="right">
                                            {pool.percent_used?.toFixed(2) || '0.00'}%
                                          </TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </TableContainer>
                              </CardContent>
                            </Card>
                          )}

                          {/* Log */}
                          {nodeCephSubTab === 5 && (
                            <Card variant="outlined">
                              <CardContent>
                                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Typography variant="subtitle2" fontWeight={700}>Ceph Log</Typography>
                                    {nodeCephLogLive && (
                                      <Chip 
                                        size="small" 
                                        label="LIVE" 
                                        color="success" 
                                        sx={{ height: 20, fontSize: 10, animation: 'pulse 2s infinite' }}
                                      />
                                    )}
                                  </Box>
                                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                                    <Button 
                                      size="small" 
                                      variant={nodeCephLogLive ? 'contained' : 'outlined'}
                                      color={nodeCephLogLive ? 'error' : 'success'}
                                      startIcon={<i className={nodeCephLogLive ? 'ri-stop-circle-line' : 'ri-play-circle-line'} style={{ fontSize: 14 }} />}
                                      onClick={() => setNodeCephLogLive(!nodeCephLogLive)}
                                    >
                                      {nodeCephLogLive ? 'Stop' : 'Live'}
                                    </Button>
                                    <Button 
                                      size="small" 
                                      variant="outlined" 
                                      startIcon={<i className="ri-refresh-line" style={{ fontSize: 14 }} />}
                                      onClick={async () => {
                                        if (!selection?.id) return
                                        const { connId, node: nodeName } = parseNodeId(selection.id)
                                        try {
                                          const timestamp = Date.now()
                                          const res = await fetch(
                                            `/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(nodeName)}/ceph?section=log&logLines=100&_t=${timestamp}`, 
                                            { 
                                              cache: 'no-store',
                                              headers: {
                                                'Cache-Control': 'no-cache, no-store, must-revalidate',
                                                'Pragma': 'no-cache'
                                              }
                                            }
                                          )
                                          if (res.ok) {
                                            const json = await res.json()
                                            if (json.data?.log) {
                                              setNodeCephData((prev: any) => ({ ...prev, log: json.data.log }))
                                            }
                                          }
                                        } catch (e) {
                                          console.error('Failed to refresh logs:', e)
                                        }
                                      }}
                                    >
                                      Refresh
                                    </Button>
                                  </Box>
                                </Box>
                                <Box 
                                  sx={{ 
                                    bgcolor: 'grey.900', 
                                    borderRadius: 1, 
                                    p: 2, 
                                    fontFamily: 'monospace', 
                                    fontSize: 11,
                                    height: 400,
                                    overflow: 'auto',
                                    color: '#e0e0e0',
                                    '& .log-line': {
                                      whiteSpace: 'pre-wrap',
                                      borderBottom: '1px solid rgba(255,255,255,0.05)',
                                      py: 0.25,
                                      '&:hover': { bgcolor: 'rgba(255,255,255,0.05)' }
                                    },
                                    '& .log-dbg': { color: '#9e9e9e' },
                                    '& .log-info': { color: '#4fc3f7' },
                                    '& .log-warn': { color: '#ffb74d' },
                                    '& .log-err': { color: '#ef5350' },
                                  }}
                                >
                                  {(Array.isArray(nodeCephData.log) ? nodeCephData.log : []).length > 0 ? (
                                    (Array.isArray(nodeCephData.log) ? nodeCephData.log : []).map((line: string, idx: number) => {
                                      // Déterminer le niveau de log pour la couleur
                                      const logClass = line.includes('[DBG]') ? 'log-dbg' : 
                                                       line.includes('[INF]') || line.includes('[INFO]') ? 'log-info' :
                                                       line.includes('[WRN]') || line.includes('[WARN]') ? 'log-warn' :
                                                       line.includes('[ERR]') || line.includes('[ERROR]') ? 'log-err' : ''
                                      return (
                                        <Box key={idx} className={`log-line ${logClass}`}>
                                          {line}
                                        </Box>
                                      )
                                    })
                                  ) : (
                                    <Box sx={{ textAlign: 'center', py: 4, opacity: 0.5 }}>
                                      <i className="ri-file-list-3-line" style={{ fontSize: 32 }} />
                                      <Typography variant="body2" sx={{ mt: 1 }}>No log entries available</Typography>
                                      <Typography variant="caption">Logs require Sys.Syslog permission</Typography>
                                    </Box>
                                  )}
                                </Box>
                              </CardContent>
                            </Card>
                          )}
                        </Box>
                      </>
                    ) : (
                      <Box sx={{ p: 4, textAlign: 'center', opacity: 0.5 }}>
                        <i className="ri-database-2-line" style={{ fontSize: 48 }} />
                        <Typography sx={{ mt: 1 }}>Unable to load Ceph data</Typography>
                      </Box>
                    )}
                  </Box>
                )}

                {/* Onglet Backups (standalone only) - Index 6 */}
                {nodeTab === 6 && !data.clusterName && (
                  <BackupJobsPanel connectionId={parseNodeId(selection.id).connId} />
                )}

                {/* Onglet Cluster (standalone only) - Index 7 */}
                {nodeTab === 7 && !data.clusterName && (
                  <Box sx={{ p: 2 }}>
                    {clusterConfigLoading ? (
                      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                        <CircularProgress size={24} />
                      </Box>
                    ) : (
                      <Stack spacing={3}>
                        {/* Header avec boutons */}
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Typography variant="subtitle1" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <i className="ri-information-line" style={{ fontSize: 20 }} />
                            Cluster Information
                          </Typography>
                        </Box>

                        {/* Standalone message avec boutons */}
                        <Card variant="outlined">
                          <CardContent>
                            <Box sx={{ textAlign: 'center', py: 2 }}>
                              <i className="ri-server-line" style={{ fontSize: 48, opacity: 0.3 }} />
                              <Typography variant="body1" sx={{ mt: 1, fontWeight: 600 }}>
                                Standalone node - no cluster defined
                              </Typography>
                              <Typography variant="caption" sx={{ opacity: 0.6 }}>
                                Create a new cluster or join an existing one
                              </Typography>
                              <Stack direction="row" spacing={2} justifyContent="center" sx={{ mt: 3 }}>
                                <Button
                                  variant="contained"
                                  startIcon={<i className="ri-add-circle-line" />}
                                  onClick={() => {
                                    // Charger la config pour avoir les networks
                                    if (!clusterConfigLoaded) {
                                      loadClusterConfig(parseNodeId(selection.id).connId)
                                    }
                                    setCreateClusterDialogOpen(true)
                                  }}
                                >
                                  Create Cluster
                                </Button>
                                <Button
                                  variant="outlined"
                                  startIcon={<i className="ri-links-line" />}
                                  onClick={() => setJoinClusterDialogOpen(true)}
                                >
                                  Join Cluster
                                </Button>
                              </Stack>
                            </Box>
                          </CardContent>
                        </Card>

                        {/* Liste des Cluster Nodes (vide pour standalone) */}
                        <Card variant="outlined">
                          <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                            <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                              <Typography fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <i className="ri-server-line" style={{ fontSize: 18 }} />
                                Cluster Nodes
                              </Typography>
                            </Box>
                            <Box sx={{ p: 3, textAlign: 'center', opacity: 0.5 }}>
                              <Typography variant="body2">No cluster configured</Typography>
                            </Box>
                          </CardContent>
                        </Card>
                      </Stack>
                    )}
                  </Box>
                )}

                {/* Onglet Replication - Index 7 pour cluster, Index 8 pour standalone */}
                {((nodeTab === 7 && data.clusterName) || (nodeTab === 8 && !data.clusterName)) && (
                  <Box sx={{ p: 2 }}>
                    {nodeReplicationLoading ? (
                      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                        <CircularProgress size={24} />
                      </Box>
                    ) : (
                      <Stack spacing={2}>
                        {/* Header avec boutons */}
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Button 
                            size="small" 
                            variant="outlined"
                            startIcon={<i className="ri-add-line" style={{ fontSize: 14 }} />}
                            onClick={() => {
                              setReplicationDialogMode('create')
                              setEditingReplicationJob(null)
                              setReplicationFormData({
                                guest: '',
                                target: '',
                                schedule: '*/15',
                                rate: '',
                                comment: '',
                                enabled: true
                              })
                              setReplicationDialogOpen(true)
                            }}
                          >
                            Add
                          </Button>
                          <Button 
                            size="small" 
                            variant="outlined"
                            disabled={!editingReplicationJob}
                            startIcon={<i className="ri-edit-line" style={{ fontSize: 14 }} />}
                            onClick={() => {
                              if (editingReplicationJob) {
                                setReplicationDialogMode('edit')
                                setReplicationFormData({
                                  guest: String(editingReplicationJob.guest),
                                  target: editingReplicationJob.target,
                                  schedule: editingReplicationJob.schedule || '*/15',
                                  rate: editingReplicationJob.rate || '',
                                  comment: editingReplicationJob.comment || '',
                                  enabled: editingReplicationJob.enabled !== false
                                })
                                setReplicationDialogOpen(true)
                              }
                            }}
                          >
                            Edit
                          </Button>
                          <Button 
                            size="small" 
                            variant="outlined"
                            color="error"
                            disabled={!editingReplicationJob}
                            startIcon={<i className="ri-delete-bin-line" style={{ fontSize: 14 }} />}
                            onClick={() => {
                              if (editingReplicationJob) {
                                setDeletingReplicationJob(editingReplicationJob)
                                setDeleteReplicationDialogOpen(true)
                              }
                            }}
                          >
                            Remove
                          </Button>
                          <Button 
                            size="small" 
                            variant="outlined"
                            disabled={!editingReplicationJob}
                            startIcon={<i className="ri-file-list-line" style={{ fontSize: 14 }} />}
                            onClick={async () => {
                              if (editingReplicationJob) {
                                setReplicationLogJob(editingReplicationJob)
                                setReplicationLogDialogOpen(true)
                                setReplicationLogLoading(true)
                                const { connId, node } = parseNodeId(selection?.id || '')
                                try {
                                  const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/replication/${encodeURIComponent(editingReplicationJob.id)}?limit=100`, { cache: 'no-store' })
                                  if (res.ok) {
                                    const json = await res.json()
                                    setReplicationLogData(json.data || [])
                                  }
                                } finally {
                                  setReplicationLogLoading(false)
                                }
                              }
                            }}
                          >
                            Log
                          </Button>
                          <Button 
                            size="small" 
                            variant="outlined"
                            disabled={!editingReplicationJob}
                            startIcon={<i className="ri-play-line" style={{ fontSize: 14 }} />}
                            onClick={async () => {
                              if (editingReplicationJob) {
                                const { connId, node } = parseNodeId(selection?.id || '')
                                try {
                                  const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/replication/${encodeURIComponent(editingReplicationJob.id)}`, { 
                                    method: 'POST',
                                    cache: 'no-store' 
                                  })
                                  if (res.ok) {
                                    // Recharger les données
                                    setNodeReplicationLoaded(false)
                                  } else {
                                    const err = await res.json()
                                    alert(err.error || 'Failed to schedule replication')
                                  }
                                } catch (e) {
                                  alert('Error scheduling replication')
                                }
                              }
                            }}
                          >
                            Schedule now
                          </Button>
                        </Box>

                        {/* Tableau des jobs de réplication */}
                        <Card variant="outlined">
                          <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                            {(nodeReplicationData?.jobs?.length || 0) > 0 ? (
                              <TableContainer sx={{ maxHeight: 400 }}>
                                <Table size="small" stickyHeader>
                                  <TableHead>
                                    <TableRow>
                                      <TableCell padding="checkbox" sx={{ fontWeight: 700 }}></TableCell>
                                      <TableCell sx={{ fontWeight: 700 }}>Enabled</TableCell>
                                      <TableCell sx={{ fontWeight: 700 }}>Guest</TableCell>
                                      <TableCell sx={{ fontWeight: 700 }}>Job</TableCell>
                                      <TableCell sx={{ fontWeight: 700 }}>Target</TableCell>
                                      <TableCell sx={{ fontWeight: 700 }}>Schedule</TableCell>
                                      <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                                    </TableRow>
                                  </TableHead>
                                  <TableBody>
                                    {nodeReplicationData.jobs.map((job: any) => (
                                      <TableRow 
                                        key={job.id} 
                                        hover 
                                        selected={editingReplicationJob?.id === job.id}
                                        onClick={() => setEditingReplicationJob(job)}
                                        sx={{ cursor: 'pointer' }}
                                      >
                                        <TableCell padding="checkbox">
                                          <input 
                                            type="radio" 
                                            checked={editingReplicationJob?.id === job.id}
                                            onChange={() => setEditingReplicationJob(job)}
                                          />
                                        </TableCell>
                                        <TableCell>
                                          <Chip 
                                            size="small" 
                                            label={job.enabled ? 'Yes' : 'No'} 
                                            color={job.enabled ? 'success' : 'default'}
                                            sx={{ height: 20, fontSize: 10 }}
                                          />
                                        </TableCell>
                                        <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                                          {job.guest}
                                          {nodeReplicationData.guests?.find((g: any) => g.vmid === job.guest)?.name && (
                                            <Typography component="span" variant="caption" sx={{ ml: 1, opacity: 0.6 }}>
                                              ({nodeReplicationData.guests.find((g: any) => g.vmid === job.guest)?.name})
                                            </Typography>
                                          )}
                                        </TableCell>
                                        <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{job.id}</TableCell>
                                        <TableCell>{job.target}</TableCell>
                                        <TableCell sx={{ fontFamily: 'monospace', fontSize: 11 }}>{job.schedule || '*/15'}</TableCell>
                                        <TableCell>
                                          <Chip 
                                            size="small" 
                                            label={job.state || 'unknown'} 
                                            color={job.state === 'ok' ? 'success' : job.state === 'error' ? 'error' : 'default'}
                                            sx={{ height: 20, fontSize: 10 }}
                                          />
                                          {job.error && (
                                            <Typography variant="caption" sx={{ ml: 1, color: 'error.main' }}>
                                              {job.error}
                                            </Typography>
                                          )}
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </TableContainer>
                            ) : (
                              <Box sx={{ p: 4, textAlign: 'center', opacity: 0.5 }}>
                                <i className="ri-refresh-line" style={{ fontSize: 32 }} />
                                <Typography variant="body2" sx={{ mt: 1 }}>No replication jobs configured</Typography>
                              </Box>
                            )}
                          </CardContent>
                        </Card>

                        {/* Dialog Create/Edit Replication Job */}
                        <Dialog open={replicationDialogOpen} onClose={() => setReplicationDialogOpen(false)} maxWidth="sm" fullWidth>
                          <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <i className="ri-refresh-line" style={{ fontSize: 20 }} />
                            {replicationDialogMode === 'create' ? 'Create: Replication Job' : 'Edit: Replication Job'}
                          </DialogTitle>
                          <DialogContent>
                            <Stack spacing={2} sx={{ mt: 1 }}>
                              {replicationDialogMode === 'create' && (
                                <FormControl fullWidth size="small">
                                  <InputLabel>CT/VM ID</InputLabel>
                                  <Select
                                    value={replicationFormData.guest}
                                    label="CT/VM ID"
                                    onChange={(e) => setReplicationFormData(prev => ({ ...prev, guest: e.target.value }))}
                                  >
                                    {(nodeReplicationData?.guests || []).map((g: any) => (
                                      <MenuItem key={g.vmid} value={String(g.vmid)}>
                                        {g.vmid} - {g.name || 'unnamed'} ({g.type})
                                      </MenuItem>
                                    ))}
                                  </Select>
                                </FormControl>
                              )}
                              {replicationDialogMode === 'edit' && (
                                <TextField
                                  fullWidth
                                  size="small"
                                  label="CT/VM ID"
                                  value={replicationFormData.guest}
                                  disabled
                                />
                              )}
                              <FormControl fullWidth size="small">
                                <InputLabel>Target</InputLabel>
                                <Select
                                  value={replicationFormData.target}
                                  label="Target"
                                  onChange={(e) => setReplicationFormData(prev => ({ ...prev, target: e.target.value }))}
                                >
                                  {(nodeReplicationData?.nodes || []).map((n: any) => (
                                    <MenuItem key={n.node} value={n.node} disabled={!n.online}>
                                      {n.node} {!n.online && '(offline)'}
                                    </MenuItem>
                                  ))}
                                </Select>
                              </FormControl>
                              <FormControl fullWidth size="small">
                                <InputLabel>Schedule</InputLabel>
                                <Select
                                  value={replicationFormData.schedule}
                                  label="Schedule"
                                  onChange={(e) => setReplicationFormData(prev => ({ ...prev, schedule: e.target.value }))}
                                >
                                  <MenuItem value="*/1">*/1 - Every minute</MenuItem>
                                  <MenuItem value="*/5">*/5 - Every 5 minutes</MenuItem>
                                  <MenuItem value="*/15">*/15 - Every 15 minutes</MenuItem>
                                  <MenuItem value="*/30">*/30 - Every 30 minutes</MenuItem>
                                  <MenuItem value="0 *">0 * - Every hour</MenuItem>
                                  <MenuItem value="0 */2">0 */2 - Every 2 hours</MenuItem>
                                  <MenuItem value="0 */6">0 */6 - Every 6 hours</MenuItem>
                                  <MenuItem value="0 */12">0 */12 - Every 12 hours</MenuItem>
                                  <MenuItem value="0 0">0 0 - Daily at midnight</MenuItem>
                                </Select>
                              </FormControl>
                              <TextField
                                fullWidth
                                size="small"
                                label="Rate limit (MB/s)"
                                placeholder="unlimited"
                                value={replicationFormData.rate}
                                onChange={(e) => setReplicationFormData(prev => ({ ...prev, rate: e.target.value }))}
                                helperText="Leave empty for unlimited"
                              />
                              <TextField
                                fullWidth
                                size="small"
                                label="Comment"
                                value={replicationFormData.comment}
                                onChange={(e) => setReplicationFormData(prev => ({ ...prev, comment: e.target.value }))}
                              />
                              <FormControlLabel
                                control={
                                  <Checkbox
                                    checked={replicationFormData.enabled}
                                    onChange={(e) => setReplicationFormData(prev => ({ ...prev, enabled: e.target.checked }))}
                                  />
                                }
                                label="Enabled"
                              />
                            </Stack>
                          </DialogContent>
                          <DialogActions>
                            <Button onClick={() => setReplicationDialogOpen(false)}>Cancel</Button>
                            <Button 
                              variant="contained"
                              disabled={replicationSaving || (replicationDialogMode === 'create' && (!replicationFormData.guest || !replicationFormData.target))}
                              onClick={async () => {
                                setReplicationSaving(true)
                                const { connId, node } = parseNodeId(selection?.id || '')
                                try {
                                  const method = replicationDialogMode === 'create' ? 'POST' : 'PUT'
                                  const body = replicationDialogMode === 'create' 
                                    ? {
                                        guest: replicationFormData.guest,
                                        target: replicationFormData.target,
                                        schedule: replicationFormData.schedule,
                                        rate: replicationFormData.rate || undefined,
                                        comment: replicationFormData.comment || undefined,
                                        enabled: replicationFormData.enabled
                                      }
                                    : {
                                        jobId: editingReplicationJob?.id,
                                        schedule: replicationFormData.schedule,
                                        rate: replicationFormData.rate || undefined,
                                        comment: replicationFormData.comment || undefined,
                                        enabled: replicationFormData.enabled
                                      }
                                  
                                  const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/replication`, {
                                    method,
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(body)
                                  })
                                  
                                  if (res.ok) {
                                    setReplicationDialogOpen(false)
                                    setNodeReplicationLoaded(false) // Recharger
                                  } else {
                                    const err = await res.json()
                                    alert(err.error || 'Failed to save replication job')
                                  }
                                } catch (e) {
                                  alert('Error saving replication job')
                                } finally {
                                  setReplicationSaving(false)
                                }
                              }}
                            >
                              {replicationSaving ? <CircularProgress size={20} /> : (replicationDialogMode === 'create' ? 'Create' : 'Save')}
                            </Button>
                          </DialogActions>
                        </Dialog>

                        {/* Dialog Delete Replication Job */}
                        <Dialog open={deleteReplicationDialogOpen} onClose={() => setDeleteReplicationDialogOpen(false)} maxWidth="xs" fullWidth>
                          <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'error.main' }}>
                            <i className="ri-error-warning-line" style={{ fontSize: 20 }} />
                            Remove Replication Job
                          </DialogTitle>
                          <DialogContent>
                            <Typography variant="body2">
                              Are you sure you want to remove the replication job <strong>{deletingReplicationJob?.id}</strong>?
                            </Typography>
                          </DialogContent>
                          <DialogActions>
                            <Button onClick={() => setDeleteReplicationDialogOpen(false)}>Cancel</Button>
                            <Button 
                              variant="contained"
                              color="error"
                              disabled={replicationDeleting}
                              onClick={async () => {
                                setReplicationDeleting(true)
                                const { connId, node } = parseNodeId(selection?.id || '')
                                try {
                                  const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/replication?jobId=${encodeURIComponent(deletingReplicationJob?.id)}`, {
                                    method: 'DELETE'
                                  })
                                  if (res.ok) {
                                    setDeleteReplicationDialogOpen(false)
                                    setEditingReplicationJob(null)
                                    setNodeReplicationLoaded(false) // Recharger
                                  } else {
                                    const err = await res.json()
                                    alert(err.error || 'Failed to delete replication job')
                                  }
                                } catch (e) {
                                  alert('Error deleting replication job')
                                } finally {
                                  setReplicationDeleting(false)
                                }
                              }}
                            >
                              {replicationDeleting ? <CircularProgress size={20} /> : 'Remove'}
                            </Button>
                          </DialogActions>
                        </Dialog>

                        {/* Dialog Replication Log */}
                        <Dialog open={replicationLogDialogOpen} onClose={() => setReplicationLogDialogOpen(false)} maxWidth="md" fullWidth>
                          <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <i className="ri-file-list-line" style={{ fontSize: 20 }} />
                            Replication Log - {replicationLogJob?.id}
                          </DialogTitle>
                          <DialogContent dividers>
                            {replicationLogLoading ? (
                              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                                <CircularProgress size={24} />
                              </Box>
                            ) : replicationLogData.length > 0 ? (
                              <Box 
                                component="pre" 
                                sx={{ 
                                  fontFamily: 'monospace', 
                                  fontSize: 11, 
                                  whiteSpace: 'pre-wrap', 
                                  wordBreak: 'break-all',
                                  m: 0,
                                  p: 2,
                                  bgcolor: 'background.default',
                                  borderRadius: 1,
                                  maxHeight: '50vh',
                                  overflow: 'auto'
                                }}
                              >
                                {replicationLogData.join('\n')}
                              </Box>
                            ) : (
                              <Box sx={{ p: 4, textAlign: 'center', opacity: 0.5 }}>
                                <Typography variant="body2">No log entries</Typography>
                              </Box>
                            )}
                          </DialogContent>
                          <DialogActions>
                            <Button onClick={() => setReplicationLogDialogOpen(false)}>Close</Button>
                          </DialogActions>
                        </Dialog>
                      </Stack>
                    )}
                  </Box>
                )}

                {/* Onglet Subscription - Index 8 pour cluster, Index 9 pour standalone */}
                {((nodeTab === 8 && data.clusterName) || (nodeTab === 9 && !data.clusterName)) && (
                  <Box sx={{ p: 2 }}>
                    {nodeSubscriptionLoading ? (
                      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                        <CircularProgress size={24} />
                      </Box>
                    ) : (
                      <Stack spacing={2}>
                        {/* Header avec boutons */}
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Button 
                            size="small" 
                            variant="outlined"
                            startIcon={<i className="ri-upload-2-line" style={{ fontSize: 14 }} />}
                            onClick={() => {
                              setSubscriptionKeyInput(nodeSubscriptionData?.key || '')
                              setSubscriptionKeyDialogOpen(true)
                            }}
                          >
                            Upload Subscription Key
                          </Button>
                          <Button 
                            size="small" 
                            variant="outlined"
                            startIcon={<i className="ri-refresh-line" style={{ fontSize: 14 }} />}
                            onClick={async () => {
                              setNodeSubscriptionLoading(true)
                              const { connId, node } = parseNodeId(selection?.id || '')
                              try {
                                const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/subscription`, { 
                                  method: 'POST',
                                  cache: 'no-store' 
                                })
                                if (res.ok) {
                                  const json = await res.json()
                                  setNodeSubscriptionData(json.data || json)
                                }
                              } finally {
                                setNodeSubscriptionLoading(false)
                              }
                            }}
                          >
                            Check
                          </Button>
                          <Button 
                            size="small" 
                            variant="outlined"
                            color="error"
                            disabled={!nodeSubscriptionData?.key}
                            startIcon={<i className="ri-delete-bin-line" style={{ fontSize: 14 }} />}
                            onClick={() => setRemoveSubscriptionDialogOpen(true)}
                          >
                            Remove Subscription
                          </Button>
                          <Button 
                            size="small" 
                            variant="outlined"
                            startIcon={<i className="ri-file-text-line" style={{ fontSize: 14 }} />}
                            onClick={async () => {
                              setSystemReportDialogOpen(true)
                              setSystemReportLoading(true)
                              setSystemReportData(null)
                              const { connId, node } = parseNodeId(selection?.id || '')
                              try {
                                const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/report`, { cache: 'no-store' })
                                if (res.ok) {
                                  const json = await res.json()
                                  setSystemReportData(json.data || 'No report available')
                                } else {
                                  setSystemReportData('Failed to load system report')
                                }
                              } catch (e) {
                                setSystemReportData('Error loading system report')
                              } finally {
                                setSystemReportLoading(false)
                              }
                            }}
                          >
                            System Report
                          </Button>
                        </Box>

                        {/* Informations de subscription */}
                        <Card variant="outlined">
                          <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                            <TableContainer>
                              <Table size="small">
                                <TableBody>
                                  <TableRow>
                                    <TableCell sx={{ fontWeight: 600, width: 200, borderBottom: '1px solid', borderColor: 'divider' }}>Type</TableCell>
                                    <TableCell sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
                                      {nodeSubscriptionData?.type || nodeSubscriptionData?.productname || 'No valid subscription'}
                                    </TableCell>
                                  </TableRow>
                                  <TableRow>
                                    <TableCell sx={{ fontWeight: 600, borderBottom: '1px solid', borderColor: 'divider' }}>Subscription Key</TableCell>
                                    <TableCell sx={{ fontFamily: 'monospace', fontSize: 12, borderBottom: '1px solid', borderColor: 'divider' }}>
                                      {nodeSubscriptionData?.key ? (
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                          <span>{nodeSubscriptionData.key.substring(0, 8)}{'*'.repeat(Math.max(0, nodeSubscriptionData.key.length - 16))}{nodeSubscriptionData.key.substring(nodeSubscriptionData.key.length - 8)}</span>
                                        </Box>
                                      ) : (
                                        <Typography variant="caption" sx={{ opacity: 0.5 }}>-</Typography>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                  <TableRow>
                                    <TableCell sx={{ fontWeight: 600, borderBottom: '1px solid', borderColor: 'divider' }}>Status</TableCell>
                                    <TableCell sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
                                      <Chip 
                                        size="small" 
                                        label={nodeSubscriptionData?.status || 'unknown'}
                                        color={nodeSubscriptionData?.status === 'active' || nodeSubscriptionData?.status === 'Active' ? 'success' : 
                                               nodeSubscriptionData?.status === 'notfound' ? 'warning' : 'default'}
                                        sx={{ height: 22, fontSize: 11 }}
                                      />
                                    </TableCell>
                                  </TableRow>
                                  <TableRow>
                                    <TableCell sx={{ fontWeight: 600, borderBottom: '1px solid', borderColor: 'divider' }}>Server ID</TableCell>
                                    <TableCell sx={{ fontFamily: 'monospace', fontSize: 11, borderBottom: '1px solid', borderColor: 'divider' }}>
                                      {nodeSubscriptionData?.serverId || nodeSubscriptionData?.serverid || '-'}
                                    </TableCell>
                                  </TableRow>
                                  <TableRow>
                                    <TableCell sx={{ fontWeight: 600, borderBottom: '1px solid', borderColor: 'divider' }}>Sockets</TableCell>
                                    <TableCell sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
                                      {nodeSubscriptionData?.sockets || '-'}
                                    </TableCell>
                                  </TableRow>
                                  <TableRow>
                                    <TableCell sx={{ fontWeight: 600, borderBottom: '1px solid', borderColor: 'divider' }}>Last checked</TableCell>
                                    <TableCell sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
                                      {nodeSubscriptionData?.lastChecked ? 
                                        new Date(nodeSubscriptionData.lastChecked).toLocaleString() : '-'}
                                    </TableCell>
                                  </TableRow>
                                  <TableRow>
                                    <TableCell sx={{ fontWeight: 600 }}>Next due date</TableCell>
                                    <TableCell>
                                      {nodeSubscriptionData?.nextDueDate || nodeSubscriptionData?.nextduedate || '-'}
                                    </TableCell>
                                  </TableRow>
                                </TableBody>
                              </Table>
                            </TableContainer>
                          </CardContent>
                        </Card>

                        {/* Message si pas de subscription */}
                        {(!nodeSubscriptionData || nodeSubscriptionData.status === 'notfound' || nodeSubscriptionData.status === 'new') && (
                          <Card variant="outlined" sx={{ bgcolor: 'warning.main', color: 'warning.contrastText' }}>
                            <CardContent sx={{ py: 2 }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                <i className="ri-error-warning-line" style={{ fontSize: 24 }} />
                                <Box>
                                  <Typography variant="body2" fontWeight={600}>No valid subscription</Typography>
                                  <Typography variant="caption">
                                    You do not have a valid subscription for this server. Please visit{' '}
                                    <a href="https://www.proxmox.com/proxmox-ve/pricing" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>
                                      www.proxmox.com
                                    </a>
                                    {' '}to get a list of available options.
                                  </Typography>
                                </Box>
                              </Box>
                            </CardContent>
                          </Card>
                        )}

                        {/* Dialog Upload Subscription Key */}
                        <Dialog open={subscriptionKeyDialogOpen} onClose={() => setSubscriptionKeyDialogOpen(false)} maxWidth="sm" fullWidth>
                          <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <i className="ri-key-line" style={{ fontSize: 20 }} />
                            Upload Subscription Key
                          </DialogTitle>
                          <DialogContent>
                            <Typography variant="body2" sx={{ mb: 2, opacity: 0.7 }}>
                              Enter your Proxmox subscription key. The key will be validated with the Proxmox servers.
                            </Typography>
                            <TextField
                              fullWidth
                              label="Subscription Key"
                              placeholder="pve2c-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                              value={subscriptionKeyInput}
                              onChange={(e) => setSubscriptionKeyInput(e.target.value)}
                              variant="outlined"
                              size="small"
                              InputProps={{
                                sx: { fontFamily: 'monospace' }
                              }}
                            />
                          </DialogContent>
                          <DialogActions>
                            <Button onClick={() => setSubscriptionKeyDialogOpen(false)}>Cancel</Button>
                            <Button 
                              variant="contained"
                              disabled={!subscriptionKeyInput.trim() || subscriptionKeySaving}
                              onClick={async () => {
                                setSubscriptionKeySaving(true)
                                const { connId, node } = parseNodeId(selection?.id || '')
                                try {
                                  const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/subscription`, {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ key: subscriptionKeyInput.trim() })
                                  })
                                  if (res.ok) {
                                    const json = await res.json()
                                    setNodeSubscriptionData(json.data || json)
                                    setSubscriptionKeyDialogOpen(false)
                                  } else {
                                    const err = await res.json()
                                    alert(err.error || 'Failed to upload subscription key')
                                  }
                                } catch (e) {
                                  alert('Error uploading subscription key')
                                } finally {
                                  setSubscriptionKeySaving(false)
                                }
                              }}
                            >
                              {subscriptionKeySaving ? <CircularProgress size={20} /> : 'Upload'}
                            </Button>
                          </DialogActions>
                        </Dialog>

                        {/* Dialog Remove Subscription */}
                        <Dialog open={removeSubscriptionDialogOpen} onClose={() => setRemoveSubscriptionDialogOpen(false)} maxWidth="xs" fullWidth>
                          <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'error.main' }}>
                            <i className="ri-error-warning-line" style={{ fontSize: 20 }} />
                            Remove Subscription
                          </DialogTitle>
                          <DialogContent>
                            <Typography variant="body2">
                              Are you sure you want to remove the subscription key from this node?
                            </Typography>
                            <Typography variant="caption" sx={{ mt: 1, display: 'block', opacity: 0.7 }}>
                              This will not cancel your subscription with Proxmox, only remove the key from this server.
                            </Typography>
                          </DialogContent>
                          <DialogActions>
                            <Button onClick={() => setRemoveSubscriptionDialogOpen(false)}>Cancel</Button>
                            <Button 
                              variant="contained"
                              color="error"
                              disabled={removeSubscriptionLoading}
                              onClick={async () => {
                                setRemoveSubscriptionLoading(true)
                                const { connId, node } = parseNodeId(selection?.id || '')
                                try {
                                  const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/subscription`, {
                                    method: 'DELETE'
                                  })
                                  if (res.ok) {
                                    const json = await res.json()
                                    setNodeSubscriptionData(json.data || json)
                                    setRemoveSubscriptionDialogOpen(false)
                                  } else {
                                    const err = await res.json()
                                    alert(err.error || 'Failed to remove subscription')
                                  }
                                } catch (e) {
                                  alert('Error removing subscription')
                                } finally {
                                  setRemoveSubscriptionLoading(false)
                                }
                              }}
                            >
                              {removeSubscriptionLoading ? <CircularProgress size={20} /> : 'Remove'}
                            </Button>
                          </DialogActions>
                        </Dialog>

                        {/* Dialog System Report */}
                        <Dialog open={systemReportDialogOpen} onClose={() => setSystemReportDialogOpen(false)} maxWidth="lg" fullWidth>
                          <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <i className="ri-file-text-line" style={{ fontSize: 20 }} />
                              System Report - {selection?.id ? parseNodeId(selection.id).node : ''}
                            </Box>
                            <IconButton 
                              size="small" 
                              onClick={() => {
                                if (systemReportData) {
                                  navigator.clipboard.writeText(systemReportData)
                                }
                              }}
                              title="Copy to clipboard"
                            >
                              <i className="ri-file-copy-line" style={{ fontSize: 18 }} />
                            </IconButton>
                          </DialogTitle>
                          <DialogContent dividers>
                            {systemReportLoading ? (
                              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                                <CircularProgress size={24} />
                              </Box>
                            ) : (
                              <Box 
                                component="pre" 
                                sx={{ 
                                  fontFamily: 'monospace', 
                                  fontSize: 11, 
                                  whiteSpace: 'pre-wrap', 
                                  wordBreak: 'break-all',
                                  m: 0,
                                  p: 2,
                                  bgcolor: 'background.default',
                                  borderRadius: 1,
                                  maxHeight: '60vh',
                                  overflow: 'auto'
                                }}
                              >
                                {systemReportData || 'No report data'}
                              </Box>
                            )}
                          </DialogContent>
                          <DialogActions>
                            <Button onClick={() => setSystemReportDialogOpen(false)}>Close</Button>
                          </DialogActions>
                        </Dialog>
                      </Stack>
                    )}
                  </Box>
                )}
              </CardContent>
            </Card>
          ) : null}

          {/* Affichage PBS Server - Datastores puis graphiques en dessous */}
          {selection?.type === 'pbs' && data.pbsInfo && (
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
                          <Box sx={{ flex: 1, height: 6, bgcolor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
                            <Box 
                              sx={{ 
                                width: `${ds.usagePercent || 0}%`, 
                                height: '100%', 
                                bgcolor: (ds.usagePercent || 0) > 90 ? 'error.main' : (ds.usagePercent || 0) > 70 ? 'warning.main' : 'success.main',
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
                          { value: 'week', label: '7j' },
                          { value: 'month', label: '30j' },
                          { value: 'year', label: '1an' },
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
                              <XAxis dataKey="time" tickFormatter={v => new Date(v * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} minTickGap={40} tick={{ fontSize: 9 }} />
                              <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 9 }} width={30} />
                              <Tooltip
                                labelFormatter={v => new Date(Number(v) * 1000).toLocaleString()}
                                formatter={(v: any, name: string) => [`${Number(v).toFixed(1)}%`, name === 'cpu' ? 'CPU' : 'IO Wait']}
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
                              <XAxis dataKey="time" tickFormatter={v => new Date(v * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} minTickGap={40} tick={{ fontSize: 9 }} />
                              <YAxis tick={{ fontSize: 9 }} width={30} />
                              <Tooltip
                                labelFormatter={v => new Date(Number(v) * 1000).toLocaleString()}
                                formatter={(v: any) => [Number(v).toFixed(2), 'Load Average']}
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
                              <XAxis dataKey="time" tickFormatter={v => new Date(v * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} minTickGap={40} tick={{ fontSize: 9 }} />
                              <YAxis tickFormatter={v => formatBytes(v)} tick={{ fontSize: 9 }} width={45} />
                              <Tooltip
                                labelFormatter={v => new Date(Number(v) * 1000).toLocaleString()}
                                formatter={(v: any, name: string) => [formatBytes(Number(v)), name === 'memused' ? 'RAM Usage' : 'Total']}
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
                              <XAxis dataKey="time" tickFormatter={v => new Date(v * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} minTickGap={40} tick={{ fontSize: 9 }} />
                              <YAxis tickFormatter={v => formatBytes(v)} tick={{ fontSize: 9 }} width={45} />
                              <Tooltip
                                labelFormatter={v => new Date(Number(v) * 1000).toLocaleString()}
                                formatter={(v: any, name: string) => [formatBytes(Number(v)), name === 'swapused' ? 'Swap Usage' : 'Total']}
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
                              <XAxis dataKey="time" tickFormatter={v => new Date(v * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} minTickGap={40} tick={{ fontSize: 9 }} />
                              <YAxis tickFormatter={v => formatBytes(v) + '/s'} tick={{ fontSize: 9 }} width={55} />
                              <Tooltip
                                labelFormatter={v => new Date(Number(v) * 1000).toLocaleString()}
                                formatter={(v: any, name: string) => [formatBytes(Number(v)) + '/s', name === 'netin' ? 'In' : 'Out']}
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
                              <XAxis dataKey="time" tickFormatter={v => new Date(v * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} minTickGap={40} tick={{ fontSize: 9 }} />
                              <YAxis tickFormatter={v => formatBytes(v)} tick={{ fontSize: 9 }} width={45} />
                              <Tooltip
                                labelFormatter={v => new Date(Number(v) * 1000).toLocaleString()}
                                formatter={(v: any, name: string) => [formatBytes(Number(v)), name === 'rootused' ? 'Disk Usage' : 'Total']}
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
          {selection?.type === 'datastore' && data.datastoreInfo && (
            <Card variant="outlined" sx={{ width: '100%', borderRadius: 2, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
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
                      Summary
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
              
              <CardContent sx={{ p: 0, '&:last-child': { pb: 0 }, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
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
                          <Typography variant="caption" sx={{ opacity: 0.7 }}>VMs</Typography>
                        </Box>
                        <Box sx={{ textAlign: 'center', p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                          <Typography variant="h4" fontWeight={700} color="secondary.main">
                            {data.datastoreInfo.stats?.ctCount || 0}
                          </Typography>
                          <Typography variant="caption" sx={{ opacity: 0.7 }}>Containers</Typography>
                        </Box>
                        <Box sx={{ textAlign: 'center', p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                          <Typography variant="h4" fontWeight={700}>
                            {data.datastoreInfo.stats?.total || 0}
                          </Typography>
                          <Typography variant="caption" sx={{ opacity: 0.7 }}>Total Snapshots</Typography>
                        </Box>
                        <Box sx={{ textAlign: 'center', p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                          <Typography variant="h4" fontWeight={700} color="success.main">
                            {data.datastoreInfo.stats?.verifiedCount || 0}
                          </Typography>
                          <Typography variant="caption" sx={{ opacity: 0.7 }}>Verified</Typography>
                        </Box>
                      </Box>

                      {/* Graphique de stockage style Proxmox */}
                      <Box sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                          <i className="ri-hard-drive-2-line" style={{ fontSize: 18 }} />
                          Storage Usage
                        </Typography>
                        
                        {/* Progress bar large style Proxmox */}
                        <Box sx={{ position: 'relative', height: 40, bgcolor: 'divider', borderRadius: 1, overflow: 'hidden', mb: 2 }}>
                          <Box 
                            sx={{ 
                              position: 'absolute',
                              left: 0,
                              top: 0,
                              bottom: 0,
                              width: `${data.datastoreInfo.usagePercent || 0}%`, 
                              bgcolor: (data.datastoreInfo.usagePercent || 0) > 90 ? 'error.main' : (data.datastoreInfo.usagePercent || 0) > 70 ? 'warning.main' : 'primary.main',
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
                            <Typography variant="caption" sx={{ opacity: 0.6 }}>Used</Typography>
                          </Box>
                          <Box>
                            <Typography variant="body2" fontWeight={600} color="success.main">
                              {formatBytes(data.datastoreInfo.available || 0)}
                            </Typography>
                            <Typography variant="caption" sx={{ opacity: 0.6 }}>Available</Typography>
                          </Box>
                          <Box>
                            <Typography variant="body2" fontWeight={600}>
                              {formatBytes(data.datastoreInfo.total || 0)}
                            </Typography>
                            <Typography variant="caption" sx={{ opacity: 0.6 }}>Total</Typography>
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
                              Datastore Statistics
                            </Typography>
                            {/* Sélecteur de timeframe */}
                            <Box sx={{ display: 'flex', gap: 0.5 }}>
                              {[
                                { value: 'hour', label: '1h' },
                                { value: 'day', label: '24h' },
                                { value: 'week', label: '7j' },
                                { value: 'month', label: '30j' },
                                { value: 'year', label: '1an' },
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
                                Storage Usage (bytes)
                              </Typography>
                              <Box sx={{ height: 180 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                  <AreaChart data={dsRrdData}>
                                    <XAxis dataKey="time" tickFormatter={v => new Date(v * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} minTickGap={40} tick={{ fontSize: 9 }} />
                                    <YAxis tickFormatter={v => formatBytes(v)} tick={{ fontSize: 9 }} width={50} />
                                    <Tooltip
                                      labelFormatter={v => new Date(Number(v) * 1000).toLocaleString()}
                                      formatter={(v: any, name: string) => [formatBytes(Number(v)), name === 'used' ? 'Storage usage' : 'Total']}
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
                                Transfer Rate (bytes/second)
                              </Typography>
                              <Box sx={{ height: 180 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                  <AreaChart data={dsRrdData}>
                                    <XAxis dataKey="time" tickFormatter={v => new Date(v * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} minTickGap={40} tick={{ fontSize: 9 }} />
                                    <YAxis tickFormatter={v => formatBytes(v) + '/s'} tick={{ fontSize: 9 }} width={55} />
                                    <Tooltip
                                      labelFormatter={v => new Date(Number(v) * 1000).toLocaleString()}
                                      formatter={(v: any, name: string) => [formatBytes(Number(v)) + '/s', name === 'read' ? 'Read' : 'Write']}
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
                                Input/Output Operations per Second (IOPS)
                              </Typography>
                              <Box sx={{ height: 180 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                  <AreaChart data={dsRrdData}>
                                    <XAxis dataKey="time" tickFormatter={v => new Date(v * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} minTickGap={40} tick={{ fontSize: 9 }} />
                                    <YAxis tick={{ fontSize: 9 }} width={40} />
                                    <Tooltip
                                      labelFormatter={v => new Date(Number(v) * 1000).toLocaleString()}
                                      formatter={(v: any, name: string) => [Number(v).toFixed(0), name === 'readIops' ? 'Read' : 'Write']}
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
                            Garbage Collection
                          </Typography>
                          {data.datastoreInfo.gcStatus ? (
                            <Stack spacing={0.5}>
                              <Typography variant="caption">
                                <strong>Status:</strong> {data.datastoreInfo.gcStatus?.upid ? 'Completed' : 'N/A'}
                              </Typography>
                            </Stack>
                          ) : (
                            <Typography variant="caption" sx={{ opacity: 0.5 }}>No GC data available</Typography>
                          )}
                        </Box>

                        {/* Verify Status */}
                        <Box sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                            <i className="ri-checkbox-circle-line" style={{ fontSize: 18 }} />
                            Verification
                          </Typography>
                          <Stack spacing={0.5}>
                            <Typography variant="caption">
                              <strong>Verified:</strong> {data.datastoreInfo.stats?.verifiedCount || 0} / {data.datastoreInfo.stats?.total || 0}
                            </Typography>
                          </Stack>
                        </Box>
                      </Box>

                      {/* Path info */}
                      {data.datastoreInfo.path && (
                        <Box sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
                          <Typography variant="caption" sx={{ opacity: 0.6 }}>
                            <i className="ri-folder-line" style={{ marginRight: 6 }} />
                            Path: <code style={{ opacity: 1 }}>{data.datastoreInfo.path}</code>
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
                        onChange={(e) => setPbsBackupSearch(e.target.value)}
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
                    <Box sx={{ flex: 1, overflow: 'auto' }}>
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

                        if (sortedGroups.length === 0) {
                          return (
                            <Box sx={{ p: 4, textAlign: 'center' }}>
                              <i className="ri-inbox-line" style={{ fontSize: 48, opacity: 0.3 }} />
                              <Typography variant="body2" sx={{ opacity: 0.5, mt: 1 }}>
                                {pbsBackupSearch ? t('common.noResults') : 'No backups found'}
                              </Typography>
                            </Box>
                          )
                        }

                        return sortedGroups.map(([groupId, groupBackups]) => {
                          const latestBackup = groupBackups[0]
                          const isExpanded = expandedBackupGroups.has(groupId)
                          const totalSize = groupBackups.reduce((sum: number, b: any) => sum + (b.size || 0), 0)
                          const verifiedCount = groupBackups.filter((b: any) => b.verified).length
                          const backupType = latestBackup.backupType || 'vm'

                          return (
                            <Box key={groupId}>
                              {/* Header du groupe */}
                              <Box 
                                onClick={() => {
                                  setExpandedBackupGroups(prev => {
                                    const next = new Set(prev)
                                    if (next.has(groupId)) {
                                      next.delete(groupId)
                                    } else {
                                      next.add(groupId)
                                    }
                                    return next
                                  })
                                }}
                                sx={{ 
                                  display: 'flex', 
                                  alignItems: 'center', 
                                  gap: 1,
                                  px: 2,
                                  py: 1.25,
                                  borderBottom: '1px solid',
                                  borderColor: 'divider',
                                  cursor: 'pointer',
                                  '&:hover': { bgcolor: 'action.hover' },
                                  bgcolor: isExpanded ? 'action.selected' : 'transparent'
                                }}
                              >
                                <i className={isExpanded ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} style={{ fontSize: 20, opacity: 0.5 }} />
                                {/* Icône VM ou CT en début de ligne (juste l'icône, pas de texte) */}
                                <i 
                                  className={backupType === 'vm' ? 'ri-computer-line' : backupType === 'ct' ? 'ri-instance-line' : 'ri-server-line'} 
                                  style={{ 
                                    fontSize: 18, 
                                    color: backupType === 'vm' ? '#ff9800' : backupType === 'ct' ? '#9c27b0' : '#757575'
                                  }} 
                                />
                                {/* Nom de la VM/CT */}
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="body2" fontWeight={600} noWrap>
                                    {latestBackup.vmName || groupId}
                                  </Typography>
                                  <Typography variant="caption" sx={{ opacity: 0.5 }}>
                                    {groupId}
                                  </Typography>
                                </Box>
                                {/* À droite: nombre de snapshots + badge VM/CT + vérification + taille */}
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                  <Typography variant="body2" sx={{ opacity: 0.7 }}>
                                    {groupBackups.length} snapshot{groupBackups.length > 1 ? 's' : ''}
                                  </Typography>
                                  {/* Badge VM/CT à droite */}
                                  <Chip 
                                    size="small" 
                                    label={backupType.toUpperCase()}
                                    sx={{ 
                                      height: 20, 
                                      minWidth: 32,
                                      fontSize: 10, 
                                      fontWeight: 700,
                                      bgcolor: backupType === 'vm' ? '#ff9800' : backupType === 'ct' ? '#9c27b0' : 'grey.500',
                                      color: 'white',
                                      '& .MuiChip-label': { px: 0.75 }
                                    }}
                                  />
                                  {verifiedCount === groupBackups.length ? (
                                    <MuiTooltip title="All verified">
                                      <i className="ri-checkbox-circle-fill" style={{ fontSize: 18, color: '#4caf50' }} />
                                    </MuiTooltip>
                                  ) : verifiedCount > 0 ? (
                                    <MuiTooltip title={`${verifiedCount}/${groupBackups.length} verified`}>
                                      <i className="ri-checkbox-circle-line" style={{ fontSize: 18, color: '#ff9800' }} />
                                    </MuiTooltip>
                                  ) : (
                                    <MuiTooltip title="Not verified">
                                      <i className="ri-checkbox-blank-circle-line" style={{ fontSize: 18, opacity: 0.3 }} />
                                    </MuiTooltip>
                                  )}
                                  <Typography variant="body2" sx={{ opacity: 0.6, minWidth: 80, textAlign: 'right' }}>
                                    {formatBytes(totalSize)}
                                  </Typography>
                                </Box>
                              </Box>

                              {/* Snapshots du groupe (expandable) */}
                              {isExpanded && (
                                <Box sx={{ bgcolor: 'action.hover' }}>
                                  {/* Header des colonnes */}
                                  <Box sx={{ 
                                    display: 'grid', 
                                    gridTemplateColumns: '1fr 100px 80px 50px',
                                    gap: 1,
                                    px: 2,
                                    pl: 5,
                                    py: 0.5,
                                    borderBottom: '1px solid',
                                    borderColor: 'divider',
                                    bgcolor: 'background.paper'
                                  }}>
                                    <Typography variant="caption" fontWeight={600} sx={{ opacity: 0.6 }}>Date</Typography>
                                    <Typography variant="caption" fontWeight={600} sx={{ opacity: 0.6 }}>Size</Typography>
                                    <Typography variant="caption" fontWeight={600} sx={{ opacity: 0.6, textAlign: 'center' }}>Status</Typography>
                                    <Typography variant="caption" fontWeight={600} sx={{ opacity: 0.6, textAlign: 'center' }}>Actions</Typography>
                                  </Box>
                                  {groupBackups.map((backup: any, idx: number) => (
                                    <Box 
                                      key={backup.id || idx}
                                      sx={{ 
                                        display: 'grid', 
                                        gridTemplateColumns: '1fr 100px 80px 50px',
                                        gap: 1,
                                        px: 2,
                                        pl: 5,
                                        py: 0.75,
                                        borderBottom: idx < groupBackups.length - 1 ? '1px solid' : 'none',
                                        borderColor: 'divider',
                                        alignItems: 'center',
                                        '&:hover': { bgcolor: 'action.focus' }
                                      }}
                                    >
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                        <i className="ri-time-line" style={{ fontSize: 14, opacity: 0.5 }} />
                                        <Typography variant="body2">
                                          {backup.backupTimeFormatted}
                                        </Typography>
                                      </Box>
                                      <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                                        {backup.sizeFormatted}
                                      </Typography>
                                      {/* Icônes de statut */}
                                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                                        {backup.verified ? (
                                          <MuiTooltip title={t('pbs.verified')}>
                                            <i className="ri-checkbox-circle-fill" style={{ fontSize: 16, color: '#4caf50' }} />
                                          </MuiTooltip>
                                        ) : (
                                          <MuiTooltip title="Not verified">
                                            <i className="ri-checkbox-blank-circle-line" style={{ fontSize: 16, opacity: 0.3 }} />
                                          </MuiTooltip>
                                        )}
                                        {backup.protected && (
                                          <MuiTooltip title={t('pbs.protected')}>
                                            <i className="ri-lock-fill" style={{ fontSize: 16, color: '#ff9800' }} />
                                          </MuiTooltip>
                                        )}
                                      </Box>
                                      {/* Actions */}
                                      <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                                        <MuiTooltip title={t('common.delete')}>
                                          <IconButton 
                                            size="small" 
                                            color="error"
                                            disabled={backup.protected}
                                            sx={{ opacity: 0.5, '&:hover': { opacity: 1 } }}
                                          >
                                            <i className="ri-delete-bin-line" style={{ fontSize: 14 }} />
                                          </IconButton>
                                        </MuiTooltip>
                                      </Box>
                                    </Box>
                                  ))}
                                </Box>
                              )}
                            </Box>
                          )
                        })
                      })()}
                    </Box>
                  </Box>
                )}
              </CardContent>
            </Card>
          )}

          <Typography variant="caption" sx={{ color: 'text.secondary', opacity: 0.95 }}>
            {t('inventoryPage.lastUpdated')} {data.lastUpdated}
          </Typography>
        </Stack>
      ) : null}

      {/* Dialog Créer VM */}
      <CreateVmDialog
        open={createVmDialogOpen}
        onClose={() => setCreateVmDialogOpen(false)}
        allVms={allVms}
        onCreated={handleVmCreated}
      />

      {/* Dialog Créer LXC */}
      <CreateLxcDialog
        open={createLxcDialogOpen}
        onClose={() => setCreateLxcDialogOpen(false)}
        allVms={allVms}
        onCreated={handleLxcCreated}
      />

      {/* Dialogs Hardware */}
      {selection?.type === 'vm' && (() => {
        const { connId, node, vmid, type } = parseVmId(selection.id)
        const existingDisks = data?.disksInfo?.map((d: any) => d.id) || []
        const existingNets = data?.networkInfo?.map((n: any) => n.id) || []
        
        return (
          <>
            <AddDiskDialog
              open={addDiskDialogOpen}
              onClose={() => setAddDiskDialogOpen(false)}
              onSave={handleSaveDisk}
              connId={connId}
              node={node}
              vmid={vmid}
              existingDisks={existingDisks}
            />
            
            <AddNetworkDialog
              open={addNetworkDialogOpen}
              onClose={() => setAddNetworkDialogOpen(false)}
              onSave={handleSaveNetwork}
              connId={connId}
              node={node}
              vmid={vmid}
              existingNets={existingNets}
            />
            
            <EditScsiControllerDialog
              open={editScsiControllerDialogOpen}
              onClose={() => setEditScsiControllerDialogOpen(false)}
              onSave={handleSaveScsiController}
              currentController={data?.optionsInfo?.scsihw || 'virtio-scsi-single'}
            />
            
            <EditDiskDialog
              open={editDiskDialogOpen}
              onClose={() => {
                setEditDiskDialogOpen(false)
                setSelectedDisk(null)
              }}
              onSave={handleEditDisk}
              onDelete={handleDeleteDisk}
              onResize={handleResizeDisk}
              onMoveStorage={handleMoveDisk}
              connId={connId}
              node={node}
              disk={selectedDisk}
            />
            
            <EditNetworkDialog
              open={editNetworkDialogOpen}
              onClose={() => {
                setEditNetworkDialogOpen(false)
                setSelectedNetwork(null)
              }}
              onSave={handleSaveNetwork}
              onDelete={handleDeleteNetwork}
              connId={connId}
              node={node}
              network={selectedNetwork}
            />
            
            {/* Dialog de migration */}
            <MigrateVmDialog
              open={migrateDialogOpen}
              onClose={() => setMigrateDialogOpen(false)}
              onMigrate={handleMigrateVm}
              onCrossClusterMigrate={handleCrossClusterMigrate}
              connId={connId}
              currentNode={node}
              vmName={data?.name || `VM ${vmid}`}
              vmid={vmid}
              vmStatus={data?.vmRealStatus || data?.status || 'unknown'}
              vmType={type as 'qemu' | 'lxc'}
            />
            
            {/* Dialog de clonage */}
            <CloneVmDialog
              open={cloneDialogOpen}
              onClose={() => setCloneDialogOpen(false)}
              onClone={handleCloneVm}
              connId={connId}
              currentNode={node}
              vmName={data?.name || `VM ${vmid}`}
              vmid={vmid}
              nextVmid={Math.max(100, ...allVms.map(v => Number(v.vmid) || 0)) + 1}
              existingVmids={allVms.map(v => Number(v.vmid) || 0).filter(id => id > 0)}
              pools={[]}
            />
          </>
        )
      })()}
      
      {/* Dialog de migration depuis la table (hors du contexte VM sélectionnée) */}
      {tableMigrateVm && (
        <MigrateVmDialog
          open={!!tableMigrateVm}
          onClose={() => setTableMigrateVm(null)}
          onMigrate={handleTableMigrateVm}
          onCrossClusterMigrate={handleTableCrossClusterMigrate}
          connId={tableMigrateVm.connId}
          currentNode={tableMigrateVm.node}
          vmName={tableMigrateVm.name}
          vmid={tableMigrateVm.vmid}
          vmStatus={tableMigrateVm.status}
          vmType={tableMigrateVm.type as 'qemu' | 'lxc'}
        />
      )}
      
      {/* Dialog de clonage depuis la table (hors du contexte VM sélectionnée) */}
      {tableCloneVm && (
        <CloneVmDialog
          open={!!tableCloneVm}
          onClose={() => setTableCloneVm(null)}
          onClone={handleTableCloneVm}
          connId={tableCloneVm.connId}
          currentNode={tableCloneVm.node}
          vmName={tableCloneVm.name}
          vmid={tableCloneVm.vmid}
          nextVmid={Math.max(100, ...allVms.map(v => Number(v.vmid) || 0)) + 1}
          existingVmids={allVms.map(v => Number(v.vmid) || 0).filter(id => id > 0)}
          pools={[]}
        />
      )}
      
      {/* Dialog d'édition d'option VM */}
      <Dialog open={!!editOptionDialog} onClose={() => setEditOptionDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-settings-3-line" style={{ fontSize: 20 }} />
          Éditer: {editOptionDialog?.label}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 1 }}>
            {editOptionDialog?.type === 'text' && (
              <TextField
                fullWidth
                size="small"
                label={editOptionDialog.label}
                value={editOptionValue}
                onChange={(e) => setEditOptionValue(e.target.value)}
                multiline={editOptionDialog.key === 'description'}
                rows={editOptionDialog.key === 'description' ? 3 : 1}
                autoFocus
              />
            )}
            {editOptionDialog?.type === 'boolean' && (
              <FormControlLabel
                control={
                  <Switch 
                    checked={editOptionValue === true || editOptionValue === '1' || editOptionValue === 1}
                    onChange={(e) => setEditOptionValue(e.target.checked ? 1 : 0)}
                  />
                }
                label={editOptionDialog.label}
              />
            )}
            {editOptionDialog?.type === 'select' && editOptionDialog.options && (
              <FormControl fullWidth size="small">
                <InputLabel>{editOptionDialog.label}</InputLabel>
                <Select
                  value={editOptionValue}
                  onChange={(e) => setEditOptionValue(e.target.value)}
                  label={editOptionDialog.label}
                >
                  {editOptionDialog.options.map((opt) => (
                    <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setEditOptionDialog(null)} disabled={editOptionSaving}>{t('common.cancel')}</Button>
          <Button 
            variant="contained" 
            onClick={handleSaveOption}
            disabled={editOptionSaving}
            startIcon={editOptionSaving ? <CircularProgress size={16} /> : <i className="ri-save-line" />}
          >
            {editOptionSaving ? t('common.saving') : t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog Créer/Modifier Groupe HA */}
      {selection?.type === 'cluster' && (
        <HaGroupDialog
          open={haGroupDialogOpen}
          onClose={() => {
            setHaGroupDialogOpen(false)
            setEditingHaGroup(null)
          }}
          group={editingHaGroup}
          connId={selection.id}
          availableNodes={data?.nodesData?.map((n: any) => n.node) || []}
          onSaved={() => {
            setHaGroupDialogOpen(false)
            setEditingHaGroup(null)
            loadClusterHa(selection.id)
          }}
        />
      )}

      {/* Dialog Supprimer Groupe HA */}
      <Dialog 
        open={!!deleteHaGroupDialog} 
        onClose={() => setDeleteHaGroupDialog(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'error.main' }}>
          <i className="ri-delete-bin-line" style={{ fontSize: 20 }} />
          {t('drs.deleteHaGroup')}
        </DialogTitle>
        <DialogContent>
          <Typography>
            {t('inventoryPage.deleteGroupConfirm')} <strong>{deleteHaGroupDialog?.group}</strong> ?
          </Typography>
          <Alert severity="warning" sx={{ mt: 2 }}>
            {t('inventoryPage.resourcesWillBeDisassociated')}
          </Alert>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteHaGroupDialog(null)}>{t('common.cancel')}</Button>
          <Button 
            variant="contained" 
            color="error"
            onClick={async () => {
              if (!selection || !deleteHaGroupDialog) return

              try {
                const res = await fetch(
                  `/api/v1/connections/${encodeURIComponent(selection.id)}/ha/groups/${encodeURIComponent(deleteHaGroupDialog.group)}`,
                  { method: 'DELETE' }
                )

                if (!res.ok) {
                  const err = await res.json()

                  alert(err.error || t('errors.deleteError'))
                  
return
                }

                setDeleteHaGroupDialog(null)
                loadClusterHa(selection.id)
              } catch (e: any) {
                alert(e.message || t('errors.deleteError'))
              }
            }}
          >
            {t('common.delete')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog Créer/Modifier Affinity Rule (PVE 9+) */}
      {selection?.type === 'cluster' && clusterPveMajorVersion >= 9 && (
        <HaRuleDialog
          open={haRuleDialogOpen}
          onClose={() => {
            setHaRuleDialogOpen(false)
            setEditingHaRule(null)
          }}
          rule={editingHaRule}
          ruleType={haRuleType}
          connId={selection.id}
          availableNodes={data?.nodesData?.map((n: any) => n.node) || []}
          availableResources={clusterHaResources}
          onSaved={() => {
            setHaRuleDialogOpen(false)
            setEditingHaRule(null)
            loadClusterHa(selection.id)
          }}
        />
      )}

      {/* Dialog Supprimer Affinity Rule */}
      <Dialog 
        open={!!deleteHaRuleDialog} 
        onClose={() => setDeleteHaRuleDialog(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'error.main' }}>
          <i className="ri-delete-bin-line" style={{ fontSize: 20 }} />
          {t('drs.deleteAffinityRule')}
        </DialogTitle>
        <DialogContent>
          <Typography>
            {t('common.deleteConfirmation')} <strong>{deleteHaRuleDialog?.rule}</strong>?
          </Typography>
          <Alert severity="warning" sx={{ mt: 2 }}>
            {t('common.warning')}
          </Alert>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteHaRuleDialog(null)}>{t('common.cancel')}</Button>
          <Button 
            variant="contained" 
            color="error"
            onClick={async () => {
              if (!selection || !deleteHaRuleDialog) return

              try {
                const res = await fetch(
                  `/api/v1/connections/${encodeURIComponent(selection.id)}/ha/affinity-rules/${encodeURIComponent(deleteHaRuleDialog.rule)}`,
                  { method: 'DELETE' }
                )

                if (!res.ok) {
                  const err = await res.json()

                  alert(err.error || t('errors.deleteError'))
                  
return
                }

                setDeleteHaRuleDialog(null)
                loadClusterHa(selection.id)
              } catch (e: any) {
                alert(e.message || t('errors.deleteError'))
              }
            }}
          >
            {t('common.delete')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog de confirmation d'action VM */}
      <Dialog 
        open={!!confirmAction} 
        onClose={() => !confirmActionLoading && setConfirmAction(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {confirmAction?.action === 'stop' && <i className="ri-stop-circle-line" style={{ fontSize: 24, color: '#f44336' }} />}
          {confirmAction?.action === 'shutdown' && <i className="ri-shut-down-line" style={{ fontSize: 24, color: '#ff9800' }} />}
          {confirmAction?.action === 'suspend' && <i className="ri-pause-circle-line" style={{ fontSize: 24, color: '#2196f3' }} />}
          {confirmAction?.action === 'reboot' && <i className="ri-restart-line" style={{ fontSize: 24, color: '#ff9800' }} />}
          {confirmAction?.action === 'info' && <i className="ri-information-line" style={{ fontSize: 24, color: '#ff9800' }} />}
          {confirmAction?.action === 'delete-snapshot' && <i className="ri-delete-bin-line" style={{ fontSize: 24, color: '#f44336' }} />}
          {confirmAction?.action === 'restore-snapshot' && <i className="ri-history-line" style={{ fontSize: 24, color: '#ff9800' }} />}
          {confirmAction?.action === 'disable-ha' && <i className="ri-shield-cross-line" style={{ fontSize: 24, color: '#ff9800' }} />}
          {confirmAction?.title}
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 1 }}>
            <strong>{confirmAction?.vmName}</strong>
          </Typography>
          <Typography variant="body2" sx={{ opacity: 0.8, whiteSpace: 'pre-line' }}>
            {confirmAction?.message}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          {confirmAction?.action !== 'info' && (
            <Button onClick={() => setConfirmAction(null)} disabled={confirmActionLoading}>
              {t('common.cancel')}
            </Button>
          )}
          <Button 
            variant="contained" 
            color={
              confirmAction?.action === 'stop' || confirmAction?.action === 'delete-snapshot' 
                ? 'error' 
                : confirmAction?.action === 'info' 
                  ? 'primary' 
                  : 'warning'
            }
            onClick={confirmAction?.onConfirm}
            disabled={confirmActionLoading}
            startIcon={confirmActionLoading ? <CircularProgress size={16} /> : null}
          >
            {confirmActionLoading ? t('common.loading') : confirmAction?.action === 'info' ? t('common.ok') : t('common.confirm')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog de création de sauvegarde */}
      <Dialog
        open={createBackupDialogOpen}
        onClose={() => !creatingBackup && setCreateBackupDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-hard-drive-2-line" style={{ fontSize: 24 }} />
          {t('audit.actions.backup')}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControl fullWidth size="small">
              <InputLabel>{t('backups.backupStorage')}</InputLabel>
              <Select
                value={backupStorage}
                onChange={(e) => setBackupStorage(e.target.value)}
                label={t('backups.backupStorage')}
              >
                {backupStorages.map((s) => (
                  <MenuItem key={s.storage} value={s.storage}>
                    {s.storage} ({s.type})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            
            <FormControl fullWidth size="small">
              <InputLabel>Mode</InputLabel>
              <Select
                value={backupMode}
                onChange={(e) => setBackupMode(e.target.value as any)}
                label="Mode"
              >
                <MenuItem value="snapshot">{t('audit.actions.snapshot')}</MenuItem>
                <MenuItem value="suspend">{t('audit.actions.suspend')}</MenuItem>
                <MenuItem value="stop">{t('audit.actions.stop')}</MenuItem>
              </Select>
            </FormControl>
            
            <FormControl fullWidth size="small">
              <InputLabel>Compression</InputLabel>
              <Select
                value={backupCompress}
                onChange={(e) => setBackupCompress(e.target.value as any)}
                label="Compression"
              >
                <MenuItem value="zstd">{t('inventoryPage.zstdRecommended')}</MenuItem>
                <MenuItem value="lzo">{t('inventoryPage.lzoFast')}</MenuItem>
                <MenuItem value="gzip">GZIP</MenuItem>
                <MenuItem value="none">{t('common.none')}</MenuItem>
              </Select>
            </FormControl>
            
            <TextField
              fullWidth
              size="small"
              label={t('inventoryPage.noteOptional')}
              value={backupNote}
              onChange={(e) => setBackupNote(e.target.value)}
              multiline
              rows={2}
            />
            
            {data?.vmRealStatus === 'running' && backupMode === 'stop' && (
              <Alert severity="warning">
                {t('common.warning')}
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setCreateBackupDialogOpen(false)} disabled={creatingBackup}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="contained"
            disabled={creatingBackup || !backupStorage}
            onClick={async () => {
              if (!selection || selection.type !== 'vm' || !backupStorage) return
              
              const { connId, node, type, vmid } = parseVmId(selection.id)
              
              setCreatingBackup(true)

              try {
                const params: Record<string, any> = {
                  storage: backupStorage,
                  mode: backupMode,
                  compress: backupCompress,
                  vmid: vmid,
                }

                if (backupNote) params.notes = backupNote
                
                const res = await fetch(
                  `/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/vzdump`,
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(params)
                  }
                )
                
                if (!res.ok) {
                  const err = await res.json().catch(() => ({}))

                  throw new Error(err?.error || `HTTP ${res.status}`)
                }
                
                setCreateBackupDialogOpen(false)
                alert(t('backups.backupStarted'))
                
                // Recharger les backups après un délai
                setTimeout(() => {
                  if (selection?.type === 'vm') {
                    const { type: vmType, vmid } = parseVmId(selection.id)

                    loadBackups(vmid, vmType)
                  }
                }, 5000)
              } catch (e: any) {
                alert(`${t('common.error')}: ${e?.message || e}`)
              } finally {
                setCreatingBackup(false)
              }
            }}
            startIcon={creatingBackup ? <CircularProgress size={16} /> : <i className="ri-save-line" />}
          >
            {creatingBackup ? t('common.loading') : t('common.create')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog de suppression de VM */}
      <Dialog
        open={deleteVmDialogOpen}
        onClose={() => !deletingVm && setDeleteVmDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'error.main' }}>
          <i className="ri-delete-bin-line" style={{ fontSize: 24 }} />
          {t('inventory.deleteVm')}
        </DialogTitle>
        <DialogContent>
          <Alert severity="error" sx={{ mb: 3 }}>
            <Typography variant="body2" fontWeight={600}>
              {t('common.warning')}
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              {t('common.deleteConfirmation')}
            </Typography>
          </Alert>

          <Box sx={{ mb: 3, p: 2, bgcolor: 'action.hover', borderRadius: 2 }}>
            <Typography variant="body2" sx={{ opacity: 0.7 }}>{t('common.delete')}:</Typography>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {data?.title || 'VM'} <Typography component="span" variant="body2" sx={{ opacity: 0.6 }}>(ID: {selection?.type === 'vm' ? parseVmId(selection.id).vmid : ''})</Typography>
            </Typography>
          </Box>
          
          <FormControlLabel
            control={
              <Switch
                checked={deleteVmPurge}
                onChange={(e) => setDeleteVmPurge(e.target.checked)}
              />
            }
            label={t('inventory.deleteVmDisks')}
            sx={{ mb: 3 }}
          />
          
          <Typography variant="body2" sx={{ mb: 1 }}>
            {t('common.confirm')}: <strong>{selection?.type === 'vm' ? parseVmId(selection.id).vmid : ''}</strong> / <strong>{data?.title}</strong>
          </Typography>
          <TextField
            fullWidth
            size="small"
            placeholder={`${selection?.type === 'vm' ? parseVmId(selection.id).vmid : ''} / ${data?.title}`}
            value={deleteVmConfirmText}
            onChange={(e) => setDeleteVmConfirmText(e.target.value)}
            error={deleteVmConfirmText !== '' && deleteVmConfirmText !== (selection?.type === 'vm' ? parseVmId(selection.id).vmid : '') && deleteVmConfirmText !== data?.title}
            autoFocus
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteVmDialogOpen(false)} disabled={deletingVm}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="contained"
            color="error"
            disabled={
              deletingVm || 
              (deleteVmConfirmText !== (selection?.type === 'vm' ? parseVmId(selection.id).vmid : '') && 
               deleteVmConfirmText !== data?.title)
            }
            onClick={handleDeleteVm}
            startIcon={deletingVm ? <CircularProgress size={16} /> : <i className="ri-delete-bin-line" />}
          >
            {deletingVm ? t('common.deleting') : t('common.delete')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog d'erreur Unlock */}
      {unlockErrorDialog.open && (
        <Dialog
          open={true}
          onClose={() => setUnlockErrorDialog({ open: false, error: '' })}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className="ri-error-warning-line" style={{ fontSize: 24, color: '#f59e0b' }} />
            {t('inventory.unlockError')}
          </DialogTitle>
          <DialogContent>
            <Alert severity="warning" sx={{ mb: 2 }}>
              {unlockErrorDialog.error}
            </Alert>
            {unlockErrorDialog.hint && (
              <Box sx={{
                bgcolor: 'action.hover',
                borderRadius: 1,
                p: 2,
                fontFamily: 'monospace',
                fontSize: 14
              }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                  {t('inventory.unlockHint')}
                </Typography>
                <code style={{
                  backgroundColor: 'rgba(0,0,0,0.3)',
                  padding: '4px 8px',
                  borderRadius: 4,
                  userSelect: 'all'
                }}>
                  {unlockErrorDialog.hint}
                </code>
              </Box>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setUnlockErrorDialog({ open: false, error: '' })}>
              {t('common.close')}
            </Button>
          </DialogActions>
        </Dialog>
      )}

      {/* Dialog de confirmation pour les bulk actions */}
      <Dialog
        open={bulkActionDialog.open}
        onClose={() => setBulkActionDialog({ open: false, action: null, node: null, targetNode: '' })}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {bulkActionDialog.action === 'start-all' && (
            <><PlayArrowIcon sx={{ color: 'success.main' }} />{t('bulkActions.startAllVms')}</>
          )}
          {bulkActionDialog.action === 'shutdown-all' && (
            <><PowerSettingsNewIcon sx={{ color: 'warning.main' }} />{t('bulkActions.shutdownAllVms')}</>
          )}
          {bulkActionDialog.action === 'stop-all' && (
            <><StopIcon sx={{ color: 'error.main' }} />{t('bulkActions.stopAllVms')}</>
          )}
          {bulkActionDialog.action === 'migrate-all' && (
            <><MoveUpIcon sx={{ color: 'primary.main' }} />{t('bulkActions.migrateAllVms')}</>
          )}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {t('common.node')}: <strong>{bulkActionDialog.node?.name}</strong>
            </Typography>
            <Typography variant="body2" color="text.secondary">
              VMs: <strong>{bulkActionDialog.node?.vms ?? 0}</strong>
            </Typography>
          </Box>

          {bulkActionDialog.action === 'start-all' && (
            <Alert severity="info" sx={{ mb: 2 }}>
              {t('bulkActions.confirmStartAll')}
            </Alert>
          )}
          {bulkActionDialog.action === 'shutdown-all' && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {t('bulkActions.confirmShutdownAll')}
            </Alert>
          )}
          {bulkActionDialog.action === 'stop-all' && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {t('bulkActions.confirmStopAll')}
            </Alert>
          )}
          {bulkActionDialog.action === 'migrate-all' && (
            <>
              <Alert severity="info" sx={{ mb: 2 }}>
                {t('bulkActions.confirmMigrateAll')}
              </Alert>
              <FormControl fullWidth size="small" sx={{ mt: 2 }}>
                <InputLabel>{t('bulkActions.targetNode')}</InputLabel>
                <Select
                  value={bulkActionDialog.targetNode}
                  label={t('bulkActions.targetNode')}
                  onChange={(e) => setBulkActionDialog(prev => ({ ...prev, targetNode: e.target.value }))}
                >
                  {(data?.nodesData || [])
                    .filter((n: any) => n.node !== bulkActionDialog.node?.name && n.status === 'online')
                    .map((n: any) => (
                      <MenuItem key={n.node} value={n.node}>
                        {n.node}
                      </MenuItem>
                    ))
                  }
                </Select>
              </FormControl>
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setBulkActionDialog({ open: false, action: null, node: null, targetNode: '' })}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="contained"
            color={
              bulkActionDialog.action === 'start-all' ? 'success' :
              bulkActionDialog.action === 'stop-all' ? 'error' :
              bulkActionDialog.action === 'shutdown-all' ? 'warning' : 'primary'
            }
            onClick={executeBulkAction}
            disabled={bulkActionDialog.action === 'migrate-all' && !bulkActionDialog.targetNode}
          >
            {t('common.confirm')}
          </Button>
        </DialogActions>
      </Dialog>

    </Box>
  )
}