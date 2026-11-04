'use client'

// The "Micro-segmentation" source of the Logging tab: the flows the zone engine saw towards zone guests, from the
// orchestrator's in-memory ring (filled from the node logs once a minute). Reading it costs no Proxmox call, so it
// refreshes every minute while this source is shown (and the tab visible), unlike the firewall logs of the other
// sources which are read from the nodes.

import { paletteAlpha } from './paletteAlpha'
import { useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'

import {
  Box, Button, Chip, CircularProgress, IconButton, InputAdornment, LinearProgress, MenuItem, Table, TableBody, TableCell,
  TableContainer, TableHead, TablePagination, TableRow, TextField, Tooltip, Typography, useTheme,
} from '@mui/material'

import { SMALL_SELECT_SX } from '@/components/settings/destinations/DestinationDialogParts'
import { GuestGlyph } from '@/components/ui/glyphs'
import { useMicrosegEvents } from '@/lib/microseg/useMicrosegEvents'
import { serviceLabel, serviceTitle } from '@/lib/network/serviceNames'

import MicrosegErrorAlert from './microseg/MicrosegErrorAlert'

import { EMPTY_CELL_SX, EMPTY_TEXT_SX } from '@/components/firewall/FirewallLogView'

import type { LogGuestInfo } from '@/components/firewall/FirewallLogView'
import type { MicrosegEvent, MicrosegZone, SuggestionKind } from '@/lib/microseg/types'

interface Props {
  connectionId: string
  zones: MicrosegZone[]
  /** The inventory, for the state dot of a guest. */
  guests?: Record<number, LogGuestInfo>
}

/** Debounce of the search text before it is sent as `q`. */
export const SEARCH_DEBOUNCE_MS = 400

/** Longest search text: the ring is searched by IP or port, nothing longer is useful. */
export const SEARCH_MAX_LENGTH = 64

/** What the server can search in its ring: an IPv4/IPv6 address (or part of one) or a port. */
const SERVER_SEARCHABLE = /^[\d.:]+$|^[0-9a-f]*:[0-9a-f:]*$/i

/**
 * The `q` sent to the relay: the text when it looks like an IP or a port, else nothing. A guest, zone, node or service
 * name is matched here, on the lines already read, never sent as a server filter it does not know.
 */
export function serverQuery(text: string): string {
  const q = text.trim()

  return SERVER_SEARCHABLE.test(q) ? q : ''
}

// Same semantics as the zone map's edges and the observation list: blue for a flow an enforced zone blocked, red for
// one that would be blocked once its zone enforces.
const VERDICTS: Record<SuggestionKind, { icon: string; color: 'error' | 'info'; label: string; tip: string }> = {
  would_block: { icon: 'ri-eye-line', color: 'error', label: 'wouldBlock', tip: 'wouldBlockTip' },
  blocked: { icon: 'ri-forbid-line', color: 'info', label: 'blocked', tip: 'blockedTip' },
}

const COLUMNS = 6
const CELL_SX = { py: 0.5, fontSize: 12, whiteSpace: 'nowrap' } as const

const portOf = (e: MicrosegEvent) => (e.dport === 0 || e.dport === '0' || e.dport === '' || e.dport == null ? undefined : e.dport)

function ZoneChip({ name, color }: { name: string; color?: string }) {
  return (
    <Chip
      size='small'
      variant='outlined'
      label={name}
      icon={<Box component='span' sx={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, bgcolor: color || 'text.disabled', ml: '8px !important', mr: '-2px !important' }} />}
      sx={{ height: 22, fontSize: 12, maxWidth: 180 }}
    />
  )
}

