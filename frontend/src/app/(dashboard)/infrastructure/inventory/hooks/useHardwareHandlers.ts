'use client'

import { useCallback, useMemo, useRef, useState } from 'react'

import { parseVmId, parseNodeId, fetchDetails } from '../helpers'
import type { InventorySelection, DetailsPayload, ActiveDialog } from '../types'
import { useNodeData } from './useNodeData'
import { useCephPerf } from './useCephPerf'
import { useSyslogLive, useCephLogLive } from './useSyslogLive'

/* ------------------------------------------------------------------ */
/* Params                                                              */
/* ------------------------------------------------------------------ */

export interface UseHardwareHandlersParams {
  selection: InventorySelection | null
  data: DetailsPayload | null
  setData: (d: DetailsPayload | null) => void
  t: (key: string, values?: Record<string, any>) => string
  selectedDisk: any
  setSelectedDisk: (d: any) => void
  selectedNetwork: any
  setSelectedNetwork: (d: any) => void
  activeDialog: ActiveDialog
  setActiveDialog: (d: ActiveDialog) => void
}

/* ------------------------------------------------------------------ */
/* Hook                                                                */
/* ------------------------------------------------------------------ */

export function useHardwareHandlers({
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
}: UseHardwareHandlersParams) {

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

  // Migration, clone, bulk action handlers → see useVmActions hook

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
  const backupsLoadedForIdRef = useRef<string | null>(null) // Track which selection ID backups were loaded for
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
  const [guestInfo, setGuestInfo] = useState<{ ip?: string; uptime?: number; pid?: number; diskUsage?: { used: number; total: number }; osInfo?: { type: 'linux' | 'windows' | 'other'; name: string | null; version: string | null; kernel: string | null } | null } | null>(null)
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

  return {
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
  }
}
