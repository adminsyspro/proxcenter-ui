'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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

import { useToast } from '@/contexts/ToastContext'
import EmptyState from '@/components/EmptyState'
import CreateBlueprintDialog from './CreateBlueprintDialog'

interface Blueprint {
  id: string
  name: string
  description: string | null
  imageSlug: string
  hardware: string
  cloudInit: string | null
  tags: string | null
  isPublic: boolean
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

interface BlueprintsTabProps {
  onDeploy: (blueprint: Blueprint) => void
}

export default function BlueprintsTab({ onDeploy }: BlueprintsTabProps) {
  const t = useTranslations()
  const { showToast } = useToast()
  const [blueprints, setBlueprints] = useState<Blueprint[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingBlueprint, setEditingBlueprint] = useState<Blueprint | null>(null)

  const fetchBlueprints = useCallback(() => {
    setLoading(true)
    fetch('/api/v1/templates/blueprints')
      .then(r => r.json())
      .then(res => {
        setBlueprints(res.data || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { fetchBlueprints() }, [fetchBlueprints])

  const handleDelete = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/v1/templates/blueprints/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      showToast(t('templates.blueprints.deleted'), 'success')
      fetchBlueprints()
    } catch {
      showToast(t('errors.generic'), 'error')
    }
  }, [fetchBlueprints, showToast, t])

  const handleEdit = useCallback((bp: Blueprint) => {
    setEditingBlueprint(bp)
    setDialogOpen(true)
  }, [])

  const handleCreate = useCallback(() => {
    setEditingBlueprint(null)
    setDialogOpen(true)
  }, [])

  const handleDialogClose = useCallback((saved?: boolean) => {
    setDialogOpen(false)
    setEditingBlueprint(null)
    if (saved) fetchBlueprints()
  }, [fetchBlueprints])

  const columns: GridColDef[] = useMemo(() => [
    {
      field: 'name',
      headerName: t('common.name'),
      flex: 1,
      minWidth: 180,
      renderCell: (p) => (
        <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', py: 0.5 }}>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>{p.value}</Typography>
          {p.row.description && (
            <Typography variant="caption" sx={{ opacity: 0.6 }} noWrap>
              {p.row.description}
            </Typography>
          )}
        </Box>
      ),
    },
    {
      field: 'imageSlug',
      headerName: t('templates.blueprints.image'),
      width: 160,
      renderCell: (p) => (
        <Chip label={p.value} size="small" variant="outlined" sx={{ height: 22, fontSize: '0.7rem' }} />
      ),
    },
    {
      field: 'hardware',
      headerName: t('templates.deploy.hardware.title'),
      width: 200,
      renderCell: (p) => {
        try {
          const hw = JSON.parse(p.value)
          return (
            <Typography variant="caption" sx={{ opacity: 0.7 }}>
              {hw.cores}C / {hw.memory >= 1024 ? `${hw.memory / 1024}GB` : `${hw.memory}MB`} / {hw.diskSize}
            </Typography>
          )
        } catch {
          return <Typography variant="caption">—</Typography>
        }
      },
    },
    {
      field: 'tags',
      headerName: t('common.tags'),
      width: 160,
      renderCell: (p) => {
        if (!p.value) return null
        return (
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {String(p.value).split(';').filter(Boolean).map(tag => (
              <Chip key={tag} label={tag} size="small" sx={{ height: 18, fontSize: '0.6rem' }} />
            ))}
          </Box>
        )
      },
    },
    {
      field: 'createdAt',
      headerName: t('common.created'),
      width: 140,
      renderCell: (p) => (
        <Typography variant="caption" sx={{ opacity: 0.7 }}>
          {new Date(p.value).toLocaleDateString()}
        </Typography>
      ),
    },
    {
      field: 'actions',
      headerName: t('common.actions'),
      width: 140,
      sortable: false,
      renderCell: (p) => (
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <Tooltip title={t('templates.catalog.deploy')}>
            <IconButton size="small" color="primary" onClick={() => onDeploy(p.row)}>
              <i className="ri-rocket-2-line" style={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('common.edit')}>
            <IconButton size="small" onClick={() => handleEdit(p.row)}>
              <i className="ri-edit-line" style={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('common.delete')}>
            <IconButton size="small" color="error" onClick={() => handleDelete(p.row.id)}>
              <i className="ri-delete-bin-line" style={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        </Box>
      ),
    },
  ], [t, onDeploy, handleEdit, handleDelete])

  if (!loading && blueprints.length === 0) {
    return (
      <Box sx={{ p: 2 }}>
        <EmptyState
          icon="ri-draft-line"
          title={t('templates.blueprints.noBlueprints')}
          description={t('templates.blueprints.noBlueprintsDesc')}
          action={{ label: t('templates.blueprints.create'), onClick: handleCreate, icon: 'ri-add-line' }}
          size="medium"
        />
        <CreateBlueprintDialog
          open={dialogOpen}
          onClose={handleDialogClose}
          blueprint={editingBlueprint}
        />
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: 2, height: '100%' }}>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          variant="contained"
          size="small"
          startIcon={<i className="ri-add-line" style={{ fontSize: 16 }} />}
          onClick={handleCreate}
        >
          {t('templates.blueprints.create')}
        </Button>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0 }}>
        <DataGrid
          rows={blueprints}
          columns={columns}
          loading={loading}
          density="compact"
          getRowHeight={() => 'auto'}
          pageSizeOptions={[25, 50]}
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

      <CreateBlueprintDialog
        open={dialogOpen}
        onClose={handleDialogClose}
        blueprint={editingBlueprint}
      />
    </Box>
  )
}
