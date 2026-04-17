'use client'

import { useCallback, useEffect, useState } from 'react'

import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import CircularProgress from '@mui/material/CircularProgress'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import { useTranslations } from 'next-intl'

import type { SdnController, SdnDns, SdnIpam } from './types'

interface Props {
  connId: string
}

interface OptionsState {
  controllers: SdnController[]
  ipams: SdnIpam[]
  dns: SdnDns[]
  loading: boolean
  error: string | null
}

export default function ClusterSdnOptionsPanel({ connId }: Props) {
  const t = useTranslations()
  const [state, setState] = useState<OptionsState>({
    controllers: [], ipams: [], dns: [], loading: true, error: null,
  })

  const fetchAll = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const [cRes, iRes, dRes] = await Promise.all([
        fetch(`/api/v1/connections/${connId}/sdn/controllers`, { cache: 'no-store' }),
        fetch(`/api/v1/connections/${connId}/sdn/ipams`, { cache: 'no-store' }),
        fetch(`/api/v1/connections/${connId}/sdn/dns`, { cache: 'no-store' }),
      ])
      const [cBody, iBody, dBody] = await Promise.all([cRes.json(), iRes.json(), dRes.json()])
      if (!cRes.ok) throw new Error(cBody?.error || `controllers HTTP ${cRes.status}`)
      if (!iRes.ok) throw new Error(iBody?.error || `ipams HTTP ${iRes.status}`)
      if (!dRes.ok) throw new Error(dBody?.error || `dns HTTP ${dRes.status}`)
      setState({
        controllers: cBody.data?.controllers ?? [],
        ipams: iBody.data?.ipams ?? [],
        dns: dBody.data?.dns ?? [],
        loading: false,
        error: null,
      })
    } catch (e: any) {
      setState((s) => ({ ...s, loading: false, error: e?.message || String(e) }))
    }
  }, [connId])

  useEffect(() => {
    void fetchAll()
  }, [fetchAll])

  const controllerCols: GridColDef<SdnController>[] = [
    { field: 'controller', headerName: t('sdn.options.controllers.columns.id'), flex: 1, minWidth: 140 },
    { field: 'type', headerName: t('sdn.options.controllers.columns.type'), width: 120 },
    { field: 'nodes', headerName: t('sdn.options.controllers.columns.nodes'), flex: 1, minWidth: 140, valueGetter: (v) => v ?? '—' },
  ]
  const ipamCols: GridColDef<SdnIpam>[] = [
    { field: 'ipam', headerName: t('sdn.options.ipam.columns.id'), flex: 1, minWidth: 140 },
    { field: 'type', headerName: t('sdn.options.ipam.columns.type'), width: 160 },
  ]
  const dnsCols: GridColDef<SdnDns>[] = [
    { field: 'dns', headerName: t('sdn.options.dns.columns.id'), flex: 1, minWidth: 140 },
    { field: 'type', headerName: t('sdn.options.dns.columns.type'), width: 160 },
  ]

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Stack direction="row" justifyContent="flex-end">
        <Button
          variant="outlined"
          size="small"
          onClick={fetchAll}
          disabled={state.loading}
          startIcon={state.loading ? <CircularProgress size={14} /> : <i className="ri-refresh-line" />}
        >
          {t('sdn.common.reload')}
        </Button>
      </Stack>

      {state.error && (
        <Alert severity="error">{t('sdn.common.loadFailed', { error: state.error })}</Alert>
      )}

      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" sx={{ mb: 1 }}>{t('sdn.options.controllers.title')}</Typography>
          <Box sx={{ height: 240 }}>
            <DataGrid
              rows={state.controllers}
              columns={controllerCols}
              getRowId={(r) => r.controller}
              loading={state.loading}
              hideFooter
              slots={{
                noRowsOverlay: () => <Stack alignItems="center" justifyContent="center" sx={{ height: '100%' }}><Typography color="text.secondary">{t('sdn.options.controllers.empty')}</Typography></Stack>,
              }}
            />
          </Box>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" sx={{ mb: 1 }}>{t('sdn.options.ipam.title')}</Typography>
          <Box sx={{ height: 240 }}>
            <DataGrid
              rows={state.ipams}
              columns={ipamCols}
              getRowId={(r) => r.ipam}
              loading={state.loading}
              hideFooter
              slots={{
                noRowsOverlay: () => <Stack alignItems="center" justifyContent="center" sx={{ height: '100%' }}><Typography color="text.secondary">{t('sdn.options.ipam.empty')}</Typography></Stack>,
              }}
            />
          </Box>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" sx={{ mb: 1 }}>{t('sdn.options.dns.title')}</Typography>
          <Box sx={{ height: 240 }}>
            <DataGrid
              rows={state.dns}
              columns={dnsCols}
              getRowId={(r) => r.dns}
              loading={state.loading}
              hideFooter
              slots={{
                noRowsOverlay: () => <Stack alignItems="center" justifyContent="center" sx={{ height: '100%' }}><Typography color="text.secondary">{t('sdn.options.dns.empty')}</Typography></Stack>,
              }}
            />
          </Box>
        </CardContent>
      </Card>
    </Box>
  )
}
