'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Box, Chip, IconButton, Tooltip, Typography } from '@mui/material'
import { DataGrid, GridColDef } from '@mui/x-data-grid'

import { useToast } from '@/contexts/ToastContext'
import EmptyState from '@/components/EmptyState'

interface Deployment {
  id: string
  blueprintId: string | null
  blueprintName: string | null
  connectionId: string
  node: string
  vmid: number
  vmName: string | null
  imageSlug: string | null
  status: string
  currentStep: string | null
  error: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
}

const STATUS_COLORS: Record<string, 'success' | 'error' | 'warning' | 'info' | 'default'> = {
  completed: 'success',
  failed: 'error',
  pending: 'default',
  downloading: 'info',
  creating: 'info',
  configuring: 'info',
  starting: 'warning',
}

interface DeploymentsTabProps {
  onRetry?: (deployment: Deployment) => void
}

export default function DeploymentsTab({ onRetry }: DeploymentsTabProps) {
  const t = useTranslations()
  const { showToast } = useToast()
  const [deployments, setDeployments] = useState<Deployment[]>([])
  const [loading, setLoading] = useState(true)

  const fetchDeployments = useCallback(() => {
    fetch('/api/v1/templates/deployments')
      .then(r => r.json())
      .then(res => {
        setDeployments(res.data || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { fetchDeployments() }, [fetchDeployments])

  // Auto-refresh if there are active deployments
  useEffect(() => {
    const hasActive = deployments.some(d =>
      !['completed', 'failed'].includes(d.status)
    )
    if (!hasActive) return

    const interval = setInterval(fetchDeployments, 5000)
    return () => clearInterval(interval)
  }, [deployments, fetchDeployments])

  const handleDelete = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/v1/templates/deployments/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      fetchDeployments()
    } catch {
      showToast(t('errors.generic'), 'error')
    }
  }, [fetchDeployments, showToast, t])

  const columns: GridColDef[] = useMemo(() => [
    {
      field: 'vmName',
      headerName: t('templates.deployments.vm'),
      flex: 1,
      minWidth: 150,
      renderCell: (p) => (
        <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', py: 0.5 }}>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            {p.value || `VM ${p.row.vmid}`}
          </Typography>
          <Typography variant="caption" sx={{ opacity: 0.6 }}>
            VMID: {p.row.vmid}
          </Typography>
        </Box>
      ),
    },
    {
      field: 'imageSlug',
      headerName: t('templates.deployments.image'),
      width: 140,
      renderCell: (p) =>
        p.value ? (
          <Chip label={p.value} size="small" variant="outlined" sx={{ height: 22, fontSize: '0.7rem' }} />
        ) : (
          <Typography variant="caption" sx={{ opacity: 0.5 }}>—</Typography>
        ),
    },
    {
      field: 'node',
      headerName: t('templates.deploy.target.node'),
      width: 120,
    },
    {
      field: 'status',
      headerName: t('common.status'),
      width: 130,
      renderCell: (p) => (
        <Chip
          label={t(`templates.deployments.status.${p.value}` as any) || p.value}
          size="small"
          color={STATUS_COLORS[p.value] || 'default'}
          sx={{ height: 22, fontSize: '0.65rem' }}
        />
      ),
    },
    {
      field: 'error',
      headerName: t('templates.deployments.error'),
      flex: 1,
      minWidth: 200,
      renderCell: (p) =>
        p.value ? (
          <Typography variant="caption" color="error" sx={{ whiteSpace: 'normal', lineHeight: 1.3 }}>
            {p.value}
          </Typography>
        ) : null,
    },
    {
      field: 'startedAt',
      headerName: t('templates.deployments.started'),
      width: 160,
      renderCell: (p) => (
        <Typography variant="caption" sx={{ opacity: 0.7 }}>
          {p.value ? new Date(p.value).toLocaleString() : '—'}
        </Typography>
      ),
    },
    {
      field: 'actions',
      headerName: t('common.actions'),
      width: 100,
      sortable: false,
      renderCell: (p) => (
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          {p.row.status === 'failed' && onRetry && (
            <Tooltip title={t('templates.deployments.retry')}>
              <IconButton size="small" color="primary" onClick={() => onRetry(p.row)}>
                <i className="ri-restart-line" style={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          )}
          {['failed', 'completed'].includes(p.row.status) && (
            <Tooltip title={t('common.delete')}>
              <IconButton size="small" color="error" onClick={() => handleDelete(p.row.id)}>
                <i className="ri-delete-bin-line" style={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      ),
    },
  ], [t, onRetry, handleDelete])

  if (!loading && deployments.length === 0) {
    return (
      <Box sx={{ p: 2 }}>
        <EmptyState
          icon="ri-rocket-2-line"
          title={t('templates.deployments.noDeployments')}
          description={t('templates.deployments.noDeploymentsDesc')}
          size="medium"
        />
      </Box>
    )
  }

  return (
    <Box sx={{ flex: 1, minHeight: 0, p: 2 }}>
      <DataGrid
        rows={deployments}
        columns={columns}
        loading={loading}
        density="compact"
        getRowHeight={() => 'auto'}
        pageSizeOptions={[25, 50, 100]}
        initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
        disableRowSelectionOnClick
        disableColumnMenu
        sx={{
          border: 'none',
          '& .MuiDataGrid-cell': { display: 'flex', alignItems: 'center', py: 0.5 },
          '& .MuiDataGrid-columnHeaders': {
            borderBottom: '1px solid',
            borderColor: 'divider',
            bgcolor: 'action.hover',
          },
          '& .MuiDataGrid-footerContainer': {
            borderTop: '1px solid',
            borderColor: 'divider',
          },
        }}
        localeText={{ noRowsLabel: t('common.noData') }}
      />
    </Box>
  )
}
