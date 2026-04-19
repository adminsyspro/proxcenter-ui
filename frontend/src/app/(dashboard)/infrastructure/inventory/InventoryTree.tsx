'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useVirtualizer } from '@tanstack/react-virtual'
import { isSharedStorage } from '@/lib/proxmox/storage'

import { SimpleTreeView, TreeItem } from '@mui/x-tree-view'
import { 
  Alert,
  Box,
  Button,
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
  IconButton, 
  InputAdornment,
  InputLabel,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Select,
  FormControlLabel,
  LinearProgress,
  Snackbar,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip, 
  Typography,
  useTheme
} from '@mui/material'
// RemixIcon replacements for @mui/icons-material
const RefreshIcon = (props: any) => <i className="ri-refresh-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const SearchIcon = (props: any) => <i className="ri-search-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const ClearIcon = (props: any) => <i className="ri-close-circle-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const PlayArrowIcon = (props: any) => <i className="ri-play-fill" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const StopIcon = (props: any) => <i className="ri-stop-fill" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const PowerSettingsNewIcon = (props: any) => <i className="ri-shut-down-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
/* PauseIcon, TerminalIcon, MoveUpIcon, ContentCopyIcon, DescriptionIcon → ./components/TreeDialogs */

import EntityTagManager from './components/EntityTagManager'
import { useTagColors } from '@/contexts/TagColorContext'
import { useTaskTracker } from '@/hooks/useTaskTracker'
import { MigrateVmDialog, CrossClusterMigrateParams } from '@/components/MigrateVmDialog'
import { CloneVmDialog } from '@/components/hardware/CloneVmDialog'
import { StatusIcon, NodeIcon, ClusterIcon, getVmIcon } from './components/TreeIcons'
import { VmItem } from './components/VmItem'
import TreeDialogs from './components/TreeDialogs'

// Re-export for external consumers (e.g. InventoryDetails.tsx)
export { StatusIcon, NodeIcon, ClusterIcon, getVmIcon } from './components/TreeIcons'

/* StatusIcon, NodeIcon, ClusterIcon → ./components/TreeIcons */

export type InventorySelection =
  | { type: 'root'; id: 'root' } // Nœud racine de l'inventaire
  | { type: 'cluster'; id: string } // id = connectionId
  | { type: 'node'; id: string } // id = connectionId:node
  | { type: 'vm'; id: string } // id = connectionId:node:type:vmid
  | { type: 'storage'; id: string } // (réservé)
  | { type: 'pbs'; id: string } // id = pbsConnectionId (serveur PBS)
  | { type: 'datastore'; id: string } // id = pbsConnectionId:datastoreName
  | { type: 'pbs-datastore'; id: string } // alias for datastore
  | { type: 'ext'; id: string } // id = connectionId (external hypervisor host)
  | { type: 'extvm'; id: string } // id = connectionId:vmid (external hypervisor VM)
  | { type: 'storage-root'; id: 'storage-root' }
  | { type: 'network-root'; id: 'network-root' }
  | { type: 'backup-root'; id: 'backup-root' }
  | { type: 'migration-root'; id: 'migration-root' }

export type ViewMode = 'tree' | 'vms' | 'hosts' | 'pools' | 'tags' | 'templates' | 'favorites'

export type AllVmItem = {
  connId: string
  connName: string
  node: string
  type: 'qemu' | 'lxc'
  vmid: string
  name: string
  status?: string
  cpu?: number
  maxcpu?: number
  mem?: number
  maxmem?: number
  disk?: number
  maxdisk?: number
  uptime?: number | string | null
  ip?: string | null
  snapshots?: number
  tags?: string[]
  pool?: string
  template?: boolean
  hastate?: string
  hagroup?: string
  lock?: string  // PVE lock type: "migrate", "backup", "snapshot", etc.
  isCluster?: boolean
  osInfo?: { type: 'linux' | 'windows' | 'other'; name: string | null; version: string | null; kernel: string | null } | null
  isMigrating?: boolean  // true si la VM est en cours de migration
  migrationTarget?: string  // node cible de la migration
}

export type HostItem = {
  key: string
  node: string
  connId: string
  connName: string
  status?: string   // node status: online, offline, etc.
  cpu?: number      // node-level CPU usage (fraction 0-1)
  mem?: number      // node-level used memory (bytes)
  maxmem?: number   // node-level total memory (bytes)
  vms: AllVmItem[]
}

export type PoolItem = {
  pool: string
  vms: AllVmItem[]
}

export type TagItem = {
  tag: string
  vms: AllVmItem[]
}

type Props = {
  selected: InventorySelection | null
  onSelect: (sel: InventorySelection | null) => void
  onRefreshRef?: (refresh: () => void) => void  // callback pour exposer la fonction refresh
  onOptimisticVmStatusRef?: (fn: (connId: string, vmid: string, status: string) => void) => void
  onOptimisticVmTagsRef?: (fn: (connId: string, vmid: string, tags: string[]) => void) => void
  viewMode?: ViewMode  // viewMode contrôlé depuis le parent
  onViewModeChange?: (mode: ViewMode) => void  // callback quand le mode change
  onAllVmsChange?: (vms: AllVmItem[]) => void  // callback pour passer toutes les VMs
  onHostsChange?: (hosts: HostItem[]) => void  // callback pour passer les hosts groupés
  onPoolsChange?: (pools: PoolItem[]) => void  // callback pour passer les pools groupés
  onTagsChange?: (tags: TagItem[]) => void    // callback pour passer les tags groupés
  onPbsServersChange?: (pbs: TreePbsServer[]) => void  // callback pour passer les PBS
  favorites?: Set<string>  // favoris partagés depuis le parent
  onToggleFavorite?: (vm: { connId: string; node: string; type: string; vmid: string | number; name?: string }) => void
  migratingVmIds?: Set<string>  // Set de vmIds en cours de migration (format: "connId:vmid")
  pendingActionVmIds?: Set<string>  // Set de vmIds avec action en cours (format: "connId:vmid")
  onRefresh?: () => void  // callback pour refresh l'arbre
  refreshLoading?: boolean  // loading pendant le refresh
  onCollapse?: () => void  // callback pour collapse/expand le panneau
  isCollapsed?: boolean  // état collapsed du panneau
  allowedViewModes?: Set<ViewMode>  // RBAC-filtered view modes (all if not provided)
  onCreateVm?: (connId: string, node: string) => void  // callback to open Create VM dialog
  onCreateLxc?: (connId: string, node: string) => void  // callback to open Create LXC dialog
  onNodeAction?: (connId: string, node: string, action: 'reboot' | 'shutdown') => void
  onStoragesChange?: (storages: TreeClusterStorage[]) => void
  onExternalHypervisorsChange?: (hypervisors: { id: string; name: string; type: string; vms?: { vmid: string; name: string; status: string; cpu?: number; memory_size_MiB?: number; guest_OS?: string }[] }[]) => void
  showVmId?: boolean
  onToggleShowVmId?: () => void
}

type Connection = {
  id: string
  name: string
}

type NodeItem = {
  node: string
  status?: string
  id?: string
}

type GuestItem = {
  type: string
  node: string
  vmid: string | number
  name?: string
  status?: string
}

type TreeCluster = {
  connId: string
  name: string
  isCluster: boolean  // true si cluster multi-nodes, false si standalone
  cephHealth?: string // HEALTH_OK, HEALTH_WARN, HEALTH_ERR ou undefined
  sshEnabled?: boolean
  nodes: {
    node: string
    status?: string
    ip?: string
    maintenance?: string
    cpu?: number      // node-level CPU usage (fraction 0-1)
    mem?: number      // node-level used memory (bytes)
    maxmem?: number   // node-level total memory (bytes)
    vms: { type: string; vmid: string; name: string; status?: string; cpu?: number; maxcpu?: number; mem?: number; maxmem?: number; disk?: number; maxdisk?: number; uptime?: number; pool?: string; tags?: string; template?: boolean; hastate?: string; hagroup?: string; lock?: string }[]
  }[]
}

export type TreeStorageItem = {
  storage: string
  node: string
  type: string
  shared: boolean
  content: string[]
  used: number
  total: number
  usedPct: number
  status: string
  enabled: boolean
  path?: string
}

export type TreeClusterStorage = {
  connId: string
  connName: string
  isCluster: boolean
  nodes: Array<{
    node: string
    status: string
    storages: TreeStorageItem[]
  }>
  sharedStorages: TreeStorageItem[]
}

type TreePbsDatastore = {
  name: string
  path?: string
  comment?: string
  total: number
  used: number
  available: number
  usagePercent: number
  backupCount: number
  vmCount: number
  ctCount: number
  hostCount: number
}

export type TreePbsServer = {
  connId: string
  name: string
  status: 'online' | 'offline'
  version?: string
  uptime?: number
  datastores: TreePbsDatastore[]
  stats: {
    totalSize: number
    totalUsed: number
    datastoreCount: number
    backupCount: number
  }
}

/* ---- Tooltip helpers for nodes, clusters & VMs ---- */

const TOOLTIP_WIDTH = 240

const tooltipSlotProps = {
  tooltip: {
    sx: {
      bgcolor: 'background.paper',
      color: 'text.primary',
      border: '1px solid',
      borderColor: 'divider',
      borderRadius: 1.5,
      boxShadow: 3,
      p: 0,
      width: TOOLTIP_WIDTH,
      overflow: 'hidden',
    }
  }
} as const

function TooltipHeader({ icon, iconElement, label, color }: { icon?: string; iconElement?: React.ReactNode; label: string; color: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1.5, py: 0.75, bgcolor: color }}>
      {iconElement || <i className={icon} style={{ fontSize: 14, color: '#fff' }} />}
      <Typography variant="caption" sx={{ fontWeight: 600, fontSize: 12, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </Typography>
    </Box>
  )
}

function UsageBar({ value, label, icon }: { value: number; label: string; icon: string }) {
  const color = value >= 90 ? 'error.main' : value >= 60 ? 'warning.main' : 'primary.main'

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
      <i className={icon} style={{ fontSize: 12, opacity: 0.6, width: 14, flexShrink: 0 }} />
      <Typography variant="caption" sx={{ minWidth: 24, fontSize: 11 }}>{label}</Typography>
      <LinearProgress
        variant="determinate"
        value={Math.min(value, 100)}
        sx={{
          flex: 1, height: 4, borderRadius: 2,
          bgcolor: 'action.hover',
          '& .MuiLinearProgress-bar': { borderRadius: 2, bgcolor: color }
        }}
      />
      <Typography variant="caption" sx={{ minWidth: 28, textAlign: 'right', fontSize: 11 }}>{value.toFixed(0)}%</Typography>
    </Box>
  )
}

function TooltipRow({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
      <i className={icon} style={{ fontSize: 12, opacity: 0.6, width: 14, flexShrink: 0 }} />
      <Typography variant="caption" sx={{ fontSize: 11 }}>{children}</Typography>
    </Box>
  )
}

function NodeTooltipContent({ name, status, cpu, mem, maxmem, maintenance }: {
  name: string; status?: string; cpu?: number; mem?: number; maxmem?: number; maintenance?: string
}) {
  const theme = useTheme()
  const logoSrc = theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'
  const statusColor = status === 'online' ? '#4caf50' : status === 'offline' ? '#f44336' : '#9e9e9e'
  const cpuPct = cpu ? cpu * 100 : 0
  const memPct = mem && maxmem ? (mem / maxmem) * 100 : 0

  return (
    <Box>
      <TooltipHeader
        iconElement={<img src={logoSrc} alt="" style={{ width: 14, height: 14 }} />}
        label={name} color="#5b6abf"
      />
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, px: 1.5, py: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: statusColor, flexShrink: 0, ml: '4px' }} />
          <Typography variant="caption" sx={{ textTransform: 'capitalize', fontSize: 11 }}>
            {maintenance ? `maintenance (${maintenance})` : status || 'unknown'}
          </Typography>
        </Box>
        {cpu != null && <UsageBar value={cpuPct} label="CPU" icon="ri-cpu-line" />}
        {mem != null && maxmem ? <UsageBar value={memPct} label="RAM" icon="ri-ram-line" /> : null}
      </Box>
    </Box>
  )
}

function ClusterTooltipContent({ name, nodes }: {
  name: string; nodes: TreeCluster['nodes']
}) {
  const onlineCount = nodes.filter(n => n.status === 'online').length
  const totalMem = nodes.reduce((acc, n) => acc + (n.maxmem || 0), 0)
  const usedMem = nodes.reduce((acc, n) => acc + (n.mem || 0), 0)
  const avgCpu = nodes.length ? nodes.reduce((acc, n) => acc + (n.cpu || 0), 0) / nodes.length * 100 : 0
  const memPct = totalMem ? (usedMem / totalMem) * 100 : 0

  return (
    <Box>
      <TooltipHeader icon="ri-server-fill" label={name} color="#2e7d6f" />
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, px: 1.5, py: 1 }}>
        <TooltipRow icon="ri-node-tree">{onlineCount}/{nodes.length} nodes online</TooltipRow>
        {avgCpu > 0 && <UsageBar value={avgCpu} label="CPU" icon="ri-cpu-line" />}
        {totalMem > 0 && <UsageBar value={memPct} label="RAM" icon="ri-ram-line" />}
      </Box>
    </Box>
  )
}

type VmContextMenu = {
  mouseX: number
  mouseY: number
  connId: string
  node: string
  type: string
  vmid: string
  name: string
  status?: string
  isCluster: boolean  // pour savoir si on peut migrer
  template?: boolean  // pour savoir si c'est un template
  sshEnabled?: boolean  // pour afficher unlock
} | null

type NodeContextMenu = {
  mouseX: number
  mouseY: number
  connId: string
  node: string
  maintenance?: string
  sshEnabled?: boolean
} | null

/* getVmIcon, TagChip, VmItem, VmItemVariant, VmItemProps → ./components/VmItem */

function itemKey(sel: InventorySelection) {
  return `${sel.type}:${sel.id}`
}

function selectionFromItemId(itemId: string): InventorySelection | null {
  const [type, ...rest] = String(itemId).split(':')
  const id = rest.join(':')

  // Cas spécial pour root
  if (type === 'root') {
    return { type: 'root', id: 'root' }
  }

  if (!id) return null

  if (type === 'cluster' || type === 'node' || type === 'vm' || type === 'storage' || type === 'pbs' || type === 'datastore' || type === 'ext' || type === 'ext-type' || type === 'extvm') {
    return { type: type as any, id } as InventorySelection
  }

  if (type === 'net-conn' || type === 'net-node' || type === 'net-vlan' || type === 'storage-cluster' || type === 'storage-node') {
    return { type: type as any, id } as InventorySelection
  }

return null
}

function safeJson<T>(x: any): T {
  // backend renvoie parfois {data: ...}
  return (x?.data ?? x) as T
}

