'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import { SimpleTreeView, TreeItem } from '@mui/x-tree-view'
import { 
  Alert, 
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
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
const PauseIcon = (props: any) => <i className="ri-pause-fill" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const TerminalIcon = (props: any) => <i className="ri-terminal-box-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const MoveUpIcon = (props: any) => <i className="ri-upload-2-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const ContentCopyIcon = (props: any) => <i className="ri-file-copy-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const DescriptionIcon = (props: any) => <i className="ri-file-text-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />

import { MigrateVmDialog, CrossClusterMigrateParams } from '@/components/MigrateVmDialog'

/* ------------------------------------------------------------------ */
/* Status Icon Component                                              */
/* ------------------------------------------------------------------ */

function StatusIcon({ status, type, isMigrating, maintenance }: { status?: string; type: 'node' | 'vm'; isMigrating?: boolean; maintenance?: string }) {
  // Pour les nodes: online = vert, offline = croix rouge
  // Pour les VMs: running = vert, stopped/autres = gris, migrating = flèche animée
  
  // Si la VM est en cours de migration, afficher une icône spéciale
  if (type === 'vm' && isMigrating) {
    return (
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 14,
          height: 14,
          color: '#ff9800',
          animation: 'pulse 1.5s ease-in-out infinite',
          '@keyframes pulse': {
            '0%, 100%': { opacity: 1 },
            '50%': { opacity: 0.4 }
          }
        }}
      >
        <i className="ri-swap-box-line" style={{ fontSize: 14 }} />
      </Box>
    )
  }
  
  if (type === 'node') {
    if (maintenance) {
      return (
        <Box
          component="span"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 14,
            height: 14,
            color: '#ff9800',
          }}
        >
          <i className="ri-tools-fill" style={{ fontSize: 14 }} />
        </Box>
      )
    }
    if (status === 'online') {
      return (
        <Box
          component="span"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 14,
            height: 14,
          }}
        >
          <PlayArrowIcon
            sx={{
              fontSize: 14,
              color: '#4caf50',
              filter: 'drop-shadow(0 0 2px rgba(76, 175, 80, 0.5))'
            }}
          />
        </Box>
      )
    }

    // Node offline ou erreur
    return (
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 14,
          height: 14,
          color: '#f44336',
          fontSize: 14,
          fontWeight: 'bold'
        }}
      >
        ✕
      </Box>
    )
  }

  // Pour les VMs
  if (status === 'running') {
    return (
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 14,
          height: 14,
        }}
      >
        <PlayArrowIcon
          sx={{
            fontSize: 14,
            color: '#4caf50',
            filter: 'drop-shadow(0 0 2px rgba(76, 175, 80, 0.5))'
          }}
        />
      </Box>
    )
  }

  // VM stopped ou autre état
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 14,
        height: 14,
      }}
    >
      <StopIcon
        sx={{
          fontSize: 14,
          color: 'text.disabled',
          opacity: 0.5
        }}
      />
    </Box>
  )
}

export type InventorySelection =
  | { type: 'root'; id: 'root' } // Nœud racine de l'inventaire
  | { type: 'cluster'; id: string } // id = connectionId
  | { type: 'node'; id: string } // id = connectionId:node
  | { type: 'vm'; id: string } // id = connectionId:node:type:vmid
  | { type: 'storage'; id: string } // (réservé)
  | { type: 'pbs'; id: string } // id = pbsConnectionId (serveur PBS)
  | { type: 'datastore'; id: string } // id = pbsConnectionId:datastoreName
  | { type: 'pbs-datastore'; id: string } // alias for datastore

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
  onRefresh?: () => void  // callback pour refresh l'arbre
  refreshLoading?: boolean  // loading pendant le refresh
  onCollapse?: () => void  // callback pour collapse/expand le panneau
  isCollapsed?: boolean  // état collapsed du panneau
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
  nodes: {
    node: string
    status?: string
    ip?: string
    maintenance?: string
    vms: { type: string; vmid: string; name: string; status?: string; cpu?: number; mem?: number; maxmem?: number; disk?: number; maxdisk?: number; uptime?: number; pool?: string; tags?: string; template?: boolean; hastate?: string; hagroup?: string }[]
  }[]
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
} | null

type NodeContextMenu = {
  mouseX: number
  mouseY: number
  connId: string
  node: string
  maintenance?: string
} | null

// Seuils d'alerte (en pourcentage)
const CPU_WARNING_THRESHOLD = 95
const RAM_WARNING_THRESHOLD = 95

// Retourne l'icône appropriée pour une VM (template ou non)
function getVmIcon(type: string, isTemplate?: boolean, filled = true): string {
  if (isTemplate) {
    // Icône template (fichier avec copie)
    return filled ? 'ri-file-copy-fill' : 'ri-file-copy-line'
  }

  if (type === 'lxc') {
    return filled ? 'ri-instance-fill' : 'ri-instance-line'
  }

  
return filled ? 'ri-computer-fill' : 'ri-computer-line'
}

// Génère une couleur à partir d'un string (tag)
function getTagColor(tag: string): { bg: string; color: string } {
  // Liste de couleurs prédéfinies
  const colors = [
    { bg: '#e3f2fd', color: '#1565c0' }, // blue
    { bg: '#f3e5f5', color: '#7b1fa2' }, // purple
    { bg: '#e8f5e9', color: '#2e7d32' }, // green
    { bg: '#fff3e0', color: '#e65100' }, // orange
    { bg: '#fce4ec', color: '#c2185b' }, // pink
    { bg: '#e0f2f1', color: '#00695c' }, // teal
    { bg: '#fff8e1', color: '#ff8f00' }, // amber
    { bg: '#f1f8e9', color: '#558b2f' }, // light green
    { bg: '#e8eaf6', color: '#3949ab' }, // indigo
    { bg: '#efebe9', color: '#5d4037' }, // brown
  ]
  
  // Hash simple du tag pour obtenir un index
  let hash = 0

  for (let i = 0; i < tag.length; i++) {
    hash = ((hash << 5) - hash) + tag.charCodeAt(i)
    hash |= 0
  }
  
  return colors[Math.abs(hash) % colors.length]
}

// Composant Tag réutilisable
function TagChip({ tag }: { tag: string }) {
  const { bg, color } = getTagColor(tag)

  
return (
    <Chip 
      label={tag} 
      size="small" 
      sx={{ 
        height: 16, 
        fontSize: 9,
        bgcolor: bg,
        color: color,
        fontWeight: 600,
        '& .MuiChip-label': { px: 0.75 }
      }} 
    />
  )
}

// Calcule le pourcentage de RAM utilisée
function getMemPct(mem?: number, maxmem?: number): number {
  if (!mem || !maxmem || maxmem === 0) return 0
  
return (mem / maxmem) * 100
}

// Calcule le pourcentage CPU (déjà en fraction 0-1 depuis l'API)
function getCpuPct(cpu?: number): number {
  if (!cpu) return 0
  
return cpu * 100
}

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

  if (type === 'cluster' || type === 'node' || type === 'vm' || type === 'storage' || type === 'pbs' || type === 'datastore') {
    return { type: type as any, id } as InventorySelection
  }

  
return null
}

function safeJson<T>(x: any): T {
  // backend renvoie parfois {data: ...}
  return (x?.data ?? x) as T
}

export default function InventoryTree({ selected, onSelect, onRefreshRef, viewMode: controlledViewMode, onViewModeChange, onAllVmsChange, onHostsChange, onPoolsChange, onTagsChange, onPbsServersChange, favorites: propFavorites, onToggleFavorite, migratingVmIds, onRefresh, refreshLoading, onCollapse, isCollapsed }: Props) {
  const t = useTranslations()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [clusters, setClusters] = useState<TreeCluster[]>([])
  const [pbsServers, setPbsServers] = useState<TreePbsServer[]>([])
  const [reloadTick, setReloadTick] = useState(0)
  
  // Helper pour vérifier si une VM est en migration
  const isVmMigrating = useCallback((connId: string, vmid: string) => {
    if (!migratingVmIds) return false
    
return migratingVmIds.has(`${connId}:${vmid}`)
  }, [migratingVmIds])
  
  // Favoris : utiliser les props si fournies, sinon état local
  const [localFavorites, setLocalFavorites] = useState<Set<string>>(new Set())
  const favorites = propFavorites ?? localFavorites
  
  // Mode d'affichage: 'tree' (arbre), 'vms' (liste VMs), 'hosts' (par hôte), 'pools' (par pool), 'tags' (par tag), 'favorites' (favoris)
  const [internalViewMode, setInternalViewMode] = useState<ViewMode>('vms')
  
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

  // Sections collapsed (pour les modes hosts, pools, tags)
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set())

  const toggleSection = (key: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev)

      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }

      
