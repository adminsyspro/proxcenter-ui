'use client'

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslations } from 'next-intl'
import type { CcmPrereqCapture, CcmRestorePlan, HaResourceCapture, ReplicationJobCapture, SiteRecoveryJobRef } from '@/lib/migration/ccm-prereqs.types'
import { storageSupportsReplication } from '@/lib/migration/ccm-prereqs.types'
import { isSharedStorage } from '@/lib/proxmox/storage'
import { computeNegativeAffinityConflicts, getAffinityPeers, type AffinityPeer, type HaRule, type HaStatusEntry } from '@/lib/proxmox/haAffinity'

import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormControlLabel,
  Checkbox,
  Switch,
  List,
  ListItem,
  ListItemText,
  LinearProgress,
  Box,
  Typography,
  Stack,
  Alert,
  CircularProgress,
  Tabs,
  Tab,
  Tooltip,
  Divider,
  Chip,
  InputAdornment,
  Collapse,
  IconButton,
  useTheme,
} from '@mui/material'

import { useLicense, Features } from '@/contexts/LicenseContext'

import { formatBytes } from '@/utils/format'
import AppDialogTitle from '@/components/ui/AppDialogTitle'

// Types
type NodeInfo = {
  node: string
  status: string
  cpu?: number
  maxcpu?: number
  mem?: number
  maxmem?: number
}

type StorageInfo = {
  storage: string
  type: string
  avail?: number
  total?: number
  shared?: number
  content?: string
}

type LocalDiskInfo = {
  id: string
  storage: string
  size: number
  format?: string
  isLocal: boolean
}

// Types CPU connus avec leur niveau de compatibilité
const CPU_COMPATIBILITY_LEVELS: Record<string, { level: number; label: string; description: string; color: string }> = {
  'qemu64': { level: 1, label: 'qemu64', description: 'Basic QEMU CPU - Maximum compatibility', color: '#9e9e9e' },
  'kvm64': { level: 2, label: 'kvm64', description: 'Basic KVM CPU', color: '#9e9e9e' },
  'x86-64-v2': { level: 3, label: 'x86-64-v2', description: 'Nehalem+ (2008+)', color: '#4caf50' },
  'x86-64-v2-AES': { level: 4, label: 'x86-64-v2-AES', description: 'Westmere+ with AES (2010+) - Recommended', color: '#4caf50' },
  'x86-64-v3': { level: 5, label: 'x86-64-v3', description: 'Haswell+ (2013+)', color: '#2196f3' },
  'x86-64-v4': { level: 6, label: 'x86-64-v4', description: 'Skylake-X+ with AVX-512 (2017+)', color: '#9c27b0' },
  'host': { level: 99, label: 'host', description: 'Pass-through host CPU - No live migration', color: '#f44336' },
}

// Mapping des modèles CPU physiques vers leur génération approximative
const CPU_MODEL_GENERATIONS: Record<string, string> = {
  'Nehalem': 'x86-64-v2',
  'Westmere': 'x86-64-v2-AES',
  'SandyBridge': 'x86-64-v2-AES',
  'IvyBridge': 'x86-64-v2-AES',
  'Haswell': 'x86-64-v3',
  'Broadwell': 'x86-64-v3',
  'Skylake': 'x86-64-v3',
  'Cascadelake': 'x86-64-v3',
  'Icelake': 'x86-64-v4',
  'Sapphirerapids': 'x86-64-v4',
  'Opteron': 'x86-64-v2',
  'EPYC': 'x86-64-v3',
  'EPYC-Rome': 'x86-64-v3',
  'EPYC-Milan': 'x86-64-v3',
  'EPYC-Genoa': 'x86-64-v4',
}

type NodeCpuInfo = {
  node: string
  cpuModel: string
  cpuFlags?: string[]
  sockets: number
  cores: number
  recommendedCpuType: string
}

// Type pour les connexions distantes (autres clusters)
type RemoteConnection = {
  id: string
  name: string
  host: string
  status?: 'online' | 'offline' | 'unknown'
  isCluster?: boolean
  nodes?: NodeInfo[]
}

type MigrateVmDialogProps = {
  open: boolean
  onClose: () => void
  onMigrate: (targetNode: string, online: boolean, targetStorage?: string, withLocalDisks?: boolean) => Promise<void>
  onCrossClusterMigrate?: (params: CrossClusterMigrateParams) => Promise<void>
  connId: string
  currentNode: string
  vmName: string
  vmid: string
  vmStatus: string
  vmType?: 'qemu' | 'lxc'
  isCluster?: boolean // false = standalone node, only show cross-cluster migration
}

export type CrossClusterMigrateParams = {
  targetConnectionId: string
  targetNode: string
  targetVmid?: number
  targetStorage: string
  targetBridge: string
  online: boolean
  deleteSource: boolean
  bwlimit?: number
  restore?: (CcmRestorePlan & { rollbackOnFailure?: boolean })
}

export function mergeCapture(prev: CcmPrereqCapture | null, next: CcmPrereqCapture): CcmPrereqCapture {
  const replication = new Map((prev?.replication || []).map(job => [job.id, job]))
  for (const job of next.replication) {
    if (!replication.has(job.id)) replication.set(job.id, job)
  }

  return {
    ha: prev?.ha ?? next.ha,
    replication: [...replication.values()],
    snapshotsDeleted: [...new Set([...(prev?.snapshotsDeleted || []), ...next.snapshotsDeleted])],
  }
}

/**
 * Short domain name per check code, so a check reads as one line instead of a
 * banner. The issue's own `message` becomes the line's detail and `details` its
 * tooltip, so the wording still comes from the route.
 */
type SourcePrereqs = {
  ha: HaResourceCapture | null
  replication: ReplicationJobCapture[]
  snapshots: string[]
  siteRecoveryJobs: SiteRecoveryJobRef[]
}

/**
 * Detail wording per check code, rendered from the issue's `context` so a row
 * shows the values in the reader's language instead of repeating its own label
 * with the route's English sentence. Codes absent here fall back to `message`.
 */
const CHECK_DETAIL_KEY: Record<string, string> = {
  LXC_NOT_SUPPORTED: 'guestType',
  SOURCE_VM_NOT_FOUND: 'sourceVm',
  HA_RULES_NOT_PORTABLE: 'haRules',
  REPLICATION_CHECK_FAILED: 'checkFailed',
  SNAPSHOTS_CHECK_FAILED: 'checkFailed',
  CLOUD_INIT_DRIVE: 'cloudInit',
  CPU_HOST: 'cpuType',
  CPU_HOST_MISMATCH: 'cpuMismatch',
  CPU_TYPE_NOT_ON_TARGET: 'cpuNotOnTarget',
  CPU_TYPE_CHECK_FAILED: 'cpuCheckFailed',
  TARGET_NODE_NOT_FOUND: 'targetNodeNotFound',
  TARGET_NODE_OFFLINE: 'targetNodeOffline',
  TARGET_CLUSTER_UNREACHABLE: 'targetClusterUnreachable',
  TARGET_STORAGE_NOT_FOUND: 'storageNotFound',
  TARGET_STORAGE_NO_IMAGES: 'storageNoImages',
  TARGET_STORAGE_LOW_SPACE: 'storageLowSpace',
  TARGET_STORAGE_CHECK_FAILED: 'checkFailed',
  TARGET_BRIDGE_NOT_FOUND: 'bridgeNotFound',
  TARGET_NOT_A_BRIDGE: 'notABridge',
  TARGET_NETWORK_CHECK_FAILED: 'checkFailed',
  MTU_MISMATCH: 'mtuMismatch',
  VMID_EXISTS_ON_TARGET: 'vmidExists',
  INSUFFICIENT_CPU: 'insufficientCpu',
  INSUFFICIENT_MEMORY: 'insufficientMemory',
}

const CHECK_LABEL_SLUG: Record<string, string> = {
  HA_ENABLED: 'ha',
  HA_RULES_NOT_PORTABLE: 'haRules',
  SITE_RECOVERY_JOB: 'siteRecovery',
  REPLICATION_CONFIGURED: 'replication',
  REPLICATION_CHECK_FAILED: 'replication',
  SNAPSHOTS_PRESENT: 'snapshots',
  SNAPSHOTS_CHECK_FAILED: 'snapshots',
  CPU_HOST: 'cpu',
  CPU_HOST_MISMATCH: 'cpu',
  CPU_TYPE_NOT_ON_TARGET: 'cpu',
  CPU_TYPE_CHECK_FAILED: 'cpu',
  CLOUD_INIT_DRIVE: 'cloudInit',
  MTU_MISMATCH: 'network',
  TARGET_BRIDGE_NOT_FOUND: 'network',
  TARGET_NOT_A_BRIDGE: 'network',
  TARGET_NETWORK_CHECK_FAILED: 'network',
  TARGET_NODE_NOT_FOUND: 'targetNode',
  TARGET_NODE_OFFLINE: 'targetNode',
  TARGET_CLUSTER_UNREACHABLE: 'targetNode',
  TARGET_STORAGE_NOT_FOUND: 'storage',
  TARGET_STORAGE_NO_IMAGES: 'storage',
  TARGET_STORAGE_LOW_SPACE: 'storage',
  TARGET_STORAGE_CHECK_FAILED: 'storage',
  VMID_EXISTS_ON_TARGET: 'vmid',
  INSUFFICIENT_CPU: 'targetResources',
  INSUFFICIENT_MEMORY: 'targetResources',
  LXC_NOT_SUPPORTED: 'guestType',
  SOURCE_VM_NOT_FOUND: 'sourceVm',
}

const CHECK_ROW_GLYPH: Record<string, { icon: string; color: string }> = {
  error: { icon: 'ri-close-circle-fill', color: 'error.main' },
  warning: { icon: 'ri-alert-fill', color: 'warning.main' },
  success: { icon: 'ri-checkbox-circle-fill', color: 'success.main' },
}

export type CheckRowSeverity = 'error' | 'warning' | 'success' | 'busy'

