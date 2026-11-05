'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'

import {
  Box, MenuItem, Paper, Select, Stack, Table, TableBody, TableCell, TableHead, TablePagination, TableRow, Typography,
} from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'

import { StatusIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'
import type { MyGpuHours as MyGpuHoursData } from '@/lib/gpu/vdcHours'
import { pageOf } from '@/lib/paging'

import { gpuErrorMessage, OneLine } from './myGpuShared'

interface Props {
  vdcId: string
  /** Bumped by the card when the tenant refreshes it; the hours move slowly, so no timer of their own. */
  tick: number
  /** State of the VMs the card lists, for the dot of their glyph; a VM no longer listed shows as unknown. */
  vmStatus?: Record<string, string>
}

const PAGE_SIZE = 10
const MONTHS_BACK = 12

const SMALL_SELECT_SX = {
  '& .MuiInputBase-input.MuiSelect-select': { minHeight: '1.4375em', lineHeight: '1.4375em' },
} as const

/** The last months as YYYY-MM, the current one first (UTC, like the server's month). */
function recentMonths(now: Date): string[] {
  const out: string[] = []
  for (let i = 0; i < MONTHS_BACK; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

/** GPU hours of the vDC for one month: running and reserved, per VM and profile. Hours only. */
export default function MyGpuHours({ vdcId, tick, vmStatus = {} }: Props) {
  const t = useTranslations()
  const locale = useLocale()
  const theme = useTheme()
  const months = useMemo(() => recentMonths(new Date()), [])
  const [month, setMonth] = useState(months[0])
  const [data, setData] = useState<MyGpuHoursData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const seq = useRef(0)

  useEffect(() => {
    const mine = ++seq.current
    void (async () => {
      try {
        const r = await fetch(`/api/v1/vdcs/${encodeURIComponent(vdcId)}/gpu/hours?month=${encodeURIComponent(month)}`, { cache: 'no-store' })
        const json = await r.json().catch(() => null)
        if (mine !== seq.current) return
        if (!r.ok || !json?.data) {
          setError(gpuErrorMessage(t, json?.error ?? 'unavailable'))
          return
        }
        setData(json.data)
        setError(null)
      } catch {
        if (mine === seq.current) setError(gpuErrorMessage(t, 'unavailable'))
      }
    })()
    return () => { seq.current++ }
    // t is stable per locale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vdcId, month, tick])

  const monthLabel = (m: string) => {
    const [y, mm] = m.split('-').map(Number)
    return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, mm - 1, 1)))
  }
  const hours = (n: number) => t('myVdc.gpu.hoursUnit', { value: Math.round(n * 100) / 100 })

  const shown = data && data.month === month ? data : null
  const { rows, page: current } = pageOf(shown?.byVm ?? [], page, PAGE_SIZE)

  const tiles = shown
    ? [
        { key: 'running', icon: 'ri-play-circle-line', color: theme.palette.success.main, label: t('myVdc.gpu.hoursRunning'), value: shown.totals.runningHours },
        { key: 'reserved', icon: 'ri-time-line', color: theme.palette.info.main, label: t('myVdc.gpu.hoursReserved'), value: shown.totals.reservedHours },
      ]
    : []

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <i className="ri-time-line" />
        <Typography variant="subtitle2" noWrap sx={{ fontWeight: 600, flex: 1, minWidth: 0 }}>{t('myVdc.gpu.hoursTitle')}</Typography>
        <Select
          size="small"
          sx={{ ...SMALL_SELECT_SX, minWidth: 170 }}
          value={month}
          onChange={(e) => { setMonth(String(e.target.value)); setPage(0) }}
          SelectDisplayProps={{ 'aria-label': t('myVdc.gpu.hoursMonth') }}
        >
          {months.map((m) => <MenuItem key={m} value={m}>{monthLabel(m)}</MenuItem>)}
        </Select>
      </Stack>

      {error && <OneLine variant="caption" color="error.main">{error}</OneLine>}

      {shown && (
        <>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 1.5 }}>
            {tiles.map((tile) => (
              <Paper
                key={tile.key}
                variant="outlined"
                sx={{ flex: 1, p: 1.5, bgcolor: alpha(tile.color, 0.05), borderColor: alpha(tile.color, 0.25) }}
              >
                <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 0.5 }}>
                  <i className={tile.icon} style={{ fontSize: 16, color: tile.color }} />
                  <OneLine variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>{tile.label}</OneLine>
                </Stack>
                <Typography variant="h6" noWrap sx={{ color: tile.color, fontWeight: 800, lineHeight: 1.1 }}>{hours(tile.value)}</Typography>
              </Paper>
            ))}
          </Stack>

          {shown.byVm.length === 0 ? (
            <Typography variant="caption" color="text.secondary">{t('myVdc.gpu.hoursEmpty')}</Typography>
          ) : (
            <>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>{t('myVdc.gpu.hoursColVm')}</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>{t('myVdc.gpu.hoursColProfile')}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, fontSize: 11 }}>{t('myVdc.gpu.hoursRunning')}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, fontSize: 11 }}>{t('myVdc.gpu.hoursReserved')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={`${r.vmid}|${r.label}`} hover>
                      <TableCell sx={{ py: 0.75, maxWidth: 220 }}>
                        <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0 }}>
                          {/* The glyph of the card's VM rows, with its state dot. */}
                          <StatusIcon type="vm" status={vmStatus[r.vmid] ?? 'unknown'} size={16} />
                          <OneLine>{r.vmName}</OneLine>
                        </Stack>
                      </TableCell>
                      <TableCell sx={{ py: 0.75, maxWidth: 200 }}><OneLine>{r.label}</OneLine></TableCell>
                      <TableCell align="right" sx={{ py: 0.75, whiteSpace: 'nowrap' }}>{hours(r.runningHours)}</TableCell>
                      <TableCell align="right" sx={{ py: 0.75, whiteSpace: 'nowrap' }}>{hours(r.reservedHours)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {shown.byVm.length > PAGE_SIZE && (
                <TablePagination
                  component="div"
                  count={shown.byVm.length}
                  page={current}
                  onPageChange={(_, p) => setPage(p)}
                  rowsPerPage={PAGE_SIZE}
                  rowsPerPageOptions={[PAGE_SIZE]}
                  labelDisplayedRows={({ from, to, count }) => t('myVdc.gpu.displayedRows', { from, to, count })}
                  sx={{ '& .MuiTablePagination-toolbar': { minHeight: 40 } }}
                />
              )}
            </>
          )}
        </>
      )}
    </Box>
  )
}
