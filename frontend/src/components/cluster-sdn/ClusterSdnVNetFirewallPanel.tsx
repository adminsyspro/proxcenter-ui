'use client'

import { useCallback, useEffect, useState } from 'react'

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

import type { SdnFirewallRule, SdnVNet } from './types'

interface Props {
  connId: string
}

export default function ClusterSdnVNetFirewallPanel({ connId }: Props) {
  const t = useTranslations()
  const [vnets, setVNets] = useState<SdnVNet[]>([])
  const [selected, setSelected] = useState<string>('')
  const [rules, setRules] = useState<SdnFirewallRule[]>([])
  const [loadingVNets, setLoadingVNets] = useState(true)
  const [loadingRules, setLoadingRules] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoadingVNets(true)
      setError(null)
      try {
        const res = await fetch(`/api/v1/connections/${connId}/sdn/vnets`, { cache: 'no-store' })
        const body = await res.json()
        if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
        if (cancelled) return
        const list: SdnVNet[] = body.data?.vnets ?? []
        setVNets(list)
        if (list.length > 0) setSelected(list[0].vnet)
      } catch (e: any) {
        if (!cancelled) setError(e?.message || String(e))
      } finally {
        if (!cancelled) setLoadingVNets(false)
      }
    })()
    return () => { cancelled = true }
  }, [connId])

  const fetchRules = useCallback(async (vnet: string) => {
    if (!vnet) return
    setLoadingRules(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/v1/connections/${connId}/sdn/vnets/${encodeURIComponent(vnet)}/firewall/rules`,
        { cache: 'no-store' },
      )
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
      setRules(body.data?.rules ?? [])
    } catch (e: any) {
      setError(e?.message || String(e))
      setRules([])
    } finally {
      setLoadingRules(false)
    }
  }, [connId])

  useEffect(() => {
    if (selected) void fetchRules(selected)
  }, [selected, fetchRules])

  const columns: GridColDef<SdnFirewallRule>[] = [
    { field: 'enable', headerName: t('sdn.vnetFirewallPanel.columns.on'), width: 60, valueGetter: (v) => v ? '✓' : '' },
    { field: 'type', headerName: t('sdn.vnetFirewallPanel.columns.type'), width: 80 },
    { field: 'action', headerName: t('sdn.vnetFirewallPanel.columns.action'), width: 110 },
    { field: 'macro', headerName: t('sdn.vnetFirewallPanel.columns.macro'), width: 110, valueGetter: (v) => v ?? '—' },
    { field: 'proto', headerName: t('sdn.vnetFirewallPanel.columns.protocol'), width: 100, valueGetter: (v) => v ?? '—' },
    { field: 'source', headerName: t('sdn.vnetFirewallPanel.columns.source'), flex: 1, minWidth: 140, valueGetter: (v) => v ?? '—' },
    { field: 'sport', headerName: t('sdn.vnetFirewallPanel.columns.sPort'), width: 90, valueGetter: (v) => v ?? '—' },
    { field: 'dest', headerName: t('sdn.vnetFirewallPanel.columns.destination'), flex: 1, minWidth: 140, valueGetter: (v) => v ?? '—' },
    { field: 'dport', headerName: t('sdn.vnetFirewallPanel.columns.dPort'), width: 90, valueGetter: (v) => v ?? '—' },
    { field: 'log', headerName: t('sdn.vnetFirewallPanel.columns.logLevel'), width: 110, valueGetter: (v) => v ?? '—' },
    { field: 'comment', headerName: t('sdn.vnetFirewallPanel.columns.comment'), flex: 1, minWidth: 180, valueGetter: (v) => v ?? '' },
  ]

  if (loadingVNets) {
    return <Box sx={{ p: 4, display: 'flex', justifyContent: 'center' }}><CircularProgress /></Box>
  }
  if (vnets.length === 0) {
    return <Box sx={{ p: 2 }}><Alert severity="info">{t('sdn.vnetFirewallPanel.noVnets')}</Alert></Box>
  }

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h6" sx={{ flex: 1 }}>{t('sdn.vnetFirewallPanel.title')}</Typography>
        <FormControl size="small" sx={{ minWidth: 220 }}>
          <InputLabel>{t('sdn.vnetFirewallPanel.picker')}</InputLabel>
          <Select
            label={t('sdn.vnetFirewallPanel.picker')}
            value={selected}
            onChange={(e) => setSelected(String(e.target.value))}
          >
            {vnets.map((v) => (
              <MenuItem key={v.vnet} value={v.vnet}>{v.vnet}{v.alias ? ` (${v.alias})` : ''}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button
          variant="outlined"
          size="small"
          onClick={() => fetchRules(selected)}
          disabled={loadingRules || !selected}
          startIcon={loadingRules ? <CircularProgress size={14} /> : <i className="ri-refresh-line" />}
        >
          {t('sdn.common.reload')}
        </Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{t('sdn.common.loadFailed', { error })}</Alert>}

      <Box sx={{ flex: 1, minHeight: 300 }}>
        <DataGrid
          rows={rules}
          columns={columns}
          getRowId={(row) => row.pos}
          loading={loadingRules}
          pageSizeOptions={[10, 25, 50]}
          initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
          slots={{
            noRowsOverlay: () => (
              <Stack alignItems="center" justifyContent="center" sx={{ height: '100%' }}>
                <Typography color="text.secondary">{t('sdn.vnetFirewallPanel.empty')}</Typography>
              </Stack>
            ),
          }}
        />
      </Box>
    </Box>
  )
}
