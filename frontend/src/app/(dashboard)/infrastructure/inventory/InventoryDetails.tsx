'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useLocale, useTranslations } from 'next-intl'

import { useProxCenterTasks } from '@/contexts/ProxCenterTasksContext'
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

import NodesTable, { NodeRow, BulkAction } from '@/components/NodesTable'
import VmsTable, { VmRow } from '@/components/VmsTable'
// Dynamic imports for HardwareModals (code-split, loaded on demand)
const AddDiskDialog = dynamic(() => import('@/components/HardwareModals').then(mod => ({ default: mod.AddDiskDialog })), { ssr: false })
const AddNetworkDialog = dynamic(() => import('@/components/HardwareModals').then(mod => ({ default: mod.AddNetworkDialog })), { ssr: false })
const EditDiskDialog = dynamic(() => import('@/components/HardwareModals').then(mod => ({ default: mod.EditDiskDialog })), { ssr: false })
const EditNetworkDialog = dynamic(() => import('@/components/HardwareModals').then(mod => ({ default: mod.EditNetworkDialog })), { ssr: false })
const EditScsiControllerDialog = dynamic(() => import('@/components/HardwareModals').then(mod => ({ default: mod.EditScsiControllerDialog })), { ssr: false })
const AddOtherHardwareDialog = dynamic(() => import('@/components/HardwareModals').then(mod => ({ default: mod.AddOtherHardwareDialog })), { ssr: false })
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
import { TAG_PALETTE, hashStringToInt, parseTags, formatBps, formatTime, formatUptime, parseMarkdown, parseNodeId, parseVmId, getMetricIcon, pickNumber, buildSeriesFromRrd, fetchRrd, fetchDetails } from './helpers'
import { useTagColors } from '@/contexts/TagColorContext'
import { getOsSvgIcon } from '@/lib/utils/osIcons'
import CreateVmDialog from './CreateVmDialog'
import CreateLxcDialog from './CreateLxcDialog'
import HaGroupDialog from './HaGroupDialog'
import HaRuleDialog from './HaRuleDialog'
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
import ExpandableChart from './components/ExpandableChart'
import StorageContentGroup from './components/StorageContentGroup'
import PbsServerPanel, { type PbsServerPanelHandle } from './components/PbsServerPanel'
import { PlayArrowIcon, StopIcon, PowerSettingsNewIcon, MoveUpIcon, AddIcon, CloseIcon, SaveIcon } from './components/IconWrappers'
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
  const [esxiMigrateVm, setEsxiMigrateVm] = useState<{ vmid: string; name: string; connId: string; connName: string; cpu?: number; memoryMB?: number; committed?: number; guestOS?: string; licenseFull?: boolean; hostType?: string } | null>(null)
  const [migTargetConn, setMigTargetConn] = useState('')
  const [migTargetNode, setMigTargetNode] = useState('')
  const [migTargetStorage, setMigTargetStorage] = useState('')
  const [migNetworkBridge, setMigNetworkBridge] = useState('')
  const [migBridges, setMigBridges] = useState<any[]>([])
  const [migStartAfter, setMigStartAfter] = useState(false)
  const [migDiskPaths, setMigDiskPaths] = useState('')
  const [migType, setMigType] = useState<'cold' | 'live' | 'sshfs_boot'>('cold')
  const [migTransferMode, setMigTransferMode] = useState<'https' | 'sshfs'>('sshfs')
  const [migPveConnections, setMigPveConnections] = useState<any[]>([])
  const [migNodes, setMigNodes] = useState<any[]>([])
  const [migStorages, setMigStorages] = useState<any[]>([])
  const [migSshfsAvailable, setMigSshfsAvailable] = useState<boolean | null>(null) // null = not checked yet
  const [vcenterPreflight, setVcenterPreflight] = useState<{ checked: boolean; ok: boolean; installing: boolean; errors: string[]; virtV2vInstalled: boolean } | null>(null)
  const [migStarting, setMigStarting] = useState(false)
  const [migJobId, setMigJobId] = useState<string | null>(null)
  const [migJob, setMigJob] = useState<any>(null)
  const [vmMigJob, setVmMigJob] = useState<any>(null) // active migration job for current VM panel
  const migLogsRef = useRef<HTMLDivElement>(null)
  // Bulk migration state
  const [bulkMigSelected, setBulkMigSelected] = useState<Set<string>>(new Set())
  const [bulkMigOpen, setBulkMigOpen] = useState(false)
  const [bulkMigStarting, setBulkMigStarting] = useState(false)
  const BULK_MIG_CONCURRENCY = 2
  const [bulkMigJobs, setBulkMigJobs] = useState<{ vmid: string; name: string; jobId: string; status: string; progress: number; error?: string; logs?: { ts: string; msg: string; level: string }[]; targetNode?: string }[]>([])
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
          if (s.shared) sharedSet.add(s.storage)
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
    // Run vCenter (virt-v2v) preflight check for the target node
    fetch('/api/v1/migrations/preflight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetConnectionId: migTargetConn, targetNode: fetchNode }),
    }).then(r => r.json()).then(d => {
      setVcenterPreflight({ checked: true, ok: !d.errors?.length, installing: false, errors: d.errors || [], virtV2vInstalled: d.virtV2vInstalled ?? false })
    }).catch(() => setVcenterPreflight({ checked: true, ok: false, installing: false, errors: ['Preflight check failed'], virtV2vInstalled: false }))
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

  // Poll migration job status + sync to TasksBar
  useEffect(() => {
    if (!migJobId) return
    const taskId = `migration-${migJobId}`
    const interval = setInterval(() => {
      fetch(`/api/v1/migrations/${migJobId}`).then(r => r.json()).then(d => {
        setMigJob(d.data)
        if (d.data) {
          const j = d.data
          const speed = j.transferSpeed ? ` — ${j.transferSpeed}` : ''
          const step = j.status === 'transferring' ? `Transferring${speed}`
            : j.status === 'configuring' ? 'Configuring'
            : j.status === 'creating_vm' ? 'Creating VM'
            : j.status === 'preflight' ? 'Pre-flight checks'
            : j.status === 'completed' ? 'Completed'
            : j.status === 'failed' ? (j.error || 'Failed')
            : j.status === 'cancelled' ? 'Cancelled'
            : j.status
          updatePCTaskRef.current(taskId, {
            progress: j.progress || 0,
            detail: step,
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
              // Sync to PCTask
              const speed = j.transferSpeed ? ` — ${j.transferSpeed}` : ''
              const step = j.status === 'transferring' ? `Transferring${speed}` : j.status === 'completed' ? 'Completed' : j.status === 'failed' ? (j.error || 'Failed') : j.status
              updatePCTaskRef.current(`migration-${job.jobId}`, {
                progress: j.progress || 0,
                detail: step,
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
      const { connId, node } = parseNodeId(selection.id)
      fetch(`/api/v1/hosts?connId=${encodeURIComponent(connId)}`)
        .then(r => r.ok ? r.json() : null)
        .then(json => {
          const hosts = json?.data?.hosts || []
          const host = hosts.find((h: any) => h.node === node)
          const tags = host?.managedHost?.tags || host?.tags
          setEntityTags(tags ? String(tags).split(';').filter(Boolean) : [])
        })
        .catch(() => {})
    }
  }, [selection?.id, selection?.type])

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
              ) : (
                <Chip
                  size="small"
                  label={data.kindLabel}
                  variant="filled"
                  icon={
                    data.kindLabel === 'VMWARE ESXI' || data.kindLabel === 'VMWARE VM' || data.kindLabel === 'VCENTER' ? (
                      <img src="/images/esxi-logo.svg" alt="" style={{ width: 14, height: 14, marginLeft: 8 }} />
                    ) : data.kindLabel === 'XCP-NG' ? (
                      <img src="/images/xcpng-logo.svg" alt="" style={{ width: 14, height: 14, marginLeft: 8 }} />
                    ) : undefined
                  }
                />
              )}

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
                          <Box sx={{ flex: 1, minWidth: 180 }}>
                            <ExpandableChart
                              title={t('inventory.storageUsage')}
                              height={90}
                              header={
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flex: 1 }}>
                                  <Typography variant="caption" fontWeight={600}>{t('inventory.storageUsage')}</Typography>
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
                              }
                            >
                              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                                <AreaChart data={storageRrdHistory}>
                                  <XAxis dataKey="time" tickFormatter={(v: any) => { const d = new Date(v); return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }} minTickGap={40} tick={{ fontSize: 9 }} type="number" domain={['dataMin', 'dataMax']} />
                                  <YAxis domain={[0, 100]} tickFormatter={(v: any) => `${v}%`} tick={{ fontSize: 9 }} width={30} />
                                  <Tooltip
                                    wrapperStyle={{ backgroundColor: 'transparent', boxShadow: 'none' }}
                                    content={({ active, payload, label }) => {
                                      if (!active || !payload?.length) return null
                                      const strokeColor = si.usedPct > 90 ? theme.palette.error.main : si.usedPct > 70 ? theme.palette.warning.main : theme.palette.success.main
                                      const ts = new Date(Number(label))
                                      const timeStr = storageRrdTimeframe === 'hour' || storageRrdTimeframe === 'day'
                                        ? ts.toLocaleTimeString()
                                        : ts.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' }) + ' ' + ts.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
                                      return (
                                        <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11, minWidth: 160 }}>
                                          <Box sx={{ px: 1.5, py: 0.75, bgcolor: alpha(strokeColor, 0.1), borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                            <i className="ri-hard-drive-2-line" style={{ fontSize: 13, color: strokeColor }} />
                                            <Typography variant="caption" sx={{ fontWeight: 700, color: strokeColor }}>Storage Usage</Typography>
                                            <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6 }}>{timeStr}</Typography>
                                          </Box>
                                          <Box sx={{ px: 1.5, py: 0.75 }}>
                                            {payload.map(entry => (
                                              <Box key={String(entry.dataKey)} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
                                                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                                                <Typography variant="caption" sx={{ flex: 1 }}>Usage</Typography>
                                                <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>{Number(entry.value).toFixed(1)}%</Typography>
                                              </Box>
                                            ))}
                                          </Box>
                                        </Box>
                                      )
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
                            </ExpandableChart>
                          </Box>
                        )}

                        {/* Ceph Read/Write + IOPS graphs */}
                        {isCeph && storageCephPerfHistory.length > 1 && (
                          <>
                            {/* Read/Write throughput */}
                            <Box sx={{ flex: 1, minWidth: 180 }}>
                              <ExpandableChart
                                title={t('inventory.pbsTransferRate')}
                                height={90}
                                header={
                                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flex: 1 }}>
                                    <Typography variant="caption" fontWeight={600}>{t('inventory.pbsTransferRate')}</Typography>
                                    <Typography variant="caption" fontWeight={700} sx={{ opacity: 0.7, fontSize: 10 }}>
                                      {storageCephPerf ? `R: ${formatBps(storageCephPerf.read_bytes_sec)} / W: ${formatBps(storageCephPerf.write_bytes_sec)}` : '—'}
                                    </Typography>
                                  </Box>
                                }
                              >
                                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                                  <AreaChart data={storageCephPerfHistory}>
                                    <XAxis dataKey="time" tickFormatter={(v: any) => new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} minTickGap={40} tick={{ fontSize: 9 }} />
                                    <YAxis tickFormatter={(v: any) => formatBps(Number(v))} tick={{ fontSize: 9 }} width={50} domain={[0, 'auto']} />
                                    <Tooltip
                                      wrapperStyle={{ backgroundColor: 'transparent', boxShadow: 'none' }}
                                      content={({ active, payload }) => {
                                        if (!active || !payload?.length) return null
                                        const ts = payload[0]?.payload?.time ? new Date(payload[0].payload.time).toLocaleTimeString() : ''
                                        return (
                                          <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11, minWidth: 180 }}>
                                            <Box sx={{ px: 1.5, py: 0.75, bgcolor: alpha('#3b82f6', 0.1), borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                              <i className="ri-speed-line" style={{ fontSize: 13, color: '#3b82f6' }} />
                                              <Typography variant="caption" sx={{ fontWeight: 700, color: '#3b82f6' }}>Throughput</Typography>
                                              <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6 }}>{ts}</Typography>
                                            </Box>
                                            <Box sx={{ px: 1.5, py: 0.75 }}>
                                              {payload.map(entry => (
                                                <Box key={String(entry.dataKey)} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
                                                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                                                  <Typography variant="caption" sx={{ flex: 1 }}>{entry.name === 'read_bytes_sec' ? 'Read' : 'Write'}</Typography>
                                                  <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>{formatBps(Number(entry.value))}</Typography>
                                                </Box>
                                              ))}
                                            </Box>
                                          </Box>
                                        )
                                      }}
                                    />
                                    <Area type="monotone" dataKey="read_bytes_sec" stroke={primaryColor} fill={primaryColor} fillOpacity={0.4} strokeWidth={1.5} isAnimationActive={false} name="read_bytes_sec" />
                                    <Area type="monotone" dataKey="write_bytes_sec" stroke={primaryColorLight} fill={primaryColorLight} fillOpacity={0.3} strokeWidth={1} isAnimationActive={false} name="write_bytes_sec" />
                                  </AreaChart>
                                </ResponsiveContainer>
                              </ExpandableChart>
                            </Box>

                            {/* IOPS */}
                            <Box sx={{ flex: 1, minWidth: 180 }}>
                              <ExpandableChart
                                title="IOPS"
                                height={90}
                                header={
                                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flex: 1 }}>
                                    <Typography variant="caption" fontWeight={600}>IOPS</Typography>
                                    <Typography variant="caption" fontWeight={700} sx={{ opacity: 0.7, fontSize: 10 }}>
                                      {storageCephPerf ? `R: ${storageCephPerf.read_op_per_sec?.toLocaleString() || 0} / W: ${storageCephPerf.write_op_per_sec?.toLocaleString() || 0}` : '—'}
                                    </Typography>
                                  </Box>
                                }
                              >
                                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                                  <AreaChart data={storageCephPerfHistory}>
                                    <XAxis dataKey="time" tickFormatter={(v: any) => new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} minTickGap={40} tick={{ fontSize: 9 }} />
                                    <YAxis tick={{ fontSize: 9 }} width={40} domain={[0, 'auto']} />
                                    <Tooltip
                                      wrapperStyle={{ backgroundColor: 'transparent', boxShadow: 'none' }}
                                      content={({ active, payload }) => {
                                        if (!active || !payload?.length) return null
                                        const ts = payload[0]?.payload?.time ? new Date(payload[0].payload.time).toLocaleTimeString() : ''
                                        return (
                                          <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11, minWidth: 180 }}>
                                            <Box sx={{ px: 1.5, py: 0.75, bgcolor: alpha('#f59e0b', 0.1), borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                              <i className="ri-dashboard-3-line" style={{ fontSize: 13, color: '#f59e0b' }} />
                                              <Typography variant="caption" sx={{ fontWeight: 700, color: '#f59e0b' }}>IOPS</Typography>
                                              <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6 }}>{ts}</Typography>
                                            </Box>
                                            <Box sx={{ px: 1.5, py: 0.75 }}>
                                              {payload.map(entry => (
                                                <Box key={String(entry.dataKey)} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
                                                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                                                  <Typography variant="caption" sx={{ flex: 1 }}>{entry.name === 'read_op_per_sec' ? 'Read' : 'Write'}</Typography>
                                                  <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>{Number(entry.value).toLocaleString()} IOPS</Typography>
                                                </Box>
                                              ))}
                                            </Box>
                                          </Box>
                                        )
                                      }}
                                    />
                                    <Area type="monotone" dataKey="read_op_per_sec" stroke={primaryColor} fill={primaryColor} fillOpacity={0.4} strokeWidth={1.5} isAnimationActive={false} name="read_op_per_sec" />
                                    <Area type="monotone" dataKey="write_op_per_sec" stroke={primaryColorLight} fill={primaryColorLight} fillOpacity={0.3} strokeWidth={1} isAnimationActive={false} name="write_op_per_sec" />
                                  </AreaChart>
                                </ResponsiveContainer>
                              </ExpandableChart>
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
                                  <i className={isExpanded ? 'ri-subtract-line' : 'ri-add-line'} style={{ fontSize: 16, opacity: 0.5 }} />
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
                                              <IconButton size="small" sx={{ p: 0.15 }} onClick={() => pbsPanelRef.current?.openRestoreDialog(item, si)}>
                                                <i className="ri-inbox-unarchive-line" style={{ fontSize: 13, color: '#2196f3' }} />
                                              </IconButton>
                                            </MuiTooltip>
                                            <MuiTooltip title={t('inventory.pbsFileRestore')}>
                                              <IconButton size="small" sx={{ p: 0.15 }} onClick={() => pbsPanelRef.current?.openFileRestore(item, si)}>
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
                        vmNames={vmNamesMap}
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

          {/* External Hypervisor Type — Dashboard (VMware ESXi / XCP-ng category) */}
          {selection?.type === 'ext-type' && data.extTypeInfo && (() => {
            const info = data.extTypeInfo
            const allVms = info.hosts.flatMap((h: any) => h.vms)
            const runningVms = allVms.filter((v: any) => v.status === 'running')
            const stoppedVms = allVms.filter((v: any) => v.status !== 'running')
            const totalCpu = allVms.reduce((s: number, v: any) => s + (v.cpu || 0), 0)
            const totalRamGB = allVms.reduce((s: number, v: any) => s + (v.memory_size_MiB || 0), 0) / 1024
            const totalDiskGB = allVms.reduce((s: number, v: any) => s + (v.committed || 0), 0) / 1073741824

            // Migration stats
            const migrations = info.migrations || []
            const migCompleted = migrations.filter((j: any) => j.status === 'completed').length
            const migFailed = migrations.filter((j: any) => j.status === 'failed').length
            const migRunning = migrations.filter((j: any) => !['completed', 'failed', 'cancelled'].includes(j.status)).length
            const totalMigratedGB = migrations.filter((j: any) => j.status === 'completed' && j.totalBytes).reduce((s: number, j: any) => s + Number(j.totalBytes), 0) / 1073741824

            // Donut chart data — VM status
            const vmStatusData = [
              { name: t('inventoryPage.extDashboard.running'), value: runningVms.length, color: theme.palette.success.main },
              { name: t('inventoryPage.extDashboard.stopped'), value: stoppedVms.length, color: theme.palette.grey[400] },
            ].filter(d => d.value > 0)

            // Donut chart data — Migration status
            const migStatusData = [
              { name: t('inventoryPage.extDashboard.completed'), value: migCompleted, color: theme.palette.success.main },
              { name: t('inventoryPage.extDashboard.failed'), value: migFailed, color: theme.palette.error.main },
              { name: t('inventoryPage.extDashboard.inProgress'), value: migRunning, color: theme.palette.primary.main },
            ].filter(d => d.value > 0)

            // Bar chart data — resources per host
            const hostBarData = info.hosts.map((h: any) => ({
              name: h.connectionName.length > 12 ? h.connectionName.substring(0, 12) + '…' : h.connectionName,
              vms: h.vms.length,
              cpu: h.vms.reduce((s: number, v: any) => s + (v.cpu || 0), 0),
              ram: Math.round(h.vms.reduce((s: number, v: any) => s + (v.memory_size_MiB || 0), 0) / 1024),
            }))

            const statCards = [
              { icon: 'ri-server-line', label: t('inventoryPage.extDashboard.hosts'), value: info.hosts.length, color: theme.palette.warning.main },
              { icon: 'ri-computer-line', label: t('inventoryPage.extDashboard.totalVms'), value: allVms.length, color: theme.palette.primary.main },
              { icon: 'ri-swap-line', label: t('inventoryPage.extDashboard.migrated'), value: migCompleted, color: theme.palette.info.main },
              { icon: 'ri-hard-drive-3-line', label: t('inventoryPage.extDashboard.dataTransferred'), value: `${totalMigratedGB.toFixed(1)} GB`, color: theme.palette.secondary.main },
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

              {/* Donut charts row — VM Status + Migration Status */}
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
                {/* VM Status donut */}
                <Card variant="outlined" sx={{ borderRadius: 2 }}>
                  <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                    <Typography variant="body2" fontWeight={700} fontSize={12} sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                      <i className="ri-computer-line" style={{ fontSize: 16, opacity: 0.5 }} />
                      {t('inventoryPage.extDashboard.vmStatus')}
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Box sx={{ width: 100, height: 100, flexShrink: 0 }}>
                        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                          <PieChart>
                            <Pie data={vmStatusData} dataKey="value" cx="50%" cy="50%" innerRadius={28} outerRadius={45} paddingAngle={2} strokeWidth={0}>
                              {vmStatusData.map((d, i) => <Cell key={i} fill={d.color} />)}
                            </Pie>
                          </PieChart>
                        </ResponsiveContainer>
                      </Box>
                      <Stack spacing={0.75} sx={{ flex: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: 'success.main' }} />
                          <Typography variant="body2" fontSize={12} sx={{ flex: 1 }}>{t('inventoryPage.extDashboard.running')}</Typography>
                          <Typography variant="body2" fontSize={12} fontWeight={700}>{runningVms.length}</Typography>
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: 'grey.400' }} />
                          <Typography variant="body2" fontSize={12} sx={{ flex: 1 }}>{t('inventoryPage.extDashboard.stopped')}</Typography>
                          <Typography variant="body2" fontSize={12} fontWeight={700}>{stoppedVms.length}</Typography>
                        </Box>
                        <Divider sx={{ my: 0.5 }} />
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography variant="body2" fontSize={12} fontWeight={700} sx={{ flex: 1 }}>Total</Typography>
                          <Typography variant="body2" fontSize={12} fontWeight={700}>{allVms.length}</Typography>
                        </Box>
                      </Stack>
                    </Box>
                  </CardContent>
                </Card>

                {/* Migration Status donut */}
                <Card variant="outlined" sx={{ borderRadius: 2 }}>
                  <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                    <Typography variant="body2" fontWeight={700} fontSize={12} sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                      <i className="ri-swap-line" style={{ fontSize: 16, opacity: 0.5 }} />
                      {t('inventoryPage.extDashboard.migrationStats')}
                    </Typography>
                    {migrations.length === 0 ? (
                      <Box sx={{ height: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Typography variant="body2" fontSize={12} sx={{ opacity: 0.4 }}>{t('inventoryPage.extDashboard.noMigrations')}</Typography>
                      </Box>
                    ) : (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Box sx={{ width: 100, height: 100, flexShrink: 0 }}>
                          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                            <PieChart>
                              <Pie data={migStatusData} dataKey="value" cx="50%" cy="50%" innerRadius={28} outerRadius={45} paddingAngle={2} strokeWidth={0}>
                                {migStatusData.map((d, i) => <Cell key={i} fill={d.color} />)}
                              </Pie>
                            </PieChart>
                          </ResponsiveContainer>
                        </Box>
                        <Stack spacing={0.75} sx={{ flex: 1 }}>
                          {migCompleted > 0 && (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: 'success.main' }} />
                              <Typography variant="body2" fontSize={12} sx={{ flex: 1 }}>{t('inventoryPage.extDashboard.completed')}</Typography>
                              <Typography variant="body2" fontSize={12} fontWeight={700}>{migCompleted}</Typography>
                            </Box>
                          )}
                          {migFailed > 0 && (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: 'error.main' }} />
                              <Typography variant="body2" fontSize={12} sx={{ flex: 1 }}>{t('inventoryPage.extDashboard.failed')}</Typography>
                              <Typography variant="body2" fontSize={12} fontWeight={700}>{migFailed}</Typography>
                            </Box>
                          )}
                          {migRunning > 0 && (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: 'primary.main' }} />
                              <Typography variant="body2" fontSize={12} sx={{ flex: 1 }}>{t('inventoryPage.extDashboard.inProgress')}</Typography>
                              <Typography variant="body2" fontSize={12} fontWeight={700}>{migRunning}</Typography>
                            </Box>
                          )}
                          <Divider sx={{ my: 0.5 }} />
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="body2" fontSize={12} fontWeight={700} sx={{ flex: 1 }}>{t('inventoryPage.extDashboard.dataTransferred')}</Typography>
                            <Typography variant="body2" fontSize={12} fontWeight={700}>{totalMigratedGB.toFixed(1)} GB</Typography>
                          </Box>
                        </Stack>
                      </Box>
                    )}
                  </CardContent>
                </Card>
              </Box>

              {/* Resources per host — bar chart */}
              {info.hosts.length > 1 && (
                <Card variant="outlined" sx={{ borderRadius: 2 }}>
                  <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                    <Typography variant="body2" fontWeight={700} fontSize={12} sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                      <i className="ri-bar-chart-2-line" style={{ fontSize: 16, opacity: 0.5 }} />
                      {t('inventoryPage.extDashboard.resourcesPerHost')}
                    </Typography>
                    <Box sx={{ height: 180 }}>
                      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                        <BarChart data={hostBarData} margin={{ top: 5, right: 5, bottom: 5, left: -15 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke={alpha(theme.palette.divider, 0.5)} />
                          <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                          <YAxis tick={{ fontSize: 10 }} />
                          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${theme.palette.divider}`, background: theme.palette.background.paper }} />
                          <Bar dataKey="vms" name="VMs" fill={theme.palette.primary.main} radius={[3, 3, 0, 0]} />
                          <Bar dataKey="cpu" name="vCPU" fill={theme.palette.warning.main} radius={[3, 3, 0, 0]} />
                          <Bar dataKey="ram" name="RAM (GB)" fill={theme.palette.info.main} radius={[3, 3, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </Box>
                  </CardContent>
                </Card>
              )}

              {/* Global resources summary */}
              <Card variant="outlined" sx={{ borderRadius: 2 }}>
                <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                  <Typography variant="body2" fontWeight={700} fontSize={12} sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <i className="ri-cpu-line" style={{ fontSize: 16, opacity: 0.5 }} />
                    {t('inventoryPage.extDashboard.resources')}
                  </Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 2 }}>
                    <Box sx={{ textAlign: 'center' }}>
                      <Typography variant="h5" fontWeight={700}>{totalCpu}</Typography>
                      <Typography variant="caption" sx={{ opacity: 0.6 }}>vCPU</Typography>
                    </Box>
                    <Box sx={{ textAlign: 'center' }}>
                      <Typography variant="h5" fontWeight={700}>{totalRamGB.toFixed(1)}</Typography>
                      <Typography variant="caption" sx={{ opacity: 0.6 }}>GB RAM</Typography>
                    </Box>
                    <Box sx={{ textAlign: 'center' }}>
                      <Typography variant="h5" fontWeight={700}>{totalDiskGB.toFixed(1)}</Typography>
                      <Typography variant="caption" sx={{ opacity: 0.6 }}>GB {t('inventoryPage.extDashboard.diskUsage')}</Typography>
                    </Box>
                  </Box>
                </CardContent>
              </Card>

              {/* Hosts list with VM counts */}
              <Card variant="outlined" sx={{ borderRadius: 2 }}>
                <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                  <Typography variant="body2" fontWeight={700} fontSize={12} sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <i className="ri-server-line" style={{ fontSize: 16, opacity: 0.5 }} />
                    {t('inventoryPage.extDashboard.hosts')}
                  </Typography>
                  <Stack spacing={0}>
                    {info.hosts.map((host: any) => {
                      const hostRunning = host.vms.filter((v: any) => v.status === 'running').length
                      const hostCpu = host.vms.reduce((s: number, v: any) => s + (v.cpu || 0), 0)
                      const hostRamGB = host.vms.reduce((s: number, v: any) => s + (v.memory_size_MiB || 0), 0) / 1024
                      return (
                        <Box
                          key={host.connectionId}
                          onClick={() => onSelect?.({ type: 'ext', id: host.connectionId })}
                          sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.75, borderBottom: '1px solid', borderColor: 'divider', '&:last-child': { borderBottom: 'none' }, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' }, borderRadius: 1, px: 0.5 }}
                        >
                          {info.hypervisorType === 'hyperv'
                            ? <i className="ri-microsoft-line" style={{ fontSize: 16, color: '#0078d4', opacity: 0.7 }} />
                            : <img src={info.hypervisorType === 'xcpng' ? '/images/xcpng-logo.svg' : '/images/esxi-logo.svg'} alt="" width={16} height={16} style={{ opacity: 0.7 }} />
                          }
                          <Typography variant="body2" fontSize={12} fontWeight={600} sx={{ flex: 1 }} noWrap>{host.connectionName}</Typography>
                          <Typography variant="caption" fontSize={10} sx={{ opacity: 0.5, whiteSpace: 'nowrap' }}>
                            {host.vms.length} VMs · {hostRunning} up · {hostCpu} vCPU · {hostRamGB.toFixed(1)} GB
                          </Typography>
                        </Box>
                      )
                    })}
                  </Stack>
                </CardContent>
              </Card>

              {/* Recent migrations */}
              {migrations.length > 0 && (
                <Card variant="outlined" sx={{ borderRadius: 2 }}>
                  <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                    <Typography variant="body2" fontWeight={700} fontSize={12} sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                      <i className="ri-history-line" style={{ fontSize: 16, opacity: 0.5 }} />
                      {t('inventoryPage.extDashboard.recentMigrations')}
                    </Typography>
                    <Stack spacing={0}>
                      {migrations.slice(0, 10).map((mig: any) => (
                        <Box key={mig.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.75, borderBottom: '1px solid', borderColor: 'divider', '&:last-child': { borderBottom: 'none' } }}>
                          <Box sx={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, bgcolor: mig.status === 'completed' ? 'success.main' : mig.status === 'failed' ? 'error.main' : 'primary.main' }} />
                          <Typography variant="body2" fontSize={12} fontWeight={600} noWrap sx={{ minWidth: 0, flex: 1 }}>{mig.sourceVmName || mig.sourceVmId}</Typography>
                          <Typography variant="caption" fontSize={10} sx={{ opacity: 0.5, whiteSpace: 'nowrap', flexShrink: 0 }}>→ {mig.targetNode}</Typography>
                          <Typography variant="caption" fontSize={10} sx={{ opacity: 0.5, whiteSpace: 'nowrap', flexShrink: 0 }}>{mig.totalBytes ? `${(Number(mig.totalBytes) / 1073741824).toFixed(1)} GB` : '--'}</Typography>
                          {mig.completedAt && <Typography variant="caption" fontSize={10} sx={{ opacity: 0.4, whiteSpace: 'nowrap', flexShrink: 0 }}>{new Date(mig.completedAt).toLocaleDateString()}</Typography>}
                          <Chip size="small" label={mig.status === 'completed' ? t('inventoryPage.esxiMigration.completed') : mig.status === 'failed' ? t('inventoryPage.esxiMigration.failed') : `${mig.progress || 0}%`} sx={{ height: 20, fontSize: 10, fontWeight: 700, flexShrink: 0, bgcolor: mig.status === 'completed' ? 'success.main' : mig.status === 'failed' ? 'error.main' : 'primary.main', color: '#fff' }} />
                        </Box>
                      ))}
                    </Stack>
                  </CardContent>
                </Card>
              )}
              </>
            )
          })()}

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
            const extSourceIcon = isNutanixVm ? '/images/nutanix-logo.svg' : isXcpngVm ? '/images/xcpng-logo.svg' : '/images/esxi-logo.svg'
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
                          setEsxiMigrateVm({
                            vmid: vm.vmid, name: vm.name, connId: vm.connectionId,
                            connName: vm.connectionName, cpu: vm.numCPU, memoryMB: vm.memoryMB,
                            committed: vm.committed, guestOS: vm.guestOS, licenseFull: vm.licenseFull,
                            hostType: ht,
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

      {/* Node Reboot/Shutdown confirmation dialog */}
      {(() => {
        const resolvedConnId = nodeActionDialog?.connId || (selection?.type === 'node' ? parseNodeId(selection.id).connId : '')
        const resolvedNode = nodeActionDialog?.node || (selection?.type === 'node' ? parseNodeId(selection.id).node : '')
        const runningVmsOnNode = allVms.filter(vm =>
          vm.connId === resolvedConnId && vm.node === resolvedNode && vm.status === 'running' && !vm.template
        )
        const otherOnlineNodes = hosts.filter(h =>
          h.connId === resolvedConnId && h.node !== resolvedNode
        )
        const isClusterNode = otherOnlineNodes.length > 0
        return (
                <Dialog
                  open={nodeActionDialog !== null}
                  onClose={() => { if (!nodeActionBusy) { setNodeActionDialog(null); setNodeActionStep(null); setNodeActionMigrateTarget(''); setNodeActionFailedVms([]); setNodeActionShutdownFailed(false); setNodeActionShutdownLocal(false) } }}
                  maxWidth="sm"
                  fullWidth
                >
                  <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Box sx={{
                      width: 40, height: 40, borderRadius: 2,
                      bgcolor: nodeActionDialog?.action === 'reboot' ? 'rgba(245,158,11,0.12)' : 'rgba(198,40,40,0.12)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                      <i
                        className={nodeActionDialog?.action === 'reboot' ? 'ri-restart-line' : 'ri-shut-down-line'}
                        style={{ fontSize: 22, color: nodeActionDialog?.action === 'reboot' ? '#f59e0b' : '#c62828' }}
                      />
                    </Box>
                    {nodeActionDialog?.action === 'reboot' ? t('inventory.nodeReboot') : t('inventory.nodeShutdown')}
                  </DialogTitle>
                  <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <DialogContentText>
                      <strong>{nodeActionDialog?.nodeName}</strong> &mdash;{' '}
                      {nodeActionDialog?.action === 'reboot'
                        ? t('inventory.confirmNodeReboot')
                        : t('inventory.confirmNodeShutdown')}
                    </DialogContentText>
  
                    {/* Running VMs info */}
                    {runningVmsOnNode.length > 0 ? (() => {
                      const sharedVms = isClusterNode ? runningVmsOnNode.filter(vm => !nodeActionLocalVms.has(`${vm.connId}:${vm.vmid}`)) : []
                      const localVms = isClusterNode ? runningVmsOnNode.filter(vm => nodeActionLocalVms.has(`${vm.connId}:${vm.vmid}`)) : runningVmsOnNode

                      return (<>
                      {/* Loading storage check */}
                      {nodeActionStorageLoading && isClusterNode && (
                        <Alert severity="info" icon={<CircularProgress size={18} />}>
                          <Typography variant="body2">{t('inventory.nodeActionAnalyzingStorage')}</Typography>
                        </Alert>
                      )}

                      {/* Shared storage VMs — will be auto-migrated */}
                      {!nodeActionStorageLoading && isClusterNode && sharedVms.length > 0 && (
                        <Alert severity="success" icon={<i className="ri-upload-2-line" style={{ fontSize: 20 }} />}>
                          <Typography variant="body2" fontWeight={600}>
                            {t('inventory.nodeActionSharedVms', { count: sharedVms.length })}
                          </Typography>
                          <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                            {sharedVms.slice(0, 8).map(vm => (
                              <Chip key={`${vm.connId}:${vm.vmid}`} size="small" label={`${vm.vmid} ${vm.name}`}
                                icon={<i className={vm.type === 'lxc' ? 'ri-instance-line' : 'ri-computer-line'} style={{ fontSize: 14 }} />}
                                variant="outlined" color="success" />
                            ))}
                            {sharedVms.length > 8 && <Chip size="small" label={`+${sharedVms.length - 8}`} variant="outlined" />}
                          </Box>
                        </Alert>
                      )}

                      {/* Local storage VMs — cannot be migrated */}
                      {!nodeActionStorageLoading && localVms.length > 0 && (
                        <Alert severity={isClusterNode ? 'warning' : 'info'} icon={<i className={isClusterNode ? 'ri-hard-drive-2-line' : 'ri-computer-line'} style={{ fontSize: 20 }} />}>
                          <Typography variant="body2" fontWeight={600}>
                            {isClusterNode
                              ? t('inventory.nodeActionLocalVms', { count: localVms.length })
                              : t('inventory.nodeActionRunningVms', { count: localVms.length })}
                          </Typography>
                          <Typography variant="body2" sx={{ mt: 0.5, opacity: 0.85 }}>
                            {isClusterNode
                              ? t('inventory.nodeActionLocalVmsDesc')
                              : t('inventory.nodeActionStandaloneShutdownDesc')}
                          </Typography>
                          <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                            {localVms.slice(0, 8).map(vm => (
                              <Chip key={`${vm.connId}:${vm.vmid}`} size="small" label={`${vm.vmid} ${vm.name}`}
                                icon={<i className={vm.type === 'lxc' ? 'ri-instance-line' : 'ri-computer-line'} style={{ fontSize: 14 }} />}
                                variant="outlined" color="warning" />
                            ))}
                            {localVms.length > 8 && <Chip size="small" label={`+${localVms.length - 8}`} variant="outlined" />}
                          </Box>
                          {isClusterNode && (
                            <Box
                              onClick={() => !nodeActionBusy && setNodeActionShutdownLocal(!nodeActionShutdownLocal)}
                              sx={{ mt: 1.5, display: 'flex', alignItems: 'center', gap: 1, cursor: nodeActionBusy ? 'default' : 'pointer' }}
                            >
                              <Checkbox size="small" checked={nodeActionShutdownLocal} disabled={nodeActionBusy} sx={{ p: 0 }} />
                              <Typography variant="body2">{t('inventory.nodeActionShutdownLocalOption')}</Typography>
                            </Box>
                          )}
                        </Alert>
                      )}

                      {/* Target node selector — only if there are VMs to migrate */}
                      {!nodeActionStorageLoading && isClusterNode && sharedVms.length > 0 && (
                        <FormControl fullWidth size="small">
                          <InputLabel>{t('inventory.nodeActionMigrateTarget')}</InputLabel>
                          <Select
                            value={nodeActionMigrateTarget}
                            label={t('inventory.nodeActionMigrateTarget')}
                            onChange={(e) => setNodeActionMigrateTarget(e.target.value)}
                            disabled={nodeActionBusy}
                          >
                            {otherOnlineNodes.map(h => (
                              <MenuItem key={h.node} value={h.node}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <Box sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width: 14, height: 14, flexShrink: 0 }}>
                                    <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" style={{ width: 14, height: 14, opacity: 0.8 }} />
                                    <Box sx={{ position: 'absolute', bottom: -2, right: -2, width: 7, height: 7, borderRadius: '50%', bgcolor: 'success.main', border: '1.5px solid', borderColor: 'background.paper' }} />
                                  </Box>
                                  {h.node}
                                </Box>
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      )}

                      {/* Failed VMs after migration attempt */}
                      {nodeActionFailedVms.length > 0 && (
                        <Alert severity="error" icon={<i className="ri-error-warning-line" style={{ fontSize: 20 }} />}>
                          <Typography variant="body2" fontWeight={600}>
                            {t('inventory.nodeActionMigrateFailed', { count: nodeActionFailedVms.length })}
                          </Typography>
                          <Typography variant="body2" sx={{ mt: 0.5, opacity: 0.85 }}>
                            {t('inventory.nodeActionMigrateFailedDesc')}
                          </Typography>
                          <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                            {nodeActionFailedVms.map(vm => (
                              <MuiTooltip key={vm.vmid} title={vm.error}>
                                <Chip size="small" label={`${vm.vmid} ${vm.name}`} variant="outlined" color="error" />
                              </MuiTooltip>
                            ))}
                          </Box>
                          <Box
                            onClick={() => !nodeActionBusy && setNodeActionShutdownFailed(!nodeActionShutdownFailed)}
                              sx={{ mt: 1.5, display: 'flex', alignItems: 'center', gap: 1, cursor: nodeActionBusy ? 'default' : 'pointer' }}
                            >
                              <Checkbox size="small" checked={nodeActionShutdownFailed} disabled={nodeActionBusy} sx={{ p: 0 }} />
                              <Typography variant="body2">{t('inventory.nodeActionShutdownFailedOption')}</Typography>
                            </Box>
                          </Alert>
                        )}
                    </>)
                    })() : (
                      <Alert severity="success" icon={<i className="ri-checkbox-circle-line" style={{ fontSize: 20 }} />}>
                        <Typography variant="body2">{t('inventory.nodeActionNoRunningVms')}</Typography>
                      </Alert>
                    )}
  
                    {/* Maintenance mode info */}
                    {isClusterNode && (
                      <Alert severity="info" icon={<i className="ri-tools-line" style={{ fontSize: 20 }} />} sx={{ mt: 0 }}>
                        <Typography variant="body2">{t('inventory.nodeActionMaintenanceAuto')}</Typography>
                      </Alert>
                    )}
  
                    {/* Progress steps */}
                    {nodeActionStep && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
                        <CircularProgress size={18} />
                        <Typography variant="body2" sx={{ fontStyle: 'italic' }}>{nodeActionStep}</Typography>
                      </Box>
                    )}
                  </DialogContent>
                  <DialogActions>
                    <Button
                      onClick={() => { setNodeActionDialog(null); setNodeActionStep(null); setNodeActionMigrateTarget(''); setNodeActionFailedVms([]); setNodeActionShutdownFailed(false) }}
                      color="inherit"
                      disabled={nodeActionBusy}
                    >
                      {t('common.cancel')}
                    </Button>
                    <Button
                      variant="contained"
                      color={nodeActionDialog?.action === 'reboot' ? 'warning' : 'error'}
                      disabled={(() => {
                        if (nodeActionBusy || nodeActionStorageLoading) return true
                        if (nodeActionFailedVms.length > 0 && !nodeActionShutdownFailed) return true
                        if (isClusterNode && runningVmsOnNode.length > 0) {
                          const hasShared = runningVmsOnNode.length > nodeActionLocalVms.size
                          const hasLocal = nodeActionLocalVms.size > 0
                          if (hasShared && !nodeActionMigrateTarget) return true
                          if (hasLocal && !nodeActionShutdownLocal) return true
                        }
                        return false
                      })()}
                      startIcon={nodeActionBusy ? <CircularProgress size={16} /> : undefined}
                      onClick={async () => {
                        if (!nodeActionDialog || !resolvedConnId || !resolvedNode) return
                        setNodeActionBusy(true)
                        const connId = resolvedConnId
                        const node = resolvedNode
  
                        try {
                          // Step 1: Handle running VMs
                          if (runningVmsOnNode.length > 0) {
                            if (isClusterNode) {
                              // Migrate shared-storage VMs
                              const sharedVms = runningVmsOnNode.filter(vm => !nodeActionLocalVms.has(`${vm.connId}:${vm.vmid}`))
                              const localVms = runningVmsOnNode.filter(vm => nodeActionLocalVms.has(`${vm.connId}:${vm.vmid}`))

                              if (sharedVms.length > 0 && nodeActionMigrateTarget && nodeActionFailedVms.length === 0) {
                                setNodeActionStep(t('inventory.nodeActionMigratingStep', { done: 0, total: sharedVms.length }))
                                let done = 0
                                const failed: { vmid: string; name: string; connId: string; type: string; node: string; error: string }[] = []
                                const batchSize = 3
                                for (let i = 0; i < sharedVms.length; i += batchSize) {
                                  const batch = sharedVms.slice(i, i + batchSize)
                                  await Promise.all(batch.map(async (vm) => {
                                    try {
                                      const url = `/api/v1/connections/${encodeURIComponent(vm.connId)}/guests/${vm.type}/${encodeURIComponent(vm.node)}/${encodeURIComponent(vm.vmid)}/migrate`
                                      const res = await fetch(url, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ target: nodeActionMigrateTarget, online: true }),
                                      })
                                      if (!res.ok) {
                                        const err = await res.json().catch(() => ({}))
                                        failed.push({ vmid: vm.vmid, name: vm.name, connId: vm.connId, type: vm.type, node: vm.node, error: err?.error || `HTTP ${res.status}` })
                                      }
                                    } catch (e: any) {
                                      failed.push({ vmid: vm.vmid, name: vm.name, connId: vm.connId, type: vm.type, node: vm.node, error: e?.message || 'Unknown error' })
                                    }
                                    done++
                                    setNodeActionStep(t('inventory.nodeActionMigratingStep', { done, total: sharedVms.length }))
                                  }))
                                }
                                if (failed.length > 0) {
                                  setNodeActionFailedVms(failed)
                                  setNodeActionStep(null)
                                  setNodeActionBusy(false)
                                  return
                                }
                              } else if (nodeActionFailedVms.length > 0 && nodeActionShutdownFailed) {
                                // Shutdown VMs that failed migration
                                setNodeActionStep(t('inventory.nodeActionShutdownVmsStep', { done: 0, total: nodeActionFailedVms.length }))
                                let done = 0
                                for (const vm of nodeActionFailedVms) {
                                  const url = `/api/v1/connections/${encodeURIComponent(vm.connId)}/guests/${vm.type}/${encodeURIComponent(vm.node)}/${encodeURIComponent(vm.vmid)}/shutdown`
                                  await fetch(url, { method: 'POST' }).catch(() => {})
                                  done++
                                  setNodeActionStep(t('inventory.nodeActionShutdownVmsStep', { done, total: nodeActionFailedVms.length }))
                                }
                                setNodeActionStep(t('inventory.nodeActionWaitingVmsStop'))
                                await new Promise(resolve => setTimeout(resolve, 5000))
                              }

                              // Shutdown local-storage VMs (user checked the option)
                              if (localVms.length > 0 && nodeActionShutdownLocal) {
                                setNodeActionStep(t('inventory.nodeActionShutdownVmsStep', { done: 0, total: localVms.length }))
                                let done = 0
                                for (const vm of localVms) {
                                  const url = `/api/v1/connections/${encodeURIComponent(vm.connId)}/guests/${vm.type}/${encodeURIComponent(vm.node)}/${encodeURIComponent(vm.vmid)}/shutdown`
                                  await fetch(url, { method: 'POST' }).catch(() => {})
                                  done++
                                  setNodeActionStep(t('inventory.nodeActionShutdownVmsStep', { done, total: localVms.length }))
                                }
                                setNodeActionStep(t('inventory.nodeActionWaitingVmsStop'))
                                await new Promise(resolve => setTimeout(resolve, 5000))
                              }
                            } else {
                              // Standalone: shutdown all VMs
                              setNodeActionStep(t('inventory.nodeActionShutdownVmsStep', { done: 0, total: runningVmsOnNode.length }))
                              let done = 0
                              const batchSize = 5
                              for (let i = 0; i < runningVmsOnNode.length; i += batchSize) {
                                const batch = runningVmsOnNode.slice(i, i + batchSize)
                                await Promise.all(batch.map(async (vm) => {
                                  const url = `/api/v1/connections/${encodeURIComponent(vm.connId)}/guests/${vm.type}/${encodeURIComponent(vm.node)}/${encodeURIComponent(vm.vmid)}/shutdown`
                                  await fetch(url, { method: 'POST' }).catch(() => {})
                                  done++
                                  setNodeActionStep(t('inventory.nodeActionShutdownVmsStep', { done, total: runningVmsOnNode.length }))
                                }))
                              }
                              setNodeActionStep(t('inventory.nodeActionWaitingVmsStop'))
                              await new Promise(resolve => setTimeout(resolve, 5000))
                            }
                          }
  
                          // Step 2: Enter maintenance mode (cluster only)
                          if (isClusterNode) {
                            setNodeActionStep(t('inventory.nodeActionMaintenanceStep'))
                            try {
                              await fetch(
                                `/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/maintenance`,
                                { method: 'POST' }
                              )
                            } catch {
                              // Non-blocking
                            }
                          }
  
                          // Step 3: Execute reboot/shutdown
                          setNodeActionStep(t('inventory.nodeActionExecuteStep', { action: nodeActionDialog.action }))
                          const res = await fetch(
                            `/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/status`,
                            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: nodeActionDialog.action }) }
                          )
                          const json = await res.json()
                          if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`)
  
                          toast.success(nodeActionDialog.action === 'reboot' ? t('inventory.nodeRebootSuccess') : t('inventory.nodeShutdownSuccess'))
                          setNodeActionDialog(null)
                          setNodeActionStep(null)
                          setNodeActionMigrateTarget('')
                          setNodeActionFailedVms([])
                          setNodeActionShutdownFailed(false)
                          fetch('/api/v1/inventory/poll', { method: 'POST' }).catch(() => {})
                        } catch (e: any) {
                          toast.error(`${t('common.error')}: ${e?.message || e}`)
                          setNodeActionStep(null)
                        } finally {
                          setNodeActionBusy(false)
                        }
                      }}
                    >
                      {t('common.confirm')}
                    </Button>
                  </DialogActions>
                </Dialog>
        )
      })()}

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

            <AddOtherHardwareDialog
              open={addOtherHardwareDialogOpen}
              onClose={() => setAddOtherHardwareDialogOpen(false)}
              onSave={handleSaveDisk}
              connId={connId}
              node={node}
              vmid={vmid}
              existingHardware={[
                ...(data?.disksInfo?.map((d: any) => d.id) || []),
                ...(data?.otherHardwareInfo?.map((h: any) => h.id) || []),
                ...(data?.cloudInitConfig?.drive ? ['cloudinit'] : []),
              ]}
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
          {t('common.edit')}: {editOptionDialog?.label}
        </DialogTitle>
        <DialogContent sx={{ pt: '20px !important' }}>
          <Box>
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
            {editOptionDialog?.type === 'hotplug' && (() => {
              const fields = ['disk', 'network', 'usb', 'memory', 'cpu']
              const fieldLabels: Record<string, string> = { disk: 'Disk', network: 'Network', usb: 'USB', memory: 'Memory', cpu: 'CPU' }
              const raw = typeof editOptionValue === 'string' ? editOptionValue.toLowerCase() : ''
              const current = raw.split(',').map((s: string) => s.trim()).filter(Boolean)
              const toggle = (field: string) => {
                const next = current.includes(field) ? current.filter((f: string) => f !== field) : [...current, field]
                setEditOptionValue(next.join(','))
              }
              return (
                <Stack spacing={1}>
                  {fields.map(field => (
                    <FormControlLabel
                      key={field}
                      control={<Checkbox checked={current.includes(field)} onChange={() => toggle(field)} />}
                      label={fieldLabels[field] || field}
                    />
                  ))}
                </Stack>
              )
            })()}
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
          availableNodes={data?.nodesData || []}
          availableResources={clusterHaResources}
          allVms={allVms}
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
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Box sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width: 14, height: 14, flexShrink: 0 }}>
                            <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" style={{ width: 14, height: 14, opacity: 0.8 }} />
                            <Box sx={{ position: 'absolute', bottom: -2, right: -2, width: 7, height: 7, borderRadius: '50%', bgcolor: 'success.main', border: '1.5px solid', borderColor: 'background.paper' }} />
                          </Box>
                          {n.node}
                        </Box>
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
      <Dialog open={!!esxiMigrateVm} onClose={() => { if (!migStarting) setEsxiMigrateVm(null) }} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          {esxiMigrateVm?.hostType === 'hyperv'
            ? <i className="ri-microsoft-line" style={{ fontSize: 22, color: '#0078d4' }} />
            : <img src={esxiMigrateVm?.hostType === 'nutanix' ? '/images/nutanix-logo.svg' : esxiMigrateVm?.hostType === 'nutanix' ? '/images/nutanix-logo.svg' : esxiMigrateVm?.hostType === 'xcpng' ? '/images/xcpng-logo.svg' : '/images/esxi-logo.svg'} alt="" width={22} height={22} />
          }
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
                  <FormControl fullWidth size="small">
                    <InputLabel>{t('inventoryPage.esxiMigration.targetNode')}</InputLabel>
                    <Select
                      value={migTargetConn && migTargetNode ? `${migTargetConn}::${migTargetNode}` : ''}
                      onChange={e => {
                        const val = e.target.value as string
                        const [connId, node] = val.split('::')
                        setMigTargetConn(connId || '')
                        setMigTargetNode(node || '')
                        setMigTargetStorage('')
                        setMigNetworkBridge('')
                      }}
                      label={t('inventoryPage.esxiMigration.targetNode')}
                      renderValue={(val) => {
                        const [connId, node] = (val as string).split('::')
                        const conn = migPveConnections.find((c: any) => c.id === connId)
                        const opt = migNodeOptions.find((o: any) => o.connId === connId && o.node === node)
                        const isCluster = conn?.hosts?.length > 1
                        const isDarkRv = theme.palette.mode === 'dark'
                        if (!conn) return ''
                        return (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Box component="span" sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width: 14, height: 14, flexShrink: 0 }}>
                              <img src={isDarkRv ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={14} height={14} style={{ opacity: 0.8 }} />
                              <Box sx={{ position: 'absolute', bottom: -2, right: -2, width: 7, height: 7, borderRadius: '50%', bgcolor: opt?.status === 'online' ? 'success.main' : 'error.main', border: '1.5px solid', borderColor: 'background.paper' }} />
                            </Box>
                            <Typography variant="body2" fontWeight={500}>{isCluster ? `${node} (${conn.name})` : conn.name}</Typography>
                          </Box>
                        )
                      }}
                    >
                      {migPveConnections.map((conn: any, connIdx: number) => {
                        const isCluster = conn.hosts?.length > 1
                        const isDark = theme.palette.mode === 'dark'
                        const connNodes = migNodeOptions.filter((o: any) => o.connId === conn.id)
                        const items: React.ReactNode[] = []
                        if (connIdx > 0) items.push(<Divider key={`div-${conn.id}`} />)
                        if (isCluster) {
                          // Cluster: header + indented nodes
                          items.push(
                            <MenuItem key={`header-${conn.id}`} disabled sx={{ opacity: '1 !important', py: 0.5, minHeight: 32, bgcolor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                <i className="ri-server-fill" style={{ fontSize: 14, opacity: 0.8 }} />
                                <Typography variant="caption" fontWeight={700} sx={{ textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 10, color: 'text.secondary' }}>
                                  {conn.name}
                                </Typography>
                                <Chip size="small" label="Cluster" sx={{ height: 16, fontSize: 9, fontWeight: 600 }} />
                              </Box>
                            </MenuItem>
                          )
                          connNodes.forEach((node: any) => {
                            items.push(
                              <MenuItem key={`${conn.id}::${node.node}`} value={`${conn.id}::${node.node}`} sx={{ pl: 4 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                  <Box component="span" sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width: 14, height: 14, flexShrink: 0 }}>
                                    <img src={isDark ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={14} height={14} style={{ opacity: 0.8 }} />
                                    <Box sx={{ position: 'absolute', bottom: -2, right: -2, width: 7, height: 7, borderRadius: '50%', bgcolor: node.status === 'online' ? 'success.main' : 'error.main', border: '1.5px solid', borderColor: 'background.paper' }} />
                                  </Box>
                                  <Typography variant="body2" fontWeight={500}>{node.node}</Typography>
                                  {node.ip && <Typography variant="caption" sx={{ opacity: 0.6, ml: 'auto' }}>{node.ip}</Typography>}
                                </Box>
                              </MenuItem>
                            )
                          })
                        } else {
                          // Standalone: single selectable row with connection name
                          const node = connNodes[0]
                          if (node) {
                            items.push(
                              <MenuItem key={`${conn.id}::${node.node}`} value={`${conn.id}::${node.node}`}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                  <Box component="span" sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width: 14, height: 14, flexShrink: 0 }}>
                                    <img src={isDark ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={14} height={14} style={{ opacity: 0.8 }} />
                                    <Box sx={{ position: 'absolute', bottom: -2, right: -2, width: 7, height: 7, borderRadius: '50%', bgcolor: node.status === 'online' ? 'success.main' : 'error.main', border: '1.5px solid', borderColor: 'background.paper' }} />
                                  </Box>
                                  <Typography variant="body2" fontWeight={500}>{conn.name}</Typography>
                                  {node.ip && <Typography variant="caption" sx={{ opacity: 0.6, ml: 'auto' }}>{node.ip}</Typography>}
                                </Box>
                              </MenuItem>
                            )
                          }
                        }
                        return items
                      })}
                    </Select>
                  </FormControl>
                  <FormControl fullWidth size="small" disabled={!migTargetNode || migStorages.length === 0}>
                    <InputLabel>{t('inventoryPage.esxiMigration.targetStorage')}</InputLabel>
                    <Select
                      value={migTargetStorage}
                      onChange={e => setMigTargetStorage(e.target.value)}
                      label={t('inventoryPage.esxiMigration.targetStorage')}
                      renderValue={(val) => {
                        const s = migStorages.find((s: any) => s.storage === val)
                        if (!s) return ''
                        return (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <i className="ri-hard-drive-2-line" style={{ fontSize: 14, opacity: 0.7 }} />
                            <Typography variant="body2" fontWeight={500}>{s.storage}</Typography>
                            <Typography variant="caption" sx={{ opacity: 0.5 }}>({s.type})</Typography>
                          </Box>
                        )
                      }}
                    >
                      {migStorages.map((s: any) => {
                        const usedPct = s.total && s.avail ? Math.round(((s.total - s.avail) / s.total) * 100) : 0
                        return (
                          <MenuItem key={s.storage} value={s.storage}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                              <i className="ri-hard-drive-2-line" style={{ fontSize: 14, opacity: 0.7 }} />
                              <Typography variant="body2" fontWeight={500}>{s.storage}</Typography>
                              <Typography variant="caption" sx={{ opacity: 0.5 }}>({s.type})</Typography>
                              <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 100 }}>
                                <Box sx={{ flex: 1, height: 4, bgcolor: 'action.hover', borderRadius: 0, overflow: 'hidden' }}>
                                  <Box sx={{ height: '100%', width: `${usedPct}%`, bgcolor: usedPct > 85 ? 'error.main' : usedPct > 60 ? 'warning.main' : 'success.main', transition: 'width 0.3s' }} />
                                </Box>
                                <Typography variant="caption" sx={{ fontSize: '0.6rem', opacity: 0.6, whiteSpace: 'nowrap' }}>
                                  {s.avail ? `${(s.avail / 1073741824).toFixed(1)} GB` : ''}
                                </Typography>
                              </Box>
                            </Box>
                          </MenuItem>
                        )
                      })}
                    </Select>
                  </FormControl>
                  <FormControl fullWidth size="small" disabled={!migTargetNode || migBridges.length === 0}>
                    <InputLabel>{t('inventoryPage.esxiMigration.networkBridge')}</InputLabel>
                    <Select
                      value={migNetworkBridge}
                      onChange={e => setMigNetworkBridge(e.target.value)}
                      label={t('inventoryPage.esxiMigration.networkBridge')}
                      renderValue={(val) => {
                        const b = migBridges.find((b: any) => b.iface === val)
                        if (!b) return ''
                        return (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <i className="ri-router-line" style={{ fontSize: 14, opacity: 0.7 }} />
                            <Typography variant="body2" fontWeight={500}>{b.iface}</Typography>
                            {b.comments && <Typography variant="caption" sx={{ opacity: 0.5 }}>({b.comments})</Typography>}
                          </Box>
                        )
                      }}
                    >
                      {migBridges.map((b: any) => (
                        <MenuItem key={b.iface} value={b.iface}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                            <i className="ri-router-line" style={{ fontSize: 14, opacity: 0.7 }} />
                            <Typography variant="body2" fontWeight={500}>{b.iface}</Typography>
                            {b.comments && <Typography variant="caption" sx={{ opacity: 0.5 }}>({b.comments})</Typography>}
                            {b.cidr && <Typography variant="caption" sx={{ opacity: 0.5, ml: 'auto' }}>{b.cidr}</Typography>}
                          </Box>
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  {/* Migration type selector — hidden for vCenter (cold only) */}
                  {esxiMigrateVm?.hostType !== 'vcenter' && esxiMigrateVm?.hostType !== 'hyperv' && esxiMigrateVm?.hostType !== 'nutanix' && (
                  <Box>
                    <Typography variant="subtitle2" sx={{ mb: 0.75, color: 'text.secondary', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      {t('inventoryPage.esxiMigration.migrationType')}
                    </Typography>
                    <Stack direction="row" spacing={1}>
                      {([
                        { value: 'cold' as const, icon: 'ri-shut-down-line', color: 'info.main', labelKey: 'migrationTypeCold', descKey: 'migrationTypeColdDesc' },
                        { value: 'live' as const, icon: 'ri-flashlight-line', color: 'success.main', labelKey: 'migrationTypeLive', descKey: 'migrationTypeLiveDesc' },
                        { value: 'sshfs_boot' as const, icon: 'ri-speed-line', color: 'warning.main', labelKey: 'migrationTypeSshfsBoot', descKey: 'migrationTypeSshfsBootDesc' },
                      ]).map(opt => (
                        <MuiTooltip key={opt.value} title={t(`inventoryPage.esxiMigration.${opt.descKey}`)} arrow placement="top">
                          <Box
                            onClick={() => setMigType(opt.value)}
                            sx={{
                              flex: 1, py: 1, px: 1.5, borderRadius: 1.5, border: '2px solid', cursor: 'pointer', transition: 'all 0.15s',
                              borderColor: migType === opt.value ? `${opt.color}` : 'divider',
                              bgcolor: migType === opt.value ? (theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)') : 'transparent',
                              '&:hover': { borderColor: `${opt.color}` },
                              display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'center',
                            }}
                          >
                            <i className={opt.icon} style={{ fontSize: 16, color: migType === opt.value ? theme.palette[opt.color.split('.')[0] as 'info' | 'success' | 'warning'].main : undefined, opacity: migType === opt.value ? 1 : 0.6 }} />
                            <Typography variant="body2" fontWeight={migType === opt.value ? 700 : 500} fontSize={12} noWrap>
                              {t(`inventoryPage.esxiMigration.${opt.labelKey}`)}
                            </Typography>
                          </Box>
                        </MuiTooltip>
                      ))}
                    </Stack>
                  </Box>
                  )}

                  {/* Transfer mode selector — hidden for vCenter (virt-v2v handles transfer) */}
                  {esxiMigrateVm?.hostType !== 'vcenter' && esxiMigrateVm?.hostType !== 'hyperv' && esxiMigrateVm?.hostType !== 'nutanix' && (
                  <Box>
                    <Typography variant="subtitle2" sx={{ mb: 0.75, color: 'text.secondary', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      {t('inventoryPage.esxiMigration.transferMode')}
                    </Typography>
                    <Stack direction="row" spacing={1}>
                      {([
                        { value: 'sshfs' as const, icon: 'ri-folder-shared-line', color: 'warning.main', labelKey: 'transferModeSshfs', descKey: 'transferModeSshfsDesc' },
                        { value: 'https' as const, icon: 'ri-download-cloud-line', color: 'info.main', labelKey: 'transferModeHttps', descKey: 'transferModeHttpsDesc' },
                      ]).map(opt => (
                        <MuiTooltip key={opt.value} title={t(`inventoryPage.esxiMigration.${opt.descKey}`)} arrow placement="top">
                          <Box
                            onClick={() => setMigTransferMode(opt.value)}
                            sx={{
                              flex: 1, py: 1, px: 1.5, borderRadius: 1.5, border: '2px solid', cursor: 'pointer', transition: 'all 0.15s',
                              borderColor: migTransferMode === opt.value ? `${opt.color}` : 'divider',
                              bgcolor: migTransferMode === opt.value ? (theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)') : 'transparent',
                              '&:hover': { borderColor: `${opt.color}` },
                              display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'center',
                            }}
                          >
                            <i className={opt.icon} style={{ fontSize: 16, color: migTransferMode === opt.value ? theme.palette[opt.color.split('.')[0] as 'warning' | 'info'].main : undefined, opacity: migTransferMode === opt.value ? 1 : 0.6 }} />
                            <Typography variant="body2" fontWeight={migTransferMode === opt.value ? 700 : 500} fontSize={12} noWrap>
                              {t(`inventoryPage.esxiMigration.${opt.labelKey}`)}
                            </Typography>
                          </Box>
                        </MuiTooltip>
                      ))}
                    </Stack>
                  </Box>
                  )}

                  {/* sshfs not installed warning */}
                  {esxiMigrateVm?.hostType !== 'vcenter' && esxiMigrateVm?.hostType !== 'hyperv' && esxiMigrateVm?.hostType !== 'nutanix' && migSshfsAvailable === false && (migTransferMode === 'sshfs' || migType === 'sshfs_boot') && (
                    <Alert severity="warning" sx={{ fontSize: 12 }} icon={<i className="ri-folder-shared-line" style={{ fontSize: 18 }} />}>
                      {t('inventoryPage.esxiMigration.sshfsNotInstalled')}
                    </Alert>
                  )}

                  {/* vCenter preflight warning */}
                  {(esxiMigrateVm?.hostType === 'vcenter' || esxiMigrateVm?.hostType === 'hyperv' || esxiMigrateVm?.hostType === 'nutanix') && vcenterPreflight?.checked && !vcenterPreflight.virtV2vInstalled && (
                    <Alert
                      severity="warning"
                      sx={{ fontSize: 12 }}
                      icon={<i className="ri-tools-line" style={{ fontSize: 18 }} />}
                      action={
                        <Button
                          size="small"
                          color="warning"
                          disabled={vcenterPreflight.installing}
                          startIcon={vcenterPreflight.installing ? <CircularProgress size={14} color="inherit" /> : <i className="ri-download-line" />}
                          onClick={async () => {
                            setVcenterPreflight(prev => prev ? { ...prev, installing: true } : prev)
                            try {
                              const connNodes = migNodeOptions.filter((o: any) => o.connId === migTargetConn)
                              const fetchNode = migTargetNode === '__auto__' ? (connNodes[0]?.node || migTargetNode) : migTargetNode
                              await fetch('/api/v1/migrations/preflight', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ targetConnectionId: migTargetConn, targetNode: fetchNode, action: 'install' }),
                              })
                              // Re-check after install
                              const r2 = await fetch('/api/v1/migrations/preflight', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ targetConnectionId: migTargetConn, targetNode: fetchNode }),
                              })
                              const d2 = await r2.json()
                              setVcenterPreflight({ checked: true, ok: !d2.errors?.length, installing: false, errors: d2.errors || [], virtV2vInstalled: d2.virtV2vInstalled ?? false })
                            } catch {
                              setVcenterPreflight(prev => prev ? { ...prev, installing: false } : prev)
                            }
                          }}
                          sx={{ textTransform: 'none', fontSize: 11, whiteSpace: 'nowrap' }}
                        >
                          {vcenterPreflight.installing ? 'Installing...' : 'Install'}
                        </Button>
                      }
                    >
                      virt-v2v is not installed on the target node. It is required for vCenter and Hyper-V migrations.
                    </Alert>
                  )}

                  {/* Disk paths field for Hyper-V */}
                  {esxiMigrateVm?.hostType === 'hyperv' && (
                    <TextField
                      fullWidth
                      size="small"
                      label="VHDX Disk Paths"
                      value={migDiskPaths}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMigDiskPaths(e.target.value)}
                      multiline
                      rows={3}
                      placeholder={"/mnt/nfs/vm-disk1.vhdx\n/mnt/nfs/vm-disk2.vhdx"}
                      helperText="One path per line. Paths must be accessible from the target Proxmox node (e.g. NFS mount)."
                      slotProps={{ input: { sx: { fontFamily: '"JetBrains Mono", monospace', fontSize: '0.8rem' } } }}
                    />
                  )}

                  <FormControlLabel
                    control={<Switch size="small" checked={migStartAfter} onChange={(_, v) => setMigStartAfter(v)} />}
                    label={<Typography variant="body2">{t('inventoryPage.esxiMigration.startAfterMigration')}</Typography>}
                  />
                </Stack>
              </Box>

              {/* SSH warning — not needed for vCenter (virt-v2v handles connection) */}
              {esxiMigrateVm?.hostType !== 'vcenter' && esxiMigrateVm?.hostType !== 'hyperv' && esxiMigrateVm?.hostType !== 'nutanix' && migTargetConn && (() => {
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
                  {esxiMigrateVm?.hostType === 'nutanix'
                    ? 'Cold migration only. Disks will be downloaded from Nutanix and converted via virt-v2v with automatic virtio driver injection.'
                    : esxiMigrateVm?.hostType === 'hyperv'
                    ? 'Cold migration only. Export VMs as VHDX to an NFS share accessible from the Proxmox node, then provide the disk paths.'
                    : esxiMigrateVm?.hostType === 'vcenter'
                    ? 'Cold migration only. virt-v2v will handle disk conversion and virtio driver injection automatically.'
                    : migType === 'cold' ? t('inventoryPage.esxiMigration.coldMigrationInfo')
                    : migType === 'live' ? t('inventoryPage.esxiMigration.liveMigrationInfo')
                    : t('inventoryPage.esxiMigration.sshfsBootMigrationInfo')
                  }
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
                  {esxiMigrateVm?.hostType === 'hyperv'
                    ? <i className="ri-microsoft-line" style={{ fontSize: 28, color: '#0078d4', opacity: migJob.status === 'completed' ? 0.4 : 1 }} />
                    : <img src={esxiMigrateVm?.hostType === 'nutanix' ? '/images/nutanix-logo.svg' : esxiMigrateVm?.hostType === 'xcpng' ? '/images/xcpng-logo.svg' : '/images/esxi-logo.svg'} alt={esxiMigrateVm?.hostType === 'xcpng' ? 'XCP-ng' : 'VMware'} width={28} height={28} style={{ opacity: migJob.status === 'completed' ? 0.4 : 1 }} />
                  }
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
                variant="outlined"
                disabled={!migTargetConn || !migTargetNode || !migTargetStorage || migStarting || ((esxiMigrateVm?.hostType === 'vcenter' || esxiMigrateVm?.hostType === 'hyperv' || esxiMigrateVm?.hostType === 'nutanix') ? (vcenterPreflight?.checked && !vcenterPreflight.virtV2vInstalled) : ((migTargetConn && !migPveConnections.find((c: any) => c.id === migTargetConn)?.sshEnabled) || (migSshfsAvailable === false && (migTransferMode === 'sshfs' || migType === 'sshfs_boot'))))}
                sx={{ textTransform: 'none' }}
                startIcon={migStarting ? <CircularProgress size={16} color="inherit" /> : <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={16} height={16} />}
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
                        sourceVmName: esxiMigrateVm.name,
                        targetConnectionId: migTargetConn,
                        targetNode: migTargetNode,
                        targetStorage: migTargetStorage,
                        networkBridge: migNetworkBridge,
                        migrationType: (esxiMigrateVm.hostType === 'vcenter' || esxiMigrateVm.hostType === 'hyperv' || esxiMigrateVm.hostType === 'nutanix') ? 'cold' : migType,
                        transferMode: (esxiMigrateVm.hostType === 'vcenter' || esxiMigrateVm.hostType === 'hyperv' || esxiMigrateVm.hostType === 'nutanix') ? 'v2v' : migTransferMode,
                        startAfterMigration: migStartAfter,
                        ...(esxiMigrateVm.hostType === 'hyperv' && migDiskPaths.trim() && {
                          diskPaths: migDiskPaths.trim().split('\n').map((p: string) => p.trim()).filter(Boolean),
                        }),
                      }),
                    })
                    const d = await res.json()
                    if (d.data?.jobId) {
                      const jobId = d.data.jobId
                      setMigJobId(jobId)
                      // Add task to ProxCenter TasksBar
                      const taskId = `migration-${jobId}`
                      const vmLabel = esxiMigrateVm.name || esxiMigrateVm.vmid
                      const sourceType = esxiMigrateVm.hostType === 'xcpng' ? 'XCP-ng' : esxiMigrateVm.hostType === 'vcenter' ? 'vCenter' : esxiMigrateVm.hostType === 'hyperv' ? 'Hyper-V' : esxiMigrateVm.hostType === 'nutanix' ? 'Nutanix' : 'ESXi'
                      addPCTask({
                        id: taskId,
                        type: 'generic',
                        label: `${t('inventoryPage.esxiMigration.migrating')} ${vmLabel} (${sourceType} → Proxmox)`,
                        detail: t('inventoryPage.esxiMigration.preflight'),
                        progress: 0,
                        status: 'running',
                        createdAt: Date.now(),
                      })
                      // Register restore callback to reopen dialog
                      const savedVm = { ...esxiMigrateVm }
                      registerOnRestore(taskId, () => {
                        setEsxiMigrateVm(savedVm)
                        setMigJobId(jobId)
                      })
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
                <>
                  <Button
                    color="error"
                    onClick={async () => {
                      const res = await fetch(`/api/v1/migrations/${migJobId}/cancel`, { method: 'POST' })
                      const d = await res.json().catch(() => ({}))
                      if (d.data) setMigJob(d.data)
                    }}
                  >
                    {t('inventoryPage.esxiMigration.cancelMigration')}
                  </Button>
                  <Button
                    startIcon={<i className="ri-subtract-line" />}
                    onClick={() => setEsxiMigrateVm(null)}
                    sx={{ textTransform: 'none' }}
                  >
                    {t('inventoryPage.esxiMigration.minimize')}
                  </Button>
                </>
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
              {migJob && ['completed', 'failed', 'cancelled'].includes(migJob.status) && (
                <Button onClick={() => { setEsxiMigrateVm(null); setMigJobId(null); setMigJob(null); setMigType('cold'); setMigTransferMode('sshfs') }}>
                  {t('common.close')}
                </Button>
              )}
            </>
          )}
        </DialogActions>
      </Dialog>

      {/* Bulk Migration Dialog */}
      <Dialog open={bulkMigOpen} onClose={() => { if (!bulkMigStarting && bulkMigJobs.length === 0) setBulkMigOpen(false) }} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          {bulkMigHostInfo?.hostType === 'hyperv'
            ? <i className="ri-microsoft-line" style={{ fontSize: 22, color: '#0078d4' }} />
            : <img src={bulkMigHostInfo?.hostType === 'nutanix' ? '/images/nutanix-logo.svg' : bulkMigHostInfo?.hostType === 'xcpng' ? '/images/xcpng-logo.svg' : '/images/esxi-logo.svg'} alt="" width={22} height={22} />
          }
          {t('inventoryPage.esxiMigration.bulkMigration')} ({bulkMigSelected.size} VMs)
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            {/* Selected VMs summary */}
            <Box sx={{ p: 2, borderRadius: 1.5, bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)', border: '1px solid', borderColor: 'divider', maxHeight: 150, overflow: 'auto' }}>
              <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('inventoryPage.esxiMigration.selectedVms')}</Typography>
              {(bulkMigHostInfo?.vms || []).filter((vm: any) => bulkMigSelected.has(vm.vmid)).map((vm: any) => (
                <Box key={vm.vmid} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.3 }}>
                  <Chip size="small" label={vm.status === 'running' ? 'ON' : 'OFF'} sx={{ height: 18, fontSize: 9, fontWeight: 700, bgcolor: vm.status === 'running' ? 'success.main' : 'action.disabledBackground', color: vm.status === 'running' ? '#fff' : 'text.secondary' }} />
                  <Typography variant="body2" fontSize={12} fontWeight={600}>{vm.name || vm.vmid}</Typography>
                  <Typography variant="caption" color="text.secondary">{vm.cpu} vCPU · {vm.memory_size_MiB ? `${(vm.memory_size_MiB / 1024).toFixed(1)} GB` : '?'}</Typography>
                </Box>
              ))}
            </Box>

            {bulkMigJobs.length === 0 && (
              <>
                <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                  <i className="ri-arrow-down-line" style={{ fontSize: 24, color: theme.palette.primary.main }} />
                </Box>

                {/* Target config — reuse same selectors as single migration */}
                <Box sx={{ p: 2, borderRadius: 1.5, bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)', border: '1px solid', borderColor: 'divider' }}>
                  <Typography variant="subtitle2" sx={{ mb: 1.5, color: 'text.secondary', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('inventoryPage.esxiMigration.targetProxmox')}</Typography>
                  <Stack spacing={2}>
                    <FormControl fullWidth size="small">
                      <InputLabel>{t('inventoryPage.esxiMigration.targetNode')}</InputLabel>
                      <Select
                        value={migTargetConn && migTargetNode ? (migTargetNode === '__auto__' ? '__auto__' : `${migTargetConn}::${migTargetNode}`) : ''}
                        onChange={e => {
                          const val = e.target.value as string
                          if (val === '__auto__') {
                            const firstConn = migNodeOptions[0]
                            setMigTargetConn(firstConn?.connId || '')
                            setMigTargetNode('__auto__')
                          } else {
                            const [connId, node] = val.split('::')
                            setMigTargetConn(connId || '')
                            setMigTargetNode(node || '')
                          }
                          setMigTargetStorage('')
                          setMigNetworkBridge('')
                        }}
                        label={t('inventoryPage.esxiMigration.targetNode')}
                        renderValue={(val) => {
                          if (val === '__auto__') return (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <i className="ri-equalizer-line" style={{ fontSize: 14, color: theme.palette.primary.main }} />
                              <Typography variant="body2" fontWeight={500}>{t('inventoryPage.esxiMigration.autoDistribute')}</Typography>
                            </Box>
                          )
                          const [connId, node] = (val as string).split('::')
                          const conn = migPveConnections.find((c: any) => c.id === connId)
                          const opt = migNodeOptions.find((o: any) => o.connId === connId && o.node === node)
                          const isCluster = conn?.hosts?.length > 1
                          const isDarkRv = theme.palette.mode === 'dark'
                          if (!conn) return ''
                          return (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Box component="span" sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width: 14, height: 14, flexShrink: 0 }}>
                                <img src={isDarkRv ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={14} height={14} style={{ opacity: 0.8 }} />
                                <Box sx={{ position: 'absolute', bottom: -2, right: -2, width: 7, height: 7, borderRadius: '50%', bgcolor: opt?.status === 'online' ? 'success.main' : 'error.main', border: '1.5px solid', borderColor: 'background.paper' }} />
                              </Box>
                              <Typography variant="body2" fontWeight={500}>{isCluster ? `${node} (${conn.name})` : conn.name}</Typography>
                            </Box>
                          )
                        }}
                      >
                        <MenuItem value="__auto__">
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <i className="ri-equalizer-line" style={{ fontSize: 16, color: theme.palette.primary.main }} />
                            <Box>
                              <Typography variant="body2" fontWeight={600} fontSize={13}>{t('inventoryPage.esxiMigration.autoDistribute')}</Typography>
                              <Typography variant="caption" color="text.secondary" fontSize={10}>{t('inventoryPage.esxiMigration.autoDistributeDesc')}</Typography>
                            </Box>
                          </Box>
                        </MenuItem>
                        {migPveConnections.map((conn: any, connIdx: number) => {
                          const isCluster = conn.hosts?.length > 1
                          const isDark = theme.palette.mode === 'dark'
                          const connNodes = migNodeOptions.filter((o: any) => o.connId === conn.id)
                          const items: React.ReactNode[] = []
                          items.push(<Divider key={`div-${conn.id}`} />)
                          if (isCluster) {
                            items.push(
                              <MenuItem key={`header-${conn.id}`} disabled sx={{ opacity: '1 !important', py: 0.5, minHeight: 32, bgcolor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                  <i className="ri-server-fill" style={{ fontSize: 14, opacity: 0.8 }} />
                                  <Typography variant="caption" fontWeight={700} sx={{ textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 10, color: 'text.secondary' }}>
                                    {conn.name}
                                  </Typography>
                                  <Chip size="small" label="Cluster" sx={{ height: 16, fontSize: 9, fontWeight: 600 }} />
                                </Box>
                              </MenuItem>
                            )
                            connNodes.forEach((node: any) => {
                              items.push(
                                <MenuItem key={`${conn.id}::${node.node}`} value={`${conn.id}::${node.node}`} sx={{ pl: 4 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                    <Box component="span" sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width: 14, height: 14, flexShrink: 0 }}>
                                      <img src={isDark ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={14} height={14} style={{ opacity: 0.8 }} />
                                      <Box sx={{ position: 'absolute', bottom: -2, right: -2, width: 7, height: 7, borderRadius: '50%', bgcolor: node.status === 'online' ? 'success.main' : 'error.main', border: '1.5px solid', borderColor: 'background.paper' }} />
                                    </Box>
                                    <Typography variant="body2" fontWeight={500}>{node.node}</Typography>
                                    {node.ip && <Typography variant="caption" sx={{ opacity: 0.6, ml: 'auto' }}>{node.ip}</Typography>}
                                  </Box>
                                </MenuItem>
                              )
                            })
                          } else {
                            const node = connNodes[0]
                            if (node) {
                              items.push(
                                <MenuItem key={`${conn.id}::${node.node}`} value={`${conn.id}::${node.node}`}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                    <Box component="span" sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width: 14, height: 14, flexShrink: 0 }}>
                                      <img src={isDark ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={14} height={14} style={{ opacity: 0.8 }} />
                                      <Box sx={{ position: 'absolute', bottom: -2, right: -2, width: 7, height: 7, borderRadius: '50%', bgcolor: node.status === 'online' ? 'success.main' : 'error.main', border: '1.5px solid', borderColor: 'background.paper' }} />
                                    </Box>
                                    <Typography variant="body2" fontWeight={500}>{conn.name}</Typography>
                                    {node.ip && <Typography variant="caption" sx={{ opacity: 0.6, ml: 'auto' }}>{node.ip}</Typography>}
                                  </Box>
                                </MenuItem>
                              )
                            }
                          }
                          return items
                        })}
                      </Select>
                    </FormControl>
                    {migTargetNode && (
                      <>
                        <FormControl fullWidth size="small">
                          <InputLabel>{t('inventoryPage.esxiMigration.targetStorage')}</InputLabel>
                          <Select
                            value={migTargetStorage}
                            onChange={e => setMigTargetStorage(e.target.value)}
                            label={t('inventoryPage.esxiMigration.targetStorage')}
                            renderValue={(val) => {
                              const s = migStorages.find((s: any) => s.storage === val)
                              if (!s) return ''
                              return (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <i className="ri-hard-drive-2-line" style={{ fontSize: 14, opacity: 0.7 }} />
                                  <Typography variant="body2" fontWeight={500}>{s.storage}</Typography>
                                  <Typography variant="caption" sx={{ opacity: 0.5 }}>({s.type})</Typography>
                                </Box>
                              )
                            }}
                          >
                            {migStorages.map((s: any) => {
                              const usedPct = s.total && s.avail ? Math.round(((s.total - s.avail) / s.total) * 100) : 0
                              return (
                                <MenuItem key={s.storage} value={s.storage}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                    <i className="ri-hard-drive-2-line" style={{ fontSize: 14, opacity: 0.7 }} />
                                    <Typography variant="body2" fontWeight={500}>{s.storage}</Typography>
                                    <Typography variant="caption" sx={{ opacity: 0.5 }}>({s.type})</Typography>
                                    <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 100 }}>
                                      <Box sx={{ flex: 1, height: 4, bgcolor: 'action.hover', borderRadius: 0, overflow: 'hidden' }}>
                                        <Box sx={{ height: '100%', width: `${usedPct}%`, bgcolor: usedPct > 85 ? 'error.main' : usedPct > 60 ? 'warning.main' : 'success.main', transition: 'width 0.3s' }} />
                                      </Box>
                                      <Typography variant="caption" sx={{ fontSize: '0.6rem', opacity: 0.6, whiteSpace: 'nowrap' }}>
                                        {s.avail ? `${(s.avail / 1073741824).toFixed(1)} GB` : ''}
                                      </Typography>
                                    </Box>
                                  </Box>
                                </MenuItem>
                              )
                            })}
                          </Select>
                          {migTargetNode === '__auto__' && <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, ml: 1.5 }}>{t('inventoryPage.esxiMigration.sharedStorageHint')}</Typography>}
                        </FormControl>
                        <FormControl fullWidth size="small">
                          <InputLabel>{t('inventoryPage.esxiMigration.networkBridge')}</InputLabel>
                          <Select
                            value={migNetworkBridge}
                            onChange={e => setMigNetworkBridge(e.target.value)}
                            label={t('inventoryPage.esxiMigration.networkBridge')}
                            renderValue={(val) => {
                              const b = migBridges.find((b: any) => b.iface === val)
                              if (!b) return ''
                              return (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <i className="ri-router-line" style={{ fontSize: 14, opacity: 0.7 }} />
                                  <Typography variant="body2" fontWeight={500}>{b.iface}</Typography>
                                  {b.comments && <Typography variant="caption" sx={{ opacity: 0.5 }}>({b.comments})</Typography>}
                                </Box>
                              )
                            }}
                          >
                            {migBridges.map((b: any) => (
                              <MenuItem key={b.iface} value={b.iface}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                  <i className="ri-router-line" style={{ fontSize: 14, opacity: 0.7 }} />
                                  <Typography variant="body2" fontWeight={500}>{b.iface}</Typography>
                                  {b.comments && <Typography variant="caption" sx={{ opacity: 0.5 }}>({b.comments})</Typography>}
                                  {b.cidr && <Typography variant="caption" sx={{ opacity: 0.5, ml: 'auto' }}>{b.cidr}</Typography>}
                                </Box>
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      </>
                    )}
                  </Stack>
                </Box>

                {/* Migration type — hidden for vCenter (cold only) */}
                {bulkMigHostInfo?.hostType !== 'vcenter' && bulkMigHostInfo?.hostType !== 'hyperv' && bulkMigHostInfo?.hostType !== 'nutanix' && (
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 0.75, color: 'text.secondary', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    {t('inventoryPage.esxiMigration.migrationType')}
                  </Typography>
                  <Stack direction="row" spacing={1}>
                    {([
                      { value: 'cold' as const, icon: 'ri-shut-down-line', color: 'info.main', labelKey: 'migrationTypeCold', descKey: 'migrationTypeColdDesc' },
                      { value: 'live' as const, icon: 'ri-flashlight-line', color: 'success.main', labelKey: 'migrationTypeLive', descKey: 'migrationTypeLiveDesc' },
                      { value: 'sshfs_boot' as const, icon: 'ri-speed-line', color: 'warning.main', labelKey: 'migrationTypeSshfsBoot', descKey: 'migrationTypeSshfsBootDesc' },
                    ]).map(opt => (
                      <MuiTooltip key={opt.value} title={t(`inventoryPage.esxiMigration.${opt.descKey}`)} arrow placement="top">
                        <Box
                          onClick={() => setMigType(opt.value)}
                          sx={{
                            flex: 1, py: 1, px: 1.5, borderRadius: 1.5, border: '2px solid', cursor: 'pointer', transition: 'all 0.15s',
                            borderColor: migType === opt.value ? `${opt.color}` : 'divider',
                            bgcolor: migType === opt.value ? (theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)') : 'transparent',
                            '&:hover': { borderColor: `${opt.color}` },
                            display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'center',
                          }}
                        >
                          <i className={opt.icon} style={{ fontSize: 16, color: migType === opt.value ? theme.palette[opt.color.split('.')[0] as 'info' | 'success' | 'warning'].main : undefined, opacity: migType === opt.value ? 1 : 0.6 }} />
                          <Typography variant="body2" fontWeight={migType === opt.value ? 700 : 500} fontSize={12} noWrap>
                            {t(`inventoryPage.esxiMigration.${opt.labelKey}`)}
                          </Typography>
                        </Box>
                      </MuiTooltip>
                    ))}
                  </Stack>
                </Box>
                )}

                {/* Transfer mode — hidden for vCenter (virt-v2v handles transfer) */}
                {bulkMigHostInfo?.hostType !== 'vcenter' && bulkMigHostInfo?.hostType !== 'hyperv' && bulkMigHostInfo?.hostType !== 'nutanix' && (
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 0.75, color: 'text.secondary', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    {t('inventoryPage.esxiMigration.transferMode')}
                  </Typography>
                  <Stack direction="row" spacing={1}>
                    {([
                      { value: 'sshfs' as const, icon: 'ri-folder-shared-line', color: 'warning.main', labelKey: 'transferModeSshfs', descKey: 'transferModeSshfsDesc' },
                      { value: 'https' as const, icon: 'ri-download-cloud-line', color: 'info.main', labelKey: 'transferModeHttps', descKey: 'transferModeHttpsDesc' },
                    ]).map(opt => (
                      <MuiTooltip key={opt.value} title={t(`inventoryPage.esxiMigration.${opt.descKey}`)} arrow placement="top">
                        <Box
                          onClick={() => setMigTransferMode(opt.value)}
                          sx={{
                            flex: 1, py: 1, px: 1.5, borderRadius: 1.5, border: '2px solid', cursor: 'pointer', transition: 'all 0.15s',
                            borderColor: migTransferMode === opt.value ? `${opt.color}` : 'divider',
                            bgcolor: migTransferMode === opt.value ? (theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)') : 'transparent',
                            '&:hover': { borderColor: `${opt.color}` },
                            display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'center',
                          }}
                        >
                          <i className={opt.icon} style={{ fontSize: 16, color: migTransferMode === opt.value ? theme.palette[opt.color.split('.')[0] as 'warning' | 'info'].main : undefined, opacity: migTransferMode === opt.value ? 1 : 0.6 }} />
                          <Typography variant="body2" fontWeight={migTransferMode === opt.value ? 700 : 500} fontSize={12} noWrap>
                            {t(`inventoryPage.esxiMigration.${opt.labelKey}`)}
                          </Typography>
                        </Box>
                      </MuiTooltip>
                    ))}
                  </Stack>
                </Box>
                )}

                {/* sshfs not installed warning */}
                {bulkMigHostInfo?.hostType !== 'vcenter' && bulkMigHostInfo?.hostType !== 'hyperv' && bulkMigHostInfo?.hostType !== 'nutanix' && migSshfsAvailable === false && (migTransferMode === 'sshfs' || migType === 'sshfs_boot') && (
                  <Alert severity="warning" sx={{ fontSize: 12 }} icon={<i className="ri-folder-shared-line" style={{ fontSize: 18 }} />}>
                    {t('inventoryPage.esxiMigration.sshfsNotInstalled')}
                  </Alert>
                )}

                {/* vCenter/Hyper-V info banner for bulk */}
                {bulkMigHostInfo?.hostType === 'vcenter' && (
                  <Alert severity="info" sx={{ fontSize: 12 }} icon={<i className="ri-information-line" style={{ fontSize: 18 }} />}>
                    Cold migration only. virt-v2v will handle disk conversion and virtio driver injection automatically.
                  </Alert>
                )}
                {bulkMigHostInfo?.hostType === 'hyperv' && (
                  <Alert severity="info" sx={{ fontSize: 12 }} icon={<i className="ri-information-line" style={{ fontSize: 18 }} />}>
                    Cold migration only. Export VMs as VHDX to an NFS share accessible from the Proxmox node, then provide the disk paths.
                  </Alert>
                )}
                {bulkMigHostInfo?.hostType === 'nutanix' && (
                  <Alert severity="info" sx={{ fontSize: 12 }} icon={<i className="ri-information-line" style={{ fontSize: 18 }} />}>
                    Cold migration only. Disks will be downloaded from Nutanix and converted via virt-v2v with automatic virtio driver injection.
                  </Alert>
                )}

                {/* vCenter/Hyper-V/Nutanix preflight warning for bulk */}
                {(bulkMigHostInfo?.hostType === 'vcenter' || bulkMigHostInfo?.hostType === 'hyperv' || bulkMigHostInfo?.hostType === 'nutanix') && vcenterPreflight?.checked && !vcenterPreflight.virtV2vInstalled && (
                  <Alert
                    severity="warning"
                    sx={{ fontSize: 12 }}
                    icon={<i className="ri-tools-line" style={{ fontSize: 18 }} />}
                    action={
                      <Button
                        size="small"
                        color="warning"
                        disabled={vcenterPreflight.installing}
                        startIcon={vcenterPreflight.installing ? <CircularProgress size={14} color="inherit" /> : <i className="ri-download-line" />}
                        onClick={async () => {
                          setVcenterPreflight(prev => prev ? { ...prev, installing: true } : prev)
                          try {
                            const connNodes = migNodeOptions.filter((o: any) => o.connId === migTargetConn)
                            const fetchNode = migTargetNode === '__auto__' ? (connNodes[0]?.node || migTargetNode) : migTargetNode
                            await fetch('/api/v1/migrations/preflight', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ targetConnectionId: migTargetConn, targetNode: fetchNode, action: 'install' }),
                            })
                            const r2 = await fetch('/api/v1/migrations/preflight', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ targetConnectionId: migTargetConn, targetNode: fetchNode }),
                            })
                            const d2 = await r2.json()
                            setVcenterPreflight({ checked: true, ok: !d2.errors?.length, installing: false, errors: d2.errors || [], virtV2vInstalled: d2.virtV2vInstalled ?? false })
                          } catch {
                            setVcenterPreflight(prev => prev ? { ...prev, installing: false } : prev)
                          }
                        }}
                        sx={{ textTransform: 'none', fontSize: 11, whiteSpace: 'nowrap' }}
                      >
                        {vcenterPreflight.installing ? 'Installing...' : 'Install'}
                      </Button>
                    }
                  >
                    virt-v2v is not installed on the target node. It is required for vCenter and Hyper-V migrations.
                  </Alert>
                )}

                <FormControlLabel
                  control={<Switch size="small" checked={migStartAfter} onChange={(_, v) => setMigStartAfter(v)} />}
                  label={<Typography variant="body2">{t('inventoryPage.esxiMigration.startAfterMigration')}</Typography>}
                />

                {/* SSH warning — not needed for vCenter */}
                {bulkMigHostInfo?.hostType !== 'vcenter' && bulkMigHostInfo?.hostType !== 'hyperv' && bulkMigHostInfo?.hostType !== 'nutanix' && migTargetConn && !migPveConnections.find((c: any) => c.id === migTargetConn)?.sshEnabled && (
                  <Alert severity="error" sx={{ fontSize: 12 }} icon={<i className="ri-ssh-line" style={{ fontSize: 18 }} />}>{t('inventoryPage.esxiMigration.sshRequired')}</Alert>
                )}

                {migType === 'cold' && bulkMigHostInfo?.vms && (() => {
                  const runningVms = bulkMigHostInfo.vms.filter((vm: any) => bulkMigSelected.has(vm.vmid) && vm.status === 'running')
                  return runningVms.length > 0 ? (
                    <Alert severity="warning" sx={{ fontSize: 12 }}>
                      {t('inventoryPage.esxiMigration.coldMigrationRunningVms')}
                      <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2 }}>
                        {runningVms.map((vm: any) => (
                          <li key={vm.vmid}><strong>{vm.name || vm.vmid}</strong></li>
                        ))}
                      </Box>
                    </Alert>
                  ) : null
                })()}
              </>
            )}

            {/* Bulk migration progress */}
            {bulkMigJobs.length > 0 && (() => {
              const completedCount = bulkMigJobs.filter(j => j.status === 'completed').length
              const failedCount = bulkMigJobs.filter(j => j.status === 'failed').length
              const globalProgress = bulkMigJobs.length > 0 ? Math.round(bulkMigJobs.reduce((sum, j) => sum + j.progress, 0) / bulkMigJobs.length) : 0
              const allDone = bulkMigJobs.every(j => ['completed', 'failed', 'cancelled'].includes(j.status))
              const allLogs = (bulkMigLogsFilter
                ? bulkMigJobs.filter(j => j.jobId === bulkMigLogsFilter)
                : bulkMigJobs
              ).flatMap(j => (j.logs || []).map(l => ({ ...l, vmName: j.name }))).sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
              return (
                <Stack spacing={1}>
                  {/* Global progress header — collapsible */}
                  <Box
                    onClick={() => setBulkMigProgressExpanded(v => !v)}
                    sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer', userSelect: 'none', py: 0.5 }}
                  >
                    <i className={bulkMigProgressExpanded ? 'ri-subtract-line' : 'ri-add-line'} style={{ fontSize: 18, opacity: 0.5 }} />
                    <Typography variant="body2" fontWeight={700} fontSize={12} sx={{ flex: 1 }}>
                      {t('inventoryPage.esxiMigration.bulkMigration')} — {completedCount}/{bulkMigJobs.length} {t('inventoryPage.esxiMigration.completed').toLowerCase()}
                      {failedCount > 0 && <Typography component="span" color="error.main" fontWeight={700} fontSize={12}> ({failedCount} {t('inventoryPage.esxiMigration.failed').toLowerCase()})</Typography>}
                    </Typography>
                    <Typography variant="caption" fontWeight={700} sx={{ opacity: 0.6 }}>{globalProgress}%</Typography>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={globalProgress}
                    color={allDone ? (failedCount > 0 ? 'error' : 'success') : 'primary'}
                    sx={{ height: 6, borderRadius: 3 }}
                  />

                  {/* Individual jobs — shown when expanded */}
                  {bulkMigProgressExpanded && (
                    <Box sx={{ pl: 1 }}>
                      {bulkMigJobs.map((job) => (
                        <Box key={job.vmid} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.75, borderBottom: '1px solid', borderColor: 'divider', '&:last-child': { borderBottom: 'none' } }}>
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography variant="body2" fontWeight={600} fontSize={12} noWrap>{job.name}</Typography>
                            <LinearProgress
                              variant={job.status === 'pending' ? 'indeterminate' : 'determinate'}
                              value={job.status === 'queued' ? 0 : job.progress}
                              color={job.status === 'completed' ? 'success' : job.status === 'failed' || job.status === 'cancelled' ? 'error' : 'primary'}
                              sx={{ height: 4, borderRadius: 2, mt: 0.5, ...(job.status === 'queued' ? { opacity: 0.3 } : {}) }}
                            />
                          </Box>
                          <Chip
                            size="small"
                            label={job.status === 'completed' ? t('inventoryPage.esxiMigration.completed') : job.status === 'failed' ? t('inventoryPage.esxiMigration.failed') : job.status === 'queued' ? t('inventoryPage.esxiMigration.queued') : `${job.progress}%`}
                            sx={{
                              height: 20, fontSize: 10, fontWeight: 700, minWidth: 50,
                              bgcolor: job.status === 'completed' ? 'success.main' : job.status === 'failed' ? 'error.main' : job.status === 'queued' ? 'action.disabled' : 'primary.main',
                              color: '#fff',
                            }}
                          />
                        </Box>
                      ))}
                    </Box>
                  )}

                  {/* Logs section — collapsible */}
                  <Box
                    onClick={() => setBulkMigLogsExpanded(v => !v)}
                    sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer', userSelect: 'none', py: 0.5, mt: 1 }}
                  >
                    <i className={bulkMigLogsExpanded ? 'ri-subtract-line' : 'ri-add-line'} style={{ fontSize: 18, opacity: 0.5 }} />
                    <Typography variant="body2" fontWeight={700} fontSize={12}>
                      {t('inventoryPage.esxiMigration.migrationLogs')}
                    </Typography>
                    <Typography component="span" variant="caption" sx={{ opacity: 0.4 }}>({allLogs.length})</Typography>
                  </Box>

                  {bulkMigLogsExpanded && (
                    <Box>
                      {/* VM filter tabs */}
                      {bulkMigJobs.length > 1 && (
                        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
                          <Chip
                            size="small"
                            label={t('inventoryPage.esxiMigration.allVms')}
                            onClick={() => setBulkMigLogsFilter(null)}
                            sx={{ height: 22, fontSize: 10, fontWeight: 600, bgcolor: !bulkMigLogsFilter ? 'primary.main' : 'action.hover', color: !bulkMigLogsFilter ? '#fff' : 'text.secondary' }}
                          />
                          {bulkMigJobs.filter(j => j.jobId).map(j => (
                            <Chip
                              key={j.jobId}
                              size="small"
                              label={j.name}
                              onClick={() => setBulkMigLogsFilter(bulkMigLogsFilter === j.jobId ? null : j.jobId)}
                              sx={{ height: 22, fontSize: 10, fontWeight: 600, bgcolor: bulkMigLogsFilter === j.jobId ? 'primary.main' : 'action.hover', color: bulkMigLogsFilter === j.jobId ? '#fff' : 'text.secondary' }}
                            />
                          ))}
                        </Box>
                      )}

                      {/* Log entries */}
                      <Box sx={{ maxHeight: 250, overflowY: 'auto', bgcolor: theme.palette.mode === 'dark' ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.03)', borderRadius: 1, p: 1 }}>
                        {allLogs.length > 0 ? allLogs.map((log, i) => (
                          <Box key={i} sx={{ display: 'flex', gap: 0.75, py: 0.25, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, lineHeight: 1.5 }}>
                            <Typography component="span" sx={{ fontSize: 10, opacity: 0.4, whiteSpace: 'nowrap', fontFamily: 'inherit' }}>
                              {new Date(log.ts).toLocaleTimeString()}
                            </Typography>
                            <Typography component="span" sx={{ fontSize: 11, fontFamily: 'inherit', color: log.level === 'error' ? 'error.main' : log.level === 'warn' ? 'warning.main' : log.level === 'success' ? 'success.main' : 'text.secondary' }}>
                              {log.level === 'success' ? '✓' : log.level === 'error' ? '✗' : log.level === 'warn' ? '⚠' : '·'}
                            </Typography>
                            {!bulkMigLogsFilter && bulkMigJobs.length > 1 && (
                              <Typography component="span" sx={{ fontSize: 10, fontFamily: 'inherit', fontWeight: 700, opacity: 0.5, whiteSpace: 'nowrap' }}>
                                [{log.vmName}]
                              </Typography>
                            )}
                            <Typography component="span" sx={{ fontSize: 11, fontFamily: 'inherit', color: log.level === 'error' ? 'error.main' : 'text.primary' }}>
                              {log.msg}
                            </Typography>
                          </Box>
                        )) : (
                          <Typography variant="caption" sx={{ opacity: 0.4 }}>
                            {t('inventoryPage.esxiMigration.logsWillAppear')}
                          </Typography>
                        )}
                      </Box>
                    </Box>
                  )}
                </Stack>
              )
            })()}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          {bulkMigJobs.length === 0 ? (
            <>
              <Button onClick={() => setBulkMigOpen(false)} disabled={bulkMigStarting}>{t('common.cancel')}</Button>
              <Button
                variant="outlined"
                disabled={!migTargetConn || !migTargetNode || !migTargetStorage || bulkMigStarting || ((bulkMigHostInfo?.hostType === 'vcenter' || bulkMigHostInfo?.hostType === 'hyperv' || bulkMigHostInfo?.hostType === 'nutanix') ? (vcenterPreflight?.checked && !vcenterPreflight.virtV2vInstalled) : ((migTargetConn && !migPveConnections.find((c: any) => c.id === migTargetConn)?.sshEnabled) || (migSshfsAvailable === false && (migTransferMode === 'sshfs' || migType === 'sshfs_boot')))) || (migType === 'cold' && bulkMigHostInfo?.vms?.some((vm: any) => bulkMigSelected.has(vm.vmid) && vm.status === 'running'))}
                sx={{ textTransform: 'none' }}
                startIcon={bulkMigStarting ? <CircularProgress size={16} color="inherit" /> : <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={16} height={16} />}
                onClick={async () => {
                  if (!bulkMigHostInfo) return
                  setBulkMigStarting(true)
                  const vmsToMigrate = bulkMigHostInfo.vms.filter((vm: any) => bulkMigSelected.has(vm.vmid))
                  // Build node list for round-robin distribution
                  const nodeList = migTargetNode === '__auto__' ? migNodes.map((n: any) => n.node || n) : [migTargetNode]

                  // Create all jobs — first N as 'pending' (will be started), rest as 'queued'
                  const jobs: typeof bulkMigJobs = vmsToMigrate.map((vm: any, idx: number) => ({
                    vmid: vm.vmid,
                    name: vm.name || vm.vmid,
                    jobId: '',
                    status: idx < BULK_MIG_CONCURRENCY ? 'pending' : 'queued',
                    progress: 0,
                    targetNode: nodeList[idx % nodeList.length],
                  }))

                  // Start the first batch
                  const isVcenterBulk = bulkMigHostInfo.hostType === 'vcenter'
                  const isHypervBulk = bulkMigHostInfo.hostType === 'hyperv'
                  const isNutanixBulk = bulkMigHostInfo.hostType === 'nutanix'
                  const sourceType = bulkMigHostInfo.hostType === 'xcpng' ? 'XCP-ng' : isVcenterBulk ? 'vCenter' : isHypervBulk ? 'Hyper-V' : isNutanixBulk ? 'Nutanix' : 'ESXi'
                  for (let idx = 0; idx < Math.min(BULK_MIG_CONCURRENCY, jobs.length); idx++) {
                    const job = jobs[idx]
                    try {
                      const res = await fetch('/api/v1/migrations', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          sourceConnectionId: bulkMigHostInfo.connectionId,
                          sourceVmId: job.vmid,
                          sourceVmName: job.name,
                          targetConnectionId: migTargetConn,
                          targetNode: job.targetNode,
                          targetStorage: migTargetStorage,
                          networkBridge: migNetworkBridge,
                          migrationType: (isVcenterBulk || isHypervBulk || isNutanixBulk) ? 'cold' : migType,
                          transferMode: (isVcenterBulk || isHypervBulk || isNutanixBulk) ? 'v2v' : migTransferMode,
                          startAfterMigration: migStartAfter,
                        }),
                      })
                      const d = await res.json()
                      if (d.data?.jobId) {
                        job.jobId = d.data.jobId
                        job.status = 'pending'
                        addPCTask({
                          id: `migration-${d.data.jobId}`,
                          type: 'generic',
                          label: `${t('inventoryPage.esxiMigration.migrating')} ${job.name} (${sourceType} → Proxmox)`,
                          detail: t('inventoryPage.esxiMigration.preflight'),
                          progress: 0,
                          status: 'running',
                          createdAt: Date.now(),
                        })
                      } else {
                        job.status = 'failed'
                        job.error = d.error || 'Failed to start'
                      }
                    } catch (e: any) {
                      job.status = 'failed'
                      job.error = e.message
                    }
                  }

                  bulkMigConfigRef.current = {
                    sourceConnectionId: bulkMigHostInfo.connectionId,
                    targetConnectionId: migTargetConn,
                    targetStorage: migTargetStorage,
                    networkBridge: migNetworkBridge,
                    migrationType: isVcenterBulk ? 'cold' : migType,
                    transferMode: isVcenterBulk ? 'v2v' : migTransferMode,
                    startAfterMigration: migStartAfter,
                    sourceType,
                  }
                  setBulkMigJobs(jobs)
                  setBulkMigStarting(false)
                }}
              >
                {t('inventoryPage.esxiMigration.startMigration')} ({bulkMigSelected.size} VMs)
              </Button>
            </>
          ) : (
            <>
              <Button
                startIcon={<i className="ri-subtract-line" />}
                onClick={() => setBulkMigOpen(false)}
                sx={{ textTransform: 'none' }}
              >
                {t('inventoryPage.esxiMigration.minimize')}
              </Button>
              {bulkMigJobs.every(j => ['completed', 'failed', 'cancelled'].includes(j.status)) && (
                <Button onClick={() => { setBulkMigOpen(false); setBulkMigJobs([]); setBulkMigSelected(new Set()) }}>
                  {t('common.close')}
                </Button>
              )}
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
              <img src={esxiMigrateVm?.hostType === 'nutanix' ? '/images/nutanix-logo.svg' : esxiMigrateVm?.hostType === 'xcpng' ? '/images/xcpng-logo.svg' : '/images/esxi-logo.svg'} alt="" width={24} height={24} />
              <i className="ri-arrow-right-line" style={{ fontSize: 20, opacity: 0.4 }} />
              <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={24} height={24} />
            </Box>
            <Box>
              <Typography variant="body2" fontWeight={700}>{esxiMigrateVm?.hostType === 'nutanix' ? 'Nutanix' : esxiMigrateVm?.hostType === 'hyperv' ? 'Hyper-V' : esxiMigrateVm?.hostType === 'xcpng' ? 'XCP-ng' : esxiMigrateVm?.hostType === 'vcenter' ? 'vCenter' : 'VMware'} → Proxmox VE</Typography>
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

    </Box>
  )
}