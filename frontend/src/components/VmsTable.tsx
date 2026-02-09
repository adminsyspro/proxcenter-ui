'use client'

import { useMemo, useEffect, useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'

import { createPortal } from 'react-dom'
import {
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Checkbox,
  Divider,
  FormControlLabel,
  IconButton,
  LinearProgress,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
  useTheme,
  useMediaQuery
} from '@mui/material'
import { DataGrid, GridColDef } from '@mui/x-data-grid'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip as RTooltip } from 'recharts'
// XLSX is dynamically imported in handleExportExcel to reduce bundle size

// RemixIcon replacements for @mui/icons-material
const PlayArrowIcon = (props: any) => <i className="ri-play-fill" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const StopIcon = (props: any) => <i className="ri-stop-fill" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const PowerSettingsNewIcon = (props: any) => <i className="ri-shut-down-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const PauseIcon = (props: any) => <i className="ri-pause-fill" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const RestartAltIcon = (props: any) => <i className="ri-restart-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const TerminalIcon = (props: any) => <i className="ri-terminal-box-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const ContentCopyIcon = (props: any) => <i className="ri-file-copy-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const MoveUpIcon = (props: any) => <i className="ri-upload-2-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />

/* -----------------------------
  Types
------------------------------ */

type VmContextMenu = {
  mouseX: number
  mouseY: number
  vm: VmRow
} | null

/* -----------------------------
  Helpers
------------------------------ */

const pct = (v: any) => Math.max(0, Math.min(100, Number(v ?? 0)))

const bytesToGb = (b: any) => Math.round((Number(b || 0) / 1024 / 1024 / 1024) * 10) / 10

const secondsToUptime = (s: any) => {
  // Si c'est déjà une string formatée (ex: "2j 5h"), la retourner telle quelle
  if (typeof s === 'string' && s.match(/^\d+[jhdms]/)) return s
  
  const sec = Number(s || 0)

  if (!sec || isNaN(sec)) return '—'
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)

  if (d > 0) return `${d}j ${h}h`
  const m = Math.floor((sec % 3600) / 60)

  if (h > 0) return `${h}h ${m}m`
  
return `${m}m`
}

/* -----------------------------
  Tag Colors
------------------------------ */

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

/* -----------------------------
  Sub-components
------------------------------ */

const VmIcon = ({ type, template }: { type: string; template?: boolean }) => {
  let iconClass = 'ri-computer-line'

  if (template) {
    iconClass = 'ri-file-copy-line'
  } else if (type === 'lxc') {
    iconClass = 'ri-instance-line'
  }

  
return (
    <i 
      className={iconClass} 
      style={{ fontSize: 14, opacity: 0.8 }} 
    />
  )
}

const StatusChip = ({ status, compact = false }: { status: string; compact?: boolean }) => {
  const s = status?.toLowerCase()
  const sx = { height: compact ? 18 : 20, fontSize: compact ? '0.6rem' : '0.65rem' }

  if (s === 'running') return <Chip size='small' color='success' label={compact ? 'Run' : 'Running'} sx={sx} />
  if (s === 'stopped') return <Chip size='small' color='default' label={compact ? 'Stop' : 'Stopped'} sx={sx} />
  if (s === 'paused') return <Chip size='small' color='warning' label={compact ? 'Pause' : 'Paused'} sx={sx} />
  
return <Chip size='small' color='default' label={status || '—'} sx={sx} />
}

const MetricBar = ({ value }: { value: number }) => (
  <Box sx={{ width: '100%' }}>
    <Stack direction='row' sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 0.25 }}>
      <Typography variant='caption' sx={{ opacity: 0.75, fontSize: '0.7rem' }}>
        {Math.round(value)}%
      </Typography>
    </Stack>
    <LinearProgress 
      variant='determinate' 
      value={pct(value)} 
      sx={{ height: 4, borderRadius: 2 }}
    />
  </Box>
)

const TagsCell = ({ tags }: { tags: string[] }) => {
  // Filtrer les tags vides ou null
  const validTags = (tags || []).filter(tag => tag && tag.trim().length > 0)
  
  if (validTags.length === 0) return <Typography variant='caption' sx={{ opacity: 0.5 }}>—</Typography>
  
  // Afficher seulement le premier tag, puis +N pour le reste
  const displayTag = validTags[0]
  const remaining = validTags.length - 1

  return (
    <Box 
      sx={{ 
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 0.5,
        overflow: 'hidden',
      }}
    >
      <Chip
        label={displayTag}
        size='small'
        sx={{
          height: 18,
          fontSize: '0.65rem',
          bgcolor: tagColor(displayTag),
          color: 'white',
          borderRadius: 0.5,
          minWidth: 0,
          maxWidth: 80,
          '& .MuiChip-label': { 
            px: 0.75,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }
        }}
      />
      {remaining > 0 && (
        <Tooltip title={validTags.slice(1).join(', ')}>
          <Typography 
            variant='caption' 
            sx={{ 
              fontSize: '0.65rem', 
              opacity: 0.7,
              flexShrink: 0,
              whiteSpace: 'nowrap',
            }}
          >
            +{remaining}
          </Typography>
        </Tooltip>
      )}
    </Box>
  )
}

/* -----------------------------
  Trend Tooltip Component
------------------------------ */

function TrendTooltip({ active, payload, label }: any) {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY })
    }

    window.addEventListener('mousemove', handleMouseMove)
    
return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  if (!active || !payload || payload.length === 0) return null
  if (typeof window === 'undefined') return null
  
  const cpu = payload.find((p: any) => p.dataKey === 'cpu')?.value
  const ram = payload.find((p: any) => p.dataKey === 'ram')?.value

  const cpuColor = '#e57000'
  const ramColor = '#b35500'

  const tooltipContent = (
    <div
      style={{
        position: 'fixed',
        left: mousePos.x + 15,
        top: mousePos.y - 70,
        background: '#1a1a2e',
        border: '1px solid #444',
        color: 'white',
        padding: '8px 12px',
        borderRadius: 6,
        fontSize: 11,
        lineHeight: 1.5,
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        zIndex: 99999,
        pointerEvents: 'none',
        whiteSpace: 'nowrap'
      }}
    >
      <div style={{ opacity: 0.7, marginBottom: 4, fontWeight: 600, borderBottom: '1px solid #444', paddingBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        <span style={{ width: 10, height: 3, borderRadius: 2, backgroundColor: cpuColor, display: 'inline-block' }}></span>
        <span>CPU: <b>{typeof cpu === 'number' ? cpu.toFixed(1) : '—'}%</b></span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 10, height: 3, borderRadius: 2, backgroundColor: ramColor, display: 'inline-block' }}></span>
        <span>RAM: <b>{typeof ram === 'number' ? ram.toFixed(0) : '—'}%</b></span>
      </div>
    </div>
  )

  return createPortal(tooltipContent, document.body)
}

/* -----------------------------
  Types
------------------------------ */

export type TrendPoint = {
  t: string
  cpu: number
  ram: number
}

