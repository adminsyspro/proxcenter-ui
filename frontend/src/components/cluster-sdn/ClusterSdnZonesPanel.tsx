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

import type { SdnZone } from './types'

interface Props {
  connId: string
}

export default function ClusterSdnZonesPanel({ connId }: Props) {
  const t = useTranslations()
  const [zones, setZones] = useState<SdnZone[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchZones = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/connections/${connId}/sdn/zones`, { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
      setZones(body.data?.zones ?? [])
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [connId])

  useEffect(() => {
    void fetchZones()
  }, [fetchZones])

  const columns: GridColDef<SdnZone>[] = [
    { field: 'zone', headerName: t('sdn.zones.columns.id'), flex: 1, minWidth: 140 },
    { field: 'type', headerName: t('sdn.zones.columns.type'), width: 110 },
    { field: 'nodes', headerName: t('sdn.zones.columns.nodes'), flex: 1, minWidth: 140, valueGetter: (v) => v ?? '—' },
    { field: 'mtu', headerName: t('sdn.zones.columns.mtu'), width: 90, valueGetter: (v) => v ?? '—' },
    { field: 'ipam', headerName: t('sdn.zones.columns.ipam'), width: 130, valueGetter: (v) => v ?? '—' },
  ]

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h6">{t('sdn.zones.title')}</Typography>
        <Button
          variant="outlined"
          size="small"
          onClick={fetchZones}
          disabled={loading}
          startIcon={loading ? <CircularProgress size={14} /> : <i className="ri-refresh-line" />}
        >
          {t('sdn.common.reload')}
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {t('sdn.common.loadFailed', { error })}
        </Alert>
      )}

      <Box sx={{ flex: 1, minHeight: 300 }}>
        <DataGrid
          rows={zones}
          columns={columns}
          getRowId={(row) => row.zone}
          loading={loading}
          autoHeight={false}
          pageSizeOptions={[10, 25, 50]}
          initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
          slots={{
            noRowsOverlay: () => (
              <Stack alignItems="center" justifyContent="center" sx={{ height: '100%' }}>
                <Typography color="text.secondary">{t('sdn.zones.empty')}</Typography>
              </Stack>
            ),
          }}
        />
      </Box>
    </Box>
  )
}
