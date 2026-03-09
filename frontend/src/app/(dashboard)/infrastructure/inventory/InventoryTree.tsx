'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useVirtualizer } from '@tanstack/react-virtual'

import { SimpleTreeView, TreeItem } from '@mui/x-tree-view'
import { 
  Alert,
  Box,
  Button,
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
const PauseIcon = (props: any) => <i className="ri-pause-fill" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const TerminalIcon = (props: any) => <i className="ri-terminal-box-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const MoveUpIcon = (props: any) => <i className="ri-upload-2-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const ContentCopyIcon = (props: any) => <i className="ri-file-copy-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const DescriptionIcon = (props: any) => <i className="ri-file-text-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />

import { useTaskTracker } from '@/hooks/useTaskTracker'
import { MigrateVmDialog, CrossClusterMigrateParams } from '@/components/MigrateVmDialog'
import { CloneVmDialog } from '@/components/hardware/CloneVmDialog'

/* ------------------------------------------------------------------ */
/* Status Icon Component                                              */
/* ------------------------------------------------------------------ */

function StatusIcon({ status, type, isMigrating, isPendingAction, maintenance }: { status?: string; type: 'node' | 'vm'; isMigrating?: boolean; isPendingAction?: boolean; maintenance?: string }) {
  // Pour les nodes: online = vert, offline = croix rouge
  // Pour les VMs: running = vert, stopped/autres = gris, migrating = flèche animée

  // Si la VM a une action en cours (start, stop, etc.), afficher un spinner
  if (type === 'vm' && isPendingAction) {
    return (
      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 14, height: 14 }}>
        <CircularProgress size={12} thickness={5} sx={{ color: '#ff9800' }} />
      </Box>
    )
  }

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
  | { type: 'ext'; id: string } // id = connectionId (external hypervisor host)
  | { type: 'extvm'; id: string } // id = connectionId:vmid (external hypervisor VM)

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
  pendingActionVmIds?: Set<string>  // Set de vmIds avec action en cours (format: "connId:vmid")
  onRefresh?: () => void  // callback pour refresh l'arbre
  refreshLoading?: boolean  // loading pendant le refresh
  onCollapse?: () => void  // callback pour collapse/expand le panneau
  isCollapsed?: boolean  // état collapsed du panneau
  allowedViewModes?: Set<ViewMode>  // RBAC-filtered view modes (all if not provided)
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
    vms: { type: string; vmid: string; name: string; status?: string; cpu?: number; mem?: number; maxmem?: number; disk?: number; maxdisk?: number; uptime?: number; pool?: string; tags?: string; template?: boolean; hastate?: string; hagroup?: string }[]
  }[]
}

