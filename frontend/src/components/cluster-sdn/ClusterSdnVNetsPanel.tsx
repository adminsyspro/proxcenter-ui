'use client'

import { useCallback, useEffect, useState } from 'react'

import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import { useTranslations } from 'next-intl'

import type { SdnVNet } from './types'

interface Props {
  connId: string
}

export default function ClusterSdnVNetsPanel({ connId }: Props) {
  const t = useTranslations()
  const [vnets, setVNets] = useState<SdnVNet[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchVNets = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/connections/${connId}/sdn/vnets`, { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
      setVNets(body.data?.vnets ?? [])
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [connId])

  useEffect(() => {
    void fetchVNets()
  }, [fetchVNets])

  const columns: GridColDef<SdnVNet>[] = [
    { field: 'vnet', headerName: t('sdn.vnets.columns.id'), flex: 1, minWidth: 140 },
    { field: 'alias', headerName: t('sdn.vnets.columns.alias'), flex: 1, minWidth: 140, valueGetter: (v) => v ?? '—' },
    { field: 'zone', headerName: t('sdn.vnets.columns.zone'), width: 140 },
    { field: 'tag', headerName: t('sdn.vnets.columns.tag'), width: 100, valueGetter: (v) => v ?? '—' },
    { field: 'vlanaware', headerName: t('sdn.vnets.columns.vlanAware'), width: 120, valueGetter: (v) => v ? '✓' : '—' },
    { field: 'state', headerName: t('sdn.vnets.columns.state'), width: 120, valueGetter: (v) => v ?? '—' },
  ]

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h6">{t('sdn.vnets.title')}</Typography>
        <Button
          variant="outlined"
          size="small"
          onClick={fetchVNets}
          disabled={loading}
          startIcon={loading ? <CircularProgress size={14} /> : <i className="ri-refresh-line" />}
        >
          {t('sdn.common.reload')}
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>{t('sdn.common.loadFailed', { error })}</Alert>
      )}

      <Box sx={{ flex: 1, minHeight: 300 }}>
        <DataGrid
          rows={vnets}
          columns={columns}
          getRowId={(row) => row.vnet}
          loading={loading}
          pageSizeOptions={[10, 25, 50]}
          initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
          slots={{
            noRowsOverlay: () => (
              <Stack alignItems="center" justifyContent="center" sx={{ height: '100%' }}>
                <Typography color="text.secondary">{t('sdn.vnets.empty')}</Typography>
              </Stack>
            ),
          }}
        />
      </Box>
    </Box>
  )
}
