'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { isSharedStorage } from '@/lib/proxmox/storage'

import { useProxCenterTasks } from '@/contexts/ProxCenterTasksContext'
import { useHostsByConnection } from '@/hooks/useHosts'
import { BULK_MIG_CONCURRENCY } from './bulkMigrationConfig'
import { useFavorites } from './hooks/useFavorites'
import { useSnapshots } from './hooks/useSnapshots'
import { useTasks } from './hooks/useTasks'
import { useNotes } from './hooks/useNotes'
import { useHA } from './hooks/useHA'
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
  Collapse,
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
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, BarChart, Bar, CartesianGrid, Legend } from 'recharts'

import VmsTable, { VmRow } from '@/components/VmsTable'
import VmFirewallTab from '@/components/VmFirewallTab'
import ClusterFirewallTab from '@/components/ClusterFirewallTab'
import BackupJobsPanel from './BackupJobsPanel'
import RollingUpdateWizard from '@/components/RollingUpdateWizard'
import { useLicense, Features } from '@/contexts/LicenseContext'
import { useToast } from '@/contexts/ToastContext'
import { useTaskTracker } from '@/hooks/useTaskTracker'
import type { Status, InventorySelection, Kpi, KV, UtilMetric, DetailsPayload, RrdTimeframe, SeriesPoint, ActiveDialog } from './types'
import { TAG_PALETTE, hashStringToInt, parseTags, formatBps, formatTime, formatUptime, parseMarkdown, parseNodeId, parseVmId, getMetricIcon, pickNumber, buildSeriesFromRrd, fetchRrd, fetchDetails } from './helpers'
import { useTagColors } from '@/contexts/TagColorContext'
import { getOsSvgIcon } from '@/lib/utils/osIcons'
import RootInventoryView from './RootInventoryView'
import StorageDashboard from './StorageDashboard'
import NetworkDashboard from './NetworkDashboard'
import BackupDashboard from './BackupDashboard'
import MigrationDashboard from './MigrationDashboard'
import { ViewMode, AllVmItem, HostItem, PoolItem, TagItem, NodeIcon, ClusterIcon, StatusIcon } from './InventoryTree'
import NetworkDetailPanel from './components/NetworkDetailPanel'
import TagManager from './components/TagManager'
import EntityTagManager from './components/EntityTagManager'
import VmActions from './components/VmActions'
import NodeActions from './components/NodeActions'
import UsageBar from './components/UsageBar'
import ConsolePreview from './components/ConsolePreview'
import StatusChip from './components/StatusChip'
import { AreaPctChart, AreaBpsChart2 } from './components/RrdCharts'
import GroupedVmsView from './components/GroupedVmsView'
import InventorySummary from './components/InventorySummary'
import StorageIntermediatePanel from './components/StorageIntermediatePanel'
import StorageDetailPanel from './components/StorageDetailPanel'
import ExpandableChart from './components/ExpandableChart'
import StorageContentGroup from './components/StorageContentGroup'
import PbsServerPanel, { type PbsServerPanelHandle } from './components/PbsServerPanel'
import InventoryDialogs from './components/InventoryDialogs'
import ExternalHypervisorDashboard from './components/ExternalHypervisorDashboard'
import { useDetailData } from './hooks/useDetailData'
import { useVmActions } from './hooks/useVmActions'
import { useHardwareHandlers } from './hooks/useHardwareHandlers'
import VmDetailTabs from './tabs/VmDetailTabs'
import ClusterTabs from './tabs/ClusterTabs'
import NodeTabs from './tabs/NodeTabs'
import { UploadDialog } from '@/components/storage/StorageContentBrowser'
import TemplateDownloadDialog from '@/components/storage/TemplateDownloadDialog'

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
  onVmTagsChange,
  clusterStorages = [],
  externalHypervisors = [],
  externalDialogRequest,
  onExternalDialogHandled,
  nodeActionRequest,
  onNodeActionHandled,
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
  onVmTagsChange?: (connId: string, vmid: string, tags: string[]) => void
  clusterStorages?: import('./InventoryTree').TreeClusterStorage[]
  externalHypervisors?: { id: string; name: string; type: string; vms?: { vmid: string; name: string; status: string }[] }[]
  externalDialogRequest?: { type: 'createVm' | 'createLxc'; connId: string; node: string; ts: number } | null
  onExternalDialogHandled?: () => void
  nodeActionRequest?: { action: 'reboot' | 'shutdown'; connId: string; node: string; ts: number } | null
  onNodeActionHandled?: () => void
}) {
  const t = useTranslations()
  const dateLocale = getDateLocale(useLocale())
  const theme = useTheme()
  const detailConnId = selection?.type === 'cluster' ? selection.id : selection?.type === 'node' ? parseNodeId(selection.id).connId : selection?.type === 'vm' ? parseVmId(selection.id).connId : undefined
  const { getColor: getTagColor, loadConnection } = useTagColors(detailConnId)

  // Load PVE tag color overrides for all connections present in allVms
  React.useEffect(() => {
    const connIds = new Set(allVms.map((vm: any) => vm.connId).filter(Boolean))
    connIds.forEach(id => loadConnection(id))
  }, [allVms, loadConnection])
  const { hasFeature, loading: licenseLoading } = useLicense()
  const toast = useToast()
  const { trackTask } = useTaskTracker()
  const { addTask: addPCTask, updateTask: updatePCTask, registerOnRestore, unregisterOnRestore } = useProxCenterTasks()
  const primaryColor = theme.palette.primary.main
  const primaryColorLight = lighten(primaryColor, 0.3)

  // Check license features
  const rollingUpdateAvailable = !licenseLoading && hasFeature(Features.ROLLING_UPDATES)
  const crossClusterMigrationAvailable = !licenseLoading && hasFeature(Features.CROSS_CLUSTER_MIGRATION)
  const cveAvailable = !licenseLoading && hasFeature(Features.CVE_SCANNER)
  const vmwareMigrationAvailable = !licenseLoading && hasFeature(Features.VMWARE_MIGRATION)
  const [upgradeDialogOpen, setUpgradeDialogOpen] = useState(false)

  const {
    data, setData,
    loading, error,
    localTags, setLocalTags,
    refreshing,
    refreshData,
    loadVmTrendsBatch,
  } = useDetailData(selection)

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
  const [numaEnabled, setNumaEnabled] = useState(false)
  const [memory, setMemory] = useState(2048) // en MB
  const [balloon, setBalloon] = useState(0) // en MB
  const [balloonEnabled, setBalloonEnabled] = useState(false)
  const [swap, setSwap] = useState(512) // en MB (LXC only)
  const [savingCpu, setSavingCpu] = useState(false)
  const [savingMemory, setSavingMemory] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const [exitMaintenanceDialogOpen, setExitMaintenanceDialogOpen] = useState(false)
  const [nodeActionDialog, setNodeActionDialog] = useState<{ action: 'reboot' | 'shutdown'; nodeName: string; connId?: string; node?: string } | null>(null)
  const [nodeActionBusy, setNodeActionBusy] = useState(false)
  const [nodeActionStep, setNodeActionStep] = useState<string | null>(null)
  const [nodeActionMigrateTarget, setNodeActionMigrateTarget] = useState('')
  const [nodeActionFailedVms, setNodeActionFailedVms] = useState<{ vmid: string; name: string; connId: string; type: string; node: string; error: string }[]>([])
  const [nodeActionShutdownFailed, setNodeActionShutdownFailed] = useState(false)
  const [nodeActionLocalVms, setNodeActionLocalVms] = useState<Set<string>>(new Set())
  const [nodeActionStorageLoading, setNodeActionStorageLoading] = useState(false)
  const [nodeActionShutdownLocal, setNodeActionShutdownLocal] = useState(false)
  const [esxiMigrateVm, setEsxiMigrateVm] = useState<{ vmid: string; name: string; connId: string; connName: string; cpu?: number; memoryMB?: number; committed?: number; guestOS?: string; licenseFull?: boolean; hostType?: string; diskPaths?: string[]; vcenterDatacenter?: string; vcenterCluster?: string; vcenterHost?: string } | null>(null)
  const [migTargetConn, setMigTargetConn] = useState('')
  const [migTargetNode, setMigTargetNode] = useState('')
  const [migTargetStorage, setMigTargetStorage] = useState('')
  const [migNetworkBridge, setMigNetworkBridge] = useState('')
  const [migBridges, setMigBridges] = useState<any[]>([])
  const [migStartAfter, setMigStartAfter] = useState(false)
  const [migDiskPaths, setMigDiskPaths] = useState('')
  const [migTempStorage, setMigTempStorage] = useState('/tmp')
  const [migType, setMigType] = useState<'cold' | 'live' | 'sshfs_boot'>('cold')
  const [migTransferMode, setMigTransferMode] = useState<'https' | 'sshfs'>('sshfs')
  const [migPveConnections, setMigPveConnections] = useState<any[]>([])
  const [migNodes, setMigNodes] = useState<any[]>([])
  const [migStorages, setMigStorages] = useState<any[]>([])
  const [migSshfsAvailable, setMigSshfsAvailable] = useState<boolean | null>(null) // null = not checked yet
  const [vcenterPreflight, setVcenterPreflight] = useState<{ checked: boolean; ok: boolean; installing: boolean; errors: string[]; virtV2vInstalled: boolean; virtioWinInstalled: boolean; nbdkitInstalled: boolean; nbdcopyInstalled: boolean; detectedDisks: string[]; tempStorages: { path: string; availableBytes: number; totalBytes: number; filesystem: string }[] } | null>(null)
  const [migStarting, setMigStarting] = useState(false)
  const [migJobId, setMigJobId] = useState<string | null>(null)
  const [migJob, setMigJob] = useState<any>(null)
  const [vmMigJob, setVmMigJob] = useState<any>(null) // active migration job for current VM panel
  const migLogsRef = useRef<HTMLDivElement>(null)
  // Bulk migration state
  const [bulkMigSelected, setBulkMigSelected] = useState<Set<string>>(new Set())
  const [bulkMigOpen, setBulkMigOpen] = useState(false)
  const [bulkMigStarting, setBulkMigStarting] = useState(false)
  // Shared with InventoryDialogs.tsx — see bulkMigrationConfig.ts. Used here
  // by the queued-job poller below to decide how many slots are free; must
  // match the dispatcher in InventoryDialogs.tsx or the two will fight each
  // other (dispatcher starts N, poller immediately starts more on top).
  const [bulkMigJobs, setBulkMigJobs] = useState<{ vmid: string; name: string; jobId: string; status: string; progress: number; error?: string; logs?: { ts: string; msg: string; level: string }[]; targetNode?: string; vcenterDatacenter?: string; vcenterCluster?: string; vcenterHost?: string }[]>([])
  const [bulkMigProgressExpanded, setBulkMigProgressExpanded] = useState(true)
  const [bulkMigLogsExpanded, setBulkMigLogsExpanded] = useState(false)
  const [bulkMigLogsFilter, setBulkMigLogsFilter] = useState<string | null>(null)
  const bulkMigJobsRef = useRef(bulkMigJobs)
  bulkMigJobsRef.current = bulkMigJobs
  const bulkMigConfigRef = useRef<{ sourceConnectionId: string; targetConnectionId: string; targetStorage: string; networkBridge: string; migrationType: string; transferMode: string; startAfterMigration: boolean; sourceType: string } | null>(null)
  // Snapshot of host info when bulk dialog opens (avoids null data when selection changes)
  const [bulkMigHostInfo, setBulkMigHostInfo] = useState<any>(null)
  const [extHostMigrations, setExtHostMigrations] = useState<any[]>([])
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
  const addOtherHardwareDialogOpen = activeDialog === 'addOtherHardware'
  const setAddOtherHardwareDialogOpen = useCallback((v: boolean) => setActiveDialog(v ? 'addOtherHardware' : 'none'), [])
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

  const lastNodeActionTs = useRef(0)
  useEffect(() => {
    if (nodeActionRequest && nodeActionRequest.ts !== lastNodeActionTs.current) {
      lastNodeActionTs.current = nodeActionRequest.ts
      setNodeActionMigrateTarget('')
      setNodeActionFailedVms([])
      setNodeActionShutdownFailed(false)
      setNodeActionDialog({ action: nodeActionRequest.action, nodeName: nodeActionRequest.node, connId: nodeActionRequest.connId, node: nodeActionRequest.node })
      onNodeActionHandled?.()
    }
  }, [nodeActionRequest, onNodeActionHandled])

  // Check which running VMs are on local storage when node action dialog opens
  const emptySet = useMemo(() => new Set<string>(), [])
  useEffect(() => {
    if (!nodeActionDialog) return
    const connId = nodeActionDialog.connId || ''
    const nodeName = nodeActionDialog.node || ''
    if (!connId || !nodeName) return

    // Only for cluster nodes
    const hasOtherNodes = hosts.filter(h => h.connId === connId && h.node !== nodeName).length > 0
    if (!hasOtherNodes) return

    const runningVms = allVms.filter(vm =>
      vm.connId === connId && vm.node === nodeName && vm.status === 'running' && !vm.template
    )
    if (runningVms.length === 0) return

    // Build shared storage set from clusterStorages
    const cs = clusterStorages.find(c => c.connId === connId)
    const sharedSet = new Set<string>()
    if (cs) {
      for (const s of cs.sharedStorages) sharedSet.add(s.storage)
      for (const n of cs.nodes) {
        for (const s of n.storages) {
          if (isSharedStorage(s)) sharedSet.add(s.storage)
        }
      }
    }

    let alive = true
    setNodeActionStorageLoading(true)

    ;(async () => {
      const localKeys = new Set<string>()
      const batchSize = 5
      for (let i = 0; i < runningVms.length; i += batchSize) {
        const batch = runningVms.slice(i, i + batchSize)
        await Promise.all(batch.map(async (vm) => {
          try {
            const res = await fetch(`/api/v1/connections/${encodeURIComponent(vm.connId)}/guests/${vm.type}/${encodeURIComponent(vm.node)}/${encodeURIComponent(vm.vmid)}/config`)
            if (!res.ok) return
            const json = await res.json()
            const config = json.data || {}
            for (const [key, val] of Object.entries(config)) {
              if (/^(scsi|virtio|ide|sata|efidisk)\d+$/.test(key) && typeof val === 'string' && !val.includes('media=cdrom') && val !== 'none') {
                const storageName = val.split(':')[0]
                if (storageName && storageName !== 'none' && !sharedSet.has(storageName)) {
                  localKeys.add(`${vm.connId}:${vm.vmid}`)
                  break
                }
              }
            }
          } catch { /* ignore */ }
        }))
      }
      if (!alive) return
      setNodeActionLocalVms(localKeys)
      setNodeActionStorageLoading(false)
    })()

    return () => { alive = false }
  }, [nodeActionDialog?.connId, nodeActionDialog?.node, nodeActionDialog?.action])

  // Merge createDefaults with external overrides
  const effectiveCreateDefaults = useMemo(() => {
    if (externalCreateDefaults.connId) return externalCreateDefaults
    return createDefaults
  }, [createDefaults, externalCreateDefaults])

  // Clear external defaults when dialog closes
  useEffect(() => {
    if (activeDialog === 'none') setExternalCreateDefaults({})
  }, [activeDialog])

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

  // VM action handlers extracted into a custom hook
  const {
    tableMigrateVm, setTableMigrateVm,
    tableCloneVm, setTableCloneVm,
    bulkActionDialog, setBulkActionDialog,
    creationPending, setCreationPending,
    highlightedVmId, setHighlightedVmId,
    handleVmCreated, handleLxcCreated,
    handleMigrateVm, handleCrossClusterMigrate, handleCloneVm,
    handleTableMigrate, handleTableMigrateVm, handleTableCrossClusterMigrate, handleTableCloneVm,
    handleNodeBulkAction, handleHostBulkAction, executeBulkAction,
    handleVmAction, handleTableVmAction,
    onStart, onShutdown, onStop, onPause,
  } = useVmActions({
    selection,
    onSelect,
    onRefresh,
    toast,
    t,
    trackTask,
    data,
    setData,
    setLocalTags,
    allVms,
    onVmActionStart,
    onVmActionEnd,
    onOptimisticVmStatus,
    setConfirmAction,
    setConfirmActionLoading,
    setActionBusy,
  })

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
    type: 'text' | 'boolean' | 'select' | 'hotplug';
    options?: { value: string; label: string }[];
  } | null>(null)

  const [editOptionValue, setEditOptionValue] = useState<any>('')
  const [editOptionSaving, setEditOptionSaving] = useState(false)
  
  // PBS storage backup panel states (search/pagination for storage view)
  const [pbsStorageSearch, setPbsStorageSearch] = useState('')
  const [pbsStoragePage, setPbsStoragePage] = useState(0)
  const [pbsStorageSort, setPbsStorageSort] = useState<{ col: string; dir: 'asc' | 'desc' }>({ col: 'ctime', dir: 'desc' })
  const [expandedStorageBackupGroups, setExpandedStorageBackupGroups] = useState<Set<string>>(new Set())
  // Ref to PbsServerPanel for calling restore/file-restore from storage panel
  const pbsPanelRef = React.useRef<PbsServerPanelHandle>(null)
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

  const { favorites, toggleFavorite } = useFavorites({ propFavorites, propToggleFavorite })

  // Fetch PVE connections + all their nodes when migration dialog opens
  // Builds a flat list of { connId, connName, isCluster, node, status, ip } for the unified selector
  const [migNodeOptions, setMigNodeOptions] = useState<any[]>([])
  useEffect(() => {
    if (!esxiMigrateVm && !bulkMigOpen) return
    setMigTargetConn(''); setMigTargetNode(''); setMigTargetStorage('')
    setMigNodes([]); setMigStorages([]); setMigNodeOptions([])
    if (esxiMigrateVm) { setMigJobId(null); setMigJob(null) }
    fetch('/api/v1/connections').then(r => r.json()).then(async (d) => {
      const pveConns = (d.data || d || []).filter((c: any) => c.type === 'pve')
      setMigPveConnections(pveConns)
      // Fetch nodes for each connection in parallel
      const allOptions: any[] = []
      await Promise.all(pveConns.map(async (conn: any) => {
        try {
          const res = await fetch(`/api/v1/connections/${conn.id}/nodes`)
          const nd = await res.json()
          const nodes = nd.data || nd || []
          const isCluster = (conn.hosts?.length || nodes.length) > 1
          for (const n of nodes) {
            allOptions.push({
              connId: conn.id,
              connName: conn.name,
              isCluster,
              sshEnabled: conn.sshEnabled,
              node: n.node || n.name || n,
              status: n.status,
              ip: n.ip,
            })
          }
        } catch {}
      }))
      setMigNodeOptions(allOptions)
      // Auto-select if only one node across all connections
      if (allOptions.length === 1) {
        setMigTargetConn(allOptions[0].connId)
        setMigTargetNode(allOptions[0].node)
        setMigNodes([allOptions[0]])
      }
    }).catch(() => {})
  }, [esxiMigrateVm, bulkMigOpen])

  // Fetch storages, bridges, and check sshfs when node is selected
  useEffect(() => {
    if (!migTargetConn || !migTargetNode) { setMigStorages([]); setMigTargetStorage(''); setMigBridges([]); setMigNetworkBridge(''); setMigSshfsAvailable(null); return }
    const connNodes = migNodeOptions.filter((o: any) => o.connId === migTargetConn)
    const fetchNode = migTargetNode === '__auto__' ? (connNodes[0]?.node || migTargetNode) : migTargetNode
    if (!fetchNode || fetchNode === '__auto__') return
    // Check sshfs availability on target node
    setMigSshfsAvailable(null)
    setVcenterPreflight(null)
    fetch(`/api/v1/connections/${migTargetConn}/nodes/${fetchNode}/check-sshfs`).then(r => r.json()).then(d => {
      setMigSshfsAvailable(d.data?.installed ?? false)
    }).catch(() => setMigSshfsAvailable(false))
    // Run the virt-v2v preflight across the relevant node(s) for the migration
    // target. In Auto mode, the batch may land on ANY node of the cluster, so we
    // must check deps on EVERY online node; if any single node is missing a tool,
    // some VMs in the batch would silently fail after a multi-GB NFC download.
    // We aggregate with AND semantics: a dep is shown as "installed" only when
    // all targeted nodes have it; the Install button then pushes apt-get to all
    // nodes in parallel.
    const nodesToCheck = migTargetNode === '__auto__'
      ? migNodeOptions.filter((o: any) => o.connId === migTargetConn && o.status === 'online').map((o: any) => o.node)
      : [migTargetNode]
    if (nodesToCheck.length === 0) {
      setVcenterPreflight({ checked: true, ok: false, installing: false, errors: ['No online nodes in the selected cluster'], virtV2vInstalled: false, virtioWinInstalled: false, nbdkitInstalled: false, nbdcopyInstalled: false, detectedDisks: [], tempStorages: [] })
      return
    }
    Promise.all(nodesToCheck.map(async (node: string) => {
      try {
        const r = await fetch('/api/v1/migrations/preflight', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetConnectionId: migTargetConn, targetNode: node, vmName: esxiMigrateVm?.name, sourceType: esxiMigrateVm?.hostType }),
        })
        const d = await r.json()
        return { node, ...d }
      } catch {
        return { node, _error: true }
      }
    })).then((results: any[]) => {
      const anyError = results.some(r => r._error)
      const allVirtV2v = results.every(r => !!r.virtV2vInstalled)
      const allNbdkit = results.every(r => !!r.nbdkitInstalled)
      const allNbdcopy = results.every(r => !!r.nbdcopyInstalled)
      const allVirtioWin = results.every(r => !!r.virtioWinInstalled)
      // tempStorages: when targeting multiple nodes we take the INTERSECTION by
      // path (a temp dir is only useful if it exists on every node the batch
      // may land on — otherwise some jobs would fail at the SSHFS/mkdir step).
      // Single-node mode simply takes the one node's list.
      let aggregatedTempStorages: any[] = []
      if (results.length === 1) {
        aggregatedTempStorages = results[0].tempStorages || []
      } else {
        const pathCount = new Map<string, { count: number; sample: any }>()
        for (const r of results) {
          for (const ts of (r.tempStorages || [])) {
            const existing = pathCount.get(ts.path)
            if (existing) {
              existing.count++
              // Keep the smallest availableBytes across nodes (pessimistic
              // estimate — the batch can only rely on space that every node has).
              if (ts.availableBytes < existing.sample.availableBytes) existing.sample = ts
            } else {
              pathCount.set(ts.path, { count: 1, sample: ts })
            }
          }
        }
        aggregatedTempStorages = [...pathCount.values()]
          .filter(v => v.count === results.length)
          .map(v => v.sample)
          .sort((a, b) => b.availableBytes - a.availableBytes)
      }
      // Union of errors across nodes, prefixed with the node name so the user
      // can tell which node is the blocker.
      const allErrors: string[] = []
      for (const r of results) {
        for (const err of (r.errors || [])) {
          allErrors.push(results.length > 1 ? `[${r.node}] ${err}` : err)
        }
      }
      // detectedDisks: only honour when single-node; in bulk auto we don't want
      // to auto-populate a disk path based on one specific node's /mnt/hyperv view.
      const detectedDisks = results.length === 1 ? (results[0].detectedDisks || []) : []
      setVcenterPreflight({
        checked: true,
        ok: !anyError && allErrors.length === 0,
        installing: false,
        errors: anyError ? ['Preflight check failed on one or more nodes'] : allErrors,
        virtV2vInstalled: allVirtV2v,
        virtioWinInstalled: allVirtioWin,
        nbdkitInstalled: allNbdkit,
        nbdcopyInstalled: allNbdcopy,
        detectedDisks,
        tempStorages: aggregatedTempStorages,
      })
      if (detectedDisks.length > 0) {
        setMigDiskPaths(detectedDisks.join('\n'))
      }
    }).catch(() => setVcenterPreflight({ checked: true, ok: false, installing: false, errors: ['Preflight check failed'], virtV2vInstalled: false, virtioWinInstalled: false, nbdkitInstalled: false, nbdcopyInstalled: false, detectedDisks: [], tempStorages: [] }))
    fetch(`/api/v1/connections/${migTargetConn}/nodes/${fetchNode}/storages?content=images`).then(r => r.json()).then(d => {
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
    fetch(`/api/v1/connections/${migTargetConn}/nodes/${fetchNode}/network`).then(r => r.json()).then(d => {
      const bridges = (d.data || d || []).filter((iface: any) => iface.type === 'bridge' || iface.type === 'OVSBridge')
      setMigBridges(bridges)
      if (bridges.length > 0) {
        const vmbr0 = bridges.find((b: any) => b.iface === 'vmbr0')
        setMigNetworkBridge(vmbr0 ? 'vmbr0' : bridges[0].iface)
      }
    }).catch(() => {})
  }, [migTargetConn, migTargetNode, migNodeOptions.length])

  // Cleanup TasksBar restore callback on unmount
  useEffect(() => {
    if (!migJobId) return
    const taskId = `migration-${migJobId}`
    return () => { unregisterOnRestore(taskId) }
  }, [migJobId, unregisterOnRestore])

  // Refs to avoid stale closures in polling interval
  const updatePCTaskRef = useRef(updatePCTask)
  updatePCTaskRef.current = updatePCTask

  // Poll migration job status + sync to TasksBar.
  // Prefer j.currentStep when available — processV2vOutput updates it with
  // the live virt-v2v phase name ("Inspecting the source", "Copying disk 1/2",
  // etc.) which is far more descriptive than the pipeline-level j.status
  // ("transferring"). The status-based fallback is kept for non-virt-v2v steps
  // and for the brief moment before the first virt-v2v event arrives.
  useEffect(() => {
    if (!migJobId) return
    const taskId = `migration-${migJobId}`
    const interval = setInterval(() => {
      fetch(`/api/v1/migrations/${migJobId}`).then(r => r.json()).then(d => {
        setMigJob(d.data)
        if (d.data) {
          const j = d.data
          const speed = j.transferSpeed ? ` — ${j.transferSpeed}` : ''
          const stepFallback = j.status === 'transferring' ? `Transferring${speed}`
            : j.status === 'configuring' ? 'Configuring'
            : j.status === 'creating_vm' ? 'Creating VM'
            : j.status === 'preflight' ? 'Pre-flight checks'
            : j.status === 'completed' ? 'Completed'
            : j.status === 'failed' ? (j.error || 'Failed')
            : j.status === 'cancelled' ? 'Cancelled'
            : j.status
          updatePCTaskRef.current(taskId, {
            progress: j.progress || 0,
            detail: j.currentStep || stepFallback,
            status: j.status === 'completed' ? 'done' : j.status === 'failed' || j.status === 'cancelled' ? 'error' : 'running',
            ...(j.status === 'failed' ? { error: j.error } : {}),
          })
        }
        if (d.data?.status === 'completed' || d.data?.status === 'failed' || d.data?.status === 'cancelled') {
          clearInterval(interval)
        }
      }).catch(() => {})
    }, 3000)
    return () => clearInterval(interval)
  }, [migJobId])

  // Fetch active migration job for the currently selected ESXi VM
  // Poll bulk migration jobs
  useEffect(() => {
    if (bulkMigJobs.length === 0) return
    const hasWork = bulkMigJobs.some(j => j.status === 'queued' || (j.jobId && !['completed', 'failed', 'cancelled'].includes(j.status)))
    if (!hasWork) return
    const interval = setInterval(async () => {
      const updates = [...bulkMigJobsRef.current]
      let changed = false

      // Poll active (running) jobs
      for (const job of updates) {
        if (!job.jobId || ['completed', 'failed', 'cancelled', 'queued'].includes(job.status)) continue
        try {
          const res = await fetch(`/api/v1/migrations/${job.jobId}`)
          const d = await res.json()
          if (d.data) {
            const j = d.data
            const logsChanged = (j.logs?.length || 0) !== (job.logs?.length || 0)
            if (j.progress !== job.progress || j.status !== job.status || logsChanged) {
              job.progress = j.progress || 0
              job.status = j.status
              job.error = j.error
              if (j.logs) job.logs = j.logs
              changed = true
              // Sync to PCTask — prefer j.currentStep (live virt-v2v phase)
              const speed = j.transferSpeed ? ` — ${j.transferSpeed}` : ''
              const stepFallback = j.status === 'transferring' ? `Transferring${speed}` : j.status === 'completed' ? 'Completed' : j.status === 'failed' ? (j.error || 'Failed') : j.status
              updatePCTaskRef.current(`migration-${job.jobId}`, {
                progress: j.progress || 0,
                detail: j.currentStep || stepFallback,
                status: j.status === 'completed' ? 'done' : j.status === 'failed' || j.status === 'cancelled' ? 'error' : 'running',
                ...(j.status === 'failed' ? { error: j.error } : {}),
              })
            }
          }
        } catch {}
      }

      // Start queued jobs if slots are available
      const cfg = bulkMigConfigRef.current
      if (cfg) {
        const runningCount = updates.filter(j => j.jobId && !['completed', 'failed', 'cancelled', 'queued'].includes(j.status)).length
        const slotsAvailable = BULK_MIG_CONCURRENCY - runningCount
        if (slotsAvailable > 0) {
          const queued = updates.filter(j => j.status === 'queued')
          for (let i = 0; i < Math.min(slotsAvailable, queued.length); i++) {
            const job = queued[i]
            try {
              const res = await fetch('/api/v1/migrations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  sourceConnectionId: cfg.sourceConnectionId,
                  sourceVmId: job.vmid,
                  sourceVmName: job.name,
                  targetConnectionId: cfg.targetConnectionId,
                  targetNode: job.targetNode,
                  targetStorage: cfg.targetStorage,
                  networkBridge: cfg.networkBridge,
                  migrationType: cfg.migrationType,
                  transferMode: cfg.transferMode,
                  startAfterMigration: cfg.startAfterMigration,
                  // vCenter inventory path was captured per-VM when the bulk job was
                  // enqueued (see InventoryDialogs.tsx bulk-launch handler). Forward it
                  // here too, otherwise queued vCenter migrations would lose the path
                  // and the v2v pipeline would throw "vcenterDatacenter required".
                  ...((job as any).vcenterDatacenter && { vcenterDatacenter: (job as any).vcenterDatacenter }),
                  ...((job as any).vcenterCluster && { vcenterCluster: (job as any).vcenterCluster }),
                  ...((job as any).vcenterHost && { vcenterHost: (job as any).vcenterHost }),
                }),
              })
              const d = await res.json()
              if (d.data?.jobId) {
                job.jobId = d.data.jobId
                job.status = 'pending'
                changed = true
                addPCTask({
                  id: `migration-${d.data.jobId}`,
                  type: 'generic',
                  label: `${t('inventoryPage.esxiMigration.migrating')} ${job.name} (${cfg.sourceType} → Proxmox)`,
                  detail: t('inventoryPage.esxiMigration.preflight'),
                  progress: 0,
                  status: 'running',
                  createdAt: Date.now(),
                })
              } else {
                job.status = 'failed'
                job.error = d.error || 'Failed to start'
                changed = true
              }
            } catch (e: any) {
              job.status = 'failed'
              job.error = e.message
              changed = true
            }
          }
        }
      }

      if (changed) setBulkMigJobs([...updates])
      // Stop polling only when no active or queued jobs remain
      if (updates.every(j => j.status !== 'queued' && (!j.jobId || ['completed', 'failed', 'cancelled'].includes(j.status)))) {
        clearInterval(interval)
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [bulkMigJobs.length > 0 ? bulkMigJobs.map(j => `${j.jobId}:${j.status}`).join(',') : ''])

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

  // Fetch migration history for external host dashboard
  useEffect(() => {
    if (selection?.type !== 'ext') { setExtHostMigrations([]); return }
    const connId = selection.id
    fetch('/api/v1/migrations').then(r => r.json()).then(d => {
      const jobs = (d.data || []).filter((j: any) => j.sourceConnectionId === connId)
      setExtHostMigrations(jobs)
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

  // Auto-scroll migration logs to bottom
  useEffect(() => {
    if (migLogsRef.current) {
      migLogsRef.current.scrollTop = migLogsRef.current.scrollHeight
    }
  }, [vmMigJob?.logs?.length])

  // VMs sans templates (pour affichage dans les modes vms, tree, hosts, pools, tags)
  const displayVms = useMemo(() => allVms.filter(vm => !vm.template), [allVms])

  // Mapping vmid → name pour affichage dans storage content
  const vmNamesMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const vm of allVms) {
      if (vm.name) map[String(vm.vmid)] = vm.name
    }
    return map
  }, [allVms])

  // ==================== HARDWARE HANDLERS (extracted to useHardwareHandlers) ====================
  const {
    // Disk handlers
    handleSaveDisk,
    handleSaveNetwork,
    handleSaveScsiController,
    handleEditDisk,
    handleDeleteDisk,
    handleResizeDisk,
    handleMoveDisk,
    handleDeleteNetwork,

    // Tabs
    detailTab, setDetailTab,
    clusterTab, setClusterTab,

    // Replication VM
    replicationJobs, setReplicationJobs,
    replicationLoading, setReplicationLoading,
    replicationLoaded, setReplicationLoaded,
    addReplicationDialogOpen, setAddReplicationDialogOpen,
    replicationTargetNode, setReplicationTargetNode,
    replicationSchedule, setReplicationSchedule,
    replicationRateLimit, setReplicationRateLimit,
    replicationComment, setReplicationComment,
    availableTargetNodes, setAvailableTargetNodes,
    savingReplication, setSavingReplication,
    deleteReplicationId, setDeleteReplicationId,

    // Replication Ceph
    sourceCephAvailable, setSourceCephAvailable,
    cephClusters, setCephClusters,
    cephClustersLoading, setCephClustersLoading,
    addCephReplicationDialogOpen, setAddCephReplicationDialogOpen,
    selectedCephCluster, setSelectedCephCluster,
    cephReplicationSchedule, setCephReplicationSchedule,
    cephReplicationJobs, setCephReplicationJobs,
    expandedClusterNodes, setExpandedClusterNodes,
    pbsTab, setPbsTab,
    pbsBackupSearch, setPbsBackupSearch,
    pbsBackupPage, setPbsBackupPage,
    pbsTimeframe, setPbsTimeframe,
    pbsRrdData, setPbsRrdData,
    datastoreRrdData, setDatastoreRrdData,
    expandedBackupGroups, setExpandedBackupGroups,
    backups, setBackups,
    backupsLoading, setBackupsLoading,
    backupsError, setBackupsError,
    backupsStats, setBackupsStats,
    backupsWarnings, setBackupsWarnings,
    backupsPreloaded, setBackupsPreloaded,
    backupsLoadedForIdRef,
    selectedBackup, setSelectedBackup,

    // Node tabs
    nodeTab, setNodeTab,
    nodeDisksSubTab, setNodeDisksSubTab,
    subscriptionKeyDialogOpen, setSubscriptionKeyDialogOpen,
    subscriptionKeyInput, setSubscriptionKeyInput,
    subscriptionKeySaving, setSubscriptionKeySaving,
    removeSubscriptionDialogOpen, setRemoveSubscriptionDialogOpen,
    removeSubscriptionLoading, setRemoveSubscriptionLoading,
    systemReportDialogOpen, setSystemReportDialogOpen,
    systemReportData, setSystemReportData,
    systemReportLoading, setSystemReportLoading,

    // Replication dialog
    replicationDialogOpen, setReplicationDialogOpen,
    replicationDialogMode, setReplicationDialogMode,
    editingReplicationJob, setEditingReplicationJob,
    replicationSaving, setReplicationSaving,
    deleteReplicationDialogOpen, setDeleteReplicationDialogOpen,
    deletingReplicationJob, setDeletingReplicationJob,
    replicationDeleting, setReplicationDeleting,
    replicationLogDialogOpen, setReplicationLogDialogOpen,
    replicationLogData, setReplicationLogData,
    replicationLogLoading, setReplicationLogLoading,
    replicationLogJob, setReplicationLogJob,
    replicationFormData, setReplicationFormData,

    // Node system
    nodeSystemSubTab, setNodeSystemSubTab,
    nodeSyslogLive, setNodeSyslogLive,
    editDnsDialogOpen, setEditDnsDialogOpen,
    editHostsDialogOpen, setEditHostsDialogOpen,
    editTimeDialogOpen, setEditTimeDialogOpen,
    systemSaving, setSystemSaving,
    dnsFormData, setDnsFormData,
    hostsFormData, setHostsFormData,
    timeFormData, setTimeFormData,
    timezonesList, setTimezonesList,

    // Node notes
    nodeNotesEditing, setNodeNotesEditing,
    nodeNotesEditValue, setNodeNotesEditValue,
    nodeNotesSaving, setNodeNotesSaving,

    // Node Ceph
    nodeCephSubTab, setNodeCephSubTab,
    nodeCephLogLive, setNodeCephLogLive,

    // Backup jobs
    backupJobs, setBackupJobs,
    backupJobsStorages, setBackupJobsStorages,
    backupJobsNodes, setBackupJobsNodes,
    backupJobsVms, setBackupJobsVms,
    backupJobsLoading, setBackupJobsLoading,
    backupJobsLoaded, setBackupJobsLoaded,
    backupJobsError, setBackupJobsError,
    backupJobDialogOpen, setBackupJobDialogOpen,
    backupJobDialogMode, setBackupJobDialogMode,
    editingBackupJob, setEditingBackupJob,
    backupJobSaving, setBackupJobSaving,
    deleteBackupJobDialog, setDeleteBackupJobDialog,
    backupJobDeleting, setBackupJobDeleting,
    backupJobFormData, setBackupJobFormData,

    // Cluster HA
    clusterHaResources, setClusterHaResources,
    clusterHaGroups, setClusterHaGroups,
    clusterHaRules, setClusterHaRules,
    clusterHaStatus,
    clusterPveMajorVersion, setClusterPveMajorVersion,
    clusterPveVersion, setClusterPveVersion,
    clusterHaLoading, setClusterHaLoading,
    clusterHaLoaded, setClusterHaLoaded,
    haGroupDialogOpen, setHaGroupDialogOpen,
    editingHaGroup, setEditingHaGroup,
    deleteHaGroupDialog, setDeleteHaGroupDialog,
    haRuleDialogOpen, setHaRuleDialogOpen,
    editingHaRule, setEditingHaRule,
    deleteHaRuleDialog, setDeleteHaRuleDialog,
    haRuleType, setHaRuleType,

    // Cluster config
    clusterConfig, setClusterConfig,
    clusterConfigLoading, setClusterConfigLoading,
    clusterConfigLoaded, setClusterConfigLoaded,
    createClusterDialogOpen, setCreateClusterDialogOpen,
    joinClusterDialogOpen, setJoinClusterDialogOpen,
    joinInfoDialogOpen, setJoinInfoDialogOpen,
    clusterActionLoading, setClusterActionLoading,
    clusterActionError, setClusterActionError,
    newClusterName, setNewClusterName,
    newClusterLinks, setNewClusterLinks,
    joinClusterInfo, setJoinClusterInfo,
    joinClusterPassword, setJoinClusterPassword,

    // Cluster notes
    clusterNotesContent, setClusterNotesContent,
    clusterNotesLoading, setClusterNotesLoading,
    clusterNotesEditMode, setClusterNotesEditMode,
    clusterNotesSaving, setClusterNotesSaving,
    clusterNotesLoaded, setClusterNotesLoaded,

    // Ceph
    clusterCephData, setClusterCephData,
    clusterCephLoading, setClusterCephLoading,
    clusterCephLoaded, setClusterCephLoaded,
    clusterCephTimeframe, setClusterCephTimeframe,

    // Ceph perf
    storageCephPerf, setStorageCephPerf,
    storageCephPerfHistory, setStorageCephPerfHistory,

    // Storage RRD
    storageRrdHistory, setStorageRrdHistory,
    storageRrdTimeframe, setStorageRrdTimeframe,

    // Cluster storage
    clusterStorageData, setClusterStorageData,
    clusterStorageLoading, setClusterStorageLoading,
    clusterStorageLoaded, setClusterStorageLoaded,

    // Cluster firewall
    clusterFirewallLoaded, setClusterFirewallLoaded,

    // Rolling update
    nodeUpdates, setNodeUpdates,
    nodeLocalVms, setNodeLocalVms,
    updatesDialogOpen, setUpdatesDialogOpen,
    updatesDialogNode, setUpdatesDialogNode,
    localVmsDialogOpen, setLocalVmsDialogOpen,
    localVmsDialogNode, setLocalVmsDialogNode,
    rollingUpdateWizardOpen, setRollingUpdateWizardOpen,

    // Guest info
    guestInfo, setGuestInfo,
    guestInfoLoading, setGuestInfoLoading,

    // File explorer
    explorerLoading, setExplorerLoading,
    explorerError, setExplorerError,
    explorerFiles, setExplorerFiles,
    explorerArchive, setExplorerArchive,
    explorerPath, setExplorerPath,
    explorerArchives, setExplorerArchives,
    pveStorages, setPveStorages,
    compatibleStorages, setCompatibleStorages,
    selectedPveStorage, setSelectedPveStorage,
    explorerMode, setExplorerMode,
    explorerSearch, setExplorerSearch,
    filteredExplorerFiles,

    // Node data (from useNodeData)
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

    // Ceph perf (from useCephPerf)
    clusterCephPerf, clusterCephPerfFiltered, cephTrends,

    // Load handlers
    loadBackups,
    loadClusterHa,
    loadClusterConfig,
    loadClusterNotes,
    handleSaveClusterNotes,
    loadClusterCeph,
    loadClusterStorage,
    handleCreateCluster,
    handleJoinCluster,
    loadBackupJobs,
    loadBackupJobsVms,
    handleCreateBackupJob,
    handleEditBackupJob,
    handleSaveBackupJob,
    handleDeleteBackupJob,
    loadPveStorages,
    findAllCompatibleStorages,
    exploreWithPveStorage,
    loadBackupContentViaPbs,
    loadBackupContent,
    browseArchive,
    navigateToFolder,
    navigateUp,
    navigateToBreadcrumb,
    backToBackupsList,
    backToArchives,
    downloadFile,
  } = useHardwareHandlers({
    selection,
    data,
    setData,
    t,
    selectedDisk,
    setSelectedDisk,
    selectedNetwork,
    setSelectedNetwork,
    activeDialog,
    setActiveDialog,
  })

  // ==================== SNAPSHOTS ====================
  const {
    snapshots, snapshotsLoading, snapshotsError, snapshotsLoaded,
    snapshotActionBusy, showCreateSnapshot, setShowCreateSnapshot,
    newSnapshotName, setNewSnapshotName, newSnapshotDesc, setNewSnapshotDesc,
    newSnapshotRam, setNewSnapshotRam, snapshotFeatureAvailable,
    loadSnapshots, createSnapshot, deleteSnapshot, rollbackSnapshot,
    resetSnapshots,
  } = useSnapshots({ selection, detailTab, t, toast, data, setConfirmAction, setConfirmActionLoading })

  // ==================== TASKS (Historique des tâches) ====================
  const {
    tasks, tasksLoading, tasksError, tasksLoaded,
    loadTasks, setTasksLoaded, resetTasks,
  } = useTasks({ selection, detailTab, t })

  // ==================== NOTES ====================
  const {
    vmNotes, setVmNotes, notesLoading, notesSaving, notesError,
    notesEditing, setNotesEditing, loadNotes, saveNotes, resetNotes,
  } = useNotes({ selection, detailTab, t })

  // ==================== HIGH AVAILABILITY (HA) ====================
  const {
    haConfig, haGroups, haLoading, haSaving, haError, haLoaded, haEditing,
    setHaEditing, haState, setHaState, haGroup, setHaGroup,
    haMaxRestart, setHaMaxRestart, haMaxRelocate, setHaMaxRelocate,
    haComment, setHaComment, loadHaConfig, saveHaConfig, removeHaConfig, resetHA,
  } = useHA({ selection, detailTab, t, data, setConfirmAction, setConfirmActionLoading })

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


  // Entity tags (cluster/node) - stored in ProxCenter DB
  const [entityTags, setEntityTags] = useState<string[]>([])
  const [headerCollapsed, setHeaderCollapsed] = useState(false)

  // Hosts data via shared SWR (dedup with NodeTabs)
  const nodeConnId = selection?.type === 'node' ? parseNodeId(selection.id).connId : null
  const { data: hostsData } = useHostsByConnection(nodeConnId)

  useEffect(() => {
    setEntityTags([])
    if (!selection) return
    if (selection.type === 'cluster') {
      fetch(`/api/v1/connections/${encodeURIComponent(selection.id)}`)
        .then(r => r.ok ? r.json() : null)
        .then(json => {
          const tags = json?.data?.tags
          setEntityTags(tags ? String(tags).split(';').filter(Boolean) : [])
        })
        .catch(() => {})
    } else if (selection.type === 'node') {
      const { node } = parseNodeId(selection.id)
      const hosts = hostsData?.data?.hosts || []
      const host = hosts.find((h: any) => h.node === node)
      const tags = host?.managedHost?.tags || host?.tags
      setEntityTags(tags ? String(tags).split(';').filter(Boolean) : [])
    }
  }, [selection?.id, selection?.type, hostsData])

  // Reset non-data states when selection changes (data/loading/error/localTags are reset by useDetailData)
  useEffect(() => {
    setSeries([])
    setRrdError(null)
    setExpandedVmsTable(false)  // Réinitialiser le mode expanded

    // Réinitialiser les états spécifiques aux VMs
    resetTasks()
    resetSnapshots()
    resetNotes()
    setBackups([])
    setBackupsStats(null)
    setBackupsError(null)
    setBackupsWarnings([])
    setBackupsPreloaded(false)
    // Note: backupsLoadedForIdRef est géré dans l'effet de chargement des backups
    setGuestInfo(null)
    setHeaderCollapsed(false)

    // Réinitialiser les états HA
    resetHA()

    // Réinitialiser les états de réplication
    setReplicationLoaded(false)
    setReplicationJobs([])
    setAvailableTargetNodes([])
    setSourceCephAvailable(false)
    setCephClusters([])
    setCephReplicationJobs([])
  }, [selection?.type, selection?.id])

  // Initialiser les sliders CPU et RAM quand les données sont chargées
  useEffect(() => {
    if (data?.cpuInfo) {
      setCpuSockets(data.cpuInfo.sockets || 1)
      setCpuCores(data.cpuInfo.cores || 1)
      setCpuType(data.cpuInfo.type || 'kvm64')
      setCpuFlags(data.cpuInfo.flags || {})
      setCpuLimit(data.cpuInfo.cpulimit || 0)
      setCpuLimitEnabled(!!data.cpuInfo.cpulimit)
      setNumaEnabled(!!data.cpuInfo.numa)
    }

    if (data?.memoryInfo) {
      setMemory(data.memoryInfo.memory || 2048)
      setBalloon(data.memoryInfo.balloon || 0)
      setBalloonEnabled(data.memoryInfo.balloon !== 0 && data.memoryInfo.balloon !== undefined)
      setSwap(data.memoryInfo.swap ?? 512)
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
    let intervalId: ReturnType<typeof setInterval> | null = null
    let isFirstLoad = true

    async function runRrd() {
      if (!alive) return
      if (!isFirstLoad) {
        // Silent refresh: don't show loading spinner or clear errors
      } else {
        setRrdError(null)
      }

      if (!selection) return
      if (selection.type !== 'node' && selection.type !== 'vm') return

      try {
        if (isFirstLoad) setRrdLoading(true)

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
        if (isFirstLoad) setRrdError(e?.message || String(e))
      } finally {
        if (!alive) return
        if (isFirstLoad) setRrdLoading(false)
        isFirstLoad = false
      }
    }

    // Petit délai pour laisser l'UI s'afficher d'abord
    const timer = setTimeout(runRrd, 50)

    // Auto-refresh every 30s with visibility pause
    function startRefresh() {
      if (intervalId !== null) return
      intervalId = setInterval(runRrd, 30000)
    }

    function stopRefresh() {
      if (intervalId !== null) { clearInterval(intervalId); intervalId = null }
    }

    function onVis() {
      if (document.visibilityState === 'visible') { runRrd(); startRefresh() }
      else stopRefresh()
    }

    document.addEventListener('visibilitychange', onVis)
    // Start refresh interval after initial load delay
    const refreshTimer = setTimeout(() => {
      if (document.visibilityState === 'visible') startRefresh()
    }, 30000)

    return () => {
      alive = false
      clearTimeout(timer)
      clearTimeout(refreshTimer)
      stopRefresh()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [selection?.type, selection?.id, tf]) // Retirer data?.metrics?.ram?.max des dépendances

  const progress = useMemo(() => (loading ? <LinearProgress /> : null), [loading])

  const canShowRrd = selection && (selection.type === 'node' || selection.type === 'vm') && !data?.isTemplate

  // Charger les backups quand on sélectionne une VM
  useEffect(() => {
    if (selection?.type !== 'vm') {
      backupsLoadedForIdRef.current = null
      return
    }

    const currentSelectionId = selection.id
    if (backupsLoadedForIdRef.current === currentSelectionId) return
    backupsLoadedForIdRef.current = currentSelectionId

    const { type, vmid } = parseVmId(selection.id)
    loadBackups(vmid, type)
    setBackupsPreloaded(true)
  }, [selection?.type, selection?.id, loadBackups])

  // Note: snapshot preloading is handled inside useSnapshots hook

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
            osInfo: data.osInfo,
            diskUsage: data.diskUsage
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

  // Charger les données HA du cluster quand l'onglet HA est ouvert (lazy loading)
  useEffect(() => {
    if (selection?.type === 'cluster' && clusterTab === 3 && !clusterHaLoaded && !clusterHaLoading) {
      loadClusterHa(selection.id)
    }
  }, [selection?.type, selection?.id, clusterTab, clusterHaLoaded, clusterHaLoading, loadClusterHa])

  // Charger la config du cluster quand on sélectionne l'onglet Cluster
  useEffect(() => {
    if (selection?.type === 'cluster' && clusterTab === 10 && !clusterConfigLoaded && !clusterConfigLoading) {
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

  // Charger les mises à jour quand on sélectionne l'onglet Updates sur un node
  useEffect(() => {
    if (selection?.type !== 'node') return
    const isInCluster = !!data?.clusterName
    const updatesTabIndex = isInCluster ? 10 : 11
    if (nodeTab !== updatesTabIndex) return

    const { connId, node } = parseNodeId(selection.id)
    if (nodeUpdates[node] !== undefined) return // Already loaded or loading

    setNodeUpdates(prev => ({
      ...prev,
      [node]: { count: 0, updates: [], version: null, loading: true }
    }))

    const aptUrl = `/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/apt`

    const fetchAndSet = (json: any, permError?: string) => {
      const pvePkg = (json.data || []).find((p: any) => p.package === 'pve-manager')
      const pveVersion = pvePkg?.currentVersion || null
      setNodeUpdates(prev => ({
        ...prev,
        [node]: { count: json.count || 0, updates: json.data || [], version: pveVersion, loading: false, permissionError: permError || null }
      }))
    }

    fetch(aptUrl)
      .then(res => res.json())
      .then(json => {
        if (json.needsRefresh) {
          // Package list stale (e.g. apt update never ran) - trigger apt update then re-fetch
          return fetch(aptUrl, { method: 'POST' })
            .then(async (postRes) => {
              if (postRes.status === 403) {
                const postJson = await postRes.json()
                fetchAndSet({ data: [], count: 0 }, postJson.requiredPermission || 'Sys.Modify')
                return
              }
              const res = await fetch(aptUrl)
              const freshJson = await res.json()
              fetchAndSet(freshJson)
            })
        }
        fetchAndSet(json)
      })
      .catch(() => {
        setNodeUpdates(prev => ({
          ...prev,
          [node]: { count: 0, updates: [], version: null, loading: false, permissionError: null }
        }))
      })
  }, [selection?.type, selection?.id, nodeTab, data?.clusterName, nodeUpdates])

  // Charger les mises à jour quand on sélectionne l'onglet Rolling Update
  useEffect(() => {
    if (selection?.type === 'cluster' && clusterTab === 11 && data?.nodesData?.length > 0) {
      const connId = selection.id || ''
      // Charger les mises à jour et les VMs locales pour chaque nœud
      data.nodesData.forEach((node: any) => {
        // Charger les mises à jour
        if (node.status === 'online' && !nodeUpdates[node.node]?.loading && nodeUpdates[node.node] === undefined) {
          setNodeUpdates(prev => ({
            ...prev,
            [node.node]: { count: 0, updates: [], version: null, loading: true }
          }))

          const aptUrl = `/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node.node)}/apt`

          const fetchAndSet = (json: any, permError?: string) => {
            const pvePkg = (json.data || []).find((p: any) => p.package === 'pve-manager')
            const pveVersion = pvePkg?.currentVersion || node.pveversion || null
            setNodeUpdates(prev => ({
              ...prev,
              [node.node]: {
                count: json.count || 0,
                updates: json.data || [],
                version: pveVersion,
                loading: false,
                permissionError: permError || null
              }
            }))
          }

          fetch(aptUrl)
            .then(res => res.json())
            .then(json => {
              if (json.needsRefresh) {
                return fetch(aptUrl, { method: 'POST' })
                  .then(async (postRes) => {
                    if (postRes.status === 403) {
                      const postJson = await postRes.json()
                      fetchAndSet({ data: [], count: 0 }, postJson.requiredPermission || 'Sys.Modify')
                      return
                    }
                    const res = await fetch(aptUrl)
                    const freshJson = await res.json()
                    fetchAndSet(freshJson)
                  })
              }
              fetchAndSet(json)
            })
            .catch(() => {
              setNodeUpdates(prev => ({
                ...prev,
                [node.node]: { count: 0, updates: [], version: null, loading: false, permissionError: null }
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

    let iv: ReturnType<typeof setInterval> | null = null

    function start() { if (iv !== null) return; iv = setInterval(fetchPerf, 3000) }
    function stop() { if (iv !== null) { clearInterval(iv); iv = null } }
    function onVis() { if (document.visibilityState === 'visible') { fetchPerf(); start() } else { stop() } }

    document.addEventListener('visibilitychange', onVis)
    if (document.visibilityState === 'visible') start()

    return () => { stop(); document.removeEventListener('visibilitychange', onVis) }
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

    // Auto-refresh every 30s with visibility pause
    let iv: ReturnType<typeof setInterval> | null = null

    function start() { if (iv !== null) return; iv = setInterval(load, 30000) }
    function stop() { if (iv !== null) { clearInterval(iv); iv = null } }
    function onVis() { if (document.visibilityState === 'visible') { load(); start() } else { stop() } }

    document.addEventListener('visibilitychange', onVis)
    const refreshTimer = setTimeout(() => { if (document.visibilityState === 'visible') start() }, 30000)

    return () => { cancelled = true; clearTimeout(refreshTimer); stop(); document.removeEventListener('visibilitychange', onVis) }
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
      cpuLimitEnabled !== !!data.cpuInfo.cpulimit ||
      numaEnabled !== !!data.cpuInfo.numa
    )
  }, [data?.cpuInfo, cpuSockets, cpuCores, cpuType, cpuFlags, cpuLimit, cpuLimitEnabled, numaEnabled])

  // Détecter si les valeurs RAM ont été modifiées
  const memoryModified = useMemo(() => {
    if (!data?.memoryInfo) return false

    const changed = memory !== (data.memoryInfo.memory || 2048) ||
      balloon !== (data.memoryInfo.balloon || 0) ||
      balloonEnabled !== (data.memoryInfo.balloon !== 0 && data.memoryInfo.balloon !== undefined)

    if (data?.vmType === 'lxc') {
      return changed || swap !== (data.memoryInfo.swap ?? 512)
    }

    return changed
  }, [data?.memoryInfo, data?.vmType, memory, balloon, balloonEnabled, swap])

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
        numa: numaEnabled ? 1 : 0,
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

      if (type === 'lxc') {
        configUpdate.swap = swap
      } else {
        if (balloonEnabled) {
          configUpdate.balloon = balloon
        } else {
          configUpdate.balloon = 0
        }
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
      
      // Message de succès avec avertissement si VM était running (LXC applique les changements immédiatement)
      if (wasRunning && type !== 'lxc') {
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

  // Sync detail panel status from allVms (updated by tree optimistic updates / SSE)
  const selectedVmFromList = useMemo(() => {
    if (!selection || selection.type !== 'vm') return null
    const { connId, vmid } = parseVmId(selection.id)
    return allVms.find(v => v.connId === connId && String(v.vmid) === String(vmid)) || null
  }, [selection, allVms])

  useEffect(() => {
    if (!selectedVmFromList || !data) return
    const liveStatus = selectedVmFromList.status
    if (liveStatus && liveStatus !== data.vmRealStatus) {
      const mappedStatus = (liveStatus === 'running' ? 'ok' : liveStatus === 'paused' ? 'warn' : 'crit') as any
      setData({ ...data, status: mappedStatus, vmRealStatus: liveStatus })
    }
  }, [selectedVmFromList?.status])

  // Status de la VM pour les actions et la console
  const vmStatus = data?.vmRealStatus || data?.status
  const vmState = data?.vmRealStatus || data?.status
  const showConsole = selection?.type === 'vm' && !data?.isTemplate

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
    <Box sx={{ p: selection && selection.type !== 'root' && !selection.type.endsWith('-root') ? 2.5 : 0, width: '100%', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', fontSize: 13, '& .MuiTypography-body2': { fontSize: '13px !important', fontWeight: '400 !important' }, '& .MuiTypography-body1': { fontSize: '13px !important' }, '& .MuiTypography-caption': { fontSize: '11px !important' } }}>
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
      ) : selection?.type === 'net-conn' || selection?.type === 'net-node' || selection?.type === 'net-vlan' ? (
        <NetworkDetailPanel selection={selection} onSelect={onSelect} />
      ) : selection?.type === 'storage-cluster' || selection?.type === 'storage-node' ? (
        <StorageIntermediatePanel selection={selection} clusterStorages={clusterStorages || []} onSelect={onSelect} />
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
          <Box sx={{ height: 'calc(100vh - 76px - var(--taskbar-height, 0px))', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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
                    {t('inventory.guests')} ({displayVms.length})
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
                <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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
                    defaultHiddenColumns={['node', 'ha']}
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
              icon: (
                <Box sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width: 16, height: 16, flexShrink: 0 }}>
                  <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={16} height={16} style={{ opacity: h.status === 'online' ? 0.8 : 0.4 }} />
                  <Box sx={{ position: 'absolute', bottom: -2, right: -2, width: 8, height: 8, borderRadius: '50%', bgcolor: h.status === 'online' ? '#4caf50' : '#f44336', border: '1.5px solid', borderColor: 'background.paper' }} />
                </Box>
              ),
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
              color: getTagColor(t.tag, t.vms[0]?.connId).bg,
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
                <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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
          {/* Collapsible header zone for VMs and Nodes */}
          <Collapse in={!((selection?.type === 'vm' || selection?.type === 'node') && headerCollapsed)} timeout={200} sx={{ flexShrink: 0 }}>
          {/* Header title + tags (VM only) + ACTIONS TOP RIGHT */}
          {selection?.type === 'vm' ? (

            /* Format VM — single row: back | icon | name · meta · status | tags | actions */
            (() => {
              const { connId, node, type, vmid } = parseVmId(selection.id)
              const isLxc = data.vmType === 'lxc'
              const iconColor = theme.palette.text.secondary

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

                  <StatusIcon
                    status={vmState}
                    type="vm"
                    template={data.isTemplate}
                    vmType={data.vmType}
                    isMigrating={migratingVmIds?.has(`${connId}:${vmid}`)}
                    isPendingAction={pendingActionVmIds?.has(`${connId}:${vmid}`)}
                    size={22}
                  />

                  {/* Nom + meta inline */}
                  <Typography variant="subtitle1" fontWeight={900} noWrap sx={{ minWidth: 0, flexShrink: 1 }}>
                    {data.title} <Typography component="span" variant="body2" sx={{ color: 'text.disabled', fontWeight: 400 }}>({vmid})</Typography>
                  </Typography>
                  {/* Favorite star */}
                  {(() => {
                    const vmKey = `${connId}:${node}:${isLxc ? 'lxc' : 'qemu'}:${vmid}`
                    const isFav = favorites.has(vmKey)

                    return (
                      <IconButton
                        size="small"
                        onClick={() => toggleFavorite({ id: vmKey, connId, node, type: isLxc ? 'lxc' : 'qemu', vmid, name: data.title })}
                        sx={{ p: 0.25, flexShrink: 0, color: isFav ? '#ffc107' : 'text.disabled', '&:hover': { color: '#ffc107' } }}
                      >
                        <i className={isFav ? 'ri-star-fill' : 'ri-star-line'} style={{ fontSize: 16 }} />
                      </IconButton>
                    )
                  })()}
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
                    {'- '}
                    <span style={{ position: 'relative', display: 'inline-block', verticalAlign: 'text-bottom', marginRight: 4, width: 14, height: 14 }}>
                      <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={14} height={14} style={{ opacity: 0.7, display: 'block' }} />
                      <span style={{ position: 'absolute', bottom: -1, right: -1, width: 6, height: 6, borderRadius: '50%', backgroundColor: '#4caf50', border: '1.5px solid var(--mui-palette-background-paper)' }} />
                    </span>
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
                    onTagsChange={(newTags) => {
                      setLocalTags(newTags)
                      onVmTagsChange?.(connId, vmid, newTags)
                    }}
                  />

                  {/* Refresh + Actions — poussées à droite */}
                  <Box sx={{ ml: 'auto', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <MuiTooltip title={t('common.refresh')}>
                      <IconButton size="small" onClick={refreshData} disabled={refreshing} sx={{ bgcolor: 'action.hover', '&:hover': { bgcolor: 'action.selected' }, '@keyframes spin': { '0%': { transform: 'rotate(0deg)' }, '100%': { transform: 'rotate(360deg)' } }, ...(refreshing && { '& i': { animation: 'spin 1s linear infinite' } }) }}>
                        <i className="ri-refresh-line" style={{ fontSize: 18 }} />
                      </IconButton>
                    </MuiTooltip>
                    {data.isTemplate ? (
                      <>
                        <MuiTooltip title={t('hardware.clone')}>
                          <IconButton size="small" onClick={onClone} sx={{ bgcolor: 'action.hover', '&:hover': { bgcolor: 'action.selected' } }}>
                            <i className="ri-file-copy-line" style={{ fontSize: 18 }} />
                          </IconButton>
                        </MuiTooltip>
                        <MuiTooltip title={t('common.delete')}>
                          <IconButton size="small" onClick={onDelete} color="error" sx={{ bgcolor: 'action.hover', '&:hover': { bgcolor: 'error.main', color: 'white' } }}>
                            <i className="ri-delete-bin-line" style={{ fontSize: 18 }} />
                          </IconButton>
                        </MuiTooltip>
                      </>
                    ) : (
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
                    )}
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
              
              {data.kindLabel === 'HOST' ? (
                <NodeIcon status={data.status === 'crit' ? 'offline' : 'online'} maintenance={data.hostInfo?.maintenance} size={22} />
              ) : data.kindLabel === 'CLUSTER' ? (
                <ClusterIcon nodes={data.nodesData?.map((n: any) => ({ status: n.status })) || []} size={22} />
              ) : selection?.type === 'extvm' ? (
                <img src={
                  data.esxiVmInfo?.hostType === 'hyperv' ? '/images/hyperv-logo.svg'
                  : data.esxiVmInfo?.hostType === 'nutanix' ? '/images/nutanix-logo.svg'
                  : data.esxiVmInfo?.hostType === 'xcpng' ? '/images/xcpng-logo.svg'
                  : '/images/esxi-logo.svg'
                } alt="" width={22} height={22} />
              ) : data.kindLabel ? (
                <Chip
                  size="small"
                  label={data.kindLabel}
                  variant="filled"
                  icon={
                    data.kindLabel === 'VMWARE ESXI' || data.kindLabel === 'VMWARE VM' || data.kindLabel === 'VCENTER' ? (
                      <img src="/images/esxi-logo.svg" alt="" style={{ width: 14, height: 14, marginLeft: 8 }} />
                    ) : data.kindLabel === 'XCP-NG' || data.kindLabel === 'XCP-NG VM' ? (
                      <img src="/images/xcpng-logo.svg" alt="" style={{ width: 14, height: 14, marginLeft: 8 }} />
                    ) : undefined
                  }
                />
              ) : null}

              <Typography variant="subtitle1" fontWeight={900}>
                {data.title}
              </Typography>

              {/* Entity tags (cluster/node) */}
              {(selection?.type === 'cluster' || selection?.type === 'node') && (
                <EntityTagManager
                  tags={entityTags}
                  entityType={selection.type === 'cluster' ? 'connection' : 'host'}
                  entityId={selection.type === 'cluster' ? selection.id : ''}
                  connectionId={selection.type === 'node' ? parseNodeId(selection.id).connId : undefined}
                  nodeName={selection.type === 'node' ? parseNodeId(selection.id).node : undefined}
                  onTagsChange={setEntityTags}
                />
              )}

              {/* Warning Ceph */}
              {data.cephHealth && data.cephHealth !== 'HEALTH_OK' && (
                <MuiTooltip title={`Ceph: ${data.cephHealth === 'HEALTH_WARN' ? t('common.warning') : t('common.error')}`}>
                  <Box component="span" sx={{ display: 'flex', alignItems: 'center', ml: 0.5 }}>
                    <i
                      className={data.cephHealth === 'HEALTH_ERR' ? 'ri-close-circle-fill' : 'ri-alert-fill'}
                      style={{ fontSize: 16, color: data.cephHealth === 'HEALTH_ERR' ? '#f44336' : '#ff9800' }}
                    />
                  </Box>
                </MuiTooltip>
              )}

              {/* Refresh button for storage */}
              {selection?.type === 'storage' && (
                <Box sx={{ ml: 'auto' }}>
                  <MuiTooltip title={t('common.refresh')}>
                    <IconButton size="small" onClick={refreshData} disabled={refreshing} sx={{ bgcolor: 'action.hover', '&:hover': { bgcolor: 'action.selected' }, '@keyframes spin': { '0%': { transform: 'rotate(0deg)' }, '100%': { transform: 'rotate(360deg)' } }, ...(refreshing && { '& i': { animation: 'spin 1s linear infinite' } }) }}>
                      <i className="ri-refresh-line" style={{ fontSize: 18 }} />
                    </IconButton>
                  </MuiTooltip>
                </Box>
              )}

              {/* Refresh + Boutons Create VM/LXC pour clusters et hosts (hidden when node offline) */}
              {(selection?.type === 'cluster' || (selection?.type === 'node' && data.status !== 'crit')) && (
                <Stack direction="row" spacing={1} alignItems="center" sx={{ ml: 'auto' }}>
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
                  {selection?.type === 'node' && (
                    <>
                      <Divider orientation="vertical" flexItem />
                      <NodeActions
                        disabled={nodeActionBusy}
                        onReboot={() => { const { connId, node } = parseNodeId(selection!.id); setNodeActionDialog({ action: 'reboot', nodeName: data.title, connId, node }) }}
                        onShutdown={() => { const { connId, node } = parseNodeId(selection!.id); setNodeActionDialog({ action: 'shutdown', nodeName: data.title, connId, node }) }}
                      />
                    </>
                  )}
                </Stack>
              )}
            </Box>
          )}

          {/* Node offline placeholder */}
          {selection?.type === 'node' && data.status === 'crit' && (
            <Box sx={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 2, height: '100%', minHeight: 'calc(100vh - 250px)',
            }}>
              <img
                src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'}
                alt=""
                style={{ width: 80, height: 80, opacity: 0.3 }}
              />
              <Typography variant="h6" fontWeight={700} sx={{ opacity: 0.6 }}>
                {t('inventory.nodeOffline')}
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.5, textAlign: 'center', maxWidth: 320 }}>
                {t('inventory.nodeOfflineDesc')}
              </Typography>
            </Box>
          )}

          {selection?.type === 'node' && data.hostInfo?.maintenance && data.status !== 'crit' && (
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
                        refreshData()
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


          {!(selection?.type === 'node' && data.status === 'crit') && selection?.type !== 'cluster' && selection?.type !== 'ext' && selection?.type !== 'ext-type' && selection?.type !== 'extvm' && selection?.type !== 'storage' && selection?.type !== 'datastore' && selection?.type !== 'pbs-datastore' && selection?.type !== 'pbs' && !data.isTemplate && (<>
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
            clusterPveVersion={(selection?.type as string) === 'cluster' ? clusterPveVersion : undefined}
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
            isTemplate={data.isTemplate}
            vmNotes={selection?.type === 'vm' ? vmNotes : undefined}
            disksInfo={selection?.type === 'vm' ? data.disksInfo : undefined}
            cpuInfo={selection?.type === 'vm' ? data.cpuInfo : undefined}
          />
          </Box>
          </>)}

          </Collapse>

          {/* Collapse toggle for VM/Node header */}
          {(selection?.type === 'vm' || selection?.type === 'node') && (
            <Box
              onClick={() => setHeaderCollapsed(prev => !prev)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                flexShrink: 0,
                py: 0.25,
                opacity: 0.4,
                transition: 'opacity 0.15s',
                '&:hover': { opacity: 0.8 },
              }}
            >
              <i className={headerCollapsed ? 'ri-arrow-down-s-line' : 'ri-arrow-up-s-line'} style={{ fontSize: 16 }} />
            </Box>
          )}

          {/* VM Detail Tabs */}
          {selection?.type === 'vm' && (
            <VmDetailTabs
              {...{addCephReplicationDialogOpen, addReplicationDialogOpen, availableTargetNodes, backToArchives, backToBackupsList,
                backups, backupsError, backupsLoading, backupsPreloaded, backupsStats, backupsWarnings, balloon,
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
                memoryModified, navigateToBreadcrumb, navigateToFolder, navigateUp, numaEnabled, newSnapshotDesc,
                newSnapshotName, newSnapshotRam, notesEditing, notesError, notesLoading,
                notesSaving, previewFile, primaryColor, primaryColorLight, removeHaConfig,
                replicationComment, replicationJobs, replicationLoading, replicationRateLimit, replicationSchedule,
                replicationTargetNode, rollbackSnapshot, rrdError, rrdLoading, saveCpuConfig,
                saveHaConfig, saveMemoryConfig, saveNotes, savingCpu, savingMemory,
                savingReplication, selectedBackup, selectedCephCluster, selectedPveStorage, selectedVmIsCluster,
                selection, series, setAddCephReplicationDialogOpen, setAddDiskDialogOpen, setAddNetworkDialogOpen, setAddOtherHardwareDialogOpen,
                setAddReplicationDialogOpen, setBackupCompress, setBackupMode, setBackupNote, setBackupStorage,
                setBackupStorages, setBalloon, setBalloonEnabled, setCephClusters, setCephReplicationSchedule,
                setCpuCores, setCpuFlags, setCpuLimit, setCpuLimitEnabled, setCpuSockets, setCpuType,
                setCreateBackupDialogOpen, setDeleteReplicationId, setDetailTab, setEditDiskDialogOpen, setEditNetworkDialogOpen,
                setEditOptionDialog, setEditScsiControllerDialogOpen, setExplorerArchive, setExplorerArchives, setExplorerFiles,
                setExplorerSearch, setHaComment, setHaEditing, setHaGroup, setHaMaxRelocate,
                setHaMaxRestart, setHaState, setMemory, setNewSnapshotDesc, setNewSnapshotName,
                setSwap, swap,
                setNewSnapshotRam, setNotesEditing, setNumaEnabled, setReplicationComment, setReplicationLoaded, setReplicationRateLimit,
                setReplicationSchedule, setReplicationTargetNode, setSavingReplication, setSelectedBackup, setSelectedCephCluster,
                setSelectedDisk, setSelectedNetwork, setSelectedPveStorage, setShowCreateSnapshot, setTasksLoaded,
                setTf, setVmNotes, showCreateSnapshot, snapshotActionBusy, snapshotFeatureAvailable, snapshots,
                snapshotsError, snapshotsLoading, sourceCephAvailable, tags,
                refreshData, tasks, tasksError, tasksLoading, tf, vmNotes}}
            />
          )}


          {/* Cluster Tabs */}
          {selection?.type === 'cluster' && data.nodesData && (
            <ClusterTabs
              {...{allVms, cephTrends, clusterActionError, clusterActionLoading, clusterCephData,
                clusterCephLoading, clusterCephPerf, clusterCephPerfFiltered, clusterCephTimeframe, clusterConfig,
                clusterConfigLoaded, clusterConfigLoading, clusterHaGroups, clusterHaLoaded, clusterHaLoading, clusterHaResources, clusterHaRules, clusterHaStatus, loadClusterHa,
                clusterNotesContent, clusterNotesEditMode, clusterNotesLoading, clusterNotesSaving, clusterPveMajorVersion,
                clusterStorageData, clusterStorageLoading, clusterTab, createClusterDialogOpen, data,
                error, expandedClusterNodes, favorites, handleCreateCluster, handleJoinCluster, handleNodeBulkAction, loadVmTrendsBatch,
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
          {selection?.type === 'node' && data.vmsData && data.status !== 'crit' && (
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


          {/* PBS Server + Datastore panels (extracted component) */}
          <PbsServerPanel
            ref={pbsPanelRef}
            selection={selection}
            data={data}
            onSelect={onSelect}
            pbsTab={pbsTab}
            setPbsTab={setPbsTab}
            pbsBackupSearch={pbsBackupSearch}
            setPbsBackupSearch={setPbsBackupSearch}
            pbsBackupPage={pbsBackupPage}
            setPbsBackupPage={setPbsBackupPage}
            pbsTimeframe={pbsTimeframe}
            setPbsTimeframe={setPbsTimeframe}
            pbsRrdData={pbsRrdData}
            setPbsRrdData={setPbsRrdData}
            datastoreRrdData={datastoreRrdData}
            setDatastoreRrdData={setDatastoreRrdData}
            expandedBackupGroups={expandedBackupGroups}
            setExpandedBackupGroups={setExpandedBackupGroups}
          />



          {/* ── Storage Detail Panel (extracted component) ── */}
          {selection?.type === 'storage' && data.storageInfo && (
            <StorageDetailPanel
              data={data}
              selection={selection}
              storageRrdHistory={storageRrdHistory}
              storageRrdTimeframe={storageRrdTimeframe}
              setStorageRrdTimeframe={setStorageRrdTimeframe}
              storageCephPerf={storageCephPerf}
              storageCephPerfHistory={storageCephPerfHistory}
              storageUploadOpen={storageUploadOpen}
              setStorageUploadOpen={setStorageUploadOpen}
              templateDialogOpen={templateDialogOpen}
              setTemplateDialogOpen={setTemplateDialogOpen}
              pbsStorageSearch={pbsStorageSearch}
              setPbsStorageSearch={setPbsStorageSearch}
              pbsStoragePage={pbsStoragePage}
              setPbsStoragePage={setPbsStoragePage}
              expandedStorageBackupGroups={expandedStorageBackupGroups}
              setExpandedStorageBackupGroups={setExpandedStorageBackupGroups}
              vmNamesMap={vmNamesMap}
              dateLocale={dateLocale}
              primaryColor={primaryColor}
              primaryColorLight={primaryColorLight}
              pbsPanelRef={pbsPanelRef}
              setData={setData}
            />
          )}


          {/* External Hypervisor Type — Dashboard (VMware ESXi / XCP-ng category) */}
          {selection?.type === 'ext-type' && data.extTypeInfo && (
            <ExternalHypervisorDashboard
              extTypeInfo={data.extTypeInfo}
              onSelect={onSelect}
            />
          )}

          {/* External Host — Dashboard */}
          {selection?.type === 'ext' && data.esxiHostInfo && (() => {
            const isXcpng = data.esxiHostInfo.hostType === 'xcpng'
            const isVcenter = data.esxiHostInfo.hostType === 'vcenter'
            const isHyperv = data.esxiHostInfo.hostType === 'hyperv'
            const isNutanix = data.esxiHostInfo.hostType === 'nutanix'
            const hostLabel = isNutanix ? 'Nutanix AHV' : isHyperv ? 'Hyper-V' : isXcpng ? 'XCP-ng' : isVcenter ? 'vCenter' : 'VMware ESXi'
            const vms = data.esxiHostInfo.vms
            const runningVms = vms.filter((v: any) => v.status === 'running')
            const stoppedVms = vms.filter((v: any) => v.status !== 'running')
            const totalCpu = vms.reduce((s: number, v: any) => s + (v.cpu || 0), 0)
            const totalRamGB = vms.reduce((s: number, v: any) => s + (v.memory_size_MiB || 0), 0) / 1024
            const totalDiskGB = vms.reduce((s: number, v: any) => s + (v.committed || 0), 0) / 1073741824

            const migCompleted = extHostMigrations.filter((j: any) => j.status === 'completed').length
            const migFailed = extHostMigrations.filter((j: any) => j.status === 'failed').length
            const migRunning = extHostMigrations.filter((j: any) => !['completed', 'failed', 'cancelled'].includes(j.status)).length
            const migTotal = extHostMigrations.length
            const totalMigratedGB = extHostMigrations
              .filter((j: any) => j.status === 'completed' && j.totalBytes)
              .reduce((s: number, j: any) => s + Number(j.totalBytes), 0) / 1073741824

            const statCards = [
              { icon: 'ri-computer-line', label: t('inventoryPage.extDashboard.totalVms'), value: vms.length, color: theme.palette.primary.main },
              { icon: 'ri-play-circle-line', label: t('inventoryPage.extDashboard.running'), value: runningVms.length, color: theme.palette.success.main },
              { icon: 'ri-stop-circle-line', label: t('inventoryPage.extDashboard.stopped'), value: stoppedVms.length, color: theme.palette.text.disabled },
              { icon: 'ri-swap-line', label: t('inventoryPage.extDashboard.migrated'), value: migCompleted, color: theme.palette.info.main },
            ]

            return (
              <>
              {/* Stats cards */}
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1.5 }}>
                {statCards.map((s) => (
                  <Card key={s.label} variant="outlined" sx={{ borderRadius: 2 }}>
                    <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 }, display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Box sx={{ width: 36, height: 36, borderRadius: 1.5, bgcolor: alpha(s.color, 0.1), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <i className={s.icon} style={{ fontSize: 18, color: s.color }} />
                      </Box>
                      <Box>
                        <Typography variant="h6" fontWeight={700} fontSize={18} lineHeight={1}>{s.value}</Typography>
                        <Typography variant="caption" sx={{ opacity: 0.6, fontSize: 10 }}>{s.label}</Typography>
                      </Box>
                    </CardContent>
                  </Card>
                ))}
              </Box>

              {/* Resources & Migration overview */}
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
                {/* Resources summary */}
                <Card variant="outlined" sx={{ borderRadius: 2 }}>
                  <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                    <Typography variant="body2" fontWeight={700} fontSize={12} sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                      <i className="ri-cpu-line" style={{ fontSize: 16, opacity: 0.5 }} />
                      {t('inventoryPage.extDashboard.resources')}
                    </Typography>
                    <Stack spacing={1.5}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2" fontSize={12} sx={{ opacity: 0.7 }}>vCPU</Typography>
                        <Typography variant="body2" fontSize={12} fontWeight={700}>{totalCpu}</Typography>
                      </Box>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2" fontSize={12} sx={{ opacity: 0.7 }}>RAM</Typography>
                        <Typography variant="body2" fontSize={12} fontWeight={700}>{totalRamGB.toFixed(1)} GB</Typography>
                      </Box>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2" fontSize={12} sx={{ opacity: 0.7 }}>{t('inventoryPage.extDashboard.diskUsage')}</Typography>
                        <Typography variant="body2" fontSize={12} fontWeight={700}>{totalDiskGB.toFixed(1)} GB</Typography>
                      </Box>
                    </Stack>
                  </CardContent>
                </Card>

                {/* Migration stats */}
                <Card variant="outlined" sx={{ borderRadius: 2 }}>
                  <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                    <Typography variant="body2" fontWeight={700} fontSize={12} sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                      <i className="ri-swap-line" style={{ fontSize: 16, opacity: 0.5 }} />
                      {t('inventoryPage.extDashboard.migrationStats')}
                    </Typography>
                    {migTotal === 0 ? (
                      <Typography variant="body2" fontSize={12} sx={{ opacity: 0.4 }}>
                        {t('inventoryPage.extDashboard.noMigrations')}
                      </Typography>
                    ) : (
                      <Stack spacing={1.5}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Typography variant="body2" fontSize={12} sx={{ opacity: 0.7 }}>{t('inventoryPage.extDashboard.completed')}</Typography>
                          <Chip size="small" label={migCompleted} sx={{ height: 20, fontSize: 11, fontWeight: 700, bgcolor: 'success.main', color: '#fff', minWidth: 30 }} />
                        </Box>
                        {migFailed > 0 && (
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Typography variant="body2" fontSize={12} sx={{ opacity: 0.7 }}>{t('inventoryPage.extDashboard.failed')}</Typography>
                            <Chip size="small" label={migFailed} sx={{ height: 20, fontSize: 11, fontWeight: 700, bgcolor: 'error.main', color: '#fff', minWidth: 30 }} />
                          </Box>
                        )}
                        {migRunning > 0 && (
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Typography variant="body2" fontSize={12} sx={{ opacity: 0.7 }}>{t('inventoryPage.extDashboard.inProgress')}</Typography>
                            <Chip size="small" label={migRunning} sx={{ height: 20, fontSize: 11, fontWeight: 700, bgcolor: 'primary.main', color: '#fff', minWidth: 30 }} />
                          </Box>
                        )}
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Typography variant="body2" fontSize={12} sx={{ opacity: 0.7 }}>{t('inventoryPage.extDashboard.dataTransferred')}</Typography>
                          <Typography variant="body2" fontSize={12} fontWeight={700}>{totalMigratedGB.toFixed(1)} GB</Typography>
                        </Box>
                      </Stack>
                    )}
                  </CardContent>
                </Card>
              </Box>

              </>
            )
          })()}

          {/* External Host — VM List with Migrate buttons */}
          {selection?.type === 'ext' && data.esxiHostInfo && (() => {
            const isXcpng = data.esxiHostInfo.hostType === 'xcpng'
            const isVcenter = data.esxiHostInfo.hostType === 'vcenter'
            const isHypervHost = data.esxiHostInfo.hostType === 'hyperv'
            const isNutanixHost = data.esxiHostInfo.hostType === 'nutanix'
            const extVmIcon = isNutanixHost ? '/images/nutanix-logo.svg' : isXcpng ? '/images/xcpng-logo.svg' : '/images/esxi-vm.svg'
            return (
            <Card variant="outlined" sx={{ width: '100%', borderRadius: 2 }}>
              <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                {data.esxiHostInfo.vms.length === 0 ? (
                  <Box sx={{ p: 4, textAlign: 'center' }}>
                    <img src={extVmIcon} alt="" width={48} height={48} style={{ opacity: 0.3 }} />
                    <Typography variant="body2" sx={{ opacity: 0.5, mt: 1 }}>No virtual machines found on this host</Typography>
                  </Box>
                ) : (
                  <>
                  {/* Bulk migration toolbar */}
                  {bulkMigSelected.size > 0 && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1, bgcolor: theme.palette.mode === 'dark' ? 'rgba(var(--mui-palette-primary-mainChannel) / 0.08)' : 'rgba(var(--mui-palette-primary-mainChannel) / 0.06)', borderBottom: '1px solid', borderColor: 'divider' }}>
                      <Typography variant="body2" fontWeight={600} sx={{ fontSize: 12 }}>
                        {bulkMigSelected.size} VM{bulkMigSelected.size > 1 ? 's' : ''} {t('inventoryPage.esxiMigration.selected')}
                      </Typography>
                      <Box sx={{ flex: 1 }} />
                      <Button
                        size="small"
                        variant="text"
                        sx={{ textTransform: 'none', fontSize: 11 }}
                        onClick={() => setBulkMigSelected(new Set())}
                      >
                        {t('inventoryPage.esxiMigration.deselectAll')}
                      </Button>
                      <Button
                        size="small"
                        variant="contained"
                        sx={{ textTransform: 'none', fontSize: 11, height: 28 }}
                        startIcon={<img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={14} height={14} />}
                        onClick={() => {
                          if (!vmwareMigrationAvailable) { setUpgradeDialogOpen(true); return }
                          setBulkMigHostInfo(data.esxiHostInfo)
                          setBulkMigOpen(true)
                        }}
                      >
                        {t('inventoryPage.esxiMigration.migrateSelected')} ({bulkMigSelected.size})
                      </Button>
                    </Box>
                  )}
                  <TableContainer sx={{ maxHeight: 'calc(100vh - 320px)' }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell padding="checkbox" sx={{ width: 42 }}>
                            <Checkbox
                              size="small"
                              indeterminate={bulkMigSelected.size > 0 && bulkMigSelected.size < data.esxiHostInfo.vms.length}
                              checked={data.esxiHostInfo.vms.length > 0 && bulkMigSelected.size === data.esxiHostInfo.vms.length}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setBulkMigSelected(new Set(data.esxiHostInfo!.vms.map((vm: any) => vm.vmid)))
                                } else {
                                  setBulkMigSelected(new Set())
                                }
                              }}
                            />
                          </TableCell>
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
                            selected={bulkMigSelected.has(vm.vmid)}
                            sx={{ cursor: 'pointer', '&:last-child td': { borderBottom: 'none' } }}
                            onClick={() => onSelect?.({ type: 'extvm', id: `${data.esxiHostInfo!.connectionId}:${vm.vmid}` })}
                          >
                            <TableCell padding="checkbox" onClick={e => e.stopPropagation()}>
                              <Checkbox
                                size="small"
                                checked={bulkMigSelected.has(vm.vmid)}
                                onChange={(e) => {
                                  setBulkMigSelected(prev => {
                                    const next = new Set(prev)
                                    if (e.target.checked) next.add(vm.vmid)
                                    else next.delete(vm.vmid)
                                    return next
                                  })
                                }}
                              />
                            </TableCell>
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
                                  const ht = data.esxiHostInfo!.hostType
                                  if (ht === 'vcenter' || ht === 'hyperv' || ht === 'nutanix') setMigType('cold')
                                  setEsxiMigrateVm({
                                    vmid: vm.vmid, name: vm.name || vm.vmid, connId: data.esxiHostInfo!.connectionId,
                                    connName: data.esxiHostInfo!.connectionName, cpu: vm.cpu, memoryMB: vm.memory_size_MiB,
                                    committed: vm.committed, guestOS: vm.guest_OS, licenseFull: data.esxiHostInfo!.licenseFull,
                                    hostType: ht,
                                    // vCenter inventory path resolved server-side via SOAP
                                    // (soapResolveHostInventoryPaths). Undefined for standalone ESXi.
                                    vcenterDatacenter: (vm as any).vcenterDatacenter,
                                    vcenterCluster: (vm as any).vcenterCluster,
                                    vcenterHost: (vm as any).vcenterHost,
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
                  </>
                )}
              </CardContent>
            </Card>
            )
          })()}

          {/* External Host — Recent Migrations */}
          {selection?.type === 'ext' && extHostMigrations.length > 0 && (
            <Card variant="outlined" sx={{ borderRadius: 2 }}>
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                <Typography variant="body2" fontWeight={700} fontSize={12} sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className="ri-history-line" style={{ fontSize: 16, opacity: 0.5 }} />
                  {t('inventoryPage.extDashboard.recentMigrations')}
                </Typography>
                <Stack spacing={0}>
                  {extHostMigrations.slice(0, 8).map((mig: any) => (
                    <Box key={mig.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.75, borderBottom: '1px solid', borderColor: 'divider', '&:last-child': { borderBottom: 'none' } }}>
                      <Box sx={{
                        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                        bgcolor: mig.status === 'completed' ? 'success.main' : mig.status === 'failed' ? 'error.main' : 'primary.main',
                      }} />
                      <Typography variant="body2" fontSize={12} fontWeight={600} noWrap sx={{ minWidth: 0, flex: 1 }}>{mig.sourceVmName || mig.sourceVmId}</Typography>
                      <Typography variant="caption" fontSize={10} sx={{ opacity: 0.5, whiteSpace: 'nowrap', flexShrink: 0 }}>
                        → {mig.targetNode}
                      </Typography>
                      <Typography variant="caption" fontSize={10} sx={{ opacity: 0.5, whiteSpace: 'nowrap', flexShrink: 0 }}>
                        {mig.totalBytes ? `${(Number(mig.totalBytes) / 1073741824).toFixed(1)} GB` : '--'}
                      </Typography>
                      {mig.completedAt && (
                        <Typography variant="caption" fontSize={10} sx={{ opacity: 0.4, whiteSpace: 'nowrap', flexShrink: 0 }}>
                          {new Date(mig.completedAt).toLocaleDateString()}
                        </Typography>
                      )}
                      <Chip
                        size="small"
                        label={mig.status === 'completed' ? t('inventoryPage.esxiMigration.completed') : mig.status === 'failed' ? t('inventoryPage.esxiMigration.failed') : `${mig.progress || 0}%`}
                        sx={{
                          height: 20, fontSize: 10, fontWeight: 700, flexShrink: 0,
                          bgcolor: mig.status === 'completed' ? 'success.main' : mig.status === 'failed' ? 'error.main' : 'primary.main',
                          color: '#fff',
                        }}
                      />
                    </Box>
                  ))}
                </Stack>
              </CardContent>
            </Card>
          )}

          {/* External VM — Migration Control Panel */}
          {selection?.type === 'extvm' && data.esxiVmInfo && (() => {
            const vm = data.esxiVmInfo
            const isXcpngVm = vm.hostType === 'xcpng'
            const isVcenterVm = vm.hostType === 'vcenter'
            const isHypervVm = vm.hostType === 'hyperv'
            const isNutanixVm = vm.hostType === 'nutanix'
            const extSourceIcon = isNutanixVm ? '/images/nutanix-logo.svg' : isHypervVm ? '/images/hyperv-logo.svg' : isXcpngVm ? '/images/xcpng-logo.svg' : '/images/esxi-logo.svg'
            const extSourceLabel = isNutanixVm ? 'Nutanix AHV' : isHypervVm ? 'Hyper-V' : isXcpngVm ? 'XCP-ng' : isVcenterVm ? 'vCenter' : 'ESXi'
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
                        startIcon={<img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={14} height={14} />}
                        onClick={() => {
                          if (!vmwareMigrationAvailable) { setUpgradeDialogOpen(true); return }
                          const ht = vm.hostType || data.esxiVmInfo?.hostType
                          if (ht === 'vcenter' || ht === 'hyperv' || ht === 'nutanix') setMigType('cold')
                          // Pre-fill disk paths for Hyper-V (convert Windows paths to /mnt/hyperv/ linux paths)
                          if (ht === 'hyperv' && (vm as any).diskPaths?.length > 0) {
                            const linuxPaths = ((vm as any).diskPaths as string[]).map((p: string) => {
                              // "C:\VMs\TestVM.vhdx" -> "/mnt/hyperv/TestVM.vhdx"
                              const fileName = p.split('\\').pop() || p.split('/').pop() || p
                              return `/mnt/hyperv/${fileName}`
                            })
                            setMigDiskPaths(linuxPaths.join('\n'))
                          }
                          setEsxiMigrateVm({
                            vmid: vm.vmid, name: vm.name, connId: vm.connectionId,
                            connName: vm.connectionName, cpu: vm.numCPU, memoryMB: vm.memoryMB,
                            committed: vm.committed, guestOS: vm.guestOS, licenseFull: vm.licenseFull,
                            hostType: ht, diskPaths: (vm as any).diskPaths,
                            // Forward vCenter inventory path if the source endpoint resolved it.
                            vcenterDatacenter: (vm as any).vcenterDatacenter,
                            vcenterCluster: (vm as any).vcenterCluster,
                            vcenterHost: (vm as any).vcenterHost,
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
                                pct: typeof l.progress === 'number' ? l.progress : Math.round((idx / (logs.length - 1)) * 100),
                                time: new Date(l.ts).toLocaleTimeString(),
                                msg: l.msg,
                              }
                            })
                            return (
                              <Box sx={{ mt: 2 }}>
                                <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, mb: 0.5, display: 'block' }}>{t('inventoryPage.esxiMigration.progressOverTime')}</Typography>
                                <ResponsiveContainer minWidth={0} width="100%" height={70}>
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
                    <Box ref={migLogsRef} sx={{ p: 1.5, bgcolor: theme.palette.mode === 'dark' ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.03)', fontFamily: '"JetBrains Mono", monospace', fontSize: 11, overflow: 'auto', borderRadius: '0 0 8px 8px', lineHeight: 1.8, maxHeight: 'calc(100vh - 650px)', minHeight: 80 }}>
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

        </Stack>
      ) : null}

      <InventoryDialogs
        selection={selection}
        data={data}
        allVms={allVms}
        hosts={hosts}
        nodeActionDialog={nodeActionDialog}
        setNodeActionDialog={setNodeActionDialog}
        nodeActionBusy={nodeActionBusy}
        setNodeActionBusy={setNodeActionBusy}
        nodeActionStep={nodeActionStep}
        setNodeActionStep={setNodeActionStep}
        nodeActionMigrateTarget={nodeActionMigrateTarget}
        setNodeActionMigrateTarget={setNodeActionMigrateTarget}
        nodeActionFailedVms={nodeActionFailedVms}
        setNodeActionFailedVms={setNodeActionFailedVms}
        nodeActionShutdownFailed={nodeActionShutdownFailed}
        setNodeActionShutdownFailed={setNodeActionShutdownFailed}
        nodeActionLocalVms={nodeActionLocalVms}
        nodeActionStorageLoading={nodeActionStorageLoading}
        nodeActionShutdownLocal={nodeActionShutdownLocal}
        setNodeActionShutdownLocal={setNodeActionShutdownLocal}
        createVmDialogOpen={createVmDialogOpen}
        setCreateVmDialogOpen={setCreateVmDialogOpen}
        createLxcDialogOpen={createLxcDialogOpen}
        setCreateLxcDialogOpen={setCreateLxcDialogOpen}
        effectiveCreateDefaults={effectiveCreateDefaults}
        handleVmCreated={handleVmCreated}
        handleLxcCreated={handleLxcCreated}
        addDiskDialogOpen={addDiskDialogOpen}
        setAddDiskDialogOpen={setAddDiskDialogOpen}
        addNetworkDialogOpen={addNetworkDialogOpen}
        setAddNetworkDialogOpen={setAddNetworkDialogOpen}
        editScsiControllerDialogOpen={editScsiControllerDialogOpen}
        setEditScsiControllerDialogOpen={setEditScsiControllerDialogOpen}
        editDiskDialogOpen={editDiskDialogOpen}
        setEditDiskDialogOpen={setEditDiskDialogOpen}
        editNetworkDialogOpen={editNetworkDialogOpen}
        setEditNetworkDialogOpen={setEditNetworkDialogOpen}
        addOtherHardwareDialogOpen={addOtherHardwareDialogOpen}
        setAddOtherHardwareDialogOpen={setAddOtherHardwareDialogOpen}
        selectedDisk={selectedDisk}
        setSelectedDisk={setSelectedDisk}
        selectedNetwork={selectedNetwork}
        setSelectedNetwork={setSelectedNetwork}
        handleSaveDisk={handleSaveDisk}
        handleSaveNetwork={handleSaveNetwork}
        handleSaveScsiController={handleSaveScsiController}
        handleEditDisk={handleEditDisk}
        handleDeleteDisk={handleDeleteDisk}
        handleResizeDisk={handleResizeDisk}
        handleMoveDisk={handleMoveDisk}
        handleDeleteNetwork={handleDeleteNetwork}
        migrateDialogOpen={migrateDialogOpen}
        setMigrateDialogOpen={setMigrateDialogOpen}
        cloneDialogOpen={cloneDialogOpen}
        setCloneDialogOpen={setCloneDialogOpen}
        handleMigrateVm={handleMigrateVm}
        handleCrossClusterMigrate={handleCrossClusterMigrate}
        handleCloneVm={handleCloneVm}
        selectedVmIsCluster={selectedVmIsCluster}
        tableMigrateVm={tableMigrateVm}
        setTableMigrateVm={setTableMigrateVm}
        tableCloneVm={tableCloneVm}
        setTableCloneVm={setTableCloneVm}
        handleTableMigrateVm={handleTableMigrateVm}
        handleTableCrossClusterMigrate={handleTableCrossClusterMigrate}
        handleTableCloneVm={handleTableCloneVm}
        editOptionDialog={editOptionDialog}
        setEditOptionDialog={setEditOptionDialog}
        editOptionValue={editOptionValue}
        setEditOptionValue={setEditOptionValue}
        editOptionSaving={editOptionSaving}
        handleSaveOption={handleSaveOption}
        haGroupDialogOpen={haGroupDialogOpen}
        setHaGroupDialogOpen={setHaGroupDialogOpen}
        editingHaGroup={editingHaGroup}
        setEditingHaGroup={setEditingHaGroup}
        deleteHaGroupDialog={deleteHaGroupDialog}
        setDeleteHaGroupDialog={setDeleteHaGroupDialog}
        haRuleDialogOpen={haRuleDialogOpen}
        setHaRuleDialogOpen={setHaRuleDialogOpen}
        editingHaRule={editingHaRule}
        setEditingHaRule={setEditingHaRule}
        deleteHaRuleDialog={deleteHaRuleDialog}
        setDeleteHaRuleDialog={setDeleteHaRuleDialog}
        haRuleType={haRuleType}
        clusterHaResources={clusterHaResources}
        clusterPveMajorVersion={clusterPveMajorVersion}
        loadClusterHa={loadClusterHa}
        confirmAction={confirmAction}
        setConfirmAction={setConfirmAction}
        confirmActionLoading={confirmActionLoading}
        createBackupDialogOpen={createBackupDialogOpen}
        setCreateBackupDialogOpen={setCreateBackupDialogOpen}
        backupStorage={backupStorage}
        setBackupStorage={setBackupStorage}
        backupMode={backupMode}
        setBackupMode={setBackupMode}
        backupCompress={backupCompress}
        setBackupCompress={setBackupCompress}
        backupNote={backupNote}
        setBackupNote={setBackupNote}
        creatingBackup={creatingBackup}
        setCreatingBackup={setCreatingBackup}
        backupStorages={backupStorages}
        loadBackups={loadBackups}
        deleteVmDialogOpen={deleteVmDialogOpen}
        setDeleteVmDialogOpen={setDeleteVmDialogOpen}
        deleteVmConfirmText={deleteVmConfirmText}
        setDeleteVmConfirmText={setDeleteVmConfirmText}
        deletingVm={deletingVm}
        deleteVmPurge={deleteVmPurge}
        setDeleteVmPurge={setDeleteVmPurge}
        handleDeleteVm={handleDeleteVm}
        convertTemplateDialogOpen={convertTemplateDialogOpen}
        setConvertTemplateDialogOpen={setConvertTemplateDialogOpen}
        convertingTemplate={convertingTemplate}
        handleConvertTemplate={handleConvertTemplate}
        unlockErrorDialog={unlockErrorDialog}
        setUnlockErrorDialog={setUnlockErrorDialog}
        bulkActionDialog={bulkActionDialog}
        setBulkActionDialog={setBulkActionDialog}
        executeBulkAction={executeBulkAction}
        esxiMigrateVm={esxiMigrateVm}
        setEsxiMigrateVm={setEsxiMigrateVm}
        migTargetConn={migTargetConn}
        setMigTargetConn={setMigTargetConn}
        migTargetNode={migTargetNode}
        setMigTargetNode={setMigTargetNode}
        migTargetStorage={migTargetStorage}
        setMigTargetStorage={setMigTargetStorage}
        migNetworkBridge={migNetworkBridge}
        setMigNetworkBridge={setMigNetworkBridge}
        migBridges={migBridges}
        migStartAfter={migStartAfter}
        setMigStartAfter={setMigStartAfter}
        migDiskPaths={migDiskPaths}
        setMigDiskPaths={setMigDiskPaths}
        migTempStorage={migTempStorage}
        setMigTempStorage={setMigTempStorage}
        migType={migType}
        setMigType={setMigType}
        migTransferMode={migTransferMode}
        setMigTransferMode={setMigTransferMode}
        migPveConnections={migPveConnections}
        migNodes={migNodes}
        migStorages={migStorages}
        migSshfsAvailable={migSshfsAvailable}
        vcenterPreflight={vcenterPreflight}
        setVcenterPreflight={setVcenterPreflight}
        migStarting={migStarting}
        setMigStarting={setMigStarting}
        migJobId={migJobId}
        setMigJobId={setMigJobId}
        migJob={migJob}
        setMigJob={setMigJob}
        migNodeOptions={migNodeOptions}
        bulkMigSelected={bulkMigSelected}
        setBulkMigSelected={setBulkMigSelected}
        bulkMigOpen={bulkMigOpen}
        setBulkMigOpen={setBulkMigOpen}
        bulkMigStarting={bulkMigStarting}
        setBulkMigStarting={setBulkMigStarting}
        bulkMigJobs={bulkMigJobs}
        setBulkMigJobs={setBulkMigJobs}
        bulkMigProgressExpanded={bulkMigProgressExpanded}
        setBulkMigProgressExpanded={setBulkMigProgressExpanded}
        bulkMigLogsExpanded={bulkMigLogsExpanded}
        setBulkMigLogsExpanded={setBulkMigLogsExpanded}
        bulkMigLogsFilter={bulkMigLogsFilter}
        setBulkMigLogsFilter={setBulkMigLogsFilter}
        bulkMigConfigRef={bulkMigConfigRef}
        bulkMigHostInfo={bulkMigHostInfo}
        upgradeDialogOpen={upgradeDialogOpen}
        setUpgradeDialogOpen={setUpgradeDialogOpen}
      />

    </Box>
  )
}