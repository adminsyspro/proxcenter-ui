'use client'

import { useMemo, useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'

import {
  Avatar,
  Box,
  Chip,
  Divider,
  LinearProgress,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Typography,
  useTheme
} from '@mui/material'
import { DataGrid, GridColDef } from '@mui/x-data-grid'
// RemixIcon replacements for @mui/icons-material
const PlayArrowIcon = (props: any) => <i className="ri-play-fill" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const StopIcon = (props: any) => <i className="ri-stop-fill" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const PowerSettingsNewIcon = (props: any) => <i className="ri-shut-down-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const MoveUpIcon = (props: any) => <i className="ri-upload-2-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />

/* -----------------------------
  Helpers
------------------------------ */

const pct = (v: any) => Math.max(0, Math.min(100, Number(v ?? 0)))

const secondsToUptime = (s: any) => {
  const sec = Number(s || 0)

  if (!sec) return '—'
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)

  if (d > 0) return `${d}j ${h}h`
  const m = Math.floor((sec % 3600) / 60)

  if (h > 0) return `${h}h ${m}m`
  
return `${m}m`
}

/* -----------------------------
  Sub-components
------------------------------ */

const ServerIcon = ({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="3" y="3" width="18" height="6" rx="1" stroke={color} strokeWidth="1.5" fill="none"/>
    <rect x="3" y="11" width="18" height="6" rx="1" stroke={color} strokeWidth="1.5" fill="none"/>
    <circle cx="6" cy="6" r="1" fill={color}/>
    <circle cx="6" cy="14" r="1" fill={color}/>
    <line x1="9" y1="6" x2="18" y2="6" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
    <line x1="9" y1="14" x2="18" y2="14" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
)

const StatusChip = ({ status }: { status: string }) => {
  if (status === 'online') return <Chip size='small' color='success' label='UP' sx={{ height: 20, fontSize: '0.7rem' }} />
  if (status === 'maintenance') return <Chip size='small' color='warning' label='MAINT' sx={{ height: 20, fontSize: '0.7rem' }} />
  
return <Chip size='small' color='error' label='DOWN' sx={{ height: 20, fontSize: '0.7rem' }} />
}

const MetricBar = ({ value, label }: { value: number; label?: string }) => (
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

/* -----------------------------
  Types
------------------------------ */

export type NodeRow = {
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
  version?: string
  ip?: string
}

export type BulkAction = 'start-all' | 'stop-all' | 'shutdown-all' | 'migrate-all'

type NodeContextMenu = {
  mouseX: number
  mouseY: number
  node: NodeRow
} | null

type NodesTableProps = {
  nodes: NodeRow[]
  loading?: boolean
  onNodeClick?: (node: NodeRow) => void
  onBulkAction?: (node: NodeRow, action: BulkAction) => void
  compact?: boolean
  maxHeight?: number | string
  showMigrateOption?: boolean // Only show migrate in cluster with multiple nodes
}

/* -----------------------------
  Component
------------------------------ */

export default function NodesTable({
  nodes,
  loading = false,
  onNodeClick,
  onBulkAction,
  compact = false,
  maxHeight = 400,
  showMigrateOption = true
}: NodesTableProps) {
  const theme = useTheme()
  const t = useTranslations()

  // Context menu state
  const [contextMenu, setContextMenu] = useState<NodeContextMenu>(null)

  const handleContextMenu = useCallback((event: React.MouseEvent, node: NodeRow) => {
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({
      mouseX: event.clientX,
      mouseY: event.clientY,
      node
    })
  }, [])

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  const handleBulkAction = useCallback((action: BulkAction) => {
    if (!contextMenu || !onBulkAction) return
    onBulkAction(contextMenu.node, action)
    handleCloseContextMenu()
  }, [contextMenu, onBulkAction, handleCloseContextMenu])

  const columns: GridColDef[] = useMemo(() => {
    const cols: GridColDef[] = [
      {
        field: 'name',
        headerName: 'Node',
        flex: 1,
        minWidth: 140,
        renderCell: (params) => (
          <Stack direction='row' spacing={1} sx={{ alignItems: 'center' }}>
            <Avatar sx={{ width: 24, height: 24, bgcolor: 'action.hover' }}>
              <ServerIcon size={12} />
            </Avatar>
            <Typography variant='body2' sx={{ fontWeight: 600, fontSize: compact ? '0.8rem' : '0.875rem' }}>
              {params.row.name}
            </Typography>
          </Stack>
        )
      },
      {
        field: 'ip',
        headerName: 'IP',
        width: 130,
        renderCell: (params) => (
          <Typography 
            variant='body2' 
            sx={{ 
              fontSize: '0.8rem',
              opacity: params.row.ip ? 1 : 0.4
            }}
          >
            {params.row.ip || '—'}
          </Typography>
        )
      },
      {
        field: 'status',
        headerName: t('common.status'),
        width: 70,
        renderCell: (params) => <StatusChip status={params.row.status} />
      },
      {
        field: 'cpu',
        headerName: 'CPU',
        width: 80,
        renderCell: (params) => <MetricBar value={params.row.cpu} />
      },
      {
        field: 'ram',
        headerName: 'RAM',
        width: 80,
        renderCell: (params) => <MetricBar value={params.row.ram} />
      },
      {
        field: 'storage',
        headerName: 'Disk',
        width: 80,
        renderCell: (params) => <MetricBar value={params.row.storage} />
      },
      {
        field: 'vms',
        headerName: 'VMs',
        width: 60,
        renderCell: (params) => (
          <Typography variant='body2' sx={{ fontWeight: 600 }}>
            {params.row.vms ?? '—'}
          </Typography>
        )
      },
      {
        field: 'uptime',
        headerName: 'Uptime',
        width: 80,
        renderCell: (params) => (
          <Typography variant='body2' sx={{ fontSize: '0.75rem' }}>
            {secondsToUptime(params.row.uptime)}
          </Typography>
        )
      },
    ]

    return cols
  }, [compact])

  const isAutoHeight = maxHeight === 'auto'

  // Handle context menu via event delegation on the container
  const handleContainerContextMenu = useCallback((event: React.MouseEvent) => {
    if (!onBulkAction) return

    // Find the closest row element
    const target = event.target as HTMLElement
    const rowElement = target.closest('.MuiDataGrid-row') as HTMLElement | null

    if (rowElement) {
      event.preventDefault()
      const rowId = rowElement.getAttribute('data-id')
      const node = nodes.find(n => n.id === rowId)

      if (node) {
        handleContextMenu(event, node)
      }
    }
  }, [nodes, onBulkAction, handleContextMenu])

  return (
    <Box
      sx={{ width: '100%', height: isAutoHeight ? 'auto' : maxHeight }}
      onContextMenu={handleContainerContextMenu}
    >
      <DataGrid
        rows={nodes}
        columns={columns}
        loading={loading}
        density={compact ? 'compact' : 'standard'}
        disableRowSelectionOnClick={!onNodeClick}
        onRowClick={onNodeClick ? (params) => onNodeClick(params.row as NodeRow) : undefined}
        pageSizeOptions={[10, 15, 25, 50]}
        autoHeight={isAutoHeight}
        initialState={{
          pagination: { paginationModel: { pageSize: 15 } }
        }}
        sx={{
          border: 'none',
          '& .MuiDataGrid-main': {
            overflow: 'hidden',
          },
          '& .MuiDataGrid-virtualScroller': {
            overflow: 'hidden !important',
          },
          '& .MuiDataGrid-cell': {
            borderBottom: '1px solid',
            borderColor: 'divider',
            py: compact ? 0.5 : 1,
          },
          '& .MuiDataGrid-columnHeaders': {
            borderBottom: '1px solid',
            borderColor: 'divider',
            bgcolor: 'action.hover',
          },
          '& .MuiDataGrid-row': {
            cursor: onNodeClick ? 'pointer' : 'default',
            '&:hover': {
              bgcolor: `${theme.palette.primary.main}14`,
            }
          },
          '& .MuiDataGrid-footerContainer': {
            borderTop: '1px solid',
            borderColor: 'divider',
          }
        }}
        localeText={{
          noRowsLabel: t('common.noData'),
        }}
      />

      {/* Context menu for bulk actions */}
      {onBulkAction && (
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
          {/* Header */}
          <Box sx={{ px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Typography variant="subtitle2" fontWeight={600}>
              {contextMenu?.node.name}
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.6 }}>
              {contextMenu?.node.vms ?? 0} VMs
            </Typography>
          </Box>

          <MenuItem onClick={() => handleBulkAction('start-all')}>
            <ListItemIcon>
              <PlayArrowIcon fontSize="small" sx={{ color: 'success.main' }} />
            </ListItemIcon>
            <ListItemText>{t('bulkActions.startAllVms')}</ListItemText>
          </MenuItem>

          <MenuItem onClick={() => handleBulkAction('shutdown-all')}>
            <ListItemIcon>
              <PowerSettingsNewIcon fontSize="small" sx={{ color: 'warning.main' }} />
            </ListItemIcon>
            <ListItemText>{t('bulkActions.shutdownAllVms')}</ListItemText>
          </MenuItem>

          <MenuItem onClick={() => handleBulkAction('stop-all')}>
            <ListItemIcon>
              <StopIcon fontSize="small" sx={{ color: 'error.main' }} />
            </ListItemIcon>
            <ListItemText>{t('bulkActions.stopAllVms')}</ListItemText>
          </MenuItem>

          {showMigrateOption && (
            <>
              <Divider />
              <MenuItem onClick={() => handleBulkAction('migrate-all')}>
                <ListItemIcon>
                  <MoveUpIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t('bulkActions.migrateAllVms')}</ListItemText>
              </MenuItem>
            </>
          )}
        </Menu>
      )}
    </Box>
  )
}
