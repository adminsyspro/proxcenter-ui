'use client'

import React, { useMemo, useState, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
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
  Skeleton,
  Stack,
  Typography,
  useTheme
} from '@mui/material'
import { DataGrid, GridColDef } from '@mui/x-data-grid'
import { AreaChart, Area, XAxis, YAxis, Tooltip as RTooltip } from 'recharts'
import ChartContainer from '@/components/ChartContainer'
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

  if (d > 0) return `${d}d ${h}h`
  const m = Math.floor((sec % 3600) / 60)

  if (h > 0) return `${h}h ${m}m`
  
return `${m}m`
}

/* -----------------------------
  Sub-components
------------------------------ */

const ProxmoxIcon = ({ size = 16, isDark = false }: { size?: number; isDark?: boolean }) => (
  <img src={isDark ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={size} height={size} style={{ opacity: 0.8 }} />
)

const StatusChip = ({ status }: { status: string }) => {
  if (status === 'online') return <Chip size='small' color='success' label='UP' sx={{ height: 20, fontSize: '0.7rem' }} />
  if (status === 'maintenance') return <i className="ri-tools-fill" style={{ fontSize: 16, color: '#ff9800' }} />

return <Chip size='small' color='error' label='DOWN' sx={{ height: 20, fontSize: '0.7rem' }} />
}

const MetricBar = ({ value, label }: { value: number; label?: string }) => (
  <Box sx={{ width: '100%', position: 'relative', display: 'flex', alignItems: 'center' }}>
    <Box sx={{ width: '100%', position: 'relative' }}>
      <LinearProgress
        variant='determinate'
        value={pct(value)}
        sx={{
          height: 14, borderRadius: 0,
          bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.12)',
          '& .MuiLinearProgress-bar': {
            borderRadius: 0,
            background: 'linear-gradient(90deg, #22c55e 0%, #eab308 50%, #ef4444 100%)',
            backgroundSize: value > 0 ? `${(100 / value) * 100}% 100%` : '100% 100%',
          }
        }}
      />
      <Typography variant='caption' sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', fontWeight: 700, color: '#fff', lineHeight: 1, textShadow: '0 0 2px rgba(0,0,0,0.5)' }}>
        {Math.round(value)}%
      </Typography>
    </Box>
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
  subscription?: string
  trend?: { t: number; cpu?: number; ram?: number; netin?: number; netout?: number; diskread?: number; diskwrite?: number }[]
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
  showTrends?: boolean
}

/* -----------------------------
  Trend Tooltips
------------------------------ */

