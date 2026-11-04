'use client'

import { useState } from 'react'
import { Box, Checkbox, Chip, Collapse, IconButton, TableCell, TableRow, Tooltip, Typography } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import { serviceLabel, serviceTitle } from '@/lib/network/serviceNames'
import type { MicrosegSuggestion, MicrosegZone, SuggestionAction } from '@/lib/microseg/types'

import { OneLine } from './dialogParts'
import { hitsShare } from './observationModel'
import { FlowActions } from './ObservationActions'
import { ObservedKindGlyph } from './observationParts'
import { formatWhen } from './summaryModel'
import TruncatedText from './TruncatedText'

/** Columns of the table: select, details, source, arrow, destination, service, hits, last seen, status, actions. */
export const OBSERVATION_COLUMNS = 10

const CELL_SX = { py: 0.5, px: 1, whiteSpace: 'nowrap' } as const
const NAME_SX = { maxWidth: 200, minWidth: 0 } as const

/** What a zone-less endpoint is called: its IP, or "Unknown". */
function endpoint(zoneId: string, ip: string, zones: Map<string, MicrosegZone>, t: (key: string) => string): string {
  if (zoneId) return zones.get(zoneId)?.name ?? t('deletedZone')
  return ip || t('unknownEndpoint')
}

/** The colour of the source dot: its zone's, red for a source in no zone, grey for a zone that is gone. */
function sourceDot(s: MicrosegSuggestion, zones: Map<string, MicrosegZone>): string {
  if (!s.src_zone_id) return 'error.main'
  return zones.get(s.src_zone_id)?.color || 'text.disabled'
}

/** "2 hours ago", or the raw text when it is not a date. */
function relative(format: ReturnType<typeof useFormatter>, iso: string, now: number): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : format.relativeTime(d, now)
}

export type ObservationRowProps = {
  suggestion: MicrosegSuggestion
  zones: Map<string, MicrosegZone>
  checked: boolean
  busy: boolean
  /** Most hits of a flow on the page: the bar of each row is its share of it. */
  maxHits: number
  /** The current time of the relative "last seen" (useNow). */
  now: number
  onToggle: () => void
  onResolve: (action: SuggestionAction) => void
}

/** One observed flow, one row of the table; the sample addresses and the first and last time sit under the chevron. */
export default function ObservationRow({ suggestion: s, zones, checked, busy, maxHits, now, onToggle, onResolve }: ObservationRowProps) {
  const t = useTranslations('microsegPilot.observation')
  const tp = useTranslations('microsegPilot.policy')
  const format = useFormatter()
  const [open, setOpen] = useState(false)

  const when = (iso: string) => formatWhen(format, iso)
  const source = endpoint(s.src_zone_id, s.src_ip, zones, t)
  const destination = endpoint(s.dst_zone_id, s.dst_ip, zones, t)
  const service = serviceLabel(s.proto, s.dport)
  const serviceTip = serviceTitle(s.proto, s.dport)
  const pending = s.status === 'pending'
  const share = hitsShare(s.hits, maxHits)
  const dot = sourceDot(s, zones)

  return (
    <>
      <TableRow hover data-suggestion={s.id} aria-label={t('rowLabel', { source, destination })} sx={{ '& > td': { borderBottom: open ? 0 : undefined } }}>
        <TableCell padding='checkbox' sx={{ py: 0.5 }}>
          <Checkbox
            size='small'
            checked={checked}
            disabled={!pending || busy}
            onChange={onToggle}
            slotProps={{ input: { 'aria-label': t('selectRow', { source, destination }) } }}
            sx={{ p: 0.5 }}
          />
        </TableCell>
        <TableCell sx={{ ...CELL_SX, px: 0 }}>
          <IconButton size='small' aria-expanded={open} aria-label={open ? tp('hideDetails') : tp('showDetails')} onClick={() => setOpen(v => !v)}>
            <i className={open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} />
          </IconButton>
        </TableCell>
        <TableCell sx={CELL_SX}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            <ObservedKindGlyph kind={s.kind} />
            <Box component='span' data-source-dot={dot} sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: dot, flexShrink: 0 }} />
            <TruncatedText text={source} fontWeight={600} tabIndex={0} sx={NAME_SX} />
          </Box>
        </TableCell>
        <TableCell sx={{ ...CELL_SX, px: 0 }} aria-hidden><i className='ri-arrow-right-line' style={{ opacity: 0.6 }} /></TableCell>
        <TableCell sx={CELL_SX}>
          <TruncatedText text={destination} fontWeight={600} sx={NAME_SX} />
        </TableCell>
        <TableCell sx={CELL_SX}><Tooltip title={serviceTip}><Chip size='small' variant='outlined' label={service} /></Tooltip></TableCell>
        <TableCell sx={CELL_SX}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant='body2' sx={{ minWidth: 48, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{format.number(s.hits)}</Typography>
            <Box aria-hidden sx={{ width: 56, height: 6, borderRadius: 3, bgcolor: 'action.hover', overflow: 'hidden', flexShrink: 0 }}>
              <Box data-share={share} sx={{ height: '100%', borderRadius: 3, bgcolor: 'primary.main' }} style={{ width: `${share}%` }} />
            </Box>
          </Box>
        </TableCell>
        <TableCell sx={CELL_SX}>
          <Tooltip title={t('lastSeen', { time: when(s.last_seen) })}>
            <Typography noWrap variant='body2' color='text.secondary'>{relative(format, s.last_seen, now)}</Typography>
          </Tooltip>
        </TableCell>
        <TableCell sx={CELL_SX}>
          <Chip size='small' variant='outlined' color={s.kind === 'blocked' ? 'info' : 'error'} label={t(`kind.${s.kind}`)} />
        </TableCell>
        <TableCell sx={{ ...CELL_SX, textAlign: 'right' }}>
          {pending ? (
            <FlowActions suggestion={s} source={source} destination={destination} busy={busy} onResolve={onResolve} />
          ) : (
            <Chip size='small' variant='outlined' label={t(`status.${s.status}`)} />
          )}
        </TableCell>
      </TableRow>
      {open && (
        <TableRow data-detail={s.id}>
          <TableCell colSpan={OBSERVATION_COLUMNS} sx={{ py: 0, px: 0 }}>
            <Collapse in appear unmountOnExit>
              <Box sx={{ pl: 11, pr: 2, pb: 1.5, minWidth: 0, maxWidth: '100%' }}>
                <OneLine text={t('detail.addresses', { from: s.src_ip || t('unknownEndpoint'), to: s.dst_ip || t('unknownEndpoint') })} />
                <OneLine text={t('detail.sampleNote')} />
                <OneLine text={t('detail.firstSeen', { time: when(s.first_seen) })} />
                <OneLine text={t('detail.lastSeen', { time: when(s.last_seen) })} />
              </Box>
            </Collapse>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}
