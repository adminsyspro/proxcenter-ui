'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'

import {
  Avatar,
  Box,
  Chip,
  LinearProgress,
  Stack,
  Typography,
  useTheme
} from '@mui/material'
import { DataGrid, GridColDef } from '@mui/x-data-grid'

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

type NodesTableProps = {
  nodes: NodeRow[]
  loading?: boolean
  onNodeClick?: (node: NodeRow) => void
  compact?: boolean
  maxHeight?: number | string
}

/* -----------------------------
  Component
------------------------------ */

export default function NodesTable({
  nodes,
  loading = false,
  onNodeClick,
  compact = false,
  maxHeight = 400
}: NodesTableProps) {
  const theme = useTheme()
  const t = useTranslations()

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

  return (
    <Box sx={{ width: '100%', height: isAutoHeight ? 'auto' : maxHeight }}>
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
    </Box>
  )
}