return next
    })
  }

  // Exposer la fonction refresh au parent
  useEffect(() => {
    if (onRefreshRef) {
      onRefreshRef(() => setReloadTick(x => x + 1))
    }
  }, [onRefreshRef])

  // Menu contextuel VM
  const [contextMenu, setContextMenu] = useState<VmContextMenu>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false)
  const [cloneTarget, setCloneTarget] = useState<VmContextMenu>(null)
  const [migrateDialogOpen, setMigrateDialogOpen] = useState(false)
  const [migrateTarget, setMigrateTarget] = useState<VmContextMenu>(null)
  // Menu contextuel Node (maintenance)
  const [nodeContextMenu, setNodeContextMenu] = useState<NodeContextMenu>(null)
  const [maintenanceBusy, setMaintenanceBusy] = useState(false)

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
    template?: boolean
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
      template: !!template
    })
  }

  const handleCloseContextMenu = () => {
    setContextMenu(null)
  }

  const handleNodeContextMenu = (
    event: React.MouseEvent,
    connId: string,
    node: string,
    maintenance?: string
  ) => {
    event.preventDefault()
    event.stopPropagation()
    setNodeContextMenu({
      mouseX: event.clientX,
      mouseY: event.clientY,
      connId,
      node,
      maintenance,
    })
  }

  const handleCloseNodeContextMenu = () => {
    setNodeContextMenu(null)
  }

  const handleToggleMaintenance = async () => {
    if (!nodeContextMenu) return
    const { connId, node, maintenance } = nodeContextMenu
    const entering = !maintenance

    if (!confirm(entering ? t('inventory.confirmEnterMaintenance') : t('inventory.confirmExitMaintenance'))) {
      handleCloseNodeContextMenu()
      return
    }

    setMaintenanceBusy(true)
    try {
      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/maintenance`,
        { method: entering ? 'POST' : 'DELETE' }
      )
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        console.error('[maintenance] Error:', err?.error || res.statusText)
      }
      setReloadTick(x => x + 1)
    } catch (e: any) {
      console.error('[maintenance] Error:', e?.message)
    } finally {
      setMaintenanceBusy(false)
      handleCloseNodeContextMenu()
    }
  }

  // Exécuter une action sur la VM
  const handleVmAction = async (action: string) => {
    if (!contextMenu) return

    const { connId, node, type, vmid, name } = contextMenu

    // Confirmation pour les actions destructives
    if (['shutdown', 'stop', 'suspend'].includes(action)) {
      const ok = window.confirm(`${t('common.confirm')}: ${action.toUpperCase()} - ${name} ?`)

      if (!ok) {
        handleCloseContextMenu()
        
return
      }
    }

    setActionBusy(true)

    try {
      const url = `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/${action}`
      const res = await fetch(url, { method: 'POST' })
      
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))

        throw new Error(err?.error || `HTTP ${res.status}`)
      }

      // Rafraîchir l'arbre après l'action
      setReloadTick(x => x + 1)
    } catch (e: any) {
      alert(`${t('common.error')} (${action}): ${e?.message || e}`)
    } finally {
      setActionBusy(false)
      handleCloseContextMenu()
    }
  }

  // Ouvrir la console
  const handleOpenConsole = () => {
    if (!contextMenu) return
    const { connId, node, type, vmid } = contextMenu
    const url = `/novnc/console.html?connId=${encodeURIComponent(connId)}&type=${encodeURIComponent(type)}&node=${encodeURIComponent(node)}&vmid=${encodeURIComponent(vmid)}`

    window.open(url, `console-${vmid}`, 'width=1024,height=768,menubar=no,toolbar=no,location=no,status=no')
    handleCloseContextMenu()
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

  useEffect(() => {
    let alive = true

    async function load() {
      setLoading(true)
      setError(null)

      try {
        // Utiliser l'API agrégée pour charger tout l'arbre en une seule requête
        const res = await fetch('/api/v1/inventory')

        if (!res.ok) throw new Error(`HTTP ${res.status} sur /inventory`)
        const json = await res.json()
        
        if (json.error) {
          throw new Error(json.error)
        }

        const data = json.data
        const clusters = data?.clusters || []
        const pbsData = data?.pbsServers || []

        // Transformer les données de l'API en format TreeCluster
        const built: TreeCluster[] = clusters.map((cluster: any) => ({
          connId: cluster.id,
          name: cluster.name || cluster.id,
          isCluster: cluster.isCluster,
          cephHealth: cluster.cephHealth,
          nodes: (cluster.nodes || []).map((node: any) => ({
            node: node.node,
            status: node.status,
            ip: node.ip,
            maintenance: node.maintenance,
            vms: (node.guests || []).map((guest: any) => ({
              type: String(guest.type || 'qemu'),
              vmid: String(guest.vmid),
              name: guest.name || `${guest.type}:${guest.vmid}`,
              status: guest.status,
              cpu: guest.cpu,
              mem: guest.mem,
              maxmem: guest.maxmem,
              disk: guest.disk,
              maxdisk: guest.maxdisk,
              pool: guest.pool || null,
              tags: guest.tags || null,
              template: guest.template === 1 || guest.template === true,
              hastate: guest.hastate,
              hagroup: guest.hagroup
            }))
          }))
        }))

        // Trier: clusters d'abord, puis standalones, le tout par nom
        built.sort((a, b) => {
          // Les clusters (multi-nodes) en premier
          if (a.isCluster && !b.isCluster) return -1
          if (!a.isCluster && b.isCluster) return 1

          // Ensuite tri alphabétique par nom
          return a.name.localeCompare(b.name)
        })

        // Transformer les données PBS en format TreePbsServer
        const builtPbs: TreePbsServer[] = pbsData.map((pbs: any) => ({
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
        }))

        // Trier PBS par nom
        builtPbs.sort((a, b) => a.name.localeCompare(b.name))

        if (!alive) return
        setClusters(built)
        setPbsServers(builtPbs)
      } catch (e: any) {
        if (!alive) return
        setError(e?.message || String(e))
        setClusters([])
        setPbsServers([])
      } finally {
        if (!alive) return
        setLoading(false)
      }
    }

    load()

    
return () => {
      alive = false
    }
  }, [reloadTick])

  const selectedItemId = selected ? itemKey(selected) : undefined

  // État de recherche
  const [search, setSearch] = useState('')

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
            hagroup: vm.hagroup
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
        isCluster: vm.isCluster,
      })))
    }
  }, [filteredVms, onAllVmsChange])

  // Liste des hôtes uniques avec leurs VMs (filtrées)
  const hostsList = useMemo(() => {
    const hostsMap = new Map<string, typeof filteredVms>()
    
    filteredVms.forEach(vm => {
      const key = `${vm.connId}:${vm.node}`

      if (!hostsMap.has(key)) {
        hostsMap.set(key, [])
      }

      hostsMap.get(key)!.push(vm)
    })
    
    return Array.from(hostsMap.entries())
      .map(([key, vms]) => ({
        key,
        node: vms[0].node,
        connName: vms[0].connName,
        vms
      }))
      .sort((a, b) => a.node.localeCompare(b.node))
  }, [filteredVms])

  // Liste des pools uniques avec leurs VMs (filtrées)
  const poolsList = useMemo(() => {
    const poolsMap = new Map<string, typeof filteredVms>()
    
    filteredVms.forEach(vm => {
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
  }, [filteredVms])

  // Liste des tags uniques avec leurs VMs (filtrées)
  const tagsList = useMemo(() => {
    const tagsMap = new Map<string, typeof filteredVms>()
    
    filteredVms.forEach(vm => {
      if (vm.tags) {
        // Tags peuvent être séparés par ; ou ,
        const vmTags = vm.tags.split(/[;,]/).map(t => t.trim()).filter(Boolean)

        vmTags.forEach(tag => {
          if (!tagsMap.has(tag)) {
            tagsMap.set(tag, [])
          }

          tagsMap.get(tag)!.push(vm)
        })
      } else {
        // VM sans tag
        const noTag = `(${t('common.none')})`

        if (!tagsMap.has(noTag)) {
          tagsMap.set(noTag, [])
        }

        tagsMap.get(noTag)!.push(vm)
      }
    })
    
    return Array.from(tagsMap.entries())
      .map(([tag, vms]) => ({ tag, vms }))
      .sort((a, b) => {
        // "(None)" at the end
        if (a.tag === `(${t('common.none')})`) return 1
        if (b.tag === `(${t('common.none')})`) return -1
        
return a.tag.localeCompare(b.tag)
      })
  }, [filteredVms])

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

  // Notifier le parent quand les hosts changent
  useEffect(() => {
    onHostsChange?.(hostsList.map(h => ({
      key: h.key,
      node: h.node,
      connId: h.vms[0]?.connId || '',
      connName: h.connName,
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

  const header = useMemo(
    () => (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, px: 1, pt: 1.5, pb: 0.5 }}>
        {/* Recherche + actions */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <TextField
            size='small'
            placeholder={t('common.search')}
            value={search}
            onChange={e => setSearch(e.target.value)}
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
              endAdornment: search ? (
                <InputAdornment position='end'>
                  <IconButton size='small' onClick={() => setSearch('')} sx={{ p: 0.25 }}>
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
          <ToggleButton value="tree">
            <Tooltip title={t('navigation.inventory')}>
              <i className="ri-node-tree" style={{ fontSize: 16 }} />
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="vms">
            <Tooltip title={`${t('inventory.vms')} (${allVms.length})`}>
              <i className="ri-computer-line" style={{ fontSize: 16 }} />
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="hosts">
            <Tooltip title={`${t('inventory.nodes')} (${hostsList.length})`}>
              <i className="ri-server-line" style={{ fontSize: 16 }} />
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="pools">
            <Tooltip title={`${t('storage.pools')} (${poolsList.length})`}>
              <i className="ri-folder-line" style={{ fontSize: 16 }} />
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="tags">
            <Tooltip title={`Tags (${tagsList.length})`}>
              <i className="ri-price-tag-3-line" style={{ fontSize: 16 }} />
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="favorites">
            <Tooltip title={`(${favoritesList.length})`}>
              <i className={favoritesList.length > 0 ? "ri-star-fill" : "ri-star-line"} style={{ fontSize: 16, color: favoritesList.length > 0 ? '#ffc107' : undefined }} />
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="templates">
            <Tooltip title={`${t('navigation.templates')} (${templatesCount})`}>
              <i className="ri-file-copy-line" style={{ fontSize: 16 }} />
            </Tooltip>
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>
    ),
    [loading, search, viewMode, allVms.length, hostsList.length, poolsList.length, tagsList.length, templatesCount, favoritesList.length, onRefresh, refreshLoading, onCollapse, isCollapsed]
  )

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minHeight: 0 }}>
      <Box sx={{ flexShrink: 0 }}>
        {header}
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>

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
          {filteredVms.length === 0 ? (
            <Box sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant='body2' sx={{ opacity: 0.6 }}>
                {search.trim() ? `${t('common.noResults')} "${search}"` : t('common.noResults')}
              </Typography>
            </Box>
          ) : (
            filteredVms.map(vm => {
              const vmKey = `${vm.connId}:${vm.node}:${vm.type}:${vm.vmid}`
              const isFav = favorites.has(vmKey)
              const isMigrating = isVmMigrating(vm.connId, vm.vmid)

              
return (
              <Tooltip 
                key={vmKey}
                title={isMigrating ? t('audit.actions.migrate') + "..." : ""}
                placement="right"
              >
              <Box
                onClick={() => !isMigrating && onSelect({ type: 'vm', id: vmKey })}
                onContextMenu={(e) => !isMigrating && handleContextMenu(e, vm.connId, vm.node, vm.type, vm.vmid, vm.name, vm.status, vm.isCluster, vm.template)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 1.5,
                  py: 0.75,
                  cursor: isMigrating ? 'not-allowed' : 'pointer',
                  borderRadius: 1,
                  bgcolor: selected?.id === vmKey ? 'action.selected' : 'transparent',
                  opacity: isMigrating ? 0.5 : 1,
                  '&:hover': { bgcolor: isMigrating ? 'transparent' : 'action.hover' },
                  '&:hover .favorite-star': { opacity: isMigrating ? 0 : 1 }
                }}
              >
                {/* Étoile favori */}
                <IconButton
                  size="small"
                  className="favorite-star"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleFavorite(vm.connId, vm.node, vm.type, vm.vmid, vm.name)
                  }}
                  sx={{ 
                    p: 0.25, 
                    opacity: isFav ? 1 : 0,
                    transition: 'opacity 0.2s',
                    color: isFav ? '#ffc107' : 'text.secondary',
                    '&:hover': { color: '#ffc107' }
                  }}
                >
                  <i className={isFav ? "ri-star-fill" : "ri-star-line"} style={{ fontSize: 14 }} />
                </IconButton>
                <StatusIcon status={vm.status} type="vm" isMigrating={isVmMigrating(vm.connId, vm.vmid)} />
                <i className={getVmIcon(vm.type, vm.template)} style={{ opacity: 0.8, fontSize: 14 }} />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {vm.name}
                  </Typography>
                  {vm.template && (
                    <Chip label="Template" size="small" sx={{ height: 16, fontSize: 10, ml: 0.5 }} />
                  )}
                  {/* Icône CPU si charge élevée */}
                  {vm.status === 'running' && getCpuPct(vm.cpu) >= CPU_WARNING_THRESHOLD && (
                    <Tooltip title={`${t('common.warning')} CPU: ${getCpuPct(vm.cpu).toFixed(0)}%`}>
                      <i className="ri-cpu-line" style={{ fontSize: 14, color: '#ed6c02', flexShrink: 0 }} />
                    </Tooltip>
                  )}
                  {/* Icône RAM si consommation élevée */}
                  {vm.status === 'running' && getMemPct(vm.mem, vm.maxmem) >= RAM_WARNING_THRESHOLD && (
                    <Tooltip title={`${t('common.warning')} RAM: ${getMemPct(vm.mem, vm.maxmem).toFixed(0)}%`}>
                      <i className="ri-ram-line" style={{ fontSize: 14, color: '#ed6c02', flexShrink: 0 }} />
                    </Tooltip>
                  )}
                </Box>
              </Box>
              </Tooltip>
            )})
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
            favoritesList.map(vm => {
              const vmKey = `${vm.connId}:${vm.node}:${vm.type}:${vm.vmid}`
              const isMigrating = isVmMigrating(vm.connId, vm.vmid)

              
return (
              <Tooltip 
                key={vmKey}
                title={isMigrating ? t('audit.actions.migrate') + "..." : ""}
                placement="right"
              >
              <Box
                onClick={() => !isMigrating && onSelect({ type: 'vm', id: vmKey })}
                onContextMenu={(e) => !isMigrating && handleContextMenu(e, vm.connId, vm.node, vm.type, vm.vmid, vm.name, vm.status, vm.isCluster, vm.template)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 1.5,
                  py: 0.75,
                  cursor: isMigrating ? 'not-allowed' : 'pointer',
                  borderRadius: 1,
                  bgcolor: selected?.id === vmKey ? 'action.selected' : 'transparent',
                  opacity: isMigrating ? 0.5 : 1,
                  '&:hover': { bgcolor: isMigrating ? 'transparent' : 'action.hover' }
                }}
              >
                {/* Étoile favori (toujours visible) */}
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleFavorite(vm.connId, vm.node, vm.type, vm.vmid, vm.name)
                  }}
                  sx={{ 
                    p: 0.25, 
                    color: '#ffc107',
                    '&:hover': { color: '#ff9800' }
                  }}
                >
                  <i className="ri-star-fill" style={{ fontSize: 14 }} />
                </IconButton>
                <StatusIcon status={vm.status} type="vm" isMigrating={isMigrating} />
                <i className={getVmIcon(vm.type, vm.template)} style={{ opacity: 0.8, fontSize: 14 }} />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {vm.name}
                  </Typography>
                  {vm.template && (
                    <Chip label="Template" size="small" sx={{ height: 16, fontSize: 10, ml: 0.5 }} />
                  )}
                </Box>
              </Box>
              </Tooltip>
            )})
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
                  <i className="ri-server-fill" style={{ fontSize: 14, opacity: 0.7 }} />
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>{host.node}</Typography>
                  <Typography variant="caption" sx={{ opacity: 0.5 }}>({host.vms.length})</Typography>
                  <Typography variant="caption" sx={{ opacity: 0.4, ml: 'auto' }}>{host.connName}</Typography>
                </Box>
                {/* VMs de l'hôte */}
                {!isCollapsed && host.vms.map(vm => {
                  const vmKey = `${vm.connId}:${vm.node}:${vm.type}:${vm.vmid}`
                  const isFav = favorites.has(vmKey)
                  const isMigrating = isVmMigrating(vm.connId, vm.vmid)

                  
return (
                  <Tooltip 
                    key={vmKey}
                    title={isMigrating ? t('audit.actions.migrate') + "..." : ""}
                    placement="right"
                  >
                  <Box
                    onClick={() => !isMigrating && onSelect({ type: 'vm', id: vmKey })}
                    onContextMenu={(e) => !isMigrating && handleContextMenu(e, vm.connId, vm.node, vm.type, vm.vmid, vm.name, vm.status, vm.isCluster, vm.template)}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      px: 1.5,
                      pl: 3,
                      py: 0.5,
                      cursor: isMigrating ? 'not-allowed' : 'pointer',
                      opacity: isMigrating ? 0.5 : 1,
                      '&:hover': { bgcolor: isMigrating ? 'transparent' : 'action.hover' },
                      '&:hover .favorite-star': { opacity: isMigrating ? 0 : 1 }
                    }}
                  >
                    <IconButton
                      size="small"
                      className="favorite-star"
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleFavorite(vm.connId, vm.node, vm.type, vm.vmid, vm.name)
                      }}
                      sx={{ 
                        p: 0.25, 
                        opacity: isFav ? 1 : 0,
                        transition: 'opacity 0.2s',
                        color: isFav ? '#ffc107' : 'text.secondary',
                        '&:hover': { color: '#ffc107' }
                      }}
                    >
                      <i className={isFav ? "ri-star-fill" : "ri-star-line"} style={{ fontSize: 14 }} />
                    </IconButton>
                    <StatusIcon status={vm.status} type="vm" isMigrating={isMigrating} />
                    <i className={getVmIcon(vm.type, vm.template)} style={{ opacity: 0.8, fontSize: 14 }} />
                    <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {vm.name}
                    </Typography>
                    {vm.template && (
                      <Chip label="Tpl" size="small" sx={{ height: 16, fontSize: 10 }} />
                    )}
                    {vm.status === 'running' && getCpuPct(vm.cpu) >= CPU_WARNING_THRESHOLD && (
                      <Tooltip title={`${t('common.warning')} CPU: ${getCpuPct(vm.cpu).toFixed(0)}%`}>
                        <i className="ri-cpu-line" style={{ fontSize: 14, color: '#ed6c02' }} />
                      </Tooltip>
                    )}
                    {vm.status === 'running' && getMemPct(vm.mem, vm.maxmem) >= RAM_WARNING_THRESHOLD && (
                      <Tooltip title={`${t('common.warning')} RAM: ${getMemPct(vm.mem, vm.maxmem).toFixed(0)}%`}>
                        <i className="ri-ram-line" style={{ fontSize: 14, color: '#ed6c02' }} />
                      </Tooltip>
                    )}
                  </Box>
                  </Tooltip>
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
                  const isFav = favorites.has(vmKey)
                  const isMigrating = isVmMigrating(vm.connId, vm.vmid)

                  
return (
                  <Tooltip 
                    key={vmKey}
                    title={isMigrating ? t('audit.actions.migrate') + "..." : ""}
                    placement="right"
                  >
                  <Box
                    onClick={() => !isMigrating && onSelect({ type: 'vm', id: vmKey })}
                    onContextMenu={(e) => !isMigrating && handleContextMenu(e, vm.connId, vm.node, vm.type, vm.vmid, vm.name, vm.status, vm.isCluster, vm.template)}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      px: 1.5,
                      pl: 3,
                      py: 0.5,
                      cursor: isMigrating ? 'not-allowed' : 'pointer',
                      opacity: isMigrating ? 0.5 : 1,
                      '&:hover': { bgcolor: isMigrating ? 'transparent' : 'action.hover' },
                      '&:hover .favorite-star': { opacity: isMigrating ? 0 : 1 }
                    }}
                  >
                    <IconButton
                      size="small"
                      className="favorite-star"
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleFavorite(vm.connId, vm.node, vm.type, vm.vmid, vm.name)
                      }}
                      sx={{ 
                        p: 0.25, 
                        opacity: isFav ? 1 : 0,
                        transition: 'opacity 0.2s',
                        color: isFav ? '#ffc107' : 'text.secondary',
                        '&:hover': { color: '#ffc107' }
                      }}
                    >
                      <i className={isFav ? "ri-star-fill" : "ri-star-line"} style={{ fontSize: 14 }} />
                    </IconButton>
                    <StatusIcon status={vm.status} type="vm" isMigrating={isMigrating} />
                    <i className={getVmIcon(vm.type, vm.template)} style={{ opacity: 0.8, fontSize: 14 }} />
                    <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {vm.name}
                    </Typography>
                    {vm.template && (
                      <Chip label="Tpl" size="small" sx={{ height: 16, fontSize: 10 }} />
                    )}
                    {vm.status === 'running' && getCpuPct(vm.cpu) >= CPU_WARNING_THRESHOLD && (
                      <Tooltip title={`${t('common.warning')} CPU: ${getCpuPct(vm.cpu).toFixed(0)}%`}>
                        <i className="ri-cpu-line" style={{ fontSize: 14, color: '#ed6c02' }} />
                      </Tooltip>
                    )}
                    {vm.status === 'running' && getMemPct(vm.mem, vm.maxmem) >= RAM_WARNING_THRESHOLD && (
                      <Tooltip title={`${t('common.warning')} RAM: ${getMemPct(vm.mem, vm.maxmem).toFixed(0)}%`}>
                        <i className="ri-ram-line" style={{ fontSize: 14, color: '#ed6c02' }} />
                      </Tooltip>
                    )}
                  </Box>
                  </Tooltip>
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
            tagsList.map(({ tag, vms }) => {
              const isCollapsed = collapsedSections.has(`tag:${tag}`)


return (
              <Box key={tag}>
                {/* Header tag */}
                <Box
                  onClick={() => {
                    const willCollapse = !isCollapsed
                    toggleSection(`tag:${tag}`)
                    // Deselect VM if it belongs to this tag and we're collapsing
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
                  <i className="ri-price-tag-3-fill" style={{ fontSize: 14, opacity: 0.7 }} />
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>{tag}</Typography>
                  <Typography variant="caption" sx={{ opacity: 0.5 }}>({vms.length})</Typography>
                </Box>
                {/* VMs avec ce tag */}
                {!isCollapsed && vms.map(vm => {
                  const vmKey = `${vm.connId}:${vm.node}:${vm.type}:${vm.vmid}`
                  const isFav = favorites.has(vmKey)
                  const isMigrating = isVmMigrating(vm.connId, vm.vmid)

                  
return (
                  <Tooltip 
                    key={`${vmKey}-${tag}`}
                    title={isMigrating ? t('audit.actions.migrate') + "..." : ""}
                    placement="right"
                  >
                  <Box
                    onClick={() => !isMigrating && onSelect({ type: 'vm', id: vmKey })}
                    onContextMenu={(e) => !isMigrating && handleContextMenu(e, vm.connId, vm.node, vm.type, vm.vmid, vm.name, vm.status, vm.isCluster, vm.template)}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      px: 1.5,
                      pl: 3,
                      py: 0.5,
                      cursor: isMigrating ? 'not-allowed' : 'pointer',
                      opacity: isMigrating ? 0.5 : 1,
                      '&:hover': { bgcolor: isMigrating ? 'transparent' : 'action.hover' },
                      '&:hover .favorite-star': { opacity: isMigrating ? 0 : 1 }
                    }}
                  >
                    <IconButton
                      size="small"
                      className="favorite-star"
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleFavorite(vm.connId, vm.node, vm.type, vm.vmid, vm.name)
                      }}
                      sx={{ 
                        p: 0.25, 
                        opacity: isFav ? 1 : 0,
                        transition: 'opacity 0.2s',
                        color: isFav ? '#ffc107' : 'text.secondary',
                        '&:hover': { color: '#ffc107' }
                      }}
                    >
                      <i className={isFav ? "ri-star-fill" : "ri-star-line"} style={{ fontSize: 14 }} />
                    </IconButton>
                    <StatusIcon status={vm.status} type="vm" isMigrating={isMigrating} />
                    <i className={getVmIcon(vm.type, vm.template)} style={{ opacity: 0.8, fontSize: 14 }} />
                    <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {vm.name}
                    </Typography>
                    {vm.template && (
                      <Chip label="Tpl" size="small" sx={{ height: 16, fontSize: 10 }} />
                    )}
                    {vm.status === 'running' && getCpuPct(vm.cpu) >= CPU_WARNING_THRESHOLD && (
                      <Tooltip title={`${t('common.warning')} CPU: ${getCpuPct(vm.cpu).toFixed(0)}%`}>
                        <i className="ri-cpu-line" style={{ fontSize: 14, color: '#ed6c02' }} />
                      </Tooltip>
                    )}
                    {vm.status === 'running' && getMemPct(vm.mem, vm.maxmem) >= RAM_WARNING_THRESHOLD && (
                      <Tooltip title={`${t('common.warning')} RAM: ${getMemPct(vm.mem, vm.maxmem).toFixed(0)}%`}>
                        <i className="ri-ram-line" style={{ fontSize: 14, color: '#ed6c02' }} />
                      </Tooltip>
                    )}
                  </Box>
                  </Tooltip>
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
            filteredVms.filter(vm => vm.template).map(vm => {
              const vmKey = `${vm.connId}:${vm.node}:${vm.type}:${vm.vmid}`
              const isFav = favorites.has(vmKey)
              const isMigrating = isVmMigrating(vm.connId, vm.vmid)

              
return (
              <Tooltip 
                key={vmKey}
                title={isMigrating ? t('audit.actions.migrate') + "..." : ""}
                placement="right"
              >
              <Box
                onClick={() => !isMigrating && onSelect({ type: 'vm', id: vmKey })}
                onContextMenu={(e) => !isMigrating && handleContextMenu(e, vm.connId, vm.node, vm.type, vm.vmid, vm.name, vm.status, vm.isCluster, vm.template)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 1.5,
                  py: 0.75,
                  cursor: isMigrating ? 'not-allowed' : 'pointer',
                  borderRadius: 1,
                  bgcolor: selected?.id === vmKey ? 'action.selected' : 'transparent',
                  opacity: isMigrating ? 0.5 : 1,
                  '&:hover': { bgcolor: isMigrating ? 'transparent' : 'action.hover' },
                  '&:hover .favorite-star': { opacity: isMigrating ? 0 : 1 }
                }}
              >
                <IconButton
                  size="small"
                  className="favorite-star"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleFavorite(vm.connId, vm.node, vm.type, vm.vmid, vm.name)
                  }}
                  sx={{ 
                    p: 0.25, 
                    opacity: isFav ? 1 : 0,
                    transition: 'opacity 0.2s',
                    color: isFav ? '#ffc107' : 'text.secondary',
                    '&:hover': { color: '#ffc107' }
                  }}
                >
                  <i className={isFav ? "ri-star-fill" : "ri-star-line"} style={{ fontSize: 14 }} />
                </IconButton>
                <i className="ri-file-copy-fill" style={{ opacity: 0.8, fontSize: 14, color: '#0288d1' }} />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {vm.name}
                  </Typography>
                  <Chip label={vm.type === 'lxc' ? 'LXC' : 'VM'} size="small" sx={{ height: 16, fontSize: 10 }} />
                </Box>
              </Box>
              </Tooltip>
              )
            })
          )}
        </Box>
      ) : (

      /* Mode Arbre : vue hiérarchique */
      <SimpleTreeView
          selectedItems={selectedItemId || 'root:root'}
          defaultExpandedItems={['root:root']}
          expandedItems={search.trim() ? ['root:root', ...expandedItems] : undefined}
          onSelectedItemsChange={(_event, ids) => {
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
        {/* Nœud racine - Inventaire */}
        <TreeItem
          itemId="root:root"
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <i className='ri-stack-fill' style={{ opacity: 0.8, fontSize: 16, color: '#F29221' }} />
              <span style={{ fontSize: 14, fontWeight: 700 }}>{t('navigation.inventory')}</span>
              <span style={{ opacity: 0.5, fontSize: 12 }}>
                ({(() => {
                  // Compter les vrais clusters connectés (isCluster === true ET au moins un node online)
                  const connectedClusters = filteredClusters.filter(clu => 
                    clu.isCluster && clu.nodes.some(n => n.status === 'online')
                  )
                  // Compter le total des nodes (PVE)
                  const totalNodes = filteredClusters.reduce((acc, clu) => acc + clu.nodes.length, 0)
                  // Compter les nodes online
                  const onlineNodes = filteredClusters.reduce((acc, clu) => 
                    acc + clu.nodes.filter(n => n.status === 'online').length, 0
                  )
                  
                  return `${connectedClusters.length} ${connectedClusters.length > 1 ? 'clusters' : 'cluster'}, ${onlineNodes}/${totalNodes} PVE, ${allVms.length} VMs${pbsServers.length > 0 ? `, ${pbsServers.length} PBS` : ''}`
                })()})
              </span>
            </Box>
          }
        >
        {filteredClusters.length === 0 && search.trim() ? (
          <Box sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant='body2' sx={{ opacity: 0.6 }}>
              {t('common.noResults')} "{search}"
            </Typography>
          </Box>
        ) : null}

        {/* Séparateur Proxmox VE */}
        {filteredClusters.length > 0 && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1, py: 0.5, opacity: 0.6 }}>
            <i className="ri-server-fill" style={{ fontSize: 12, color: '#F29221' }} />
            <Typography variant="caption" fontWeight={600} sx={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Proxmox VE
            </Typography>
            <Typography variant="caption" sx={{ fontSize: 10, opacity: 0.8 }}>
              ({(() => {
                const realClusters = filteredClusters.filter(c => c.isCluster).length
                const totalNodes = filteredClusters.reduce((acc, c) => acc + c.nodes.length, 0)
                return `${realClusters} clusters, ${totalNodes} PVE, ${allVms.length} VMs`
              })()})
            </Typography>
          </Box>
        )}

        {filteredClusters.map(clu => {
          // Pour un standalone (1 seul node), on affiche directement le node sans niveau cluster
          if (!clu.isCluster && clu.nodes.length === 1) {
            const n = clu.nodes[0]

            
return (
              <TreeItem
                key={`${clu.connId}:${n.node}`}
                itemId={`node:${clu.connId}:${n.node}`}
                onContextMenu={(e) => handleNodeContextMenu(e, clu.connId, n.node, n.maintenance)}
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <StatusIcon status={n.status} type="node" maintenance={n.maintenance} />
                    <i className='ri-server-fill' style={{ opacity: 0.8, fontSize: 14, color: n.maintenance ? '#ff9800' : undefined }} />
                    <span style={{ fontSize: 14 }}>{clu.name}</span>
                    <span style={{ opacity: 0.5, fontSize: 12 }}>({n.vms.length})</span>
                    {/* Warning Ceph */}
                    {clu.cephHealth && clu.cephHealth !== 'HEALTH_OK' && (
                      <Tooltip title={`Ceph: ${clu.cephHealth === 'HEALTH_WARN' ? t('common.warning') : t('common.error')}`}>
                        <Box component="span" sx={{ display: 'flex', alignItems: 'center', ml: 0.5 }}>
                          <i
                            className={clu.cephHealth === 'HEALTH_ERR' ? 'ri-close-circle-fill' : 'ri-alert-fill'}
                            style={{
                              fontSize: 14,
                              color: clu.cephHealth === 'HEALTH_ERR' ? '#f44336' : '#ff9800'
                            }}
                          />
                        </Box>
                      </Tooltip>
                    )}
                  </Box>
                }
              >
                {n.vms.map(vm => {
                  const vmKey = `${clu.connId}:${n.node}:${vm.type}:${vm.vmid}`
                  const isFav = favorites.has(vmKey)
                  const isMigrating = isVmMigrating(clu.connId, vm.vmid)
                  
                  return (
                  <Tooltip
                    key={`${clu.connId}:${n.node}:${vm.type}:${vm.vmid}`}
                    title={isMigrating ? t('audit.actions.migrate') + "..." : ""}
                    placement="right"
                  >
                  <TreeItem
                    itemId={`vm:${clu.connId}:${n.node}:${vm.type}:${vm.vmid}`}
                    disabled={isMigrating}
                    onContextMenu={(e) => !isMigrating && handleContextMenu(e, clu.connId, n.node, vm.type, vm.vmid, vm.name, vm.status, clu.isCluster, vm.template)}
                    sx={{
                      opacity: isMigrating ? 0.5 : 1,
                      cursor: isMigrating ? 'not-allowed' : 'pointer',
                      '& > .MuiTreeItem-content': {
                        cursor: isMigrating ? 'not-allowed' : 'pointer',
                      }
                    }}
                    label={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                        {/* Étoile favori */}
                        <Box
                          component="span"
                          onClick={(e) => {
                            e.stopPropagation()
                            if (!isMigrating) toggleFavorite(clu.connId, n.node, vm.type, vm.vmid, vm.name)
                          }}
                          sx={{ 
                            cursor: isMigrating ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            color: isFav ? '#ffc107' : 'text.disabled',
                            '&:hover': { color: isMigrating ? undefined : '#ffc107' },
                          }}
                        >
                          <i className={isFav ? "ri-star-fill" : "ri-star-line"} style={{ fontSize: 14 }} />
                        </Box>
                        <StatusIcon status={vm.status} type="vm" isMigrating={isMigrating} />
                        <i className={getVmIcon(vm.type, vm.template)} style={{ opacity: 0.8, fontSize: 14 }} />
                        <Typography variant="body2" sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {vm.name}
                        </Typography>
                        {vm.template && (
                          <Chip label="Tpl" size="small" sx={{ height: 16, fontSize: 10 }} />
                        )}
                        {/* Icône CPU si charge élevée */}
                        {vm.status === 'running' && getCpuPct(vm.cpu) >= CPU_WARNING_THRESHOLD && (
                          <Tooltip title={`${t('common.warning')} CPU: ${getCpuPct(vm.cpu).toFixed(0)}%`}>
                            <i className="ri-cpu-line" style={{ fontSize: 14, color: '#ed6c02' }} />
                          </Tooltip>
                        )}
                        {/* Icône RAM si consommation élevée */}
                        {vm.status === 'running' && getMemPct(vm.mem, vm.maxmem) >= RAM_WARNING_THRESHOLD && (
                          <Tooltip title={`${t('common.warning')} RAM: ${getMemPct(vm.mem, vm.maxmem).toFixed(0)}%`}>
                            <i className="ri-ram-line" style={{ fontSize: 14, color: '#ed6c02' }} />
                          </Tooltip>
                        )}
                      </Box>
                    }
                  />
                  </Tooltip>
                )})}
              </TreeItem>
            )
          }

          // Pour un cluster (multi-nodes), on affiche le cluster puis les nodes
          return (
            <TreeItem
              key={clu.connId}
              itemId={`cluster:${clu.connId}`}
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className='ri-cloud-fill' style={{ opacity: 0.8, fontSize: 14, color: '#F29221' }} />
                  <span style={{ fontSize: 14 }}>{clu.name}</span>
                  {/* Warning Ceph */}
                  {clu.cephHealth && clu.cephHealth !== 'HEALTH_OK' && (
                    <Tooltip title={`Ceph: ${clu.cephHealth === 'HEALTH_WARN' ? t('common.warning') : t('common.error')}`}>
                      <Box component="span" sx={{ display: 'flex', alignItems: 'center' }}>
                        <i 
                          className={clu.cephHealth === 'HEALTH_ERR' ? 'ri-close-circle-fill' : 'ri-alert-fill'} 
                          style={{ 
                            fontSize: 14, 
                            color: clu.cephHealth === 'HEALTH_ERR' ? '#f44336' : '#ff9800' 
                          }} 
                        />
                      </Box>
                    </Tooltip>
                  )}
                </Box>
              }
            >
              {clu.nodes.map(n => (
                <TreeItem
                  key={`${clu.connId}:${n.node}`}
                  itemId={`node:${clu.connId}:${n.node}`}
                  onContextMenu={(e) => handleNodeContextMenu(e, clu.connId, n.node, n.maintenance)}
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <StatusIcon status={n.status} type="node" maintenance={n.maintenance} />
                      <i className='ri-server-fill' style={{ opacity: 0.8, fontSize: 14, color: n.maintenance ? '#ff9800' : undefined }} />
                      <span style={{ fontSize: 14 }}>{n.node}</span>
                      <span style={{ opacity: 0.5, fontSize: 12 }}>({n.vms.length})</span>
                    </Box>
                  }
                >
                  {n.vms.map(vm => {
                    const vmKey = `${clu.connId}:${n.node}:${vm.type}:${vm.vmid}`
                    const isFav = favorites.has(vmKey)
                    const isMigrating = isVmMigrating(clu.connId, vm.vmid)
                    
                    return (
                    <Tooltip
                      key={`${clu.connId}:${n.node}:${vm.type}:${vm.vmid}`}
                      title={isMigrating ? t('audit.actions.migrate') + "..." : ""}
                      placement="right"
                    >
                    <TreeItem
                      itemId={`vm:${clu.connId}:${n.node}:${vm.type}:${vm.vmid}`}
                      disabled={isMigrating}
                      onContextMenu={(e) => !isMigrating && handleContextMenu(e, clu.connId, n.node, vm.type, vm.vmid, vm.name, vm.status, clu.isCluster, vm.template)}
                      sx={{
                        opacity: isMigrating ? 0.5 : 1,
                        '& > .MuiTreeItem-content': {
                          cursor: isMigrating ? 'not-allowed' : 'pointer',
                        }
                      }}
                      label={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                          {/* Étoile favori */}
                          <Box
                            component="span"
                            onClick={(e) => {
                              e.stopPropagation()
                              if (!isMigrating) toggleFavorite(clu.connId, n.node, vm.type, vm.vmid, vm.name)
                            }}
                            sx={{ 
                              cursor: isMigrating ? 'not-allowed' : 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              color: isFav ? '#ffc107' : 'text.disabled',
                              '&:hover': { color: isMigrating ? undefined : '#ffc107' },
                            }}
                          >
                            <i className={isFav ? "ri-star-fill" : "ri-star-line"} style={{ fontSize: 14 }} />
                          </Box>
                          <StatusIcon status={vm.status} type="vm" isMigrating={isMigrating} />
                          <i className={getVmIcon(vm.type, vm.template)} style={{ opacity: 0.8, fontSize: 14 }} />
                          <Typography variant="body2" sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {vm.name}
                          </Typography>
                          {vm.template && (
                            <Chip label="Tpl" size="small" sx={{ height: 16, fontSize: 10 }} />
                          )}
                          {/* Icône CPU si charge élevée */}
                          {vm.status === 'running' && getCpuPct(vm.cpu) >= CPU_WARNING_THRESHOLD && (
                            <Tooltip title={`${t('common.warning')} CPU: ${getCpuPct(vm.cpu).toFixed(0)}%`}>
                              <i className="ri-cpu-line" style={{ fontSize: 14, color: '#ed6c02' }} />
                            </Tooltip>
                          )}
                          {/* Icône RAM si consommation élevée */}
                          {vm.status === 'running' && getMemPct(vm.mem, vm.maxmem) >= RAM_WARNING_THRESHOLD && (
                            <Tooltip title={`${t('common.warning')} RAM: ${getMemPct(vm.mem, vm.maxmem).toFixed(0)}%`}>
                              <i className="ri-ram-line" style={{ fontSize: 14, color: '#ed6c02' }} />
                            </Tooltip>
                          )}
                        </Box>
                      }
                    />
                    </Tooltip>
                  )})}
                </TreeItem>
              ))}
            </TreeItem>
          )
        })}

        {/* Serveurs PBS (Proxmox Backup Server) */}
        {pbsServers.length > 0 && (
          <>
            {/* Séparateur Proxmox Backup Server */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1, py: 0.5, mt: 1, opacity: 0.6 }}>
              <i className="ri-hard-drive-2-fill" style={{ fontSize: 12, color: '#2196f3' }} />
              <Typography variant="caption" fontWeight={600} sx={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Proxmox Backup Server
              </Typography>
              <Typography variant="caption" sx={{ fontSize: 10, opacity: 0.8 }}>
                ({pbsServers.length} PBS, {pbsServers.reduce((acc, p) => acc + p.stats.backupCount, 0)} backups)
              </Typography>
            </Box>
            
            {pbsServers.map(pbs => (
              <TreeItem
                key={`pbs:${pbs.connId}`}
                itemId={`pbs:${pbs.connId}`}
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <StatusIcon status={pbs.status} type="node" />
                    <i className='ri-hard-drive-2-fill' style={{ opacity: 0.8, fontSize: 14, color: '#2196f3' }} />
                    <span style={{ fontSize: 14 }}>{pbs.name}</span>
                    <span style={{ opacity: 0.5, fontSize: 12 }}>
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
          </>
        )}
        </TreeItem>
      </SimpleTreeView>
      )}

      </Box>
      {/* Menu contextuel VM */}
      <Menu
        open={contextMenu !== null}
        onClose={handleCloseContextMenu}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenu !== null
            ? { top: contextMenu.mouseY, left: contextMenu.mouseX }
            : undefined
        }
      >
        {/* Header du menu */}
        <Box sx={{ px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography variant="subtitle2" fontWeight={900}>
            {contextMenu?.name}
          </Typography>
          <Typography variant="caption" sx={{ opacity: 0.6 }}>
            {contextMenu?.template ? 'TEMPLATE' : contextMenu?.type?.toUpperCase()} • #{contextMenu?.vmid}
          </Typography>
        </Box>

        {/* Menu pour TEMPLATE */}
        {contextMenu?.template && (
          <MenuItem
            onClick={() => {
              setCloneTarget(contextMenu)
              setCloneDialogOpen(true)
              handleCloseContextMenu()
            }}
            disabled={actionBusy}
          >
            <ListItemIcon>
              <ContentCopyIcon fontSize="small" sx={{ color: 'primary.main' }} />
            </ListItemIcon>
            <ListItemText>{t('audit.actions.clone')}</ListItemText>
          </MenuItem>
        )}
        
        {/* Actions de contrôle pour VM normale */}
        {!contextMenu?.template && [
          <MenuItem
            key="start"
            onClick={() => handleVmAction('start')}
            disabled={actionBusy || contextMenu?.status === 'running'}
          >
            <ListItemIcon>
              <PlayArrowIcon fontSize="small" sx={{ color: 'success.main' }} />
            </ListItemIcon>
            <ListItemText>{t('audit.actions.start')}</ListItemText>
          </MenuItem>,

          <MenuItem 
            key="shutdown"
            onClick={() => handleVmAction('shutdown')} 
            disabled={actionBusy || contextMenu?.status !== 'running'}
          >
            <ListItemIcon>
              <PowerSettingsNewIcon fontSize="small" sx={{ color: 'warning.main' }} />
            </ListItemIcon>
            <ListItemText>{t('inventoryPage.shutdownClean')}</ListItemText>
          </MenuItem>,

          <MenuItem
            key="stop"
            onClick={() => handleVmAction('stop')}
            disabled={actionBusy || contextMenu?.status !== 'running'}
          >
            <ListItemIcon>
              <StopIcon fontSize="small" sx={{ color: 'error.main' }} />
            </ListItemIcon>
            <ListItemText>{t('audit.actions.stop')}</ListItemText>
          </MenuItem>,

          <MenuItem
            key="suspend"
            onClick={() => handleVmAction('suspend')}
            disabled={actionBusy || contextMenu?.status !== 'running'}
          >
            <ListItemIcon>
              <PauseIcon fontSize="small" sx={{ color: 'info.main' }} />
            </ListItemIcon>
            <ListItemText>{t('audit.actions.suspend')}</ListItemText>
          </MenuItem>,

          <Divider key="divider1" />,

          <MenuItem key="console" onClick={handleOpenConsole} disabled={actionBusy}>
            <ListItemIcon>
              <TerminalIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Console</ListItemText>
          </MenuItem>,

          <MenuItem key="unlock" onClick={handleUnlock} disabled={actionBusy || unlocking}>
            <ListItemIcon>
              <i className="ri-lock-unlock-line" style={{ fontSize: 20, color: '#f59e0b' }} />
            </ListItemIcon>
            <ListItemText>{t('inventory.unlock')}</ListItemText>
          </MenuItem>,

          <Divider key="divider2" />,

          contextMenu?.isCluster && (
            <MenuItem 
              key="migrate" 
              onClick={() => {
                setMigrateTarget(contextMenu)
                setMigrateDialogOpen(true)
                handleCloseContextMenu()
              }} 
              disabled={actionBusy}
            >
              <ListItemIcon>
                <MoveUpIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>{t('audit.actions.migrate')}</ListItemText>
            </MenuItem>
          ),

          <MenuItem
            key="clone"
            onClick={() => {
              setCloneTarget(contextMenu)
              setCloneDialogOpen(true)
              handleCloseContextMenu()
            }}
            disabled={actionBusy}
          >
            <ListItemIcon>
              <ContentCopyIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t('audit.actions.clone')}</ListItemText>
          </MenuItem>,

          <MenuItem key="template" onClick={() => handleNotImplemented('Convert to template')} disabled={actionBusy}>
            <ListItemIcon>
              <DescriptionIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t('templates.create')}</ListItemText>
          </MenuItem>
        ]}
      </Menu>

      {/* Menu contextuel Node (maintenance) */}
      <Menu
        open={nodeContextMenu !== null}
        onClose={handleCloseNodeContextMenu}
        anchorReference="anchorPosition"
        anchorPosition={
          nodeContextMenu !== null
            ? { top: nodeContextMenu.mouseY, left: nodeContextMenu.mouseX }
            : undefined
        }
      >
        <Box sx={{ px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography variant="subtitle2" fontWeight={900}>
            {nodeContextMenu?.node}
          </Typography>
          <Typography variant="caption" sx={{ opacity: 0.6 }}>
            NODE
          </Typography>
        </Box>
        <MenuItem
          onClick={handleToggleMaintenance}
          disabled={maintenanceBusy}
        >
          <ListItemIcon>
            <i className={nodeContextMenu?.maintenance ? 'ri-play-circle-line' : 'ri-tools-fill'} style={{ fontSize: 20, color: nodeContextMenu?.maintenance ? '#4caf50' : '#ff9800' }} />
          </ListItemIcon>
          <ListItemText>
            {nodeContextMenu?.maintenance ? t('inventory.exitMaintenance') : t('inventory.enterMaintenance')}
          </ListItemText>
        </MenuItem>
      </Menu>

      {/* Dialog de clonage */}
      <CloneVmDialog
        open={cloneDialogOpen}
        onClose={() => {
          setCloneDialogOpen(false)
          setCloneTarget(null)
        }}
        source={cloneTarget}
        allVms={allVms.map(vm => ({ ...vm, type: vm.type as 'qemu' | 'lxc', tags: vm.tags?.split(';').filter(Boolean) }))}
      />

      {/* Dialog de migration */}
      {migrateTarget && (
        <MigrateVmDialog
          open={migrateDialogOpen}
          onClose={() => {
            setMigrateDialogOpen(false)
            setMigrateTarget(null)
          }}
          connId={migrateTarget.connId}
          currentNode={migrateTarget.node}
          vmName={migrateTarget.name}
          vmid={migrateTarget.vmid}
          vmStatus={migrateTarget.status || 'unknown'}
          vmType={migrateTarget.type as 'qemu' | 'lxc'}
          onMigrate={async (targetNode, online, targetStorage, withLocalDisks) => {
            // Migration intra-cluster
            const { connId, node, type, vmid } = migrateTarget
            const res = await fetch(
              `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/migrate`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ target: targetNode, online, targetstorage: targetStorage, 'with-local-disks': withLocalDisks })
              }
            )
            if (!res.ok) {
              const err = await res.json().catch(() => ({}))
              throw new Error(err?.error || res.statusText)
            }
            setMigrateDialogOpen(false)
            setMigrateTarget(null)
            setReloadTick(x => x + 1)
          }}
          onCrossClusterMigrate={async (params: CrossClusterMigrateParams) => {
            // Migration cross-cluster
            const { connId, node, type, vmid } = migrateTarget
            const res = await fetch(
              `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/remote-migrate`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params)
              }
            )
            if (!res.ok) {
              const err = await res.json().catch(() => ({}))
              throw new Error(err?.error || res.statusText)
            }
            setMigrateDialogOpen(false)
            setMigrateTarget(null)
            setReloadTick(x => x + 1)
          }}
        />
      )}

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
    </Box>
  )
}

/* ------------------------------------------------------------------ */
/* CloneVmDialog - Dialog de clonage de VM/Template                   */
/* ------------------------------------------------------------------ */

function CloneVmDialog({
  open,
  onClose,
  source,
  allVms
}: {
  open: boolean
  onClose: () => void
  source: VmContextMenu
  allVms: AllVmItem[]
}) {
  const t = useTranslations()
  const theme = useTheme()

  const [cloning, setCloning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // Formulaire
  const [targetNode, setTargetNode] = useState('')
  const [newVmid, setNewVmid] = useState('')
  const [vmidError, setVmidError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [cloneMode, setCloneMode] = useState<'linked' | 'full'>('linked')
  const [targetStorage, setTargetStorage] = useState('')
  
  // Données dynamiques
  const [nodes, setNodes] = useState<any[]>([])
  const [storages, setStorages] = useState<any[]>([])
  const [loadingData, setLoadingData] = useState(false)

  // Reset et charger les données à l'ouverture
  useEffect(() => {
    if (open && source) {
      setError(null)
      setTargetNode(source.node)
      setNewName('')
      setCloneMode('linked')
      setTargetStorage('')
      loadData()
      calculateNextVmid()
    }
  }, [open, source])

  const loadData = async () => {
    if (!source) return
    setLoadingData(true)

    try {
      // Charger les nodes
      const nodesRes = await fetch(`/api/v1/connections/${encodeURIComponent(source.connId)}/nodes`)
      const nodesJson = await nodesRes.json()

      setNodes(nodesJson.data || [])
      
      // Charger les storages
      const storagesRes = await fetch(`/api/v1/connections/${encodeURIComponent(source.connId)}/storage`)
      const storagesJson = await storagesRes.json()

      const diskStorages = (storagesJson.data || []).filter((s: any) => 
        s.content?.includes('images') || s.content?.includes('rootdir')
      )

      setStorages(diskStorages)
    } catch (e) {
      console.error('Error loading data:', e)
    } finally {
      setLoadingData(false)
    }
  }

  const calculateNextVmid = () => {
    const usedVmids = allVms.map(vm => parseInt(String(vm.vmid), 10))
    let nextId = 100

    while (usedVmids.includes(nextId)) {
      nextId++
    }

    setNewVmid(String(nextId))
    setVmidError(null)
  }

  const handleVmidChange = (value: string) => {
    const numericValue = value.replace(/[^0-9]/g, '')

    setNewVmid(numericValue)
    
    if (!numericValue) {
      setVmidError(null)
      
return
    }
    
    const vmidNum = parseInt(numericValue, 10)

    if (vmidNum < 100) {
      setVmidError('VM ID must be >= 100')
      
return
    }
    
    const isUsed = allVms.some(vm => parseInt(String(vm.vmid), 10) === vmidNum)

    if (isUsed) {
      setVmidError(`VM ID ${vmidNum} is already in use`)
      
return
    }
    
    setVmidError(null)
  }

  const handleClone = async () => {
    if (!source || !newVmid) return
    
    setCloning(true)
    setError(null)
    
    try {
      const payload: any = {
        newid: parseInt(newVmid, 10),
        target: targetNode,
      }
      
      if (newName) payload.name = newName

      if (cloneMode === 'full') {
        payload.full = 1
        if (targetStorage) payload.storage = targetStorage
      }
      
      // POST /api/v1/connections/{connId}/guests/{type}/{node}/{vmid}/clone
      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(source.connId)}/guests/${source.type}/${encodeURIComponent(source.node)}/${encodeURIComponent(source.vmid)}/clone`,
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
      
      onClose()
    } catch (e: any) {
      setError(e?.message || 'Error cloning VM')
    } finally {
      setCloning(false)
    }
  }

  if (!source) return null

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ 
        bgcolor: theme.palette.mode === 'dark' ? 'rgba(0,150,200,0.15)' : 'primary.light',
        color: theme.palette.mode === 'dark' ? 'primary.light' : 'primary.contrastText',
        display: 'flex', 
        alignItems: 'center', 
        gap: 1,
        py: 1.5
      }}>
        <ContentCopyIcon sx={{ fontSize: 20 }} />
        {source.template ? t('inventoryPage.cloneVmTemplate') : t('inventoryPage.cloneVm')} {source.vmid}
      </DialogTitle>
      
      <DialogContent sx={{ pt: 3 }}>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        
        {loadingData ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <FormControl fullWidth size="small">
              <InputLabel>{t('inventoryPage.targetNode')}</InputLabel>
              <Select value={targetNode} onChange={(e) => setTargetNode(e.target.value)} label={t('inventoryPage.targetNode')}>
                {nodes.map(n => (
                  <MenuItem key={n.node} value={n.node}>{n.node}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth size="small">
              <InputLabel>{t('inventoryPage.mode')}</InputLabel>
              <Select value={cloneMode} onChange={(e) => setCloneMode(e.target.value as 'linked' | 'full')} label={t('inventoryPage.mode')}>
                <MenuItem value="linked">{t('inventoryPage.linkedClone')}</MenuItem>
                <MenuItem value="full">{t('inventoryPage.fullClone')}</MenuItem>
              </Select>
            </FormControl>

            <TextField
              label={t('inventoryPage.vmId')}
              value={newVmid}
              onChange={(e) => handleVmidChange(e.target.value)}
              size="small"
              error={!!vmidError}
              helperText={vmidError}
              inputProps={{ inputMode: 'numeric', pattern: '[0-9]*' }}
            />

            {cloneMode === 'full' && (
              <FormControl fullWidth size="small">
                <InputLabel>{t('inventoryPage.targetStorage')}</InputLabel>
                <Select value={targetStorage} onChange={(e) => setTargetStorage(e.target.value)} label={t('inventoryPage.targetStorage')}>
                  <MenuItem value="">{t('inventoryPage.sameAsSource')}</MenuItem>
                  {storages.map(s => (
                    <MenuItem key={s.storage} value={s.storage}>{s.storage}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            {cloneMode === 'linked' && <Box />}

            <TextField
              label={t('common.name')}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              size="small"
              placeholder={t('inventoryPage.cloneOf', { name: source.name })}
            />

            {cloneMode === 'full' && (
              <Typography variant="caption" sx={{ opacity: 0.7, gridColumn: '1 / -1' }}>
                {t('inventoryPage.formatSameAsSource')}
              </Typography>
            )}
          </Box>
        )}
      </DialogContent>
      
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={cloning}>{t('common.cancel')}</Button>
        <Button
          onClick={handleClone}
          variant="contained"
          disabled={cloning || !newVmid || !!vmidError || loadingData}
          startIcon={cloning ? <CircularProgress size={16} /> : null}
        >
          {t('audit.actions.clone')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
