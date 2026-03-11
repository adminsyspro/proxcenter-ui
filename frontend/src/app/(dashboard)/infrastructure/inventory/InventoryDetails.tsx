'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useLocale, useTranslations } from 'next-intl'

import { formatBytes } from '@/utils/format'
import { getDateLocale } from '@/lib/i18n/date'

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
  DialogContentText,
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
  Menu,
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
import { lighten, alpha } from '@mui/material/styles'
// RemixIcon replacements for @mui/icons-material
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts'

import NodesTable, { NodeRow, BulkAction } from '@/components/NodesTable'
import VmsTable, { VmRow, TrendPoint } from '@/components/VmsTable'
// Dynamic imports for HardwareModals (code-split, loaded on demand)
const AddDiskDialog = dynamic(() => import('@/components/HardwareModals').then(mod => ({ default: mod.AddDiskDialog })), { ssr: false })
const AddNetworkDialog = dynamic(() => import('@/components/HardwareModals').then(mod => ({ default: mod.AddNetworkDialog })), { ssr: false })
const EditDiskDialog = dynamic(() => import('@/components/HardwareModals').then(mod => ({ default: mod.EditDiskDialog })), { ssr: false })
const EditNetworkDialog = dynamic(() => import('@/components/HardwareModals').then(mod => ({ default: mod.EditNetworkDialog })), { ssr: false })
const EditScsiControllerDialog = dynamic(() => import('@/components/HardwareModals').then(mod => ({ default: mod.EditScsiControllerDialog })), { ssr: false })
const CloneVmDialog = dynamic(() => import('@/components/HardwareModals').then(mod => ({ default: mod.CloneVmDialog })), { ssr: false })
import { MigrateVmDialog, CrossClusterMigrateParams } from '@/components/MigrateVmDialog'
import VmFirewallTab from '@/components/VmFirewallTab'
import ClusterFirewallTab from '@/components/ClusterFirewallTab'
import BackupJobsPanel from './BackupJobsPanel'
import RollingUpdateWizard from '@/components/RollingUpdateWizard'
import { useLicense, Features } from '@/contexts/LicenseContext'
import { useToast } from '@/contexts/ToastContext'
import { useTaskTracker } from '@/hooks/useTaskTracker'
import type { Status, InventorySelection, Kpi, KV, UtilMetric, DetailsPayload, RrdTimeframe, SeriesPoint, ActiveDialog } from './types'
import { TAG_PALETTE, hashStringToInt, tagColor, safeJson, asArray, parseTags, pct, cpuPct, formatBps, formatTime, formatUptime, parseMarkdown, parseNodeId, parseVmId, getMetricIcon, pickNumber, buildSeriesFromRrd, fetchRrd, fetchDetails } from './helpers'
import CreateVmDialog from './CreateVmDialog'
import CreateLxcDialog from './CreateLxcDialog'
import HaGroupDialog from './HaGroupDialog'
import HaRuleDialog from './HaRuleDialog'
import RootInventoryView from './RootInventoryView'
import StorageDashboard from './StorageDashboard'
import NetworkDashboard from './NetworkDashboard'
import BackupDashboard from './BackupDashboard'
import MigrationDashboard from './MigrationDashboard'
import { ViewMode, AllVmItem, HostItem, PoolItem, TagItem } from './InventoryTree'
import TagManager from './components/TagManager'
import VmActions from './components/VmActions'
import UsageBar from './components/UsageBar'
import ConsolePreview from './components/ConsolePreview'
import StatusChip from './components/StatusChip'
import { AreaPctChart, AreaBpsChart2 } from './components/RrdCharts'
import GroupedVmsView from './components/GroupedVmsView'
import InventorySummary from './components/InventorySummary'
import { PlayArrowIcon, StopIcon, PowerSettingsNewIcon, MoveUpIcon, AddIcon, CloseIcon, SaveIcon } from './components/IconWrappers'
import { useCephPerf } from './hooks/useCephPerf'
import { useSyslogLive, useCephLogLive } from './hooks/useSyslogLive'
import { useNodeData } from './hooks/useNodeData'
import VmDetailTabs from './tabs/VmDetailTabs'
import ClusterTabs from './tabs/ClusterTabs'
import NodeTabs from './tabs/NodeTabs'
import { UploadDialog } from '@/components/storage/StorageContentBrowser'




/* ------------------------------------------------------------------ */
/* Storage content group with search + sort                           */
/* ------------------------------------------------------------------ */

