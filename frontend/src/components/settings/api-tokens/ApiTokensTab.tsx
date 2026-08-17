'use client'

import { useCallback, useEffect, useState } from 'react'

import {
  Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent,
  DialogTitle, IconButton, LinearProgress, Stack, Tooltip, Typography,
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
  tenant: { name: string }
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
  // Frozen copy of the creator's email (TOKEN_VIEW_SELECT). Null on tokens
  // minted before the column existed, and on tokens created without a user
  // session -- the grid falls back to the "unknown" label for those.
  createdByEmail?: string | null
  createdAt: string
}

function ApiTokensPanel() {
  const t = useTranslations('settings.apiTokens')
  const [tokens, setTokens] = useState<ApiTokenView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [deletingToken, setDeletingToken] = useState<ApiTokenView | null>(null)

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

  async function confirmDelete() {
    if (!deletingToken) return
    try {
      const res = await fetch(`/api/v1/settings/api-tokens/${deletingToken.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setSuccess(t('deleteSuccess'))
      await load()
    } catch {
      setError(t('loadError'))
    } finally {
      setDeletingToken(null)
    }
  }

  const columns: GridColDef[] = [
    {
      field: 'tokenPrefix',
      headerName: t('columns.prefix'),
      width: 190,
      // Leading key icon marks every row's identity cell; the prefix text
      // itself stays plain, selectable text (no wrapper blocks selection).
      renderCell: params => (
        <Stack direction='row' alignItems='center' spacing={1}>
          <i className='ri-key-2-line' />
          <Typography variant='body2' sx={{ fontFamily: 'monospace' }}>{params.value}</Typography>
        </Stack>
      ),
    },
    { field: 'name', headerName: t('columns.name'), flex: 1, minWidth: 160 },
    {
      field: 'tenant',
      headerName: t('columns.tenant'),
      flex: 1,
      minWidth: 140,
      // Human-readable tenant name, joined server-side (TOKEN_VIEW_SELECT) --
      // no monospace, this is a name, not an identifier.
      valueGetter: (_value, row: ApiTokenView) => row.tenant?.name ?? '',
    },
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
      field: 'createdByEmail',
      headerName: t('columns.createdBy'),
      flex: 1,
      minWidth: 200,
      // Offboarding (#632): without this the grid never says who minted a
      // credential, so an admin cannot tie a live token to a departing
      // person. Plain text like the tenant column -- an email is a name,
      // not an identifier, so no monospace.
      renderCell: params => (params.value ? (params.value as string) : t('unknownCreator')),
    },
    {
      field: 'actions',
      headerName: '',
      width: 170,
      sortable: false,
      renderCell: params => {
        const row = params.row as ApiTokenView

        // The action deletes the row outright, so nothing writes revokedAt any
        // more. The chip is kept for LEGACY rows: databases created before the
        // change still hold tokens that were soft-revoked, they are still
        // refused at authentication, and the grid has to keep saying so.
        //
        // The delete button shows for those rows TOO, and that is the point.
        // Rendering the chip *instead of* the button left a legacy revoked
        // token permanently stuck in the table with no way to remove it -- the
        // backend deletes it happily, only the UI refused to ask. A row the
        // operator cannot act on is worse than one that is merely dead.
        return (
          <Stack direction='row' spacing={1} sx={{ alignItems: 'center' }}>
            {row.revokedAt && <Chip label={t('revoked')} size='small' color='warning' variant='outlined' />}
            <Tooltip title={t('delete')} slotProps={tooltipSlotProps}>
              <IconButton size='small' aria-label={t('delete')} onClick={() => setDeletingToken(row)}>
                <i className='ri-delete-bin-line' />
              </IconButton>
            </Tooltip>
          </Stack>
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

      <Dialog open={!!deletingToken} onClose={() => setDeletingToken(null)}>
        <DialogTitle>{t('delete')}</DialogTitle>
        <DialogContent>
          <Typography variant='body2'>{t('deleteConfirm')}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeletingToken(null)}>{t('dialog.cancel')}</Button>
          <Button color='error' variant='contained' onClick={confirmDelete}>{t('dialog.confirm')}</Button>
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
