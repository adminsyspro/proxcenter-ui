'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Box, Chip, Typography } from '@mui/material'
import { DataGrid, GridColDef } from '@mui/x-data-grid'

import EmptyState from '@/components/EmptyState'

interface Deployment {
  id: string
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

export default function DeploymentsTab() {
  const t = useTranslations()
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
      field: 'completedAt',
      headerName: t('templates.deployments.completed'),
      width: 160,
      renderCell: (p) => (
        <Typography variant="caption" sx={{ opacity: 0.7 }}>
          {p.value ? new Date(p.value).toLocaleString() : '—'}
        </Typography>
      ),
    },
  ], [t])

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