function formatRate(bytes: number) {
  if (bytes <= 0) return '0 B/s'
  if (bytes < 1024) return `${bytes.toFixed(0)} B/s`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB/s`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MiB/s`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GiB/s`
}

function formatTrendTime(label: any) {
  const ts = Number(label)
  if (!ts || isNaN(ts)) return String(label || '')
  // Timestamps from RRD are in seconds if < 1e12, milliseconds otherwise
  const ms = ts < 1e12 ? ts * 1000 : ts
  return new Date(ms).toLocaleTimeString()
}

function NodeTrendTooltip({ active, payload, label }: any) {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  useEffect(() => {
    const h = (e: MouseEvent) => setMousePos({ x: e.clientX, y: e.clientY })
    window.addEventListener('mousemove', h)
    return () => window.removeEventListener('mousemove', h)
  }, [])
  if (!active || !payload?.length || typeof window === 'undefined') return null
  const cpu = payload.find((p: any) => p.dataKey === 'cpu')?.value
  const ram = payload.find((p: any) => p.dataKey === 'ram')?.value
  return createPortal(
    <div style={{ position: 'fixed', left: mousePos.x + 15, top: mousePos.y - 70, background: '#1a1a2e', border: '1px solid #444', color: 'white', padding: '8px 12px', borderRadius: 6, fontSize: 11, lineHeight: 1.5, boxShadow: '0 4px 20px rgba(0,0,0,0.5)', zIndex: 99999, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
      <div style={{ opacity: 0.7, marginBottom: 4, fontWeight: 600, borderBottom: '1px solid #444', paddingBottom: 4 }}>{formatTrendTime(label)}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        <span style={{ width: 10, height: 3, borderRadius: 2, backgroundColor: '#e57000', display: 'inline-block' }} />
        <span>CPU: <b>{typeof cpu === 'number' ? cpu.toFixed(1) : '—'}%</b></span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 10, height: 3, borderRadius: 2, backgroundColor: '#b35500', display: 'inline-block' }} />
        <span>RAM: <b>{typeof ram === 'number' ? ram.toFixed(0) : '—'}%</b></span>
      </div>
    </div>,
    document.body
  )
}

function NodeIoNetTooltip({ active, payload, label }: any) {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  useEffect(() => {
    const h = (e: MouseEvent) => setMousePos({ x: e.clientX, y: e.clientY })
    window.addEventListener('mousemove', h)
    return () => window.removeEventListener('mousemove', h)
  }, [])
  if (!active || !payload?.length || typeof window === 'undefined') return null
  const diskread = payload.find((p: any) => p.dataKey === 'diskread')?.value
  const diskwrite = payload.find((p: any) => p.dataKey === 'diskwrite')?.value
  const netin = payload.find((p: any) => p.dataKey === 'netin')?.value
  const netout = payload.find((p: any) => p.dataKey === 'netout')?.value
  return createPortal(
    <div style={{ position: 'fixed', left: mousePos.x + 15, top: mousePos.y - 90, background: '#1a1a2e', border: '1px solid #444', color: 'white', padding: '8px 12px', borderRadius: 6, fontSize: 11, lineHeight: 1.5, boxShadow: '0 4px 20px rgba(0,0,0,0.5)', zIndex: 99999, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
      <div style={{ opacity: 0.7, marginBottom: 4, fontWeight: 600, borderBottom: '1px solid #444', paddingBottom: 4 }}>{formatTrendTime(label)}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        <span style={{ width: 10, height: 3, borderRadius: 2, backgroundColor: '#2196f3', display: 'inline-block' }} />
        <span>Disk R: <b>{typeof diskread === 'number' ? formatRate(diskread) : '—'}</b></span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        <span style={{ width: 10, height: 3, borderRadius: 2, backgroundColor: '#1565c0', display: 'inline-block' }} />
        <span>Disk W: <b>{typeof diskwrite === 'number' ? formatRate(diskwrite) : '—'}</b></span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        <span style={{ width: 10, height: 3, borderRadius: 2, backgroundColor: '#4caf50', display: 'inline-block' }} />
        <span>Net In: <b>{typeof netin === 'number' ? formatRate(netin) : '—'}</b></span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 10, height: 3, borderRadius: 2, backgroundColor: '#2e7d32', display: 'inline-block' }} />
        <span>Net Out: <b>{typeof netout === 'number' ? formatRate(netout) : '—'}</b></span>
      </div>
    </div>,
    document.body
  )
}

/* -----------------------------
  Component
------------------------------ */

function NodesTable({
  nodes,
  loading = false,
  onNodeClick,
  onBulkAction,
  compact = false,
  maxHeight = 400,
  showMigrateOption = true,
  showTrends = false,
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
            <Box sx={{ position: 'relative', display: 'inline-flex', width: 18, height: 18, flexShrink: 0 }}>
              <ProxmoxIcon size={18} isDark={theme.palette.mode === 'dark'} />
              <Box sx={{ position: 'absolute', bottom: -2, right: -2, width: 8, height: 8, borderRadius: '50%', bgcolor: params.row.status === 'online' ? '#4caf50' : '#f44336', border: '1.5px solid', borderColor: 'background.paper' }} />
            </Box>
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
      {
        field: 'subscription',
        headerName: t('inventory.support'),
        width: 110,
        renderCell: (params) => {
          const sub = (params.row.subscription || '').toLowerCase()
          const label = sub === 'active' ? 'Active' : (sub === 'notfound' || sub === 'unknown' || sub === '') ? 'Community' : sub
          const color = sub === 'active' ? 'success' : 'default'
          return <Chip size="small" label={label} color={color as any} sx={{ height: 20, fontSize: 10 }} />
        }
      },
    ]

    if (showTrends) {
      // Trend CPU/RAM
      cols.push({
        field: 'trend',
        headerName: 'Trend (CPU/RAM)',
        flex: 0.8,
        minWidth: 120,
        sortable: false,
        renderCell: (params) => {
          const node = params.row as NodeRow
          const data = node.trend || []
          if (node.status !== 'online' || data.length === 0) {
            return <Typography variant='caption' sx={{ opacity: 0.4 }}>—</Typography>
          }
          const cpuColor = '#e57000'
          const ramColor = '#b35500'
          const allValues = data.flatMap(d => [d.cpu || 0, d.ram || 0])
          const yMax = Math.min(100, Math.max(...allValues, 10) + 10)
          return (
            <ChartContainer height={32}>
              <AreaChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                <defs>
                  <linearGradient id={`ncpu-${node.id}`} x1='0' y1='0' x2='0' y2='1'>
                    <stop offset='0%' stopColor={cpuColor} stopOpacity={0.25} />
                    <stop offset='100%' stopColor={cpuColor} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <XAxis dataKey='t' hide />
                <YAxis hide domain={[0, yMax]} />
                <RTooltip content={<NodeTrendTooltip />} cursor={{ stroke: cpuColor, strokeWidth: 1, strokeDasharray: '3 3' }} />
                <Area type='monotone' dataKey='cpu' stroke={cpuColor} strokeWidth={1.5} fill={`url(#ncpu-${node.id})`} dot={false} isAnimationActive={false} />
                <Area type='monotone' dataKey='ram' stroke={ramColor} strokeWidth={1.5} fill='transparent' dot={false} isAnimationActive={false} />
              </AreaChart>
            </ChartContainer>
          )
        }
      })

      // Trend IO/Net
      cols.push({
        field: 'trendIoNet',
        headerName: 'Trend (IO/Net)',
        flex: 0.8,
        minWidth: 120,
        sortable: false,
        renderCell: (params) => {
          const node = params.row as NodeRow
          const data = node.trend || []
          if (node.status !== 'online' || data.length === 0) {
            return <Typography variant='caption' sx={{ opacity: 0.4 }}>—</Typography>
          }
          const hasData = data.some(d => (d.diskread || 0) > 0 || (d.diskwrite || 0) > 0 || (d.netin || 0) > 0 || (d.netout || 0) > 0)
          if (!hasData) {
            return <Typography variant='caption' sx={{ opacity: 0.4 }}>—</Typography>
          }
          const diskColor = '#2196f3'
          const netColor = '#4caf50'
          return (
            <ChartContainer height={32}>
              <AreaChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                <defs>
                  <linearGradient id={`ndisk-${node.id}`} x1='0' y1='0' x2='0' y2='1'>
                    <stop offset='0%' stopColor={diskColor} stopOpacity={0.2} />
                    <stop offset='100%' stopColor={diskColor} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <XAxis dataKey='t' hide />
                <YAxis hide />
                <RTooltip content={<NodeIoNetTooltip />} cursor={{ stroke: diskColor, strokeWidth: 1, strokeDasharray: '3 3' }} />
                <Area type='monotone' dataKey='diskread' stroke={diskColor} strokeWidth={1.5} fill={`url(#ndisk-${node.id})`} dot={false} isAnimationActive={false} />
                <Area type='monotone' dataKey='diskwrite' stroke='#1565c0' strokeWidth={1.5} fill='transparent' dot={false} isAnimationActive={false} />
                <Area type='monotone' dataKey='netin' stroke={netColor} strokeWidth={1.5} fill='transparent' dot={false} isAnimationActive={false} />
                <Area type='monotone' dataKey='netout' stroke='#2e7d32' strokeWidth={1.5} fill='transparent' dot={false} isAnimationActive={false} />
              </AreaChart>
            </ChartContainer>
          )
        }
      })
    }

    return cols
  }, [compact, theme.palette.mode, showTrends])

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
            display: 'flex',
            alignItems: 'center',
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

          {showMigrateOption && <Divider />}
          {showMigrateOption && (
            <MenuItem onClick={() => handleBulkAction('migrate-all')}>
              <ListItemIcon>
                <MoveUpIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>{t('bulkActions.migrateAllVms')}</ListItemText>
            </MenuItem>
          )}
        </Menu>
      )}
    </Box>
  )
}

export default React.memo(NodesTable)