type TreeStorageItem = {
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

type TreeClusterStorage = {
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
} | null

// Seuils d'alerte (en pourcentage)
const CPU_WARNING_THRESHOLD = 95
const RAM_WARNING_THRESHOLD = 95

// Retourne l'icône appropriée pour une VM (template ou non)
function getVmIcon(type: string, isTemplate?: boolean, filled = true): string {
  if (isTemplate) {
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

type VmItemVariant = 'flat' | 'favorite' | 'grouped' | 'template' | 'tree'

type VmItemProps = {
  vmKey: string
  connId: string
  connName: string
  node: string
  vmType: string
  vmid: string
  name: string
  status?: string
  cpu?: number
  mem?: number
  maxmem?: number
  template?: boolean
  isCluster?: boolean
  isSelected: boolean
  isMigrating: boolean
  isPendingAction: boolean
  isFavorite: boolean
  onFavoriteToggle: (e: React.MouseEvent) => void
  onClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
  variant: VmItemVariant
  t: ReturnType<typeof useTranslations>
}

const VmItem = React.memo(function VmItem(props: VmItemProps) {
  const {
    vmKey,
    vmType,
    name,
    status,
    cpu,
    mem,
    maxmem,
    template,
    isSelected,
    isMigrating,
    isPendingAction,
    isFavorite,
    onFavoriteToggle,
    onClick,
    onContextMenu,
    variant,
    t,
  } = props

  if (variant === 'tree') {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
        <Box
          component="span"
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation()
            if (!isMigrating) onFavoriteToggle(e)
          }}
          sx={{
            cursor: isMigrating ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            color: isFavorite ? '#ffc107' : 'text.disabled',
            '&:hover': { color: isMigrating ? undefined : '#ffc107' },
          }}
        >
          <i className={isFavorite ? "ri-star-fill" : "ri-star-line"} style={{ fontSize: 14 }} />
        </Box>
        <StatusIcon status={status} type="vm" isMigrating={isMigrating} isPendingAction={isPendingAction} />
        <i className={getVmIcon(vmType, template)} style={{ opacity: 0.8, fontSize: 14 }} />
        <Typography variant="body2" sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {name}
        </Typography>
        {template && (
          <Chip label={t('inventory.tpl')} size="small" sx={{ height: 16, fontSize: 10 }} />
        )}
        {status === 'running' && getCpuPct(cpu) >= CPU_WARNING_THRESHOLD && (
          <Tooltip title={`${t('common.warning')} CPU: ${getCpuPct(cpu).toFixed(0)}%`}>
            <i className="ri-cpu-line" style={{ fontSize: 14, color: '#ed6c02' }} />
          </Tooltip>
        )}
        {status === 'running' && getMemPct(mem, maxmem) >= RAM_WARNING_THRESHOLD && (
          <Tooltip title={`${t('common.warning')} RAM: ${getMemPct(mem, maxmem).toFixed(0)}%`}>
            <i className="ri-ram-line" style={{ fontSize: 14, color: '#ed6c02' }} />
          </Tooltip>
        )}
      </Box>
    )
  }

  if (variant === 'template') {
    const vmContent = (
      <Box
        data-vmkey={vmKey}
        onClick={() => !isMigrating && onClick()}
        onContextMenu={(e) => { if (!isMigrating) onContextMenu(e) }}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 0.75,
          cursor: isMigrating ? 'not-allowed' : 'pointer',
          borderRadius: 1,
          bgcolor: isSelected
            ? 'action.selected'
            : 'transparent',
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
            onFavoriteToggle(e)
          }}
          sx={{
            p: 0.25,
            opacity: isFavorite ? 1 : 0,
            transition: 'opacity 0.2s',
            color: isFavorite ? '#ffc107' : 'text.secondary',
            '&:hover': { color: '#ffc107' }
          }}
        >
          <i className={isFavorite ? "ri-star-fill" : "ri-star-line"} style={{ fontSize: 14 }} />
        </IconButton>
        <i className="ri-file-copy-fill" style={{ opacity: 0.8, fontSize: 14, color: '#0288d1' }} />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}
          </Typography>
          <Chip label={vmType === 'lxc' ? 'LXC' : 'VM'} size="small" sx={{ height: 16, fontSize: 10 }} />
        </Box>
      </Box>
    )
    return isMigrating ? <Tooltip title={t('audit.actions.migrate') + "..."} placement="right">{vmContent}</Tooltip> : vmContent
  }

  if (variant === 'favorite') {
    const vmContent = (
      <Box
        data-vmkey={vmKey}
        onClick={() => !isMigrating && onClick()}
        onContextMenu={(e) => { if (!isMigrating) onContextMenu(e) }}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 0.75,
          cursor: isMigrating ? 'not-allowed' : 'pointer',
          borderRadius: 1,
          bgcolor: isSelected
            ? 'action.selected'
            : 'transparent',
          opacity: isMigrating ? 0.5 : 1,
          '&:hover': { bgcolor: isMigrating ? 'transparent' : 'action.hover' }
        }}
      >
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation()
            onFavoriteToggle(e)
          }}
          sx={{
            p: 0.25,
            color: '#ffc107',
            '&:hover': { color: '#ff9800' }
          }}
        >
          <i className="ri-star-fill" style={{ fontSize: 14 }} />
        </IconButton>
        <StatusIcon status={status} type="vm" isMigrating={isMigrating} isPendingAction={isPendingAction} />
        <i className={getVmIcon(vmType, template)} style={{ opacity: 0.8, fontSize: 14 }} />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}
          </Typography>
          {template && (
            <Chip label={t('inventory.template')} size="small" sx={{ height: 16, fontSize: 10, ml: 0.5 }} />
          )}
        </Box>
      </Box>
    )
    return isMigrating ? <Tooltip title={t('audit.actions.migrate') + "..."} placement="right">{vmContent}</Tooltip> : vmContent
  }

  const isGrouped = variant === 'grouped'

  const vmContent = (
    <Box
      data-vmkey={vmKey}
      onClick={() => !isMigrating && onClick()}
      onContextMenu={(e) => { if (!isMigrating) onContextMenu(e) }}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1.5,
        ...(isGrouped ? { pl: 3, py: 0.5 } : { py: 0.75 }),
        cursor: isMigrating ? 'not-allowed' : 'pointer',
        ...(!isGrouped ? { borderRadius: 1 } : {}),
        bgcolor: isSelected
          ? (isGrouped ? undefined : 'action.selected')
          : 'transparent',
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
          onFavoriteToggle(e)
        }}
        sx={{
          p: 0.25,
          opacity: isFavorite ? 1 : 0,
          transition: 'opacity 0.2s',
          color: isFavorite ? '#ffc107' : 'text.secondary',
          '&:hover': { color: '#ffc107' }
        }}
      >
        <i className={isFavorite ? "ri-star-fill" : "ri-star-line"} style={{ fontSize: 14 }} />
      </IconButton>
      <StatusIcon status={status} type="vm" isMigrating={isMigrating} isPendingAction={isPendingAction} />
      <i className={getVmIcon(vmType, template)} style={{ opacity: 0.8, fontSize: 14 }} />
      {isGrouped ? (
        <>
          <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}
          </Typography>
          {template && (
            <Chip label={t('inventory.tpl')} size="small" sx={{ height: 16, fontSize: 10 }} />
          )}
          {status === 'running' && getCpuPct(cpu) >= CPU_WARNING_THRESHOLD && (
            <Tooltip title={`${t('common.warning')} CPU: ${getCpuPct(cpu).toFixed(0)}%`}>
              <i className="ri-cpu-line" style={{ fontSize: 14, color: '#ed6c02' }} />
            </Tooltip>
          )}
          {status === 'running' && getMemPct(mem, maxmem) >= RAM_WARNING_THRESHOLD && (
            <Tooltip title={`${t('common.warning')} RAM: ${getMemPct(mem, maxmem).toFixed(0)}%`}>
              <i className="ri-ram-line" style={{ fontSize: 14, color: '#ed6c02' }} />
            </Tooltip>
          )}
        </>
      ) : (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}
          </Typography>
          {template && (
            <Chip label={t('inventory.template')} size="small" sx={{ height: 16, fontSize: 10, ml: 0.5 }} />
          )}
          {status === 'running' && getCpuPct(cpu) >= CPU_WARNING_THRESHOLD && (
            <Tooltip title={`${t('common.warning')} CPU: ${getCpuPct(cpu).toFixed(0)}%`}>
              <i className="ri-cpu-line" style={{ fontSize: 14, color: '#ed6c02', flexShrink: 0 }} />
            </Tooltip>
          )}
          {status === 'running' && getMemPct(mem, maxmem) >= RAM_WARNING_THRESHOLD && (
            <Tooltip title={`${t('common.warning')} RAM: ${getMemPct(mem, maxmem).toFixed(0)}%`}>
              <i className="ri-ram-line" style={{ fontSize: 14, color: '#ed6c02', flexShrink: 0 }} />
            </Tooltip>
          )}
        </Box>
      )}
    </Box>
  )
  return isMigrating ? <Tooltip title={t('audit.actions.migrate') + "..."} placement="right">{vmContent}</Tooltip> : vmContent
}, (prev, next) =>
  prev.vmKey === next.vmKey &&
  prev.isSelected === next.isSelected &&
  prev.isMigrating === next.isMigrating &&
  prev.isPendingAction === next.isPendingAction &&
  prev.isFavorite === next.isFavorite &&
  prev.status === next.status &&
  prev.cpu === next.cpu &&
  prev.mem === next.mem &&
  prev.maxmem === next.maxmem &&
  prev.name === next.name &&
  prev.variant === next.variant &&
  prev.template === next.template
)

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

  if (type === 'cluster' || type === 'node' || type === 'vm' || type === 'storage' || type === 'pbs' || type === 'datastore' || type === 'ext' || type === 'extvm') {
    return { type: type as any, id } as InventorySelection
  }


return null
}

function safeJson<T>(x: any): T {
  // backend renvoie parfois {data: ...}
  return (x?.data ?? x) as T
}

