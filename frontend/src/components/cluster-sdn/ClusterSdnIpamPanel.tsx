'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import { useTranslations } from 'next-intl'

import type { SdnIpam, SdnIpamAllocation } from './types'

interface Props {
  connId: string
}

export default function ClusterSdnIpamPanel({ connId }: Props) {
  const t = useTranslations()
  const [backends, setBackends] = useState<SdnIpam[]>([])
  const [selected, setSelected] = useState<string>('')
  const [allocations, setAllocations] = useState<SdnIpamAllocation[]>([])
  const [loadingBackends, setLoadingBackends] = useState(true)
  const [loadingAllocs, setLoadingAllocs] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load IPAM backends list once on mount.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoadingBackends(true)
      setError(null)
      try {
        const res = await fetch(`/api/v1/connections/${connId}/sdn/ipams`, { cache: 'no-store' })
        const body = await res.json()
        if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
        if (cancelled) return
        const list: SdnIpam[] = body.data?.ipams ?? []
        setBackends(list)
        if (list.length > 0) setSelected(list[0].ipam)
      } catch (e: any) {
        if (!cancelled) setError(e?.message || String(e))
      } finally {
        if (!cancelled) setLoadingBackends(false)
      }
    })()
    return () => { cancelled = true }
  }, [connId])

  const fetchAllocations = useCallback(async (ipam: string) => {
    if (!ipam) return
    setLoadingAllocs(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/v1/connections/${connId}/sdn/ipams/${encodeURIComponent(ipam)}/status`,
        { cache: 'no-store' },
      )
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
      setAllocations(body.data?.allocations ?? [])
    } catch (e: any) {
      setError(e?.message || String(e))
      setAllocations([])
    } finally {
      setLoadingAllocs(false)
    }
  }, [connId])

  useEffect(() => {
    if (selected) void fetchAllocations(selected)
  }, [selected, fetchAllocations])

  const columns: GridColDef<SdnIpamAllocation>[] = useMemo(() => [
    {
      field: 'name',
      headerName: t('sdn.ipamPanel.columns.name'),
      flex: 1,
      minWidth: 180,
      valueGetter: (_v, row) => row.hostname || (row.vmid ? String(row.vmid) : '—'),
    },
    { field: 'ip', headerName: t('sdn.ipamPanel.columns.ip'), flex: 1, minWidth: 160 },
    { field: 'mac', headerName: t('sdn.ipamPanel.columns.mac'), width: 180, valueGetter: (v) => v ?? '—' },
  ], [t])

  if (loadingBackends) {
    return <Box sx={{ p: 4, display: 'flex', justifyContent: 'center' }}><CircularProgress /></Box>
  }
  if (backends.length === 0) {
    return <Box sx={{ p: 2 }}><Alert severity="info">{t('sdn.ipamPanel.noBackends')}</Alert></Box>
  }

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h6" sx={{ flex: 1 }}>{t('sdn.ipamPanel.title')}</Typography>
        <FormControl size="small" sx={{ minWidth: 220 }}>
          <InputLabel>{t('sdn.ipamPanel.picker')}</InputLabel>
          <Select
            label={t('sdn.ipamPanel.picker')}
            value={selected}
            onChange={(e) => setSelected(String(e.target.value))}
          >
            {backends.map((b) => (
              <MenuItem key={b.ipam} value={b.ipam}>{b.ipam} ({b.type})</MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button
          variant="outlined"
          size="small"
          onClick={() => fetchAllocations(selected)}
          disabled={loadingAllocs || !selected}
          startIcon={loadingAllocs ? <CircularProgress size={14} /> : <i className="ri-refresh-line" />}
        >
          {t('sdn.common.reload')}
        </Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{t('sdn.common.loadFailed', { error })}</Alert>}

      <Box sx={{ flex: 1, minHeight: 300 }}>
        <DataGrid
          rows={allocations.map((row, idx) => ({ ...row, __rid: idx }))}
          columns={columns}
          getRowId={(row) => row.__rid as number}
          loading={loadingAllocs}
          pageSizeOptions={[10, 25, 50, 100]}
          initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
          slots={{
            noRowsOverlay: () => (
              <Stack alignItems="center" justifyContent="center" sx={{ height: '100%' }}>
                <Typography color="text.secondary">{t('sdn.ipamPanel.empty')}</Typography>
              </Stack>
            ),
          }}
        />
      </Box>
    </Box>
  )
}
