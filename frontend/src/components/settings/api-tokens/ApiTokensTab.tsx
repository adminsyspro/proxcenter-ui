'use client'

import { useCallback, useEffect, useState } from 'react'

import {
  Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent,
  DialogTitle, IconButton, LinearProgress, Tooltip, Typography,
} from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import { useTranslations } from 'next-intl'

import CreateTokenDialog from './CreateTokenDialog'
import FeatureGuard from '@/components/guards/FeatureGuard'
import { tooltipSlotProps } from '@/components/settings/ha/tooltipSlotProps'
import { Features } from '@/lib/license/features'

type ApiTokenView = {
  id: string
  tenantId: string
  name: string
  description: string | null
  tokenPrefix: string
  scopes: string[]
  connectionIds: string[] | null
  expiresAt: string | null
  revokedAt: string | null
  lastUsedAt: string | null
  lastUsedIp: string | null
  rateLimitPerMin: number
  createdAt: string
}

function ApiTokensPanel() {
  const t = useTranslations('settings.apiTokens')
  const [tokens, setTokens] = useState<ApiTokenView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [revoking, setRevoking] = useState<ApiTokenView | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/v1/settings/api-tokens')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setTokens(Array.isArray(json?.data) ? json.data : [])
    } catch {
      setError(t('loadError'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    load()
  }, [load])

  async function confirmRevoke() {
    if (!revoking) return
    try {
      const res = await fetch(`/api/v1/settings/api-tokens/${revoking.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setSuccess(t('revokeSuccess'))
      await load()
    } catch {
      setError(t('loadError'))
    } finally {
      setRevoking(null)
    }
  }

  const columns: GridColDef[] = [
    {
      field: 'tokenPrefix',
      headerName: t('columns.prefix'),
      width: 160,
      renderCell: params => (
        <Typography variant='body2' sx={{ fontFamily: 'monospace' }}>{params.value}</Typography>
      ),
    },
    { field: 'name', headerName: t('columns.name'), flex: 1, minWidth: 160 },
    {
      field: 'scopes',
      headerName: t('columns.scopes'),
      flex: 1,
      minWidth: 200,
      sortable: false,
      renderCell: params => (
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
          {(params.value as string[]).map(scope => (
            <Chip key={scope} label={scope} size='small' />
          ))}
        </Box>
      ),
    },
    {
      field: 'expiresAt',
      headerName: t('columns.expires'),
      width: 150,
      renderCell: params => (params.value ? new Date(params.value as string).toLocaleDateString() : t('never')),
    },
    {
      field: 'lastUsedAt',
      headerName: t('columns.lastUsed'),
      width: 220,
      renderCell: params => {
        const row = params.row as ApiTokenView
        if (!row.lastUsedAt) return t('never')
        return `${new Date(row.lastUsedAt).toLocaleString()}${row.lastUsedIp ? ` (${row.lastUsedIp})` : ''}`
      },
    },
    {
      field: 'actions',
      headerName: '',
      width: 120,
      sortable: false,
      renderCell: params => {
        const row = params.row as ApiTokenView
        if (row.revokedAt) return <Chip label={t('revoked')} size='small' color='warning' variant='outlined' />
        return (
          <Tooltip title={t('revoke')} slotProps={tooltipSlotProps}>
            <IconButton size='small' aria-label={t('revoke')} onClick={() => setRevoking(row)}>
              <i className='ri-delete-bin-line' />
            </IconButton>
          </Tooltip>
        )
      },
    },
  ]

  return (
    <Box>
      {error && <Alert severity='error' sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity='success' sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Box>
              <Typography variant='h6'>{t('title')}</Typography>
              <Typography variant='body2' color='text.secondary'>{t('subtitle')}</Typography>
            </Box>
            <Button variant='contained' startIcon={<i className='ri-add-line' />} onClick={() => setCreateOpen(true)}>
              {t('newToken')}
            </Button>
          </Box>

          {loading ? (
            <LinearProgress />
          ) : (
            <DataGrid
              rows={tokens}
              columns={columns}
              autoHeight
              disableRowSelectionOnClick
              getRowId={row => row.id}
              pageSizeOptions={[10, 25]}
              initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
              sx={{ '& .MuiDataGrid-cell': { display: 'flex', alignItems: 'center' } }}
            />
          )}
        </CardContent>
      </Card>

      <CreateTokenDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={load} />

      <Dialog open={!!revoking} onClose={() => setRevoking(null)}>
        <DialogTitle>{t('revoke')}</DialogTitle>
        <DialogContent>
          <Typography variant='body2'>{t('revokeConfirm')}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRevoking(null)}>{t('dialog.cancel')}</Button>
          <Button color='error' variant='contained' onClick={confirmRevoke}>{t('dialog.confirm')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default function ApiTokensTab() {
  // The tab stays visible; only its body is gated (spec D6/D15, HaTab pattern).
  return (
    <FeatureGuard feature={Features.API_ACCESS} featureName='ProxCenter API Access'>
      <ApiTokensPanel />
    </FeatureGuard>
  )
}