/**
 * One check on a single line: glyph, domain, detail, and its remediation button.
 *
 * Replaces the stack of MUI Alerts this tab used to render. Six banners for
 * five facts pushed the modal past the viewport, so the detail is ellipsized
 * with the full text in a tooltip rather than wrapped over three lines.
 */
function CheckRow({
  severity,
  label,
  detail,
  tooltip,
  action,
}: {
  severity: CheckRowSeverity
  label?: string
  detail?: string
  tooltip?: string
  action?: React.ReactNode
}) {
  const glyph = CHECK_ROW_GLYPH[severity]

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: 0.75, minHeight: 34 }}>
      {glyph ? (
        // Box, never a raw <i>: a theme colour token in a plain style attribute
        // is dropped without a word.
        <Box component="i" className={glyph.icon} sx={{ fontSize: 16, color: glyph.color, flexShrink: 0 }} />
      ) : (
        <CircularProgress size={14} sx={{ flexShrink: 0 }} />
      )}
      {label && (
        <Typography variant="body2" fontWeight={600} sx={{ flexShrink: 0 }}>
          {label}
        </Typography>
      )}
      <Tooltip title={tooltip && tooltip !== detail ? tooltip : ''} placement="top">
        <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: 1, minWidth: 0 }}>
          {detail}
        </Typography>
      </Tooltip>
      {action}
    </Box>
  )
}

