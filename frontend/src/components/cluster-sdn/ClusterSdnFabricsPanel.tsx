'use client'

import { useCallback, useEffect, useState } from 'react'

import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import { useTranslations } from 'next-intl'

import type { SdnFabric, SdnFabricsResponse } from './types'

interface Props {
  connId: string
}

export default function ClusterSdnFabricsPanel({ connId }: Props) {
  const t = useTranslations()
  const [state, setState] = useState<SdnFabricsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchFabrics = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/connections/${connId}/sdn/fabrics`, { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
      setState(body.data ?? {})
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [connId])

  useEffect(() => {
    void fetchFabrics()
  }, [fetchFabrics])

  if (loading) {
    return <Box sx={{ p: 4, display: 'flex', justifyContent: 'center' }}><CircularProgress /></Box>
  }

  if (state?.unavailable) {
    return (
      <Box sx={{ p: 4, display: 'flex', justifyContent: 'center' }}>
        <Alert severity="info" sx={{ maxWidth: 560 }}>
          <AlertTitle>{t('sdn.fabricsPanel.unavailable.title')}</AlertTitle>
          {t('sdn.fabricsPanel.unavailable.body')}
        </Alert>
      </Box>
    )
  }

  const fabrics = state?.fabrics ?? []

  const columns: GridColDef<SdnFabric>[] = [
    { field: 'fabric', headerName: t('sdn.fabricsPanel.columns.name'), flex: 1, minWidth: 140 },
    { field: 'protocol', headerName: t('sdn.fabricsPanel.columns.protocol'), width: 140 },
    { field: 'ipv4', headerName: t('sdn.fabricsPanel.columns.ipv4'), flex: 1, minWidth: 140, valueGetter: (v) => v ?? '—' },
    { field: 'ipv6', headerName: t('sdn.fabricsPanel.columns.ipv6'), flex: 1, minWidth: 140, valueGetter: (v) => v ?? '—' },
    { field: 'interfaces', headerName: t('sdn.fabricsPanel.columns.interfaces'), flex: 1, minWidth: 180, valueGetter: (v) => v ?? '—' },
  ]

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h6">{t('sdn.fabricsPanel.title')}</Typography>
        <Button
          variant="outlined"
          size="small"
          onClick={fetchFabrics}
          disabled={loading}
          startIcon={loading ? <CircularProgress size={14} /> : <i className="ri-refresh-line" />}
        >
          {t('sdn.common.reload')}
        </Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{t('sdn.common.loadFailed', { error })}</Alert>}

      <Box sx={{ flex: 1, minHeight: 300 }}>
        <DataGrid
          rows={fabrics}
          columns={columns}
          getRowId={(row) => row.fabric}
          pageSizeOptions={[10, 25, 50]}
          initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
          slots={{
            noRowsOverlay: () => (
              <Stack alignItems="center" justifyContent="center" sx={{ height: '100%' }}>
                <Typography color="text.secondary">{t('sdn.fabricsPanel.empty')}</Typography>
              </Stack>
            ),
          }}
        />
      </Box>
    </Box>
  )
}
