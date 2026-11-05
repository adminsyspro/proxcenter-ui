'use client'

import { Box, Checkbox, Chip, IconButton, TableCell, TableRow, Tooltip, Typography } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import { serviceLabel, serviceTitle } from '@/lib/network/serviceNames'
import type { MicrosegSuggestion, MicrosegZone, SuggestionAction } from '@/lib/microseg/types'

import { destinationLabel, hitsShare } from './observationModel'
import { FlowActions } from './ObservationActions'
import { DirectionGlyph, ObservedKindGlyph } from './observationParts'
import { formatWhen } from './summaryModel'
import TruncatedText from './TruncatedText'

/** Columns of the table: select, details, source, arrow, destination, service, hits, last seen, status, actions. */
export const OBSERVATION_COLUMNS = 10

const CELL_SX = { py: 0.5, px: 1, whiteSpace: 'nowrap' } as const
const NAME_SX = { maxWidth: 200, minWidth: 0 } as const

/** What a zone-less endpoint is called: its IP, or "Unknown". */
export function endpoint(zoneId: string, ip: string, zones: Map<string, MicrosegZone>, t: (key: string) => string): string {
  if (zoneId) return zones.get(zoneId)?.name ?? t('deletedZone')
  return ip || t('unknownEndpoint')
}

/** The name of the destination of a flow: an outbound one may be an address, a guest or many destinations. */
export function destinationName(s: MicrosegSuggestion, zones: Map<string, MicrosegZone>, guestName: (ip: string) => string | undefined, t: (key: string) => string): string {
  if (s.direction !== 'out') return endpoint(s.dst_zone_id, s.dst_ip, zones, t)
  return destinationLabel(s, id => zones.get(id)?.name ?? t('deletedZone'), guestName, t('manyDestinations'))
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
  /** The name of the guest that carries an address, when the inventory knows it. */
  guestName: (ip: string) => string | undefined
  checked: boolean
  busy: boolean
  /** Most hits of a flow on the page: the bar of each row is its share of it. */
  maxHits: number
  /** The current time of the relative "last seen" (useNow). */
  now: number
  onToggle: () => void
  onResolve: (action: SuggestionAction, prefixLen?: number) => void
  /** Opens the flow in its dialog (details, traffic, recent occurrences). */
  onOpenDetails: () => void
}

/** One observed flow, one row of the table; its details open in a centred dialog (ObservedFlowDialog). */
export default function ObservationRow({ suggestion: s, zones, guestName, checked, busy, maxHits, now, onToggle, onResolve, onOpenDetails }: ObservationRowProps) {
  const t = useTranslations('microsegPilot.observation')
  const format = useFormatter()

  const when = (iso: string) => formatWhen(format, iso)
  const source = endpoint(s.src_zone_id, s.src_ip, zones, t)
  const destination = destinationName(s, zones, guestName, t)
  const service = serviceLabel(s.proto, s.dport)
  const serviceTip = serviceTitle(s.proto, s.dport)
  const pending = s.status === 'pending'
  const share = hitsShare(s.hits, maxHits)
  const dot = sourceDot(s, zones)

  return (
    <>
      <TableRow hover data-suggestion={s.id} aria-label={t('rowLabel', { source, destination })}>
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
          <Tooltip title={t('dialog.open')}>
            <IconButton size='small' aria-haspopup='dialog' aria-label={t('dialog.openFor', { source, destination })} onClick={onOpenDetails}>
              <i className='ri-file-list-3-line' />
            </IconButton>
          </Tooltip>
        </TableCell>
        <TableCell sx={CELL_SX}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            <DirectionGlyph direction={s.direction} />
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
    </>
  )
}