export default function InventoryTree({ selected, onSelect, onRefreshRef, viewMode: controlledViewMode, onViewModeChange, onAllVmsChange, onHostsChange, onPoolsChange, onTagsChange, onPbsServersChange, favorites: propFavorites, onToggleFavorite, migratingVmIds, pendingActionVmIds, onRefresh, refreshLoading, onCollapse, isCollapsed, allowedViewModes }: Props) {
  const t = useTranslations()
  const theme = useTheme()
  const router = useRouter()
  const { trackTask } = useTaskTracker()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [clusters, setClusters] = useState<TreeCluster[]>([])
  const [pbsServers, setPbsServers] = useState<TreePbsServer[]>([])
  const [externalHypervisors, setExternalHypervisors] = useState<{ id: string; name: string; type: string; vms?: { vmid: string; name: string; status: string; cpu?: number; memory_size_MiB?: number; guest_OS?: string }[] }[]>([])
  const [clusterStorages, setClusterStorages] = useState<TreeClusterStorage[]>([])
  const [reloadTick, setReloadTick] = useState(0)
  
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
  const virtualScrollRef = useRef<HTMLDivElement>(null)
  const [isHydrated, setIsHydrated] = useState(false)

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

  // Hydrate from localStorage
  useEffect(() => {
    try {
      const savedExpanded = localStorage.getItem('inventoryExpandedItems')
      if (savedExpanded) setManualExpandedItems(JSON.parse(savedExpanded))

      const savedCollapsed = localStorage.getItem('inventoryCollapsedSections')
      if (savedCollapsed) setCollapsedSections(new Set(JSON.parse(savedCollapsed)))
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

  // Exposer la fonction refresh au parent
  useEffect(() => {
    if (onRefreshRef) {
      onRefreshRef(() => setReloadTick(x => x + 1))
    }
  }, [onRefreshRef])

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

  const [migrateDialogOpen, setMigrateDialogOpen] = useState(false)
  const [migrateTarget, setMigrateTarget] = useState<VmContextMenu>(null)
  // Menu contextuel Node (maintenance + bulk actions + shell)
  const [nodeContextMenu, setNodeContextMenu] = useState<NodeContextMenu>(null)
  const [maintenanceBusy, setMaintenanceBusy] = useState(false)
  const [maintenanceTarget, setMaintenanceTarget] = useState<{ connId: string; node: string; maintenance?: string } | null>(null)
  const [maintenanceError, setMaintenanceError] = useState<string | null>(null)
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

  const handleMaintenanceClick = () => {
    if (!nodeContextMenu) return
    const { connId, node, maintenance } = nodeContextMenu
    setMaintenanceTarget({ connId, node, maintenance })
    setMaintenanceError(null)
    handleCloseNodeContextMenu()
  }

  const handleMaintenanceConfirm = async () => {
    if (!maintenanceTarget) return
    const { connId, node, maintenance } = maintenanceTarget
    const entering = !maintenance

    setMaintenanceBusy(true)
    setMaintenanceError(null)
    try {
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
      setReloadTick(x => x + 1)
    } catch (e: any) {
      setMaintenanceError(e?.message || t('inventory.unknownError'))
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
          setExternalHypervisors(externalData)

          // Fetch external hypervisor VMs in parallel (VMware + XCP-ng)
          const extConns = (externalData || []).filter((h: any) => h.type === 'vmware' || h.type === 'xcpng')
          if (extConns.length > 0) {
            Promise.all(extConns.map(async (conn: any) => {
              try {
                const apiPrefix = conn.type === 'xcpng' ? 'xcpng' : 'vmware'
                const vmRes = await fetch(`/api/v1/${apiPrefix}/${encodeURIComponent(conn.id)}/vms`)
                if (vmRes.ok) {
                  const vmJson = await vmRes.json()
                  return { id: conn.id, vms: vmJson?.data?.vms || [] }
                }
              } catch { /* ignore */ }
              return { id: conn.id, vms: [] }
            })).then(vmResults => {
              if (!alive) return
              const vmMap = new Map(vmResults.map(r => [r.id, r.vms]))
              setExternalHypervisors((prev: any[]) =>
                prev.map((h: any) => (h.type === 'vmware' || h.type === 'xcpng') && vmMap.has(h.id) ? { ...h, vms: vmMap.get(h.id) } : h)
              )
            })
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
          setClusters(prev => prev.map(clu => {
            if (clu.connId !== d.connId) return clu
            let changed = false
            const nodes = clu.nodes.map(n => {
              // Handle node migration: VM moved to a different node
              const vms = n.vms.map(vm => {
                if (String(vm.vmid) !== String(d.vmid) || vm.type !== d.type) return vm
                changed = true
                return {
                  ...vm,
                  status: d.status,
                  cpu: d.cpu ?? vm.cpu,
                  mem: d.mem ?? vm.mem,
                  maxmem: d.maxmem ?? vm.maxmem,
                  disk: d.disk ?? vm.disk,
                  maxdisk: d.maxdisk ?? vm.maxdisk,
                  name: d.name ?? vm.name,
                }
              })
              return changed ? { ...n, vms } : n
            })
            return changed ? { ...clu, nodes } : clu
          }))
        } catch { /* ignore */ }
      })

      es.addEventListener('node:update', (e) => {
        if (!alive) return
        try {
          const d = JSON.parse(e.data)
          setClusters(prev => prev.map(clu => {
            if (clu.connId !== d.connId) return clu
            let changed = false
            const nodes = clu.nodes.map(n => {
              if (n.node !== d.node) return n
              changed = true
              return { ...n, status: d.status }
            })
            return changed ? { ...clu, nodes } : clu
          }))
        } catch { /* ignore */ }
      })

      es.addEventListener('vm:added', (e) => {
        if (!alive) return
        try {
          const d = JSON.parse(e.data)
          setClusters(prev => prev.map(clu => {
            if (clu.connId !== d.connId) return clu
            const nodes = clu.nodes.map(n => {
              if (n.node !== d.node) return n
              // Check if VM already exists (avoid duplicates)
              if (n.vms.some(vm => String(vm.vmid) === String(d.vmid) && vm.type === d.type)) return n
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
                }].sort((a, b) => parseInt(a.vmid, 10) - parseInt(b.vmid, 10))
              }
            })
            return { ...clu, nodes }
          }))
        } catch { /* ignore */ }
      })

      es.addEventListener('vm:removed', (e) => {
        if (!alive) return
        try {
          const d = JSON.parse(e.data)
          setClusters(prev => prev.map(clu => {
            if (clu.connId !== d.connId) return clu
            let changed = false
            const nodes = clu.nodes.map(n => {
              const before = n.vms.length
              const vms = n.vms.filter(vm => !(String(vm.vmid) === String(d.vmid) && vm.type === d.type))
              if (vms.length !== before) changed = true
              return changed ? { ...n, vms } : n
            })
            return changed ? { ...clu, nodes } : clu
          }))
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

    return () => {
      alive = false
      clearTimeout(startTimer)
      if (reconnectTimer) clearTimeout(reconnectTimer)
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
  }, [clusters])

  const collapseAll = useCallback(() => {
    programmaticExpand.current = true
    setManualExpandedItems([])
    requestAnimationFrame(() => { programmaticExpand.current = false })
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

  // Liste des hôtes uniques avec leurs VMs (filtrées, sans templates)
  const hostsList = useMemo(() => {
    const hostsMap = new Map<string, typeof displayVms>()

    displayVms.forEach(vm => {
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
  }, [displayVms])

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

  // Liste des tags uniques avec leurs VMs (filtrées, sans templates)
  const tagsList = useMemo(() => {
    const tagsMap = new Map<string, typeof displayVms>()

    displayVms.forEach(vm => {
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
  }, [displayVms])

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
          return { node, vlans, totalVlans: vlans.filter(v => v.tag !== 'untagged').length }
        })
      return { connId, connName, nodes }
    })
  }, [networkData, clusters])

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

  const flatItems = useMemo(() => {
    if (viewMode === 'vms') return displayVms
    if (viewMode === 'favorites') return favoritesList
    if (viewMode === 'templates') return filteredVms.filter(vm => vm.template)
    return null
  }, [viewMode, displayVms, favoritesList, filteredVms])

  const virtualizer = useVirtualizer({
    count: flatItems?.length ?? 0,
    getScrollElement: () => virtualScrollRef.current,
    estimateSize: () => 40,
    overscan: 10,
  })

  const isTreeExpanded = manualExpandedItems.length > 1
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
                  const keys = viewMode === 'hosts' ? hostsList.map(h => h.key)
                    : viewMode === 'pools' ? poolsList.map(p => p.pool)
                    : tagsList.map(t => t.tag)
                  collapseAllSections(keys)
                } else {
                  expandAllSections()
                }
              }}>
                <i className={isSectionsAllExpanded ? 'ri-contract-up-down-line' : 'ri-expand-up-down-line'} style={{ fontSize: 18 }} />
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
              <Tooltip title={`${t('inventory.vms')} (${displayVms.length})`}>
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
              <Tooltip title={`(${favoritesList.length})`}>
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
    [loading, searchInput, viewMode, displayVms.length, hostsList.length, poolsList.length, tagsList.length, templatesCount, favoritesList.length, onRefresh, refreshLoading, onCollapse, isCollapsed, allowedViewModes, theme.palette.mode, expandAll, collapseAll, expandAllSections, collapseAllSections, isTreeExpanded, isSectionsAllExpanded]
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
                      onContextMenu={(e) => handleContextMenu(e, vm.connId, vm.node, vm.type, vm.vmid, vm.name, vm.status, vm.isCluster, vm.template, vm.sshEnabled)}
                      variant="flat"
                      t={t}
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
                      onContextMenu={(e) => handleContextMenu(e, vm.connId, vm.node, vm.type, vm.vmid, vm.name, vm.status, vm.isCluster, vm.template, vm.sshEnabled)}
                      variant="favorite"
                      t={t}
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
                  <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" style={{ width: 14, height: 14, opacity: 0.7 }} />
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
                      onContextMenu={(e) => handleContextMenu(e, vm.connId, vm.node, vm.type, vm.vmid, vm.name, vm.status, vm.isCluster, vm.template, vm.sshEnabled)}
                      variant="grouped"
                      t={t}
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
                      onContextMenu={(e) => handleContextMenu(e, vm.connId, vm.node, vm.type, vm.vmid, vm.name, vm.status, vm.isCluster, vm.template, vm.sshEnabled)}
                      variant="grouped"
                      t={t}
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
                      onContextMenu={(e) => handleContextMenu(e, vm.connId, vm.node, vm.type, vm.vmid, vm.name, vm.status, vm.isCluster, vm.template, vm.sshEnabled)}
                      variant="grouped"
                      t={t}
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
            onClick={() => toggleSection('pve')}
            sx={{
              display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.75,
              bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
              borderTop: '1px solid', borderBottom: '1px solid', borderColor: 'divider',
              cursor: 'pointer', '&:hover': { bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.09)' },
            }}
          >
            <i className={collapsedSections.has('pve') ? 'ri-add-line' : 'ri-subtract-line'} style={{ fontSize: 14, opacity: 0.7 }} />
            <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" style={{ width: 14, height: 14 }} />
            <Typography variant="body2" sx={{ fontWeight: 700 }}>{t('inventory.headerProxmoxVe')}</Typography>
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
          selectedItems={selectedItemId || ''}
          expandedItems={search.trim() ? expandedItems : manualExpandedItems}
          onExpandedItemsChange={(_event, itemIds) => {
            if (!search.trim() && !programmaticExpand.current) setManualExpandedItems(itemIds)
          }}
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
                    <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" style={{ width: 14, height: 14, opacity: n.maintenance ? 1 : 0.8, filter: n.maintenance ? 'hue-rotate(-30deg) saturate(2)' : undefined }} />
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
                        onContextMenu={() => {}}
                        variant="tree"
                        t={t}
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
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className='ri-server-fill' style={{ opacity: 0.8, fontSize: 14 }} />
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
                      <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" style={{ width: 14, height: 14, opacity: n.maintenance ? 1 : 0.8, filter: n.maintenance ? 'hue-rotate(-30deg) saturate(2)' : undefined }} />
                      <span style={{ fontSize: 14 }}>{n.node}</span>
                      <span style={{ opacity: 0.5, fontSize: 12 }}>({n.vms.length})</span>
                    </Box>
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
                          onContextMenu={() => {}}
                          variant="tree"
                          t={t}
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
            onClick={() => toggleSection('storage')}
            sx={{
              display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.75, mt: 1,
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
            selectedItems={selectedItemId || ''}
            onSelectedItemsChange={(_event, ids) => {
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
                      <StatusIcon status={nodeStatus} type="node" />
                      <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={14} height={14} style={{ opacity: 0.8 }} />
                      <span style={{ fontSize: 14 }}>{cs.connName}</span>
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
                    <i className="ri-server-fill" style={{ opacity: 0.8, fontSize: 14 }} />
                    <span style={{ fontSize: 14 }}>{cs.connName}</span>
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
                        <StatusIcon status={n.status} type="node" />
                        <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={14} height={14} style={{ opacity: n.status === 'online' ? 0.8 : 0.3 }} />
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
            }}
            sx={{
              display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.75, mt: 1,
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
                selectedItems={selectedItemId || ''}
                onSelectedItemsChange={(_event, ids) => {
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
                      <i className="ri-server-fill" style={{ fontSize: 14, opacity: 0.8 }} />
                      <span style={{ fontSize: 14 }}>{connName}</span>
                      <span style={{ opacity: 0.4, fontSize: 11 }}>({nodes.length} nodes)</span>
                    </Box>
                  }
                >
                  {nodes.map(({ node, vlans, totalVlans }) => (
                    <TreeItem
                      key={`net-node:${cId}:${node}`}
                      itemId={`net-node:${cId}:${node}`}
                      label={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                          <StatusIcon status="online" type="node" />
                          <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={14} height={14} style={{ opacity: 0.8 }} />
                          <span style={{ fontSize: 13 }}>{node}</span>
                          <span style={{ opacity: 0.4, fontSize: 11 }}>
                            ({totalVlans} VLAN{totalVlans > 1 ? 's' : ''})
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
                                    <StatusIcon status={vm.status} type="vm" />
                                    <i className={getVmIcon(vm.type)} style={{ opacity: 0.8, fontSize: 14 }} />
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
                  ))}
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
            onClick={() => toggleSection('pbs')}
            sx={{
              display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.75, mt: 1,
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
            selectedItems={selectedItemId || ''}
            onSelectedItemsChange={(_event, ids) => {
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
                  <StatusIcon status={pbs.status} type="node" />
                  <i className='ri-hard-drive-2-fill' style={{ opacity: 0.8, fontSize: 14 }} />
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
        }

        const grouped = externalHypervisors.reduce<Record<string, typeof externalHypervisors>>((acc, h) => {
          if (!acc[h.type]) acc[h.type] = []
          acc[h.type].push(h)
          return acc
        }, {})

        const totalExtVms = externalHypervisors.reduce((acc, h) => acc + (h.vms?.length || 0), 0)

        return (
          <>
            <Box
              onClick={() => toggleSection('migrate-ext')}
              sx={{
                display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.75, mt: 1,
                bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
                borderTop: '1px solid', borderBottom: '1px solid', borderColor: 'divider',
                cursor: 'pointer', '&:hover': { bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.09)' },
              }}
            >
              <i className={collapsedSections.has('migrate-ext') ? 'ri-add-line' : 'ri-subtract-line'} style={{ fontSize: 14, opacity: 0.7 }} />
              <img src="/images/esxi-logo.svg" alt="" width={14} height={14} style={{ opacity: 0.7 }} />
              <Typography variant="body2" sx={{ fontWeight: 700 }}>MIGRATIONS</Typography>
              <Typography variant="caption" sx={{ opacity: 0.5 }}>
                ({externalHypervisors.length} hosts{totalExtVms > 0 ? `, ${totalExtVms} VMs` : ''})
              </Typography>
            </Box>
            <Collapse in={!collapsedSections.has('migrate-ext')}>
              <SimpleTreeView
                selectedItems={selectedItemId || ''}
                onSelectedItemsChange={(_event, ids) => {
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
                        <span style={{ fontSize: 14 }}>{cfg.label}</span>
                        <span style={{ fontSize: 11, opacity: 0.5 }}>
                          ({conns.length}{totalVms > 0 ? `, ${totalVms} VMs` : ''})
                        </span>
                      </Box>
                    }
                  >
                    {conns.map(conn => (
                      <TreeItem
                        key={`ext:${conn.id}`}
                        itemId={`ext:${conn.id}`}
                        label={
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                            {cfg.svgIcon ? <img src={cfg.svgIcon} alt="" width={14} height={14} style={{ opacity: 0.8 }} /> : <i className={cfg.icon} style={{ fontSize: 14, color: cfg.color, opacity: 0.8 }} />}
                            <span style={{ fontSize: 13 }}>{conn.name}</span>
                            <span style={{ opacity: 0.5, fontSize: 11 }}>({conn.vms?.length || 0})</span>
                          </Box>
                        }
                      >
                        {(conn.vms || []).map(vm => (
                          <TreeItem
                            key={`extvm:${conn.id}:${vm.vmid}`}
                            itemId={`extvm:${conn.id}:${vm.vmid}`}
                            label={
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 14, height: 14 }}>
                                  {vm.status === 'running' ? (
                                    <PlayArrowIcon sx={{ fontSize: 14, color: '#4caf50', filter: 'drop-shadow(0 0 2px rgba(76, 175, 80, 0.5))' }} />
                                  ) : (
                                    <StopIcon sx={{ fontSize: 14, color: 'text.disabled', opacity: 0.5 }} />
                                  )}
                                </Box>
                                {cfg.vmIcon ? <img src={cfg.vmIcon} alt="" width={14} height={14} style={{ opacity: 0.6 }} /> : <i className="ri-computer-line" style={{ fontSize: 14, opacity: 0.6 }} />}
                                <span style={{ fontSize: 13 }}>{vm.name || vm.vmid}</span>
                                {vm.memory_size_MiB && (
                                  <span style={{ opacity: 0.4, fontSize: 11 }}>
                                    {vm.cpu ? `${vm.cpu}c` : ''}{vm.memory_size_MiB ? `${vm.cpu ? '/' : ''}${Math.round(vm.memory_size_MiB / 1024)}G` : ''}
                                  </span>
                                )}
                              </Box>
                            }
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
        )
      })()}

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
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            {contextMenu && (
              <i
                className={getVmIcon(contextMenu.type, contextMenu.template)}
                style={{ fontSize: 16, opacity: 0.8 }}
              />
            )}
            <Typography variant="subtitle2" fontWeight={900}>
              {contextMenu?.name}
            </Typography>
          </Box>
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
          /* --- Power actions --- */
          <MenuItem
            key="start"
            onClick={() => handleVmAction('start')}
            disabled={actionBusy || contextMenu?.status === 'running'}
          >
            <ListItemIcon>
              <PlayArrowIcon fontSize="small" sx={{ color: 'success.main' }} />
            </ListItemIcon>
            <ListItemText sx={{ '& .MuiTypography-root': { color: 'success.main', fontWeight: 600 } }}>{t('audit.actions.start')}</ListItemText>
          </MenuItem>,

          <MenuItem
            key="pause"
            onClick={() => handleVmAction('suspend')}
            disabled={actionBusy || contextMenu?.status !== 'running'}
          >
            <ListItemIcon>
              <PauseIcon fontSize="small" sx={{ color: 'info.main' }} />
            </ListItemIcon>
            <ListItemText sx={{ '& .MuiTypography-root': { color: 'info.main', fontWeight: 600 } }}>{t('inventory.pause')}</ListItemText>
          </MenuItem>,

          <MenuItem
            key="hibernate"
            onClick={() => handleVmAction('hibernate')}
            disabled={actionBusy || contextMenu?.status !== 'running'}
          >
            <ListItemIcon>
              <i className="ri-zzz-line" style={{ fontSize: 20, color: 'var(--mui-palette-info-main)' }} />
            </ListItemIcon>
            <ListItemText sx={{ '& .MuiTypography-root': { color: 'info.main', fontWeight: 600 } }}>{t('inventory.hibernate')}</ListItemText>
          </MenuItem>,

          <MenuItem
            key="shutdown"
            onClick={() => handleVmAction('shutdown')}
            disabled={actionBusy || contextMenu?.status !== 'running'}
          >
            <ListItemIcon>
              <PowerSettingsNewIcon fontSize="small" sx={{ color: 'warning.main' }} />
            </ListItemIcon>
            <ListItemText sx={{ '& .MuiTypography-root': { color: 'warning.main', fontWeight: 600 } }}>{t('inventoryPage.shutdownClean')}</ListItemText>
          </MenuItem>,

          <MenuItem
            key="stop"
            onClick={() => handleVmAction('stop')}
            disabled={actionBusy || contextMenu?.status !== 'running'}
          >
            <ListItemIcon>
              <StopIcon fontSize="small" sx={{ color: 'error.main' }} />
            </ListItemIcon>
            <ListItemText sx={{ '& .MuiTypography-root': { color: 'error.main', fontWeight: 600 } }}>{t('audit.actions.stop')}</ListItemText>
          </MenuItem>,

          <MenuItem
            key="reboot"
            onClick={() => handleVmAction('reboot')}
            disabled={actionBusy || contextMenu?.status !== 'running'}
          >
            <ListItemIcon>
              <i className="ri-restart-line" style={{ fontSize: 20, color: 'var(--mui-palette-warning-main)' }} />
            </ListItemIcon>
            <ListItemText sx={{ '& .MuiTypography-root': { color: 'warning.main', fontWeight: 600 } }}>{t('inventory.reboot')}</ListItemText>
          </MenuItem>,

          <MenuItem
            key="reset"
            onClick={() => handleVmAction('reset')}
            disabled={actionBusy || contextMenu?.status !== 'running'}
          >
            <ListItemIcon>
              <i className="ri-loop-left-line" style={{ fontSize: 20, color: 'var(--mui-palette-error-main)' }} />
            </ListItemIcon>
            <ListItemText sx={{ '& .MuiTypography-root': { color: 'error.main', fontWeight: 600 } }}>{t('inventory.reset')}</ListItemText>
          </MenuItem>,

          <Divider key="divider1" />,

          /* --- Clone / Template --- */
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

          <MenuItem key="template" onClick={() => {
            setTemplateTarget(contextMenu)
            setTemplateDialogOpen(true)
            handleCloseContextMenu()
          }} disabled={actionBusy || contextMenu?.status === 'running'}>
            <ListItemIcon>
              <DescriptionIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t('templates.convertToTemplate')}</ListItemText>
          </MenuItem>,

          <Divider key="divider2" />,

          /* --- Snapshot / Backup --- */
          <MenuItem key="snapshot" onClick={handleTakeSnapshot} disabled={actionBusy}>
            <ListItemIcon>
              <i className="ri-camera-line" style={{ fontSize: 20 }} />
            </ListItemIcon>
            <ListItemText>{t('inventory.takeSnapshot')}</ListItemText>
          </MenuItem>,

          <MenuItem key="backup" onClick={handleBackupNow} disabled={actionBusy}>
            <ListItemIcon>
              <i className="ri-save-line" style={{ fontSize: 20 }} />
            </ListItemIcon>
            <ListItemText>{t('inventory.backupNow')}</ListItemText>
          </MenuItem>,

          <Divider key="divider3" />,

          /* --- Console / Migrate / Unlock --- */
          contextMenu?.isCluster ? (
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
          ) : null,

          <MenuItem key="console" onClick={handleOpenConsole} disabled={actionBusy}>
            <ListItemIcon>
              <TerminalIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t('inventory.console')}</ListItemText>
          </MenuItem>,

          contextMenu?.sshEnabled ? (
            <MenuItem key="unlock" onClick={handleUnlock} disabled={actionBusy || unlocking}>
              <ListItemIcon>
                <i className="ri-lock-unlock-line" style={{ fontSize: 20, color: '#f59e0b' }} />
              </ListItemIcon>
              <ListItemText>{t('inventory.unlock')}</ListItemText>
            </MenuItem>
          ) : null
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
        <MenuItem onClick={() => handleBulkActionClick('start-all')}>
          <ListItemIcon sx={{ minWidth: 32 }}>
            <PlayArrowIcon fontSize="small" sx={{ color: 'success.main' }} />
          </ListItemIcon>
          <ListItemText>{t('bulkActions.startAllVms')}</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleBulkActionClick('shutdown-all')}>
          <ListItemIcon sx={{ minWidth: 32 }}>
            <PowerSettingsNewIcon fontSize="small" sx={{ color: 'warning.main' }} />
          </ListItemIcon>
          <ListItemText>{t('bulkActions.shutdownAllVms')}</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleBulkActionClick('migrate-all')}>
          <ListItemIcon sx={{ minWidth: 32 }}>
            <MoveUpIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('bulkActions.migrateAllVms')}</ListItemText>
        </MenuItem>

        <Divider />

        <MenuItem
          onClick={handleMaintenanceClick}
          disabled={maintenanceBusy}
        >
          <ListItemIcon sx={{ minWidth: 32 }}>
            <i className={nodeContextMenu?.maintenance ? 'ri-play-circle-line' : 'ri-tools-fill'} style={{ fontSize: 20, color: nodeContextMenu?.maintenance ? '#4caf50' : '#ff9800' }} />
          </ListItemIcon>
          <ListItemText>
            {nodeContextMenu?.maintenance ? t('inventory.exitMaintenance') : t('inventory.enterMaintenance')}
          </ListItemText>
        </MenuItem>
      </Menu>

      {/* Dialog confirmation maintenance */}
      <Dialog
        open={maintenanceTarget !== null}
        onClose={() => setMaintenanceTarget(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{
            width: 40, height: 40, borderRadius: 2,
            bgcolor: maintenanceTarget?.maintenance ? 'rgba(76,175,80,0.12)' : 'rgba(255,152,0,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <i
              className={maintenanceTarget?.maintenance ? 'ri-play-circle-line' : 'ri-tools-fill'}
              style={{ fontSize: 22, color: maintenanceTarget?.maintenance ? '#4caf50' : '#ff9800' }}
            />
          </Box>
          {maintenanceTarget?.maintenance ? t('inventory.exitMaintenance') : t('inventory.enterMaintenance')}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            {maintenanceTarget?.maintenance
              ? t('inventory.confirmExitMaintenance')
              : t('inventory.confirmEnterMaintenance')}
          </DialogContentText>
          <Typography variant="body2" fontWeight={600} sx={{ mt: 1.5 }}>
            {t('inventory.node')}: {maintenanceTarget?.node}
          </Typography>
          <Typography variant="caption" sx={{ display: 'block', mt: 1, opacity: 0.6 }}>
            {t('inventory.maintenanceRequiresSsh')}
          </Typography>
          {maintenanceError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {maintenanceError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => setMaintenanceTarget(null)}
            color="inherit"
          >
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleMaintenanceConfirm}
            variant="contained"
            color={maintenanceTarget?.maintenance ? 'success' : 'warning'}
            disabled={maintenanceBusy}
            startIcon={maintenanceBusy ? <CircularProgress size={16} /> : undefined}
          >
            {t('common.confirm')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog confirmation bulk action */}
      <Dialog
        open={bulkActionDialog.open}
        onClose={() => setBulkActionDialog({ open: false, action: null, connId: '', node: '', targetNode: '' })}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{
            width: 40, height: 40, borderRadius: 2,
            bgcolor: bulkActionDialog.action === 'start-all' ? 'rgba(76,175,80,0.12)' : bulkActionDialog.action === 'migrate-all' ? 'rgba(33,150,243,0.12)' : 'rgba(255,152,0,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            {bulkActionDialog.action === 'start-all' && <PlayArrowIcon fontSize="small" sx={{ color: '#4caf50' }} />}
            {bulkActionDialog.action === 'shutdown-all' && <PowerSettingsNewIcon fontSize="small" sx={{ color: '#ff9800' }} />}
            {bulkActionDialog.action === 'migrate-all' && <MoveUpIcon fontSize="small" sx={{ color: '#2196f3' }} />}
          </Box>
          {bulkActionDialog.action === 'start-all' && t('bulkActions.startAllVms')}
          {bulkActionDialog.action === 'shutdown-all' && t('bulkActions.shutdownAllVms')}
          {bulkActionDialog.action === 'migrate-all' && t('bulkActions.migrateAllVms')}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            {bulkActionDialog.action === 'start-all' && t('bulkActions.confirmStartAll')}
            {bulkActionDialog.action === 'shutdown-all' && t('bulkActions.confirmShutdownAll')}
            {bulkActionDialog.action === 'migrate-all' && t('bulkActions.confirmMigrateAll')}
          </DialogContentText>
          <Typography variant="body2" fontWeight={600} sx={{ mt: 1.5 }}>
            {t('inventory.node')}: {bulkActionDialog.node}
          </Typography>
          {bulkActionDialog.action === 'start-all' && (
            <Typography variant="caption" sx={{ display: 'block', mt: 0.5, opacity: 0.6 }}>
              {getNodeVms(bulkActionDialog.connId, bulkActionDialog.node).filter(v => v.status === 'stopped').length} VMs
            </Typography>
          )}
          {bulkActionDialog.action === 'shutdown-all' && (
            <Typography variant="caption" sx={{ display: 'block', mt: 0.5, opacity: 0.6 }}>
              {getNodeVms(bulkActionDialog.connId, bulkActionDialog.node).filter(v => v.status === 'running').length} VMs
            </Typography>
          )}
          {bulkActionDialog.action === 'migrate-all' && (
            <FormControl fullWidth sx={{ mt: 2 }}>
              <InputLabel size="small">{t('bulkActions.targetNode')}</InputLabel>
              <Select
                size="small"
                value={bulkActionDialog.targetNode}
                label={t('bulkActions.targetNode')}
                onChange={(e) => setBulkActionDialog(prev => ({ ...prev, targetNode: e.target.value }))}
              >
                {getOtherNodes(bulkActionDialog.connId, bulkActionDialog.node).map(n => (
                  <MenuItem key={n} value={n}>{n}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => setBulkActionDialog({ open: false, action: null, connId: '', node: '', targetNode: '' })}
            color="inherit"
          >
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleBulkActionConfirm}
            variant="contained"
            color={bulkActionDialog.action === 'start-all' ? 'success' : bulkActionDialog.action === 'migrate-all' ? 'primary' : 'warning'}
            disabled={bulkActionBusy || (bulkActionDialog.action === 'migrate-all' && !bulkActionDialog.targetNode)}
            startIcon={bulkActionBusy ? <CircularProgress size={16} /> : undefined}
          >
            {t('common.confirm')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog de clonage */}
      {cloneTarget && (
        <CloneVmDialog
          open={cloneDialogOpen}
          onClose={() => {
            setCloneDialogOpen(false)
            setCloneTarget(null)
          }}
          onClone={handleCloneVm}
          connId={cloneTarget.connId}
          currentNode={cloneTarget.node}
          vmName={cloneTarget.name || `VM ${cloneTarget.vmid}`}
          vmid={cloneTarget.vmid}
          nextVmid={Math.max(100, ...allVms.map(v => Number(v.vmid) || 0)) + 1}
          existingVmids={allVms.map(v => Number(v.vmid) || 0).filter(id => id > 0)}
          pools={[]}
        />
      )}

      {/* Dialog de conversion en template */}
      <Dialog
        open={templateDialogOpen}
        onClose={() => !convertingTemplate && setTemplateDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <DescriptionIcon sx={{ fontSize: 24 }} />
          {t('templates.convertToTemplate')}
        </DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            {t('templates.convertWarning')}
          </Alert>
          {templateTarget && (
            <Box sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 2 }}>
              <Typography variant="body2" sx={{ opacity: 0.7 }}>VM:</Typography>
              <Typography variant="subtitle1" fontWeight={700}>
                {templateTarget.name} <Typography component="span" variant="body2" sx={{ opacity: 0.6 }}>(ID: {templateTarget.vmid})</Typography>
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => { setTemplateDialogOpen(false); setTemplateTarget(null) }} disabled={convertingTemplate}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="contained"
            onClick={handleConvertToTemplate}
            disabled={convertingTemplate}
            startIcon={convertingTemplate ? <CircularProgress size={16} /> : null}
          >
            {convertingTemplate ? t('common.loading') : t('templates.convert')}
          </Button>
        </DialogActions>
      </Dialog>

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

      {/* Dialog de confirmation action VM */}
      <Dialog
        open={vmActionConfirm !== null}
        onClose={() => setVmActionConfirm(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {vmActionConfirm?.action === 'stop' && <StopIcon sx={{ fontSize: 24, color: 'error.main' }} />}
          {vmActionConfirm?.action === 'reset' && <i className="ri-loop-left-line" style={{ fontSize: 24, color: 'var(--mui-palette-error-main)' }} />}
          {vmActionConfirm?.action === 'shutdown' && <PowerSettingsNewIcon sx={{ fontSize: 24, color: 'warning.main' }} />}
          {vmActionConfirm?.action === 'reboot' && <i className="ri-restart-line" style={{ fontSize: 24, color: 'var(--mui-palette-warning-main)' }} />}
          {vmActionConfirm?.action === 'suspend' && <PauseIcon sx={{ fontSize: 24, color: 'info.main' }} />}
          {vmActionConfirm?.action === 'hibernate' && <i className="ri-zzz-line" style={{ fontSize: 24, color: 'var(--mui-palette-info-main)' }} />}
          {t('common.confirm')}
        </DialogTitle>
        <DialogContent>
          <Alert
            severity={['stop', 'reset'].includes(vmActionConfirm?.action || '') ? 'error' : ['shutdown', 'reboot'].includes(vmActionConfirm?.action || '') ? 'warning' : 'info'}
            sx={{ mb: 2 }}
          >
            {vmActionConfirm?.action?.toUpperCase()} — <strong>{vmActionConfirm?.name}</strong>
          </Alert>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => { setVmActionConfirm(null); handleCloseContextMenu() }}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="contained"
            color={['stop', 'reset'].includes(vmActionConfirm?.action || '') ? 'error' : ['shutdown', 'reboot'].includes(vmActionConfirm?.action || '') ? 'warning' : 'info'}
            onClick={() => vmActionConfirm && executeVmAction(vmActionConfirm.action)}
            disabled={actionBusy}
            startIcon={actionBusy ? <CircularProgress size={16} /> : null}
          >
            {vmActionConfirm?.action?.toUpperCase()}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog d'erreur action VM */}
      <Dialog
        open={vmActionError !== null}
        onClose={() => setVmActionError(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-error-warning-line" style={{ fontSize: 24, color: '#ef4444' }} />
          {t('common.error')}
        </DialogTitle>
        <DialogContent>
          <Alert severity="error">{vmActionError}</Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVmActionError(null)}>{t('common.close')}</Button>
        </DialogActions>
      </Dialog>

      {/* Dialog snapshot */}
      <Dialog
        open={snapshotDialogOpen}
        onClose={() => { setSnapshotDialogOpen(false); setSnapshotTarget(null) }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-camera-line" style={{ fontSize: 24 }} />
          {t('inventory.takeSnapshot')}
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
          <TextField
            label={t('common.name')}
            value={snapshotName}
            onChange={e => setSnapshotName(e.target.value)}
            size="small"
            required
            autoFocus
          />
          <TextField
            label={t('common.description')}
            value={snapshotDesc}
            onChange={e => setSnapshotDesc(e.target.value)}
            size="small"
            multiline
            rows={2}
          />
          {snapshotTarget?.type === 'qemu' && (
          <FormControlLabel
            control={<Switch checked={snapshotVmstate} onChange={e => setSnapshotVmstate(e.target.checked)} size="small" />}
            label={t('inventory.includeRamState')}
          />
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => { setSnapshotDialogOpen(false); setSnapshotTarget(null) }}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="contained"
            onClick={executeSnapshot}
            disabled={creatingSnapshot || !snapshotName.trim()}
            startIcon={creatingSnapshot ? <CircularProgress size={16} /> : null}
          >
            {t('inventory.takeSnapshot')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog backup */}
      <Dialog
        open={backupDialogOpen}
        onClose={() => { setBackupDialogOpen(false); setBackupTarget(null) }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-save-line" style={{ fontSize: 24 }} />
          {t('inventory.backupNow')} — {backupTarget?.name}
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
          <FormControl size="small" fullWidth>
            <InputLabel>{t('inventory.backupStorage')}</InputLabel>
            <Select
              value={backupStorage}
              label={t('inventory.backupStorage')}
              onChange={e => setBackupStorage(e.target.value)}
            >
              {backupStorages.map((s: any) => (
                <MenuItem key={s.storage} value={s.storage}>{s.storage}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" fullWidth>
            <InputLabel>{t('inventory.backupMode')}</InputLabel>
            <Select
              value={backupMode}
              label={t('inventory.backupMode')}
              onChange={e => setBackupMode(e.target.value)}
            >
              <MenuItem value="snapshot">Snapshot</MenuItem>
              <MenuItem value="suspend">Suspend</MenuItem>
              <MenuItem value="stop">Stop</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" fullWidth>
            <InputLabel>{t('inventory.backupCompress')}</InputLabel>
            <Select
              value={backupCompress}
              label={t('inventory.backupCompress')}
              onChange={e => setBackupCompress(e.target.value)}
            >
              <MenuItem value="zstd">ZSTD</MenuItem>
              <MenuItem value="lzo">LZO</MenuItem>
              <MenuItem value="gzip">GZIP</MenuItem>
              <MenuItem value="0">{t('common.none')}</MenuItem>
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => { setBackupDialogOpen(false); setBackupTarget(null) }}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="contained"
            onClick={executeBackupNow}
            disabled={backupLoading || !backupStorage}
            startIcon={backupLoading ? <CircularProgress size={16} /> : null}
          >
            {t('inventory.backupNow')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar(s => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          onClose={() => setSnackbar(s => ({ ...s, open: false }))}
          severity={snackbar.severity}
          variant="filled"
        >
          {snackbar.message}
        </Alert>
      </Snackbar>

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