export type OsInfo = {
  type: 'linux' | 'windows' | 'other'
  name: string | null
  version: string | null
  kernel: string | null
}

export type VmRow = {
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
  disk?: number
  maxdisk?: number
  uptime?: number | string | null
  ip?: string | null
  snapshots?: number
  tags?: string[]
  template?: boolean
  trend?: TrendPoint[]
  hastate?: string
  hagroup?: string
  isCluster?: boolean
  osInfo?: OsInfo | null
}

type VmsTableProps = {
  vms: VmRow[]
  loading?: boolean
  onVmClick?: (vm: VmRow) => void
  onVmAction?: (vm: VmRow, action: 'start' | 'shutdown' | 'stop' | 'pause' | 'suspend' | 'reboot' | 'console' | 'details' | 'clone') => void
  onMigrate?: (vm: VmRow) => void  // Callback pour ouvrir le dialog de migration
  onContextMenu?: (event: React.MouseEvent, vm: VmRow) => void  // Menu contextuel
  onNodeClick?: (connId: string, node: string) => void  // Callback pour clic sur le node
  compact?: boolean
  expanded?: boolean
  maxHeight?: number | string
  showNode?: boolean
  showTrends?: boolean
  showActions?: boolean
  showIpSnap?: boolean  // Afficher les colonnes IP et Snapshots
  ipSnapLoading?: boolean  // Loading en cours pour IP/Snap
  onLoadIpSnap?: () => void  // Callback pour charger IP/Snap
  onLoadTrends?: (vm: VmRow) => Promise<TrendPoint[]>
  onLoadTrendsBatch?: (vms: VmRow[]) => Promise<Record<string, TrendPoint[]>>  // Batch loading
  autoPageSize?: boolean  // Calculer automatiquement le nombre de lignes
  showDensityToggle?: boolean  // Afficher le bouton compact/normal
  highlightedId?: string | null  // ID de la VM à mettre en surbrillance
  // Favoris
  favorites?: Set<string>  // IDs des VMs favorites
  onToggleFavorite?: (vm: VmRow) => void  // Callback pour ajouter/retirer des favoris
  // Migration
  migratingVmIds?: Set<string>  // IDs des VMs en cours de migration (format: "connId:vmid")
}

/* -----------------------------
  Component
------------------------------ */