// Tab Panel component
function TabPanel({ children, value, index, ...other }: { children?: React.ReactNode; value: number; index: number; [key: string]: any }) {
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`migrate-tabpanel-${index}`}
      aria-labelledby={`migrate-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ pt: 2 }}>{children}</Box>}
    </div>
  )
}

export function MigrateVmDialog({
  open,
  onClose,
  onMigrate,
  onCrossClusterMigrate,
  connId,
  currentNode,
  vmName,
  vmid,
  vmStatus,
  vmType = 'qemu',
  isCluster = true
}: MigrateVmDialogProps) {
  const t = useTranslations()
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const { hasFeature, loading: licenseLoading } = useLicense()

  // Check if cross-cluster migration feature is available
  const crossClusterAvailable = !licenseLoading && hasFeature(Features.CROSS_CLUSTER_MIGRATION)

  // Tab state: 0 = Local Migration, 1 = Cross-Cluster Migration
  const [activeTab, setActiveTab] = useState(0)
  
  // Common states
  const [migrating, setMigrating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // ========== LOCAL MIGRATION STATES ==========
  const [nodes, setNodes] = useState<NodeInfo[]>([])
  const [nodesLoading, setNodesLoading] = useState(false)
  const [selectedNode, setSelectedNode] = useState<string>('')
  const [onlineMigration, setOnlineMigration] = useState(true)
  const [vmDisks, setVmDisks] = useState<LocalDiskInfo[]>([])
  const [storages, setStorages] = useState<StorageInfo[]>([])
  const [storagesLoading, setStoragesLoading] = useState(false)
  const [selectedStorage, setSelectedStorage] = useState<string>('__current__')
  
  // CPU Compatibility states
  const [nodesCpuInfo, setNodesCpuInfo] = useState<Record<string, NodeCpuInfo>>({})
  const [vmCpuType, setVmCpuType] = useState<string>('')
  const [cpuInfoLoading, setCpuInfoLoading] = useState(false)
  
  // ========== CROSS-CLUSTER MIGRATION STATES ==========
  const [sourceSSHEnabled, setSourceSSHEnabled] = useState<boolean | null>(null)
  const [remoteConnections, setRemoteConnections] = useState<RemoteConnection[]>([])
  const [remoteConnectionsLoading, setRemoteConnectionsLoading] = useState(false)
  const [selectedRemoteConn, setSelectedRemoteConn] = useState<string>('')
  const [remoteNodes, setRemoteNodes] = useState<NodeInfo[]>([])
  const [remoteNodesLoading, setRemoteNodesLoading] = useState(false)
  const [selectedRemoteNode, setSelectedRemoteNode] = useState<string>('')
  const [remoteStorages, setRemoteStorages] = useState<StorageInfo[]>([])
  const [remoteStoragesLoading, setRemoteStoragesLoading] = useState(false)
  const [selectedRemoteStorage, setSelectedRemoteStorage] = useState<string>('')
  const [remoteBridges, setRemoteBridges] = useState<string[]>([])
  const [remoteBridgesLoading, setRemoteBridgesLoading] = useState(false)
  const [selectedRemoteBridge, setSelectedRemoteBridge] = useState<string>('')
  const [targetVmid, setTargetVmid] = useState<number | ''>('')
  const [deleteSourceAfter, setDeleteSourceAfter] = useState(false)
  const [bwLimit, setBwLimit] = useState<number | ''>('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  
  // ========== HA STATE ==========
  const [isHaManaged, setIsHaManaged] = useState(false)
  const [haState, setHaState] = useState<string>('')
  const [haGroup, setHaGroup] = useState<string>('')
  const [haLoading, setHaLoading] = useState(false)
  const [haRules, setHaRules] = useState<HaRule[]>([])
  const [haStatusEntries, setHaStatusEntries] = useState<HaStatusEntry[]>([])

  // ========== PRE-MIGRATION VALIDATION ==========
  type RemediationHint =
    | { kind: 'ha'; sid: string; state?: string; group?: string; reversible: true }
    | { kind: 'replication'; jobs: { id: string; target: string; schedule?: string }[]; reversible: true }
    | { kind: 'snapshots'; names: string[]; reversible: false }

  type ValidationIssue = {
    type: 'error' | 'warning'
    code: string
    message: string
    details?: string
    /** Values behind the message, rendered under the row's own label. */
    context?: Record<string, string | number>
    remediation?: RemediationHint
    siteRecovery?: SiteRecoveryJobRef
  }
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([])
  const [validationLoading, setValidationLoading] = useState(false)
  const [validationDone, setValidationDone] = useState(false)
  const [prereqCapture, setPrereqCapture] = useState<CcmPrereqCapture | null>(null)
  const [prereqBusy, setPrereqBusy] = useState(false)
  const [prereqError, setPrereqError] = useState<string | null>(null)
  const [prereqPendingJobs, setPrereqPendingJobs] = useState<string[]>([])
  const [sourcePrereqs, setSourcePrereqs] = useState<SourcePrereqs | null>(null)
  const [snapshotConfirmOpen, setSnapshotConfirmOpen] = useState(false)
  const [restoreEnabled, setRestoreEnabled] = useState(true)
  const [restoreHaState, setRestoreHaState] = useState<string>('')
  const [restoreReplTarget, setRestoreReplTarget] = useState<string>('')
  const [restoreReplSchedule, setRestoreReplSchedule] = useState<string>('*/15')
  const [restoreReplRate, setRestoreReplRate] = useState<number | ''>('')
  
  // Calculer les stockages actuels uniques
  const currentStorageNames = useMemo(() => {
    const names = [...new Set(vmDisks.map(d => d.storage))]
    return names.sort((a, b) => a.localeCompare(b))
  }, [vmDisks])
  
  // Vérifier si la VM a des disques locaux
  const hasLocalDisks = useMemo(() => {
    return vmDisks.some(d => d.isLocal)
  }, [vmDisks])

  const vmSid = `${vmType === 'lxc' ? 'ct' : 'vm'}:${vmid}`

  // Nœuds hébergeant une ressource en affinité négative avec cette VM (règles HA PVE 9)
  const affinityConflictsByNode = useMemo(() => {
    if (!isHaManaged) return new Map<string, AffinityPeer[]>()

    return computeNegativeAffinityConflicts(vmSid, haRules, haStatusEntries)
  }, [isHaManaged, vmSid, haRules, haStatusEntries])

  // Ressources en affinité positive : le HA manager les co-migre avec la VM
  const positiveAffinityPeers = useMemo(() => {
    if (!isHaManaged) return [] as AffinityPeer[]

    return getAffinityPeers(vmSid, haRules, 'positive', haStatusEntries)
  }, [isHaManaged, vmSid, haRules, haStatusEntries])

  const selectedNodeConflicts = selectedNode ? (affinityConflictsByNode.get(selectedNode) || []) : []
  const selectedNodeBlocked = selectedNodeConflicts.some(p => p.running)

  // Reset states when dialog opens
  useEffect(() => {
    if (open) {
      // If standalone (not cluster), default to cross-cluster tab
      setActiveTab(isCluster ? 0 : 1)
      setError(null)
      setSelectedNode('')
      setSelectedRemoteConn('')
      setSelectedRemoteNode('')
      setSelectedRemoteStorage('')
      setSelectedRemoteBridge('')
      setTargetVmid('')
      setDeleteSourceAfter(false)
      setBwLimit('')
      setIsHaManaged(false)
      setHaState('')
      setHaGroup('')
      setHaRules([])
      setHaStatusEntries([])
      setValidationIssues([])
      setValidationDone(false)
      setPrereqCapture(null)
      setPrereqBusy(false)
      setPrereqError(null)
      setPrereqPendingJobs([])
      setSourcePrereqs(null)
      setSnapshotConfirmOpen(false)
      setRestoreEnabled(true)
      setRestoreHaState('')
      setRestoreReplTarget('')
      setRestoreReplSchedule('*/15')
      setRestoreReplRate('')
    }
  }, [open])

  // Reset deleteSourceAfter when SSH is not enabled on source
  useEffect(() => {
    if (sourceSSHEnabled === false) {
      setDeleteSourceAfter(false)
    }
  }, [sourceSSHEnabled])

  // ========== LOCAL MIGRATION: Load nodes ==========
  useEffect(() => {
    if (!open || !connId || activeTab !== 0) return
    
    const loadNodes = async () => {
      setNodesLoading(true)
      setError(null)
      
      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes`)
        const json = await res.json()
        
        if (json.data && Array.isArray(json.data)) {
          const availableNodes = json.data
            .filter((n: any) => n.node !== currentNode && n.status === 'online' && n.hastate !== 'maintenance')
            .map((n: NodeInfo) => ({
              node: n.node,
              status: n.status,
              cpu: n.cpu,
              maxcpu: n.maxcpu,
              mem: n.mem,
              maxmem: n.maxmem
            }))

          setNodes(availableNodes)

          if (availableNodes.length > 0) {
            const recommended = getRecommendedNode(availableNodes)
            setSelectedNode(recommended.node)
          }
        }
      } catch (e: any) {
        console.error('Error loading nodes:', e)
        setError('Failed to load nodes list')
      } finally {
        setNodesLoading(false)
      }
    }

    loadNodes()
  }, [open, connId, currentNode, activeTab])
  
  // ========== LOCAL MIGRATION: Load VM config to detect disks ==========
  useEffect(() => {
    if (!open || !connId || !vmid || !currentNode) return
    
    const loadVmConfig = async () => {
      try {
        let configRes = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/guests/${vmType}/${encodeURIComponent(currentNode)}/${encodeURIComponent(vmid)}/config`)
        
        if (!configRes.ok) {
          setVmDisks([])
          return
        }
        
        const configJson = await configRes.json()
        const config = configJson.data || {}
        
        const foundDisks: LocalDiskInfo[] = []
        const diskPatterns = vmType === 'qemu' 
          ? /^(scsi|virtio|ide|sata|efidisk|tpmstate)\d+$/
          : /^(rootfs|mp\d+)$/
        
        // Load source node storages to determine which are shared
        const sharedStorages = new Set<string>()
        try {
          const storagesRes = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(currentNode)}/storages`)
          if (storagesRes.ok) {
            const storagesJson = await storagesRes.json()
            for (const s of (storagesJson.data || [])) {
              if (isSharedStorage(s)) sharedStorages.add(s.storage)
            }
          }
        } catch {}

        for (const [key, value] of Object.entries(config)) {
          if (diskPatterns.test(key) && typeof value === 'string') {
            const diskStr = value as string
            const storageMatch = diskStr.match(/^([^:]+):/)

            if (storageMatch) {
              const storageName = storageMatch[1]
              const sizeMatch = diskStr.match(/size=(\d+(?:\.\d+)?)(G|T|M)?/)
              let sizeGB = 0
              if (sizeMatch) {
                sizeGB = Number.parseFloat(sizeMatch[1])
                if (sizeMatch[2] === 'T') sizeGB *= 1024
                else if (sizeMatch[2] === 'M') sizeGB /= 1024
              }

              const formatMatch = diskStr.match(/\.(qcow2|raw|vmdk)/)
              const isLocal = !sharedStorages.has(storageName)

              foundDisks.push({
                id: key,
                storage: storageName,
                size: sizeGB,
                format: formatMatch ? formatMatch[1] : undefined,
                isLocal
              })
            }
          }
        }
        
        setVmDisks(foundDisks)
        
        // Also get CPU type
        const cpuConfig = config.cpu || ''
        const cpuTypeMatch = cpuConfig.match(/^([^,]+)/)
        if (cpuTypeMatch) {
          setVmCpuType(cpuTypeMatch[1])
        } else if (vmType === 'lxc') {
          setVmCpuType('host')
        }
      } catch (e) {
        console.error('Error loading VM config:', e)
        setVmDisks([])
      }
    }
    
    loadVmConfig()
  }, [open, connId, vmid, currentNode, vmType])
  
  // ========== LOAD HA STATUS ==========
  useEffect(() => {
    if (!open || !connId || !vmid) return
    
    const loadHaStatus = async () => {
      setHaLoading(true)
      
      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/ha`)
        
        if (!res.ok) {
          setIsHaManaged(false)
          return
        }
        
        const json = await res.json()
        const resources = json.data?.resources || []

        setHaRules(Array.isArray(json.data?.rules) ? json.data.rules : [])
        setHaStatusEntries(Array.isArray(json.data?.status) ? json.data.status : [])

        // Chercher si cette VM est dans les ressources HA
        // Le format du sid est "vm:VMID" ou "ct:VMID"
        const haResource = resources.find((r: any) => r.sid === vmSid)

        if (haResource) {
          setIsHaManaged(true)
          setHaState(haResource.state || 'unknown')
          setHaGroup(haResource.group || '')
        } else {
          setIsHaManaged(false)
          setHaState('')
          setHaGroup('')
        }
      } catch (e) {
        console.error('Error loading HA status:', e)
        setIsHaManaged(false)
      } finally {
        setHaLoading(false)
      }
    }
    
    loadHaStatus()
  }, [open, connId, vmid, vmType])
  
  // ========== LOCAL MIGRATION: Load storages for selected node ==========
  useEffect(() => {
    if (!open || !connId || !selectedNode || activeTab !== 0) {
      setStorages([])
      return
    }
    
    const loadStorages = async () => {
      setStoragesLoading(true)
      
      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(selectedNode)}/storages`)
        const json = await res.json()
        
        if (json.data && Array.isArray(json.data)) {
          const diskStorages = json.data
            .filter((s: StorageInfo) => {
              const content = s.content || ''
              return content.includes('images') || content.includes('rootdir')
            })
            .map((s: StorageInfo) => ({
              storage: s.storage,
              type: s.type,
              avail: s.avail,
              total: s.total,
              shared: s.shared,
              content: s.content
            }))
          
          setStorages(diskStorages)
        }
      } catch (e) {
        console.error('Error loading storages:', e)
        setStorages([])
      } finally {
        setStoragesLoading(false)
      }
    }
    
    loadStorages()
    setSelectedStorage('__current__')
  }, [open, connId, selectedNode, activeTab])
  
  // ========== CROSS-CLUSTER: Load available connections ==========
  useEffect(() => {
    if (!open || activeTab !== 1) return
    
    const loadConnections = async () => {
      setRemoteConnectionsLoading(true)
      
      try {
        // Only fetch PVE connections (not PBS)
        const res = await fetch('/api/v1/connections?type=pve')
        const json = await res.json()
        
        if (json.data && Array.isArray(json.data)) {
          // Check if source connection has SSH enabled
          const sourceConn = json.data.find((c: any) => c.id === connId)
          if (sourceConn) setSourceSSHEnabled(!!sourceConn.sshEnabled && !!sourceConn.sshConfigured)

          // Filter out current connection and ensure only PVE type
          const otherConnections = json.data
            .filter((c: any) => c.id !== connId && c.type === 'pve')
            .map((c: any) => ({
              id: c.id,
              name: c.name || c.baseUrl,
              host: c.baseUrl,
              status: c.status || 'unknown',
              isCluster: (c.hosts?.length || 0) > 1
            }))

          setRemoteConnections(otherConnections)
        }
      } catch (e) {
        console.error('Error loading connections:', e)
        setRemoteConnections([])
      } finally {
        setRemoteConnectionsLoading(false)
      }
    }
    
    loadConnections()
  }, [open, activeTab, connId])
  
  // ========== CROSS-CLUSTER: Load nodes from selected remote connection ==========
  useEffect(() => {
    if (!open || !selectedRemoteConn || activeTab !== 1) {
      setRemoteNodes([])
      return
    }
    
    const loadRemoteNodes = async () => {
      setRemoteNodesLoading(true)
      
      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(selectedRemoteConn)}/nodes`)
        const json = await res.json()
        
        if (json.data && Array.isArray(json.data)) {
          const availableNodes = json.data
            .filter((n: any) => n.status === 'online' && n.hastate !== 'maintenance')
            .map((n: NodeInfo) => ({
              node: n.node,
              status: n.status,
              cpu: n.cpu,
              maxcpu: n.maxcpu,
              mem: n.mem,
              maxmem: n.maxmem
            }))

          setRemoteNodes(availableNodes)

          if (availableNodes.length > 0) {
            setSelectedRemoteNode(availableNodes[0].node)
          }
        }
      } catch (e) {
        console.error('Error loading remote nodes:', e)
        setRemoteNodes([])
      } finally {
        setRemoteNodesLoading(false)
      }
    }
    
    loadRemoteNodes()
  }, [open, selectedRemoteConn, activeTab])
  
  // ========== CROSS-CLUSTER: Load storages and bridges from remote node ==========
  useEffect(() => {
    if (!open || !selectedRemoteConn || !selectedRemoteNode || activeTab !== 1) {
      setRemoteStorages([])
      setRemoteBridges([])
      return
    }
    
    const loadRemoteResources = async () => {
      setRemoteStoragesLoading(true)
      setRemoteBridgesLoading(true)
      setSelectedRemoteStorage('')
      setSelectedRemoteBridge('')
      
      try {
        // Load storages
        const storageRes = await fetch(`/api/v1/connections/${encodeURIComponent(selectedRemoteConn)}/nodes/${encodeURIComponent(selectedRemoteNode)}/storages`)
        const storageJson = await storageRes.json()
        
        if (storageJson.data && Array.isArray(storageJson.data)) {
          const diskStorages = storageJson.data
            .filter((s: StorageInfo) => {
              const content = s.content || ''
              return content.includes('images') || content.includes('rootdir')
            })
          setRemoteStorages(diskStorages)
          
          if (diskStorages.length > 0 && !selectedRemoteStorage) {
            setSelectedRemoteStorage(diskStorages[0].storage)
          }
        }
        
        // Load network bridges
        const networkRes = await fetch(`/api/v1/connections/${encodeURIComponent(selectedRemoteConn)}/nodes/${encodeURIComponent(selectedRemoteNode)}/network`)
        const networkJson = await networkRes.json()
        
        if (networkJson.data && Array.isArray(networkJson.data)) {
          const bridges = networkJson.data
            .filter((n: any) => n.type === 'bridge' || n.type === 'OVSBridge')
            .map((n: any) => n.iface)
          setRemoteBridges(bridges)
          
          if (bridges.length > 0 && !selectedRemoteBridge) {
            // Default to vmbr0 if exists
            setSelectedRemoteBridge(bridges.includes('vmbr0') ? 'vmbr0' : bridges[0])
          }
        }
      } catch (e) {
        console.error('Error loading remote resources:', e)
      } finally {
        setRemoteStoragesLoading(false)
        setRemoteBridgesLoading(false)
      }
    }
    
    loadRemoteResources()
  }, [open, selectedRemoteConn, selectedRemoteNode, activeTab])
  
  // Helper functions
  const getRecommendedNode = (nodeList: NodeInfo[]): NodeInfo => {
    return nodeList.reduce((best, current) => {
      const bestScore = calculateNodeScore(best)
      const currentScore = calculateNodeScore(current)
      return currentScore > bestScore ? current : best
    }, nodeList[0])
  }
  
  const calculateNodeScore = (node: NodeInfo): number => {
    const cpuFree = node.maxcpu ? (1 - (node.cpu || 0)) * 100 : 50
    const memFree = node.maxmem && node.mem ? ((node.maxmem - node.mem) / node.maxmem) * 100 : 50
    return cpuFree * 0.4 + memFree * 0.6
  }
  
  const formatMemory = (bytes?: number): string => {
    if (!bytes) return '—'
    const gb = bytes / 1024 / 1024 / 1024
    return `${gb.toFixed(1)} GB`
  }
  
  const formatCpu = (cpu?: number): string => {
    if (cpu === undefined) return '—'
    return `${(cpu * 100).toFixed(0)}%`
  }
  
  const getMemoryPercent = (node: NodeInfo): number => {
    if (!node.maxmem || !node.mem) return 0
    return (node.mem / node.maxmem) * 100
  }
  
  const getCpuPercent = (node: NodeInfo): number => {
    return (node.cpu || 0) * 100
  }
  
  const isRecommended = (node: NodeInfo): boolean => {
    if (nodes.length === 0) return false

    // Ne jamais recommander un nœud que le HA manager refusera
    const eligible = nodes.filter(n => !(affinityConflictsByNode.get(n.node) || []).some(p => p.running))
    const pool = eligible.length > 0 ? eligible : nodes

    return getRecommendedNode(pool).node === node.node
  }
  
  // Handle local migration
  const handleLocalMigrate = async () => {
    if (!selectedNode) {
      setError(t('hardware.selectDestinationNode'))
      return
    }
    
    setMigrating(true)
    setError(null)
    
    try {
      const targetStorage = selectedStorage !== '__current__' ? selectedStorage : undefined
      const withLocalDisks = hasLocalDisks || !!targetStorage
      await onMigrate(selectedNode, onlineMigration, targetStorage, withLocalDisks)
      onClose()
    } catch (e: any) {
      setError(e.message || t('hardware.migrationError'))
    } finally {
      setMigrating(false)
    }
  }
  
  // Handle cross-cluster migration
  const handleCrossClusterMigrate = async () => {
    if (!selectedRemoteConn || !selectedRemoteNode || !selectedRemoteStorage || !selectedRemoteBridge) {
      setError('Please fill all required fields')
      return
    }
    
    if (!onCrossClusterMigrate) {
      setError('Cross-cluster migration is not configured')
      return
    }
    
    setMigrating(true)
    setError(null)
    
    try {
      await onCrossClusterMigrate({
        targetConnectionId: selectedRemoteConn,
        targetNode: selectedRemoteNode,
        targetVmid: targetVmid ? Number(targetVmid) : undefined,
        targetStorage: selectedRemoteStorage,
        targetBridge: selectedRemoteBridge,
        online: onlineMigration && vmStatus === 'running',
        deleteSource: deleteSourceAfter,
        bwlimit: bwLimit ? Number(bwLimit) : undefined,
        restore: capturedSomething && restoreEnabled
          ? {
              capture: prereqCapture as CcmPrereqCapture,
              restoreHa: !!prereqCapture?.ha,
              haState: restoreHaState || undefined,
              restoreReplication:
                canRecreateReplication &&
                (prereqCapture?.replication.length ?? 0) > 0 &&
                !!restoreReplTarget,
              replicationTarget: restoreReplTarget || undefined,
              replicationSchedule: restoreReplSchedule || undefined,
              replicationRate: restoreReplRate === '' ? undefined : Number(restoreReplRate),
              rollbackOnFailure: true,
            }
          : capturedSomething
            ? { capture: prereqCapture as CcmPrereqCapture, restoreHa: false, restoreReplication: false, rollbackOnFailure: true }
            : undefined,
      })
      onClose()
    } catch (e: any) {
      setError(e.message || 'Cross-cluster migration failed')
    } finally {
      setMigrating(false)
    }
  }
  
  // Validate cross-cluster migration compatibility
  const validateCrossClusterMigration = async () => {
    if (!selectedRemoteConn || !selectedRemoteNode || !selectedRemoteStorage || !selectedRemoteBridge) {
      return
    }
    
    setValidationLoading(true)
    setValidationIssues([])
    
    try {
      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(connId)}/guests/${vmType}/${encodeURIComponent(currentNode)}/${encodeURIComponent(vmid)}/remote-migrate/check`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetConnectionId: selectedRemoteConn,
            targetNode: selectedRemoteNode,
            targetStorage: selectedRemoteStorage,
            targetBridge: selectedRemoteBridge,
          })
        }
      )
      
      if (res.ok) {
        const data = await res.json()
        setValidationIssues(data.issues || [])
        if (!(data.issues || []).some((issue: ValidationIssue) => issue.code === 'REPLICATION_CONFIGURED')) {
          setPrereqPendingJobs(prev => prev.length > 0 ? [] : prev)
        }
        setValidationDone(true)
      }
    } catch (e) {
      console.error('Validation failed:', e)
    } finally {
      setValidationLoading(false)
    }
  }
  
  // Auto-validate when all required fields are filled
  useEffect(() => {
    if (activeTab === 1 && selectedRemoteConn && selectedRemoteNode && selectedRemoteStorage && selectedRemoteBridge) {
      setValidationDone(false)
      const timer = setTimeout(() => {
        validateCrossClusterMigration()
      }, 500) // Debounce
      return () => clearTimeout(timer)
    }
  }, [activeTab, selectedRemoteConn, selectedRemoteNode, selectedRemoteStorage, selectedRemoteBridge])
  
  const isVmRunning = vmStatus === 'running'
  const selectedRemoteConnInfo = remoteConnections.find(c => c.id === selectedRemoteConn)


  const selectedRemoteStorageType = remoteStorages.find(s => s.storage === selectedRemoteStorage)?.type
  const canRecreateReplication =
    storageSupportsReplication(selectedRemoteStorageType) && remoteNodes.length > 1

  const capturedSomething = !!prereqCapture && (
    !!prereqCapture.ha || prereqCapture.replication.length > 0
  )

  useEffect(() => {
    setRestoreReplTarget(remoteNodes.find(n => n.node !== selectedRemoteNode)?.node || '')
  }, [selectedRemoteNode, remoteNodes])

  // HA, replication and snapshots belong to the SOURCE guest, so they are read
  // as soon as the tab opens. Waiting for a cluster, node, storage and bridge to
  // be picked before saying the migration is impossible anyway is backwards.
  const loadSourcePrereqs = useCallback(async () => {
    if (!connId || vmType !== 'qemu') return
    try {
      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(connId)}/guests/${vmType}/${encodeURIComponent(currentNode)}/${encodeURIComponent(vmid)}/remote-migrate/prepare`,
      )
      if (!res.ok) return
      const data = await res.json()
      setSourcePrereqs({
        ha: data?.ha ?? null,
        replication: Array.isArray(data?.replication) ? data.replication : [],
        snapshots: Array.isArray(data?.snapshots) ? data.snapshots : [],
        siteRecoveryJobs: Array.isArray(data?.siteRecoveryJobs) ? data.siteRecoveryJobs : [],
      })
    } catch {
      // Best effort: the full preflight reports these too once a target is set.
    }
  }, [connId, vmType, currentNode, vmid])

  useEffect(() => {
    if (!open || activeTab !== 1) return
    loadSourcePrereqs()
  }, [open, activeTab, loadSourcePrereqs])

  const runPrepare = async (payload: {
    removeHa?: boolean
    removeReplication?: boolean
    removeSnapshots?: string[]
  }) => {
    setPrereqBusy(true)
    setPrereqError(null)
    try {
      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(connId)}/guests/${vmType}/${encodeURIComponent(currentNode)}/${encodeURIComponent(vmid)}/remote-migrate/prepare`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      const data = await res.json().catch(() => ({}))

      // A partial failure still returns the capture: keep it, it is the only way
      // back to the pre-migration state.
      if (data?.capture) {
        setPrereqCapture(prev => mergeCapture(prev, data.capture))
        if (data.capture.ha?.state && !restoreHaState) setRestoreHaState(data.capture.ha.state)
      }
      setPrereqPendingJobs(data?.pending?.replicationJobs || [])

      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)

      if (data?.cleared?.ha) setIsHaManaged(false)

      // Refresh both views: the source-only read drives the rows before a target
      // is picked, the preflight once one is.
      await Promise.all([loadSourcePrereqs(), validateCrossClusterMigration()])
    } catch (e: any) {
      setPrereqError(e?.message || String(e))
    } finally {
      setPrereqBusy(false)
    }
  }

  // One action per row rather than a single "clear everything" button: the
  // grouped button needed an explanatory banner of its own, and a row already
  // says which prerequisite it is about.
  const handleRemoveHa = () => runPrepare({ removeHa: true })
  const handleRemoveReplication = () => runPrepare({ removeReplication: true })

  const handleDeleteSnapshots = async () => {
    await runPrepare({ removeSnapshots: snapshotNames })
    setSnapshotConfirmOpen(false)
  }


  // The same rows the preflight would produce, built from the source-only read
  // so they can be shown and acted on before a target exists.
  const sourceIssues = useMemo<ValidationIssue[]>(() => {
    if (!sourcePrereqs) return []
    const rows: ValidationIssue[] = []

    if (sourcePrereqs.ha) {
      rows.push({
        type: 'error',
        code: 'HA_ENABLED',
        message: '',
        remediation: {
          kind: 'ha',
          sid: sourcePrereqs.ha.sid,
          state: sourcePrereqs.ha.state,
          group: sourcePrereqs.ha.group,
          reversible: true,
        },
      })
    }
    if (sourcePrereqs.replication.length > 0) {
      rows.push({
        type: 'error',
        code: 'REPLICATION_CONFIGURED',
        message: '',
        remediation: {
          kind: 'replication',
          jobs: sourcePrereqs.replication.map(job => ({ id: job.id, target: job.target, schedule: job.schedule })),
          reversible: true,
        },
      })
    }
    if (sourcePrereqs.snapshots.length > 0) {
      rows.push({
        type: 'error',
        code: 'SNAPSHOTS_PRESENT',
        message: '',
        remediation: { kind: 'snapshots', names: sourcePrereqs.snapshots, reversible: false },
      })
    }
    for (const job of sourcePrereqs.siteRecoveryJobs) {
      // ⛔ No remediation on purpose: a Site Recovery job can cover several
      // guests, so it must never be cleared on this one's behalf.
      rows.push({ type: 'warning', code: 'SITE_RECOVERY_JOB', message: '', siteRecovery: job })
    }

    return rows
  }, [sourcePrereqs])

  // Errors before warnings, order otherwise preserved (Array.sort is stable).
  const orderedIssues = useMemo(() => {
    const list = validationDone ? validationIssues : sourceIssues

    return [...list].sort((a, b) => (a.type === b.type ? 0 : a.type === 'error' ? -1 : 1))
  }, [validationDone, validationIssues, sourceIssues])

  // Gated on the rows actually SHOWN, not on the preflight list alone. The
  // source-only read can hold blockers before the preflight has ever run, and
  // the preflight clears its list while re-running, which briefly re-enabled the
  // button under the user's cursor with every blocker still in place.
  const hasValidationErrors =
    orderedIssues.some(i => i.type === 'error') || prereqPendingJobs.length > 0

  // Must come from the SAME list the rows are built from: before the preflight
  // has run the rows come from the source-only read, and deriving the names from
  // the preflight list instead opened the confirmation with nothing in it.
  const snapshotNames = useMemo(() => {
    const remediation = orderedIssues.find(i => i.remediation?.kind === 'snapshots')?.remediation

    return remediation?.kind === 'snapshots' ? remediation.names : []
  }, [orderedIssues])

  const replicationPending = prereqPendingJobs.length > 0

  const checkLabel = (issue: ValidationIssue) => {
    const slug = CHECK_LABEL_SLUG[issue.code]

    return slug ? t(`hardware.crossCluster.prereq.check.${slug}`) : undefined
  }

  // A replication job PVE is still clearing in the background reads as busy,
  // not as a failure: it lifts on its own within about a minute.
  const checkSeverity = (issue: ValidationIssue): CheckRowSeverity =>
    issue.code === 'REPLICATION_CONFIGURED' && replicationPending ? 'busy' : issue.type

  /**
   * A row already names its domain, so the detail carries the actual values
   * rather than a sentence repeating the label. The route's full wording stays
   * in the tooltip.
   */
  const checkDetail = (issue: ValidationIssue) => {
    const remediation = issue.remediation

    if (remediation?.kind === 'replication') {
      if (replicationPending) {
        return t('hardware.crossCluster.prereq.replicationPending', { jobs: prereqPendingJobs.join(', ') })
      }

      return remediation.jobs.map(job => `${job.id} \u2192 ${job.target}`).join(', ')
    }

    if (remediation?.kind === 'snapshots') return remediation.names.join(', ')

    const job = issue.siteRecovery
    if (job) {
      return job.otherVmids.length > 0
        ? t('hardware.crossCluster.prereq.siteRecoveryShared', { name: job.name, count: job.otherVmids.length })
        : t('hardware.crossCluster.prereq.siteRecoveryOnly', { name: job.name })
    }

    if (remediation?.kind === 'ha') {
      const group = remediation.group || haGroup

      return [
        remediation.state,
        group ? t('hardware.crossCluster.prereq.check.inGroup', { group }) : '',
      ].filter(Boolean).join(' ')
    }

    const key = CHECK_DETAIL_KEY[issue.code]
    if (key && issue.context) {
      // A route sent from an older build has the code but not the values: keep
      // its sentence rather than rendering a message with holes in it.
      try {
        return t(`hardware.crossCluster.prereq.detail.${key}`, issue.context)
      } catch {
        return issue.message
      }
    }

    return issue.message
  }

  const checkTooltip = (issue: ValidationIssue) => {
    const job = issue.siteRecovery
    if (job) {
      if (job.otherVmids.length > 0) {
        return t('hardware.crossCluster.prereq.siteRecoveryHintShared', { vmids: job.otherVmids.join(', ') })
      }

      return job.byTag
        ? t('hardware.crossCluster.prereq.siteRecoveryHintTag')
        : t('hardware.crossCluster.prereq.siteRecoveryHint')
    }

    return [issue.message, issue.details].filter(Boolean).join(' ')
  }

  const prereqButton = (label: string, onClick: () => void, destructive: boolean) => (
    <Button
      size="small"
      // Outlined, never contained: a solid button on every row outweighed the
      // dialog's own primary action at the bottom.
      variant="outlined"
      color={destructive ? 'error' : 'primary'}
      onClick={onClick}
      disabled={prereqBusy || validationLoading}
      startIcon={prereqBusy ? <CircularProgress size={12} /> : undefined}
      sx={{ height: 24, fontSize: '0.7rem', textTransform: 'none', whiteSpace: 'nowrap', minWidth: 'auto', px: 1.25, flexShrink: 0 }}
    >
      {label}
    </Button>
  )

  const checkAction = (issue: ValidationIssue) => {
    const remediation = issue.remediation
    if (!remediation) return null

    if (remediation.kind === 'ha') {
      return prereqButton(t('hardware.crossCluster.prereq.removeHa'), handleRemoveHa, false)
    }
    if (remediation.kind === 'replication') {
      // Nothing to offer while PVE finishes its background removal.
      if (replicationPending) return null

      return prereqButton(
        t('hardware.crossCluster.prereq.removeReplication', { count: remediation.jobs.length }),
        handleRemoveReplication,
        false,
      )
    }

    // ⛔ Never deletes directly: snapshot deletion cannot be undone, so it always
    // goes through the confirmation that names every snapshot.
    return prereqButton(
      t('hardware.crossCluster.prereq.removeSnapshots', { count: remediation.names.length }),
      () => setSnapshotConfirmOpen(true),
      true,
    )
  }

  const validatePrereqsRef = useRef(validateCrossClusterMigration)
  useEffect(() => {
    validatePrereqsRef.current = validateCrossClusterMigration
  })

  // Keyed on the CONTENT of the pending list, not on the array identity: every
  // poll re-runs the preflight, which re-sets this state, and an identity dep
  // would tear the interval down and reset `attempts` on each pass, defeating
  // the cap and re-arming the poll forever.
  const prereqPendingKey = prereqPendingJobs.join(',')

  useEffect(() => {
    if (!open || !prereqPendingKey) return

    let attempts = 0
    let checking = false
    const interval = setInterval(async () => {
      if (checking) return
      checking = true
      attempts += 1
      if (attempts >= 12) clearInterval(interval)
      try {
        await validatePrereqsRef.current()
      } finally {
        checking = false
      }
    }, 10_000)

    return () => clearInterval(interval)
  }, [prereqPendingKey, open])
  
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <AppDialogTitle onClose={onClose} icon={<i className="ri-swap-box-line" style={{ fontSize: 22 }} />}>
        {t('hardware.migrateTitle', { vmName, vmid })}
      </AppDialogTitle>
      
      <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 3 }}>
        {isCluster ? (
          <Tabs
            value={activeTab}
            onChange={(_, v) => setActiveTab(v)}
            sx={{
              minHeight: 42,
              '& .MuiTab-root': {
                minHeight: 42,
                textTransform: 'none',
                fontWeight: 500,
              }
            }}
          >
            <Tab
              icon={<i className="ri-server-line" style={{ fontSize: 16 }} />}
              iconPosition="start"
              label={t('hardware.localMigration')}
              sx={{ gap: 1 }}
            />
            <Tab
              icon={<i className="ri-global-line" style={{ fontSize: 16, opacity: crossClusterAvailable ? 1 : 0.4 }} />}
              iconPosition="start"
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, opacity: crossClusterAvailable ? 1 : 0.5 }}>
                  {t('hardware.crossCluster.tabLabel')}
                  {!crossClusterAvailable && (
                    <Chip
                      label="Enterprise"
                      size="small"
                      sx={{
                        height: 20,
                        fontSize: '0.65rem',
                        fontWeight: 600,
                        bgcolor: 'primary.main',
                        color: 'primary.contrastText'
                      }}
                    />
                  )}
                </Box>
              }
              sx={{ gap: 1 }}
              disabled={!onCrossClusterMigrate || !crossClusterAvailable}
            />
          </Tabs>
        ) : (
          /* Standalone: only cross-cluster migration available */
          <Box sx={{ py: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className="ri-global-line" style={{ fontSize: 18 }} />
            <Typography variant="subtitle2" fontWeight={600}>
              {t('hardware.crossCluster.tabLabel')}
            </Typography>
            {!crossClusterAvailable && (
              <Chip
                label="Enterprise"
                size="small"
                sx={{
                  height: 20,
                  fontSize: '0.65rem',
                  fontWeight: 600,
                  bgcolor: 'primary.main',
                  color: 'primary.contrastText'
                }}
              />
            )}
          </Box>
        )}
      </Box>
      
      <DialogContent sx={{ minHeight: 400 }}>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        
        {/* ========== TAB 0: LOCAL MIGRATION ========== */}
        <TabPanel value={activeTab} index={0}>
          <Stack spacing={2}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2" sx={{ opacity: 0.6 }}>{t('hardware.currentNode')}</Typography>
              <Box component="span" sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width: 14, height: 14, flexShrink: 0 }}>
                <img src={isDark ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={14} height={14} style={{ opacity: 0.8 }} />
                <Box sx={{ position: 'absolute', bottom: -2, right: -2, width: 7, height: 7, borderRadius: '50%', bgcolor: 'success.main', border: '1.5px solid', borderColor: 'background.paper' }} />
              </Box>
              <Typography variant="body2" fontWeight={600}>{currentNode}</Typography>
            </Box>
            
            {/* Warning for local disks */}
            {hasLocalDisks && (
              <Alert severity="warning" icon={<i className="ri-alert-line" />}>
                <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
                  {t('hardware.localDiskMigration')}
                </Typography>
                {vmDisks.filter(d => d.isLocal).map((disk, idx) => (
                  <Typography key={idx} variant="caption" component="div" sx={{ opacity: 0.9 }}>
                    {disk.storage}:{vmid}/{disk.id}{disk.format ? `.${disk.format}` : ''} ({disk.size.toFixed(2)} GiB)
                  </Typography>
                ))}
              </Alert>
            )}
            
            <Typography variant="subtitle2">
              {t('hardware.selectDestinationNodeLabel')}
            </Typography>
            
            {nodesLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                <CircularProgress size={32} />
              </Box>
            ) : nodes.length === 0 ? (
              <Alert severity="warning">
                {t('hardware.noNodeAvailable')}
              </Alert>
            ) : (
              <Stack spacing={0.5}>
                {nodes.map((node) => {
                  const cpuPercent = getCpuPercent(node)
                  const memPercent = getMemoryPercent(node)
                  const recommended = isRecommended(node)

                  return (
                    <Box
                      key={node.node}
                      onClick={() => setSelectedNode(node.node)}
                      sx={{
                        px: 1.25,
                        py: 0.75,
                        border: '1px solid',
                        borderColor: selectedNode === node.node ? 'primary.main' : 'divider',
                        borderRadius: 1,
                        cursor: 'pointer',
                        bgcolor: selectedNode === node.node ? 'action.selected' : 'transparent',
                        '&:hover': { bgcolor: 'action.hover' },
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                      }}
                    >
                      <Box component="span" sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width: 16, height: 16, flexShrink: 0 }}>
                        <img src={isDark ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={16} height={16} style={{ opacity: 0.8 }} />
                        <Box sx={{ position: 'absolute', bottom: -2, right: -2, width: 8, height: 8, borderRadius: '50%', bgcolor: node.status === 'online' ? 'success.main' : 'error.main', border: '1.5px solid', borderColor: 'background.paper' }} />
                      </Box>
                      <Typography variant="body2" fontWeight={600} sx={{ fontSize: 13, minWidth: 80, flexShrink: 0 }}>
                        {node.node}
                      </Typography>
                      {recommended && (
                        <Tooltip title={t('hardware.recommended')} arrow>
                          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', color: '#ffc107' }}>
                            <i className="ri-star-fill" style={{ fontSize: 12 }} />
                          </Box>
                        </Tooltip>
                      )}
                      {(affinityConflictsByNode.get(node.node) || []).length > 0 && (
                        <Tooltip
                          title={t('hardware.haAffinity.nodeTooltip', {
                            peers: (affinityConflictsByNode.get(node.node) || []).map(p => p.sid).join(', ')
                          })}
                          arrow
                        >
                          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', color: 'error.main' }}>
                            <i className="ri-shield-cross-line" style={{ fontSize: 12 }} />
                          </Box>
                        </Tooltip>
                      )}

                      <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <Typography variant="caption" sx={{ fontSize: '0.6rem', opacity: 0.6 }}>CPU</Typography>
                          <Box sx={{ width: 48, height: 6, bgcolor: 'action.hover', borderRadius: 0, overflow: 'hidden' }}>
                            <Box sx={{ height: '100%', width: `${cpuPercent}%`, background: cpuPercent > 0 ? 'linear-gradient(90deg, #22c55e 0%, #eab308 50%, #ef4444 100%)' : 'transparent', backgroundSize: cpuPercent > 0 ? `${(100 / cpuPercent) * 100}% 100%` : '100% 100%' }} />
                          </Box>
                          <Typography variant="caption" sx={{ fontSize: '0.55rem', opacity: 0.5, minWidth: 22, textAlign: 'right' }}>{formatCpu(node.cpu)}</Typography>
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <Typography variant="caption" sx={{ fontSize: '0.6rem', opacity: 0.6 }}>RAM</Typography>
                          <Box sx={{ width: 48, height: 6, bgcolor: 'action.hover', borderRadius: 0, overflow: 'hidden' }}>
                            <Box sx={{ height: '100%', width: `${memPercent}%`, background: memPercent > 0 ? 'linear-gradient(90deg, #22c55e 0%, #eab308 50%, #ef4444 100%)' : 'transparent', backgroundSize: memPercent > 0 ? `${(100 / memPercent) * 100}% 100%` : '100% 100%' }} />
                          </Box>
                          <Typography variant="caption" sx={{ fontSize: '0.55rem', opacity: 0.5, minWidth: 22, textAlign: 'right' }}>{Math.round(memPercent)}%</Typography>
                        </Box>
                      </Box>
                    </Box>
                  )
                })}
              </Stack>
            )}
            
            {/* Conflits d'affinité HA (PVE 9, règles « keep separated ») */}
            {selectedNodeConflicts.length > 0 && (
              <Alert
                severity={selectedNodeBlocked ? 'error' : 'warning'}
                icon={<i className="ri-shield-cross-line" />}
              >
                <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
                  {t('hardware.haAffinity.conflictTitle')}
                </Typography>
                {selectedNodeConflicts.map((peer) => (
                  <Typography key={peer.sid} variant="caption" component="div" sx={{ opacity: 0.9 }}>
                    {peer.running
                      ? t('hardware.haAffinity.conflictBlocked', { peer: peer.sid, node: selectedNode, rule: peer.rule })
                      : t('hardware.haAffinity.conflictStopped', { peer: peer.sid, node: selectedNode, rule: peer.rule })}
                  </Typography>
                ))}
              </Alert>
            )}

            {positiveAffinityPeers.length > 0 && (
              <Alert severity="info" icon={<i className="ri-links-line" />}>
                <Typography variant="caption">
                  {t('hardware.haAffinity.positiveInfo', { peers: positiveAffinityPeers.map(p => p.sid).join(', ') })}
                </Typography>
              </Alert>
            )}

            {/* Storage selector */}
            {nodes.length > 0 && selectedNode && (
              <>
                <Typography variant="subtitle2" sx={{ mt: 2 }}>
                  {t('hardware.targetStorageLabel')}
                </Typography>
                
                {storagesLoading ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
                    <CircularProgress size={16} />
                    <Typography variant="caption" color="text.secondary">
                      {t('hardware.loadingStorages')}
                    </Typography>
                  </Box>
                ) : (
                  <FormControl fullWidth size="small">
                    <Select
                      value={selectedStorage}
                      onChange={(e) => setSelectedStorage(e.target.value)}
                    >
                      <MenuItem value="__current__">
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <i className="ri-layout-line" style={{ fontSize: 16, opacity: 0.7 }} />
                          <Typography variant="body2">
                            {t('hardware.keepCurrentStorage', { storage: currentStorageNames.join(', ') || '...' })}
                          </Typography>
                        </Box>
                      </MenuItem>
                      
                      {storages.length > 0 && <Divider sx={{ my: 0.5 }} />}

                      {storages.map((storage) => {
                        const usedBytes = (storage.total || 0) - (storage.avail || 0)
                        const usagePercent = storage.total ? (usedBytes / storage.total) * 100 : 0
                        const usageColor = usagePercent > 90 ? '#ef4444' : usagePercent > 70 ? '#eab308' : '#22c55e'
                        const isCurrent = currentStorageNames.includes(storage.storage)

                        return (
                        <MenuItem key={storage.storage} value={storage.storage}>
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 2 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <i className="ri-hard-drive-2-line" style={{ fontSize: 16, opacity: 0.7 }} />
                              <Typography variant="body2">{storage.storage}</Typography>
                              {isCurrent && (
                                <Chip
                                  label={t('hardware.currentLabel')}
                                  size="small"
                                  color="info"
                                  variant="outlined"
                                  sx={{ height: 16, fontSize: '0.6rem' }}
                                />
                              )}
                              {!storage.shared && (
                                <Chip
                                  label="local"
                                  size="small"
                                  sx={{ height: 16, fontSize: '0.6rem', bgcolor: 'action.hover' }}
                                />
                              )}
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                              <Typography variant="caption" sx={{ fontSize: '0.55rem', opacity: 0.5, minWidth: 70, textAlign: 'right' }}>
                                {formatBytes(storage.avail)} free
                              </Typography>
                              <Box sx={{ width: 48, height: 4, bgcolor: 'action.hover', borderRadius: 0.5, overflow: 'hidden' }}>
                                <Box sx={{ height: '100%', width: `${usagePercent}%`, bgcolor: usageColor, borderRadius: 0.5 }} />
                              </Box>
                              <Typography variant="caption" sx={{ fontSize: '0.55rem', opacity: 0.5, minWidth: 22, textAlign: 'right' }}>{Math.round(usagePercent)}%</Typography>
                            </Box>
                          </Box>
                        </MenuItem>
                      )})}
                    </Select>
                  </FormControl>
                )}
              </>
            )}
            
            {nodes.length > 0 && (
              <>
                <Divider sx={{ my: 1 }} />
                
                <FormControlLabel
                  control={
                    <Checkbox 
                      checked={onlineMigration} 
                      onChange={(e) => setOnlineMigration(e.target.checked)} 
                      size="small"
                      disabled={!isVmRunning}
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="body2">{t('hardware.onlineMigration')}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {isVmRunning
                          ? t('hardware.vmWillStayActive')
                          : t('hardware.onlineOnlyFeature')}
                      </Typography>
                    </Box>
                  }
                />
              </>
            )}
          </Stack>
        </TabPanel>
        
        {/* ========== TAB 1: CROSS-CLUSTER MIGRATION ========== */}
        <TabPanel value={activeTab} index={1}>
          <Stack spacing={2.5}>
            {/* Warning for LXC containers */}
            {vmType === 'lxc' && (
              <Alert severity="warning" icon={<i className="ri-alert-line" />}>
                <Typography variant="body2" fontWeight={600}>
                  {t('hardware.crossCluster.lxcNotSupported')}
                </Typography>
                <Typography variant="caption">
                  {t('hardware.crossCluster.lxcNotSupportedDesc')}
                </Typography>
              </Alert>
            )}

            {/* Warning: SSH not enabled on source — VM will stay locked */}
            {sourceSSHEnabled === false && (
              <Alert severity="info" icon={<i className="ri-information-line" />}>
                <Typography variant="body2" fontWeight={500} sx={{ mb: 0.5 }}>
                  {t('hardware.crossCluster.sshNotEnabled')}
                </Typography>
                <Typography variant="caption" sx={{ display: 'block' }}>
                  {t('hardware.crossCluster.sshNotEnabledDesc')}
                </Typography>
                <Typography variant="caption" component="code" sx={{ display: 'block', mt: 0.5, fontFamily: '"JetBrains Mono", monospace', bgcolor: 'action.hover', px: 1, py: 0.5, borderRadius: 0.5 }}>
                  {t('hardware.crossCluster.sshUnlockCommand', { vmid })}
                </Typography>
              </Alert>
            )}
            
            {/* Source info */}
            <Box sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 1.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                {t('hardware.crossCluster.source')}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className="ri-computer-line" style={{ fontSize: 20 }} />
                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body2" fontWeight={600}>{vmName}</Typography>
                      {isHaManaged && (
                        <Chip
                          icon={<i className="ri-shield-check-line" style={{ fontSize: 12 }} />}
                          label={`HA: ${haState || 'managed'}`}
                          size="small"
                          color="error"
                          sx={{ height: 20, fontSize: '0.65rem' }}
                        />
                      )}
                    </Box>
                    <Typography variant="caption" sx={{ opacity: 0.7 }}>
                      VMID {vmid} • {currentNode}
                    </Typography>
                  </Box>
                </Box>
                {vmDisks.length > 0 && (
                  <Chip
                    icon={<i className="ri-hard-drive-2-line" style={{ fontSize: 12 }} />}
                    label={`${vmDisks.length} disk${vmDisks.length > 1 ? 's' : ''} (${vmDisks.reduce((acc, d) => acc + d.size, 0).toFixed(1)} GiB)`}
                    size="small"
                    variant="outlined"
                    sx={{ height: 22, fontSize: '0.65rem' }}
                  />
                )}
              </Box>
            </Box>
            
            <Box sx={{ display: 'flex', justifyContent: 'center', my: -1 }}>
              <i className="ri-arrow-down-line" style={{ fontSize: 24, opacity: 0.3 }} />
            </Box>
            
            {/* Target Cluster Selection */}
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className="ri-global-line" style={{ fontSize: 16 }} />
                {t('hardware.crossCluster.targetCluster')}
              </Typography>
              
              {remoteConnectionsLoading ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 2 }}>
                  <CircularProgress size={20} />
                  <Typography variant="body2" color="text.secondary">{t('hardware.crossCluster.loadingConnections')}</Typography>
                </Box>
              ) : remoteConnections.length === 0 ? (
                <Alert severity="warning">
                  {t('hardware.crossCluster.noConnectionsAvailable')}
                </Alert>
              ) : (
                <FormControl fullWidth size="small">
                  <InputLabel>{t('hardware.crossCluster.selectTargetCluster')}</InputLabel>
                  <Select
                    value={selectedRemoteConn}
                    onChange={(e) => {
                      setSelectedRemoteConn(e.target.value)
                      setSelectedRemoteNode('')
                      setSelectedRemoteStorage('')
                      setSelectedRemoteBridge('')
                    }}
                    label={t('hardware.crossCluster.selectTargetCluster')}
                  >
                    {remoteConnections.map((conn) => (
                      <MenuItem key={conn.id} value={conn.id}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                          <Box component="span" sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width: 14, height: 14, flexShrink: 0 }}>
                            {conn.isCluster
                              ? <i className="ri-server-fill" style={{ fontSize: 14, opacity: 0.8 }} />
                              : <img src={isDark ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={14} height={14} style={{ opacity: 0.8 }} />
                            }
                            <Box sx={{ position: 'absolute', bottom: -2, right: -2, width: 7, height: 7, borderRadius: '50%', bgcolor: conn.status === 'offline' ? 'error.main' : 'success.main', border: '1.5px solid', borderColor: 'background.paper' }} />
                          </Box>
                          <Typography variant="body2" fontWeight={500}>{conn.name}</Typography>
                          <Typography variant="caption" sx={{ opacity: 0.6, ml: 'auto' }}>{conn.host}</Typography>
                        </Box>
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
            </Box>
            
            {/* Target Node Selection */}
            {selectedRemoteConn && (
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <img src={isDark ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={14} height={14} style={{ opacity: 0.7 }} />
                  {t('hardware.crossCluster.targetNode')}
                </Typography>
                
                {remoteNodesLoading ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
                    <CircularProgress size={16} />
                    <Typography variant="caption" color="text.secondary">{t('hardware.crossCluster.loadingNodes')}</Typography>
                  </Box>
                ) : remoteNodes.length === 0 ? (
                  <Alert severity="warning" sx={{ py: 0.5 }}>
                    {t('hardware.noNodeAvailable')}
                  </Alert>
                ) : (
                  <FormControl fullWidth size="small">
                    <InputLabel>{t('hardware.crossCluster.selectTargetNode')}</InputLabel>
                    <Select
                      value={selectedRemoteNode}
                      onChange={(e) => {
                        setSelectedRemoteNode(e.target.value)
                        setSelectedRemoteStorage('')
                        setSelectedRemoteBridge('')
                      }}
                      label={t('hardware.crossCluster.selectTargetNode')}
                    >
                      {remoteNodes.map((node) => {
                        const cpuPct = (node.cpu || 0) * 100
                        const memPct = node.maxmem && node.mem ? (node.mem / node.maxmem) * 100 : 0
                        return (
                        <MenuItem key={node.node} value={node.node}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                            <Box component="span" sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width: 14, height: 14, flexShrink: 0 }}>
                              <img src={isDark ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={14} height={14} style={{ opacity: 0.8 }} />
                              <Box sx={{ position: 'absolute', bottom: -2, right: -2, width: 7, height: 7, borderRadius: '50%', bgcolor: node.status === 'online' ? 'success.main' : 'error.main', border: '1.5px solid', borderColor: 'background.paper' }} />
                            </Box>
                            <Typography variant="body2" fontWeight={500}>{node.node}</Typography>
                            <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1.5 }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <Typography variant="caption" sx={{ fontSize: '0.6rem', opacity: 0.6 }}>CPU</Typography>
                                <Box sx={{ width: 40, height: 4, bgcolor: 'action.hover', borderRadius: 0, overflow: 'hidden' }}>
                                  <Box sx={{ height: '100%', width: `${cpuPct}%`, background: cpuPct > 0 ? 'linear-gradient(90deg, #22c55e 0%, #eab308 50%, #ef4444 100%)' : 'transparent', backgroundSize: cpuPct > 0 ? `${(100 / cpuPct) * 100}% 100%` : '100% 100%' }} />
                                </Box>
                                <Typography variant="caption" sx={{ fontSize: '0.55rem', opacity: 0.5 }}>{cpuPct.toFixed(0)}%</Typography>
                              </Box>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <Typography variant="caption" sx={{ fontSize: '0.6rem', opacity: 0.6 }}>RAM</Typography>
                                <Box sx={{ width: 40, height: 4, bgcolor: 'action.hover', borderRadius: 0, overflow: 'hidden' }}>
                                  <Box sx={{ height: '100%', width: `${memPct}%`, background: memPct > 0 ? 'linear-gradient(90deg, #22c55e 0%, #eab308 50%, #ef4444 100%)' : 'transparent', backgroundSize: memPct > 0 ? `${(100 / memPct) * 100}% 100%` : '100% 100%' }} />
                                </Box>
                                <Typography variant="caption" sx={{ fontSize: '0.55rem', opacity: 0.5 }}>{Math.round(memPct)}%</Typography>
                              </Box>
                            </Box>
                          </Box>
                        </MenuItem>
                        )
                      })}
                    </Select>
                  </FormControl>
                )}
              </Box>
            )}
            
            {/* Target Storage and Bridge */}
            {selectedRemoteNode && (
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <i className="ri-hard-drive-2-line" style={{ fontSize: 16 }} />
                    {t('hardware.crossCluster.targetStorage')}
                  </Typography>
                  
                  {remoteStoragesLoading ? (
                    <CircularProgress size={16} />
                  ) : (
                    <FormControl fullWidth size="small">
                      <InputLabel>{t('hardware.crossCluster.storage')}</InputLabel>
                      <Select
                        value={selectedRemoteStorage}
                        onChange={(e) => setSelectedRemoteStorage(e.target.value)}
                        label={t('hardware.crossCluster.storage')}
                      >
                        {remoteStorages.map((s) => (
                          <MenuItem key={s.storage} value={s.storage}>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                              <Typography variant="body2">{s.storage}</Typography>
                              <Chip label={s.type} size="small" sx={{ height: 16, fontSize: '0.6rem' }} />
                            </Box>
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  )}
                </Box>
                
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <i className="ri-git-branch-line" style={{ fontSize: 16 }} />
                    {t('hardware.crossCluster.targetBridge')}
                  </Typography>
                  
                  {remoteBridgesLoading ? (
                    <CircularProgress size={16} />
                  ) : (
                    <FormControl fullWidth size="small">
                      <InputLabel>{t('hardware.crossCluster.networkBridge')}</InputLabel>
                      <Select
                        value={selectedRemoteBridge}
                        onChange={(e) => setSelectedRemoteBridge(e.target.value)}
                        label={t('hardware.crossCluster.networkBridge')}
                      >
                        {remoteBridges.map((bridge) => (
                          <MenuItem key={bridge} value={bridge}>
                            {bridge}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  )}
                </Box>
              </Box>
            )}
            
            {/* Checks, one compact row each. Errors first. Source-side
                prerequisites show before any target is picked. */}
            {(orderedIssues.length > 0 || prereqError || (selectedRemoteNode && selectedRemoteStorage && selectedRemoteBridge)) && (
              <Box sx={{ mt: 1 }}>
                <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, overflow: 'hidden' }}>
                  {validationLoading && !validationDone ? (
                    <CheckRow severity="busy" detail={t('hardware.crossCluster.validating')} />
                  ) : (
                    <Stack divider={<Divider />}>
                      {orderedIssues.map((issue, idx) => (
                        <CheckRow
                          key={`${issue.code}-${idx}`}
                          severity={checkSeverity(issue)}
                          label={checkLabel(issue)}
                          detail={checkDetail(issue)}
                          tooltip={checkTooltip(issue)}
                          action={checkAction(issue)}
                        />
                      ))}
                      {validationDone && validationIssues.length === 0 && (
                        <CheckRow
                          severity="success"
                          label={t('hardware.crossCluster.prereq.check.allClear')}
                          detail={t('hardware.crossCluster.validationSuccess')}
                        />
                      )}
                      {prereqError && (
                        <CheckRow
                          severity="error"
                          label={t('hardware.crossCluster.prereq.check.actionFailed')}
                          detail={prereqError}
                        />
                      )}
                    </Stack>
                  )}
                </Box>

                {capturedSomething && selectedRemoteStorage && (
                  <Box sx={{ mt: 1, p: 1.5, borderRadius: 1.5, border: 1, borderColor: 'divider' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                      <FormControlLabel
                        sx={{ mr: 0 }}
                        control={<Switch size="small" checked={restoreEnabled} onChange={e => setRestoreEnabled(e.target.checked)} />}
                        label={<Typography variant="caption">{t('hardware.crossCluster.prereq.restoreSwitch')}</Typography>}
                      />
                      {restoreEnabled && prereqCapture?.ha && (
                        <FormControl size="small" sx={{ minWidth: 160 }}>
                          <InputLabel id="ccm-restore-ha-state-label">{t('hardware.crossCluster.prereq.restoreHaState')}</InputLabel>
                          <Select
                            labelId="ccm-restore-ha-state-label"
                            label={t('hardware.crossCluster.prereq.restoreHaState')}
                            value={restoreHaState}
                            onChange={e => setRestoreHaState(e.target.value)}
                          >
                            {['started', 'stopped', 'enabled', 'disabled', 'ignored'].map(state => (
                              <MenuItem key={state} value={state}>{state}</MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      )}
                    </Box>
                    {restoreEnabled && (prereqCapture?.replication.length ?? 0) > 0 && (
                      canRecreateReplication ? (
                        <>
                          <Box sx={{ display: 'flex', gap: 1, mt: 1.5, flexWrap: 'wrap' }}>
                            <FormControl size="small" sx={{ minWidth: 150 }}>
                              <InputLabel id="ccm-restore-replication-target-label">{t('hardware.crossCluster.prereq.restoreReplicationTarget')}</InputLabel>
                              <Select
                                labelId="ccm-restore-replication-target-label"
                                label={t('hardware.crossCluster.prereq.restoreReplicationTarget')}
                                value={restoreReplTarget}
                                onChange={e => setRestoreReplTarget(e.target.value)}
                              >
                                {remoteNodes.filter(n => n.node !== selectedRemoteNode).map(n => (
                                  <MenuItem key={n.node} value={n.node}>{n.node}</MenuItem>
                                ))}
                              </Select>
                            </FormControl>
                            <TextField
                              size="small"
                              sx={{ width: 140 }}
                              label={t('hardware.crossCluster.prereq.restoreReplicationSchedule')}
                              value={restoreReplSchedule}
                              onChange={e => setRestoreReplSchedule(e.target.value)}
                            />
                            <TextField
                              size="small"
                              sx={{ width: 130 }}
                              type="number"
                              label={t('hardware.crossCluster.prereq.restoreReplicationRate')}
                              value={restoreReplRate}
                              onChange={e => setRestoreReplRate(e.target.value === '' ? '' : Number(e.target.value))}
                              inputProps={{ min: 0 }}
                            />
                          </Box>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                            {t('hardware.crossCluster.prereq.restoreReplicationFullSync')}
                          </Typography>
                        </>
                      ) : (
                        <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 1 }}>
                          {!storageSupportsReplication(selectedRemoteStorageType)
                            ? t('hardware.crossCluster.prereq.restoreReplicationUnavailableStorage', { storage: selectedRemoteStorage })
                            : t('hardware.crossCluster.prereq.restoreReplicationUnavailableNodes')}
                        </Typography>
                      )
                    )}
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                      {t('hardware.crossCluster.prereq.rollbackNote')}
                    </Typography>
                  </Box>
                )}
              </Box>
            )}
            
            {/* Advanced Options */}
            {selectedRemoteNode && (
              <>
                <Box 
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  sx={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: 1, 
                    cursor: 'pointer',
                    opacity: 0.8,
                    '&:hover': { opacity: 1 }
                  }}
                >
                  <i className={showAdvanced ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} />
                  <Typography variant="body2" fontWeight={500}>{t('hardware.crossCluster.advancedOptions')}</Typography>
                </Box>
                
                <Collapse in={showAdvanced}>
                  <Stack spacing={2} sx={{ pl: 2, pt: 1 }}>
                    <TextField
                      label={t('hardware.crossCluster.targetVmId')}
                      type="number"
                      size="small"
                      value={targetVmid}
                      onChange={(e) => setTargetVmid(e.target.value ? Number.parseInt(e.target.value) : '')}
                      helperText={t('hardware.crossCluster.targetVmIdHelp')}
                      inputProps={{ min: 100, max: 999999999 }}
                    />
                    
                    <TextField
                      label={t('hardware.crossCluster.bandwidthLimit')}
                      type="number"
                      size="small"
                      value={bwLimit}
                      onChange={(e) => setBwLimit(e.target.value ? Number.parseInt(e.target.value) : '')}
                      helperText={t('hardware.crossCluster.bandwidthLimitHelp')}
                      InputProps={{
                        endAdornment: <InputAdornment position="end">KiB/s</InputAdornment>
                      }}
                    />
                    
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={deleteSourceAfter}
                          onChange={(e) => setDeleteSourceAfter(e.target.checked)}
                          size="small"
                          disabled={sourceSSHEnabled === false}
                        />
                      }
                      label={
                        <Box>
                          <Typography variant="body2" sx={{ color: sourceSSHEnabled === false ? 'text.disabled' : undefined }}>
                            {t('hardware.crossCluster.deleteSourceVm')}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {sourceSSHEnabled === false
                              ? t('hardware.crossCluster.deleteSourceRequiresSsh')
                              : t('hardware.crossCluster.deleteSourceVmDesc')
                            }
                          </Typography>
                        </Box>
                      }
                    />
                  </Stack>
                </Collapse>
              </>
            )}
            
            {/* Online migration option */}
            {selectedRemoteNode && (
              <>
                <Divider />
                
                <FormControlLabel
                  control={
                    <Checkbox 
                      checked={onlineMigration} 
                      onChange={(e) => setOnlineMigration(e.target.checked)} 
                      size="small"
                      disabled={!isVmRunning}
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="body2">{t('hardware.crossCluster.liveMigration')}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {isVmRunning
                          ? t('hardware.crossCluster.liveMigrationDesc')
                          : t('hardware.crossCluster.vmStopped')}
                      </Typography>
                    </Box>
                  }
                />
              </>
            )}
          </Stack>
        </TabPanel>
        <Dialog open={snapshotConfirmOpen} onClose={() => !prereqBusy && setSnapshotConfirmOpen(false)} maxWidth="xs" fullWidth aria-labelledby="ccm-snapshot-confirm-title">
          <DialogTitle id="ccm-snapshot-confirm-title">{t('hardware.crossCluster.prereq.snapshotConfirmTitle')}</DialogTitle>
          <DialogContent>
            <Typography variant="body2">{t('hardware.crossCluster.prereq.snapshotConfirmBody', { vmName })}</Typography>
            <List dense>
              {snapshotNames.map(name => <ListItem key={name}><ListItemText primary={name} /></ListItem>)}
            </List>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setSnapshotConfirmOpen(false)} disabled={prereqBusy}>{t('hardware.cancel')}</Button>
            <Button
              variant="contained"
              color="error"
              onClick={handleDeleteSnapshots}
              disabled={prereqBusy || validationLoading}
              startIcon={prereqBusy ? <CircularProgress size={14} /> : <i className="ri-delete-bin-line" />}
            >
              {t('hardware.crossCluster.prereq.snapshotConfirmAction')}
            </Button>
          </DialogActions>
        </Dialog>
      </DialogContent>
      
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={migrating}>
          {t('hardware.cancel')}
        </Button>
        
        {activeTab === 0 ? (
          <Button 
            variant="contained" 
            onClick={handleLocalMigrate} 
            disabled={migrating || !selectedNode || nodes.length === 0 || selectedNodeBlocked}
            startIcon={migrating ? <CircularProgress size={16} /> : <i className="ri-swap-box-line" />}
          >
            {migrating ? t('hardware.migrating') : t('hardware.migrate')}
          </Button>
        ) : (
          <Button 
            variant="contained" 
            onClick={handleCrossClusterMigrate} 
            disabled={migrating || !selectedRemoteConn || !selectedRemoteNode || !selectedRemoteStorage || !selectedRemoteBridge || vmType === 'lxc' || isHaManaged || hasValidationErrors || validationLoading || prereqBusy}
            startIcon={migrating ? <CircularProgress size={16} /> : <i className="ri-global-line" />}
          >
            {migrating ? t('hardware.crossCluster.migrating') : t('hardware.crossCluster.startMigration')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}

export default MigrateVmDialog
