'use client'

import { useTranslations } from 'next-intl'

import {
  Box,
  Button,
  Chip,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material'
import { DataGrid, GridColDef } from '@mui/x-data-grid'

import { formatBytes } from '@/utils/format'

interface Report {
  id: string
  type: string
  name: string
  status: 'pending' | 'generating' | 'completed' | 'failed'
  file_path?: string
  file_size?: number
  date_from: string
  date_to: string
  connection_ids?: string[]
  sections?: string[]
  schedule_id?: string
  generated_by: string
  error?: string
  created_at: string
  completed_at?: string
}

interface ReportHistoryProps {
  reports: Report[]
  onDelete: (id: string) => Promise<void>
  onRefresh: () => void
  loading: boolean
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString()
}

export default function ReportHistory({ reports, onDelete, onRefresh, loading }: ReportHistoryProps) {
  const t = useTranslations()

  const handleDownload = (reportId: string) => {
    window.open(`/api/v1/orchestrator/reports/${reportId}/download`, '_blank')
  }

  const getStatusChip = (status: string) => {
    const config: Record<string, { color: 'default' | 'primary' | 'success' | 'error'; label: string }> = {
      pending: { color: 'default', label: t('reports.pending') },
      generating: { color: 'primary', label: t('reports.generating') },
      completed: { color: 'success', label: t('reports.completed') },
      failed: { color: 'error', label: t('reports.failed') },
    }

    const cfg = config[status] || config.pending

    return <Chip size="small" color={cfg.color} label={cfg.label} />
  }

  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      infrastructure: t('reports.types.infrastructure'),
      alerts: t('reports.types.alerts'),
      utilization: t('reports.types.utilization'),
      inventory: t('reports.types.inventory'),
      capacity: t('reports.types.capacity'),
    }

    return labels[type] || type
  }

  const columns: GridColDef[] = [
    {
      field: 'name',
      headerName: t('common.name'),
      flex: 1,
      minWidth: 200,
      renderCell: (params) => (
        <Box sx={{ display: 'flex', flexDirection: 'column', py: 0.5 }}>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            {params.value}
          </Typography>
          <Typography variant="caption" sx={{ opacity: 0.6 }}>
            {getTypeLabel(params.row.type)}
          </Typography>
        </Box>
      ),
    },
    {
      field: 'status',
      headerName: t('common.status'),
      width: 120,
      renderCell: (params) => getStatusChip(params.value),
    },
    {
      field: 'file_size',
      headerName: t('common.size'),
      width: 100,
      renderCell: (params) => params.value ? formatBytes(params.value) : '-',
    },
    {
      field: 'date_from',
      headerName: t('reports.dateRange'),
      width: 180,
      renderCell: (params) => (
        <Typography variant="caption">
          {new Date(params.row.date_from).toLocaleDateString()} - {new Date(params.row.date_to).toLocaleDateString()}
        </Typography>
      ),
    },
    {
      field: 'generated_by',
      headerName: t('common.create') + 'd by',
      width: 120,
    },
    {
      field: 'created_at',
      headerName: t('common.date'),
      width: 160,
      renderCell: (params) => formatDate(params.value),
    },
    {
      field: 'actions',
      headerName: t('common.actions'),
      width: 120,
      sortable: false,
      renderCell: (params) => (
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          {params.row.status === 'completed' && (
            <Tooltip title={t('reports.download')}>
              <IconButton size="small" color="primary" onClick={() => handleDownload(params.row.id)}>
                <i className="ri-download-2-line" />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title={t('common.delete')}>
            <IconButton size="small" color="error" onClick={() => onDelete(params.row.id)}>
              <i className="ri-delete-bin-line" />
            </IconButton>
          </Tooltip>
        </Box>
      ),
    },
  ]

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, p: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6">{t('reports.history')}</Typography>
        <Button
          size="small"
          startIcon={<i className="ri-refresh-line" />}
          onClick={onRefresh}
          disabled={loading}
        >
          {t('common.refresh')}
        </Button>
      </Box>

      {reports.length === 0 ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, opacity: 0.6 }}>
          <i className="ri-file-list-3-line" style={{ fontSize: 48, marginBottom: 16 }} />
          <Typography>{t('reports.noReports')}</Typography>
        </Box>
      ) : (
        <Box sx={{ flex: 1, minHeight: 0 }}>
          <DataGrid
            rows={reports}
            columns={columns}
            loading={loading}
            density="compact"
            pageSizeOptions={[25, 50, 100]}
            initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
            sx={{
              border: 'none',
              '& .MuiDataGrid-cell': {
                display: 'flex',
                alignItems: 'center',
              },
              '& .MuiDataGrid-row': {
                minHeight: '52px !important',
              },
            }}
          />
        </Box>
      )}
    </Box>
  )
}