export default function VmsTable({
  vms,
  loading = false,
  onVmClick,
  onVmAction,
  onMigrate,
  onContextMenu,
  onNodeClick,
  compact: compactProp = true,
  expanded = false,
  maxHeight = 400,
  showNode = false,
  showTrends = false,
  showActions = false,
  showIpSnap = false,
  ipSnapLoading = false,
  onLoadIpSnap,
  onLoadTrends,
  onLoadTrendsBatch,
  autoPageSize = false,
  showDensityToggle = false,
  highlightedId = null,
  favorites,
  onToggleFavorite,
  migratingVmIds
}: VmsTableProps) {
  const theme = useTheme()
  const t = useTranslations()
  const primaryColor = theme.palette.primary.main
  
  // Helper pour vérifier si une VM est en migration
  const isVmMigrating = useCallback((connId: string, vmid: string | number) => {
    if (!migratingVmIds) return false
    
return migratingVmIds.has(`${connId}:${vmid}`)
  }, [migratingVmIds])
  
  // Responsive breakpoints - noSsr: true pour éviter les problèmes de hydratation
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true })  // < 600px
  const isTablet = useMediaQuery(theme.breakpoints.down('md'), { noSsr: true })  // < 900px
  const isSmallDesktop = useMediaQuery(theme.breakpoints.down('lg'), { noSsr: true })  // < 1200px
  const isLargeDesktop = useMediaQuery(theme.breakpoints.up('xl'), { noSsr: true })  // >= 1536px
  
  // État local pour la densité (compact par défaut)
  const [isCompact, setIsCompact] = useState(compactProp)
  
  // État pour le menu de sélection des colonnes
  const [columnsMenuAnchor, setColumnsMenuAnchor] = useState<null | HTMLElement>(null)

  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>({
    vmid: false,  // ID masqué par défaut
    favorite: true,
    name: true,
    type: true,
    status: true,
    node: true,
    ha: true,
    cpu: true,
    ram: true,
    maxmem: true,
    disk: true,
    tags: true,
    ip: true,
    snapshots: true,
    osInfo: true,
    uptime: true,
    trend: true,
    actions: true,
  })
  
  // État pour le menu contextuel (clic droit)
  const [contextMenu, setContextMenu] = useState<VmContextMenu>(null)
  
  // Handlers pour le menu contextuel
  const handleContextMenu = useCallback((event: React.MouseEvent, vm: VmRow) => {
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({
      mouseX: event.clientX,
      mouseY: event.clientY,
      vm
    })
  }, [])
  
  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])
  
  const handleContextAction = useCallback((action: 'start' | 'shutdown' | 'stop' | 'pause' | 'suspend' | 'reboot' | 'console' | 'details' | 'clone') => {
    if (!contextMenu || !onVmAction) return
    onVmAction(contextMenu.vm, action)
    handleCloseContextMenu()
  }, [contextMenu, onVmAction, handleCloseContextMenu])
  
  const handleContextMigrate = useCallback(() => {
    if (!contextMenu || !onMigrate) return
    onMigrate(contextMenu.vm)
    handleCloseContextMenu()
  }, [contextMenu, onMigrate, handleCloseContextMenu])
  
  // Calculer le pageSize selon la hauteur - remplir l'écran
  const calculatedPageSize = useMemo(() => {
    // Estimer la hauteur d'une ligne
    const rowHeight = isCompact ? 36 : 52
    const headerHeight = 56
    const footerHeight = 56
    const toggleHeight = showDensityToggle ? 44 : 0
    
    // Hauteur disponible estimée (viewport - éléments fixes)
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 900
    const availableHeight = viewportHeight - 180 - headerHeight - footerHeight - toggleHeight
    
    const rows = Math.floor(availableHeight / rowHeight)

    
return Math.max(10, Math.min(rows, 50))
  }, [isCompact, showDensityToggle])
  
  // État local pour les trends
  const [trendsData, setTrendsData] = useState<Record<string, TrendPoint[]>>({})
  const [trendsLoading, setTrendsLoading] = useState<Record<string, boolean>>({})
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: calculatedPageSize })
  
  // Calculer les VMs visibles sur la page actuelle
  const visibleVms = useMemo(() => {
    const start = paginationModel.page * paginationModel.pageSize
    const end = start + paginationModel.pageSize

    
return vms.slice(start, end)
  }, [vms, paginationModel.page, paginationModel.pageSize])
  
  // Charger les trends uniquement pour les VMs visibles et running
  useEffect(() => {
    if (!showTrends) return
    if (!onLoadTrendsBatch && !onLoadTrends) return
    
    // VMs running visibles qui n'ont pas encore de données
    const vmsToLoad = visibleVms.filter(
      vm => vm.status === 'running' && !trendsData[vm.id] && !trendsLoading[vm.id]
    )
    
    if (vmsToLoad.length === 0) return
    
    // Marquer SEULEMENT les VMs qu'on va charger comme loading
    const loadingState: Record<string, boolean> = {}

    vmsToLoad.forEach(vm => { loadingState[vm.id] = true })
    setTrendsLoading(prev => ({ ...prev, ...loadingState }))
    
    const loadTrends = async () => {
      let results: Record<string, TrendPoint[]> = {}
      
      // Préférer le batch loading s'il est disponible
      if (onLoadTrendsBatch) {
        try {
          results = await onLoadTrendsBatch(vmsToLoad)
        } catch (e) {
          console.error('Failed to batch load trends:', e)
        }
      } else if (onLoadTrends) {
        // Fallback: charger un par un
        const promises = await Promise.allSettled(
          vmsToLoad.map(async (vm) => {
            try {
              const data = await onLoadTrends(vm)

              
return { id: vm.id, data }
            } catch (e) {
              return { id: vm.id, data: [] }
            }
          })
        )

        promises.forEach((result) => {
          if (result.status === 'fulfilled') {
            results[result.value.id] = result.value.data
          }
        })
      }
      
      // Mettre à jour les états
      const newTrends: Record<string, TrendPoint[]> = {}
      const newLoading: Record<string, boolean> = {}
      
      vmsToLoad.forEach(vm => {
        newTrends[vm.id] = results[vm.id] || []
        newLoading[vm.id] = false
      })
      
      setTrendsData(prev => ({ ...prev, ...newTrends }))
      setTrendsLoading(prev => ({ ...prev, ...newLoading }))
    }
    
    loadTrends()
  }, [showTrends, visibleVms, onLoadTrends, onLoadTrendsBatch]) // Ne dépend que des VMs visibles

  // Fonction d'export Excel
  const handleExportExcel = useCallback(async () => {
    const XLSX = await import('xlsx')
    const exportData = vms.map(vm => ({
      'ID': vm.vmid,
      'Nom': vm.name,
      'Type': vm.template ? 'Template' : (vm.type === 'lxc' ? 'LXC' : 'VM'),
      'Status': vm.status,
      'Node': vm.node,
      'HA': vm.hastate || '',
      'HA Group': vm.hagroup || '',
      'CPU (%)': vm.cpu !== undefined ? Math.round(vm.cpu) : '',
      'RAM (%)': vm.ram !== undefined ? Math.round(vm.ram) : '',
      'RAM Max (GB)': vm.maxmem ? Math.round(vm.maxmem / 1024 / 1024 / 1024 * 10) / 10 : '',
      'Uptime': typeof vm.uptime === 'number' ? secondsToUptime(vm.uptime) : (vm.uptime || ''),
      'IP': vm.ip || '',
      'Snapshots': vm.snapshots ?? '',
      'Tags': vm.tags?.join(', ') || '',
      'Template': vm.template ? 'Oui' : 'Non',
    }))

    const ws = XLSX.utils.json_to_sheet(exportData)
    const wb = XLSX.utils.book_new()

    XLSX.utils.book_append_sheet(wb, ws, 'VMs')
    
    // Ajuster la largeur des colonnes
    const colWidths = [
      { wch: 8 },   // ID
      { wch: 25 },  // Nom
      { wch: 10 },  // Type
      { wch: 10 },  // Statut
      { wch: 20 },  // Node
      { wch: 10 },  // HA
      { wch: 15 },  // HA Group
      { wch: 10 },  // CPU
      { wch: 10 },  // RAM
      { wch: 12 },  // RAM Max
      { wch: 12 },  // Uptime
      { wch: 15 },  // IP
      { wch: 10 },  // Snapshots
      { wch: 20 },  // Tags
      { wch: 10 },  // Template
    ]

    ws['!cols'] = colWidths

    XLSX.writeFile(wb, `vms-export-${new Date().toISOString().split('T')[0]}.xlsx`)
  }, [vms])

  const columns: GridColDef[] = useMemo(() => {
    // Helper pour créer un header avec icône
    const headerWithIcon = (icon: string, label: string) => () => (
      <Stack direction="row" spacing={0.5} alignItems="center">
        <i className={icon} style={{ fontSize: 14, opacity: 0.7 }} />
        <span>{label}</span>
      </Stack>
    )
    
    // Header compact pour mobile (juste l'icône)
    const headerIconOnly = (icon: string) => () => (
      <i className={icon} style={{ fontSize: 14, opacity: 0.7 }} />
    )
    
    const cols: GridColDef[] = [
      // ID - peut être masqué via le menu des colonnes
      {
        field: 'vmid',
        headerName: 'ID',
        width: 55,
        maxWidth: 70,
        renderHeader: headerWithIcon('ri-hashtag', 'ID'),
        renderCell: (params: any) => (
          <Typography variant='body2' sx={{ fontWeight: 600, fontSize: '0.75rem' }}>
            {params.row.vmid}
          </Typography>
        )
      } as GridColDef,

      // Colonne Favoris
      {
        field: 'favorite',
        headerName: '',
        width: 36,
        sortable: false,
        disableColumnMenu: true,
        renderHeader: () => (
          <i className="ri-star-line" style={{ fontSize: 14, opacity: 0.5 }} />
        ),
        renderCell: (params) => {
          const isFav = favorites?.has(params.row.id) || false

          
return (
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation()
                onToggleFavorite?.(params.row)
              }}
              sx={{ 
                p: 0.25,
                color: isFav ? '#ffc107' : 'text.disabled',
                '&:hover': { color: '#ffc107' }
              }}
            >
              <i className={isFav ? "ri-star-fill" : "ri-star-line"} style={{ fontSize: 16 }} />
            </IconButton>
          )
        }
      },
      {
        field: 'name',
        headerName: t('common.name'),
        flex: 1,
        minWidth: isMobile ? 100 : 150,
        maxWidth: 250,
        renderHeader: isMobile ? headerIconOnly('ri-computer-line') : headerWithIcon('ri-computer-line', t('common.name')),
        renderCell: (params) => (
          <Stack direction='row' spacing={0.5} sx={{ alignItems: 'center', overflow: 'hidden', width: '100%' }}>
            <Avatar sx={{ width: 22, height: 22, bgcolor: 'action.hover', flexShrink: 0 }}>
              <VmIcon type={params.row.type} template={params.row.template} />
            </Avatar>
            <Box sx={{ overflow: 'hidden', minWidth: 0, flex: 1 }}>
              <Typography variant='body2' sx={{ 
                fontWeight: 600, 
                fontSize: '0.75rem',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}>
                {params.row.name || `VM ${params.row.vmid}`}
              </Typography>
              {/* Afficher ID et Type sur mobile en sous-ligne */}
              {isMobile && (
                <Typography variant='caption' sx={{ opacity: 0.6, fontSize: '0.6rem' }}>
                  #{params.row.vmid} • {params.row.type === 'lxc' ? 'LXC' : 'VM'}
                </Typography>
              )}
            </Box>
          </Stack>
        )
      },

      // Type
      {
        field: 'type',
        headerName: 'Type',
        width: 75,
        renderHeader: headerWithIcon('ri-stack-line', 'Type'),
        renderCell: (params: any) => {
          if (params.row.template) {
            return (
              <Chip 
                label="Tmpl" 
                size='small' 
                variant='outlined'
                color='info'
                sx={{ height: 18, fontSize: '0.6rem' }}
              />
            )
          }

          
return (
            <Chip 
              label={params.row.type === 'lxc' ? 'LXC' : 'VM'} 
              size='small' 
              variant='outlined'
              sx={{ height: 18, fontSize: '0.6rem' }}
            />
          )
        }
      },
      {
        field: 'status',
        headerName: t('common.status'),
        width: isMobile ? 60 : 75,
        renderHeader: isMobile ? headerIconOnly('ri-pulse-line') : headerWithIcon('ri-pulse-line', t('common.status')),
        renderCell: (params) => {
          const vm = params.row as VmRow
          const isMigrating = isVmMigrating(vm.connId, vm.vmid)
          
          if (isMigrating) {
            return (
              <Tooltip title={t('common.loading')}>
                <Box sx={{
                  display: 'flex',
                  alignItems: 'center',
                  '@keyframes pulse': {
                    '0%, 100%': { opacity: 1 },
                    '50%': { opacity: 0.4 },
                  },
                  animation: 'pulse 1.5s ease-in-out infinite',
                }}>
                  <i className="ri-swap-box-line" style={{ fontSize: 18, color: '#ed6c02' }} />
                </Box>
              </Tooltip>
            )
          }
          
          return <StatusChip status={params.row.status} compact={true} />
        }
      },
    ]

    // Node - toujours inclus quand expanded, filtrage responsive géré à la fin
    if (showNode || expanded) {
      cols.push({
        field: 'node',
        headerName: 'Node',
        flex: 0.5,
        minWidth: 80,
        maxWidth: 150,
        renderHeader: headerWithIcon('ri-server-line', 'Node'),
        renderCell: (params) => (
          <Typography 
            variant='body2' 
            sx={{ 
              fontSize: '0.7rem', 
              opacity: 0.8,
              cursor: onNodeClick ? 'pointer' : 'default',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              '&:hover': onNodeClick ? { 
                color: 'primary.main',
                textDecoration: 'underline',
                opacity: 1
              } : {}
            }}
            onClick={(e) => {
              if (onNodeClick) {
                e.stopPropagation()
                onNodeClick(params.row.connId, params.row.node)
              }
            }}
          >
            {params.row.node}
          </Typography>
        )
      })
    }
    
    // Colonne HA - toujours inclus quand expanded et qu'il y a des VMs cluster
    if (showNode || expanded) {
      const hasClusterVms = vms.some(vm => vm.isCluster)

      if (hasClusterVms) {
        cols.push({
          field: 'ha',
          headerName: 'HA',
          width: 85,
          renderHeader: headerWithIcon('ri-shield-check-line', 'HA'),
          renderCell: (params) => {
            // Ne pas afficher pour les VMs standalone
            if (!params.row.isCluster) {
              return <Typography variant='caption' sx={{ opacity: 0.3 }}>—</Typography>
            }
            
            const hastate = params.row.hastate
            const hagroup = params.row.hagroup
            
            if (!hastate) {
              return <Typography variant='caption' sx={{ opacity: 0.3 }}>—</Typography>
            }
            
            return (
              <Tooltip title={`State: ${hastate}${hagroup ? `, Group: ${hagroup}` : ''}`}>
                <Chip 
                  label={hagroup || hastate} 
                  size='small' 
                  variant='outlined'
                  sx={{ height: 18, fontSize: '0.6rem', maxWidth: 60, '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }}
                />
              </Tooltip>
            )
          }
        })
      }
    }

    // CPU et RAM - toujours affichés
    cols.push(
      {
        field: 'cpu',
        headerName: 'CPU',
        width: 95,
        minWidth: 80,
        renderHeader: headerWithIcon('ri-cpu-line', 'CPU'),
        renderCell: (params) => {
          const cpu = params.row.cpu

          if (cpu === undefined || params.row.status !== 'running') {
            return <Typography variant='caption' sx={{ opacity: 0.5 }}>—</Typography>
          }

          
return <MetricBar value={cpu} />
        }
      },
      {
        field: 'ram',
        headerName: 'RAM',
        width: 95,
        minWidth: 80,
        renderHeader: headerWithIcon('ri-ram-line', 'RAM'),
        renderCell: (params) => {
          const ram = params.row.ram

          if (ram === undefined || params.row.status !== 'running') {
            return <Typography variant='caption' sx={{ opacity: 0.5 }}>—</Typography>
          }

          
return <MetricBar value={ram} />
        }
      }
    )

    // Colonnes expanded - filtrage responsive géré à la fin
    if (expanded) {
      cols.push({
        field: 'maxmem',
        headerName: t('common.memShort'),
        width: 55,
        renderHeader: headerIconOnly('ri-ram-2-line'),
        renderCell: (params) => {
          const maxmem = params.row.maxmem

          if (!maxmem) return <Typography variant='caption' sx={{ opacity: 0.5 }}>—</Typography>
          
return (
            <Typography variant='body2' sx={{ fontSize: '0.7rem' }}>
              {bytesToGb(maxmem)}G
            </Typography>
          )
        }
      })
    }

    // Colonnes disk/tags - filtrage responsive géré à la fin
    if (!isCompact || expanded) {
      cols.push({
        field: 'disk',
        headerName: 'Disk',
        width: 55,
        renderHeader: headerIconOnly('ri-hard-drive-2-line'),
        renderCell: (params) => {
          const maxdisk = params.row.maxdisk

          if (!maxdisk) return <Typography variant='caption' sx={{ opacity: 0.5 }}>—</Typography>
          
return (
            <Typography variant='body2' sx={{ fontSize: '0.7rem' }}>
              {bytesToGb(maxdisk)}G
            </Typography>
          )
        }
      })
      
      // Tags
      cols.push({
        field: 'tags',
        headerName: 'Tags',
        width: 80,
        minWidth: 60,
        renderHeader: headerIconOnly('ri-price-tag-3-line'),
        renderCell: (params) => <TagsCell tags={params.row.tags || []} />
      })
    }

    // Colonnes IP et Snapshots (si activé) - filtrage responsive géré à la fin
    if (showIpSnap && expanded) {
      cols.push(
        {
          field: 'ip',
          headerName: 'IP',
          width: 95,
          renderHeader: headerWithIcon('ri-global-line', 'IP'),
          renderCell: (params) => {
            const ip = params.row.ip

            if (!ip) {
              return <Typography variant='caption' sx={{ opacity: 0.4 }}>—</Typography>
            }

            
return (
              <Typography variant='body2' sx={{ fontSize: '0.7rem' }}>
                {ip}
              </Typography>
            )
          }
        },
        {
          field: 'snapshots',
          headerName: 'Snap',
          width: 50,
          renderHeader: headerWithIcon('ri-camera-line', 'Snap'),
          renderCell: (params) => {
            const snaps = params.row.snapshots

            if (snaps === undefined || snaps === null) {
              return <Typography variant='caption' sx={{ opacity: 0.4 }}>—</Typography>
            }

            
return (
              <Chip 
                size='small' 
                label={snaps} 
                color={snaps > 0 ? 'info' : 'default'}
                sx={{ height: 18, fontSize: '0.65rem', minWidth: 24 }}
              />
            )
          }
        },
        {
          field: 'osInfo',
          headerName: 'OS',
          width: 110,
          renderHeader: headerWithIcon('ri-computer-line', 'OS'),
          renderCell: (params) => {
            const osInfo = params.row.osInfo

            if (!osInfo) {
              return <Typography variant='caption' sx={{ opacity: 0.4 }}>—</Typography>
            }
            
            // Icône selon le type d'OS
            const osIcon = osInfo.type === 'windows' 
              ? 'ri-windows-fill' 
              : osInfo.type === 'linux' 
                ? 'ri-ubuntu-fill' 
                : 'ri-terminal-box-line'
            
            const osColor = osInfo.type === 'windows'
              ? '#0078D4'
              : osInfo.type === 'linux'
                ? '#E95420'
                : undefined
            
            // Nom court de l'OS
            let shortName = osInfo.name || 'Unknown'


            // Raccourcir les noms longs
            if (shortName.length > 15) {
              shortName = shortName.split(' ').slice(0, 2).join(' ')
            }
            
            return (
              <Tooltip 
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
                  <i className={osIcon} style={{ fontSize: 14, color: osColor }} />
                  <Typography variant='body2' sx={{ fontSize: '0.7rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {shortName}
                  </Typography>
                </Box>
              </Tooltip>
            )
          }
        }
      )
    }
    
    // Colonne Trend (si activé) - filtrage responsive géré à la fin
    if (showTrends && expanded) {
      cols.push({
        field: 'trend',
        headerName: 'Trend',
        flex: 0.8,
        minWidth: 120,
        sortable: false,
        renderHeader: headerWithIcon('ri-line-chart-line', 'Trend'),
        renderCell: (params) => {
          const vm = params.row as VmRow

          if (vm.status !== 'running') {
            return <Typography variant='caption' sx={{ opacity: 0.5 }}>—</Typography>
          }
          
          const data = trendsData[vm.id] || vm.trend || []
          const isLoading = trendsLoading[vm.id]
          
          if (isLoading) {
            return (
              <Box sx={{ height: 32, width: '100%', display: 'flex', alignItems: 'center' }}>
                <Skeleton variant='rounded' width='100%' height={20} />
              </Box>
            )
          }
          
          if (!data || data.length === 0) {
            return (
              <Box sx={{ height: 32, width: '100%', display: 'flex', alignItems: 'center' }}>
                <Typography variant='caption' sx={{ opacity: 0.4 }}>—</Typography>
              </Box>
            )
          }
          
          // Clé unique pour forcer le re-render quand les données changent
          const chartKey = `${vm.id}-${data.length}`
          
          // Calculer le domaine Y dynamiquement pour un meilleur rendu (basé sur CPU et RAM)
          const allValues = data.flatMap((d: any) => [d.cpu || 0, d.ram || 0])
          const maxVal = Math.max(...allValues, 10)
          const minVal = Math.min(...allValues, 0)
          const yMax = Math.min(100, maxVal + 10)
          const yMin = Math.max(0, minVal - 5)
          
          // Couleurs
          const cpuColor = '#e57000'  // Orange vif
          const ramColor = '#b35500'  // Orange foncé
          
          return (
            <Box 
              sx={{ height: 32, width: '100%', position: 'relative' }} 
              key={chartKey}
            >
              <ResponsiveContainer width='100%' height='100%'>
                <AreaChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                  <defs>
                    <linearGradient id={`cpuGradient-${vm.id}`} x1='0' y1='0' x2='0' y2='1'>
                      <stop offset='0%' stopColor={cpuColor} stopOpacity={0.25} />
                      <stop offset='100%' stopColor={cpuColor} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey='t' hide />
                  <YAxis hide domain={[yMin, yMax]} />
                  <RTooltip 
                    content={<TrendTooltip />} 
                    cursor={{ stroke: cpuColor, strokeWidth: 1, strokeDasharray: '3 3' }} 
                  />
                  {/* Ligne CPU - orange vif */}
                  <Area
                    type='monotone'
                    dataKey='cpu'
                    stroke={cpuColor}
                    strokeWidth={1.5}
                    fill={`url(#cpuGradient-${vm.id})`}
                    dot={false}
                    isAnimationActive={false}
                  />
                  {/* Ligne RAM - orange foncé */}
                  <Area
                    type='monotone'
                    dataKey='ram'
                    stroke={ramColor}
                    strokeWidth={1.5}
                    fill='transparent'
                    dot={false}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </Box>
          )
        }
      })
    }
    
    // Uptime - filtrage responsive géré à la fin
    if (showIpSnap && expanded) {
      cols.push({
        field: 'uptime',
        headerName: 'Uptime',
        width: 65,
        renderHeader: headerWithIcon('ri-time-line', 'Up'),
        renderCell: (params) => {
          if (params.row.status !== 'running') {
            return <Typography variant='caption' sx={{ opacity: 0.5 }}>—</Typography>
          }

          
return (
            <Typography variant='body2' sx={{ fontSize: '0.7rem' }}>
              {secondsToUptime(params.row.uptime)}
            </Typography>
          )
        }
      })
    }

    // Colonne Actions - toujours visible, compacte
    if (showActions && onVmAction) {
      cols.push({
        field: 'actions',
        headerName: 'Actions',
        width: isMobile ? 75 : 170,
        minWidth: isMobile ? 75 : 130,
        sortable: false,
        disableColumnMenu: true,
        renderHeader: headerIconOnly('ri-flashlight-line'),
        renderCell: (params) => {
          const vm = params.row as VmRow
          const isRunning = vm.status === 'running'
          const isStopped = vm.status === 'stopped'
          const isPaused = vm.status === 'paused'
          
          // Pour les templates, afficher icône Deploy + Migration si cluster
          if (vm.template) {
            return (
              <Stack direction='row' spacing={0.25} sx={{ alignItems: 'center' }}>
                {/* Deploy (Clone) */}
                <Tooltip title={t('vmActions.deployFromTemplate')}>
                  <IconButton 
                    size='small'
                    onClick={(e) => { 
                      e.stopPropagation()
                      onVmAction(vm, 'clone') 
                    }}
                    sx={{ 
                      color: 'primary.main',
                      p: 0.5,
                      '&:hover': { bgcolor: 'primary.main', color: 'white' }
                    }}
                  >
                    <i className='ri-file-copy-2-line' style={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
                
                {/* Migrate - toujours disponible (cross-cluster pour standalone) */}
                {onMigrate && (
                  <Tooltip title={t('vmActions.migrate')}>
                    <IconButton
                      size='small'
                      onClick={(e) => { e.stopPropagation(); onMigrate(vm) }}
                      sx={{
                        color: 'text.secondary',
                        p: 0.5,
                        '&:hover': { bgcolor: 'secondary.main', color: 'white' }
                      }}
                    >
                      <i className='ri-arrow-left-right-line' style={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                )}
              </Stack>
            )
          }
          
          // Sur mobile, afficher seulement Start/Stop
          if (isMobile) {
            return (
              <Stack direction='row' spacing={0.25} sx={{ alignItems: 'center' }}>
                <Tooltip title={isRunning ? t('vmActions.stop') : t('vmActions.start')}>
                  <span>
                    <IconButton 
                      size='small' 
                      onClick={(e) => { 
                        e.stopPropagation()
                        onVmAction(vm, isRunning ? 'shutdown' : 'start') 
                      }}
                      sx={{ 
                        color: isRunning ? 'warning.main' : 'success.main',
                        p: 0.5,
                      }}
                    >
                      <i className={isRunning ? 'ri-shut-down-line' : 'ri-play-fill'} style={{ fontSize: 16 }} />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="Console">
                  <span>
                    <IconButton 
                      size='small'
                      disabled={!isRunning}
                      onClick={(e) => { e.stopPropagation(); onVmAction(vm, 'console') }}
                      sx={{ 
                        color: isRunning ? 'text.secondary' : 'action.disabled',
                        p: 0.5,
                      }}
                    >
                      <i className='ri-terminal-box-line' style={{ fontSize: 16 }} />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>
            )
          }
          
          return (
            <Stack direction='row' spacing={0.25} sx={{ alignItems: 'center' }}>
              {/* Start - visible si stopped ou paused */}
              <Tooltip title={t('vmActions.start')}>
                <span>
                  <IconButton 
                    size='small' 
                    disabled={isRunning}
                    onClick={(e) => { e.stopPropagation(); onVmAction(vm, 'start') }}
                    sx={{ 
                      color: (isStopped || isPaused) ? 'success.main' : 'action.disabled',
                      p: 0.5,
                      '&:hover': { bgcolor: 'success.main', color: 'white' }
                    }}
                  >
                    <i className='ri-play-fill' style={{ fontSize: 16 }} />
                  </IconButton>
                </span>
              </Tooltip>
              
              {/* Shutdown - visible si running */}
              <Tooltip title={t('vmActions.shutdown')}>
                <span>
                  <IconButton 
                    size='small'
                    disabled={!isRunning}
                    onClick={(e) => { e.stopPropagation(); onVmAction(vm, 'shutdown') }}
                    sx={{ 
                      color: isRunning ? 'warning.main' : 'action.disabled',
                      p: 0.5,
                      '&:hover': { bgcolor: 'warning.main', color: 'white' }
                    }}
                  >
                    <i className='ri-shut-down-line' style={{ fontSize: 16 }} />
                  </IconButton>
                </span>
              </Tooltip>
              
              {/* Stop - visible si running - masqué sur tablette */}
              {!isTablet && (
                <Tooltip title={t('vmActions.forceStop')}>
                  <span>
                    <IconButton 
                      size='small'
                      disabled={!isRunning}
                      onClick={(e) => { e.stopPropagation(); onVmAction(vm, 'stop') }}
                      sx={{ 
                        color: isRunning ? 'error.main' : 'action.disabled',
                        p: 0.5,
                        '&:hover': { bgcolor: 'error.main', color: 'white' }
                      }}
                    >
                      <i className='ri-stop-fill' style={{ fontSize: 16 }} />
                    </IconButton>
                  </span>
                </Tooltip>
              )}
              
              {/* Pause - visible si running - masqué sur tablette */}
              {!isTablet && (
                <Tooltip title={isPaused ? t('vmActions.resume') : t('vmActions.pause')}>
                  <span>
                    <IconButton 
                      size='small'
                      disabled={isStopped}
                      onClick={(e) => { e.stopPropagation(); onVmAction(vm, 'pause') }}
                      sx={{ 
                        color: (isRunning || isPaused) ? 'info.main' : 'action.disabled',
                        p: 0.5,
                        '&:hover': { bgcolor: 'info.main', color: 'white' }
                      }}
                    >
                      <i className={isPaused ? 'ri-play-fill' : 'ri-pause-fill'} style={{ fontSize: 16 }} />
                    </IconButton>
                  </span>
                </Tooltip>
              )}
              
              {/* Console - visible si running */}
              <Tooltip title="Console">
                <span>
                  <IconButton 
                    size='small'
                    disabled={!isRunning}
                    onClick={(e) => { e.stopPropagation(); onVmAction(vm, 'console') }}
                    sx={{ 
                      color: isRunning ? 'text.secondary' : 'action.disabled',
                      p: 0.5,
                      '&:hover': { bgcolor: 'action.hover' }
                    }}
                  >
                    <i className='ri-terminal-box-line' style={{ fontSize: 16 }} />
                  </IconButton>
                </span>
              </Tooltip>
              
              {/* Migrate - toujours disponible (cross-cluster pour standalone) */}
              {onMigrate && (
                <Tooltip title={t('vmActions.migrate')}>
                  <IconButton
                    size='small'
                    onClick={(e) => { e.stopPropagation(); onMigrate(vm) }}
                    sx={{
                      color: 'text.secondary',
                      p: 0.5,
                      '&:hover': { bgcolor: 'secondary.main', color: 'white' }
                    }}
                  >
                    <i className='ri-arrow-left-right-line' style={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              )}
              
              {/* Details */}
              <Tooltip title={t('vmActions.details')}>
                <IconButton 
                  size='small'
                  onClick={(e) => { e.stopPropagation(); onVmAction(vm, 'details') }}
                  sx={{ 
                    color: 'text.secondary',
                    p: 0.5,
                    '&:hover': { bgcolor: 'primary.main', color: 'white' }
                  }}
                >
                  <i className='ri-eye-line' style={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            </Stack>
          )
        }
      })
    }

    // Filtrer les colonnes en combinant :
    // 1. Les contraintes responsive (certaines colonnes ne doivent pas apparaître sur mobile/tablette)
    // 2. Les préférences utilisateur (menu de sélection des colonnes)
    const responsiveHidden: Record<string, boolean> = {
      vmid: isMobile,      // ID masqué sur mobile
      type: isTablet,      // Type masqué sur tablette et mobile
      ha: isTablet,        // HA masqué sur tablette et mobile  
      maxmem: isTablet,    // Mémoire masquée sur tablette
      disk: isTablet,      // Disque masqué sur tablette
      tags: isSmallDesktop, // Tags masqués sur petits desktops
      ip: isSmallDesktop,  // IP masquée sur petits desktops
      snapshots: isSmallDesktop, // Snapshots masqués sur petits desktops
      osInfo: isSmallDesktop, // OS masqué sur petits desktops
      uptime: isTablet,    // Uptime masqué sur tablette
      trend: !isLargeDesktop, // Trend seulement sur grands écrans
      node: isMobile,      // Node masqué sur mobile
    }
    
    return cols.filter(col => {
      // Si l'utilisateur a explicitement masqué la colonne
      if (visibleColumns[col.field] === false) return false

      // Si la contrainte responsive masque la colonne
      if (responsiveHidden[col.field]) return false
      
return true
    })
  }, [isCompact, expanded, showNode, showTrends, showActions, showIpSnap, onVmAction, onMigrate, onNodeClick, primaryColor, trendsData, trendsLoading, vms, isMobile, isTablet, isSmallDesktop, isLargeDesktop, favorites, onToggleFavorite, visibleColumns])

  return (
    <Box sx={{ 
      width: '100%', 
      height: maxHeight === 'auto' ? 'auto' : maxHeight, 
      display: 'flex', 
      flexDirection: 'column',
      minHeight: maxHeight === 'auto' ? 0 : 400 
    }}>
      {/* Toolbar avec toggle densité et bouton IP/Snap */}
      {(showDensityToggle || (showIpSnap && onLoadIpSnap) || vms.length > 0) && (
        <Box sx={{ 
          display: 'flex', 
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 1,
          p: 1, 
          borderBottom: '1px solid',
          borderColor: 'divider',
          flexShrink: 0
        }}>
          {/* Bouton charger détails (à gauche) */}
          {onLoadIpSnap && !showIpSnap ? (
            <Box
              onClick={ipSnapLoading ? undefined : onLoadIpSnap}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                px: 1.5,
                py: 0.5,
                borderRadius: 1,
                cursor: ipSnapLoading ? 'default' : 'pointer',
                fontSize: '0.75rem',
                color: ipSnapLoading ? 'text.disabled' : 'primary.main',
                bgcolor: 'action.hover',
                '&:hover': { bgcolor: ipSnapLoading ? 'action.hover' : 'action.selected' }
              }}
            >
              {ipSnapLoading ? (
                <>
                  <CircularProgress size={12} />
                  <span>{t('common.loading')}</span>
                </>
              ) : (
                <>
                  <i className='ri-download-cloud-line' style={{ fontSize: 14 }} />
                  <span>{t('common.refresh')}</span>
                </>
              )}
            </Box>
          ) : <Box />}
          
          {/* Zone droite avec Export et Densité */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {/* Bouton Export Excel */}
            <Tooltip title={t('common.export')}>
              <Box
                onClick={handleExportExcel}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  px: 1,
                  py: 0.5,
                  borderRadius: 1,
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                  color: 'text.secondary',
                  '&:hover': { bgcolor: 'action.hover' }
                }}
              >
                <i className='ri-file-excel-2-line' style={{ fontSize: 14 }} />
              </Box>
            </Tooltip>
            
            {/* Bouton sélection colonnes */}
            <Tooltip title={t('common.configuration')}>
              <Box
                onClick={(e) => setColumnsMenuAnchor(e.currentTarget)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  px: 1,
                  py: 0.5,
                  borderRadius: 1,
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                  color: 'text.secondary',
                  '&:hover': { bgcolor: 'action.hover' }
                }}
              >
                <i className='ri-layout-column-line' style={{ fontSize: 14 }} />
              </Box>
            </Tooltip>
            
            {/* Menu sélection colonnes */}
            <Menu
              anchorEl={columnsMenuAnchor}
              open={Boolean(columnsMenuAnchor)}
              onClose={() => setColumnsMenuAnchor(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
              PaperProps={{
                sx: { maxHeight: 400, minWidth: 180 }
              }}
            >
              <Typography variant="caption" sx={{ px: 2, py: 1, display: 'block', fontWeight: 600, color: 'text.secondary' }}>
                Colonnes visibles
              </Typography>
              {[
                { field: 'vmid', label: '#ID' },
                { field: 'favorite', label: 'Favoris' },
                { field: 'name', label: 'Nom' },
                { field: 'type', label: 'Type' },
                { field: 'status', label: t('common.status') },
                { field: 'node', label: 'Node' },
                { field: 'ha', label: 'HA' },
                { field: 'cpu', label: 'CPU' },
                { field: 'ram', label: 'RAM' },
                { field: 'maxmem', label: t('common.memory') },
                { field: 'disk', label: t('vms.disk') },
                { field: 'tags', label: 'Tags' },
                { field: 'ip', label: 'IP' },
                { field: 'snapshots', label: 'Snapshots' },
                { field: 'osInfo', label: 'OS' },
                { field: 'uptime', label: 'Uptime' },
                { field: 'trend', label: 'Trend' },
                { field: 'actions', label: t('common.actions') },
              ].map(({ field, label }) => (
                <MenuItem 
                  key={field} 
                  dense
                  onClick={() => setVisibleColumns(prev => ({ ...prev, [field]: !prev[field] }))}
                  sx={{ py: 0.5 }}
                >
                  <Checkbox 
                    checked={visibleColumns[field] !== false} 
                    size="small"
                    sx={{ p: 0.5, mr: 1 }}
                  />
                  <Typography variant="body2">{label}</Typography>
                </MenuItem>
              ))}
            </Menu>
            
            {/* Toggle densité */}
            {showDensityToggle && (
              <Box
                onClick={() => setIsCompact(!isCompact)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  px: 1,
                  py: 0.5,
                  borderRadius: 1,
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                  color: 'text.secondary',
                  '&:hover': { bgcolor: 'action.hover' }
                }}
              >
                <i className={isCompact ? 'ri-list-check' : 'ri-list-check-2'} style={{ fontSize: 14 }} />
                {isCompact ? 'Compact' : 'Normal'}
              </Box>
            )}
          </Box>
        </Box>
      )}
      
      <DataGrid
        rows={vms}
        columns={columns}
        loading={loading}
        density={isCompact ? 'compact' : 'standard'}
        disableRowSelectionOnClick={!onVmClick}
        onRowClick={onVmClick ? (params) => {
          const vm = params.row as VmRow


          // Bloquer le clic si la VM est en migration
          if (isVmMigrating(vm.connId, vm.vmid)) return
          onVmClick(vm)
        } : undefined}
        pageSizeOptions={[10, 25, 50, 100]}
        paginationModel={autoPageSize ? undefined : paginationModel}
        onPaginationModelChange={(model) => {
          setPaginationModel(model)
        }}
        autoPageSize={autoPageSize}
        autoHeight={maxHeight === 'auto'}
        hideFooter={maxHeight === 'auto'}
        disableColumnMenu
        getRowClassName={(params) => {
          const vm = params.row as VmRow
          const isMigrating = isVmMigrating(vm.connId, vm.vmid)
          const isHighlighted = highlightedId && params.row.id === highlightedId

          
return [
            isMigrating ? 'migrating-row' : '',
            isHighlighted ? 'highlighted-row' : ''
          ].filter(Boolean).join(' ')
        }}
        initialState={{
          columns: {
            columnVisibilityModel: {},
          },
        }}
        slotProps={{
          row: {
            onContextMenu: (event: React.MouseEvent) => {
              event.preventDefault()
              const rowId = (event.currentTarget as HTMLElement).getAttribute('data-id')
              const vm = vms.find(v => v.id === rowId)

              if (vm) {
                // Bloquer le menu contextuel si la VM est en migration
                if (isVmMigrating(vm.connId, vm.vmid)) return
                handleContextMenu(event, vm)
              }
            },
          },
        }}
        sx={{
          border: 'none',
          flex: maxHeight === 'auto' ? 'none' : 1,
          minHeight: 0,
          width: '100%',

          // Style pour les VMs en migration
          '& .migrating-row': {
            opacity: 0.5,
            cursor: 'not-allowed',
            '&:hover': {
              bgcolor: 'transparent !important',
            },
          },

          // Permettre le scroll horizontal quand nécessaire
          '& .MuiDataGrid-main': {
            overflow: 'auto',
          },
          '& .MuiDataGrid-virtualScroller': {
            overflowX: 'auto',
          },

          // Supprimer l'espace vide à droite des colonnes
          '& .MuiDataGrid-columnHeadersInner': {
            width: '100%',
          },
          '& .MuiDataGrid-virtualScrollerRenderZone': {
            width: '100%',
          },
          '& .MuiDataGrid-row': {
            width: '100%',
            cursor: onVmClick ? 'pointer' : 'default',
            minHeight: isCompact ? '36px !important' : '52px !important',
            maxHeight: isCompact ? '36px !important' : '52px !important',
            '&:hover': {
              bgcolor: `${primaryColor}14`,
            }
          },
          '& .MuiDataGrid-columnHeaders': {
            borderBottom: '1px solid',
            borderColor: 'divider',
            bgcolor: 'action.hover',
            minHeight: isCompact ? '40px !important' : '56px !important',
            maxHeight: isCompact ? '40px !important' : '56px !important',
          },
          '& .MuiDataGrid-columnHeaderTitle': {
            fontWeight: 600,
          },
          '& .MuiDataGrid-cell': {
            borderBottom: '1px solid',
            borderColor: 'divider',
            py: isCompact ? 0.25 : 0.75,
            display: 'flex',
            alignItems: 'center',
            overflow: 'hidden',
          },
          '& .MuiDataGrid-row.highlighted-row': {
            bgcolor: `${primaryColor}22`,
            animation: 'highlightPulse 2s ease-in-out',
            '&:hover': {
              bgcolor: `${primaryColor}33`,
            }
          },
          '@keyframes highlightPulse': {
            '0%': { bgcolor: `${primaryColor}44` },
            '50%': { bgcolor: `${primaryColor}22` },
            '100%': { bgcolor: `${primaryColor}22` },
          },
          '& .MuiDataGrid-footerContainer': {
            borderTop: '1px solid',
            borderColor: 'divider',
            minHeight: '48px !important',
          },

          // Scrollbar plus discrète
          '& .MuiDataGrid-scrollbar--horizontal': {
            height: '8px',
          },
        }}
        localeText={{
          noRowsLabel: t('common.noData'),
        }}
      />
      
      {/* Menu contextuel (clic droit) */}
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
          <Typography variant="subtitle2" fontWeight={600}>
            {contextMenu?.vm.name}
          </Typography>
          <Typography variant="caption" sx={{ opacity: 0.6 }}>
            {contextMenu?.vm.template ? 'TEMPLATE' : contextMenu?.vm.type?.toUpperCase()} • #{contextMenu?.vm.vmid}
          </Typography>
        </Box>

        {/* Actions pour VM normale */}
        {!contextMenu?.vm.template && [
          <MenuItem 
            key="start"
            onClick={() => handleContextAction('start')} 
            disabled={contextMenu?.vm.status === 'running'}
          >
            <ListItemIcon>
              <PlayArrowIcon fontSize="small" sx={{ color: 'success.main' }} />
            </ListItemIcon>
            <ListItemText>{t('audit.actions.start')}</ListItemText>
          </MenuItem>,

          <MenuItem
            key="shutdown"
            onClick={() => handleContextAction('shutdown')}
            disabled={contextMenu?.vm.status !== 'running'}
          >
            <ListItemIcon>
              <PowerSettingsNewIcon fontSize="small" sx={{ color: 'warning.main' }} />
            </ListItemIcon>
            <ListItemText>Shutdown</ListItemText>
          </MenuItem>,

          <MenuItem
            key="stop"
            onClick={() => handleContextAction('stop')}
            disabled={contextMenu?.vm.status !== 'running'}
          >
            <ListItemIcon>
              <StopIcon fontSize="small" sx={{ color: 'error.main' }} />
            </ListItemIcon>
            <ListItemText>{t('audit.actions.stop')}</ListItemText>
          </MenuItem>,

          <MenuItem
            key="suspend"
            onClick={() => handleContextAction('suspend')}
            disabled={contextMenu?.vm.status !== 'running'}
          >
            <ListItemIcon>
              <PauseIcon fontSize="small" sx={{ color: 'info.main' }} />
            </ListItemIcon>
            <ListItemText>{t('audit.actions.suspend')}</ListItemText>
          </MenuItem>,

          <MenuItem
            key="reboot"
            onClick={() => handleContextAction('reboot')}
            disabled={contextMenu?.vm.status !== 'running'}
          >
            <ListItemIcon>
              <RestartAltIcon fontSize="small" sx={{ color: 'primary.main' }} />
            </ListItemIcon>
            <ListItemText>{t('audit.actions.restart')}</ListItemText>
          </MenuItem>,

          <Divider key="divider1" />,

          <MenuItem 
            key="console"
            onClick={() => {
              if (contextMenu?.vm) {
                const { connId, node, type, vmid } = contextMenu.vm
                const url = `/novnc/console.html?connId=${encodeURIComponent(connId)}&type=${encodeURIComponent(type)}&node=${encodeURIComponent(node)}&vmid=${encodeURIComponent(vmid)}`

                window.open(url, `console-${vmid}`, 'width=1024,height=768,menubar=no,toolbar=no,location=no,status=no')
              }

              handleCloseContextMenu()
            }}
          >
            <ListItemIcon>
              <TerminalIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Console</ListItemText>
          </MenuItem>,

          <Divider key="divider2" />,

          onMigrate && (
            <MenuItem key="migrate" onClick={handleContextMigrate}>
              <ListItemIcon>
                <MoveUpIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>{t('audit.actions.migrate')}</ListItemText>
            </MenuItem>
          ),

          <MenuItem
            key="clone"
            onClick={() => {
              if (contextMenu?.vm) {
                onVmAction(contextMenu.vm, 'clone')
              }

              handleCloseContextMenu()
            }}
          >
            <ListItemIcon>
              <ContentCopyIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t('audit.actions.clone')}</ListItemText>
          </MenuItem>
        ]}

        {/* Actions pour Template */}
        {contextMenu?.vm.template && (
          <MenuItem
            onClick={() => {
              if (contextMenu?.vm) {
                onVmAction(contextMenu.vm, 'clone')
              }

              handleCloseContextMenu()
            }}
          >
            <ListItemIcon>
              <ContentCopyIcon fontSize="small" sx={{ color: 'primary.main' }} />
            </ListItemIcon>
            <ListItemText>{t('audit.actions.clone')}</ListItemText>
          </MenuItem>
        )}
      </Menu>
    </Box>
  )
}