function StorageContentGroup({ group, formatBytes: fmt, onUpload, onDelete, onDownloadTemplate }: {
  group: { label: string; icon: string; items: any[]; contentType?: string }
  formatBytes: (n: number) => string
  onUpload?: () => void
  onDelete?: (volid: string) => Promise<void>
  onDownloadTemplate?: () => void
}) {
  const [search, setSearch] = React.useState('')
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc' | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<any>(null)
  const [deleting, setDeleting] = React.useState(false)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)

  const canDelete = !!onDelete
  const isAttachedType = group.contentType === 'images' || group.contentType === 'rootdir'

  const handleDelete = async () => {
    if (!deleteTarget || !onDelete) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await onDelete(deleteTarget.volid)
      setDeleteTarget(null)
    } catch (e: any) {
      setDeleteError(e?.message || String(e))
    } finally {
      setDeleting(false)
    }
  }

  const filtered = React.useMemo(() => {
    let items = group.items
    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter((item: any) => {
        const volid = String(item.volid || '').toLowerCase()
        const vmid = item.vmid ? String(item.vmid) : ''
        return volid.includes(q) || vmid.includes(q)
      })
    }
    if (sortDir) {
      items = [...items].sort((a: any, b: any) =>
        sortDir === 'asc' ? (a.size || 0) - (b.size || 0) : (b.size || 0) - (a.size || 0)
      )
    }
    return items
  }, [group.items, search, sortDir])

  const getFileName = (volid: string) => {
    const parts = String(volid || '').split(':')
    const volPath = parts.length > 1 ? parts.slice(1).join(':') : volid
    return volPath?.split('/')?.pop() || volPath
  }

  return (
    <>
    <Card variant="outlined" sx={{ borderRadius: 2 }}>
      <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
        <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography fontWeight={900} sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
            <i className={group.icon} style={{ fontSize: 18, opacity: 0.7 }} />
            {group.label} ({group.items.length})
          </Typography>
          {onDownloadTemplate && (
            <IconButton
              size="small"
              onClick={onDownloadTemplate}
              sx={{ p: 0.5, opacity: 0.6, '&:hover': { opacity: 1 } }}
              title="Download template from repository"
            >
              <i className="ri-download-cloud-2-line" style={{ fontSize: 16 }} />
            </IconButton>
          )}
          <Box sx={{ flex: 1 }} />
          <IconButton
            size="small"
            onClick={() => setSortDir(prev => prev === 'asc' ? 'desc' : prev === 'desc' ? null : 'asc')}
            sx={{ opacity: sortDir ? 1 : 0.4, p: 0.5 }}
            title="Sort by size"
          >
            <i className={sortDir === 'asc' ? 'ri-sort-asc' : sortDir === 'desc' ? 'ri-sort-desc' : 'ri-arrow-up-down-line'} style={{ fontSize: 16 }} />
          </IconButton>
          <Box sx={{
            display: 'flex', alignItems: 'center', gap: 0.5,
            border: '1px solid', borderColor: 'divider', borderRadius: 1,
            px: 1, py: 0.25, maxWidth: 180,
          }}>
            <i className="ri-search-line" style={{ fontSize: 13, opacity: 0.4 }} />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search..."
              style={{
                border: 'none', outline: 'none', background: 'transparent',
                fontSize: 12, width: '100%', color: 'inherit',
                fontFamily: 'Inter, sans-serif',
              }}
            />
            {search && (
              <i className="ri-close-line" style={{ fontSize: 13, opacity: 0.4, cursor: 'pointer' }} onClick={() => setSearch('')} />
            )}
          </Box>
          {onUpload && (
            <IconButton
              size="small"
              onClick={onUpload}
              sx={{ p: 0.5, opacity: 0.6, '&:hover': { opacity: 1 } }}
              title="Upload"
            >
              <i className="ri-upload-2-line" style={{ fontSize: 16 }} />
            </IconButton>
          )}
        </Box>
        <Box sx={{ maxHeight: 600, overflow: 'auto' }}>
          {filtered.length === 0 ? (
            <Box sx={{ px: 2, py: 2, textAlign: 'center' }}>
              <Typography variant="caption" sx={{ opacity: 0.4 }}>No results</Typography>
            </Box>
          ) : filtered.map((item: any, idx: number) => {
            const fileName = getFileName(item.volid)

            return (
              <Box
                key={item.volid || idx}
                sx={{
                  px: 2, py: 0.5,
                  borderBottom: '1px solid', borderColor: 'divider',
                  '&:last-child': { borderBottom: 'none' },
                  '&:hover': { bgcolor: 'action.hover' },
                  display: 'flex', alignItems: 'center', gap: 1,
                }}
              >
                <i className={group.icon} style={{ fontSize: 12, opacity: 0.4, flexShrink: 0 }} />
                <Typography variant="body2" sx={{ flex: 1, minWidth: 0, fontSize: 12, fontFamily: 'JetBrains Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {fileName}
                </Typography>
                {item.vmid && (
                  <Typography variant="caption" sx={{ opacity: 0.4, flexShrink: 0, fontSize: 10 }}>
                    VM {item.vmid}
                  </Typography>
                )}
                <Typography variant="caption" sx={{ opacity: 0.4, flexShrink: 0, fontFamily: 'JetBrains Mono, monospace', fontSize: 10 }}>
                  {item.format || ''}
                </Typography>
                <Typography variant="body2" sx={{ opacity: 0.6, flexShrink: 0, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                  {item.size ? fmt(item.size) : ''}
                </Typography>
                {canDelete && (
                  <IconButton
                    size="small"
                    onClick={() => { setDeleteTarget(item); setDeleteError(null) }}
                    sx={{ opacity: 0.3, '&:hover': { opacity: 1, color: 'error.main' }, p: 0.25 }}
                    title="Delete"
                  >
                    <i className="ri-delete-bin-line" style={{ fontSize: 14 }} />
                  </IconButton>
                )}
              </Box>
            )
          })}
        </Box>
      </CardContent>
    </Card>

    {/* Delete confirmation dialog */}
    <Dialog open={!!deleteTarget} onClose={() => !deleting && setDeleteTarget(null)} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>Delete file</DialogTitle>
      <DialogContent>
        <DialogContentText>
          Are you sure you want to delete{' '}
          <strong style={{ fontFamily: 'JetBrains Mono, monospace' }}>
            {deleteTarget ? getFileName(deleteTarget.volid) : ''}
          </strong>?
        </DialogContentText>
        {deleteTarget?.size && (
          <Typography variant="caption" sx={{ opacity: 0.6, mt: 1, display: 'block' }}>
            Size: {fmt(deleteTarget.size)}
          </Typography>
        )}
        {isAttachedType && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            This volume may be attached to a VM/CT{deleteTarget?.vmid ? ` (${deleteTarget.vmid})` : ''}. Deleting it could cause data loss.
          </Alert>
        )}
        {deleteError && (
          <Alert severity="error" sx={{ mt: 2 }}>{deleteError}</Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
        <Button onClick={handleDelete} color="error" variant="contained" disabled={deleting}
          startIcon={deleting ? <CircularProgress size={16} /> : <i className="ri-delete-bin-line" />}
        >
          {deleting ? 'Deleting...' : 'Delete'}
        </Button>
      </DialogActions>
    </Dialog>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Template Download Dialog                                            */
/* ------------------------------------------------------------------ */

type AplTemplate = {
  template: string
  type: string
  package: string
  headline: string
  os: string
  section: string
  version: string
  description?: string
  infopage?: string
  sha512sum?: string
  architecture?: string
  source?: string
}

function TemplateDownloadDialog({ open, onClose, connId, node, storage, onDownloaded }: {
  open: boolean
  onClose: () => void
  connId: string
  node: string
  storage: string
  onDownloaded: () => void
}) {
  const [templates, setTemplates] = React.useState<AplTemplate[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState('')
  const [sectionFilter, setSectionFilter] = React.useState<string>('all')
  const [downloading, setDownloading] = React.useState<string | null>(null)
  const [downloadError, setDownloadError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(null)
    fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/aplinfo`)
      .then(r => r.json())
      .then(json => {
        if (json.error) throw new Error(json.error)
        setTemplates((json.data || []).sort((a: AplTemplate, b: AplTemplate) => a.package.localeCompare(b.package)))
      })
      .catch(e => setError(e?.message || String(e)))
      .finally(() => setLoading(false))
  }, [open, connId, node])

  const sections = React.useMemo(() => {
    const s = new Set(templates.map(t => t.section).filter(Boolean))
    return Array.from(s).sort()
  }, [templates])

  const filtered = React.useMemo(() => {
    let items = templates
    if (sectionFilter !== 'all') {
      items = items.filter(t => t.section === sectionFilter)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter(t =>
        t.package.toLowerCase().includes(q) ||
        t.headline?.toLowerCase().includes(q) ||
        t.os?.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q)
      )
    }
    return items
  }, [templates, search, sectionFilter])

  const handleDownload = async (tpl: AplTemplate) => {
    setDownloading(tpl.template)
    setDownloadError(null)
    try {
      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/aplinfo`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storage, template: tpl.template }),
        }
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      onDownloaded()
      onClose()
    } catch (e: any) {
      setDownloadError(e?.message || String(e))
    } finally {
      setDownloading(null)
    }
  }

  const osIcon = (os: string) => {
    const l = (os || '').toLowerCase()
    if (l.includes('debian') || l.includes('devuan')) return '/images/os/debian.svg'
    if (l.includes('ubuntu')) return '/images/os/ubuntu.svg'
    if (l.includes('alpine')) return '/images/os/alpine.svg'
    if (l.includes('centos') || l.includes('rocky') || l.includes('alma')) return '/images/os/centos.svg'
    if (l.includes('fedora')) return '/images/os/fedora.svg'
    if (l.includes('arch')) return '/images/os/arch.svg'
    if (l.includes('gentoo')) return '/images/os/linux.svg'
    if (l.includes('opensuse') || l.includes('suse')) return '/images/os/suse.svg'
    if (l.includes('redhat') || l.includes('rhel')) return '/images/os/redhat.svg'
    if (l.includes('freebsd')) return '/images/os/freebsd.svg'
    return null
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}>
        <i className="ri-download-cloud-2-line" style={{ fontSize: 22, opacity: 0.7 }} />
        CT Templates Repository
      </DialogTitle>
      <DialogContent sx={{ p: 0 }}>
        {/* Filters bar */}
        <Box sx={{ px: 2, py: 1.5, display: 'flex', gap: 1.5, alignItems: 'center', borderBottom: '1px solid', borderColor: 'divider' }}>
          <Box sx={{
            display: 'flex', alignItems: 'center', gap: 0.5, flex: 1,
            border: '1px solid', borderColor: 'divider', borderRadius: 1, px: 1.5, py: 0.5,
          }}>
            <i className="ri-search-line" style={{ fontSize: 14, opacity: 0.4 }} />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search templates..."
              style={{
                border: 'none', outline: 'none', background: 'transparent',
                fontSize: 13, width: '100%', color: 'inherit',
                fontFamily: 'Inter, sans-serif',
              }}
            />
            {search && (
              <i className="ri-close-line" style={{ fontSize: 14, opacity: 0.4, cursor: 'pointer' }} onClick={() => setSearch('')} />
            )}
          </Box>
          <Select
            size="small"
            value={sectionFilter}
            onChange={e => setSectionFilter(e.target.value)}
            sx={{ minWidth: 140, fontSize: 13 }}
          >
            <MenuItem value="all">All sections</MenuItem>
            {sections.map(s => (
              <MenuItem key={s} value={s}>{s}</MenuItem>
            ))}
          </Select>
          <Typography variant="caption" sx={{ opacity: 0.5, flexShrink: 0 }}>
            {filtered.length} / {templates.length}
          </Typography>
        </Box>

        {/* Content */}
        {loading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 6 }}>
            <CircularProgress size={24} />
            <Typography variant="body2" sx={{ ml: 2, opacity: 0.6 }}>Loading templates...</Typography>
          </Box>
        ) : error ? (
          <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>
        ) : (
          <TableContainer sx={{ maxHeight: 480 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700, width: 40 }}></TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Package</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Description</TableCell>
                  <TableCell sx={{ fontWeight: 700, width: 90 }}>Version</TableCell>
                  <TableCell sx={{ fontWeight: 700, width: 80 }} align="right"></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filtered.map(tpl => {
                  const icon = osIcon(tpl.os)
                  const isDownloading = downloading === tpl.template
                  return (
                    <TableRow key={tpl.template} hover sx={{ '&:last-child td': { border: 0 } }}>
                      <TableCell sx={{ pr: 0 }}>
                        {icon
                          ? <img src={icon} alt="" width={20} height={20} style={{ display: 'block' }} />
                          : <i className="ri-terminal-box-line" style={{ fontSize: 18, opacity: 0.4 }} />
                        }
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" fontWeight={600} sx={{ fontSize: 13 }}>{tpl.package}</Typography>
                        <Typography variant="caption" sx={{ opacity: 0.5, fontSize: 10 }}>{tpl.os}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontSize: 12, opacity: 0.7 }}>
                          {tpl.headline || tpl.description?.slice(0, 100) || '—'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption" sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                          {tpl.version}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          variant={isDownloading ? 'outlined' : 'contained'}
                          disabled={!!downloading}
                          onClick={() => handleDownload(tpl)}
                          sx={{ minWidth: 0, px: 1.5, py: 0.25, fontSize: 11, textTransform: 'none' }}
                          startIcon={isDownloading ? <CircularProgress size={12} /> : <i className="ri-download-line" style={{ fontSize: 14 }} />}
                        >
                          {isDownloading ? '' : 'Download'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        {downloadError && (
          <Alert severity="error" sx={{ mx: 2, mb: 1 }}>{downloadError}</Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
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
  migratingVmIds,
  pendingActionVmIds,
  onVmActionStart,
  onVmActionEnd,
  onOptimisticVmStatus,
  clusterStorages = [],
  externalHypervisors = [],
  externalDialogRequest,
  onExternalDialogHandled,
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
  pbsServers?: import('./InventoryTree').TreePbsServer[]
  showIpSnap?: boolean
  ipSnapLoading?: boolean
  onLoadIpSnap?: () => void
  onRefresh?: () => Promise<void>  // Callback pour rafraîchir les données
  favorites?: Set<string>  // Favoris partagés depuis le parent
  onToggleFavorite?: (vm: { connId: string; node: string; type: string; vmid: string | number; name?: string }) => void
  migratingVmIds?: Set<string>  // IDs des VMs en cours de migration
  pendingActionVmIds?: Set<string>  // IDs des VMs avec action en cours
  onVmActionStart?: (connId: string, vmid: string) => void
  onVmActionEnd?: (connId: string, vmid: string) => void
  onOptimisticVmStatus?: (connId: string, vmid: string, status: string) => void
  clusterStorages?: import('./InventoryTree').TreeClusterStorage[]
  externalHypervisors?: { id: string; name: string; type: string; vms?: { vmid: string; name: string; status: string }[] }[]
  externalDialogRequest?: { type: 'createVm' | 'createLxc'; connId: string; node: string; ts: number } | null
  onExternalDialogHandled?: () => void
}) {
  const t = useTranslations()
  const dateLocale = getDateLocale(useLocale())
  const theme = useTheme()
  const { hasFeature, loading: licenseLoading } = useLicense()
  const toast = useToast()
  const { trackTask } = useTaskTracker()
  const primaryColor = theme.palette.primary.main
  const primaryColorLight = lighten(primaryColor, 0.3)

  // Check license features
  const rollingUpdateAvailable = !licenseLoading && hasFeature(Features.ROLLING_UPDATES)
  const crossClusterMigrationAvailable = !licenseLoading && hasFeature(Features.CROSS_CLUSTER_MIGRATION)
  const cveAvailable = !licenseLoading && hasFeature(Features.CVE_SCANNER)
  const vmwareMigrationAvailable = !licenseLoading && hasFeature(Features.VMWARE_MIGRATION)
  const [upgradeDialogOpen, setUpgradeDialogOpen] = useState(false)

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
  const [cpuFlags, setCpuFlags] = useState<Record<string, '+' | '-'>>({})
  const [cpuLimit, setCpuLimit] = useState(0)
  const [cpuLimitEnabled, setCpuLimitEnabled] = useState(false)
  const [memory, setMemory] = useState(2048) // en MB
  const [balloon, setBalloon] = useState(0) // en MB
  const [balloonEnabled, setBalloonEnabled] = useState(false)
  const [savingCpu, setSavingCpu] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [savingMemory, setSavingMemory] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const [exitMaintenanceDialogOpen, setExitMaintenanceDialogOpen] = useState(false)
  const [esxiMigrateVm, setEsxiMigrateVm] = useState<{ vmid: string; name: string; connId: string; connName: string; cpu?: number; memoryMB?: number; committed?: number; guestOS?: string; licenseFull?: boolean; hostType?: string } | null>(null)
  const [migTargetConn, setMigTargetConn] = useState('')
  const [migTargetNode, setMigTargetNode] = useState('')
  const [migTargetStorage, setMigTargetStorage] = useState('')
  const [migNetworkBridge, setMigNetworkBridge] = useState('')
  const [migBridges, setMigBridges] = useState<any[]>([])
  const [migStartAfter, setMigStartAfter] = useState(false)
  const [migType, setMigType] = useState<'cold' | 'near-live' | 'live'>('cold')
  const [migPveConnections, setMigPveConnections] = useState<any[]>([])
  const [migNodes, setMigNodes] = useState<any[]>([])
  const [migStorages, setMigStorages] = useState<any[]>([])
  const [migStarting, setMigStarting] = useState(false)
  const [migJobId, setMigJobId] = useState<string | null>(null)
  const [migJob, setMigJob] = useState<any>(null)
  const [vmMigJob, setVmMigJob] = useState<any>(null) // active migration job for current VM panel
  const [exitMaintenanceBusy, setExitMaintenanceBusy] = useState(false)
  const [exitMaintenanceError, setExitMaintenanceError] = useState<string | null>(null)

  // État pour le lock de la VM
  const [vmLock, setVmLock] = useState<{ locked: boolean; lockType?: string }>({ locked: false })
  const [unlocking, setUnlocking] = useState(false)
  const [unlockErrorDialog, setUnlockErrorDialog] = useState<{
    open: boolean
    error: string
    hint?: string
    lockType?: string
  }>({ open: false, error: '' })

  // Consolidated dialog state — only one dialog open at a time
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>('none')
  const createVmDialogOpen = activeDialog === 'createVm'
  const createLxcDialogOpen = activeDialog === 'createLxc'
  const addDiskDialogOpen = activeDialog === 'addDisk'
  const addNetworkDialogOpen = activeDialog === 'addNetwork'
  const editScsiControllerDialogOpen = activeDialog === 'editScsiController'
  const editDiskDialogOpen = activeDialog === 'editDisk'
  const editNetworkDialogOpen = activeDialog === 'editNetwork'
  const migrateDialogOpen = activeDialog === 'migrate'
  const cloneDialogOpen = activeDialog === 'clone'
  const setCreateVmDialogOpen = useCallback((v: boolean) => setActiveDialog(v ? 'createVm' : 'none'), [])
  const setCreateLxcDialogOpen = useCallback((v: boolean) => setActiveDialog(v ? 'createLxc' : 'none'), [])
  const setAddDiskDialogOpen = useCallback((v: boolean) => setActiveDialog(v ? 'addDisk' : 'none'), [])
  const setAddNetworkDialogOpen = useCallback((v: boolean) => setActiveDialog(v ? 'addNetwork' : 'none'), [])
  const setEditScsiControllerDialogOpen = useCallback((v: boolean) => setActiveDialog(v ? 'editScsiController' : 'none'), [])
  const setEditDiskDialogOpen = useCallback((v: boolean) => setActiveDialog(v ? 'editDisk' : 'none'), [])
  const setEditNetworkDialogOpen = useCallback((v: boolean) => setActiveDialog(v ? 'editNetwork' : 'none'), [])
  const setMigrateDialogOpen = useCallback((v: boolean) => setActiveDialog(v ? 'migrate' : 'none'), [])
  const setCloneDialogOpen = useCallback((v: boolean) => setActiveDialog(v ? 'clone' : 'none'), [])

  // Compute default connId/node from current selection for Create dialogs
  const createDefaults = useMemo(() => {
    if (!selection) return {}
    if (selection.type === 'node') {
      const { connId, node } = parseNodeId(selection.id)
      return { connId, node }
    }
    if (selection.type === 'cluster') {
      return { connId: selection.id }
    }
    if (selection.type === 'vm') {
      const { connId, node } = parseVmId(selection.id)
      return { connId, node }
    }
    return {}
  }, [selection])

  // External dialog request (e.g. from tree context menu)
  const [externalCreateDefaults, setExternalCreateDefaults] = useState<{ connId?: string; node?: string }>({})
  const lastHandledTs = useRef(0)

  useEffect(() => {
    if (externalDialogRequest && externalDialogRequest.ts !== lastHandledTs.current) {
      lastHandledTs.current = externalDialogRequest.ts
      setExternalCreateDefaults({ connId: externalDialogRequest.connId, node: externalDialogRequest.node })
      if (externalDialogRequest.type === 'createVm') {
        setActiveDialog('createVm')
      } else {
        setActiveDialog('createLxc')
      }
      onExternalDialogHandled?.()
    }
  }, [externalDialogRequest, onExternalDialogHandled])

  // Merge createDefaults with external overrides
  const effectiveCreateDefaults = useMemo(() => {
    if (externalCreateDefaults.connId) return externalCreateDefaults
    return createDefaults
  }, [createDefaults, externalCreateDefaults])

  // Clear external defaults when dialog closes
  useEffect(() => {
    if (activeDialog === 'none') setExternalCreateDefaults({})
  }, [activeDialog])

  const [highlightedVmId, setHighlightedVmId] = useState<string | null>(null)
  const [creationPending, setCreationPending] = useState<{ vmid: string; connId: string; node: string; type: 'qemu' | 'lxc' } | null>(null)
  const [selectedDisk, setSelectedDisk] = useState<any>(null)
  const [selectedNetwork, setSelectedNetwork] = useState<any>(null)
  
  // État pour le dialog de confirmation d'action VM
  const [confirmAction, setConfirmAction] = useState<{
    action: string
    title: string
    message: string
    vmName?: string
    onConfirm: () => Promise<void>
  } | null>(null)

  const [confirmActionLoading, setConfirmActionLoading] = useState(false)
  
  const createBackupDialogOpen = activeDialog === 'createBackup'
  const setCreateBackupDialogOpen = useCallback((v: boolean) => setActiveDialog(v ? 'createBackup' : 'none'), [])
  const [backupStorage, setBackupStorage] = useState('')
  const [backupMode, setBackupMode] = useState<'snapshot' | 'suspend' | 'stop'>('snapshot')
  const [backupCompress, setBackupCompress] = useState<'zstd' | 'lzo' | 'gzip' | 'none'>('zstd')
  const [backupNote, setBackupNote] = useState('')
  const [creatingBackup, setCreatingBackup] = useState(false)
  const [backupStorages, setBackupStorages] = useState<any[]>([])
  
  const deleteVmDialogOpen = activeDialog === 'deleteVm'
  const setDeleteVmDialogOpen = useCallback((v: boolean) => setActiveDialog(v ? 'deleteVm' : 'none'), [])
  const [deleteVmConfirmText, setDeleteVmConfirmText] = useState('')
  const [deletingVm, setDeletingVm] = useState(false)
  const [deleteVmPurge, setDeleteVmPurge] = useState(true) // Supprimer aussi les disques

  // Convert to template
  const convertTemplateDialogOpen = activeDialog === 'convertTemplate'
  const setConvertTemplateDialogOpen = useCallback((v: boolean) => setActiveDialog(v ? 'convertTemplate' : 'none'), [])
  const [convertingTemplate, setConvertingTemplate] = useState(false)

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
  const [tableMigrateVm, setTableMigrateVm] = useState<{ connId: string; node: string; type: string; vmid: string; name: string; status: string; isCluster: boolean } | null>(null)

  // État pour le clonage depuis la table (VM/Template sélectionné pour cloner)
  const [tableCloneVm, setTableCloneVm] = useState<{ connId: string; node: string; type: string; vmid: string; name: string } | null>(null)

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
  const [pbsStorageSearch, setPbsStorageSearch] = useState('')
  const [pbsStoragePage, setPbsStoragePage] = useState(0)
  const [pbsStorageSort, setPbsStorageSort] = useState<{ col: string; dir: 'asc' | 'desc' }>({ col: 'ctime', dir: 'desc' })
  const [expandedStorageBackupGroups, setExpandedStorageBackupGroups] = useState<Set<string>>(new Set())
  const [storageUploadOpen, setStorageUploadOpen] = useState(false)
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)

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

  // Fetch PVE connections when migration dialog opens
  useEffect(() => {
    if (!esxiMigrateVm) return
    setMigTargetConn(''); setMigTargetNode(''); setMigTargetStorage('')
    setMigNodes([]); setMigStorages([]); setMigJobId(null); setMigJob(null)
    fetch('/api/v1/connections').then(r => r.json()).then(d => {
      const pveConns = (d.data || d || []).filter((c: any) => c.type === 'pve')
      setMigPveConnections(pveConns)
      if (pveConns.length === 1) setMigTargetConn(pveConns[0].id)
    }).catch(() => {})
  }, [esxiMigrateVm])

  // Fetch nodes when PVE connection is selected
  useEffect(() => {
    if (!migTargetConn) { setMigNodes([]); setMigTargetNode(''); return }
    fetch(`/api/v1/connections/${migTargetConn}/nodes`).then(r => r.json()).then(d => {
      const nodes = d.data || d || []
      setMigNodes(nodes)
      if (nodes.length === 1) setMigTargetNode(nodes[0].node || nodes[0].name)
    }).catch(() => {})
  }, [migTargetConn])

  // Fetch storages when node is selected
  useEffect(() => {
    if (!migTargetConn || !migTargetNode) { setMigStorages([]); setMigTargetStorage(''); return }
    fetch(`/api/v1/connections/${migTargetConn}/nodes/${migTargetNode}/storages?content=images`).then(r => r.json()).then(d => {
      const storages = (d.data || d || []).filter((s: any) => {
        const content = s.content || ''
        return content.includes('images')
      })
      setMigStorages(storages)
      if (storages.length > 0) {
        const localLvm = storages.find((s: any) => s.storage === 'local-lvm')
        setMigTargetStorage(localLvm ? 'local-lvm' : storages[0].storage)
      }
    }).catch(() => {})
    // Also fetch network bridges
    fetch(`/api/v1/connections/${migTargetConn}/nodes/${migTargetNode}/network`).then(r => r.json()).then(d => {
      const bridges = (d.data || d || []).filter((iface: any) => iface.type === 'bridge' || iface.type === 'OVSBridge')
      setMigBridges(bridges)
      if (bridges.length > 0) {
        const vmbr0 = bridges.find((b: any) => b.iface === 'vmbr0')
        setMigNetworkBridge(vmbr0 ? 'vmbr0' : bridges[0].iface)
      }
    }).catch(() => {})
  }, [migTargetConn, migTargetNode])

  // Poll migration job status
  useEffect(() => {
    if (!migJobId) return
    const interval = setInterval(() => {
      fetch(`/api/v1/migrations/${migJobId}`).then(r => r.json()).then(d => {
        setMigJob(d.data)
        if (d.data?.status === 'completed' || d.data?.status === 'failed' || d.data?.status === 'cancelled') {
          clearInterval(interval)
        }
      }).catch(() => {})
    }, 3000)
    return () => clearInterval(interval)
  }, [migJobId])

  // Fetch active migration job for the currently selected ESXi VM
  useEffect(() => {
    if (selection?.type !== 'extvm') { setVmMigJob(null); return }
    const vmid = selection.id.split(':')[1]
    if (!vmid) return
    // Fetch all jobs and find the latest one for this VM
    fetch('/api/v1/migrations').then(r => r.json()).then(d => {
      const jobs = d.data || []
      const match = jobs.find((j: any) => j.sourceVmId === vmid && !['cancelled'].includes(j.status))
      setVmMigJob(match || null)
    }).catch(() => {})
  }, [selection])

  // Poll active VM migration job
  useEffect(() => {
    if (!vmMigJob || ['completed', 'failed', 'cancelled'].includes(vmMigJob.status)) return
    const interval = setInterval(() => {
      fetch(`/api/v1/migrations/${vmMigJob.id}`).then(r => r.json()).then(d => {
        if (d.data) setVmMigJob(d.data)
        if (d.data?.status === 'completed' || d.data?.status === 'failed' || d.data?.status === 'cancelled') {
          clearInterval(interval)
        }
      }).catch(() => {})
    }, 3000)
    return () => clearInterval(interval)
  }, [vmMigJob?.id, vmMigJob?.status])

  // VMs sans templates (pour affichage dans les modes vms, tree, hosts, pools, tags)
  const displayVms = useMemo(() => allVms.filter(vm => !vm.template), [allVms])

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

    // String value (CDROM): wrap as { diskId: value }
    // Object with 'delete' key (unused disk reassign): send directly
    // Object with 'options' key (regular disk edit): wrap as { diskId: value }
    let body: any
    if (typeof diskConfig === 'string') {
      body = { [selectedDisk.id]: diskConfig }
    } else if (diskConfig?.delete) {
      body = diskConfig
    } else {
      body = { [selectedDisk.id]: diskConfig }
    }

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
          newid: params.newVmid,
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

    const json = await res.json()
    const upid = json.data
    if (upid && typeof upid === 'string' && upid.startsWith('UPID:')) {
      trackTask({
        upid,
        connId,
        node,
        description: `${params.name || `VM ${vmid}`}: ${t('vmActions.clone')}`,
        onSuccess: () => { onRefresh?.() },
      })
    } else {
      toast.success(t('vmActions.cloneSuccess'))
      onRefresh?.()
    }
  }, [selection, onRefresh, toast, t, trackTask])

  // Handler pour ouvrir le dialog de migration depuis la table
  const handleTableMigrate = useCallback((vm: any) => {
    setTableMigrateVm({
      connId: vm.connId,
      node: vm.node,
      type: vm.type,
      vmid: String(vm.vmid),
      name: vm.name || `VM ${vm.vmid}`,
      status: vm.status || 'unknown',
      isCluster: vm.isCluster ?? false
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

    const json = await res.json()
    const upid = json.data
    if (upid && typeof upid === 'string' && upid.startsWith('UPID:')) {
      trackTask({
        upid,
        connId,
        node,
        description: `${params.name || `VM ${vmid}`}: ${t('vmActions.clone')}`,
        onSuccess: () => { onRefresh?.(); setTableCloneVm(null) },
      })
    } else {
      toast.success(t('vmActions.cloneSuccess'))
      onRefresh?.()
      setTableCloneVm(null)
    }
  }, [tableCloneVm, onRefresh, toast, t, trackTask])

  // États pour le bulk action dialog
  const [bulkActionDialog, setBulkActionDialog] = useState<{
    open: boolean
    action: BulkAction | null
    node: NodeRow | null
    targetNode: string
  }>({ open: false, action: null, node: null, targetNode: '' })

  // Handler pour les actions bulk sur les nodes (depuis NodesTable)
  const handleNodeBulkAction = useCallback((node: NodeRow, action: BulkAction) => {
    setBulkActionDialog({ open: true, action, node, targetNode: '' })
  }, [])

  // Handler pour les actions bulk depuis la vue Tree (HostItem)
  const handleHostBulkAction = useCallback((host: HostItem, action: BulkAction) => {
    // Convertir HostItem vers un format compatible avec NodeRow
    const nodeRow: NodeRow = {
      id: host.key,
      connId: host.connId,
      node: host.node,
      name: host.node,
      status: 'online',
      cpu: 0,
      ram: 0,
      storage: 0,
      vms: host.vms.length,
    }
    setBulkActionDialog({ open: true, action, node: nodeRow, targetNode: '' })
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
  const addReplicationDialogOpen = activeDialog === 'addReplication'
  const setAddReplicationDialogOpen = useCallback((v: boolean) => setActiveDialog(v ? 'addReplication' : 'none'), [])
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
  const addCephReplicationDialogOpen = activeDialog === 'addCephReplication'
  const setAddCephReplicationDialogOpen = useCallback((v: boolean) => setActiveDialog(v ? 'addCephReplication' : 'none'), [])
  const [selectedCephCluster, setSelectedCephCluster] = useState('')
  const [cephReplicationSchedule, setCephReplicationSchedule] = useState('*/15')
  const [cephReplicationJobs, setCephReplicationJobs] = useState<any[]>([])
  const [expandedClusterNodes, setExpandedClusterNodes] = useState<Set<string>>(new Set()) // Nodes expanded dans l'onglet VMs du cluster
  const [pbsTab, setPbsTab] = useState(0) // 0 = Summary, 1 = Backups (pour datastore)
  const [pbsBackupSearch, setPbsBackupSearch] = useState('')
  const [pbsBackupPage, setPbsBackupPage] = useState(0)
  const [pbsTimeframe, setPbsTimeframe] = useState<'hour' | 'day' | 'week' | 'month' | 'year'>('hour') // Timeframe pour les graphiques PBS
  const [pbsRrdData, setPbsRrdData] = useState<any[]>([]) // Données RRD du serveur PBS
  const [datastoreRrdData, setDatastoreRrdData] = useState<any[]>([]) // Données RRD du datastore
  const [expandedBackupGroups, setExpandedBackupGroups] = useState<Set<string>>(new Set())
  const [backups, setBackups] = useState<any[]>([])
  const [backupsLoading, setBackupsLoading] = useState(false)
  const [backupsError, setBackupsError] = useState<string | null>(null)
  const [backupsStats, setBackupsStats] = useState<any>(null)
  const [backupsWarnings, setBackupsWarnings] = useState<string[]>([])
  const [backupsPreloaded, setBackupsPreloaded] = useState(false)
  const backupsLoadedForIdRef = React.useRef<string | null>(null) // Track which selection ID backups were loaded for
  const [selectedBackup, setSelectedBackup] = useState<any>(null)

  // État pour les onglets node (host standalone)
  const [nodeTab, setNodeTab] = useState(0) // 0 = Summary, 1 = VMs, 2 = Disks, 3 = Ceph (cluster), 4 = Backups (standalone), 5 = Cluster (standalone)
  
  const [nodeDisksSubTab, setNodeDisksSubTab] = useState(0) // 0=Disks, 1=LVM, 2=LVM-Thin, 3=Directory, 4=ZFS
  const [subscriptionKeyDialogOpen, setSubscriptionKeyDialogOpen] = useState(false)
  const [subscriptionKeyInput, setSubscriptionKeyInput] = useState('')
  const [subscriptionKeySaving, setSubscriptionKeySaving] = useState(false)
  const [removeSubscriptionDialogOpen, setRemoveSubscriptionDialogOpen] = useState(false)
  const [removeSubscriptionLoading, setRemoveSubscriptionLoading] = useState(false)
  const [systemReportDialogOpen, setSystemReportDialogOpen] = useState(false)
  const [systemReportData, setSystemReportData] = useState<string | null>(null)
  const [systemReportLoading, setSystemReportLoading] = useState(false)
  
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
  
  const [nodeSystemSubTab, setNodeSystemSubTab] = useState(0) // 0=Network, 1=Certificates, 2=DNS, 3=Hosts, 4=Options, 5=Time, 6=Syslog
  const [nodeSyslogLive, setNodeSyslogLive] = useState(false)
  const [editDnsDialogOpen, setEditDnsDialogOpen] = useState(false)
  const [editHostsDialogOpen, setEditHostsDialogOpen] = useState(false)
  const [editTimeDialogOpen, setEditTimeDialogOpen] = useState(false)
  const [systemSaving, setSystemSaving] = useState(false)
  const [dnsFormData, setDnsFormData] = useState({ search: '', dns1: '', dns2: '', dns3: '' })
  const [hostsFormData, setHostsFormData] = useState({ data: '', digest: '' })
  const [timeFormData, setTimeFormData] = useState({ timezone: '' })
  const [timezonesList, setTimezonesList] = useState<string[]>([])
  
  const [nodeNotesEditing, setNodeNotesEditing] = useState(false)
  const [nodeNotesEditValue, setNodeNotesEditValue] = useState('')
  const [nodeNotesSaving, setNodeNotesSaving] = useState(false)
  
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
  const [clusterCephTimeframe, setClusterCephTimeframe] = useState<number>(60) // Durée en secondes (60s, 300s=5min, 600s=10min, 1800s=30min)

  // États pour Ceph perf sur storage RBD/CephFS
  const [storageCephPerf, setStorageCephPerf] = useState<any>(null)
  const [storageCephPerfHistory, setStorageCephPerfHistory] = useState<Array<{ time: number; read_bytes_sec: number; write_bytes_sec: number; read_op_per_sec: number; write_op_per_sec: number }>>([])

  // Storage usage RRD history (all storage types)
  const [storageRrdHistory, setStorageRrdHistory] = useState<Array<{ time: number; used: number; total: number; usedPct: number }>>([])
  const [storageRrdTimeframe, setStorageRrdTimeframe] = useState<'hour' | 'day' | 'week' | 'month' | 'year'>('day')

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
  const [guestInfo, setGuestInfo] = useState<{ ip?: string; uptime?: number; pid?: number; osInfo?: { type: 'linux' | 'windows' | 'other'; name: string | null; version: string | null; kernel: string | null } | null } | null>(null)
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

  // --- Hooks: Node data, Ceph perf, live logs ---
  const {
    nodeNotesData, nodeNotesLoading, nodeNotesLoaded, setNodeNotesData,
    nodeDisksData, nodeDisksLoading, setNodeDisksData,
    nodeSubscriptionData, nodeSubscriptionLoading, setNodeSubscriptionData,
    nodeReplicationData, nodeReplicationLoading, setNodeReplicationData,
    nodeSystemData, nodeSystemLoading, setNodeSystemData,
    nodeSyslogData, nodeSyslogLoading, setNodeSyslogData,
    nodeCephData, nodeCephLoading, setNodeCephData,
    nodeShellData, nodeShellConnected, nodeShellLoading,
    setNodeShellData, setNodeShellConnected, setNodeShellLoading,
    setNodeReplicationLoaded, setNodeSystemLoaded, setNodeSyslogLoading,
    setNodeDisksLoading, setNodeSubscriptionLoading,
  } = useNodeData(
    selection?.type, selection?.id, nodeTab, nodeSystemSubTab, nodeDisksSubTab,
    setNodeDisksSubTab, setNodeSystemSubTab, data?.clusterName,
  )

  const { clusterCephPerf, clusterCephPerfFiltered, cephTrends } = useCephPerf(
    selection?.type, selection?.id, clusterTab, clusterCephData, clusterCephTimeframe,
  )

  useSyslogLive(nodeSyslogLive, selection?.type, selection?.id, nodeTab, nodeSystemSubTab, setNodeSyslogData)
  useCephLogLive(nodeCephLogLive, selection?.type, selection?.id, data?.clusterName, setNodeCephData)

  // Charger les sauvegardes d'une VM
  const loadBackups = useCallback(async (vmid: string, type: string) => {
    if (!vmid) return
    
    setBackupsLoading(true)
    setBackupsError(null)
    setBackups([])
    setBackupsStats(null)
    setBackupsWarnings([])

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
        setBackupsWarnings(json.data?.warnings || [])
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
        setExplorerError(t('inventory.pveFailoverError', { error: json.error }))
        setExplorerLoading(false)
        await loadBackupContentViaPbs(backup)
        
return
      } else {
        const files = (json.data?.files || []).map((f: any) => {
          // Les fichiers .img.fidx sont des images de disques bruts PBS
          // Ils ne supportent pas le file-restore (seuls .pxar.fidx le supportent)
          // Le nom peut commencer par / (ex: /drive-scsi0.img.fidx)
          const fileName = (f.name || '').replace(/^\//, '') // Enlever le / initial
          // Seuls les .pxar peuvent être explorés (archives de fichiers)
          const isRawDiskImage = fileName && !fileName.includes('.pxar') && (
            fileName.endsWith('.img.fidx') || fileName.endsWith('.img.didx') ||
            fileName.endsWith('.raw.fidx') || fileName.endsWith('.raw.didx') ||
            fileName.endsWith('.img') || /^drive-.*\.(img|raw)/i.test(fileName)
          )

          return {
            ...f,
            // Garder le browsable de l'API (PVE sait si c'est explorable)
            isRawDiskImage,
          }
        })

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
        // Ajouter la détection des images disques pour le mode PBS aussi
        const files = (json.data?.files || []).map((f: any) => {
          const fileName = (f.name || f.filename || '').replace(/^\//, '')
          const isPxarArchive = fileName && (
            fileName.endsWith('.pxar.fidx') || fileName.endsWith('.pxar.didx') || fileName.includes('.pxar')
          )
          const isRawDiskImage = !isPxarArchive && fileName && (
            fileName.endsWith('.img.fidx') || fileName.endsWith('.img.didx') ||
            fileName.endsWith('.raw.fidx') || fileName.endsWith('.raw.didx') ||
            fileName.endsWith('.img') || /^drive-.*\.(img|raw)/i.test(fileName)
          )
          return {
            ...f,
            // En mode PBS, seuls les pxar sont browsable (pas de file-restore)
            browsable: !isRawDiskImage && (isPxarArchive || f.browsable !== false),
            isRawDiskImage,
          }
        })
        setExplorerArchives(files)
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

      // Auto-sélection: exact match unique OU un seul storage compatible
      const exactMatches = compatible.filter((s: any) => s.matchType === 'exact')
      if (exactMatches.length === 1) {
        await exploreWithPveStorage(backup, exactMatches[0])
      } else if (compatible.length === 1) {
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
      setBackupsWarnings([])
      setBackupsPreloaded(false)
      // Note: backupsLoadedForIdRef est géré dans l'effet de chargement des backups
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
        if (!payload) {
          // root selection — no details to display
          setLoading(false)
          return
        }
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

  // Polling des métriques CPU/RAM/Storage toutes les 2s pour les VMs et nodes
  useEffect(() => {
    if (!selection || !data) return
    const isVm = selection.type === 'vm'
    const isNode = selection.type === 'node'
    if (!isVm && !isNode) return

    // Seulement pour les VMs running ou les nodes online
    if (isVm && data.vmRealStatus !== 'running') return
    if (isNode && data.status !== 'ok') return

    let alive = true

    const poll = async () => {
      try {
        if (isVm) {
          const { connId, node, type, vmid } = parseVmId(selection.id)
          const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/resources`, { cache: 'no-store' })
          const resources = asArray<any>(safeJson(await res.json()))
          const g = resources.find((x: any) => String(x.node) === String(node) && String(x.type) === String(type) && String(x.vmid) === String(vmid))
          if (!g || !alive) return
          setData(prev => prev ? {
            ...prev,
            metrics: {
              cpu: { label: 'CPU', pct: cpuPct(g.cpu) },
              ram: { label: 'RAM', pct: pct(Number(g.mem ?? 0), Number(g.maxmem ?? 0)), used: Number(g.mem ?? 0), max: Number(g.maxmem ?? 0) },
              storage: { label: 'Storage', pct: pct(Number(g.disk ?? 0), Number(g.maxdisk ?? 0)), used: Number(g.disk ?? 0), max: Number(g.maxdisk ?? 0) },
            },
          } : prev)
        } else {
          const { connId, node } = parseNodeId(selection.id)
          const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/resources`, { cache: 'no-store' })
          const resources = asArray<any>(safeJson(await res.json()))
          const n = resources.find((x: any) => x.type === 'node' && String(x.node) === String(node))
          if (!n || !alive) return
          setData(prev => prev ? {
            ...prev,
            metrics: {
              ...prev.metrics,
              cpu: { label: 'CPU', pct: cpuPct(n.cpu), used: cpuPct(n.cpu), max: 100 },
              ram: { label: 'RAM', pct: pct(Number(n.mem ?? 0), Number(n.maxmem ?? 0)), used: Number(n.mem ?? 0), max: Number(n.maxmem ?? 0) },
              storage: { label: 'Storage', pct: pct(Number(n.disk ?? 0), Number(n.maxdisk ?? 0)), used: Number(n.disk ?? 0), max: Number(n.maxdisk ?? 0) },
            },
          } : prev)
        }
      } catch {
        // Silently ignore polling errors
      }
    }

    const id = setInterval(poll, 2000)
    return () => { alive = false; clearInterval(id) }
  }, [selection?.type, selection?.id, data?.vmRealStatus, data?.status])

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
      setCpuFlags(data.cpuInfo.flags || {})
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

  const refreshData = useCallback(async () => {
    if (!selection || refreshing) return
    setRefreshing(true)
    try {
      const payload = await fetchDetails(selection)
      if (payload) {
        setData(payload)
        setLocalTags(payload.tags || [])
      }
    } catch (e: any) {
      console.error('Refresh error:', e)
    } finally {
      setRefreshing(false)
    }
  }, [selection, refreshing])

  const canShowRrd = selection && (selection.type === 'node' || selection.type === 'vm')

  // Charger les backups quand on sélectionne une VM (pré-chargement pour le badge)
  useEffect(() => {
    // Charger les backups uniquement si la sélection a changé
    // On utilise une ref pour tracker l'ID de la dernière sélection chargée
    if (selection?.type !== 'vm') {
      backupsLoadedForIdRef.current = null
      return
    }

    const currentSelectionId = selection.id

    // Si on a déjà chargé pour cette sélection, ne pas recharger
    if (backupsLoadedForIdRef.current === currentSelectionId) {
      return
    }

    // Marquer comme chargé pour cette sélection AVANT d'appeler loadBackups
    // pour éviter les doubles appels
    backupsLoadedForIdRef.current = currentSelectionId

    const { type, vmid } = parseVmId(selection.id)
    loadBackups(vmid, type)
    setBackupsPreloaded(true)
  }, [selection?.type, selection?.id, loadBackups])

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
            pid: data.pid,
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

  // Charger la config HA quand on sélectionne l'onglet HA (index 9)
  useEffect(() => {
    if (detailTab === 9 && selection?.type === 'vm' && !haLoaded && !haLoading) {
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
            jobs = (json.data?.jobs || []).filter((j: any) => String(j.guest) === String(vmid))
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
    if (selection?.type === 'cluster' && clusterTab === 12 && !clusterConfigLoaded && !clusterConfigLoading) {
      loadClusterConfig(selection.id?.split(':')[0] || '')
    }
  }, [selection?.type, selection?.id, clusterTab, clusterConfigLoaded, clusterConfigLoading, loadClusterConfig])

  // Charger les notes quand on sélectionne l'onglet Notes
  useEffect(() => {
    if (selection?.type === 'cluster' && clusterTab === 6 && !clusterNotesLoaded && !clusterNotesLoading) {
      loadClusterNotes(selection.id?.split(':')[0] || '')
    }
  }, [selection?.type, selection?.id, clusterTab, clusterNotesLoaded, clusterNotesLoading, loadClusterNotes])

  // Charger Ceph quand on sélectionne l'onglet Ceph
  useEffect(() => {
    if (selection?.type === 'cluster' && clusterTab === 7 && !clusterCephLoaded && !clusterCephLoading) {
      loadClusterCeph(selection.id?.split(':')[0] || '')
    }
  }, [selection?.type, selection?.id, clusterTab, clusterCephLoaded, clusterCephLoading, loadClusterCeph])

  // Composant icône de tendance
  const TrendIcon = ({ trend }: { trend: 'up' | 'down' | 'stable' }) => {
    if (trend === 'up') return <i className="ri-arrow-up-line" style={{ color: '#4caf50', fontSize: 14 }} />
    if (trend === 'down') return <i className="ri-arrow-down-line" style={{ color: '#f44336', fontSize: 14 }} />
    return <i className="ri-arrow-right-line" style={{ color: '#9e9e9e', fontSize: 14 }} />
  }

  // Charger la config du cluster pour les nodes standalone quand on sélectionne l'onglet Cluster
  useEffect(() => {
    if (selection?.type === 'node' && nodeTab === 9 && !clusterConfigLoaded && !clusterConfigLoading) {
      loadClusterConfig(parseNodeId(selection.id).connId)
    }
  }, [selection?.type, selection?.id, nodeTab, clusterConfigLoaded, clusterConfigLoading, loadClusterConfig])

  // Reset node UI states when selection changes (data states are reset by useNodeData hook)
  useEffect(() => {
    setNodeNotesEditing(false)
  }, [selection?.id])

  // Charger Storage quand on sélectionne l'onglet Storage
  useEffect(() => {
    if (selection?.type === 'cluster' && clusterTab === 8 && !clusterStorageLoaded && !clusterStorageLoading) {
      loadClusterStorage(selection.id?.split(':')[0] || '')
    }
  }, [selection?.type, selection?.id, clusterTab, clusterStorageLoaded, clusterStorageLoading, loadClusterStorage])

  // Charger les mises à jour quand on sélectionne l'onglet Rolling Update
  useEffect(() => {
    if (selection?.type === 'cluster' && clusterTab === 10 && data?.nodesData?.length > 0) {
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
    setClusterStorageLoaded(false)
    setClusterStorageData([])
    setNodeCephSubTab(0)
    setNodeCephLogLive(false)
    setNodeUpdates({})
    setNodeLocalVms({})
    setClusterFirewallLoaded(false)
  }, [selection?.id])

  // Poll Ceph perf when viewing a Ceph (rbd/cephfs) storage
  useEffect(() => {
    const isCephStorage = selection?.type === 'storage' && data?.storageInfo && (data.storageInfo.type === 'rbd' || data.storageInfo.type === 'cephfs')
    if (!isCephStorage) {
      setStorageCephPerf(null)
      setStorageCephPerfHistory([])
      return
    }
    const connId = data.storageInfo.connId
    const fetchPerf = async () => {
      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/ceph/status`, { cache: 'no-store' })
        const json = await res.json()
        if (json.data?.pgmap) {
          const now = Date.now()
          const pt = {
            time: now,
            read_bytes_sec: json.data.pgmap.read_bytes_sec || 0,
            write_bytes_sec: json.data.pgmap.write_bytes_sec || 0,
            read_op_per_sec: json.data.pgmap.read_op_per_sec || 0,
            write_op_per_sec: json.data.pgmap.write_op_per_sec || 0,
          }
          setStorageCephPerf(pt)
          setStorageCephPerfHistory(prev => {
            const cutoff = now - 300000 // 5 min
            return [...prev, pt].filter(p => p.time > cutoff)
          })
        }
      } catch { /* ignore */ }
    }
    fetchPerf()
    const iv = setInterval(fetchPerf, 3000)
    return () => clearInterval(iv)
  }, [selection?.type, selection?.id, data?.storageInfo])

  // Fetch storage RRD history when viewing any storage
  useEffect(() => {
    if (selection?.type !== 'storage' || !data?.storageInfo) {
      setStorageRrdHistory([])
      return
    }
    const si = data.storageInfo
    const path = `/nodes/${encodeURIComponent(si.node)}/storage/${encodeURIComponent(si.storage)}`
    let cancelled = false

    const load = async () => {
      try {
        const raw = await fetchRrd(si.connId, path, storageRrdTimeframe)
        if (cancelled) return
        const points = (Array.isArray(raw) ? raw : [])
          .filter((p: any) => p.time || p.t || p.timestamp)
          .map((p: any) => {
            const t = Math.round(pickNumber(p, ['time', 't', 'timestamp']) || 0) * 1000
            const total = pickNumber(p, ['total', 'maxdisk']) || 0
            const used = pickNumber(p, ['used', 'disk']) || 0
            return { time: t, used, total, usedPct: total > 0 ? Math.round((used / total) * 100) : 0 }
          })
          .filter((p: any) => p.time > 0 && p.total > 0)
        setStorageRrdHistory(points)
      } catch { setStorageRrdHistory([]) }
    }
    load()
    return () => { cancelled = true }
  }, [selection?.type, selection?.id, data?.storageInfo, storageRrdTimeframe])

  // Détecter si les valeurs CPU ont été modifiées
  const cpuModified = useMemo(() => {
    if (!data?.cpuInfo) return false
    const origFlags = data.cpuInfo.flags || {}
    const flagsChanged = JSON.stringify(cpuFlags) !== JSON.stringify(origFlags)

return (
      cpuSockets !== (data.cpuInfo.sockets || 1) ||
      cpuCores !== (data.cpuInfo.cores || 1) ||
      cpuType !== (data.cpuInfo.type || 'kvm64') ||
      flagsChanged ||
      cpuLimit !== (data.cpuInfo.cpulimit || 0) ||
      cpuLimitEnabled !== !!data.cpuInfo.cpulimit
    )
  }, [data?.cpuInfo, cpuSockets, cpuCores, cpuType, cpuFlags, cpuLimit, cpuLimitEnabled])

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
      // Build cpu field with flags: "host,flags=+aes;-pcid"
      const activeFlags = Object.entries(cpuFlags).filter(([, v]) => v === '+' || v === '-')
      let cpuField = cpuType
      if (activeFlags.length > 0) {
        cpuField += ',flags=' + activeFlags.map(([k, v]) => `${v}${k}`).join(';')
      }

      const configUpdate: any = {
        sockets: cpuSockets,
        cores: cpuCores,
        cpu: cpuField,
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
          onVmActionStart?.(connId, vmid)

          try {
            const url = `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/${action}`
            const res = await fetch(url, { method: 'POST' })
            const json = await res.json()

            if (!res.ok || json.error) {
              throw new Error(json?.error || `HTTP ${res.status}`)
            }

            // Optimistic update — reflect expected status immediately
            const optimisticStatus: Record<string, string> = {
              start: 'running', stop: 'stopped', shutdown: 'stopped',
              reboot: 'running', reset: 'running', suspend: 'paused',
              hibernate: 'stopped', resume: 'running',
            }
            if (optimisticStatus[action]) {
              onOptimisticVmStatus?.(connId, vmid, optimisticStatus[action])
            }

            const refreshAll = () => {
              fetchDetails(selection).then(payload => {
                setData(payload)
                setLocalTags(payload.tags || [])
              })
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
                  refreshAll()
                  fetch('/api/v1/inventory/poll', { method: 'POST' }).catch(() => {})
                  setTimeout(() => onVmActionEnd?.(connId, vmid), 2000)
                },
                onError: () => {
                  onVmActionEnd?.(connId, vmid)
                },
              })
            } else {
              toast.success(t(`vmActions.${action}Success`))
              refreshAll()
              fetch('/api/v1/inventory/poll', { method: 'POST' }).catch(() => {})
              setTimeout(() => onVmActionEnd?.(connId, vmid), 2000)
            }

            setConfirmAction(null)
          } catch (e: any) {
            onVmActionEnd?.(connId, vmid)
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
    onVmActionStart?.(connId, vmid)

    try {
      const url = `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/${action}`
      const res = await fetch(url, { method: 'POST' })
      const json = await res.json()

      if (!res.ok || json.error) {
        throw new Error(json?.error || `HTTP ${res.status}`)
      }

      // Optimistic update — reflect expected status immediately
      const optimisticStatus: Record<string, string> = {
        start: 'running', stop: 'stopped', shutdown: 'stopped',
        reboot: 'running', reset: 'running', suspend: 'paused',
        hibernate: 'stopped', resume: 'running',
      }
      if (optimisticStatus[action]) {
        onOptimisticVmStatus?.(connId, vmid, optimisticStatus[action])
      }

      const refreshAll = () => {
        fetchDetails(selection).then(payload => {
          setData(payload)
          setLocalTags(payload.tags || [])
        })
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
            refreshAll()
            fetch('/api/v1/inventory/poll', { method: 'POST' }).catch(() => {})
            setTimeout(() => onVmActionEnd?.(connId, vmid), 2000)
          },
          onError: () => {
            onVmActionEnd?.(connId, vmid)
          },
        })
      } else {
        toast.success(t(`vmActions.${action}Success`))
        refreshAll()
        fetch('/api/v1/inventory/poll', { method: 'POST' }).catch(() => {})
        setTimeout(() => onVmActionEnd?.(connId, vmid), 2000)
      }
    } catch (e: any) {
      onVmActionEnd?.(connId, vmid)
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
      const url = `/console/${encodeURIComponent(vm.type)}/${encodeURIComponent(vm.node)}/${encodeURIComponent(vm.vmid)}?connId=${encodeURIComponent(vm.connId)}`

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
    // Ouvrir le dialog de migration (cross-cluster toujours disponible, même pour standalone)
    setMigrateDialogOpen(true)
  }

  const onClone = () => setCloneDialogOpen(true)
  const onConvertTemplate = () => {
    const status = data?.vmRealStatus || data?.status
    if (status === 'running') {
      alert(t('inventory.vmRunningWarning'))
      return
    }
    setConvertTemplateDialogOpen(true)
  }

  const handleConvertTemplate = async () => {
    if (!selection || selection.type !== 'vm') return

    const { connId, node, type, vmid } = parseVmId(selection.id)

    setConvertingTemplate(true)

    try {
      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/template`,
        { method: 'POST' }
      )

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error || `HTTP ${res.status}`)
      }

      const json = await res.json()
      const upid = json.data

      setConvertTemplateDialogOpen(false)

      if (upid && typeof upid === 'string' && upid.startsWith('UPID:')) {
        trackTask({
          upid,
          connId,
          node,
          description: `${data?.title || `VM ${vmid}`}: ${t('templates.convertToTemplate')}`,
          onSuccess: () => { onRefresh?.() },
        })
      } else {
        toast.success(t('templates.convertSuccess'))
        onRefresh?.()
      }
    } catch (e: any) {
      alert(`${t('errors.genericError')}: ${e?.message || e}`)
    } finally {
      setConvertingTemplate(false)
    }
  }

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

      const json = await res.json()
      const upid = json.data

      setDeleteVmDialogOpen(false)

      // Retourner à la vue globale
      onSelect?.(null as any) // Désélectionner

      if (upid && typeof upid === 'string' && upid.startsWith('UPID:')) {
        trackTask({
          upid,
          connId,
          node,
          description: `${vmName}: ${t('common.delete')}`,
          onSuccess: () => { onRefresh?.() },
        })
      } else {
        onRefresh?.()
      }

      // Afficher un message de succès
      setConfirmAction({
        action: 'info',
        title: t('common.success'),
        message: `${t('common.delete')} "${vmName}" ${t('common.success')}`,
        vmName: undefined,
        onConfirm: async () => {
          setConfirmAction(null)
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
    <Box sx={{ p: selection && selection.type !== 'root' && !selection.type.endsWith('-root') ? 2.5 : 0, width: '100%' }}>
      {progress}

      {error ? (
        <Alert severity="error" sx={{ mb: 2, mx: selection && selection.type !== 'root' && !selection.type.endsWith('-root') ? 0 : 2 }}>
          Erreur: {error}
        </Alert>
      ) : null}

      {/* Section dashboards */}
      {selection?.type === 'storage-root' ? (
        <Box sx={{ p: 2.5, height: '100%', overflow: 'auto' }}>
          <StorageDashboard
            clusterStorages={clusterStorages}
            onStorageClick={(sel) => onSelect?.(sel)}
          />
        </Box>
      ) : selection?.type === 'network-root' ? (
        <Box sx={{ p: 2.5, height: '100%', overflow: 'auto' }}>
          <NetworkDashboard
            connectionIds={[...new Set(clusterStorages.map(cs => cs.connId))]}
            connectionNames={Object.fromEntries(clusterStorages.map(cs => [cs.connId, cs.connName]))}
          />
        </Box>
      ) : selection?.type === 'backup-root' ? (
        <Box sx={{ p: 2.5, height: '100%', overflow: 'auto' }}>
          <BackupDashboard
            pbsServers={pbsServers}
            onPbsClick={(sel) => onSelect?.(sel)}
            onDatastoreClick={(sel) => onSelect?.(sel)}
          />
        </Box>
      ) : selection?.type === 'migration-root' ? (
        <Box sx={{ p: 2.5, height: '100%', overflow: 'auto' }}>
          <MigrationDashboard
            externalHypervisors={externalHypervisors}
            onHostClick={(sel) => onSelect?.(sel)}
          />
        </Box>
      ) :

      /* Quand sélection root et mode tree: afficher vue hiérarchique collapsable */
      selection?.type === 'root' && viewMode === 'tree' ? (
        <RootInventoryView
          allVms={displayVms}
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
          onCreateVm={() => setCreateVmDialogOpen(true)}
          onCreateLxc={() => setCreateLxcDialogOpen(true)}
          onBulkAction={handleHostBulkAction}
          clusterStorages={clusterStorages}
          externalHypervisors={externalHypervisors}
        />
      ) : !selection || selection?.type === 'root' ? (
        viewMode === 'vms' && displayVms.length > 0 ? (
          <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <Card variant="outlined" sx={{ width: '100%', borderRadius: 0, flex: 1, minHeight: 0, border: 'none', display: 'flex', flexDirection: 'column' }}>
              <CardContent sx={{ p: 0, '&:last-child': { pb: 0 }, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
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
                    {t('inventory.vms')} ({displayVms.length})
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
                    vms={displayVms.map(vm => ({
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
            allVms={displayVms}
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
            title={t('inventory.byPool')}
            icon="ri-folder-line"
            groups={pools.map(p => ({
              key: p.pool,
              label: p.pool,
              vms: p.vms
            }))}
            allVms={displayVms}
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
            title={t('inventory.byTag')}
            icon="ri-price-tag-3-line"
            groups={tags.map(t => ({
              key: t.tag,
              label: t.tag,
              color: tagColor(t.tag),
              vms: t.vms
            }))}
            allVms={displayVms}
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
                      {t('inventory.templatesCount', { count: allVms.filter(vm => vm.template).length })}
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
                  fill="currentColor"
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
        <Stack spacing={2} sx={{ width: '100%', flex: 1, overflow: 'hidden', minHeight: 0 }}>
          {/* Header title + tags (VM only) + ACTIONS TOP RIGHT */}
          {selection?.type === 'vm' ? (

            /* Format VM — single row: back | icon | name · meta · status | tags | actions */
            (() => {
              const { connId, node, type, vmid } = parseVmId(selection.id)
              const isLxc = data.vmType === 'lxc'
              const iconColor = isLxc ? theme.palette.secondary.main : theme.palette.primary.main

              return (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                  {/* Back */}
                  {onBack && (
                    <IconButton
                      onClick={onBack}
                      size="small"
                      sx={{
                        bgcolor: 'action.hover',
                        '&:hover': { bgcolor: 'action.selected' },
                        flexShrink: 0,
                      }}
                    >
                      <i className="ri-arrow-left-line" style={{ fontSize: 18 }} />
                    </IconButton>
                  )}

                  <StatusChip status={data.status} />
                  {/* Icône VM/LXC */}
                  <Box sx={{
                    width: 28,
                    height: 28,
                    borderRadius: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    bgcolor: alpha(iconColor, 0.1),
                    flexShrink: 0,
                  }}>
                    <i
                      className={isLxc ? 'ri-instance-fill' : 'ri-computer-fill'}
                      style={{ fontSize: 16, color: iconColor }}
                    />
                  </Box>

                  {/* Nom + meta inline */}
                  <Typography variant="subtitle1" fontWeight={900} noWrap sx={{ minWidth: 0, flexShrink: 1 }}>
                    {data.title} <Typography component="span" variant="body2" sx={{ color: 'text.disabled', fontWeight: 400 }}>({vmid})</Typography>
                  </Typography>
                  {pendingActionVmIds?.has(`${connId}:${vmid}`) && (
                    <CircularProgress size={16} thickness={5} sx={{ flexShrink: 0 }} />
                  )}
                  {vmLock.locked && (
                    <MuiTooltip title={`Lock: ${vmLock.lockType || 'unknown'}`}>
                      <Chip
                        size="small"
                        icon={<i className="ri-lock-line" style={{ fontSize: 12, marginLeft: 6 }} />}
                        label={vmLock.lockType || 'locked'}
                        color="warning"
                        variant="outlined"
                        sx={{ height: 20, fontSize: '0.7rem', flexShrink: 0 }}
                      />
                    </MuiTooltip>
                  )}
                  <Typography variant="body2" noWrap sx={{ color: 'text.secondary', flexShrink: 0 }}>
                    {vmState === 'running' ? <><i className="ri-flashlight-fill" style={{ fontSize: 12, color: '#f9a825', verticalAlign: 'middle' }} /></> : vmState ? vmState : ''} · on{' '}
                    <Typography
                      component="span"
                      variant="body2"
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

                  {/* Hardware summary */}
                  {data.cpuInfo && (
                    <Typography variant="caption" noWrap sx={{ color: 'primary.main', fontFamily: 'monospace', fontSize: '0.7rem', flexShrink: 0, flex: 1, textAlign: 'center' }}>
                      {(data.cpuInfo.sockets || 1) * (data.cpuInfo.cores || 1)} vCPU
                      {' / '}
                      {data.memoryInfo?.memory >= 1024
                        ? `${(data.memoryInfo.memory / 1024).toFixed(data.memoryInfo.memory % 1024 === 0 ? 0 : 1)} GB`
                        : `${data.memoryInfo?.memory || 0} MB`}
                      {' / '}
                      {data.networkInfo?.length || 0} NIC
                      {' / '}
                      {data.disksInfo?.filter((d: any) => !d.isCdrom).length || 0} Disk{(data.disksInfo?.filter((d: any) => !d.isCdrom).length || 0) > 1 ? 's' : ''}
                    </Typography>
                  )}

                  {/* Refresh + Actions — poussées à droite */}
                  <Box sx={{ ml: 'auto', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <MuiTooltip title={t('common.refresh')}>
                      <IconButton size="small" onClick={refreshData} disabled={refreshing} sx={{ bgcolor: 'action.hover', '&:hover': { bgcolor: 'action.selected' }, '@keyframes spin': { '0%': { transform: 'rotate(0deg)' }, '100%': { transform: 'rotate(360deg)' } }, ...(refreshing && { '& i': { animation: 'spin 1s linear infinite' } }) }}>
                        <i className="ri-refresh-line" style={{ fontSize: 18 }} />
                      </IconButton>
                    </MuiTooltip>
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
                </Box>
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
                    <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" style={{ width: 14, height: 14, marginLeft: 8 }} />
                  ) : data.kindLabel === 'CLUSTER' ? (
                    <i className="ri-server-fill" style={{ fontSize: 14, marginLeft: 8 }} />
                  ) : data.kindLabel === 'VMWARE ESXI' || data.kindLabel === 'VMWARE VM' ? (
                    <img src="/images/esxi-logo.svg" alt="" style={{ width: 14, height: 14, marginLeft: 8 }} />
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

              {/* Refresh + Boutons Create VM/LXC pour clusters et hosts */}
              {(selection?.type === 'cluster' || selection?.type === 'node') && (
                <Stack direction="row" spacing={1} alignItems="center" sx={{ ml: data.hostInfo?.uptime ? 2 : 'auto' }}>
                  <MuiTooltip title={t('common.refresh')}>
                    <IconButton size="small" onClick={refreshData} disabled={refreshing} sx={{ bgcolor: 'action.hover', '&:hover': { bgcolor: 'action.selected' }, '@keyframes spin': { '0%': { transform: 'rotate(0deg)' }, '100%': { transform: 'rotate(360deg)' } }, ...(refreshing && { '& i': { animation: 'spin 1s linear infinite' } }) }}>
                      <i className="ri-refresh-line" style={{ fontSize: 18 }} />
                    </IconButton>
                  </MuiTooltip>
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
              )}
            </Box>
          )}

          {selection?.type === 'node' && data.hostInfo?.maintenance && (
            <>
              <Alert
                severity="warning"
                icon={<i className="ri-tools-fill" style={{ fontSize: 20 }} />}
                sx={{ borderRadius: 2 }}
                action={
                  <Button
                    size="small"
                    variant="outlined"
                    color="warning"
                    startIcon={<i className="ri-play-circle-line" />}
                    sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
                    onClick={() => setExitMaintenanceDialogOpen(true)}
                  >
                    {t('inventory.exitMaintenance')}
                  </Button>
                }
              >
                <Typography variant="body2" fontWeight={600}>
                  {t('inventory.maintenanceModeActive')}
                </Typography>
              </Alert>
              <Dialog
                open={exitMaintenanceDialogOpen}
                onClose={() => setExitMaintenanceDialogOpen(false)}
                maxWidth="xs"
                fullWidth
              >
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Box sx={{
                    width: 40, height: 40, borderRadius: 2,
                    bgcolor: 'rgba(76,175,80,0.12)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>
                    <i className="ri-play-circle-line" style={{ fontSize: 22, color: '#4caf50' }} />
                  </Box>
                  {t('inventory.exitMaintenance')}
                </DialogTitle>
                <DialogContent>
                  <DialogContentText>
                    {t('inventory.confirmExitMaintenance')}
                  </DialogContentText>
                  <Typography variant="body2" fontWeight={600} sx={{ mt: 1.5 }}>
                    {t('inventory.node')}: {selection?.id ? parseNodeId(selection.id).node : ''}
                  </Typography>
                  <Typography variant="caption" sx={{ display: 'block', mt: 1, opacity: 0.6 }}>
                    {t('inventory.maintenanceRequiresSsh')}
                  </Typography>
                  {exitMaintenanceError && (
                    <Alert severity="error" sx={{ mt: 2 }}>
                      {exitMaintenanceError}
                    </Alert>
                  )}
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 2 }}>
                  <Button onClick={() => { setExitMaintenanceDialogOpen(false); setExitMaintenanceError(null) }} color="inherit">
                    {t('common.cancel')}
                  </Button>
                  <Button
                    variant="contained"
                    color="success"
                    disabled={exitMaintenanceBusy}
                    startIcon={exitMaintenanceBusy ? <CircularProgress size={16} /> : undefined}
                    onClick={async () => {
                      const { connId, node } = parseNodeId(selection!.id)
                      setExitMaintenanceBusy(true)
                      setExitMaintenanceError(null)
                      try {
                        const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/maintenance`, { method: 'DELETE' })
                        const data = await res.json().catch(() => ({}))
                        if (!res.ok) {
                          setExitMaintenanceError(data?.error || res.statusText)
                          return
                        }
                        setExitMaintenanceDialogOpen(false)
                        if (onRefresh) await onRefresh()
                      } catch (e: any) {
                        setExitMaintenanceError(e?.message || 'Unknown error')
                      } finally {
                        setExitMaintenanceBusy(false)
                      }
                    }}
                  >
                    {t('common.confirm')}
                  </Button>
                </DialogActions>
              </Dialog>
            </>
          )}

          {selection?.type !== 'ext' && selection?.type !== 'extvm' && selection?.type !== 'storage' && (<>
          <Divider sx={{ flexShrink: 0 }} />

          <Box sx={{ flexShrink: 0 }}>
          <InventorySummary
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
            vmCount={selection?.type === 'node' ? data.vmsData?.filter((vm: any) => vm.status === 'running').length : undefined}
            isCluster={!!data.clusterName}
            hasCeph={!!data.cephHealth}
            haState={selection?.type === 'vm' ? (allVms.find(vm => `${vm.connId}:${vm.node}:${vm.type}:${vm.vmid}` === selection.id)?.hastate || null) : null}
            haGroup={selection?.type === 'vm' ? (allVms.find(vm => `${vm.connId}:${vm.node}:${vm.type}:${vm.vmid}` === selection.id)?.hagroup || null) : null}
            agentEnabled={selection?.type === 'vm' ? data.optionsInfo?.agentEnabled ?? null : null}
            ioSeries={selection?.type === 'vm' ? series : undefined}
          />
          </Box>
          </>)}

          {/* VM Detail Tabs */}
          {selection?.type === 'vm' && (
            <VmDetailTabs
              {...{addCephReplicationDialogOpen, addReplicationDialogOpen, availableTargetNodes, backToArchives, backToBackupsList,
                backups, backupsError, backupsLoading, backupsStats, backupsWarnings, balloon,
                balloonEnabled, browseArchive, canPreview, canShowRrd, cephClusters, cephClustersLoading,
                cephReplicationJobs, cephReplicationSchedule, compatibleStorages, cpuCores, cpuLimit,
                cpuFlags, cpuLimitEnabled, cpuModified, cpuSockets, cpuType, createSnapshot,
                data, deleteReplicationId, deleteSnapshot, detailTab, downloadFile,
                error, exploreWithPveStorage, explorerArchive, explorerArchives, explorerError,
                explorerFiles, explorerLoading, explorerMode, explorerPath, explorerSearch,
                filteredExplorerFiles, haComment, haConfig, haEditing, haError,
                haGroup, haGroups, haLoading, haMaxRelocate, haMaxRestart,
                haSaving, haState, loadBackupContent, loadBackupContentViaPbs, loadHaConfig,
                loadNotes, loadTasks, loading, localTags, memory,
                memoryModified, navigateToBreadcrumb, navigateToFolder, navigateUp, newSnapshotDesc,
                newSnapshotName, newSnapshotRam, notesEditing, notesError, notesLoading,
                notesSaving, previewFile, primaryColor, primaryColorLight, removeHaConfig,
                replicationComment, replicationJobs, replicationLoading, replicationRateLimit, replicationSchedule,
                replicationTargetNode, rollbackSnapshot, rrdError, rrdLoading, saveCpuConfig,
                saveHaConfig, saveMemoryConfig, saveNotes, savingCpu, savingMemory,
                savingReplication, selectedBackup, selectedCephCluster, selectedPveStorage, selectedVmIsCluster,
                selection, series, setAddCephReplicationDialogOpen, setAddDiskDialogOpen, setAddNetworkDialogOpen,
                setAddReplicationDialogOpen, setBackupCompress, setBackupMode, setBackupNote, setBackupStorage,
                setBackupStorages, setBalloon, setBalloonEnabled, setCephClusters, setCephReplicationSchedule,
                setCpuCores, setCpuFlags, setCpuLimit, setCpuLimitEnabled, setCpuSockets, setCpuType,
                setCreateBackupDialogOpen, setDeleteReplicationId, setDetailTab, setEditDiskDialogOpen, setEditNetworkDialogOpen,
                setEditOptionDialog, setEditScsiControllerDialogOpen, setExplorerArchive, setExplorerArchives, setExplorerFiles,
                setExplorerSearch, setHaComment, setHaEditing, setHaGroup, setHaMaxRelocate,
                setHaMaxRestart, setHaState, setMemory, setNewSnapshotDesc, setNewSnapshotName,
                setNewSnapshotRam, setNotesEditing, setReplicationComment, setReplicationLoaded, setReplicationRateLimit,
                setReplicationSchedule, setReplicationTargetNode, setSavingReplication, setSelectedBackup, setSelectedCephCluster,
                setSelectedDisk, setSelectedNetwork, setSelectedPveStorage, setShowCreateSnapshot, setTasksLoaded,
                setTf, setVmNotes, showCreateSnapshot, snapshotActionBusy, snapshots,
                snapshotsError, snapshotsLoading, sourceCephAvailable, tags,
                refreshData, tasks, tasksError, tasksLoading, tf, vmNotes}}
            />
          )}


          {/* Cluster Tabs */}
          {selection?.type === 'cluster' && data.nodesData && (
            <ClusterTabs
              {...{allVms, cephTrends, clusterActionError, clusterActionLoading, clusterCephData,
                clusterCephLoading, clusterCephPerf, clusterCephPerfFiltered, clusterCephTimeframe, clusterConfig,
                clusterConfigLoading, clusterHaGroups, clusterHaLoading, clusterHaResources, clusterHaRules,
                clusterNotesContent, clusterNotesEditMode, clusterNotesLoading, clusterNotesSaving, clusterPveMajorVersion,
                clusterStorageData, clusterStorageLoading, clusterTab, createClusterDialogOpen, data,
                error, expandedClusterNodes, favorites, handleCreateCluster, handleJoinCluster, handleNodeBulkAction,
                handleSaveClusterNotes, handleTableMigrate, handleTableVmAction, joinClusterDialogOpen, joinClusterInfo,
                joinClusterPassword, joinInfoDialogOpen, loading, localVmsDialogNode, localVmsDialogOpen,
                migratingVmIds, newClusterLinks, newClusterName, nodeLocalVms, nodeUpdates,
                cveAvailable, onSelect, primaryColor, rollingUpdateAvailable, rollingUpdateWizardOpen, selection,
                setClusterActionError, setClusterCephTimeframe, setClusterNotesContent, setClusterNotesEditMode, setClusterTab,
                setCreateClusterDialogOpen, setDeleteHaGroupDialog, setDeleteHaRuleDialog, setEditingHaGroup, setEditingHaRule,
                setExpandedClusterNodes, setHaGroupDialogOpen, setHaRuleDialogOpen, setHaRuleType, setJoinClusterDialogOpen,
                setJoinClusterInfo, setJoinClusterPassword, setJoinInfoDialogOpen, setLocalVmsDialogNode, setLocalVmsDialogOpen,
                setNewClusterLinks, setNewClusterName, setNodeLocalVms, setNodeUpdates, setRollingUpdateWizardOpen,
                setUpdatesDialogNode, setUpdatesDialogOpen, toggleFavorite, updatesDialogNode,
                updatesDialogOpen}}
            />
          )}


          {/* Node Tabs */}
          {selection?.type === 'node' && data.vmsData && (
            <NodeTabs
              {...{canShowRrd, clusterConfigLoaded, clusterConfigLoading, cveAvailable, data, deleteReplicationDialogOpen, deletingReplicationJob,
                dnsFormData, editDnsDialogOpen, editHostsDialogOpen, editTimeDialogOpen, editingReplicationJob,
                error, expandedVmsTable, favorites, handleTableMigrate, handleTableVmAction, hosts,
                hostsFormData, loadClusterConfig, loadVmTrendsBatch, loading, migratingVmIds,
                nodeCephData, nodeCephLoading, nodeCephLogLive, nodeCephSubTab, nodeDisksData,
                nodeDisksLoading, nodeDisksSubTab, nodeNotesData, nodeNotesEditValue, nodeNotesEditing,
                nodeNotesLoading, nodeNotesSaving, nodeReplicationData, nodeReplicationLoading, nodeShellData,
                nodeShellLoading, nodeSubscriptionData, nodeSubscriptionLoading, nodeSyslogData, nodeSyslogLive,
                nodeSyslogLoading, nodeSystemData, nodeSystemLoading, nodeSystemSubTab, nodeTab,
                nodeUpdates, setNodeUpdates, nodeLocalVms, setNodeLocalVms, rollingUpdateAvailable, rollingUpdateWizardOpen, setRollingUpdateWizardOpen,
                updatesDialogOpen, setUpdatesDialogOpen, updatesDialogNode, setUpdatesDialogNode,
                onSelect, pools, primaryColor, primaryColorLight, removeSubscriptionDialogOpen,
                removeSubscriptionLoading, replicationDeleting, replicationDialogMode, replicationDialogOpen, replicationFormData,
                replicationLogData, replicationLogDialogOpen, replicationLogJob, replicationLogLoading, replicationSaving,
                rrdError, rrdLoading, selection, series, setCreateClusterDialogOpen,
                setDeleteReplicationDialogOpen, setDeletingReplicationJob, setDnsFormData, setEditDnsDialogOpen, setEditHostsDialogOpen,
                setEditTimeDialogOpen, setEditingReplicationJob, setExpandedVmsTable, setHostsFormData, setJoinClusterDialogOpen,
                setNodeCephData, setNodeCephLogLive, setNodeCephSubTab, setNodeDisksData, setNodeDisksLoading,
                setNodeDisksSubTab, setNodeNotesData, setNodeNotesEditValue, setNodeNotesEditing, setNodeNotesSaving,
                setNodeReplicationLoaded, setNodeShellConnected, setNodeShellData, setNodeShellLoading, setNodeSubscriptionData,
                setNodeSubscriptionLoading, setNodeSyslogData, setNodeSyslogLive, setNodeSyslogLoading, setNodeSystemLoaded,
                setNodeSystemSubTab, setNodeTab, setRemoveSubscriptionDialogOpen, setRemoveSubscriptionLoading, setReplicationDeleting,
                setReplicationDialogMode, setReplicationDialogOpen, setReplicationFormData, setReplicationLogData, setReplicationLogDialogOpen,
                setReplicationLogJob, setReplicationLogLoading, setReplicationSaving, setSubscriptionKeyDialogOpen, setSubscriptionKeyInput,
                setSubscriptionKeySaving, setSystemReportData, setSystemReportDialogOpen, setSystemReportLoading, setSystemSaving,
                setTf, setTimeFormData, setTimezonesList, subscriptionKeyDialogOpen, subscriptionKeyInput,
                subscriptionKeySaving, systemReportData, systemReportDialogOpen, systemReportLoading, systemSaving,
                tf, timeFormData, timezonesList, toggleFavorite}}
            />
          )}


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
                              <XAxis dataKey="time" tickFormatter={v => new Date(v * 1000).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })} minTickGap={40} tick={{ fontSize: 9 }} />
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
                              <XAxis dataKey="time" tickFormatter={v => new Date(v * 1000).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })} minTickGap={40} tick={{ fontSize: 9 }} />
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
                              <XAxis dataKey="time" tickFormatter={v => new Date(v * 1000).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })} minTickGap={40} tick={{ fontSize: 9 }} />
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
                              <XAxis dataKey="time" tickFormatter={v => new Date(v * 1000).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })} minTickGap={40} tick={{ fontSize: 9 }} />
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
                              <XAxis dataKey="time" tickFormatter={v => new Date(v * 1000).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })} minTickGap={40} tick={{ fontSize: 9 }} />
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
                                      labelFormatter={v => new Date(Number(v) * 1000).toLocaleString()}
                                      formatter={(v: any, name: string) => [formatBytes(Number(v)), name === 'used' ? t('inventory.pbsStorageUsageLabel') : t('common.total')]}
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
                                      labelFormatter={v => new Date(Number(v) * 1000).toLocaleString()}
                                      formatter={(v: any, name: string) => [formatBytes(Number(v)) + '/s', name === 'read' ? t('inventory.pbsRead') : t('inventory.pbsWrite')]}
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
                                      labelFormatter={v => new Date(Number(v) * 1000).toLocaleString()}
                                      formatter={(v: any, name: string) => [Number(v).toFixed(0), name === 'readIops' ? t('inventory.pbsRead') : t('inventory.pbsWrite')]}
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
                                <i className={isExpanded ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} style={{ fontSize: 16, opacity: 0.5 }} />
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

          {/* ── Storage Detail Panel ── */}
          {selection?.type === 'storage' && data.storageInfo && (() => {
            const si = data.storageInfo
            const isCeph = si.type === 'rbd' || si.type === 'cephfs'
            const typeLabels: Record<string, string> = {
              rbd: 'Ceph RBD', cephfs: 'CephFS', nfs: 'NFS', cifs: 'SMB/CIFS',
              zfspool: 'ZFS', zfs: 'ZFS over iSCSI', lvm: 'LVM', lvmthin: 'LVM-Thin',
              dir: 'Directory', iscsi: 'iSCSI', glusterfs: 'GlusterFS', pbs: 'PBS',
            }
            const storageTypeIcon = (type: string) => {
              if (type === 'rbd' || type === 'cephfs') return null // use img
              if (type === 'nfs' || type === 'cifs') return 'ri-folder-shared-fill'
              if (type === 'zfspool' || type === 'zfs') return 'ri-stack-fill'
              if (type === 'lvm' || type === 'lvmthin') return 'ri-hard-drive-2-fill'
              if (type === 'dir') return 'ri-folder-fill'
              return 'ri-hard-drive-fill'
            }
            const storageTypeColor = (type: string) => {
              if (type === 'nfs' || type === 'cifs') return '#3498db'
              if (type === 'zfspool' || type === 'zfs') return '#2ecc71'
              if (type === 'lvm' || type === 'lvmthin') return '#e67e22'
              return '#95a5a6'
            }

            // Group content items by type
            const groups: Record<string, { label: string; icon: string; items: any[]; contentType?: string }> = {}
            const contentLabelMap: Record<string, { label: string; icon: string }> = {
              images: { label: t('inventory.storageVmDisks'), icon: 'ri-hard-drive-3-line' },
              rootdir: { label: t('inventory.storageCtVolumes'), icon: 'ri-archive-line' },
              iso: { label: t('inventory.storageIsoImages'), icon: 'ri-disc-line' },
              backup: { label: t('inventory.storageBackups'), icon: 'ri-shield-check-line' },
              snippets: { label: t('inventory.storageSnippets'), icon: 'ri-code-s-slash-line' },
              vztmpl: { label: t('inventory.storageTemplates'), icon: 'ri-file-copy-line' },
              import: { label: 'Import', icon: 'ri-import-line' },
            }

            // Pre-create empty groups for all content types the storage supports
            for (const ct of si.content || []) {
              const cfg = contentLabelMap[ct] || { label: ct, icon: 'ri-file-line' }
              groups[ct] = { label: cfg.label, icon: cfg.icon, items: [], contentType: ct }
            }

            for (const item of si.contentItems || []) {
              const ct = item.content || 'other'
              if (!groups[ct]) {
                const cfg = contentLabelMap[ct] || { label: ct, icon: 'ri-file-line' }
                groups[ct] = { label: cfg.label, icon: cfg.icon, items: [], contentType: ct }
              }
              groups[ct].items.push(item)
            }

            // Sort items in each group
            for (const g of Object.values(groups)) {
              g.items.sort((a: any, b: any) => (b.ctime || 0) - (a.ctime || 0))
            }

            return (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {/* Usage chart card - fixed, never cropped */}
                {si.total > 0 && (
                  <Card variant="outlined" sx={{ borderRadius: 2, flexShrink: 0 }}>
                    <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                      <Typography fontWeight={900} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                        {isCeph
                          ? <img src="/images/ceph-logo.svg" alt="" width={18} height={18} />
                          : <i className={storageTypeIcon(si.type) || 'ri-hard-drive-fill'} style={{ fontSize: 18, color: storageTypeColor(si.type) }} />
                        }
                        {t('inventory.storageUsage')}
                      </Typography>

                      {/* Usage gauge + graphs */}
                      <Box sx={{ display: 'flex', gap: 2, alignItems: 'stretch', flexWrap: 'wrap' }}>
                        {/* Donut gauge + legend */}
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                          <Box sx={{ position: 'relative', width: 90, height: 90, flexShrink: 0 }}>
                            <CircularProgress
                              variant="determinate"
                              value={100}
                              size={90}
                              thickness={6}
                              sx={{ color: 'action.hover', position: 'absolute' }}
                            />
                            <CircularProgress
                              variant="determinate"
                              value={si.usedPct}
                              size={90}
                              thickness={6}
                              sx={{
                                color: si.usedPct > 90 ? 'error.main' : si.usedPct > 70 ? 'warning.main' : 'success.main',
                                position: 'absolute',
                              }}
                            />
                            <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
                              <Typography variant="h6" fontWeight={900} sx={{ lineHeight: 1 }}>{si.usedPct}%</Typography>
                              <Typography variant="caption" sx={{ opacity: 0.5, fontSize: 10 }}>used</Typography>
                            </Box>
                          </Box>
                          <Box sx={{ minWidth: 120 }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                              <Typography variant="caption" sx={{ opacity: 0.7 }}>Used</Typography>
                              <Typography variant="caption" fontWeight={600} sx={{ ml: 1 }}>{formatBytes(si.used)}</Typography>
                            </Box>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                              <Typography variant="caption" sx={{ opacity: 0.7 }}>Free</Typography>
                              <Typography variant="caption" fontWeight={600} sx={{ ml: 1 }}>{formatBytes(si.total - si.used)}</Typography>
                            </Box>
                            <Divider sx={{ my: 0.5 }} />
                            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                              <Typography variant="caption" sx={{ opacity: 0.7 }}>Total</Typography>
                              <Typography variant="caption" fontWeight={700} sx={{ ml: 1 }}>{formatBytes(si.total)}</Typography>
                            </Box>
                          </Box>
                        </Box>

                        {/* Storage usage evolution graph (all storage types) */}
                        {storageRrdHistory.length > 1 && (
                          <Box sx={{ flex: 1, minWidth: 180, border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                              <Typography variant="caption" fontWeight={600}>
                                {t('inventory.storageUsage')}
                              </Typography>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                                {([
                                  { value: 'hour', label: '1h' },
                                  { value: 'day', label: '24h' },
                                  { value: 'week', label: '7d' },
                                  { value: 'month', label: '30d' },
                                  { value: 'year', label: '1y' },
                                ] as const).map(opt => (
                                  <Box
                                    key={opt.value}
                                    onClick={() => setStorageRrdTimeframe(opt.value)}
                                    sx={{
                                      px: 0.6, py: 0.1, borderRadius: 0.5, cursor: 'pointer',
                                      fontSize: '0.6rem', fontWeight: 700, lineHeight: 1.4,
                                      bgcolor: storageRrdTimeframe === opt.value ? 'primary.main' : 'transparent',
                                      color: storageRrdTimeframe === opt.value ? 'primary.contrastText' : 'text.secondary',
                                      opacity: storageRrdTimeframe === opt.value ? 1 : 0.5,
                                      '&:hover': { opacity: 1 },
                                    }}
                                  >
                                    {opt.label}
                                  </Box>
                                ))}
                              </Box>
                            </Box>
                            <Box sx={{ height: 90 }}>
                              <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={storageRrdHistory}>
                                  <XAxis
                                    dataKey="time"
                                    hide
                                    type="number"
                                    domain={['dataMin', 'dataMax']}
                                  />
                                  <YAxis hide domain={[0, 100]} />
                                  <Tooltip
                                    contentStyle={{ backgroundColor: '#1e1e2f', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
                                    labelFormatter={(value) => {
                                      const d = new Date(value)
                                      return storageRrdTimeframe === 'hour' || storageRrdTimeframe === 'day'
                                        ? d.toLocaleTimeString()
                                        : d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
                                    }}
                                    formatter={(value: number, name: string) => {
                                      if (name === 'usedPct') return [`${value}%`, 'Usage']
                                      return [formatBytes(value), name === 'used' ? 'Used' : 'Total']
                                    }}
                                  />
                                  <Area
                                    type="monotone"
                                    dataKey="usedPct"
                                    stroke={si.usedPct > 90 ? theme.palette.error.main : si.usedPct > 70 ? theme.palette.warning.main : theme.palette.success.main}
                                    fill={si.usedPct > 90 ? theme.palette.error.main : si.usedPct > 70 ? theme.palette.warning.main : theme.palette.success.main}
                                    fillOpacity={0.3}
                                    strokeWidth={1.5}
                                    isAnimationActive={false}
                                    name="usedPct"
                                  />
                                </AreaChart>
                              </ResponsiveContainer>
                            </Box>
                          </Box>
                        )}

                        {/* Ceph Read/Write + IOPS graphs */}
                        {isCeph && storageCephPerfHistory.length > 1 && (
                          <>
                            {/* Read/Write throughput */}
                            <Box sx={{ flex: 1, minWidth: 180, border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                                <Typography variant="caption" fontWeight={600}>
                                  {t('inventory.pbsTransferRate')}
                                </Typography>
                                <Typography variant="caption" fontWeight={700} sx={{ opacity: 0.7, fontSize: 10 }}>
                                  {storageCephPerf ? `R: ${formatBps(storageCephPerf.read_bytes_sec)} / W: ${formatBps(storageCephPerf.write_bytes_sec)}` : '—'}
                                </Typography>
                              </Box>
                              <Box sx={{ height: 90 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                  <AreaChart data={storageCephPerfHistory}>
                                    <YAxis hide domain={[0, 'auto']} />
                                    <Tooltip
                                      contentStyle={{ backgroundColor: '#1e1e2f', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
                                      labelFormatter={(_, payload) => {
                                        if (payload?.[0]?.payload?.time) return new Date(payload[0].payload.time).toLocaleTimeString()
                                        return ''
                                      }}
                                      formatter={(value: number, name: string) => [formatBps(value), name === 'read_bytes_sec' ? 'Read' : 'Write']}
                                    />
                                    <Area type="monotone" dataKey="read_bytes_sec" stroke={primaryColor} fill={primaryColor} fillOpacity={0.4} strokeWidth={1.5} isAnimationActive={false} name="read_bytes_sec" />
                                    <Area type="monotone" dataKey="write_bytes_sec" stroke={primaryColorLight} fill={primaryColorLight} fillOpacity={0.3} strokeWidth={1} isAnimationActive={false} name="write_bytes_sec" />
                                  </AreaChart>
                                </ResponsiveContainer>
                              </Box>
                            </Box>

                            {/* IOPS */}
                            <Box sx={{ flex: 1, minWidth: 180, border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                                <Typography variant="caption" fontWeight={600}>
                                  IOPS
                                </Typography>
                                <Typography variant="caption" fontWeight={700} sx={{ opacity: 0.7, fontSize: 10 }}>
                                  {storageCephPerf ? `R: ${storageCephPerf.read_op_per_sec?.toLocaleString() || 0} / W: ${storageCephPerf.write_op_per_sec?.toLocaleString() || 0}` : '—'}
                                </Typography>
                              </Box>
                              <Box sx={{ height: 90 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                  <AreaChart data={storageCephPerfHistory}>
                                    <YAxis hide domain={[0, 'auto']} />
                                    <Tooltip
                                      contentStyle={{ backgroundColor: '#1e1e2f', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
                                      labelFormatter={(_, payload) => {
                                        if (payload?.[0]?.payload?.time) return new Date(payload[0].payload.time).toLocaleTimeString()
                                        return ''
                                      }}
                                      formatter={(value: number, name: string) => [value?.toLocaleString() + ' IOPS', name === 'read_op_per_sec' ? 'Read' : 'Write']}
                                    />
                                    <Area type="monotone" dataKey="read_op_per_sec" stroke={primaryColor} fill={primaryColor} fillOpacity={0.4} strokeWidth={1.5} isAnimationActive={false} name="read_op_per_sec" />
                                    <Area type="monotone" dataKey="write_op_per_sec" stroke={primaryColorLight} fill={primaryColorLight} fillOpacity={0.3} strokeWidth={1} isAnimationActive={false} name="write_op_per_sec" />
                                  </AreaChart>
                                </ResponsiveContainer>
                              </Box>
                            </Box>
                          </>
                        )}
                      </Box>

                    </CardContent>
                  </Card>
                )}

                {/* Scrollable rest */}
                <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                {/* Properties card */}
                <Card variant="outlined" sx={{ borderRadius: 2 }}>
                  <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                    <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                      <Typography fontWeight={900} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <i className="ri-information-line" style={{ fontSize: 18, opacity: 0.7 }} />
                        {t('inventory.storageProperties')}
                      </Typography>
                    </Box>
                    <Box>
                      {[
                        { k: 'Type', v: typeLabels[si.type] || si.type },
                        { k: 'Shared', v: si.shared ? 'Yes' : 'No' },
                        { k: 'Status', v: si.enabled ? 'Enabled' : 'Disabled' },
                        { k: 'Content types', v: si.content.join(', ') || '-' },
                        ...(si.node && !si.shared ? [{ k: 'Node', v: si.node }] : []),
                        ...(si.nodes && si.nodes.length > 1 ? [{ k: 'Nodes', v: si.nodes.join(', ') }] : []),
                        ...(si.path ? [{ k: 'Path', v: si.path }] : []),
                        ...(si.server ? [{ k: 'Server', v: si.server }] : []),
                        ...(si.pool ? [{ k: 'Pool', v: si.pool }] : []),
                        ...(si.monhost ? [{ k: 'Monitor Host', v: si.monhost }] : []),
                      ].map(({ k, v }) => (
                        <Box key={k} sx={{ display: 'flex', px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider', '&:last-child': { borderBottom: 'none' } }}>
                          <Typography variant="body2" sx={{ opacity: 0.5, width: 130, flexShrink: 0, fontSize: 13 }}>{k}</Typography>
                          <Typography variant="body2" sx={{ fontSize: 13, fontFamily: 'JetBrains Mono, monospace' }}>{v}</Typography>
                        </Box>
                      ))}
                    </Box>
                  </CardContent>
                </Card>

                {/* PBS storage: grouped backup table */}
                {si.type === 'pbs' && (groups['backup']?.items?.length > 0) ? (() => {
                  const backupItems = groups['backup']?.items || []

                  // Group by vmid (e.g. "vm/269")
                  const groupMap = new Map<string, any[]>()
                  for (const item of backupItems) {
                    const volParts = String(item.volid || '').split(':')
                    const backupPath = volParts.length > 1 ? volParts.slice(1).join(':') : item.volid
                    const pathParts = backupPath?.split('/') || []
                    // backup/vm/269/timestamp → groupKey = "vm/269"
                    const groupKey = pathParts.length >= 3 ? `${pathParts[1]}/${pathParts[2]}` : String(item.vmid || 'unknown')
                    if (!groupMap.has(groupKey)) groupMap.set(groupKey, [])
                    groupMap.get(groupKey)!.push(item)
                  }

                  // Sort each group by ctime desc
                  for (const [, group] of groupMap) {
                    group.sort((a: any, b: any) => (b.ctime || 0) - (a.ctime || 0))
                  }

                  // Sort groups by latest backup
                  let sortedGroups = Array.from(groupMap.entries())
                    .sort((a, b) => (b[1][0]?.ctime || 0) - (a[1][0]?.ctime || 0))

                  // Filter by search
                  if (pbsStorageSearch.trim()) {
                    const q = pbsStorageSearch.toLowerCase()
                    sortedGroups = sortedGroups.filter(([groupId, groupItems]) => {
                      if (groupId.toLowerCase().includes(q)) return true
                      return groupItems.some((item: any) =>
                        String(item.volid || '').toLowerCase().includes(q) ||
                        String(item.notes || '').toLowerCase().includes(q) ||
                        (item.vmid ? String(item.vmid).includes(q) : false)
                      )
                    })
                  }

                  const totalFiltered = sortedGroups.reduce((sum, [, g]) => sum + g.length, 0)

                  return (
                    <Card variant="outlined" sx={{ borderRadius: 2, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                      <CardContent sx={{ p: 0, '&:last-child': { pb: 0 }, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                        {/* Header */}
                        <Box sx={{ px: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography fontWeight={900} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0, fontSize: 13 }}>
                            <i className="ri-shield-check-line" style={{ fontSize: 16, opacity: 0.7 }} />
                            {t('inventory.pbsBackupList')} ({totalFiltered}{pbsStorageSearch ? `/${backupItems.length}` : ''})
                          </Typography>
                          <Box sx={{ flex: 1 }} />
                          <Box sx={{
                            display: 'flex', alignItems: 'center', gap: 0.5,
                            border: '1px solid', borderColor: 'divider', borderRadius: 1,
                            px: 0.75, py: 0.15, maxWidth: 200,
                          }}>
                            <i className="ri-search-line" style={{ fontSize: 12, opacity: 0.4 }} />
                            <input
                              type="text"
                              value={pbsStorageSearch}
                              onChange={e => { setPbsStorageSearch(e.target.value); setPbsStoragePage(0) }}
                              placeholder={t('inventory.pbsSearchBackups')}
                              style={{
                                border: 'none', outline: 'none', background: 'transparent',
                                fontSize: 11, width: '100%', color: 'inherit',
                                fontFamily: 'Inter, sans-serif',
                              }}
                            />
                            {pbsStorageSearch && (
                              <i className="ri-close-line" style={{ fontSize: 12, opacity: 0.4, cursor: 'pointer' }} onClick={() => { setPbsStorageSearch(''); setPbsStoragePage(0) }} />
                            )}
                          </Box>
                        </Box>

                        {/* Grouped backup list */}
                        <Box sx={{ flex: 1, minHeight: 0, maxHeight: 'calc(100vh - 400px)', overflow: 'auto' }}>
                          {sortedGroups.length === 0 ? (
                            <Box sx={{ px: 2, py: 3, textAlign: 'center' }}>
                              <Typography variant="caption" sx={{ opacity: 0.4 }}>{t('inventory.pbsNoBackups')}</Typography>
                            </Box>
                          ) : sortedGroups.map(([groupId, groupItems]) => {
                            const isExpanded = expandedStorageBackupGroups.has(groupId)
                            const latest = groupItems[0]
                            const isVm = latest.format === 'pbs-vm'
                            const isCt = latest.format === 'pbs-ct'
                            const backupType = isVm ? 'vm' : isCt ? 'ct' : 'host'
                            const totalSize = groupItems.reduce((sum: number, i: any) => sum + (i.size || 0), 0)
                            const verifiedCount = groupItems.filter((i: any) => i.verification?.state === 'ok').length
                            const vmName = latest.notes || (latest.vmid ? `VM ${latest.vmid}` : groupId)

                            return (
                              <Box key={groupId}>
                                {/* Group header */}
                                <Box
                                  onClick={() => {
                                    setExpandedStorageBackupGroups(prev => {
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
                                    bgcolor: isExpanded ? 'action.selected' : 'transparent',
                                  }}
                                >
                                  <i className={isExpanded ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} style={{ fontSize: 16, opacity: 0.5 }} />
                                  <i
                                    className={isVm ? 'ri-computer-line' : isCt ? 'ri-instance-line' : 'ri-server-line'}
                                    style={{ fontSize: 14, color: isVm ? '#ff9800' : isCt ? '#9c27b0' : '#757575' }}
                                  />
                                  <Typography variant="body2" fontWeight={600} noWrap sx={{ fontSize: 11, flex: 1, minWidth: 0 }}>
                                    {vmName} <Typography component="span" sx={{ opacity: 0.4, fontSize: 9 }}>({groupId})</Typography>
                                  </Typography>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Typography variant="caption" sx={{ opacity: 0.7, fontSize: 11 }}>
                                      {groupItems.length} snapshot{groupItems.length > 1 ? 's' : ''}
                                    </Typography>
                                    <Typography variant="caption" sx={{ opacity: 0.6, minWidth: 60, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 10 }}>
                                      {formatBytes(totalSize)}
                                    </Typography>
                                    {verifiedCount === groupItems.length ? (
                                      <MuiTooltip title={t('inventory.pbsAllVerified')}>
                                        <i className="ri-checkbox-circle-fill" style={{ fontSize: 16, color: '#4caf50' }} />
                                      </MuiTooltip>
                                    ) : verifiedCount > 0 ? (
                                      <MuiTooltip title={t('inventory.pbsPartiallyVerified', { count: verifiedCount, total: groupItems.length })}>
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
                                      bgcolor: 'background.paper',
                                    }}>
                                      <Typography variant="caption" fontWeight={600} sx={{ opacity: 0.6, fontSize: 10 }}>{t('inventory.pbsDateTime')}</Typography>
                                      <Typography variant="caption" fontWeight={600} sx={{ opacity: 0.6, fontSize: 10 }}>{t('inventory.pbsSize')}</Typography>
                                      <Typography variant="caption" fontWeight={600} sx={{ opacity: 0.6, fontSize: 10, textAlign: 'center' }}><i className="ri-lock-line" style={{ fontSize: 10 }} /></Typography>
                                      <Typography variant="caption" fontWeight={600} sx={{ opacity: 0.6, fontSize: 10, textAlign: 'center' }}>{t('common.actions')}</Typography>
                                      <Typography variant="caption" fontWeight={600} sx={{ opacity: 0.6, fontSize: 10, textAlign: 'center' }}><i className="ri-checkbox-circle-line" style={{ fontSize: 10 }} /></Typography>
                                    </Box>
                                    {groupItems.map((item: any, idx: number) => {
                                      const dateStr = item.ctime
                                        ? new Date(item.ctime * 1000).toLocaleString(dateLocale || 'en', {
                                            year: 'numeric', month: '2-digit', day: '2-digit',
                                            hour: '2-digit', minute: '2-digit',
                                          })
                                        : '-'
                                      const encrypted = item.encrypted
                                      const verifyOk = item.verification?.state === 'ok'
                                      const itemIsVm = item.format === 'pbs-vm'
                                      const itemIsCt = item.format === 'pbs-ct'

                                      return (
                                        <Box
                                          key={item.volid || idx}
                                          sx={{
                                            display: 'grid',
                                            gridTemplateColumns: '1fr 80px 30px 80px 30px',
                                            gap: 0.25, px: 1.5, pl: 5, py: 0.15,
                                            borderBottom: idx < groupItems.length - 1 ? '1px solid' : 'none',
                                            borderColor: 'divider',
                                            alignItems: 'center',
                                            '&:hover': { bgcolor: 'action.focus' },
                                            minHeight: 24,
                                          }}
                                        >
                                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                            <i className="ri-time-line" style={{ fontSize: 12, opacity: 0.5 }} />
                                            <Typography variant="body2" noWrap sx={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>
                                              {dateStr}
                                            </Typography>
                                          </Box>
                                          <Typography variant="body2" sx={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', opacity: 0.7 }}>
                                            {item.size ? formatBytes(item.size) : '-'}
                                          </Typography>
                                          <Box sx={{ textAlign: 'center' }}>
                                            {encrypted ? (
                                              <MuiTooltip title={t('inventory.pbsEncryptedYes')}><i className="ri-lock-fill" style={{ fontSize: 12, color: '#ff9800' }} /></MuiTooltip>
                                            ) : (
                                              <i className="ri-lock-unlock-line" style={{ fontSize: 12, opacity: 0.15 }} />
                                            )}
                                          </Box>
                                          <Box sx={{ display: 'flex', justifyContent: 'center', gap: 0 }}>
                                            <MuiTooltip title={itemIsVm ? t('inventory.pbsRestoreVm') : itemIsCt ? t('inventory.pbsRestoreCt') : t('inventory.pbsRestoreVm')}>
                                              <IconButton size="small" sx={{ p: 0.15 }} onClick={() => openPbsRestoreDialog(item, si)}>
                                                <i className="ri-inbox-unarchive-line" style={{ fontSize: 13, color: '#2196f3' }} />
                                              </IconButton>
                                            </MuiTooltip>
                                            <MuiTooltip title={t('inventory.pbsFileRestore')}>
                                              <IconButton size="small" sx={{ p: 0.15 }} onClick={() => openPbsFileRestore(item, si)}>
                                                <i className="ri-folder-open-line" style={{ fontSize: 13, color: '#ff9800' }} />
                                              </IconButton>
                                            </MuiTooltip>
                                          </Box>
                                          <Box sx={{ textAlign: 'center' }}>
                                            {verifyOk ? (
                                              <MuiTooltip title={t('inventory.pbsVerified')}><i className="ri-checkbox-circle-fill" style={{ fontSize: 12, color: '#4caf50' }} /></MuiTooltip>
                                            ) : (
                                              <i className="ri-checkbox-blank-circle-line" style={{ fontSize: 12, opacity: 0.15 }} />
                                            )}
                                          </Box>
                                        </Box>
                                      )
                                    })}
                                  </Box>
                                )}
                              </Box>
                            )
                          })}
                        </Box>
                      </CardContent>
                    </Card>
                  )
                })() : null}

                {/* Non-PBS content items grouped by type */}
                {(si.type !== 'pbs' || !groups['backup']?.items?.length) && (
                  Object.keys(groups).length > 0 ? Object.entries(groups)
                    .filter(([ct]) => si.type === 'pbs' ? ct !== 'backup' : true)
                    .map(([contentType, group]) => (
                      <StorageContentGroup
                        key={contentType}
                        group={group}
                        formatBytes={formatBytes}
                        onUpload={['iso', 'snippets', 'vztmpl', 'import'].includes(contentType) ? () => setStorageUploadOpen(true) : undefined}
                        onDownloadTemplate={contentType === 'vztmpl' ? () => setTemplateDialogOpen(true) : undefined}
                        onDelete={async (volid: string) => {
                          const res = await fetch(
                            `/api/v1/connections/${encodeURIComponent(si.connId)}/nodes/${encodeURIComponent(si.node)}/storage/${encodeURIComponent(si.storage)}/content/${encodeURIComponent(volid)}`,
                            { method: 'DELETE' }
                          )
                          if (!res.ok) {
                            const json = await res.json().catch(() => ({}))
                            throw new Error(json.error || `HTTP ${res.status}`)
                          }
                          // Refresh data
                          if (selection) fetchDetails(selection).then(setData)
                        }}
                      />
                    )) : (si.contentItems || []).length === 0 && (
                    <Card variant="outlined" sx={{ borderRadius: 2 }}>
                      <CardContent sx={{ p: 3, textAlign: 'center' }}>
                        <i className="ri-folder-open-line" style={{ fontSize: 36, opacity: 0.2 }} />
                        <Typography variant="body2" sx={{ opacity: 0.5, mt: 1 }}>
                          {t('inventory.storageEmpty')}
                        </Typography>
                      </CardContent>
                    </Card>
                  )
                )}

                {/* Upload dialog for storage content */}
                <UploadDialog
                  open={storageUploadOpen}
                  onClose={() => setStorageUploadOpen(false)}
                  onOpen={() => setStorageUploadOpen(true)}
                  connId={si.connId}
                  node={si.node}
                  storage={si.storage}
                  contentTypes={si.content || []}
                  onUploaded={() => {
                    setStorageUploadOpen(false)
                    if (selection) fetchDetails(selection).then(setData)
                  }}
                />

                {/* Template download dialog */}
                {(si.content || []).includes('vztmpl') && (
                  <TemplateDownloadDialog
                    open={templateDialogOpen}
                    onClose={() => setTemplateDialogOpen(false)}
                    connId={si.connId}
                    node={si.node}
                    storage={si.storage}
                    onDownloaded={() => {
                      setTemplateDialogOpen(false)
                      if (selection) fetchDetails(selection).then(setData)
                    }}
                  />
                )}
                </Box>
              </Box>
            )
          })()}

          {/* External Host — VM List with Migrate buttons */}
          {selection?.type === 'ext' && data.esxiHostInfo && (() => {
            const isXcpng = data.esxiHostInfo.hostType === 'xcpng'
            const extVmIcon = isXcpng ? '/images/xcpng-logo.svg' : '/images/esxi-vm.svg'
            return (
            <Card variant="outlined" sx={{ width: '100%', borderRadius: 2 }}>
              <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                {data.esxiHostInfo.vms.length === 0 ? (
                  <Box sx={{ p: 4, textAlign: 'center' }}>
                    <img src={extVmIcon} alt="" width={48} height={48} style={{ opacity: 0.3 }} />
                    <Typography variant="body2" sx={{ opacity: 0.5, mt: 1 }}>No virtual machines found on this host</Typography>
                  </Box>
                ) : (
                  <TableContainer sx={{ maxHeight: 'calc(100vh - 320px)' }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>{t('common.name')}</TableCell>
                          <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>{t('common.status')}</TableCell>
                          <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>{t('inventoryPage.esxiMigration.guestOs')}</TableCell>
                          <TableCell sx={{ fontWeight: 700, fontSize: 12 }} align="right">{t('inventoryPage.esxiMigration.usedSpace')}</TableCell>
                          <TableCell sx={{ fontWeight: 700, fontSize: 12 }} align="right">CPU</TableCell>
                          <TableCell sx={{ fontWeight: 700, fontSize: 12 }} align="right">RAM</TableCell>
                          <TableCell sx={{ fontWeight: 700, fontSize: 12 }} align="center">{t('inventoryPage.esxiMigration.migration')}</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {data.esxiHostInfo.vms.map((vm: any) => (
                          <TableRow
                            key={vm.vmid}
                            hover
                            sx={{ cursor: 'pointer', '&:last-child td': { borderBottom: 'none' } }}
                            onClick={() => onSelect?.({ type: 'extvm', id: `${data.esxiHostInfo!.connectionId}:${vm.vmid}` })}
                          >
                            <TableCell>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <img src={extVmIcon} alt="" width={16} height={16} style={{ opacity: 0.7 }} />
                                <Typography variant="body2" fontWeight={600}>{vm.name || vm.vmid}</Typography>
                              </Box>
                            </TableCell>
                            <TableCell>
                              <Chip
                                size="small"
                                label={vm.status === 'running' ? t('inventoryPage.esxiMigration.poweredOn') : vm.status === 'suspended' ? t('inventoryPage.esxiMigration.suspended') : t('inventoryPage.esxiMigration.poweredOff')}
                                sx={{
                                  height: 22, fontSize: 11, fontWeight: 600,
                                  bgcolor: vm.status === 'running' ? 'success.main' : vm.status === 'suspended' ? 'warning.main' : 'action.disabledBackground',
                                  color: vm.status === 'running' || vm.status === 'suspended' ? '#fff' : 'text.secondary',
                                }}
                              />
                            </TableCell>
                            <TableCell>
                              <Typography variant="body2" sx={{ opacity: 0.8, fontSize: 12 }}>{vm.guest_OS || 'N/A'}</Typography>
                            </TableCell>
                            <TableCell align="right">
                              <Typography variant="body2" sx={{ fontSize: 12 }}>{vm.committed ? formatBytes(vm.committed) : '--'}</Typography>
                            </TableCell>
                            <TableCell align="right">
                              <Typography variant="body2" sx={{ fontSize: 12 }}>{vm.cpu || '--'} vCPU</Typography>
                            </TableCell>
                            <TableCell align="right">
                              <Typography variant="body2" sx={{ fontSize: 12 }}>{vm.memory_size_MiB ? `${(vm.memory_size_MiB / 1024).toFixed(1)} GB` : '--'}</Typography>
                            </TableCell>
                            <TableCell align="center" onClick={e => e.stopPropagation()}>
                              <Button
                                size="small"
                                variant="outlined"
                                color="primary"
                                sx={{ textTransform: 'none', fontSize: 10, height: 24, minWidth: 0, px: 1.5 }}
                                startIcon={<img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={12} height={12} />}
                                onClick={() => {
                                  if (!vmwareMigrationAvailable) { setUpgradeDialogOpen(true); return }
                                  setEsxiMigrateVm({
                                    vmid: vm.vmid, name: vm.name || vm.vmid, connId: data.esxiHostInfo!.connectionId,
                                    connName: data.esxiHostInfo!.connectionName, cpu: vm.cpu, memoryMB: vm.memory_size_MiB,
                                    committed: vm.committed, guestOS: vm.guest_OS, licenseFull: data.esxiHostInfo!.licenseFull,
                                    hostType: data.esxiHostInfo!.hostType,
                                  })
                                }}
                              >
                                {t('inventoryPage.esxiMigration.migrate')}
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </CardContent>
            </Card>
            )
          })()}

          {/* External VM — Migration Control Panel */}
          {selection?.type === 'extvm' && data.esxiVmInfo && (() => {
            const vm = data.esxiVmInfo
            const isXcpngVm = vm.hostType === 'xcpng'
            const extSourceIcon = isXcpngVm ? '/images/xcpng-logo.svg' : '/images/esxi-logo.svg'
            const extSourceLabel = isXcpngVm ? 'XCP-ng' : 'ESXi'
            const memGB = vm.memoryMB ? (vm.memoryMB / 1024).toFixed(1) : '0'
            const diskGB = vm.committed ? (vm.committed / 1073741824).toFixed(1) : '0'

            return (
              <Stack spacing={2} sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                {/* VM Summary Bar + Migrate button */}
                <Card variant="outlined" sx={{ borderRadius: 2 }}>
                  <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                          <i className="ri-cpu-line" style={{ fontSize: 14, opacity: 0.5 }} />
                          <Typography variant="body2" fontWeight={600}>{vm.numCPU} vCPU</Typography>
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                          <i className="ri-ram-line" style={{ fontSize: 14, opacity: 0.5 }} />
                          <Typography variant="body2" fontWeight={600}>{memGB} GB RAM</Typography>
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                          <i className="ri-hard-drive-2-line" style={{ fontSize: 14, opacity: 0.5 }} />
                          <Typography variant="body2" fontWeight={600}>{diskGB} GB disk</Typography>
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                          <i className="ri-terminal-box-line" style={{ fontSize: 14, opacity: 0.5 }} />
                          <Typography variant="body2" sx={{ opacity: 0.7 }}>{vm.guestOS || 'Unknown OS'}</Typography>
                        </Box>
                      </Box>
                      <Button
                        size="small"
                        variant="outlined"
                        color="primary"
                        sx={{ textTransform: 'none', fontSize: 11, height: 28, minWidth: 0, px: 1.5, whiteSpace: 'nowrap', flexShrink: 0 }}
                        startIcon={<i className="ri-play-circle-line" style={{ fontSize: 14 }} />}
                        onClick={() => {
                          if (!vmwareMigrationAvailable) { setUpgradeDialogOpen(true); return }
                          setEsxiMigrateVm({
                            vmid: vm.vmid, name: vm.name, connId: vm.connectionId,
                            connName: vm.connectionName, cpu: vm.numCPU, memoryMB: vm.memoryMB,
                            committed: vm.committed, guestOS: vm.guestOS, licenseFull: vm.licenseFull,
                            hostType: vm.hostType || data.esxiVmInfo?.hostType,
                          })
                        }}
                      >
                        {t('inventoryPage.esxiMigration.startMigration')}
                      </Button>
                    </Box>
                  </CardContent>
                </Card>

                {/* Migration Control */}
                <Card variant="outlined" sx={{ borderRadius: 2 }}>
                  <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                    <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Typography fontWeight={900} sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 13 }}>
                        <i className="ri-swap-line" style={{ fontSize: 16, color: '#E65100' }} />
                        {t('inventoryPage.esxiMigration.migrationToProxmox')}
                      </Typography>
                    </Box>

                    {/* Migration flow visual */}
                    <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                      <Box sx={{ textAlign: 'center' }}>
                        <Box sx={{ width: 44, height: 44, borderRadius: 1.5, bgcolor: isXcpngVm ? 'rgba(0,173,181,0.1)' : 'rgba(99,140,28,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 0.5 }}>
                          <img src={extSourceIcon} alt="" width={24} height={24} />
                        </Box>
                        <Typography variant="caption" fontWeight={600} sx={{ fontSize: 11 }}>{extSourceLabel}</Typography>
                        <Typography variant="caption" sx={{ display: 'block', opacity: 0.5, fontSize: 9 }}>{vm.name}</Typography>
                      </Box>
                      <Box sx={{ flex: 1, maxWidth: 160, position: 'relative' }}>
                        <Divider sx={{ borderStyle: 'dashed' }} />
                        <Box sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', bgcolor: 'background.paper', px: 1 }}>
                          <i className="ri-arrow-right-line" style={{ fontSize: 18, opacity: 0.4 }} />
                        </Box>
                      </Box>
                      <Box sx={{ textAlign: 'center' }}>
                        <Box sx={{ width: 44, height: 44, borderRadius: 1.5, bgcolor: 'rgba(230,81,0,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 0.5 }}>
                          <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={24} height={24} />
                        </Box>
                        <Typography variant="caption" fontWeight={600} sx={{ fontSize: 11 }}>Proxmox VE</Typography>
                        <Typography variant="caption" sx={{ display: 'block', opacity: 0.5, fontSize: 9 }}>Target</Typography>
                      </Box>
                    </Box>
                  </CardContent>
                </Card>

                {/* Transfer Metrics — real data from migration job */}
                <Card variant="outlined" sx={{ borderRadius: 2, flexShrink: 0 }}>
                  <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                    <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Typography fontWeight={900} sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 13 }}>
                        <i className="ri-line-chart-line" style={{ fontSize: 16, opacity: 0.7 }} />
                        {t('inventoryPage.esxiMigration.transferMetrics')}
                      </Typography>
                      {vmMigJob && (
                        <Chip
                          size="small"
                          label={vmMigJob.status === 'completed' ? t('inventoryPage.esxiMigration.completed') : vmMigJob.status === 'failed' ? t('inventoryPage.esxiMigration.failed') : vmMigJob.status === 'cancelled' ? t('inventoryPage.esxiMigration.cancelled') : (vmMigJob.currentStep || vmMigJob.status).replace(/_/g, ' ')}
                          color={vmMigJob.status === 'completed' ? 'success' : vmMigJob.status === 'failed' ? 'error' : 'primary'}
                          sx={{ height: 20, fontSize: 10, fontWeight: 600 }}
                        />
                      )}
                    </Box>
                    <Box sx={{ p: 2, flex: 1 }}>
                      {vmMigJob ? (
                        <>
                          {/* Progress bar */}
                          <Box sx={{ mb: 2 }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                              <Typography variant="caption" color="text.secondary">{t('inventoryPage.esxiMigration.overallProgress')}</Typography>
                              <Typography variant="caption" fontWeight={700}>{vmMigJob.progress || 0}%</Typography>
                            </Box>
                            <LinearProgress
                              variant={!['completed', 'failed', 'cancelled'].includes(vmMigJob.status) && vmMigJob.progress === 0 ? 'indeterminate' : 'determinate'}
                              value={vmMigJob.progress || 0}
                              color={vmMigJob.status === 'completed' ? 'success' : vmMigJob.status === 'failed' ? 'error' : 'primary'}
                              sx={{ height: 6, borderRadius: 3, bgcolor: 'action.hover', '& .MuiLinearProgress-bar': { borderRadius: 3 } }}
                            />
                          </Box>

                          {/* Metrics grid */}
                          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
                            <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)', border: '1px solid', borderColor: 'divider' }}>
                              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>{t('inventoryPage.esxiMigration.transferSpeed')}</Typography>
                              <Typography variant="body2" fontWeight={700}>{vmMigJob.transferSpeed || '—'}</Typography>
                            </Box>
                            <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)', border: '1px solid', borderColor: 'divider' }}>
                              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>{t('inventoryPage.esxiMigration.disk')}</Typography>
                              <Typography variant="body2" fontWeight={700}>
                                {vmMigJob.currentDisk != null && vmMigJob.totalDisks ? `${vmMigJob.currentDisk} / ${vmMigJob.totalDisks}` : '—'}
                              </Typography>
                            </Box>
                            <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)', border: '1px solid', borderColor: 'divider' }}>
                              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>{t('inventoryPage.esxiMigration.transferred')}</Typography>
                              <Typography variant="body2" fontWeight={700}>
                                {vmMigJob.bytesTransferred ? `${(vmMigJob.bytesTransferred / 1073741824).toFixed(1)} GB` : '—'}
                                {vmMigJob.totalBytes ? <Typography component="span" variant="caption" color="text.secondary"> / {(vmMigJob.totalBytes / 1073741824).toFixed(1)} GB</Typography> : ''}
                              </Typography>
                            </Box>
                            <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)', border: '1px solid', borderColor: 'divider' }}>
                              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>{t('inventoryPage.esxiMigration.targetVmid')}</Typography>
                              <Typography variant="body2" fontWeight={700}>{vmMigJob.targetVmid || '—'}</Typography>
                            </Box>
                          </Box>

                          {/* Progress graph — Recharts area chart with tooltip */}
                          {vmMigJob.logs?.length > 1 && (() => {
                            const logs = vmMigJob.logs as { ts: string; msg: string; level: string }[]
                            const startTime = new Date(logs[0].ts).getTime()
                            const chartData = logs.map((l: any, idx: number) => {
                              const elapsed = (new Date(l.ts).getTime() - startTime) / 1000
                              return {
                                elapsed,
                                pct: Math.round((idx / (logs.length - 1)) * 100),
                                time: new Date(l.ts).toLocaleTimeString(),
                                msg: l.msg,
                              }
                            })
                            return (
                              <Box sx={{ mt: 2 }}>
                                <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, mb: 0.5, display: 'block' }}>{t('inventoryPage.esxiMigration.progressOverTime')}</Typography>
                                <ResponsiveContainer width="100%" height={70}>
                                  <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                                    <defs>
                                      <linearGradient id="migGradChart" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor={theme.palette.primary.main} stopOpacity={0.3} />
                                        <stop offset="100%" stopColor={theme.palette.primary.main} stopOpacity={0.02} />
                                      </linearGradient>
                                    </defs>
                                    <XAxis dataKey="elapsed" tick={false} axisLine={false} tickLine={false} />
                                    <YAxis domain={[0, 100]} tick={false} axisLine={false} tickLine={false} />
                                    <Tooltip
                                      content={({ active, payload }) => {
                                        if (!active || !payload?.[0]) return null
                                        const d = payload[0].payload
                                        return (
                                          <Box sx={{
                                            px: 1, py: 0.5, borderRadius: 1, fontSize: 11,
                                            bgcolor: theme.palette.mode === 'dark' ? 'rgba(30,30,30,0.95)' : 'rgba(255,255,255,0.95)',
                                            border: '1px solid', borderColor: 'divider',
                                            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                                          }}>
                                            <Box sx={{ fontWeight: 700, fontFamily: '"JetBrains Mono", monospace', color: 'primary.main', fontSize: 11 }}>
                                              {vmMigJob.transferSpeed || `${d.pct}%`}
                                            </Box>
                                          </Box>
                                        )
                                      }}
                                    />
                                    <Area type="monotone" dataKey="pct" stroke={theme.palette.primary.main} strokeWidth={2} fill="url(#migGradChart)" dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
                                  </AreaChart>
                                </ResponsiveContainer>
                              </Box>
                            )
                          })()}
                        </>
                      ) : (
                        <Box sx={{ py: 3, textAlign: 'center' }}>
                          <i className="ri-bar-chart-grouped-line" style={{ fontSize: 36, opacity: 0.12 }} />
                          <Typography variant="body2" sx={{ opacity: 0.35, mt: 0.5, fontSize: 12 }}>{t('inventoryPage.esxiMigration.noMigrationStarted')}</Typography>
                        </Box>
                      )}
                    </Box>
                  </CardContent>
                </Card>

                {/* Migration Logs — real data from migration job */}
                <Card variant="outlined" sx={{ borderRadius: 2 }}>
                  <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                    <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Typography fontWeight={900} sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 13 }}>
                        <i className="ri-terminal-box-line" style={{ fontSize: 16, opacity: 0.7 }} />
                        {t('inventoryPage.esxiMigration.migrationLogs')}
                        {vmMigJob?.logs?.length > 0 && (
                          <Typography component="span" variant="caption" sx={{ opacity: 0.4 }}>({vmMigJob.logs.length})</Typography>
                        )}
                      </Typography>
                      {vmMigJob?.logs?.length > 0 && (
                        <MuiTooltip title={t('common.copy')}>
                          <IconButton size="small" sx={{ opacity: 0.5, '&:hover': { opacity: 1 } }} onClick={() => {
                            const text = vmMigJob.logs.map((l: any) => `[${new Date(l.ts).toLocaleTimeString()}] ${l.level === 'success' ? '✓' : l.level === 'error' ? '✗' : l.level === 'warn' ? '⚠' : '·'} ${l.msg}`).join('\n')
                            navigator.clipboard.writeText(text)
                          }}>
                            <i className="ri-file-copy-line" style={{ fontSize: 14 }} />
                          </IconButton>
                        </MuiTooltip>
                      )}
                    </Box>
                    <Box sx={{ p: 1.5, bgcolor: theme.palette.mode === 'dark' ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.03)', fontFamily: '"JetBrains Mono", monospace', fontSize: 11, overflow: 'auto', borderRadius: '0 0 8px 8px', lineHeight: 1.8, maxHeight: 'calc(100vh - 650px)', minHeight: 80 }}>
                      {vmMigJob?.logs?.length > 0 ? (
                        vmMigJob.logs.map((log: any, i: number) => (
                          <Box key={i}>
                            <Box component="span" sx={{ color: 'text.secondary' }}>[{new Date(log.ts).toLocaleTimeString()}]</Box>{' '}
                            {log.level === 'success' && <Box component="span" sx={{ color: 'success.main' }}>✓ </Box>}
                            {log.level === 'error' && <Box component="span" sx={{ color: 'error.main' }}>✗ </Box>}
                            {log.level === 'warn' && <Box component="span" sx={{ color: 'warning.main' }}>⚠ </Box>}
                            {log.msg}
                          </Box>
                        ))
                      ) : (
                        <Typography variant="body2" sx={{ fontFamily: 'inherit', fontSize: 'inherit', opacity: 0.3, fontStyle: 'italic' }}>
                          {t('inventoryPage.esxiMigration.logsWillAppear')}
                        </Typography>
                      )}
                    </Box>
                  </CardContent>
                </Card>
              </Stack>
            )
          })()}

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
        defaultConnId={effectiveCreateDefaults.connId}
        defaultNode={effectiveCreateDefaults.node}
      />

      {/* Dialog Créer LXC */}
      <CreateLxcDialog
        open={createLxcDialogOpen}
        onClose={() => setCreateLxcDialogOpen(false)}
        allVms={allVms}
        onCreated={handleLxcCreated}
        defaultConnId={effectiveCreateDefaults.connId}
        defaultNode={effectiveCreateDefaults.node}
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
              existingDisks={data?.disksInfo?.map((d: any) => d.id) || []}
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
              isCluster={selectedVmIsCluster}
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
          isCluster={tableMigrateVm.isCluster}
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
              <InputLabel>{t('inventory.backupMode')}</InputLabel>
              <Select
                value={backupMode}
                onChange={(e) => setBackupMode(e.target.value as any)}
                label={t('inventory.backupMode')}
              >
                <MenuItem value="snapshot">{t('audit.actions.snapshot')}</MenuItem>
                <MenuItem value="suspend">{t('audit.actions.suspend')}</MenuItem>
                <MenuItem value="stop">{t('audit.actions.stop')}</MenuItem>
              </Select>
            </FormControl>
            
            <FormControl fullWidth size="small">
              <InputLabel>{t('inventory.backupCompression')}</InputLabel>
              <Select
                value={backupCompress}
                onChange={(e) => setBackupCompress(e.target.value as any)}
                label={t('inventory.backupCompression')}
              >
                <MenuItem value="zstd">{t('inventoryPage.zstdRecommended')}</MenuItem>
                <MenuItem value="lzo">{t('inventoryPage.lzoFast')}</MenuItem>
                <MenuItem value="gzip">{t('inventory.backupGzip')}</MenuItem>
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

      {/* Dialog de conversion en template */}
      <Dialog
        open={convertTemplateDialogOpen}
        onClose={() => !convertingTemplate && setConvertTemplateDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-file-text-line" style={{ fontSize: 24 }} />
          {t('templates.convertToTemplate')}
        </DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            <Typography variant="body2" fontWeight={600}>
              {t('templates.convertWarning')}
            </Typography>
          </Alert>
          <Box sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 2 }}>
            <Typography variant="body2" sx={{ opacity: 0.7 }}>VM:</Typography>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {data?.title || 'VM'} <Typography component="span" variant="body2" sx={{ opacity: 0.6 }}>(ID: {selection?.type === 'vm' ? parseVmId(selection.id).vmid : ''})</Typography>
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConvertTemplateDialogOpen(false)} disabled={convertingTemplate}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="contained"
            onClick={handleConvertTemplate}
            disabled={convertingTemplate}
            startIcon={convertingTemplate ? <CircularProgress size={16} /> : <i className="ri-file-text-line" />}
          >
            {convertingTemplate ? t('common.loading') : t('templates.convert')}
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

      {/* ESXi / XCP-ng Migration Dialog */}
      <Dialog open={!!esxiMigrateVm} onClose={() => { if (!migStarting && !migJobId) setEsxiMigrateVm(null) }} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <img src={esxiMigrateVm?.hostType === 'xcpng' ? '/images/xcpng-logo.svg' : '/images/esxi-logo.svg'} alt="" width={22} height={22} />
          {t('inventoryPage.esxiMigration.migrateToProxmox')}
        </DialogTitle>
        <DialogContent>
          {esxiMigrateVm && !migJobId && (
            <Stack spacing={2.5} sx={{ mt: 1 }}>
              {/* Source VM info */}
              <Box sx={{ p: 2, borderRadius: 1.5, bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)', border: '1px solid', borderColor: 'divider' }}>
                <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('inventoryPage.esxiMigration.sourceVm')}</Typography>
                <Typography variant="body1" fontWeight={600}>{esxiMigrateVm.name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {esxiMigrateVm.connName} — {esxiMigrateVm.cpu || '?'} vCPU · {esxiMigrateVm.memoryMB ? (esxiMigrateVm.memoryMB / 1024).toFixed(1) : '?'} GB RAM
                  {esxiMigrateVm.committed ? ` · ${(esxiMigrateVm.committed / 1073741824).toFixed(1)} GB disk` : ''}
                </Typography>
              </Box>

              {/* Arrow */}
              <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                <i className="ri-arrow-down-line" style={{ fontSize: 24, color: theme.palette.primary.main }} />
              </Box>

              {/* Target config */}
              <Box sx={{ p: 2, borderRadius: 1.5, bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)', border: '1px solid', borderColor: 'divider' }}>
                <Typography variant="subtitle2" sx={{ mb: 1.5, color: 'text.secondary', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('inventoryPage.esxiMigration.targetProxmox')}</Typography>
                <Stack spacing={2}>
                  <TextField
                    select label={t('inventoryPage.esxiMigration.targetCluster')} size="small" fullWidth
                    value={migTargetConn}
                    onChange={e => setMigTargetConn(e.target.value)}
                  >
                    <MenuItem value="" disabled>{t('inventoryPage.esxiMigration.selectCluster')}</MenuItem>
                    {migPveConnections.map((c: any) => (
                      <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    select label={t('inventoryPage.esxiMigration.targetNode')} size="small" fullWidth
                    value={migTargetNode}
                    onChange={e => setMigTargetNode(e.target.value)}
                    disabled={!migTargetConn || migNodes.length === 0}
                  >
                    <MenuItem value="" disabled>{t('inventoryPage.esxiMigration.selectNode')}</MenuItem>
                    {migNodes.map((n: any) => (
                      <MenuItem key={n.node || n.name} value={n.node || n.name}>{n.node || n.name}</MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    select label={t('inventoryPage.esxiMigration.targetStorage')} size="small" fullWidth
                    value={migTargetStorage}
                    onChange={e => setMigTargetStorage(e.target.value)}
                    disabled={!migTargetNode || migStorages.length === 0}
                  >
                    <MenuItem value="" disabled>{t('inventoryPage.esxiMigration.selectStorage')}</MenuItem>
                    {migStorages.map((s: any) => (
                      <MenuItem key={s.storage} value={s.storage}>
                        {s.storage} ({s.type}) — {s.avail ? `${(s.avail / 1073741824).toFixed(1)} GB ${t('inventoryPage.esxiMigration.free')}` : ''}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    select label={t('inventoryPage.esxiMigration.networkBridge')} size="small" fullWidth
                    value={migNetworkBridge}
                    onChange={e => setMigNetworkBridge(e.target.value)}
                    disabled={!migTargetNode || migBridges.length === 0}
                  >
                    <MenuItem value="" disabled>{t('inventoryPage.esxiMigration.selectBridge')}</MenuItem>
                    {migBridges.map((b: any) => (
                      <MenuItem key={b.iface} value={b.iface}>
                        {b.iface}{b.comments ? ` (${b.comments})` : ''}{b.cidr ? ` — ${b.cidr}` : ''}
                      </MenuItem>
                    ))}
                  </TextField>
                  {/* Migration type selector */}
                  <Box>
                    <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      {t('inventoryPage.esxiMigration.migrationType')}
                    </Typography>
                    <Stack spacing={1}>
                      {([
                        { value: 'cold' as const, icon: 'ri-shut-down-line', color: 'info.main', labelKey: 'migrationTypeCold', descKey: 'migrationTypeColdDesc', requiresLicense: false },
                        { value: 'near-live' as const, icon: 'ri-speed-line', color: 'warning.main', labelKey: 'migrationTypeNearLive', descKey: 'migrationTypeNearLiveDesc', requiresLicense: true },
                        { value: 'live' as const, icon: 'ri-flashlight-line', color: 'success.main', labelKey: 'migrationTypeLive', descKey: 'migrationTypeLiveDesc', requiresLicense: true },
                      ]).map(opt => {
                        const disabled = opt.requiresLicense && !esxiMigrateVm?.licenseFull
                        return (
                        <Box
                          key={opt.value}
                          onClick={() => !disabled && setMigType(opt.value)}
                          sx={{
                            p: 1.5,
                            borderRadius: 1.5,
                            border: '2px solid',
                            borderColor: disabled ? 'divider' : migType === opt.value ? `${opt.color}` : 'divider',
                            bgcolor: disabled
                              ? theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.03)'
                              : migType === opt.value
                                ? theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)'
                                : 'transparent',
                            cursor: disabled ? 'not-allowed' : 'pointer',
                            opacity: disabled ? 0.5 : 1,
                            transition: 'all 0.15s',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1.5,
                            ...(!disabled && { '&:hover': { borderColor: `${opt.color}`, bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.01)' } }),
                          }}
                        >
                          <Box sx={{
                            width: 36, height: 36, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            bgcolor: !disabled && migType === opt.value ? `${opt.color}` : 'action.hover',
                            color: !disabled && migType === opt.value ? '#fff' : 'text.secondary',
                            transition: 'all 0.15s',
                          }}>
                            <i className={disabled ? 'ri-lock-line' : opt.icon} style={{ fontSize: 18 }} />
                          </Box>
                          <Box sx={{ flex: 1 }}>
                            <Typography variant="body2" fontWeight={600} sx={{ color: disabled ? 'text.disabled' : 'text.primary' }}>
                              {t(`inventoryPage.esxiMigration.${opt.labelKey}`)}
                            </Typography>
                            <Typography variant="caption" color={disabled ? 'text.disabled' : 'text.secondary'} sx={{ lineHeight: 1.3 }}>
                              {disabled
                                ? t('inventoryPage.esxiMigration.requiresLicensedEsxi')
                                : t(`inventoryPage.esxiMigration.${opt.descKey}`)}
                            </Typography>
                          </Box>
                          <Box sx={{
                            width: 18, height: 18, borderRadius: '50%', border: '2px solid',
                            borderColor: disabled ? 'action.disabled' : migType === opt.value ? `${opt.color}` : 'divider',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            {!disabled && migType === opt.value && (
                              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: `${opt.color}` }} />
                            )}
                          </Box>
                        </Box>
                        )
                      })}
                    </Stack>
                  </Box>

                  <FormControlLabel
                    control={<Switch size="small" checked={migStartAfter} onChange={(_, v) => setMigStartAfter(v)} />}
                    label={<Typography variant="body2">{t('inventoryPage.esxiMigration.startAfterMigration')}</Typography>}
                  />
                </Stack>
              </Box>

              {/* SSH warning */}
              {migTargetConn && (() => {
                const selectedConn = migPveConnections.find((c: any) => c.id === migTargetConn)
                return selectedConn && !selectedConn.sshEnabled ? (
                  <Alert severity="warning" sx={{ fontSize: 12 }} icon={<i className="ri-ssh-line" style={{ fontSize: 18 }} />}>
                    {t('inventoryPage.esxiMigration.sshRequired')}
                  </Alert>
                ) : null
              })()}

              {/* Info banner */}
              <Box sx={{ p: 1.5, borderRadius: 1, bgcolor: theme.palette.mode === 'dark' ? 'rgba(var(--mui-palette-primary-mainChannel) / 0.08)' : 'rgba(var(--mui-palette-primary-mainChannel) / 0.06)', border: '1px solid', borderColor: 'primary.main', borderOpacity: 0.2, display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className="ri-information-line" style={{ fontSize: 18, color: theme.palette.primary.main }} />
                <Typography variant="caption" color="primary">
                  {migType === 'cold' && t('inventoryPage.esxiMigration.coldMigrationInfo')}
                  {migType === 'near-live' && t('inventoryPage.esxiMigration.nearLiveMigrationInfo')}
                  {migType === 'live' && t('inventoryPage.esxiMigration.liveMigrationInfo')}
                </Typography>
              </Box>
            </Stack>
          )}

          {/* Migration in progress / completed / failed */}
          {esxiMigrateVm && migJobId && migJob && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              {/* Migration visual: VMware → Proxmox */}
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, py: 2 }}>
                {/* VMware logo */}
                <Box sx={{
                  width: 56, height: 56, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                  border: '2px solid', borderColor: migJob.status === 'completed' ? 'success.main' : migJob.status === 'failed' ? 'error.main' : 'divider',
                  transition: 'border-color 0.3s',
                }}>
                  <img src={esxiMigrateVm?.hostType === 'xcpng' ? '/images/xcpng-logo.svg' : '/images/esxi-logo.svg'} alt={esxiMigrateVm?.hostType === 'xcpng' ? 'XCP-ng' : 'VMware'} width={28} height={28} style={{ opacity: migJob.status === 'completed' ? 0.4 : 1 }} />
                </Box>

                {/* Animated flow with tooltip */}
                <MuiTooltip
                  arrow
                  placement="top"
                  title={
                    !['completed', 'failed', 'cancelled'].includes(migJob.status) && migJob.transferSpeed
                      ? `${migJob.transferSpeed}${migJob.bytesTransferred ? ` — ${(Number(migJob.bytesTransferred) / 1073741824).toFixed(1)} GB / ${migJob.totalBytes ? (Number(migJob.totalBytes) / 1073741824).toFixed(1) : '?'} GB` : ''}`
                      : migJob.status === 'completed' ? t('inventoryPage.esxiMigration.completed')
                      : migJob.status === 'failed' ? (migJob.error || t('inventoryPage.esxiMigration.failed'))
                      : migJob.currentStep?.replace(/_/g, ' ') || ''
                  }
                >
                <Box sx={{ flex: 1, maxWidth: 180, position: 'relative', height: 20, display: 'flex', alignItems: 'center', cursor: 'default' }}>
                  {/* Track line */}
                  <Box sx={{ position: 'absolute', inset: 0, top: '50%', height: 2, transform: 'translateY(-50%)', bgcolor: 'divider', borderRadius: 1 }} />
                  {/* Animated dots (only when transferring) */}
                  {!['completed', 'failed', 'cancelled'].includes(migJob.status) ? (
                    <>
                      {[0, 1, 2, 3, 4].map(idx => (
                        <Box key={idx} sx={{
                          position: 'absolute', width: 6, height: 6, borderRadius: '50%',
                          bgcolor: 'primary.main',
                          animation: 'migFlow 2s ease-in-out infinite',
                          animationDelay: `${idx * 0.35}s`,
                          opacity: 0,
                          '@keyframes migFlow': {
                            '0%': { left: '0%', opacity: 0, transform: 'scale(0.5)' },
                            '15%': { opacity: 1, transform: 'scale(1)' },
                            '85%': { opacity: 1, transform: 'scale(1)' },
                            '100%': { left: '100%', opacity: 0, transform: 'scale(0.5)' },
                          },
                        }} />
                      ))}
                    </>
                  ) : migJob.status === 'completed' ? (
                    <Box sx={{ position: 'absolute', inset: 0, top: '50%', height: 2, transform: 'translateY(-50%)', bgcolor: 'success.main', borderRadius: 1 }} />
                  ) : migJob.status === 'failed' ? (
                    <Box sx={{
                      position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
                      color: 'error.main', fontSize: 18, lineHeight: 1,
                    }}>
                      <i className="ri-close-circle-fill" />
                    </Box>
                  ) : null}
                </Box>
                </MuiTooltip>

                {/* Proxmox logo */}
                <Box sx={{
                  width: 56, height: 56, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                  border: '2px solid',
                  borderColor: migJob.status === 'completed' ? 'success.main' : migJob.status === 'failed' ? 'error.main' : 'divider',
                  transition: 'border-color 0.3s',
                }}>
                  <img
                    src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'}
                    alt="Proxmox" width={28} height={28}
                    style={{ opacity: migJob.status === 'completed' ? 1 : 0.6, transition: 'opacity 0.3s' }}
                  />
                </Box>
              </Box>

              {/* Status chip */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                {migJob.status === 'completed' && <Chip size="small" label={t('inventoryPage.esxiMigration.completed')} color="success" sx={{ fontWeight: 600 }} />}
                {migJob.status === 'failed' && <Chip size="small" label={t('inventoryPage.esxiMigration.failed')} color="error" sx={{ fontWeight: 600 }} />}
                {migJob.status === 'cancelled' && <Chip size="small" label={t('inventoryPage.esxiMigration.cancelled')} color="warning" sx={{ fontWeight: 600 }} />}
                {!['completed', 'failed', 'cancelled'].includes(migJob.status) && (
                  <Chip size="small" label={migJob.currentStep?.replace(/_/g, ' ') || migJob.status} color="primary" sx={{ fontWeight: 600 }} />
                )}
                {migJob.targetVmid && <Typography variant="caption" color="text.secondary">{t('inventoryPage.esxiMigration.targetVmid')}: {migJob.targetVmid}</Typography>}
              </Box>

              {/* Progress bar */}
              {!['completed', 'failed', 'cancelled'].includes(migJob.status) && (
                <Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="caption" color="text.secondary">{t('inventoryPage.esxiMigration.progress')}</Typography>
                    <Typography variant="caption" fontWeight={700}>{migJob.progress || 0}%</Typography>
                  </Box>
                  <LinearProgress variant="determinate" value={migJob.progress || 0} sx={{ height: 6, borderRadius: 3 }} />
                  {migJob.transferSpeed && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
                      <Typography variant="caption" color="text.secondary">
                        {migJob.bytesTransferred ? `${(Number(migJob.bytesTransferred) / 1073741824).toFixed(1)} GB` : '0 GB'}
                        {migJob.totalBytes ? ` / ${(Number(migJob.totalBytes) / 1073741824).toFixed(1)} GB` : ''}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">{migJob.transferSpeed}</Typography>
                    </Box>
                  )}
                </Box>
              )}

              {/* Error */}
              {migJob.status === 'failed' && migJob.error && (
                <Alert severity="error" sx={{ fontSize: 12 }}>{migJob.error}</Alert>
              )}

              {/* Logs */}
              {migJob.logs?.length > 0 && (
                <Box sx={{ p: 1.5, bgcolor: theme.palette.mode === 'dark' ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.03)', fontFamily: '"JetBrains Mono", monospace', fontSize: 11, maxHeight: 250, overflow: 'auto', borderRadius: 1.5, lineHeight: 1.8 }}>
                  {migJob.logs.map((log: any, i: number) => (
                    <Box key={i}>
                      <Box component="span" sx={{ color: 'text.secondary' }}>[{new Date(log.ts).toLocaleTimeString()}]</Box>{' '}
                      {log.level === 'success' && <Box component="span" sx={{ color: 'success.main' }}>✓ </Box>}
                      {log.level === 'error' && <Box component="span" sx={{ color: 'error.main' }}>✗ </Box>}
                      {log.level === 'warn' && <Box component="span" sx={{ color: 'warning.main' }}>⚠ </Box>}
                      {log.msg}
                    </Box>
                  ))}
                </Box>
              )}
            </Stack>
          )}

          {/* Loading state while starting */}
          {esxiMigrateVm && migStarting && !migJobId && (
            <Box sx={{ py: 4, textAlign: 'center' }}>
              <CircularProgress size={32} />
              <Typography variant="body2" sx={{ mt: 1, opacity: 0.6 }}>{t('inventoryPage.esxiMigration.startingMigration')}</Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          {!migJobId ? (
            <>
              <Button onClick={() => setEsxiMigrateVm(null)} disabled={migStarting}>{t('common.cancel')}</Button>
              <Button
                variant="contained"
                disabled={!migTargetConn || !migTargetNode || !migTargetStorage || migStarting || (migTargetConn && !migPveConnections.find((c: any) => c.id === migTargetConn)?.sshEnabled)}
                sx={{ textTransform: 'none' }}
                startIcon={migStarting ? <CircularProgress size={16} color="inherit" /> : <i className="ri-play-circle-line" />}
                onClick={async () => {
                  if (!esxiMigrateVm) return
                  setMigStarting(true)
                  try {
                    const res = await fetch('/api/v1/migrations', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        sourceConnectionId: esxiMigrateVm.connId,
                        sourceVmId: esxiMigrateVm.vmid,
                        targetConnectionId: migTargetConn,
                        targetNode: migTargetNode,
                        targetStorage: migTargetStorage,
                        networkBridge: migNetworkBridge,
                        migrationType: migType,
                        startAfterMigration: migStartAfter,
                      }),
                    })
                    const d = await res.json()
                    if (d.data?.jobId) {
                      setMigJobId(d.data.jobId)
                    } else {
                      throw new Error(d.error || 'Failed to start migration')
                    }
                  } catch (e: any) {
                    alert(e.message || 'Migration failed to start')
                  } finally {
                    setMigStarting(false)
                  }
                }}
              >
                {t('inventoryPage.esxiMigration.startMigration')}
              </Button>
            </>
          ) : (
            <>
              {migJob && !['completed', 'failed', 'cancelled'].includes(migJob.status) && (
                <Button
                  color="error"
                  onClick={async () => {
                    await fetch(`/api/v1/migrations/${migJobId}/cancel`, { method: 'POST' })
                  }}
                >
                  {t('inventoryPage.esxiMigration.cancelMigration')}
                </Button>
              )}
              {migJob && migJob.status === 'failed' && (
                <Button
                  onClick={async () => {
                    const res = await fetch(`/api/v1/migrations/${migJobId}/retry`, { method: 'POST' })
                    const d = await res.json()
                    if (d.data?.jobId) setMigJobId(d.data.jobId)
                  }}
                >
                  {t('inventoryPage.esxiMigration.retry')}
                </Button>
              )}
              <Button onClick={() => { setEsxiMigrateVm(null); setMigJobId(null); setMigJob(null); setMigType('cold') }}>
                {t('common.close')}
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>

      {/* Enterprise Upgrade Dialog */}
      <Dialog open={upgradeDialogOpen} onClose={() => setUpgradeDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 1, pr: 5 }}>
          <Box sx={{ width: 40, height: 40, borderRadius: 2, bgcolor: 'warning.main', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <i className="ri-lock-line" style={{ fontSize: 20, color: '#fff' }} />
          </Box>
          {t('inventoryPage.esxiMigration.enterpriseRequired')}
          <IconButton onClick={() => setUpgradeDialogOpen(false)} sx={{ position: 'absolute', right: 8, top: 8 }}>
            <i className="ri-close-line" style={{ fontSize: 20 }} />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ opacity: 0.8, mb: 2 }}>
            {t('inventoryPage.esxiMigration.enterpriseRequiredDesc')}
          </Typography>
          <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', gap: 2 }}>
            <Box sx={{ display: 'flex', gap: 1.5 }}>
              <img src={esxiMigrateVm?.hostType === 'xcpng' ? '/images/xcpng-logo.svg' : '/images/esxi-logo.svg'} alt="" width={24} height={24} />
              <i className="ri-arrow-right-line" style={{ fontSize: 20, opacity: 0.4 }} />
              <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={24} height={24} />
            </Box>
            <Box>
              <Typography variant="body2" fontWeight={700}>{esxiMigrateVm?.hostType === 'xcpng' ? 'XCP-ng' : 'VMware'} → Proxmox VE</Typography>
              <Typography variant="caption" sx={{ opacity: 0.6 }}>Enterprise / Enterprise+</Typography>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            variant="contained"
            color="warning"
            startIcon={<i className="ri-vip-crown-line" />}
            onClick={() => { setUpgradeDialogOpen(false); window.open('https://www.proxcenter.io/', '_blank') }}
            sx={{ textTransform: 'none' }}
          >
            {t('inventoryPage.esxiMigration.upgradePlan')}
          </Button>
        </DialogActions>
      </Dialog>

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
              <AccordionSummary expandIcon={<i className="ri-arrow-down-s-line" style={{ fontSize: 20 }} />}>
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

    </Box>
  )
}