export default function MicrosegEventsView({ connectionId, zones, guests }: Props) {
  const theme = useTheme()
  const t = useTranslations('firewallLog.microseg')
  const tLog = useTranslations('firewallLog')
  const tCommon = useTranslations('common')
  const locale = useLocale()
  const dotBorder = theme.palette.background.paper

  const [search, setSearch] = useState('')
  const [sentSearch, setSentSearch] = useState('')
  const [zone, setZone] = useState('')
  const [verdict, setVerdict] = useState<'' | SuggestionKind>('')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(50)

  useEffect(() => {
    const timer = setTimeout(() => setSentSearch(serverQuery(search)), SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [search])

  const { events, more, truncated, loading, validating, error, olderError, olderBusy, loadOlder, reload } = useMicrosegEvents(
    connectionId,
    { zone, verdict, q: sentSearch },
  )

  const colours = useMemo(() => new Map(zones.map(z => [z.name, z.color])), [zones])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()

    if (!q) return events

    return events.filter(e => [
      e.src_ip, e.dst_ip, String(portOf(e) ?? ''), e.proto, serviceLabel(e.proto, portOf(e)), e.guest, String(e.vmid), e.zone, e.src_zone, e.node,
    ].some(v => (v || '').toLowerCase().includes(q)))
  }, [events, search])

  const pageRows = rows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)

  const fmtTime = (iso: string) => {
    const d = new Date(iso)

    if (Number.isNaN(d.getTime())) return iso

    const today = d.toDateString() === new Date().toDateString()

    return d.toLocaleString(locale, {
      ...(today ? {} : { day: '2-digit', month: '2-digit' }),
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
  }

  const busy = loading || validating
  const filtering = !!(zone || verdict || sentSearch)

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.5, flexWrap: 'wrap' }}>
        <TextField
          size='small'
          placeholder={t('searchPlaceholder')}
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(0) }}
          sx={{ flex: '1 1 220px', minWidth: 200 }}
          slotProps={{
            htmlInput: { 'aria-label': t('searchPlaceholder'), maxLength: SEARCH_MAX_LENGTH },
            input: {
              startAdornment: (
                <InputAdornment position='start'>
                  <i className='ri-search-line' style={{ fontSize: 16, opacity: 0.6 }} />
                </InputAdornment>
              ),
            },
          }}
        />
        <TextField select size='small' label={t('zone')} value={zone} onChange={e => { setZone(e.target.value); setPage(0) }} slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }} sx={{ minWidth: 170, ...SMALL_SELECT_SX }}>
          <MenuItem value=''>{t('allZones')}</MenuItem>
          {zones.map(z => <MenuItem key={z.id} value={z.name}>{z.name}</MenuItem>)}
        </TextField>
        <TextField select size='small' label={t('verdict')} value={verdict} onChange={e => { setVerdict(e.target.value as '' | SuggestionKind); setPage(0) }} slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }} sx={{ minWidth: 190, ...SMALL_SELECT_SX }}>
          <MenuItem value=''>{t('allVerdicts')}</MenuItem>
          <MenuItem value='would_block'>{t('wouldBlock')}</MenuItem>
          <MenuItem value='blocked'>{t('blocked')}</MenuItem>
        </TextField>
        <Tooltip title={tCommon('refresh')}>
          <span>
            <IconButton aria-label={tCommon('refresh')} size='small' onClick={() => { void reload() }} disabled={busy}>
              <i className={`ri-refresh-line ${busy ? 'animate-spin' : ''}`} style={{ fontSize: 18 }} />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {(error || olderError) && (
        <Box sx={{ px: 2 }}>
          <MicrosegErrorAlert error={error ?? olderError} onRetry={error ? () => { void reload() } : () => { void loadOlder() }} />
        </Box>
      )}

      {loading && <LinearProgress />}

      <TableContainer sx={{ maxHeight: 'calc(100vh - 380px)', minHeight: 160 }}>
        <Table size='small' stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={CELL_SX}>{t('verdict')}</TableCell>
              <TableCell sx={CELL_SX}>{tLog('time')}</TableCell>
              <TableCell sx={CELL_SX}>{tLog('source')}</TableCell>
              <TableCell sx={CELL_SX}>{tLog('destination')}</TableCell>
              <TableCell sx={CELL_SX}>{tLog('service')}</TableCell>
              <TableCell sx={CELL_SX}>{t('zone')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {pageRows.map((e, i) => {
              const v = VERDICTS[e.verdict] ?? VERDICTS.would_block
              const port = portOf(e)
              const guest = guests?.[e.vmid]
              const guestName = e.guest || guest?.name

              return (
                <TableRow key={e.seq ?? `${e.ts}|${e.node}|${e.vmid}|${e.src_ip}|${i}`} hover>
                  <TableCell sx={CELL_SX}>
                    <Tooltip title={t(v.tip)}>
                      <Chip size='small' variant='outlined' color={v.color} label={t(v.label)} icon={<i className={v.icon} style={{ fontSize: 14 }} />} sx={{ height: 22, fontSize: 12, fontWeight: 600 }} />
                    </Tooltip>
                  </TableCell>
                  <TableCell sx={{ ...CELL_SX, fontVariantNumeric: 'tabular-nums' }}>{fmtTime(e.ts)}</TableCell>
                  <TableCell sx={CELL_SX}>{e.src_ip || '-'}</TableCell>
                  <TableCell sx={CELL_SX}>
                    {guestName ? (
                      <Tooltip title={`${e.dst_ip ? `${e.dst_ip} · ` : ''}${t('guestTip', { name: guestName, vmid: String(e.vmid), node: e.node })}`}>
                        <Box component='span' sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                          <GuestGlyph type={e.type ?? guest?.type} status={guest?.status} dotBorder={dotBorder} />
                          {guestName}
                          <Typography component='span' variant='caption' sx={{ color: 'text.disabled' }}>#{e.vmid}</Typography>
                        </Box>
                      </Tooltip>
                    ) : (e.dst_ip || '-')}
                  </TableCell>
                  <TableCell sx={CELL_SX}>
                    {e.proto ? (
                      <Tooltip title={serviceTitle(e.proto, port)}>
                        <span>{serviceLabel(e.proto, port)}</span>
                      </Tooltip>
                    ) : '-'}
                  </TableCell>
                  <TableCell sx={CELL_SX}>
                    <Tooltip title={e.src_zone ? t('zoneFlowTip', { from: e.src_zone, to: e.zone }) : ''}>
                      <Box component='span' sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                        {e.src_zone && (
                          <>
                            <ZoneChip name={e.src_zone} color={colours.get(e.src_zone)} />
                            <i className='ri-arrow-right-line' style={{ fontSize: 14, opacity: 0.6 }} />
                          </>
                        )}
                        <ZoneChip name={e.zone} color={colours.get(e.zone)} />
                      </Box>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              )
            })}

            {!busy && !error && pageRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={COLUMNS} sx={EMPTY_CELL_SX}>
                  <i className='ri-file-list-line' style={{ fontSize: 32, opacity: 0.3 }} />
                  <Typography variant='body2' sx={{ color: 'text.secondary', mt: 1, ...EMPTY_TEXT_SX }}>
                    {events.length === 0 && !filtering ? t('empty') : tLog('noMatch')}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', px: 2, borderTop: `1px solid ${paletteAlpha(theme, 'divider', 0.15)}` }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.5, minWidth: 0, flex: '1 1 320px' }}>
          {events.length > 0 && (
            <Typography variant='caption' sx={{ color: 'text.secondary' }}>
              {[t('showing', { count: events.length }), t('source'), t('frozen'), ...(truncated ? [t('truncated')] : [])].join(' · ')}
            </Typography>
          )}
          {more && events.length > 0 && (
            <Button
              size='small'
              variant='outlined'
              onClick={() => { void loadOlder() }}
              disabled={olderBusy}
              startIcon={olderBusy ? <CircularProgress size={12} color='inherit' /> : <i className='ri-history-line' style={{ fontSize: 14 }} />}
              sx={{ flexShrink: 0, textTransform: 'none' }}
            >
              {t('loadOlder')}
            </Button>
          )}
        </Box>
        <TablePagination
          component='div'
          count={rows.length}
          page={page}
          onPageChange={(_, p) => setPage(p)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={e => { setRowsPerPage(Number(e.target.value)); setPage(0) }}
          rowsPerPageOptions={[20, 50, 100]}
          labelRowsPerPage={tCommon('rowsPerPage')}
        />
      </Box>
    </Box>
  )
}