export default function InventoryTree({ selected, onSelect, onRefreshRef, onOptimisticVmStatusRef, onOptimisticVmTagsRef, viewMode: controlledViewMode, onViewModeChange, onAllVmsChange, onHostsChange, onPoolsChange, onTagsChange, onPbsServersChange, favorites: propFavorites, onToggleFavorite, migratingVmIds, pendingActionVmIds, onRefresh, refreshLoading, onCollapse, isCollapsed, allowedViewModes, onCreateVm, onCreateLxc, onNodeAction, onStoragesChange, onExternalHypervisorsChange, showVmId, onToggleShowVmId }: Props) {
  const t = useTranslations()
  const theme = useTheme()
  const router = useRouter()
  const { trackTask } = useTaskTracker()
  const { getColor: getTagColor, loadConnection } = useTagColors()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [clusters, setClusters] = useState<TreeCluster[]>([])
  const [pbsServers, setPbsServers] = useState<TreePbsServer[]>([])
  const [externalHypervisors, setExternalHypervisors] = useState<{ id: string; name: string; type: string; vms?: { vmid: string; name: string; status: string; cpu?: number; memory_size_MiB?: number; guest_OS?: string; vcenterDatacenter?: string; vcenterCluster?: string; vcenterHost?: string; vcenterHostStatus?: 'ok' | 'warn' | 'crit' | 'unknown'; vcenterHostConnectionState?: string; vcenterHostPowerState?: string }[]; vmsLoading?: boolean; vmsLoadError?: string }[]>([])
  const [clusterStorages, setClusterStorages] = useState<TreeClusterStorage[]>([])
  const [reloadTick, setReloadTick] = useState(0)

  // Load PVE tag color overrides for all connections
  useEffect(() => {
    clusters.forEach(c => loadConnection(c.connId))
  }, [clusters, loadConnection])

  // ProxCenter entity tags (clusters + nodes) loaded from DB
  const [entityTagsMap, setEntityTagsMap] = useState<Map<string, { tags: string[]; type: 'cluster' | 'node'; connId: string; name: string; node?: string }>>(new Map())

  useEffect(() => {
    // Load entity tags from /api/v1/tags/entities (raw SQL, no Prisma select issues)
    const loadEntityTags = async () => {
      const map = new Map<string, { tags: string[]; type: 'cluster' | 'node'; connId: string; name: string; node?: string }>()
      try {
        const res = await fetch('/api/v1/tags/entities', { cache: 'no-store' })
        if (res.ok) {
          const json = await res.json()
          for (const e of json?.data || []) {
            const tags = e.tags ? String(e.tags).split(';').filter(Boolean) : []
            if (tags.length > 0) {
              if (e.entityType === 'cluster') {
                map.set(`cluster:${e.id}`, { tags, type: 'cluster', connId: e.id, name: e.name })
              } else {
                map.set(`node:${e.connectionId}:${e.node}`, { tags, type: 'node', connId: e.connectionId, name: e.node, node: e.node })
              }
            }
          }
        }
      } catch {}
      setEntityTagsMap(map)
    }
    loadEntityTags()
  }, [reloadTick])
  
  // Helper pour vérifier si une VM est en migration
  const isVmMigrating = useCallback((connId: string, vmid: string) => {
    if (!migratingVmIds) return false
    
return migratingVmIds.has(`${connId}:${vmid}`)
  }, [migratingVmIds])

  // Helper pour vérifier si une VM a une action en cours
  const isVmPendingAction = useCallback((connId: string, vmid: string) => {
    if (!pendingActionVmIds) return false
    return pendingActionVmIds.has(`${connId}:${vmid}`)
  }, [pendingActionVmIds])

  // Favoris : utiliser les props si fournies, sinon état local
  const [localFavorites, setLocalFavorites] = useState<Set<string>>(new Set())
  const favorites = propFavorites ?? localFavorites
  
  // Mode d'affichage: 'tree' (arbre), 'vms' (liste VMs), 'hosts' (par hôte), 'pools' (par pool), 'tags' (par tag), 'favorites' (favoris)
  const [internalViewMode, setInternalViewMode] = useState<ViewMode>(controlledViewMode ?? 'tree')
  
  // Utiliser le viewMode contrôlé s'il est fourni, sinon l'état interne
  const viewMode = controlledViewMode ?? internalViewMode
  
  // Fonction pour changer le viewMode (met à jour l'état interne et notifie le parent)
  const setViewMode = (mode: ViewMode) => {
    setInternalViewMode(mode)
    onViewModeChange?.(mode)
  }
  
  // Synchroniser l'état interne si le viewMode contrôlé change
  useEffect(() => {
    if (controlledViewMode !== undefined && controlledViewMode !== internalViewMode) {
      setInternalViewMode(controlledViewMode)
    }
  }, [controlledViewMode])

  // Controlled tree expansion state
  const [manualExpandedItems, setManualExpandedItems] = useState<string[]>([])
  const programmaticExpand = useRef(false)
  const expandingRef = useRef(false)
  const virtualScrollRef = useRef<HTMLDivElement>(null)
  const [isHydrated, setIsHydrated] = useState(false)

  // Sections collapsed (pour les modes hosts, pools, tags)
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set(['storage', 'pbs', 'migrate-ext']))

  // Storage tree expanded items (persisted)
  const [storageExpandedItems, setStorageExpandedItems] = useState<string[]>([])

  // Backup (PBS) tree expanded items (persisted)
  const [backupExpandedItems, setBackupExpandedItems] = useState<string[]>([])

  // Migration tree expanded items (persisted)
  const [migrationExpandedItems, setMigrationExpandedItems] = useState<string[]>([])

  // Sections principales (accordéon : une seule ouverte à la fois)
  const mainSections = ['pve', 'storage', 'pbs', 'migrate-ext']

  const toggleSection = (key: string) => {
    setCollapsedSections(prev => {
      const isMainSection = mainSections.includes(key)
      const wasCollapsed = prev.has(key)

      if (isMainSection && wasCollapsed) {
        // Ouvrir cette section, fermer les autres sections principales
        const next = new Set(prev)
        mainSections.forEach(s => next.add(s))
        next.delete(key)
        return next
      }

      // Toggle simple (fermer, ou sections non-principales comme host:xxx, pool:xxx)
      const next = new Set(prev)
      if (wasCollapsed) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  // Hydrate from localStorage
  useEffect(() => {
    try {
      const savedExpanded = localStorage.getItem('inventoryExpandedItems')
      if (savedExpanded) setManualExpandedItems(JSON.parse(savedExpanded))

      const savedCollapsed = localStorage.getItem('inventoryCollapsedSections')
      if (savedCollapsed) {
        const parsed = JSON.parse(savedCollapsed)
        setCollapsedSections(new Set(parsed))
      }

      const savedStorageExpanded = localStorage.getItem('inventoryStorageExpandedItems')
      if (savedStorageExpanded) setStorageExpandedItems(JSON.parse(savedStorageExpanded))

      const savedBackupExpanded = localStorage.getItem('inventoryBackupExpandedItems')
      if (savedBackupExpanded) setBackupExpandedItems(JSON.parse(savedBackupExpanded))

      const savedMigrationExpanded = localStorage.getItem('inventoryMigrationExpandedItems')
      if (savedMigrationExpanded) setMigrationExpandedItems(JSON.parse(savedMigrationExpanded))
    } catch {}
    setIsHydrated(true)
  }, [])

  // Persist viewMode (only when not externally controlled)
  useEffect(() => {
    if (isHydrated && controlledViewMode === undefined) localStorage.setItem('inventoryViewMode', viewMode)
  }, [viewMode, isHydrated, controlledViewMode])

  // Persist expandedItems
  useEffect(() => {
    if (isHydrated) localStorage.setItem('inventoryExpandedItems', JSON.stringify(manualExpandedItems))
  }, [manualExpandedItems, isHydrated])

  // Persist collapsedSections
  useEffect(() => {
    if (isHydrated) localStorage.setItem('inventoryCollapsedSections', JSON.stringify([...collapsedSections]))
  }, [collapsedSections, isHydrated])

  // Persist storageExpandedItems
  useEffect(() => {
    if (isHydrated) localStorage.setItem('inventoryStorageExpandedItems', JSON.stringify(storageExpandedItems))
  }, [storageExpandedItems, isHydrated])

  // Persist backupExpandedItems
  useEffect(() => {
    if (isHydrated) localStorage.setItem('inventoryBackupExpandedItems', JSON.stringify(backupExpandedItems))
  }, [backupExpandedItems, isHydrated])

  // Persist migrationExpandedItems
  useEffect(() => {
    if (isHydrated) localStorage.setItem('inventoryMigrationExpandedItems', JSON.stringify(migrationExpandedItems))
  }, [migrationExpandedItems, isHydrated])

  // Exposer la fonction refresh au parent
  useEffect(() => {
    if (onRefreshRef) {
      onRefreshRef(() => setReloadTick(x => x + 1))
    }
  }, [onRefreshRef])

  useEffect(() => {
    if (onOptimisticVmStatusRef) {
      onOptimisticVmStatusRef((connId: string, vmid: string, status: string) => {
        setClusters(prev => prev.map(clu => {
          if (clu.connId !== connId) return clu
          let changed = false
          const nodes = clu.nodes.map(n => {
            const vms = n.vms.map(vm => {
              if (String(vm.vmid) !== String(vmid)) return vm
              changed = true
              return { ...vm, status }
            })
            return changed ? { ...n, vms } : n
          })
          return changed ? { ...clu, nodes } : clu
        }))
      })
    }
  }, [onOptimisticVmStatusRef])

  // Expose optimistic VM tags update function to parent
  useEffect(() => {
    if (onOptimisticVmTagsRef) {
      onOptimisticVmTagsRef((connId: string, vmid: string, tags: string[]) => {
        const tagsStr = tags.join(';')
        setClusters(prev => prev.map(clu => {
          if (clu.connId !== connId) return clu
          let changed = false
          const nodes = clu.nodes.map(n => {
            const vms = n.vms.map(vm => {
              if (String(vm.vmid) !== String(vmid)) return vm
              changed = true
              return { ...vm, tags: tagsStr }
            })
            return changed ? { ...n, vms } : n
          })
          return changed ? { ...clu, nodes } : clu
        }))
      })
    }
  }, [onOptimisticVmTagsRef])

  // Menu contextuel VM
  const [contextMenu, setContextMenu] = useState<VmContextMenu>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [vmActionConfirm, setVmActionConfirm] = useState<{ action: string; name: string } | null>(null)
  const [vmActionError, setVmActionError] = useState<string | null>(null)
  const [snapshotDialogOpen, setSnapshotDialogOpen] = useState(false)
  const [snapshotName, setSnapshotName] = useState('')
  const [snapshotDesc, setSnapshotDesc] = useState('')
  const [snapshotVmstate, setSnapshotVmstate] = useState(false)
  const [creatingSnapshot, setCreatingSnapshot] = useState(false)
  const [snapshotTarget, setSnapshotTarget] = useState<{ connId: string; type: string; node: string; vmid: string } | null>(null)
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' }>({ open: false, message: '', severity: 'success' })
  const [backupDialogOpen, setBackupDialogOpen] = useState(false)
  const [backupTarget, setBackupTarget] = useState<{ connId: string; type: string; node: string; vmid: string; name: string } | null>(null)
  const [backupStorages, setBackupStorages] = useState<any[]>([])
  const [backupStorage, setBackupStorage] = useState('')
  const [backupMode, setBackupMode] = useState('snapshot')
  const [backupCompress, setBackupCompress] = useState('zstd')
  const [backupLoading, setBackupLoading] = useState(false)
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false)
  const [cloneTarget, setCloneTarget] = useState<VmContextMenu>(null)

  const handleCloneVm = useCallback(async (params: { targetNode: string; newVmid: number; name: string; targetStorage?: string; format?: string; pool?: string; full: boolean }) => {
    if (!cloneTarget) throw new Error('No VM selected for cloning')

    const payload: Record<string, any> = {
      newid: params.newVmid,
      target: params.targetNode,
      name: params.name || undefined,
      storage: params.targetStorage || undefined,
      format: params.format || undefined,
      pool: params.pool || undefined,
      full: params.full ? 1 : 0,
    }

    const res = await fetch(
      `/api/v1/connections/${encodeURIComponent(cloneTarget.connId)}/guests/${cloneTarget.type}/${encodeURIComponent(cloneTarget.node)}/${encodeURIComponent(cloneTarget.vmid)}/clone`,
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

    const json = await res.json()
    const upid = json.data
    if (upid && typeof upid === 'string' && upid.startsWith('UPID:')) {
      trackTask({
        upid,
        connId: cloneTarget.connId,
        node: cloneTarget.node,
        description: `${params.name || `VM ${cloneTarget.vmid}`}: ${t('vmActions.clone')}`,
        onSuccess: () => { onRefresh?.() },
      })
    } else {
      onRefresh?.()
    }
  }, [cloneTarget, onRefresh, trackTask, t])

  // Convert to template
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)
  const [templateTarget, setTemplateTarget] = useState<VmContextMenu>(null)
  const [convertingTemplate, setConvertingTemplate] = useState(false)

  const handleConvertToTemplate = useCallback(async () => {
    if (!templateTarget) return

    setConvertingTemplate(true)

    try {
      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(templateTarget.connId)}/guests/${templateTarget.type}/${encodeURIComponent(templateTarget.node)}/${encodeURIComponent(templateTarget.vmid)}/template`,
        { method: 'POST' }
      )

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error || `HTTP ${res.status}`)
      }

      const json = await res.json()
      const upid = json.data

      setTemplateDialogOpen(false)
      setTemplateTarget(null)

      if (upid && typeof upid === 'string' && upid.startsWith('UPID:')) {
        trackTask({
          upid,
          connId: templateTarget.connId,
          node: templateTarget.node,
          description: `VM ${templateTarget.vmid}: ${t('templates.convertToTemplate')}`,
          onSuccess: () => { onRefresh?.() },
        })
      } else {
        onRefresh?.()
      }
    } catch (e: any) {
      alert(`Error: ${e?.message || e}`)
    } finally {
      setConvertingTemplate(false)
    }
  }, [templateTarget, onRefresh, trackTask, t])

  // Node shell dialog state
  const [shellDialog, setShellDialog] = useState<{ open: boolean; connId: string; node: string; loading: boolean; data: any | null; error: string | null }>({ open: false, connId: '', node: '', loading: false, data: null, error: null })

  const handleOpenShell = async (connId: string, node: string) => {
    setShellDialog({ open: true, connId, node, loading: true, data: null, error: null })
    try {
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/terminal`, { method: 'POST' })
      if (res.ok) {
        const json = await res.json()
        setShellDialog(prev => ({ ...prev, loading: false, data: { ...json.data, node } }))
      } else {
        const err = await res.json().catch(() => ({}))
        setShellDialog(prev => ({ ...prev, loading: false, error: err.error || res.statusText }))
      }
    } catch (e: any) {
      setShellDialog(prev => ({ ...prev, loading: false, error: e.message || 'Connection failed' }))
    }
  }

  const [migrateDialogOpen, setMigrateDialogOpen] = useState(false)
  const [migrateTarget, setMigrateTarget] = useState<VmContextMenu>(null)
  // Menu contextuel Cluster
  const [clusterContextMenu, setClusterContextMenu] = useState<{ mouseX: number; mouseY: number; connId: string; name: string; nodes: { status?: string }[] } | null>(null)

  // Menu contextuel Node (maintenance + bulk actions + shell)
  const [nodeContextMenu, setNodeContextMenu] = useState<NodeContextMenu>(null)
  const [maintenanceBusy, setMaintenanceBusy] = useState(false)
  const [maintenanceTarget, setMaintenanceTarget] = useState<{ connId: string; node: string; maintenance?: string } | null>(null)
  const [maintenanceError, setMaintenanceError] = useState<string | null>(null)
  const [maintenanceLocalVms, setMaintenanceLocalVms] = useState<Set<string>>(new Set())

  // Tag management dialog for clusters/nodes
  const [tagDialog, setTagDialog] = useState<{ type: 'connection' | 'host'; entityId: string; connId?: string; node?: string; name: string; nodeStatus?: string; nodeMaintenance?: string; clusterNodes?: { status?: string }[] } | null>(null)
  const [tagDialogTags, setTagDialogTags] = useState<string[]>([])

  const openTagDialog = useCallback((type: 'connection' | 'host', entityId: string, name: string, connId?: string, node?: string, extra?: { nodeStatus?: string; nodeMaintenance?: string; clusterNodes?: { status?: string }[] }) => {
    setTagDialog({ type, entityId, connId, node, name, ...extra })
    setTagDialogTags([])
    // Load current tags
    if (type === 'connection') {
      fetch(`/api/v1/connections/${encodeURIComponent(entityId)}`)
        .then(r => r.ok ? r.json() : null)
        .then(json => {
          const tags = json?.data?.tags
          setTagDialogTags(tags ? String(tags).split(';').filter(Boolean) : [])
        })
        .catch(() => {})
    } else {
      fetch(`/api/v1/hosts?connId=${encodeURIComponent(connId || '')}`)
        .then(r => r.ok ? r.json() : null)
        .then(json => {
          const hosts = json?.data?.hosts || []
          const host = hosts.find((h: any) => h.node === node)
          const tags = host?.managedHost?.tags || host?.tags
          setTagDialogTags(tags ? String(tags).split(';').filter(Boolean) : [])
        })
        .catch(() => {})
    }
  }, [])
  const [maintenanceStorageLoading, setMaintenanceStorageLoading] = useState(false)
  const [maintenanceMigrateTarget, setMaintenanceMigrateTarget] = useState('')
  const [maintenanceShutdownLocal, setMaintenanceShutdownLocal] = useState(false)
  const [maintenanceStep, setMaintenanceStep] = useState<string | null>(null)
  // Bulk action dialog state
  const [bulkActionDialog, setBulkActionDialog] = useState<{
    open: boolean
    action: 'start-all' | 'shutdown-all' | 'migrate-all' | null
    connId: string
    node: string
    targetNode: string
  }>({ open: false, action: null, connId: '', node: '', targetNode: '' })
  const [bulkActionBusy, setBulkActionBusy] = useState(false)

  const [unlocking, setUnlocking] = useState(false)
  const [unlockErrorDialog, setUnlockErrorDialog] = useState<{
    open: boolean
    error: string
    hint?: string
  }>({ open: false, error: '' })

  // Handler pour unlock une VM
  const handleUnlock = async () => {
    if (!contextMenu) return
    
    const { connId, node, type, vmid, name } = contextMenu
    
    setUnlocking(true)
    setActionBusy(true)
    
    try {
      // D'abord vérifier si la VM est verrouillée
      const checkRes = await fetch(
        `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/unlock`
      )
      
      if (checkRes.ok) {
        const checkData = await checkRes.json()
        if (!checkData.data?.locked) {
          setUnlockErrorDialog({
            open: true,
            error: t('inventory.vmNotLocked')
          })
          handleCloseContextMenu()
          return
        }
      }
      
      // Procéder au unlock
      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/unlock`,
        { method: 'POST' }
      )
      
      if (res.ok) {
        const data = await res.json()
        if (data.data?.unlocked) {
          // Rafraîchir l'inventaire
          setReloadTick(x => x + 1)
        }
      } else {
        const err = await res.json().catch(() => ({}))
        setUnlockErrorDialog({
          open: true,
          error: err?.error || res.statusText,
          hint: err?.hint
        })
      }
    } catch (e: any) {
      setUnlockErrorDialog({
        open: true,
        error: e.message || String(e)
      })
    } finally {
      setUnlocking(false)
      setActionBusy(false)
      handleCloseContextMenu()
    }
  }

  const handleContextMenu = (
    event: React.MouseEvent,
    connId: string,
    node: string,
    type: string,
    vmid: string,
    name: string,
    status?: string,
    isCluster?: boolean,
    template?: boolean,
    sshEnabled?: boolean
  ) => {
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({
      mouseX: event.clientX,
      mouseY: event.clientY,
      connId,
      node,
      type,
      vmid,
      name,
      status,
      isCluster: !!isCluster,
      template: !!template,
      sshEnabled: !!sshEnabled
    })
  }

  const handleCloseContextMenu = () => {
    setContextMenu(null)
  }

  const handleNodeContextMenu = (
    event: React.MouseEvent,
    connId: string,
    node: string,
    maintenance?: string,
    sshEnabled?: boolean
  ) => {
    event.preventDefault()
    event.stopPropagation()
    setNodeContextMenu({
      mouseX: event.clientX,
      mouseY: event.clientY,
      connId,
      node,
      maintenance,
      sshEnabled,
    })
  }

  const handleCloseNodeContextMenu = () => {
    setNodeContextMenu(null)
  }

  const handleMaintenanceClick = () => {
    if (!nodeContextMenu) return
    const { connId, node, maintenance } = nodeContextMenu
    setMaintenanceTarget({ connId, node, maintenance })
    setMaintenanceError(null)
    handleCloseNodeContextMenu()
  }

  // Check storage when entering maintenance
  useEffect(() => {
    if (!maintenanceTarget || maintenanceTarget.maintenance) return // skip for exit maintenance
    const { connId, node } = maintenanceTarget

    const otherNodes = clusters.find(c => c.connId === connId)?.nodes.filter(n => n.node !== node) || []
    if (otherNodes.length === 0) return // standalone

    const runningVms = getNodeVms(connId, node).filter(v => v.status === 'running')
    if (runningVms.length === 0) return

    const cs = clusterStorages.find(c => c.connId === connId)
    const sharedSet = new Set<string>()
    if (cs) {
      for (const s of cs.sharedStorages) sharedSet.add(s.storage)
      for (const n of cs.nodes) for (const s of n.storages) if (isSharedStorage(s)) sharedSet.add(s.storage)
    }

    let alive = true
    setMaintenanceStorageLoading(true)

    ;(async () => {
      const localKeys = new Set<string>()
      for (let i = 0; i < runningVms.length; i += 5) {
        const batch = runningVms.slice(i, i + 5)
        await Promise.all(batch.map(async (vm) => {
          try {
            const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/guests/${vm.type}/${encodeURIComponent(node)}/${encodeURIComponent(vm.vmid)}/config`)
            if (!res.ok) return
            const json = await res.json()
            const config = json.data || {}
            for (const [key, val] of Object.entries(config)) {
              if (/^(scsi|virtio|ide|sata|efidisk)\d+$/.test(key) && typeof val === 'string' && !val.includes('media=cdrom') && val !== 'none') {
                const storageName = val.split(':')[0]
                if (storageName && storageName !== 'none' && !sharedSet.has(storageName)) {
                  localKeys.add(`${connId}:${vm.vmid}`)
                  break
                }
              }
            }
          } catch { /* ignore */ }
        }))
      }
      if (!alive) return
      setMaintenanceLocalVms(localKeys)
      setMaintenanceStorageLoading(false)
    })()

    return () => { alive = false }
  }, [maintenanceTarget?.connId, maintenanceTarget?.node, maintenanceTarget?.maintenance])

  const handleMaintenanceConfirm = async () => {
    if (!maintenanceTarget) return
    const { connId, node, maintenance } = maintenanceTarget
    const entering = !maintenance

    setMaintenanceBusy(true)
    setMaintenanceError(null)
    try {
      // When entering maintenance: handle VMs first
      if (entering) {
        const runningVms = getNodeVms(connId, node).filter(v => v.status === 'running')
        const otherNodes = clusters.find(c => c.connId === connId)?.nodes.filter(n => n.node !== node) || []
        const isCluster = otherNodes.length > 0

        if (runningVms.length > 0 && isCluster) {
          const sharedVms = runningVms.filter(v => !maintenanceLocalVms.has(`${connId}:${v.vmid}`))
          const localVms = runningVms.filter(v => maintenanceLocalVms.has(`${connId}:${v.vmid}`))

          // Migrate shared-storage VMs
          if (sharedVms.length > 0 && maintenanceMigrateTarget) {
            setMaintenanceStep(t('inventory.nodeActionMigratingStep', { done: 0, total: sharedVms.length }))
            let done = 0
            for (let i = 0; i < sharedVms.length; i += 3) {
              const batch = sharedVms.slice(i, i + 3)
              await Promise.all(batch.map(async (vm) => {
                try {
                  const url = `/api/v1/connections/${encodeURIComponent(connId)}/guests/${vm.type}/${encodeURIComponent(node)}/${encodeURIComponent(vm.vmid)}/migrate`
                  await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: maintenanceMigrateTarget, online: true }) })
                } catch { /* ignore */ }
                done++
                setMaintenanceStep(t('inventory.nodeActionMigratingStep', { done, total: sharedVms.length }))
              }))
            }
          }

          // Shutdown local-storage VMs
          if (localVms.length > 0 && maintenanceShutdownLocal) {
            setMaintenanceStep(t('inventory.nodeActionShutdownVmsStep', { done: 0, total: localVms.length }))
            let done = 0
            for (const vm of localVms) {
              const url = `/api/v1/connections/${encodeURIComponent(connId)}/guests/${vm.type}/${encodeURIComponent(node)}/${encodeURIComponent(vm.vmid)}/shutdown`
              await fetch(url, { method: 'POST' }).catch(() => {})
              done++
              setMaintenanceStep(t('inventory.nodeActionShutdownVmsStep', { done, total: localVms.length }))
            }
          }
        }
        setMaintenanceStep(t('inventory.nodeActionMaintenanceStep'))
      }

      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/maintenance`,
        { method: entering ? 'POST' : 'DELETE' }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMaintenanceError(data?.error || res.statusText)
        return
      }
      setMaintenanceTarget(null)
      setMaintenanceStep(null)
      setMaintenanceMigrateTarget('')
      setMaintenanceShutdownLocal(false)
      setReloadTick(x => x + 1)
    } catch (e: any) {
      setMaintenanceError(e?.message || t('inventory.unknownError'))
      setMaintenanceStep(null)
    } finally {
      setMaintenanceBusy(false)
    }
  }

  // Helper: get VMs for a node from clusters data
  const getNodeVms = useCallback((connId: string, nodeName: string) => {
    for (const c of clusters) {
      if (c.connId === connId) {
        const n = c.nodes.find(nd => nd.node === nodeName)
        return (n?.vms || []).filter(v => !v.template)
      }
    }
    return []
  }, [clusters])

  // Helper: get other nodes in the same cluster
  const getOtherNodes = useCallback((connId: string, nodeName: string) => {
    for (const c of clusters) {
      if (c.connId === connId) {
        return c.nodes.filter(n => n.node !== nodeName && n.status === 'online').map(n => n.node)
      }
    }
    return []
  }, [clusters])

  // Bulk action handlers
  const handleBulkActionClick = (action: 'start-all' | 'shutdown-all' | 'migrate-all') => {
    if (!nodeContextMenu) return
    const { connId, node } = nodeContextMenu
    setBulkActionDialog({ open: true, action, connId, node, targetNode: '' })
    handleCloseNodeContextMenu()
  }

  const handleBulkActionConfirm = async () => {
    const { action, connId, node, targetNode } = bulkActionDialog
    if (!action) return

    const vms = getNodeVms(connId, node)
    let vmsToProcess: typeof vms = []
    let apiAction = ''

    switch (action) {
      case 'start-all':
        vmsToProcess = vms.filter(v => v.status === 'stopped')
        apiAction = 'start'
        break
      case 'shutdown-all':
        vmsToProcess = vms.filter(v => v.status === 'running')
        apiAction = 'shutdown'
        break
      case 'migrate-all':
        if (!targetNode) return
        vmsToProcess = vms
        apiAction = 'migrate'
        break
    }

    if (vmsToProcess.length === 0) {
      setBulkActionDialog({ open: false, action: null, connId: '', node: '', targetNode: '' })
      return
    }

    setBulkActionBusy(true)
    try {
      const batchSize = 5
      for (let i = 0; i < vmsToProcess.length; i += batchSize) {
        const batch = vmsToProcess.slice(i, i + batchSize)
        await Promise.all(batch.map(async (vm) => {
          try {
            let url: string
            let body: string | undefined
            if (apiAction === 'migrate') {
              url = `/api/v1/connections/${encodeURIComponent(connId)}/guests/${vm.type}/${encodeURIComponent(node)}/${encodeURIComponent(vm.vmid)}/migrate`
              body = JSON.stringify({ target: targetNode, online: vm.status === 'running' })
            } else {
              url = `/api/v1/connections/${encodeURIComponent(connId)}/guests/${vm.type}/${encodeURIComponent(node)}/${encodeURIComponent(vm.vmid)}/${apiAction}`
            }
            await fetch(url, {
              method: 'POST',
              headers: body ? { 'Content-Type': 'application/json' } : undefined,
              body,
            })
          } catch {}
        }))
      }
      // Trigger immediate SSE poll — tree will be updated via persistent EventSource
      setTimeout(() => fetch('/api/v1/inventory/poll', { method: 'POST' }).catch(() => {}), 2000)
    } finally {
      setBulkActionBusy(false)
      setBulkActionDialog({ open: false, action: null, connId: '', node: '', targetNode: '' })
    }
  }

  // Exécuter une action sur la VM
  const handleVmAction = async (action: string) => {
    if (!contextMenu) return

    const { name } = contextMenu

    // Confirmation pour les actions destructives via MUI Dialog
    if (['shutdown', 'stop', 'suspend', 'hibernate', 'reboot', 'reset'].includes(action)) {
      setVmActionConfirm({ action, name })
      return
    }

    await executeVmAction(action)
  }

  const executeVmAction = async (action: string) => {
    if (!contextMenu) return

    const { connId, node, type, vmid } = contextMenu

    setActionBusy(true)
    setVmActionConfirm(null)

    try {
      // hibernate = suspend to disk via PVE
      const pveAction = action === 'hibernate' ? 'suspend' : action
      const url = `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/${pveAction}`
      const res = await fetch(url, { method: 'POST' })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))

        throw new Error(err?.error || `HTTP ${res.status}`)
      }

      // Optimistic update — reflect expected status immediately in the tree
      const optimisticStatus: Record<string, string> = {
        start: 'running',
        stop: 'stopped',
        shutdown: 'stopped',
        reboot: 'running',
        reset: 'running',
        suspend: 'paused',
        hibernate: 'stopped',
        resume: 'running',
      }
      const newStatus = optimisticStatus[action]
      if (newStatus) {
        setClusters(prev => prev.map(clu => {
          if (clu.connId !== connId) return clu
          let changed = false
          const nodes = clu.nodes.map(n => {
            const vms = n.vms.map(vm => {
              if (String(vm.vmid) !== String(vmid) || vm.type !== type) return vm
              changed = true
              return { ...vm, status: newStatus }
            })
            return changed ? { ...n, vms } : n
          })
          return changed ? { ...clu, nodes } : clu
        }))
      }

      // Also trigger SSE poll for full data sync
      fetch('/api/v1/inventory/poll', { method: 'POST' }).catch(() => {})
      setSnackbar({ open: true, message: `${action.charAt(0).toUpperCase() + action.slice(1)} — ${contextMenu.name}`, severity: 'success' })
    } catch (e: any) {
      setVmActionError(`${t('common.error')} (${action}): ${e?.message || e}`)
    } finally {
      setActionBusy(false)
      handleCloseContextMenu()
    }
  }

  // Prendre un snapshot
  const handleTakeSnapshot = () => {
    if (!contextMenu) return
    setSnapshotTarget({ connId: contextMenu.connId, type: contextMenu.type, node: contextMenu.node, vmid: contextMenu.vmid })
    setSnapshotName('')
    setSnapshotDesc('')
    setSnapshotVmstate(false)
    setSnapshotDialogOpen(true)
    handleCloseContextMenu()
  }

  const executeSnapshot = async () => {
    if (!snapshotTarget) return

    setCreatingSnapshot(true)

    try {
      const vmKey = `${snapshotTarget.connId}:${snapshotTarget.type}:${snapshotTarget.node}:${snapshotTarget.vmid}`
      const res = await fetch(`/api/v1/guests/${encodeURIComponent(vmKey)}/snapshots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: snapshotName, description: snapshotDesc, vmstate: snapshotVmstate })
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error || `HTTP ${res.status}`)
      }

      setSnapshotDialogOpen(false)
      setSnapshotTarget(null)
      setReloadTick(x => x + 1)
      setSnackbar({ open: true, message: t('inventory.snapshotCreated'), severity: 'success' })
    } catch (e: any) {
      setVmActionError(`${t('common.error')} (snapshot): ${e?.message || e}`)
    } finally {
      setCreatingSnapshot(false)
    }
  }

  // Lancer un backup maintenant
  const handleBackupNow = async () => {
    if (!contextMenu) return
    const { connId, node, type, vmid, name } = contextMenu

    setBackupTarget({ connId, type, node, vmid, name })
    setBackupStorage('')
    setBackupMode('snapshot')
    setBackupCompress('zstd')
    setBackupStorages([])
    setBackupDialogOpen(true)
    handleCloseContextMenu()

    // Fetch available backup storages
    try {
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/storages?content=backup`)
      const data = await res.json()

      if (data?.data?.length) {
        setBackupStorages(data.data)
        setBackupStorage(data.data[0].storage)
      }
    } catch { /* ignore */ }
  }

  const executeBackupNow = async () => {
    if (!backupTarget || !backupStorage) return

    setBackupLoading(true)

    try {
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(backupTarget.connId)}/nodes/${encodeURIComponent(backupTarget.node)}/vzdump`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vmid: Number(backupTarget.vmid), storage: backupStorage, mode: backupMode, compress: backupCompress })
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error || `HTTP ${res.status}`)
      }

      setBackupDialogOpen(false)
      setBackupTarget(null)
      setReloadTick(x => x + 1)
      setSnackbar({ open: true, message: `${t('inventory.backupStarted')} — ${backupTarget.name}`, severity: 'success' })
    } catch (e: any) {
      setVmActionError(`${t('common.error')} (backup): ${e?.message || e}`)
    } finally {
      setBackupLoading(false)
    }
  }

  // Ouvrir la console (depuis le menu contextuel)
  const handleOpenConsole = () => {
    if (!contextMenu) return
    const { connId, node, type, vmid } = contextMenu
    openConsoleWindow(connId, node, type, vmid)
    handleCloseContextMenu()
  }

  // Ouvrir la console (appel direct, ex: double-clic)
  const openConsoleWindow = (connId: string, node: string, type: string, vmid: string) => {
    const url = `/novnc/console.html?connId=${encodeURIComponent(connId)}&type=${encodeURIComponent(type)}&node=${encodeURIComponent(node)}&vmid=${encodeURIComponent(vmid)}`

    window.open(url, `console-${vmid}`, 'width=1024,height=768,menubar=no,toolbar=no,location=no,status=no')
  }

  // Actions non implémentées (placeholder)
  const handleNotImplemented = (action: string) => {
    alert(`${action}: ${t('common.notAvailable')}`)
    handleCloseContextMenu()
  }

  // Charger les favoris (mode local seulement)
  const loadFavorites = async () => {
    try {
      const res = await fetch('/api/v1/favorites')

      if (res.ok) {
        const json = await res.json()
        const favSet = new Set<string>((json.data || []).map((f: any) => f.vm_key))

        setLocalFavorites(favSet)
      }
    } catch (e) {
      console.error('Error loading favorites:', e)
    }
  }

  // Ajouter/Supprimer un favori
  const toggleFavorite = async (connId: string, node: string, vmType: string, vmid: string | number, vmName?: string) => {
    // Si la prop onToggleFavorite est fournie, l'utiliser
    if (onToggleFavorite) {
      onToggleFavorite({ connId, node, type: vmType, vmid, name: vmName })
      
return
    }
    
    // Sinon, gérer localement (fallback)
    const vmKey = `${connId}:${node}:${vmType}:${vmid}`
    const isFav = favorites.has(vmKey)
    
    try {
      if (isFav) {
        // Supprimer
        const res = await fetch(`/api/v1/favorites?vmKey=${encodeURIComponent(vmKey)}`, {
          method: 'DELETE'
        })

        if (res.ok) {
          setLocalFavorites(prev => {
            const next = new Set(prev)

            next.delete(vmKey)
            
return next
          })
        }
      } else {
        // Ajouter
        const res = await fetch('/api/v1/favorites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            connectionId: connId,
            node,
            vmType,
            vmid,
            vmName
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

  // Charger les favoris au mount (seulement si pas de prop favorites)
  useEffect(() => {
    if (!propFavorites) {
      loadFavorites()
    }
  }, [propFavorites])

  // Helper: convert raw cluster from API into TreeCluster
  const mapClusterToTree = useCallback((cluster: any): TreeCluster => ({
    connId: cluster.id,
    name: cluster.name || cluster.id,
    isCluster: cluster.isCluster,
    cephHealth: cluster.cephHealth,
    sshEnabled: cluster.sshEnabled,
    nodes: (cluster.nodes || []).map((node: any) => ({
      node: node.node,
      status: node.status,
      ip: node.ip,
      maintenance: node.maintenance,
      cpu: node.cpu,
      mem: node.mem,
      maxmem: node.maxmem,
      vms: (node.guests || []).map((guest: any) => ({
        type: String(guest.type || 'qemu'),
        vmid: String(guest.vmid),
        name: guest.name || `${guest.type}:${guest.vmid}`,
        status: guest.status,
        cpu: guest.cpu,
        maxcpu: guest.maxcpu,
        mem: guest.mem,
        maxmem: guest.maxmem,
        disk: guest.disk,
        maxdisk: guest.maxdisk,
        pool: guest.pool || null,
        tags: guest.tags || null,
        template: guest.template === 1 || guest.template === true,
        hastate: guest.hastate,
        hagroup: guest.hagroup,
        lock: guest.lock,
      }))
    }))
  }), [])

  // Helper: convert raw PBS from API into TreePbsServer
  const mapPbsToTree = useCallback((pbs: any): TreePbsServer => ({
    connId: pbs.id,
    name: pbs.name || pbs.id,
    status: pbs.status || 'offline',
    version: pbs.version,
    uptime: pbs.uptime,
    datastores: (pbs.datastores || []).map((ds: any) => ({
      name: ds.name,
      path: ds.path,
      comment: ds.comment,
      total: ds.total || 0,
      used: ds.used || 0,
      available: ds.available || 0,
      usagePercent: ds.usagePercent || 0,
      backupCount: ds.backupCount || 0,
      vmCount: ds.vmCount || 0,
      ctCount: ds.ctCount || 0,
      hostCount: ds.hostCount || 0,
    })),
    stats: pbs.stats || { totalSize: 0, totalUsed: 0, datastoreCount: 0, backupCount: 0 }
  }), [])

  // Sort clusters: multi-node first, then alphabetical
  const sortClusters = useCallback((arr: TreeCluster[]) => {
    return [...arr].sort((a, b) => {
      if (a.isCluster && !b.isCluster) return -1
      if (!a.isCluster && b.isCluster) return 1
      return a.name.localeCompare(b.name)
    })
  }, [])

  useEffect(() => {
    let alive = true
    let eventSource: EventSource | null = null

    function loadStream() {
      setError(null)

      const url = reloadTick > 0 ? '/api/v1/inventory/stream?refresh=true' : '/api/v1/inventory/stream'
      eventSource = new EventSource(url)

      let gotFirstData = false
      // Accumulate streamed data — update state progressively on first load,
      // or replace all at once on refresh to avoid flicker
      const isRefresh = reloadTick > 0
      const accClusters: TreeCluster[] = []
      const accPbs: TreePbsServer[] = []
      const accStorages: TreeClusterStorage[] = []

      if (!isRefresh) {
        setClusters([])
        setPbsServers([])
        setExternalHypervisors([])
        setClusterStorages([])
        setLoading(true)
      }

      eventSource.addEventListener('cluster', (e) => {
        if (!alive) return
        try {
          const cluster = JSON.parse(e.data)
          const tree = mapClusterToTree(cluster)
          accClusters.push(tree)
          if (!gotFirstData) { gotFirstData = true; setLoading(false) }
          // On first load, update progressively so user sees items appear
          if (!isRefresh) setClusters(sortClusters([...accClusters]))
        } catch { /* ignore malformed event */ }
      })

      eventSource.addEventListener('pbs', (e) => {
        if (!alive) return
        try {
          const pbs = JSON.parse(e.data)
          const tree = mapPbsToTree(pbs)
          accPbs.push(tree)
          if (!gotFirstData) { gotFirstData = true; setLoading(false) }
          if (!isRefresh) setPbsServers([...accPbs].sort((a, b) => a.name.localeCompare(b.name)))
        } catch { /* ignore */ }
      })

      eventSource.addEventListener('storage', (e) => {
        if (!alive) return
        try {
          const storageData: TreeClusterStorage = JSON.parse(e.data)
          accStorages.push(storageData)
          if (!isRefresh) setClusterStorages([...accStorages].sort((a, b) => a.connName.localeCompare(b.connName)))
        } catch { /* ignore */ }
      })

      eventSource.addEventListener('external', (e) => {
        if (!alive) return
        try {
          const externalData = JSON.parse(e.data)
          // Mark every external connection as "loading VMs" immediately. This
          // drives the spinner in the tree so the user sees an indicator while
          // the 5s defer + SOAP/API fetch runs — without it the connection row
          // sits silent for up to ~15s (5s defer + SOAP login + listVms +
          // inventory path resolution for vCenter) with no feedback.
          const extTypes = new Set(['vmware', 'xcpng', 'hyperv', 'nutanix'])
          const withLoadingFlag = (externalData || []).map((h: any) =>
            extTypes.has(h.type) ? { ...h, vmsLoading: true } : h,
          )
          setExternalHypervisors(withLoadingFlag)

          // Defer external VM fetches to avoid competing with critical-path requests at startup.
          // The tree renders immediately with connection info; VMs appear after the defer.
          const extConns = (externalData || []).filter((h: any) => extTypes.has(h.type))
          if (extConns.length > 0) {
            setTimeout(() => {
              if (!alive) return
              // IMPORTANT: do NOT use Promise.all here. Promise.all waits for EVERY
              // fetch to settle before handing back control, so a single unreachable
              // hypervisor (Nutanix/Hyper-V/XCP-ng with a dead host) would stall the
              // "loading VMs…" state on every OTHER connection (including the one
              // that's actually working) for the full timeout window. Instead fire
              // each fetch independently and clear its own loading flag when it
              // resolves — the working connections pop their VMs immediately, the
              // broken ones stay spinning until their own timeout hits.
              const VM_FETCH_TIMEOUT_MS = 15_000
              for (const conn of extConns) {
                const controller = new AbortController()
                const timeoutId = setTimeout(() => controller.abort(), VM_FETCH_TIMEOUT_MS)
                const apiPrefix = conn.type === 'xcpng' ? 'xcpng' : conn.type === 'hyperv' ? 'hyperv' : conn.type === 'nutanix' ? 'nutanix' : 'vmware'
                ;(async () => {
                  let vms: any[] = []
                  let loadError: string | undefined
                  try {
                    const vmRes = await fetch(`/api/v1/${apiPrefix}/${encodeURIComponent(conn.id)}/vms`, {
                      signal: controller.signal,
                    })
                    if (vmRes.ok) {
                      const vmJson = await vmRes.json()
                      vms = Array.isArray(vmJson?.data) ? vmJson.data : (vmJson?.data?.vms || [])
                    } else {
                      loadError = `HTTP ${vmRes.status}`
                    }
                  } catch (err: any) {
                    loadError = err?.name === 'AbortError'
                      ? `timeout after ${VM_FETCH_TIMEOUT_MS / 1000}s`
                      : err?.message || 'fetch failed'
                  } finally {
                    clearTimeout(timeoutId)
                  }
                  if (!alive) return
                  // Narrow update: only flip the state for this single connection;
                  // leaves every other connection's loading/vms untouched so they
                  // stream in as their own fetches settle.
                  setExternalHypervisors((prev: any[]) =>
                    prev.map((h: any) =>
                      h.id === conn.id
                        ? { ...h, vms, vmsLoading: false, vmsLoadError: loadError }
                        : h,
                    ),
                  )
                })()
              }
            }, 5000)
          }
        } catch { /* ignore */ }
      })

      eventSource.addEventListener('done', () => {
        if (!alive) return
        if (!gotFirstData) setLoading(false)
        // On refresh, swap all data at once to avoid flicker
        if (isRefresh) {
          setClusters(sortClusters([...accClusters]))
          setPbsServers([...accPbs].sort((a, b) => a.name.localeCompare(b.name)))
          setClusterStorages([...accStorages].sort((a, b) => a.connName.localeCompare(b.connName)))
        }
        eventSource?.close()
        eventSource = null
      })

      eventSource.addEventListener('error', (e) => {
        if (!alive) return
        try {
          const err = JSON.parse((e as any).data || '{}')
          setError(err.message || 'Connection error')
        } catch {
          if (!gotFirstData) {
            setError('Failed to load inventory')
            setLoading(false)
          }
        }
        eventSource?.close()
        eventSource = null
      })
    }

    loadStream()

    return () => {
      alive = false
      eventSource?.close()
      eventSource = null
    }
  }, [reloadTick, mapClusterToTree, mapPbsToTree, sortClusters])

  // ---------- Persistent SSE for real-time updates ----------
  useEffect(() => {
    let alive = true
    let es: EventSource | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    function connect() {
      if (!alive) return
      es = new EventSource('/api/v1/inventory/events')

      es.addEventListener('vm:update', (e) => {
        if (!alive) return
        try {
          const d = JSON.parse(e.data)
          setClusters(prev => {
            let anyClusterChanged = false
            const next = prev.map(clu => {
              if (clu.connId !== d.connId) return clu
              let nodeChanged = false
              const nodes = clu.nodes.map(n => {
                let vmChanged = false
                const vms = n.vms.map(vm => {
                  if (String(vm.vmid) !== String(d.vmid) || vm.type !== d.type) return vm
                  // Only create new object if values actually differ
                  const newStatus = d.status
                  const newCpu = d.cpu ?? vm.cpu
                  const newMem = d.mem ?? vm.mem
                  const newMaxmem = d.maxmem ?? vm.maxmem
                  const newDisk = d.disk ?? vm.disk
                  const newMaxdisk = d.maxdisk ?? vm.maxdisk
                  const newName = d.name ?? vm.name
                  if (vm.status === newStatus && vm.cpu === newCpu && vm.mem === newMem &&
                      vm.maxmem === newMaxmem && vm.disk === newDisk && vm.maxdisk === newMaxdisk &&
                      vm.name === newName) return vm
                  vmChanged = true
                  return { ...vm, status: newStatus, cpu: newCpu, mem: newMem, maxmem: newMaxmem, disk: newDisk, maxdisk: newMaxdisk, name: newName }
                })
                if (!vmChanged) return n
                nodeChanged = true
                return { ...n, vms }
              })
              if (!nodeChanged) return clu
              anyClusterChanged = true
              return { ...clu, nodes }
            })
            return anyClusterChanged ? next : prev
          })
        } catch { /* ignore */ }
      })

      es.addEventListener('node:update', (e) => {
        if (!alive) return
        try {
          const d = JSON.parse(e.data)
          setClusters(prev => {
            let anyChanged = false
            const next = prev.map(clu => {
              if (clu.connId !== d.connId) return clu
              let nodeChanged = false
              const nodes = clu.nodes.map(n => {
                if (n.node !== d.node) return n
                const newStatus = d.status ?? n.status
                const newCpu = d.cpu ?? n.cpu
                const newMem = d.mem ?? n.mem
                const newMaxmem = d.maxmem ?? n.maxmem
                if (n.status === newStatus && n.cpu === newCpu && n.mem === newMem && n.maxmem === newMaxmem) return n
                nodeChanged = true
                return { ...n, status: newStatus, cpu: newCpu, mem: newMem, maxmem: newMaxmem }
              })
              if (!nodeChanged) return clu
              anyChanged = true
              return { ...clu, nodes }
            })
            return anyChanged ? next : prev
          })
        } catch { /* ignore */ }
      })

      es.addEventListener('vm:added', (e) => {
        if (!alive) return
        try {
          const d = JSON.parse(e.data)
          setClusters(prev => {
            let anyChanged = false
            const next = prev.map(clu => {
              if (clu.connId !== d.connId) return clu
              let nodeChanged = false
              const nodes = clu.nodes.map(n => {
                if (n.node !== d.node) return n
                if (n.vms.some(vm => String(vm.vmid) === String(d.vmid) && vm.type === d.type)) return n
                nodeChanged = true
                return {
                  ...n,
                  vms: [...n.vms, {
                    type: d.type,
                    vmid: String(d.vmid),
                    name: d.name || `${d.type}/${d.vmid}`,
                    status: d.status || 'unknown',
                    cpu: d.cpu,
                    mem: d.mem,
                    maxmem: d.maxmem,
                    pool: null,
                    tags: null,
                    template: false,
                  }].sort((a, b) => Number.parseInt(a.vmid, 10) - Number.parseInt(b.vmid, 10))
                }
              })
              if (!nodeChanged) return clu
              anyChanged = true
              return { ...clu, nodes }
            })
            return anyChanged ? next : prev
          })
        } catch { /* ignore */ }
      })

      es.addEventListener('vm:removed', (e) => {
        if (!alive) return
        try {
          const d = JSON.parse(e.data)
          setClusters(prev => {
            let anyChanged = false
            const next = prev.map(clu => {
              if (clu.connId !== d.connId) return clu
              let nodeChanged = false
              const nodes = clu.nodes.map(n => {
                const vms = n.vms.filter(vm => !(String(vm.vmid) === String(d.vmid) && vm.type === d.type))
                if (vms.length === n.vms.length) return n
                nodeChanged = true
                return { ...n, vms }
              })
              if (!nodeChanged) return clu
              anyChanged = true
              return { ...clu, nodes }
            })
            return anyChanged ? next : prev
          })
        } catch { /* ignore */ }
      })

      // Reconnect on error (network drop, server restart)
      es.onerror = () => {
        es?.close()
        es = null
        if (alive) {
          reconnectTimer = setTimeout(connect, 5000)
        }
      }
    }

    // Start after a short delay to let the initial stream load finish first
    const startTimer = setTimeout(connect, 3000)

    // Pause SSE when tab is hidden, reconnect when visible
    function onVisChange() {
      if (!alive) return
      if (document.visibilityState === 'visible') {
        if (!es) connect()
      } else {
        es?.close()
        es = null
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
      }
    }

    document.addEventListener('visibilitychange', onVisChange)

    return () => {
      alive = false
      clearTimeout(startTimer)
      if (reconnectTimer) clearTimeout(reconnectTimer)
      document.removeEventListener('visibilitychange', onVisChange)
      es?.close()
      es = null
    }
  }, [])

  const selectedItemId = selected ? itemKey(selected) : undefined

  // État de recherche (debounced)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  // Filtrer les clusters/nodes/vms selon la recherche
  const filteredClusters = useMemo(() => {
    const q = search.trim().toLowerCase()

    if (!q) return clusters

    return clusters
      .map(clu => {
        // Vérifier si le cluster match
        const clusterMatches = clu.name.toLowerCase().includes(q)

        // Filtrer les nodes et VMs
        const filteredNodes = clu.nodes
          .map(n => {
            // Vérifier si le node match
            const nodeMatches = n.node.toLowerCase().includes(q)

            // Filtrer les VMs qui matchent
            const filteredVms = n.vms.filter(vm =>
              vm.name.toLowerCase().includes(q) ||
              vm.vmid.toLowerCase().includes(q) ||
              vm.type.toLowerCase().includes(q)
            )

            // Garder le node si lui-même match OU si des VMs matchent
            if (nodeMatches || filteredVms.length > 0) {
              return {
                ...n,

                // Si le node match, garder toutes les VMs, sinon seulement celles filtrées
                vms: nodeMatches ? n.vms : filteredVms
              }
            }

            
return null
          })
          .filter((n): n is NonNullable<typeof n> => n !== null)

        // Garder le cluster si lui-même match OU si des nodes matchent
        if (clusterMatches || filteredNodes.length > 0) {
          return {
            ...clu,

            // Si le cluster match, garder tous les nodes, sinon seulement ceux filtrés
            nodes: clusterMatches ? clu.nodes : filteredNodes
          }
        }

        
return null
      })
      .filter((clu): clu is NonNullable<typeof clu> => clu !== null)
  }, [clusters, search])

  // Calculer les items à expand automatiquement lors d'une recherche
  const expandedItems = useMemo(() => {
    if (!search.trim()) return []
    
    const items: string[] = []

    filteredClusters.forEach(clu => {
      items.push(`cluster:${clu.connId}`)
      clu.nodes.forEach(n => {
        items.push(`node:${clu.connId}:${n.node}`)
      })
    })
    
return items
  }, [filteredClusters, search])

  // Expand/Collapse all for tree mode
  const expandAll = useCallback(() => {
    programmaticExpand.current = true
    const items: string[] = []
    clusters.forEach(clu => {
      items.push(`cluster:${clu.connId}`)
      clu.nodes.forEach(n => items.push(`node:${clu.connId}:${n.node}`))
    })
    setManualExpandedItems(items)
    requestAnimationFrame(() => { programmaticExpand.current = false })

    // Open all section headers
    setCollapsedSections(new Set())

    // Expand all Storage tree items
    const storageItems: string[] = []
    clusterStorages.forEach(cs => {
      storageItems.push(`storage-cluster:${cs.connId}`)
      if (cs.isCluster) {
        cs.nodes.filter(n => n.storages.length > 0).forEach(n => {
          storageItems.push(`storage-node:${cs.connId}:${n.node}`)
        })
      }
    })
    setStorageExpandedItems(storageItems)

    // Expand all Backup (PBS) tree items
    const backupItems: string[] = []
    pbsServers.forEach(pbs => {
      backupItems.push(`pbs:${pbs.connId}`)
    })
    setBackupExpandedItems(backupItems)

    // Expand all Migration tree items, including the per-ESXi-host grouping
    // that shows up under vCenter connections (itemId pattern `exthost:<connId>:<host>`).
    // Without this, "Expand all" would open connections but leave VMs hidden inside
    // collapsed host groups on vCenter sources.
    const migrationItems: string[] = []
    externalHypervisors.forEach(h => {
      migrationItems.push(`ext-type:${h.type}`)
      migrationItems.push(`ext:${h.id}`)
      const hostsSeen = new Set<string>()
      for (const vm of (h as any).vms || []) {
        const host = (vm as any).vcenterHost
        if (host && !hostsSeen.has(host)) {
          hostsSeen.add(host)
          migrationItems.push(`exthost:${h.id}:${host}`)
        }
      }
    })
    setMigrationExpandedItems(migrationItems)

    // Expand Network section + trigger fetch if needed
    setExpandedNetSections(new Set(['network']))
    expandNetworkOnLoadRef.current = true
    if (!networkFetchedRef.current) {
      networkFetchedRef.current = true
      fetchNetworksRef.current?.()
    } else {
      // Data already loaded — expand now
      expandNetworkTreeItemsRef.current()
    }
  }, [clusters, clusterStorages, pbsServers, externalHypervisors])

  const collapseAll = useCallback(() => {
    programmaticExpand.current = true
    setManualExpandedItems([])
    requestAnimationFrame(() => { programmaticExpand.current = false })

    // Collapse all sub-section tree items
    setStorageExpandedItems([])
    setBackupExpandedItems([])
    setMigrationExpandedItems([])
    setExpandedNetSections(new Set())
    setNetworkTreeExpandedItems([])
    expandNetworkOnLoadRef.current = false
  }, [])

  // Expand/Collapse all for grouped modes (hosts, pools, tags)
  const expandAllSections = useCallback(() => {
    setCollapsedSections(new Set())
  }, [])

  const collapseAllSections = useCallback((keys: string[]) => {
    setCollapsedSections(new Set(keys))
  }, [])

  // Liste plate de toutes les VMs (pour le mode 'vms')
  const allVms = useMemo(() => {
    const vms: { 
      connId: string
      connName: string
      node: string
      type: string
      vmid: string
      name: string
      status?: string
      cpu?: number
      maxcpu?: number
      mem?: number
      maxmem?: number
      disk?: number
      maxdisk?: number
      uptime?: number
      pool?: string | null
      tags?: string | null
      isCluster: boolean
      template?: boolean
      hastate?: string
      hagroup?: string
      lock?: string
      sshEnabled?: boolean
    }[] = []

    clusters.forEach(clu => {
      clu.nodes.forEach(n => {
        n.vms.forEach(vm => {
          vms.push({
            connId: clu.connId,
            connName: clu.name,
            node: n.node,
            type: vm.type,
            vmid: vm.vmid,
            name: vm.name,
            status: vm.status,
            cpu: vm.cpu,
            maxcpu: vm.maxcpu,
            mem: vm.mem,
            maxmem: vm.maxmem,
            disk: vm.disk,
            maxdisk: vm.maxdisk,
            uptime: vm.uptime,
            pool: vm.pool,
            tags: vm.tags,
            isCluster: clu.isCluster,
            template: vm.template,
            hastate: vm.hastate,
            hagroup: vm.hagroup,
            lock: vm.lock,
            sshEnabled: clu.sshEnabled
          })
        })
      })
    })
    
    // Trier par nom
    vms.sort((a, b) => a.name.localeCompare(b.name))
    
return vms
  }, [clusters])

  // Filtrer les VMs selon la recherche
  const filteredVms = useMemo(() => {
    const q = search.trim().toLowerCase()

    if (!q) return allVms
    
    return allVms.filter(vm =>
      vm.name.toLowerCase().includes(q) ||
      vm.vmid.toLowerCase().includes(q) ||
      vm.type.toLowerCase().includes(q) ||
      vm.node.toLowerCase().includes(q) ||
      vm.connName.toLowerCase().includes(q) ||
      (vm.pool && vm.pool.toLowerCase().includes(q)) ||
      (vm.tags && vm.tags.toLowerCase().includes(q))
    )
  }, [allVms, search])

  // VMs sans templates (pour affichage dans les modes vms, hosts, pools, tags)
  const displayVms = useMemo(() => {
    return filteredVms.filter(vm => !vm.template)
  }, [filteredVms])

  // Notifier le parent quand les VMs filtrées changent
  useEffect(() => {
    if (onAllVmsChange) {
      onAllVmsChange(filteredVms.map(vm => ({
        connId: vm.connId,
        connName: vm.connName,
        node: vm.node,
        type: vm.type as 'qemu' | 'lxc',
        vmid: vm.vmid,
        name: vm.name,
        status: vm.status,
        cpu: vm.cpu,
        maxcpu: vm.maxcpu,
        mem: vm.mem,
        maxmem: vm.maxmem,
        disk: vm.disk,
        maxdisk: vm.maxdisk,
        uptime: vm.uptime,
        tags: vm.tags?.split(';').filter(Boolean),
        pool: vm.pool,
        template: vm.template,
        hastate: vm.hastate,
        hagroup: vm.hagroup,
        lock: vm.lock,
        isCluster: vm.isCluster,
      })))
    }
  }, [filteredVms, onAllVmsChange])

  // Liste des hôtes uniques avec leurs VMs (filtrées, sans templates)
  // Inclut aussi les nœuds sans VM depuis filteredClusters
  const hostsList = useMemo(() => {
    const hostsMap = new Map<string, { node: string; connName: string; status: string; cpu?: number; mem?: number; maxmem?: number; vms: typeof displayVms }>()

    // D'abord, ajouter tous les nœuds depuis les clusters (y compris ceux sans VM)
    filteredClusters.forEach(clu => {
      clu.nodes.forEach(n => {
        const key = `${clu.connId}:${n.node}`
        if (!hostsMap.has(key)) {
          hostsMap.set(key, { node: n.node, connName: clu.name, status: n.status || 'online', cpu: n.cpu, mem: n.mem, maxmem: n.maxmem, vms: [] })
        }
      })
    })

    // Puis, associer les VMs filtrées aux nœuds
    displayVms.forEach(vm => {
      const key = `${vm.connId}:${vm.node}`

      if (!hostsMap.has(key)) {
        hostsMap.set(key, { node: vm.node, connName: vm.connName, status: 'online', vms: [] })
      }

      hostsMap.get(key)!.vms.push(vm)
    })

    return Array.from(hostsMap.entries())
      .map(([key, h]) => ({
        key,
        node: h.node,
        connName: h.connName,
        status: h.status,
        cpu: h.cpu,
        mem: h.mem,
        maxmem: h.maxmem,
        vms: h.vms
      }))
      .sort((a, b) => a.node.localeCompare(b.node))
  }, [displayVms, filteredClusters])

  // Liste des pools uniques avec leurs VMs (filtrées, sans templates)
  const poolsList = useMemo(() => {
    const poolsMap = new Map<string, typeof displayVms>()

    displayVms.forEach(vm => {
      const poolName = vm.pool || `(${t('common.none')})`

      if (!poolsMap.has(poolName)) {
        poolsMap.set(poolName, [])
      }

      poolsMap.get(poolName)!.push(vm)
    })

    return Array.from(poolsMap.entries())
      .map(([pool, vms]) => ({ pool, vms }))
      .sort((a, b) => {
        // "(None)" at the end
        if (a.pool === `(${t('common.none')})`) return 1
        if (b.pool === `(${t('common.none')})`) return -1

return a.pool.localeCompare(b.pool)
      })
  }, [displayVms])

  // Liste des tags uniques avec leurs VMs + entities (clusters/nodes)
  const tagsList = useMemo(() => {
    const tagsMap = new Map<string, { vms: typeof displayVms; entities: { type: 'cluster' | 'node'; connId: string; name: string; node?: string }[] }>()

    const getOrCreate = (tag: string) => {
      if (!tagsMap.has(tag)) tagsMap.set(tag, { vms: [], entities: [] })
      return tagsMap.get(tag)!
    }

    displayVms.forEach(vm => {
      if (vm.tags) {
        const vmTags = vm.tags.split(/[;,]/).map(t => t.trim()).filter(Boolean)
        vmTags.forEach(tag => getOrCreate(tag).vms.push(vm))
      } else {
        getOrCreate(`(${t('common.none')})`).vms.push(vm)
      }
    })

    // Merge ProxCenter entity tags (clusters/nodes)
    for (const [, entity] of entityTagsMap) {
      for (const tag of entity.tags) {
        getOrCreate(tag).entities.push({ type: entity.type, connId: entity.connId, name: entity.name, node: entity.node })
      }
    }

    return Array.from(tagsMap.entries())
      .map(([tag, data]) => ({ tag, vms: data.vms, entities: data.entities }))
      .sort((a, b) => {
        if (a.tag === `(${t('common.none')})`) return 1
        if (b.tag === `(${t('common.none')})`) return -1
        return a.tag.localeCompare(b.tag)
      })
  }, [displayVms, entityTagsMap])

  // Compter les templates
  const templatesCount = useMemo(() => {
    return filteredVms.filter(vm => vm.template).length
  }, [filteredVms])

  // Liste des favoris (VMs qui sont dans les favoris)
  const favoritesList = useMemo(() => {
    return filteredVms.filter(vm => {
      const vmKey = `${vm.connId}:${vm.node}:${vm.type}:${vm.vmid}`

      
return favorites.has(vmKey)
    })
  }, [filteredVms, favorites])

  // Network section: on-demand fetch of VLAN/bridge data
  type NetIface = { id: string; model: string; bridge: string; macaddr?: string; tag?: number; firewall?: boolean; rate?: number }
  type VmNetData = { vmid: string; name: string; node: string; type: string; status: string; connId?: string; nets: NetIface[] }
  const [networkData, setNetworkData] = useState<VmNetData[]>([])
  const [networkLoading, setNetworkLoading] = useState(false)
  const networkFetchedRef = useRef(false)
  // Network sub-items: inverted logic — collapsed by default, expanded when added to this set
  const [expandedNetSections, setExpandedNetSections] = useState<Set<string>>(new Set())
  // Network tree expanded items (not persisted — data is lazy-loaded)
  const [networkTreeExpandedItems, setNetworkTreeExpandedItems] = useState<string[]>([])
  const toggleNetSection = useCallback((key: string) => {
    setExpandedNetSections(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])
  const networkCacheRef = useRef<{ connIds: string; data: VmNetData[] } | null>(null)

  // Fetch networks when section is expanded
  const fetchNetworks = useCallback(() => {
    const connIds = clusters.map(c => c.connId).filter(Boolean)
    if (connIds.length === 0) return
    const cacheKey = connIds.sort().join(',')
    if (networkCacheRef.current?.connIds === cacheKey) {
      setNetworkData(networkCacheRef.current.data)
      return
    }
    setNetworkLoading(true)
    Promise.all(
      connIds.map(async (connId) => {
        try {
          const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/networks`)
          if (!res.ok) return []
          const json = await res.json()
          return (json.data || []).map((vm: any) => ({ ...vm, connId }))
        } catch { return [] }
      })
    ).then((results) => {
      const all = results.flat()
      networkCacheRef.current = { connIds: cacheKey, data: all }
      setNetworkData(all)
      setNetworkLoading(false)
    })
  }, [clusters])
  const fetchNetworksRef = useRef(fetchNetworks)
  fetchNetworksRef.current = fetchNetworks

  // Build network tree: Connection → Node → VLAN → VMs
  const networkTree = useMemo(() => {
    if (!networkData.length) return []

    // Group by connId → node → vlan tag
    const connMap = new Map<string, Map<string, Map<number | 'untagged', { vm: VmNetData; netId: string; bridge: string }[]>>>()

    for (const vm of networkData) {
      const cid = vm.connId || 'unknown'
      if (!connMap.has(cid)) connMap.set(cid, new Map())
      const nodeMap = connMap.get(cid)!
      if (!nodeMap.has(vm.node)) nodeMap.set(vm.node, new Map())
      const vlanMap = nodeMap.get(vm.node)!

      for (const net of vm.nets) {
        const tag = net.tag ?? 'untagged'
        if (!vlanMap.has(tag)) vlanMap.set(tag, [])
        vlanMap.get(tag)!.push({ vm, netId: net.id, bridge: net.bridge })
      }
    }

    return Array.from(connMap.entries()).map(([connId, nodeMap]) => {
      const connName = clusters.find(c => c.connId === connId)?.name || connId
      const nodes = Array.from(nodeMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([node, vlanMap]) => {
          const vlans = Array.from(vlanMap.entries())
            .sort((a, b) => {
              if (a[0] === 'untagged') return 1
              if (b[0] === 'untagged') return -1
              return (a[0] as number) - (b[0] as number)
            })
            .map(([tag, entries]) => ({
              tag,
              entries: entries.sort((a, b) => a.vm.name.localeCompare(b.vm.name)),
            }))
          const taggedVlans = vlans.filter(v => v.tag !== 'untagged').length
          const totalVms = vlans.reduce((sum, v) => sum + v.entries.length, 0)
          return { node, vlans, totalVlans: taggedVlans, totalVms }
        })
      return { connId, connName, nodes }
    })
  }, [networkData, clusters])

  // Expand all network tree items helper
  const expandNetworkOnLoadRef = useRef(false)
  const expandNetworkTreeItems = useCallback(() => {
    const items: string[] = []
    networkTree.forEach(({ connId, nodes }) => {
      items.push(`net-conn:${connId}`)
      nodes.forEach(({ node, vlans }) => {
        items.push(`net-node:${connId}:${node}`)
        vlans.forEach(({ tag }) => items.push(`net-vlan:${connId}:${node}:${tag}`))
      })
    })
    setNetworkTreeExpandedItems(items)
  }, [networkTree])

  const expandNetworkTreeItemsRef = useRef(expandNetworkTreeItems)
  expandNetworkTreeItemsRef.current = expandNetworkTreeItems

  // Auto-expand network tree when data arrives after Expand All
  useEffect(() => {
    if (expandNetworkOnLoadRef.current && networkTree.length > 0) {
      expandNetworkOnLoadRef.current = false
      expandNetworkTreeItemsRef.current()
    }
  }, [networkTree])

  // Notifier le parent quand les hosts changent
  useEffect(() => {
    onHostsChange?.(hostsList.map(h => ({
      key: h.key,
      node: h.node,
      connId: h.vms[0]?.connId || h.key.split(':')[0],
      connName: h.connName,
      status: h.status,
      cpu: h.cpu,
      mem: h.mem,
      maxmem: h.maxmem,
      vms: h.vms.map(vm => ({
        ...vm,
        type: vm.type as 'qemu' | 'lxc',
        tags: vm.tags?.split(';').filter(Boolean)
      }))
    })))
  }, [hostsList, onHostsChange])

  // Notifier le parent quand les pools changent
  useEffect(() => {
    onPoolsChange?.(poolsList.map(p => ({
      pool: p.pool,
      vms: p.vms.map(vm => ({
        ...vm,
        type: vm.type as 'qemu' | 'lxc',
        tags: vm.tags?.split(';').filter(Boolean)
      }))
    })))
  }, [poolsList, onPoolsChange])

  // Notifier le parent quand les tags changent
  useEffect(() => {
    onTagsChange?.(tagsList.map(t => ({
      tag: t.tag,
      vms: t.vms.map(vm => ({
        ...vm,
        type: vm.type as 'qemu' | 'lxc',
        tags: vm.tags?.split(';').filter(Boolean)
      }))
    })))
  }, [tagsList, onTagsChange])

  // Notifier le parent quand les PBS servers changent
  useEffect(() => {
    onPbsServersChange?.(pbsServers)
  }, [pbsServers, onPbsServersChange])

  // Notifier le parent quand les storages changent
  useEffect(() => {
    onStoragesChange?.(clusterStorages)
  }, [clusterStorages, onStoragesChange])

  // Notifier le parent quand les hyperviseurs externes changent
  useEffect(() => {
    onExternalHypervisorsChange?.(externalHypervisors)
  }, [externalHypervisors, onExternalHypervisorsChange])

  const flatItems = useMemo(() => {
    if (viewMode === 'vms') return displayVms
    if (viewMode === 'favorites') return favoritesList
    if (viewMode === 'templates') return filteredVms.filter(vm => vm.template)
    return null
  }, [viewMode, displayVms, favoritesList, filteredVms])

  const virtualizer = useVirtualizer({
    count: flatItems?.length ?? 0,
    getScrollElement: () => virtualScrollRef.current,
    estimateSize: () => 30,
    overscan: 10,
  })

  const isTreeExpanded = manualExpandedItems.length > 1 || storageExpandedItems.length > 0 || backupExpandedItems.length > 0 || migrationExpandedItems.length > 0 || expandedNetSections.size > 0
  const isSectionsAllExpanded = collapsedSections.size === 0

  const header = useMemo(
    () => (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, px: 1, pt: 1.5, pb: 0.5 }}>
        {/* Recherche + actions */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <TextField
            size='small'
            placeholder={t('common.search')}
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            sx={{
              flex: 1,
              '& .MuiOutlinedInput-root': {
                height: 32,
                fontSize: 13,
              },
              '& .MuiOutlinedInput-input': {
                py: 0.5,
              }
            }}
            InputProps={{
              startAdornment: (
                <InputAdornment position='start'>
                  <SearchIcon sx={{ fontSize: 18, opacity: 0.6 }} />
                </InputAdornment>
              ),
              endAdornment: searchInput ? (
                <InputAdornment position='end'>
                  <IconButton size='small' onClick={() => { setSearchInput(''); setSearch('') }} sx={{ p: 0.25 }}>
                    <ClearIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </InputAdornment>
              ) : null
            }}
          />
          {onRefresh && (
            <Tooltip title={t('common.refresh')}>
              <IconButton size='small' onClick={onRefresh} disabled={refreshLoading}>
                <RefreshIcon fontSize='small' />
              </IconButton>
            </Tooltip>
          )}
          {viewMode === 'tree' && (
            <Tooltip title={isTreeExpanded ? t('inventory.collapseAll') : t('inventory.expandAll')}>
              <IconButton size='small' onClick={isTreeExpanded ? collapseAll : expandAll}>
                <i className={isTreeExpanded ? 'ri-contract-up-down-line' : 'ri-expand-up-down-line'} style={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          )}
          {(viewMode === 'hosts' || viewMode === 'pools' || viewMode === 'tags') && (
            <Tooltip title={isSectionsAllExpanded ? t('inventory.collapseAll') : t('inventory.expandAll')}>
              <IconButton size='small' onClick={() => {
                if (isSectionsAllExpanded) {
                  const keys = viewMode === 'hosts' ? hostsList.map(h => `host:${h.key}`)
                    : viewMode === 'pools' ? poolsList.map(p => `pool:${p.pool}`)
                    : tagsList.map(t => `tag:${t.tag}`)
                  collapseAllSections(keys)
                } else {
                  expandAllSections()
                }
              }}>
                <i className={isSectionsAllExpanded ? 'ri-contract-up-down-line' : 'ri-expand-up-down-line'} style={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          )}
          {onToggleShowVmId && (
            <Tooltip title={showVmId ? t('inventory.hideVmId') : t('inventory.showVmId')}>
              <IconButton size='small' onClick={onToggleShowVmId} sx={{ color: showVmId ? 'primary.main' : 'text.disabled' }}>
                <i className="ri-hashtag" style={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title={t('settings.connections')}>
            <IconButton size='small' onClick={() => router.push('/settings?tab=connections')}>
              <i className='ri-add-circle-line' style={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          {onCollapse && (
            <Tooltip title={isCollapsed ? t('common.showMore') : t('common.showLess')}>
              <IconButton
                size='small'
                onClick={onCollapse}
                sx={{
                  bgcolor: 'action.hover',
                  '&:hover': { bgcolor: 'action.selected' }
                }}
              >
                <i
                  className={isCollapsed ? 'ri-side-bar-fill' : 'ri-side-bar-line'}
                  style={{ fontSize: 16 }}
                />
              </IconButton>
            </Tooltip>
          )}
        </Box>

        {/* Sélecteur de vue avec icônes */}
        <ToggleButtonGroup
          value={viewMode}
          exclusive
          onChange={(_, v) => {
            if (v) {
              setViewMode(v)

              if (v === 'tree') {
                onSelect({ type: 'root', id: 'root' })
              } else {
                onSelect(null)
              }
            }
          }}
          size="small"
          fullWidth
          sx={{
            '& .MuiToggleButton-root': {
              py: 0.5,
              px: 1,
              minWidth: 0,
              flex: 1
            }
          }}
        >
          {(!allowedViewModes || allowedViewModes.has('tree')) && (
            <ToggleButton value="tree">
              <Tooltip title={t('navigation.inventory')}>
                <i className="ri-node-tree" style={{ fontSize: 16 }} />
              </Tooltip>
            </ToggleButton>
          )}
          {(!allowedViewModes || allowedViewModes.has('vms')) && (
            <ToggleButton value="vms">
              <Tooltip title={`${t('inventory.guests')} (${displayVms.length})`}>
                <i className="ri-computer-line" style={{ fontSize: 16 }} />
              </Tooltip>
            </ToggleButton>
          )}
          {(!allowedViewModes || allowedViewModes.has('hosts')) && (
            <ToggleButton value="hosts">
              <Tooltip title={`${t('inventory.nodes')} (${hostsList.length})`}>
                <i className="ri-server-line" style={{ fontSize: 16 }} />
              </Tooltip>
            </ToggleButton>
          )}
          {(!allowedViewModes || allowedViewModes.has('pools')) && (
            <ToggleButton value="pools">
              <Tooltip title={`${t('storage.pools')} (${poolsList.length})`}>
                <i className="ri-folder-line" style={{ fontSize: 16 }} />
              </Tooltip>
            </ToggleButton>
          )}
          {(!allowedViewModes || allowedViewModes.has('tags')) && (
            <ToggleButton value="tags">
              <Tooltip title={`Tags (${tagsList.length})`}>
                <i className="ri-price-tag-3-line" style={{ fontSize: 16 }} />
              </Tooltip>
            </ToggleButton>
          )}
          {(!allowedViewModes || allowedViewModes.has('favorites')) && (
            <ToggleButton value="favorites">
              <Tooltip title={`${t('navigation.favorites')} (${favoritesList.length})`}>
                <i className={favoritesList.length > 0 ? "ri-star-fill" : "ri-star-line"} style={{ fontSize: 16, color: favoritesList.length > 0 ? '#ffc107' : undefined }} />
              </Tooltip>
            </ToggleButton>
          )}
          {(!allowedViewModes || allowedViewModes.has('templates')) && (
            <ToggleButton value="templates">
              <Tooltip title={`${t('navigation.templates')} (${templatesCount})`}>
                <i className="ri-file-copy-line" style={{ fontSize: 16 }} />
              </Tooltip>
            </ToggleButton>
          )}
        </ToggleButtonGroup>
      </Box>
    ),
    [loading, searchInput, viewMode, displayVms.length, hostsList.length, poolsList.length, tagsList.length, templatesCount, favoritesList.length, onRefresh, refreshLoading, onCollapse, isCollapsed, allowedViewModes, theme.palette.mode, expandAll, collapseAll, expandAllSections, collapseAllSections, isTreeExpanded, isSectionsAllExpanded, showVmId, onToggleShowVmId]
  )

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minHeight: 0 }}>
      <Box sx={{ flexShrink: 0 }}>
        {header}
      </Box>
      <Box ref={virtualScrollRef} sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>

      {error ? <Alert severity='error'>{error}</Alert> : null}

      {loading ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1 }}>
          <CircularProgress size={18} />
          <Typography variant='body2'>{t('common.loading')}</Typography>
        </Box>
      ) : null}

      {/* Mode VMs : liste à plat de toutes les VMs */}
      {viewMode === 'vms' ? (
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          {displayVms.length === 0 ? (
            <Box sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant='body2' sx={{ opacity: 0.6 }}>
                {search.trim() ? `${t('common.noResults')} "${search}"` : t('common.noResults')}
              </Typography>
            </Box>
          ) : (
            <Box sx={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
              {virtualizer.getVirtualItems().map(virtualRow => {
                const vm = flatItems![virtualRow.index]
                const vmKey = `${vm.connId}:${vm.node}:${vm.type}:${vm.vmid}`
                return (
                  <Box
                    key={virtualRow.key}
                    ref={virtualizer.measureElement}
                    data-index={virtualRow.index}
                    sx={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <VmItem
                      vmKey={vmKey}
                      connId={vm.connId}
                      connName={vm.connName}
                      node={vm.node}
                      vmType={vm.type}
                      vmid={vm.vmid}
                      name={vm.name}
                      status={vm.status}
                      cpu={vm.cpu}
                      mem={vm.mem}
                      maxmem={vm.maxmem}
                      template={vm.template}
                      isCluster={vm.isCluster}
                      isSelected={selected?.id === vmKey}
                      isMigrating={isVmMigrating(vm.connId, vm.vmid)}
                      isPendingAction={isVmPendingAction(vm.connId, vm.vmid)}
                      isFavorite={favorites.has(vmKey)}
                      onFavoriteToggle={() => toggleFavorite(vm.connId, vm.node, vm.type, vm.vmid, vm.name)}
                      onClick={() => onSelect({ type: 'vm', id: vmKey })}
                      onDoubleClick={() => openConsoleWindow(vm.connId, vm.node, vm.type, vm.vmid)}
                      onContextMenu={(e) => handleContextMenu(e, vm.connId, vm.node, vm.type, vm.vmid, vm.name, vm.status, vm.isCluster, vm.template, vm.sshEnabled)}
                      variant="flat"
                      t={t}
                      tags={vm.tags ? String(vm.tags).split(';').filter(Boolean) : undefined}
                      showVmId={showVmId}
                      lock={vm.lock}
                    />
                  </Box>
                )
              })}
            </Box>
          )}
        </Box>
      ) : viewMode === 'favorites' ? (

        /* Mode Favoris */
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          {favoritesList.length === 0 ? (
            <Box sx={{ p: 2, textAlign: 'center' }}>
              <i className="ri-star-line" style={{ fontSize: 32, opacity: 0.2 }} />
              <Typography variant='body2' sx={{ opacity: 0.6, mt: 1 }}>
                {t('common.noResults')}
              </Typography>
              <Typography variant='caption' sx={{ opacity: 0.4 }}>
                {t('common.add')}
              </Typography>
            </Box>
          ) : (
            <Box sx={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
              {virtualizer.getVirtualItems().map(virtualRow => {
                const vm = flatItems![virtualRow.index]
                const vmKey = `${vm.connId}:${vm.node}:${vm.type}:${vm.vmid}`
                return (
                  <Box
                    key={virtualRow.key}
                    ref={virtualizer.measureElement}
                    data-index={virtualRow.index}
                    sx={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <VmItem
                      vmKey={vmKey}
                      connId={vm.connId}
                      connName={vm.connName}
                      node={vm.node}
                      vmType={vm.type}
                      vmid={vm.vmid}
                      name={vm.name}
                      status={vm.status}
                      cpu={vm.cpu}
                      mem={vm.mem}
                      maxmem={vm.maxmem}
                      template={vm.template}
                      isCluster={vm.isCluster}
                      isSelected={selected?.id === vmKey}
                      isMigrating={isVmMigrating(vm.connId, vm.vmid)}
                      isPendingAction={isVmPendingAction(vm.connId, vm.vmid)}
                      isFavorite={true}
                      onFavoriteToggle={() => toggleFavorite(vm.connId, vm.node, vm.type, vm.vmid, vm.name)}
                      onClick={() => onSelect({ type: 'vm', id: vmKey })}
                      onDoubleClick={() => openConsoleWindow(vm.connId, vm.node, vm.type, vm.vmid)}
                      onContextMenu={(e) => handleContextMenu(e, vm.connId, vm.node, vm.type, vm.vmid, vm.name, vm.status, vm.isCluster, vm.template, vm.sshEnabled)}
                      variant="favorite"
                      t={t}
                      tags={vm.tags ? String(vm.tags).split(';').filter(Boolean) : undefined}
                      showVmId={showVmId}
                      lock={vm.lock}
                    />
                  </Box>
                )
              })}
            </Box>
          )}
        </Box>
      ) : viewMode === 'hosts' ? (

        /* Mode Hôtes : groupé par hôte */
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          {hostsList.length === 0 ? (
            <Box sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant='body2' sx={{ opacity: 0.6 }}>{t('common.noResults')}</Typography>
            </Box>
          ) : (
            hostsList.map(host => {
              const isCollapsed = collapsedSections.has(`host:${host.key}`)

              
return (
              <Box key={host.key}>
                {/* Header hôte */}
                <Box
                  onClick={() => {
                    const willCollapse = !isCollapsed
                    toggleSection(`host:${host.key}`)
                    if (willCollapse && selected?.type === 'vm') {
                      const isInHost = host.vms.some(vm => `${vm.connId}:${vm.node}:${vm.type}:${vm.vmid}` === selected.id)
                      if (isInHost) onSelect(null)
                    }
                  }}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    px: 1.5,
                    py: 0.75,
                    bgcolor: 'background.paper',
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    cursor: 'pointer',
                    '&:hover': { bgcolor: 'action.hover' }
                  }}>
                  <i className={isCollapsed ? "ri-add-line" : "ri-subtract-line"} style={{ fontSize: 14, opacity: 0.7 }} />
                  <NodeIcon status={host.status || 'online'} size={16} />
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>{host.node}</Typography>
                  <Typography variant="caption" sx={{ opacity: 0.5 }}>({host.vms.length})</Typography>
                  <Typography variant="caption" sx={{ opacity: 0.4, ml: 'auto' }}>{host.connName}</Typography>
                </Box>
                {/* VMs de l'hôte */}
                {!isCollapsed && host.vms.map(vm => {
                  const vmKey = `${vm.connId}:${vm.node}:${vm.type}:${vm.vmid}`
                  return (
                    <VmItem
                      key={vmKey}
                      vmKey={vmKey}
                      connId={vm.connId}
                      connName={vm.connName}
                      node={vm.node}
                      vmType={vm.type}
                      vmid={vm.vmid}
                      name={vm.name}
                      status={vm.status}
                      cpu={vm.cpu}
                      mem={vm.mem}
                      maxmem={vm.maxmem}
                      template={vm.template}
                      isCluster={vm.isCluster}
                      isSelected={selected?.id === vmKey}
                      isMigrating={isVmMigrating(vm.connId, vm.vmid)}
                      isPendingAction={isVmPendingAction(vm.connId, vm.vmid)}
                      isFavorite={favorites.has(vmKey)}
                      onFavoriteToggle={() => toggleFavorite(vm.connId, vm.node, vm.type, vm.vmid, vm.name)}
                      onClick={() => onSelect({ type: 'vm', id: vmKey })}
                      onDoubleClick={() => openConsoleWindow(vm.connId, vm.node, vm.type, vm.vmid)}
                      onContextMenu={(e) => handleContextMenu(e, vm.connId, vm.node, vm.type, vm.vmid, vm.name, vm.status, vm.isCluster, vm.template, vm.sshEnabled)}
                      variant="grouped"
                      t={t}
                      tags={vm.tags ? String(vm.tags).split(';').filter(Boolean) : undefined}
                      showVmId={showVmId}
                      lock={vm.lock}
                    />
                  )
                })}
              </Box>
            )})
          )}
        </Box>
      ) : viewMode === 'pools' ? (

        /* Mode Pools : groupé par pool */
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          {poolsList.length === 0 ? (
            <Box sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant='body2' sx={{ opacity: 0.6 }}>{t('common.noResults')}</Typography>
            </Box>
          ) : (
            poolsList.map(({ pool, vms }) => {
              const isCollapsed = collapsedSections.has(`pool:${pool}`)

              
return (
              <Box key={pool}>
                {/* Header pool */}
                <Box
                  onClick={() => {
                    const willCollapse = !isCollapsed
                    toggleSection(`pool:${pool}`)
                    if (willCollapse && selected?.type === 'vm') {
                      const isInPool = vms.some(vm => `${vm.connId}:${vm.node}:${vm.type}:${vm.vmid}` === selected.id)
                      if (isInPool) onSelect(null)
                    }
                  }}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    px: 1.5,
                    py: 0.75,
                    bgcolor: 'background.paper',
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    cursor: 'pointer',
                    '&:hover': { bgcolor: 'action.hover' }
                  }}>
                  <i className={isCollapsed ? "ri-add-line" : "ri-subtract-line"} style={{ fontSize: 14, opacity: 0.7 }} />
                  <i className="ri-folder-fill" style={{ fontSize: 14, opacity: 0.7 }} />
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>{pool}</Typography>
                  <Typography variant="caption" sx={{ opacity: 0.5 }}>({vms.length})</Typography>
                </Box>
                {/* VMs du pool */}
                {!isCollapsed && vms.map(vm => {
                  const vmKey = `${vm.connId}:${vm.node}:${vm.type}:${vm.vmid}`
                  return (
                    <VmItem
                      key={vmKey}
                      vmKey={vmKey}
                      connId={vm.connId}
                      connName={vm.connName}
                      node={vm.node}
                      vmType={vm.type}
                      vmid={vm.vmid}
                      name={vm.name}
                      status={vm.status}
                      cpu={vm.cpu}
                      mem={vm.mem}
                      maxmem={vm.maxmem}
                      template={vm.template}
                      isCluster={vm.isCluster}
                      isSelected={selected?.id === vmKey}
                      isMigrating={isVmMigrating(vm.connId, vm.vmid)}
                      isPendingAction={isVmPendingAction(vm.connId, vm.vmid)}
                      isFavorite={favorites.has(vmKey)}
                      onFavoriteToggle={() => toggleFavorite(vm.connId, vm.node, vm.type, vm.vmid, vm.name)}
                      onClick={() => onSelect({ type: 'vm', id: vmKey })}
                      onDoubleClick={() => openConsoleWindow(vm.connId, vm.node, vm.type, vm.vmid)}
                      onContextMenu={(e) => handleContextMenu(e, vm.connId, vm.node, vm.type, vm.vmid, vm.name, vm.status, vm.isCluster, vm.template, vm.sshEnabled)}
                      variant="grouped"
                      t={t}
                      tags={vm.tags ? String(vm.tags).split(';').filter(Boolean) : undefined}
                      showVmId={showVmId}
                      lock={vm.lock}
                    />
                  )
                })}
              </Box>
            )})
          )}
        </Box>
      ) : viewMode === 'tags' ? (

        /* Mode Tags : groupé par tag */
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          {tagsList.length === 0 ? (
            <Box sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant='body2' sx={{ opacity: 0.6 }}>{t('common.noResults')}</Typography>
            </Box>
          ) : (
            tagsList.map(({ tag, vms, entities }) => {
              const isCollapsed = collapsedSections.has(`tag:${tag}`)
              const totalCount = vms.length + entities.length
              const tagConnId = vms[0]?.connId || entities[0]?.connId
              const tc = getTagColor(tag, tagConnId).bg


return (
              <Box key={tag}>
                {/* Header tag */}
                <Box
                  onClick={() => {
                    const willCollapse = !isCollapsed
                    toggleSection(`tag:${tag}`)
                    if (willCollapse && selected?.type === 'vm') {
                      const isInTag = vms.some(vm => `${vm.connId}:${vm.node}:${vm.type}:${vm.vmid}` === selected.id)
                      if (isInTag) onSelect(null)
                    }
                  }}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    px: 1.5,
                    py: 0.75,
                    bgcolor: 'background.paper',
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    cursor: 'pointer',
                    '&:hover': { bgcolor: 'action.hover' }
                  }}>
                  <i className={isCollapsed ? "ri-add-line" : "ri-subtract-line"} style={{ fontSize: 14, opacity: 0.7 }} />
                  <i className="ri-price-tag-3-fill" style={{ fontSize: 14, color: tc }} />
                  <Typography variant="body2" sx={{ fontWeight: 700, color: tc }}>{tag}</Typography>
                  <Typography variant="caption" sx={{ opacity: 0.5 }}>({totalCount})</Typography>
                </Box>
                {/* Entities (clusters/nodes) avec ce tag */}
                {!isCollapsed && entities.map(entity => {
                  const entityKey = entity.type === 'cluster' ? `cluster:${entity.connId}` : `node:${entity.connId}:${entity.node}`
                  const isSelected = selected?.id === (entity.type === 'cluster' ? entity.connId : `${entity.connId}:${entity.node}`)
                  const clu = clusters.find(c => c.connId === entity.connId)
                  const nodeData = entity.type === 'node' ? clu?.nodes.find(n => n.node === entity.node) : null
                  return (
                    <Box
                      key={`${entityKey}-${tag}`}
                      onClick={() => onSelect({ type: entity.type === 'cluster' ? 'cluster' : 'node', id: entity.type === 'cluster' ? entity.connId : `${entity.connId}:${entity.node}` })}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        px: 2.5,
                        py: 0.5,
                        cursor: 'pointer',
                        bgcolor: isSelected ? 'action.selected' : 'transparent',
                        '&:hover': { bgcolor: isSelected ? 'action.selected' : 'action.hover' },
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                      }}
                    >
                      {entity.type === 'cluster' ? (
                        <ClusterIcon nodes={clu?.nodes || []} size={14} />
                      ) : (
                        <NodeIcon status={nodeData?.status} maintenance={nodeData?.maintenance} size={14} />
                      )}
                      <Typography variant="body2" sx={{ fontSize: 12.5, fontWeight: isSelected ? 600 : 400 }}>
                        {entity.name}
                      </Typography>
                      <Typography variant="caption" sx={{ opacity: 0.4, fontSize: 10, ml: 'auto' }}>
                        {entity.type === 'cluster' ? 'cluster' : 'node'}
                      </Typography>
                    </Box>
                  )
                })}
                {/* VMs avec ce tag */}
                {!isCollapsed && vms.map(vm => {
                  const vmKey = `${vm.connId}:${vm.node}:${vm.type}:${vm.vmid}`
                  const tagVmKey = `${vmKey}-${tag}`
                  return (
                    <VmItem
                      key={tagVmKey}
                      vmKey={vmKey}
                      connId={vm.connId}
                      connName={vm.connName}
                      node={vm.node}
                      vmType={vm.type}
                      vmid={vm.vmid}
                      name={vm.name}
                      status={vm.status}
                      cpu={vm.cpu}
                      mem={vm.mem}
                      maxmem={vm.maxmem}
                      template={vm.template}
                      isCluster={vm.isCluster}
                      isSelected={selected?.id === vmKey}
                      isMigrating={isVmMigrating(vm.connId, vm.vmid)}
                      isPendingAction={isVmPendingAction(vm.connId, vm.vmid)}
                      isFavorite={favorites.has(vmKey)}
                      onFavoriteToggle={() => toggleFavorite(vm.connId, vm.node, vm.type, vm.vmid, vm.name)}
                      onClick={() => onSelect({ type: 'vm', id: vmKey })}
                      onDoubleClick={() => openConsoleWindow(vm.connId, vm.node, vm.type, vm.vmid)}
                      onContextMenu={(e) => handleContextMenu(e, vm.connId, vm.node, vm.type, vm.vmid, vm.name, vm.status, vm.isCluster, vm.template, vm.sshEnabled)}
                      variant="grouped"
                      t={t}
                      tags={vm.tags ? String(vm.tags).split(';').filter(Boolean) : undefined}
                      showVmId={showVmId}
                      lock={vm.lock}
                    />
                  )
                })}
              </Box>
            )})
          )}
        </Box>
      ) : viewMode === 'templates' ? (

        /* Mode Templates : uniquement les templates */
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          {filteredVms.filter(vm => vm.template).length === 0 ? (
            <Box sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant='body2' sx={{ opacity: 0.6 }}>{t('common.noResults')}</Typography>
            </Box>
          ) : (
            <Box sx={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
              {virtualizer.getVirtualItems().map(virtualRow => {
                const vm = flatItems![virtualRow.index]
                const vmKey = `${vm.connId}:${vm.node}:${vm.type}:${vm.vmid}`
                return (
                  <Box
                    key={virtualRow.key}
                    ref={virtualizer.measureElement}
                    data-index={virtualRow.index}
                    sx={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <VmItem
                      vmKey={vmKey}
                      connId={vm.connId}
                      connName={vm.connName}
                      node={vm.node}
                      vmType={vm.type}
                      vmid={vm.vmid}
                      name={vm.name}
                      status={vm.status}
                      cpu={vm.cpu}
                      mem={vm.mem}
                      maxmem={vm.maxmem}
                      template={vm.template}
                      isCluster={vm.isCluster}
                      isSelected={selected?.id === vmKey}
                      isMigrating={isVmMigrating(vm.connId, vm.vmid)}
                      isPendingAction={isVmPendingAction(vm.connId, vm.vmid)}
                      isFavorite={favorites.has(vmKey)}
                      onFavoriteToggle={() => toggleFavorite(vm.connId, vm.node, vm.type, vm.vmid, vm.name)}
                      onClick={() => onSelect({ type: 'vm', id: vmKey })}
                      onContextMenu={(e) => handleContextMenu(e, vm.connId, vm.node, vm.type, vm.vmid, vm.name, vm.status, vm.isCluster, vm.template, vm.sshEnabled)}
                      variant="template"
                      t={t}
                      tags={vm.tags ? String(vm.tags).split(';').filter(Boolean) : undefined}
                      showVmId={showVmId}
                      lock={vm.lock}
                    />
                  </Box>
                )
              })}
            </Box>
          )}
        </Box>
      ) : (

      /* Mode Arbre : vue hiérarchique */
      <>
        {filteredClusters.length === 0 && search.trim() ? (
          <Box sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant='body2' sx={{ opacity: 0.6 }}>
              {t('common.noResults')} "{search}"
            </Typography>
          </Box>
        ) : null}

        {/* ── Proxmox VE Section ── */}
        {filteredClusters.length > 0 && (
          <Box
            onClick={() => {
              toggleSection('pve')
              onSelect({ type: 'root', id: 'root' })
            }}
            sx={{
              display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.75,
              bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
              borderTop: '1px solid', borderBottom: '1px solid', borderColor: 'divider',
              cursor: 'pointer', '&:hover': { bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.09)' },
            }}
          >
            <i className={collapsedSections.has('pve') ? 'ri-add-line' : 'ri-subtract-line'} style={{ fontSize: 14, opacity: 0.7 }} />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" style={{ width: 14, height: 14 }} />
              <Typography variant="body2" sx={{ fontWeight: 700 }}>{t('inventory.headerProxmoxVe')}</Typography>
            </Box>
            <Typography variant="caption" sx={{ opacity: 0.5 }}>
              ({(() => {
                const realClusters = filteredClusters.filter(c => c.isCluster).length
                const totalNodes = filteredClusters.reduce((acc, c) => acc + c.nodes.length, 0)
                return `${realClusters} clusters, ${totalNodes} PVE, ${allVms.length} VMs`
              })()})
            </Typography>
          </Box>
        )}

        <Collapse in={!collapsedSections.has('pve')}>
        <SimpleTreeView
          expansionTrigger="iconContainer"
          slots={{ expandIcon: () => <i className="ri-add-line" style={{ fontSize: 14, opacity: 0.5 }} />, collapseIcon: () => <i className="ri-subtract-line" style={{ fontSize: 14, opacity: 0.5 }} /> }}
          selectedItems={selectedItemId || ''}
          expandedItems={search.trim() ? expandedItems : manualExpandedItems}
          onExpandedItemsChange={(_event, itemIds) => {
            if (!search.trim() && !programmaticExpand.current) setManualExpandedItems(itemIds)
            expandingRef.current = true
            requestAnimationFrame(() => { expandingRef.current = false })
          }}
          onSelectedItemsChange={(_event, ids) => {
            if (expandingRef.current) return
            const picked = Array.isArray(ids) ? ids[0] : ids

            if (!picked) return

            // Vérifier si c'est une VM en migration
            const itemStr = String(picked)

            if (itemStr.startsWith('vm:')) {
              // Format: vm:connId:node:type:vmid
              const parts = itemStr.split(':')

              if (parts.length >= 5) {
                const connId = parts[1]
                const vmid = parts[4]

                if (isVmMigrating(connId, vmid)) {
                  // VM en migration, ignorer la sélection
                  return
                }
              }
            }

            const sel = selectionFromItemId(itemStr)

            if (sel) onSelect(sel)
          }}
        >
        {filteredClusters.map(clu => {
          // Pour un standalone (1 seul node), on affiche directement le node sans niveau cluster
          if (!clu.isCluster && clu.nodes.length === 1) {
            const n = clu.nodes[0]

            
return (
              <TreeItem
                key={`${clu.connId}:${n.node}`}
                itemId={`node:${clu.connId}:${n.node}`}
                onContextMenu={(e) => handleNodeContextMenu(e, clu.connId, n.node, n.maintenance, clu.sshEnabled)}
                label={
                  <Tooltip
                    title={<NodeTooltipContent name={clu.name} status={n.status} cpu={n.cpu} mem={n.mem} maxmem={n.maxmem} maintenance={n.maintenance} />}
                    enterDelay={1000} enterNextDelay={1000} placement="right" slotProps={tooltipSlotProps}
                  >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <NodeIcon status={n.status} maintenance={n.maintenance} size={16} />
                    <span style={{ fontSize: 13 }}>{clu.name}</span>
                    <span style={{ opacity: 0.5, fontSize: 11 }}>({n.vms.length})</span>
                    {clu.cephHealth && clu.cephHealth !== 'HEALTH_OK' && (
                      <Box component="span" sx={{ display: 'flex', alignItems: 'center', ml: 0.5 }}>
                        <i
                          className={clu.cephHealth === 'HEALTH_ERR' ? 'ri-close-circle-fill' : 'ri-alert-fill'}
                          style={{
                            fontSize: 14,
                            color: clu.cephHealth === 'HEALTH_ERR' ? '#f44336' : '#ff9800'
                          }}
                        />
                      </Box>
                    )}
                  </Box>
                  </Tooltip>
                }
              >
                {n.vms.map(vm => {
                  const vmKey = `${clu.connId}:${n.node}:${vm.type}:${vm.vmid}`
                  const isMigrating = isVmMigrating(clu.connId, vm.vmid)
                  const vmContent = (
                  <TreeItem
                    key={vmKey}
                    itemId={`vm:${clu.connId}:${n.node}:${vm.type}:${vm.vmid}`}
                    disabled={isMigrating}
                    onContextMenu={(e) => !isMigrating && handleContextMenu(e, clu.connId, n.node, vm.type, vm.vmid, vm.name, vm.status, clu.isCluster, vm.template, clu.sshEnabled)}
                    sx={{
                      opacity: isMigrating ? 0.5 : 1,
                      cursor: isMigrating ? 'not-allowed' : 'pointer',
                      '& > .MuiTreeItem-content': {
                        cursor: isMigrating ? 'not-allowed' : 'pointer',
                      }
                    }}
                    label={
                      <VmItem
                        vmKey={vmKey}
                        connId={clu.connId}
                        connName={clu.name}
                        node={n.node}
                        vmType={vm.type}
                        vmid={vm.vmid}
                        name={vm.name}
                        status={vm.status}
                        cpu={vm.cpu}
                        mem={vm.mem}
                        maxmem={vm.maxmem}
                        template={vm.template}
                        isCluster={clu.isCluster}
                        isSelected={false}
                        isMigrating={isMigrating}
                        isPendingAction={isVmPendingAction(clu.connId, vm.vmid)}
                        isFavorite={favorites.has(vmKey)}
                        onFavoriteToggle={() => toggleFavorite(clu.connId, n.node, vm.type, vm.vmid, vm.name)}
                        onClick={() => {}}
                        onDoubleClick={() => openConsoleWindow(clu.connId, n.node, vm.type, vm.vmid)}
                        onContextMenu={() => {}}
                        variant="tree"
                        t={t}
                        tags={vm.tags ? String(vm.tags).split(';').filter(Boolean) : undefined}
                        showVmId={showVmId}
                        lock={vm.lock}
                      />
                    }
                  />
                  )
                  return isMigrating ? <Tooltip key={vmKey} title={t('audit.actions.migrate') + "..."} placement="right">{vmContent}</Tooltip> : vmContent
                })}
              </TreeItem>
            )
          }

          // Pour un cluster (multi-nodes), on affiche le cluster puis les nodes
          return (
            <TreeItem
              key={clu.connId}
              itemId={`cluster:${clu.connId}`}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setClusterContextMenu({ mouseX: e.clientX, mouseY: e.clientY, connId: clu.connId, name: clu.name, nodes: clu.nodes })
              }}
              label={
                <Tooltip
                  title={<ClusterTooltipContent name={clu.name} nodes={clu.nodes} />}
                  enterDelay={1000} enterNextDelay={1000} placement="right" slotProps={tooltipSlotProps}
                >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <ClusterIcon nodes={clu.nodes} />
                  <span style={{ fontSize: 13 }}>{clu.name}</span>
                  {clu.cephHealth && clu.cephHealth !== 'HEALTH_OK' && (
                    <Box component="span" sx={{ display: 'flex', alignItems: 'center' }}>
                      <i
                        className={clu.cephHealth === 'HEALTH_ERR' ? 'ri-close-circle-fill' : 'ri-alert-fill'}
                        style={{
                          fontSize: 14,
                          color: clu.cephHealth === 'HEALTH_ERR' ? '#f44336' : '#ff9800'
                        }}
                      />
                    </Box>
                  )}
                </Box>
                </Tooltip>
              }
            >
              {clu.nodes.map(n => (
                <TreeItem
                  key={`${clu.connId}:${n.node}`}
                  itemId={`node:${clu.connId}:${n.node}`}
                  onContextMenu={(e) => handleNodeContextMenu(e, clu.connId, n.node, n.maintenance, clu.sshEnabled)}
                  label={
                    <Tooltip
                      title={<NodeTooltipContent name={n.node} status={n.status} cpu={n.cpu} mem={n.mem} maxmem={n.maxmem} maintenance={n.maintenance} />}
                      enterDelay={1000} enterNextDelay={1000} placement="right" slotProps={tooltipSlotProps}
                    >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <NodeIcon status={n.status} maintenance={n.maintenance} size={16} />
                      <span style={{ fontSize: 13 }}>{n.node}</span>
                      <span style={{ opacity: 0.5, fontSize: 11 }}>({n.vms.length})</span>
                    </Box>
                    </Tooltip>
                  }
                >
                  {n.vms.map(vm => {
                    const vmKey = `${clu.connId}:${n.node}:${vm.type}:${vm.vmid}`
                    const isMigrating = isVmMigrating(clu.connId, vm.vmid)
                    const vmContent = (
                    <TreeItem
                      key={vmKey}
                      itemId={`vm:${clu.connId}:${n.node}:${vm.type}:${vm.vmid}`}
                      disabled={isMigrating}
                      onContextMenu={(e) => !isMigrating && handleContextMenu(e, clu.connId, n.node, vm.type, vm.vmid, vm.name, vm.status, clu.isCluster, vm.template, clu.sshEnabled)}
                      sx={{
                        opacity: isMigrating ? 0.5 : 1,
                        '& > .MuiTreeItem-content': {
                          cursor: isMigrating ? 'not-allowed' : 'pointer',
                        }
                      }}
                      label={
                        <VmItem
                          vmKey={vmKey}
                          connId={clu.connId}
                          connName={clu.name}
                          node={n.node}
                          vmType={vm.type}
                          vmid={vm.vmid}
                          name={vm.name}
                          status={vm.status}
                          cpu={vm.cpu}
                          mem={vm.mem}
                          maxmem={vm.maxmem}
                          template={vm.template}
                          isCluster={clu.isCluster}
                          isSelected={false}
                          isMigrating={isMigrating}
                          isPendingAction={isVmPendingAction(clu.connId, vm.vmid)}
                          isFavorite={favorites.has(vmKey)}
                          onFavoriteToggle={() => toggleFavorite(clu.connId, n.node, vm.type, vm.vmid, vm.name)}
                          onClick={() => {}}
                          onDoubleClick={() => openConsoleWindow(clu.connId, n.node, vm.type, vm.vmid)}
                          onContextMenu={() => {}}
                          variant="tree"
                          t={t}
                          tags={vm.tags ? String(vm.tags).split(';').filter(Boolean) : undefined}
                          showVmId={showVmId}
                          lock={vm.lock}
                        />
                      }
                    />
                    )
                    return isMigrating ? <Tooltip key={vmKey} title={t('audit.actions.migrate') + "..."} placement="right">{vmContent}</Tooltip> : vmContent
                  })}
                </TreeItem>
              ))}
            </TreeItem>
          )
        })}
        </SimpleTreeView>
        </Collapse>
      </>
      )}

      {/* ── Proxmox Storage Section ── */}
      {viewMode === 'tree' && clusterStorages.length > 0 && (
        <>
          <Box
            onClick={(e) => {
              toggleSection('storage')
              onSelect({ type: 'storage-root', id: 'storage-root' })
            }}
            sx={{
              display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.75,
              bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
              borderTop: '1px solid', borderBottom: '1px solid', borderColor: 'divider',
              cursor: 'pointer', '&:hover': { bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.09)' },
            }}
          >
            <i className={collapsedSections.has('storage') ? 'ri-add-line' : 'ri-subtract-line'} style={{ fontSize: 14, opacity: 0.7 }} />
            <i className="ri-database-2-fill" style={{ fontSize: 14, opacity: 0.7 }} />
            <Typography variant="body2" sx={{ fontWeight: 700 }}>STORAGE</Typography>
            <Typography variant="caption" sx={{ opacity: 0.5 }}>
              ({clusterStorages.reduce((acc, cs) => acc + cs.sharedStorages.length + cs.nodes.reduce((a, n) => a + n.storages.length, 0), 0)})
            </Typography>
          </Box>
          <Collapse in={!collapsedSections.has('storage')}>
          <SimpleTreeView
            expansionTrigger="iconContainer"
            slots={{ expandIcon: () => <i className="ri-add-line" style={{ fontSize: 14, opacity: 0.5 }} />, collapseIcon: () => <i className="ri-subtract-line" style={{ fontSize: 14, opacity: 0.5 }} /> }}
            selectedItems={selectedItemId || ''}
            expandedItems={storageExpandedItems}
            onExpandedItemsChange={(_event, itemIds) => {
              setStorageExpandedItems(itemIds)
              expandingRef.current = true
              requestAnimationFrame(() => { expandingRef.current = false })
            }}
            onSelectedItemsChange={(_event, ids) => {
              if (expandingRef.current) return
              const picked = Array.isArray(ids) ? ids[0] : ids
              if (!picked) return
              const sel = selectionFromItemId(String(picked))
              if (sel) onSelect(sel)
            }}
          >
          {clusterStorages.map(cs => {
            const isCeph = (type: string) => type === 'rbd' || type === 'cephfs'
            const storageIcon = (type: string) => {
              if (isCeph(type)) return '' // handled by <img>
              if (type === 'nfs' || type === 'cifs') return 'ri-folder-shared-fill'
              if (type === 'zfspool' || type === 'zfs') return 'ri-stack-fill'
              if (type === 'lvm' || type === 'lvmthin') return 'ri-hard-drive-2-fill'
              if (type === 'dir') return 'ri-folder-fill'
              return 'ri-hard-drive-fill'
            }
            const storageColor = (type: string) => {
              if (type === 'nfs' || type === 'cifs') return '#3498db'
              if (type === 'zfspool' || type === 'zfs') return '#2ecc71'
              if (type === 'lvm' || type === 'lvmthin') return '#e67e22'
              return '#95a5a6'
            }
            const formatSize = (bytes: number) => {
              if (bytes >= 1099511627776) return `${(bytes / 1099511627776).toFixed(1)}T`
              if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(0)}G`
              if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(0)}M`
              return `${bytes}B`
            }
            const storageLabel = (s: TreeStorageItem) => (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, width: '100%' }}>
                {isCeph(s.type)
                  ? <img src="/images/ceph-logo.svg" alt="" width={14} height={14} style={{ flexShrink: 0, opacity: 0.8 }} />
                  : <i className={storageIcon(s.type)} style={{ fontSize: 14, color: storageColor(s.type), opacity: 0.8, flexShrink: 0 }} />
                }
                <span style={{ fontSize: 13 }}>{s.storage}</span>
                <span style={{ opacity: 0.4, fontSize: 10, flexShrink: 0 }}>{s.type}</span>
                {s.total > 0 && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 'auto', flexShrink: 0 }}>
                    <Box sx={{ width: 30, height: 3, bgcolor: 'action.hover', borderRadius: 1, overflow: 'hidden' }}>
                      <Box sx={{ width: `${s.usedPct}%`, height: '100%', bgcolor: s.usedPct > 90 ? 'error.main' : s.usedPct > 70 ? 'warning.main' : 'success.main' }} />
                    </Box>
                    <span style={{ fontSize: 10, opacity: 0.5 }}>{s.usedPct}%</span>
                  </Box>
                )}
              </Box>
            )

            // Standalone (1 node) : flatten — no intermediate node level
            if (!cs.isCluster && cs.nodes.length <= 1) {
              const allStorages = [...cs.sharedStorages, ...(cs.nodes[0]?.storages || [])]
              const nodeStatus = cs.nodes[0]?.status
              return (
                <TreeItem
                  key={`storage-cluster:${cs.connId}`}
                  itemId={`storage-cluster:${cs.connId}`}
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <NodeIcon status={nodeStatus} size={16} />
                      <span style={{ fontSize: 13 }}>{cs.connName}</span>
                      <span style={{ opacity: 0.4, fontSize: 11 }}>({allStorages.length})</span>
                    </Box>
                  }
                >
                  {allStorages.map(s => (
                    <TreeItem
                      key={`storage:${cs.connId}:${s.storage}:${s.node}`}
                      itemId={`storage:${cs.connId}:${s.storage}:${s.node}`}
                      label={storageLabel(s)}
                    />
                  ))}
                </TreeItem>
              )
            }

            // Cluster (multi-nodes) : cluster > shared + per-node local storages
            return (
              <TreeItem
                key={`storage-cluster:${cs.connId}`}
                itemId={`storage-cluster:${cs.connId}`}
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <ClusterIcon nodes={cs.nodes} />
                    <span style={{ fontSize: 13 }}>{cs.connName}</span>
                  </Box>
                }
              >
                {/* Shared storages at cluster level */}
                {cs.sharedStorages.map(s => (
                  <TreeItem
                    key={`storage:${cs.connId}:${s.storage}`}
                    itemId={`storage:${cs.connId}:${s.storage}`}
                    label={storageLabel(s)}
                  />
                ))}
                {/* Per-node local storages */}
                {cs.nodes.filter(n => n.storages.length > 0).map(n => (
                  <TreeItem
                    key={`storage-node:${cs.connId}:${n.node}`}
                    itemId={`storage-node:${cs.connId}:${n.node}`}
                    label={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <NodeIcon status={n.status} size={16} />
                        <span style={{ fontSize: 13, opacity: n.status === 'online' ? 1 : 0.5 }}>{n.node}</span>
                        <span style={{ opacity: 0.4, fontSize: 11 }}>({n.storages.length})</span>
                      </Box>
                    }
                  >
                    {n.storages.map(s => (
                      <TreeItem
                        key={`storage:${cs.connId}:${s.storage}:${n.node}`}
                        itemId={`storage:${cs.connId}:${s.storage}:${n.node}`}
                        label={storageLabel(s)}
                      />
                    ))}
                  </TreeItem>
                ))}
              </TreeItem>
            )
          })}
          </SimpleTreeView>
          </Collapse>
        </>
      )}

      {/* ── Network Section ── */}
      {viewMode === 'tree' && clusters.length > 0 && (
        <>
          <Box
            onClick={() => {
              toggleNetSection('network')
              if (!expandedNetSections.has('network') && !networkFetchedRef.current) {
                networkFetchedRef.current = true
                fetchNetworks()
              }
              onSelect({ type: 'network-root', id: 'network-root' })
            }}
            sx={{
              display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.75,
              bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
              borderTop: '1px solid', borderBottom: '1px solid', borderColor: 'divider',
              cursor: 'pointer', '&:hover': { bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.09)' },
            }}
          >
            <i className={expandedNetSections.has('network') ? 'ri-subtract-line' : 'ri-add-line'} style={{ fontSize: 14, opacity: 0.7 }} />
            <i className="ri-router-fill" style={{ fontSize: 14, opacity: 0.7 }} />
            <Typography variant="body2" sx={{ fontWeight: 700 }}>NETWORK</Typography>
            {networkData.length > 0 && (
              <Typography variant="caption" sx={{ opacity: 0.5 }}>
                ({new Set(networkData.flatMap(v => v.nets.filter(n => n.tag != null).map(n => n.tag))).size} VLANs)
              </Typography>
            )}
          </Box>
          <Collapse in={expandedNetSections.has('network')}>
            {networkLoading ? (
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 2 }}>
                <CircularProgress size={16} />
                <Typography variant="caption" sx={{ ml: 1, opacity: 0.5 }}>Loading networks...</Typography>
              </Box>
            ) : networkTree.length === 0 && networkFetchedRef.current ? (
              <Box sx={{ py: 2, textAlign: 'center' }}>
                <Typography variant="caption" sx={{ opacity: 0.4 }}>No network data</Typography>
              </Box>
            ) : (
              <SimpleTreeView
                expansionTrigger="iconContainer"
            slots={{ expandIcon: () => <i className="ri-add-line" style={{ fontSize: 14, opacity: 0.5 }} />, collapseIcon: () => <i className="ri-subtract-line" style={{ fontSize: 14, opacity: 0.5 }} /> }}
                selectedItems={selectedItemId || ''}
                expandedItems={networkTreeExpandedItems}
                onExpandedItemsChange={(_event, itemIds) => {
                  setNetworkTreeExpandedItems(itemIds)
                  expandingRef.current = true
                  requestAnimationFrame(() => { expandingRef.current = false })
                }}
                onSelectedItemsChange={(_event, ids) => {
                  if (expandingRef.current) return
                  const picked = Array.isArray(ids) ? ids[0] : ids
                  if (!picked) return
                  const sel = selectionFromItemId(String(picked))
                  if (sel) onSelect(sel)
                }}
              >
              {networkTree.map(({ connId: cId, connName, nodes }) => (
                <TreeItem
                  key={`net-conn:${cId}`}
                  itemId={`net-conn:${cId}`}
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <ClusterIcon nodes={clusters.find(c => c.connId === cId)?.nodes || []} />
                      <span style={{ fontSize: 13 }}>{connName}</span>
                      <span style={{ opacity: 0.4, fontSize: 11 }}>({nodes.length} nodes)</span>
                    </Box>
                  }
                >
                  {nodes.map(({ node, vlans, totalVlans, totalVms }) => {
                    const nodeStatus = clusters.find(c => c.connId === cId)?.nodes.find(n => n.node === node)?.status
                    return (
                    <TreeItem
                      key={`net-node:${cId}:${node}`}
                      itemId={`net-node:${cId}:${node}`}
                      label={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                          <NodeIcon status={nodeStatus || 'online'} size={16} />
                          <span style={{ fontSize: 13 }}>{node}</span>
                          <span style={{ opacity: 0.4, fontSize: 11 }}>
                            ({totalVlans > 0 ? `${totalVlans} VLAN${totalVlans > 1 ? 's' : ''}, ` : ''}{totalVms} VM{totalVms > 1 ? 's' : ''})
                          </span>
                        </Box>
                      }
                    >
                      {vlans.map(({ tag, entries }) => (
                        <TreeItem
                          key={`net-vlan:${cId}:${node}:${tag}`}
                          itemId={`net-vlan:${cId}:${node}:${tag}`}
                          label={
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                              <i className={tag === 'untagged' ? 'ri-link-unlink' : 'ri-wifi-line'} style={{ fontSize: 14, opacity: 0.5 }} />
                              <span style={{ fontSize: 13 }}>
                                {tag === 'untagged' ? 'Untagged' : `VLAN ${tag}`}
                              </span>
                              <span style={{ opacity: 0.4, fontSize: 11 }}>({entries.length})</span>
                            </Box>
                          }
                        >
                          {entries.map(({ vm, netId, bridge }) => {
                            const vmKey = `${vm.connId}:${vm.node}:${vm.type}:${vm.vmid}`
                            return (
                              <TreeItem
                                key={`${vmKey}-${netId}-${tag}`}
                                itemId={`vm:${vmKey}:${netId}:${tag}`}
                                label={
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                    <StatusIcon status={vm.status} type="vm" vmType={vm.type} />
                                    <Typography variant="body2" sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {vm.name}
                                    </Typography>
                                    <span style={{ opacity: 0.3, fontFamily: 'monospace', fontSize: 10 }}>
                                      {vm.vmid}
                                    </span>
                                    <span style={{ opacity: 0.4, fontSize: 10 }}>
                                      {bridge}
                                    </span>
                                  </Box>
                                }
                              />
                            )
                          })}
                        </TreeItem>
                      ))}
                    </TreeItem>
                  )})}
                </TreeItem>
              ))}
              </SimpleTreeView>
            )}
          </Collapse>
        </>
      )}

      {/* ── PBS / Backup Section ── */}
      {viewMode === 'tree' && pbsServers.length > 0 && (
        <>
          <Box
            onClick={() => {
              toggleSection('pbs')
              onSelect({ type: 'backup-root', id: 'backup-root' })
            }}
            sx={{
              display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.75,
              bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
              borderTop: '1px solid', borderBottom: '1px solid', borderColor: 'divider',
              cursor: 'pointer', '&:hover': { bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.09)' },
            }}
          >
            <i className={collapsedSections.has('pbs') ? 'ri-add-line' : 'ri-subtract-line'} style={{ fontSize: 14, opacity: 0.7 }} />
            <i className="ri-hard-drive-2-fill" style={{ fontSize: 14, opacity: 0.7 }} />
            <Typography variant="body2" sx={{ fontWeight: 700 }}>BACKUP</Typography>
            <Typography variant="caption" sx={{ opacity: 0.5 }}>
              ({pbsServers.length} PBS, {pbsServers.reduce((acc, p) => acc + p.stats.backupCount, 0)} backups)
            </Typography>
          </Box>

          <Collapse in={!collapsedSections.has('pbs')}>
          <SimpleTreeView
            expansionTrigger="iconContainer"
            slots={{ expandIcon: () => <i className="ri-add-line" style={{ fontSize: 14, opacity: 0.5 }} />, collapseIcon: () => <i className="ri-subtract-line" style={{ fontSize: 14, opacity: 0.5 }} /> }}
            selectedItems={selectedItemId || ''}
            expandedItems={backupExpandedItems}
            onExpandedItemsChange={(_event, itemIds) => {
              setBackupExpandedItems(itemIds)
              expandingRef.current = true
              requestAnimationFrame(() => { expandingRef.current = false })
            }}
            onSelectedItemsChange={(_event, ids) => {
              if (expandingRef.current) return
              const picked = Array.isArray(ids) ? ids[0] : ids
              if (!picked) return
              const sel = selectionFromItemId(String(picked))
              if (sel) onSelect(sel)
            }}
          >
          {pbsServers.map(pbs => (
            <TreeItem
              key={`pbs:${pbs.connId}`}
              itemId={`pbs:${pbs.connId}`}
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <Box component="span" sx={{ position: 'relative', display: 'inline-flex', width: 16, height: 16, flexShrink: 0, alignItems: 'center', justifyContent: 'center' }}>
                    <i className='ri-hard-drive-2-fill' style={{ opacity: 0.8, fontSize: 16 }} />
                    <Box sx={{ position: 'absolute', bottom: -2, right: -2, width: 8, height: 8, borderRadius: '50%', bgcolor: pbs.status === 'online' ? '#4caf50' : '#f44336', border: '1.5px solid', borderColor: 'background.paper' }} />
                  </Box>
                  <span style={{ fontSize: 13 }}>{pbs.name}</span>
                  <span style={{ opacity: 0.5, fontSize: 11 }}>
                    ({pbs.stats.backupCount} backups)
                  </span>
                </Box>
              }
            >
              {/* Datastores du serveur PBS */}
              {pbs.datastores.map(ds => (
                <TreeItem
                  key={`datastore:${pbs.connId}:${ds.name}`}
                  itemId={`datastore:${pbs.connId}:${ds.name}`}
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className='ri-database-2-line' style={{ opacity: 0.6, fontSize: 14 }} />
                      <span style={{ fontSize: 13 }}>{ds.name}</span>
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 0.5,
                          ml: 'auto',
                          opacity: 0.6
                        }}
                      >
                        <Box
                          sx={{
                            width: 40,
                            height: 4,
                            bgcolor: 'divider',
                            borderRadius: 1,
                            overflow: 'hidden'
                          }}
                        >
                          <Box
                            sx={{
                              width: `${ds.usagePercent}%`,
                              height: '100%',
                              bgcolor: ds.usagePercent > 90 ? 'error.main' : ds.usagePercent > 70 ? 'warning.main' : 'success.main',
                            }}
                          />
                        </Box>
                        <span style={{ fontSize: 10 }}>{ds.usagePercent}%</span>
                      </Box>
                      <span style={{ opacity: 0.5, fontSize: 11 }}>
                        ({ds.backupCount})
                      </span>
                    </Box>
                  }
                />
              ))}
            </TreeItem>
          ))}
          </SimpleTreeView>
          </Collapse>
        </>
      )}

      {/* ── Migration Section ── */}
      {viewMode === 'tree' && externalHypervisors.length > 0 && (() => {
        const hypervisorConfig: Record<string, { label: string; icon: string; svgIcon?: string; vmIcon?: string; color: string }> = {
          vmware: { label: 'VMware ESXi', icon: 'ri-cloud-line', svgIcon: '/images/esxi-logo.svg', vmIcon: '/images/esxi-vm.svg', color: '#638C1C' },
          hyperv: { label: 'Microsoft Hyper-V', icon: 'ri-microsoft-line', svgIcon: '/images/hyperv-logo.svg', color: '#00BCF2' },
          xcpng: { label: 'XCP-NG', icon: 'ri-server-line', svgIcon: '/images/xcpng-logo.svg', color: '#00ADB5' },
          nutanix: { label: 'Nutanix AHV', icon: 'ri-database-2-line', svgIcon: '/images/nutanix-logo.svg', color: '#24B47E' },
        }

        // Apply the tree-wide search to the Migrations section too: filter each
        // connection's VMs by name, then drop connections with zero matches, then
        // drop hypervisor groups with zero surviving connections. Matches the
        // behaviour of the main PVE tree (see `allVms.filter(..., search)` earlier
        // in this component). Empty search = no filtering, everything shown.
        const q = search.trim().toLowerCase()
        const vmMatchesSearch = (vm: any): boolean => {
          if (!q) return true
          const hay = `${vm.name || ''} ${vm.vmid || ''} ${vm.guest_OS || vm.guestOS || ''}`.toLowerCase()
          return hay.includes(q)
        }
        const connMatchesSearch = (conn: any): boolean => {
          if (!q) return true
          // A connection "matches" when its own name matches (show all its VMs)
          // OR any of its VMs match (show only the matching VMs).
          if (`${conn.name || ''}`.toLowerCase().includes(q)) return true
          return (conn.vms || []).some((vm: any) => vmMatchesSearch(vm))
        }
        const filteredHypervisors = q
          ? externalHypervisors.filter(connMatchesSearch).map(conn => ({
              ...conn,
              // Only narrow the VM list when the connection itself didn't match by name;
              // if the connection name matches, show all its VMs so the user can see
              // what's inside without re-typing.
              vms: `${conn.name || ''}`.toLowerCase().includes(q)
                ? (conn.vms || [])
                : (conn.vms || []).filter(vmMatchesSearch),
            }))
          : externalHypervisors

        const grouped = filteredHypervisors.reduce<Record<string, typeof filteredHypervisors>>((acc, h) => {
          if (!acc[h.type]) acc[h.type] = []
          acc[h.type].push(h)
          return acc
        }, {})

        const totalExtVms = filteredHypervisors.reduce((acc, h) => acc + (h.vms?.length || 0), 0)

        // When search is active but nothing matches, skip the whole section
        // entirely. Avoids showing an empty "MIGRATIONS (0 hosts)" header.
        if (q && filteredHypervisors.length === 0) return null

        return (
          <>
            <Box
              onClick={() => {
                toggleSection('migrate-ext')
                onSelect({ type: 'migration-root', id: 'migration-root' })
              }}
              sx={{
                display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.75,
                bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
                borderTop: '1px solid', borderBottom: '1px solid', borderColor: 'divider',
                cursor: 'pointer', '&:hover': { bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.09)' },
              }}
            >
              <i className={collapsedSections.has('migrate-ext') ? 'ri-add-line' : 'ri-subtract-line'} style={{ fontSize: 14, opacity: 0.7 }} />
              <i className="ri-swap-box-line" style={{ fontSize: 14, opacity: 0.7 }} />
              <Typography variant="body2" sx={{ fontWeight: 700 }}>MIGRATIONS</Typography>
              <Typography variant="caption" sx={{ opacity: 0.5 }}>
                ({externalHypervisors.length} hosts{totalExtVms > 0 ? `, ${totalExtVms} VMs` : ''})
              </Typography>
            </Box>
            <Collapse in={!collapsedSections.has('migrate-ext')}>
              <SimpleTreeView
                expansionTrigger="iconContainer"
            slots={{ expandIcon: () => <i className="ri-add-line" style={{ fontSize: 14, opacity: 0.5 }} />, collapseIcon: () => <i className="ri-subtract-line" style={{ fontSize: 14, opacity: 0.5 }} /> }}
                selectedItems={selectedItemId || ''}
                expandedItems={(() => {
                  // When the user is searching, auto-expand the path to every
                  // surviving match: hypervisor-type group > connection > host
                  // group (if present) so the matching VMs are visible without
                  // the user clicking through the chevrons. Empty search falls
                  // back to the user's manual expansion state from localStorage.
                  if (!q) return migrationExpandedItems
                  const auto: string[] = []
                  for (const [type, conns] of Object.entries(grouped)) {
                    auto.push(`ext-type:${type}`)
                    for (const conn of conns) {
                      auto.push(`ext:${conn.id}`)
                      for (const vm of conn.vms || []) {
                        if (vm.vcenterHost) {
                          auto.push(`exthost:${conn.id}:${vm.vcenterHost}`)
                        }
                      }
                    }
                  }
                  return [...new Set([...migrationExpandedItems, ...auto])]
                })()}
                onExpandedItemsChange={(_event, itemIds) => {
                  setMigrationExpandedItems(itemIds)
                  expandingRef.current = true
                  requestAnimationFrame(() => { expandingRef.current = false })
                }}
                onSelectedItemsChange={(_event, ids) => {
                  if (expandingRef.current) return
                  const picked = Array.isArray(ids) ? ids[0] : ids
                  if (!picked) return
                  const sel = selectionFromItemId(String(picked))
                  if (sel) onSelect(sel)
                }}
              >
              {Object.entries(grouped).map(([type, conns]) => {
                const cfg = hypervisorConfig[type] || { label: type, icon: 'ri-server-line', color: '#999' }
                const totalVms = conns.reduce((acc, c) => acc + (c.vms?.length || 0), 0)
                return (
                  <TreeItem
                    key={`ext-type:${type}`}
                    itemId={`ext-type:${type}`}
                    label={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        {cfg.svgIcon ? <img src={cfg.svgIcon} alt="" width={14} height={14} style={{ opacity: 0.8 }} /> : <i className={cfg.icon} style={{ fontSize: 14, color: cfg.color, opacity: 0.8 }} />}
                        <span style={{ fontSize: 13 }}>{cfg.label}</span>
                        <span style={{ fontSize: 11, opacity: 0.5 }}>
                          ({conns.length}{totalVms > 0 ? `, ${totalVms} VMs` : ''})
                        </span>
                      </Box>
                    }
                  >
                    {conns.map(conn => {
                      // Render a single VM row as a TreeItem. Extracted so we can
                      // reuse it both directly under the connection (non-vCenter)
                      // and nested inside per-host groups (vCenter).
                      // Visual parity with Proxmox-side VMs: the hypervisor-specific
                      // VM icon (esxi-vm.svg / ri-computer-line) carries an
                      // overlaid status pastille (bottom-right dot), matching the
                      // <StatusIcon type='vm'> style used for PVE VMs elsewhere
                      // in this tree. Green=running, orange=paused/standby, red=stopped.
                      const renderVmItem = (vm: any) => {
                        const vmDotColor =
                          vm.status === 'running' ? '#4caf50' :
                          vm.status === 'paused' || vm.status === 'suspended' ? '#ed6c02' :
                          '#f44336'
                        return (
                          <TreeItem
                            key={`extvm:${conn.id}:${vm.vmid}`}
                            itemId={`extvm:${conn.id}:${vm.vmid}`}
                            label={
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                <Box component="span" sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 14, height: 14, flexShrink: 0 }}>
                                  {cfg.vmIcon
                                    ? <img src={cfg.vmIcon} alt="" width={14} height={14} style={{ opacity: 0.7 }} />
                                    : <i className="ri-computer-line" style={{ fontSize: 14, opacity: 0.7 }} />
                                  }
                                  <Box sx={{
                                    position: 'absolute', bottom: -2, right: -3,
                                    width: 7, height: 7, borderRadius: '50%',
                                    bgcolor: vmDotColor,
                                    border: '1.5px solid', borderColor: 'background.paper',
                                    boxShadow: vm.status === 'running' ? `0 0 4px ${vmDotColor}` : 'none',
                                  }} />
                                </Box>
                                <span style={{ fontSize: 13 }}>{vm.name || vm.vmid}</span>
                              </Box>
                            }
                          />
                        )
                      }

                      // Group VMs by ESXi host when this is a vCenter connection.
                      // We detect "vCenter" by any VM carrying the `vcenterHost`
                      // metadata (set server-side by soapResolveHostInventoryPaths);
                      // standalone ESXi + Hyper-V + Nutanix + XCP-ng leave it empty
                      // and fall back to the flat layout we had before.
                      const allVms = conn.vms || []
                      const anyHostResolved = allVms.some((vm: any) => !!vm.vcenterHost)
                      let groupedByHost: [string, any[]][] = []
                      let unhostedVms: any[] = []
                      if (anyHostResolved) {
                        const map = new Map<string, any[]>()
                        for (const vm of allVms) {
                          const host = vm.vcenterHost || ''
                          if (!host) { unhostedVms.push(vm); continue }
                          if (!map.has(host)) map.set(host, [])
                          map.get(host)!.push(vm)
                        }
                        groupedByHost = [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
                      }

                      return (
                        <TreeItem
                          key={`ext:${conn.id}`}
                          itemId={`ext:${conn.id}`}
                          label={
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                              {cfg.svgIcon ? <img src={cfg.svgIcon} alt="" width={14} height={14} style={{ opacity: 0.8 }} /> : <i className={cfg.icon} style={{ fontSize: 14, color: cfg.color, opacity: 0.8 }} />}
                              <span style={{ fontSize: 13 }}>{conn.name}</span>
                              {/* Three mutually-exclusive states for the label suffix:
                                  1. vmsLoading   → spinner + "loading VMs…"
                                  2. vmsLoadError → red ✗ icon with the error as tooltip
                                  3. normal       → counter "(N hosts, M VMs)"
                                  The error branch replaces the spinner so a dead
                                  Nutanix/Hyper-V/XCP-ng host doesn't look like it's
                                  still trying — it clearly failed and the user can
                                  investigate or remove the connection. */}
                              {(conn as any).vmsLoading ? (
                                <>
                                  <CircularProgress size={10} thickness={5} sx={{ color: cfg.color, opacity: 0.7 }} />
                                  <span style={{ opacity: 0.5, fontSize: 11, fontStyle: 'italic' }}>
                                    loading VMs…
                                  </span>
                                </>
                              ) : (conn as any).vmsLoadError ? (
                                <Box
                                  component="span"
                                  sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
                                  title={`Failed to load VMs: ${(conn as any).vmsLoadError}`}
                                >
                                  <i className="ri-close-circle-fill" style={{ fontSize: 12, color: '#f44336' }} />
                                  <span style={{ opacity: 0.6, fontSize: 11, color: '#f44336' }}>
                                    unreachable
                                  </span>
                                </Box>
                              ) : (
                                <span style={{ opacity: 0.5, fontSize: 11 }}>
                                  {anyHostResolved
                                    ? `(${groupedByHost.length} host${groupedByHost.length === 1 ? '' : 's'}, ${allVms.length} VMs)`
                                    : `(${allVms.length})`}
                                </span>
                              )}
                            </Box>
                          }
                        >
                          {anyHostResolved ? (
                            <>
                              {groupedByHost.map(([host, vms]) => {
                                // All VMs under the same host share the same
                                // vcenterHostStatus (resolved from the same
                                // HostSystem MOR), so we read it from the first
                                // VM. Default to 'unknown' if the SOAP resolution
                                // didn't return a status (e.g. orphaned host).
                                const hostStatus = (vms[0] as any)?.vcenterHostStatus || 'unknown'
                                const statusColor =
                                  hostStatus === 'ok' ? '#4caf50' :
                                  hostStatus === 'warn' ? '#ff9800' :
                                  hostStatus === 'crit' ? '#f44336' :
                                  '#9e9e9e' // unknown -> grey
                                const statusTitle =
                                  hostStatus === 'ok' ? 'Connected, powered on' :
                                  hostStatus === 'warn' ? 'Not responding or standby' :
                                  hostStatus === 'crit' ? 'Disconnected or powered off' :
                                  'Status unknown'
                                return (
                                <TreeItem
                                  key={`exthost:${conn.id}:${host}`}
                                  itemId={`exthost:${conn.id}:${host}`}
                                  label={
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                      {/* Server icon with overlaid health dot, same
                                          pattern as <NodeIcon> for Proxmox hosts.
                                          Colour keyed to the host's runtime state
                                          resolved server-side from vCenter's
                                          runtime.connectionState + runtime.powerState. */}
                                      <Box
                                        component="span"
                                        title={statusTitle}
                                        sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, flexShrink: 0 }}
                                      >
                                        <i className="ri-server-line" style={{ fontSize: 16, opacity: 0.6 }} />
                                        <Box sx={{
                                          position: 'absolute', bottom: -2, right: -2,
                                          width: 8, height: 8, borderRadius: '50%',
                                          bgcolor: statusColor,
                                          border: '1.5px solid', borderColor: 'background.paper',
                                          boxShadow: hostStatus === 'ok' ? `0 0 4px ${statusColor}` : 'none',
                                        }} />
                                      </Box>
                                      <span style={{ fontSize: 13 }}>{host}</span>
                                      <span style={{ opacity: 0.5, fontSize: 11 }}>({vms.length})</span>
                                    </Box>
                                  }
                                >
                                  {vms.map(renderVmItem)}
                                </TreeItem>
                              )
                              })}
                              {unhostedVms.map(renderVmItem)}
                            </>
                          ) : (
                            allVms.map(renderVmItem)
                          )}
                        </TreeItem>
                      )
                    })}
                  </TreeItem>
                )
              })}
              </SimpleTreeView>
            </Collapse>
          </>
        )
      })()}

      </Box>
      <TreeDialogs
        contextMenu={contextMenu}
        handleCloseContextMenu={handleCloseContextMenu}
        actionBusy={actionBusy}
        handleVmAction={handleVmAction}
        unlocking={unlocking}
        vmActionConfirm={vmActionConfirm}
        setVmActionConfirm={setVmActionConfirm}
        executeVmAction={executeVmAction}
        vmActionError={vmActionError}
        setVmActionError={setVmActionError}
        cloneDialogOpen={cloneDialogOpen}
        setCloneDialogOpen={setCloneDialogOpen}
        cloneTarget={cloneTarget}
        setCloneTarget={setCloneTarget}
        handleCloneVm={handleCloneVm}
        allVms={allVms}
        templateDialogOpen={templateDialogOpen}
        setTemplateDialogOpen={setTemplateDialogOpen}
        templateTarget={templateTarget}
        setTemplateTarget={setTemplateTarget}
        convertingTemplate={convertingTemplate}
        handleConvertToTemplate={handleConvertToTemplate}
        migrateDialogOpen={migrateDialogOpen}
        setMigrateDialogOpen={setMigrateDialogOpen}
        migrateTarget={migrateTarget}
        setMigrateTarget={setMigrateTarget}
        setReloadTick={setReloadTick}
        snapshotDialogOpen={snapshotDialogOpen}
        setSnapshotDialogOpen={setSnapshotDialogOpen}
        snapshotTarget={snapshotTarget}
        setSnapshotTarget={setSnapshotTarget}
        snapshotName={snapshotName}
        setSnapshotName={setSnapshotName}
        snapshotDesc={snapshotDesc}
        setSnapshotDesc={setSnapshotDesc}
        snapshotVmstate={snapshotVmstate}
        setSnapshotVmstate={setSnapshotVmstate}
        creatingSnapshot={creatingSnapshot}
        executeSnapshot={executeSnapshot}
        backupDialogOpen={backupDialogOpen}
        setBackupDialogOpen={setBackupDialogOpen}
        backupTarget={backupTarget}
        setBackupTarget={setBackupTarget}
        backupStorages={backupStorages}
        backupStorage={backupStorage}
        setBackupStorage={setBackupStorage}
        backupMode={backupMode}
        setBackupMode={setBackupMode}
        backupCompress={backupCompress}
        setBackupCompress={setBackupCompress}
        backupLoading={backupLoading}
        executeBackupNow={executeBackupNow}
        snackbar={snackbar}
        setSnackbar={setSnackbar}
        unlockErrorDialog={unlockErrorDialog}
        setUnlockErrorDialog={setUnlockErrorDialog}
        shellDialog={shellDialog}
        setShellDialog={setShellDialog}
        tagDialog={tagDialog}
        setTagDialog={setTagDialog}
        tagDialogTags={tagDialogTags}
        setTagDialogTags={setTagDialogTags}
        clusterContextMenu={clusterContextMenu}
        setClusterContextMenu={setClusterContextMenu}
        openTagDialog={openTagDialog}
        nodeContextMenu={nodeContextMenu}
        handleCloseNodeContextMenu={handleCloseNodeContextMenu}
        handleMaintenanceClick={handleMaintenanceClick}
        handleBulkActionClick={handleBulkActionClick}
        handleOpenShell={handleOpenShell}
        onCreateVm={onCreateVm}
        onCreateLxc={onCreateLxc}
        onNodeAction={onNodeAction}
        clusters={clusters}
        maintenanceBusy={maintenanceBusy}
        maintenanceTarget={maintenanceTarget}
        setMaintenanceTarget={setMaintenanceTarget}
        maintenanceError={maintenanceError}
        maintenanceLocalVms={maintenanceLocalVms}
        maintenanceStorageLoading={maintenanceStorageLoading}
        maintenanceMigrateTarget={maintenanceMigrateTarget}
        setMaintenanceMigrateTarget={setMaintenanceMigrateTarget}
        maintenanceShutdownLocal={maintenanceShutdownLocal}
        setMaintenanceShutdownLocal={setMaintenanceShutdownLocal}
        maintenanceStep={maintenanceStep}
        setMaintenanceStep={setMaintenanceStep}
        handleMaintenanceConfirm={handleMaintenanceConfirm}
        getNodeVms={getNodeVms}
        getOtherNodes={getOtherNodes}
        bulkActionDialog={bulkActionDialog}
        setBulkActionDialog={setBulkActionDialog}
        bulkActionBusy={bulkActionBusy}
        handleBulkActionConfirm={handleBulkActionConfirm}
        handleTakeSnapshot={handleTakeSnapshot}
        handleBackupNow={handleBackupNow}
        handleOpenConsole={handleOpenConsole}
        handleUnlock={handleUnlock}
      />
    </Box>
  )
}

