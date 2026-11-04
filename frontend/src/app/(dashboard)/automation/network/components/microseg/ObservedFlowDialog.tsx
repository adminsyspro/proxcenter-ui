'use client'

import type { ReactNode } from 'react'
import { Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import { serviceLabel, serviceTitle } from '@/lib/network/serviceNames'
import { useMicrosegEvents } from '@/lib/microseg/useMicrosegEvents'
import type { MicrosegSuggestion, MicrosegZone, SuggestionAction } from '@/lib/microseg/types'

import HourlyBars from './HourlyBars'
import MicrosegErrorAlert from './MicrosegErrorAlert'
import { FlowActions } from './ObservationActions'
import { eventOfFlow, flowTrafficSeries } from './observedFlowModel'
import { ObservedKindGlyph } from './observationParts'
import { formatWhen } from './summaryModel'
import TruncatedText from './TruncatedText'
import { useZoneUncovered } from './useZoneUncovered'

/** The recent occurrences the dialog lists at most. */
export const RECENT_SHOWN = 10
const CHART_HEIGHT = 72
const CELL_SX = { py: 0.5, px: 1, whiteSpace: 'nowrap' } as const

type Props = {
  connectionId: string
  suggestion: MicrosegSuggestion
  zones: Map<string, MicrosegZone>
  /** What the table calls the two ends (a zone, an address or "Unknown"). */
  source: string
  destination: string
  busy: boolean
  onResolve: (action: SuggestionAction) => void
  onClose: () => void
}

/** One fact on one line: the label at the left, the value at the right. */
function Line({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <Box data-flow-line sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 2, minWidth: 0 }}>
      <Typography variant='body2' color='text.secondary' noWrap sx={{ flexShrink: 0 }}>{label}</Typography>
      {typeof children === 'string'
        ? <TruncatedText text={children} variant='body2' fontWeight={500} sx={{ minWidth: 0, fontVariantNumeric: 'tabular-nums' }} />
        : children}
    </Box>
  )
}

function Section({ title, aside, children }: Readonly<{ title: string; aside?: string; children: ReactNode }>) {
  return (
    <Box component='section' aria-label={title} sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 2 }}>
        <Typography variant='subtitle2' fontWeight={600} noWrap>{title}</Typography>
        {aside && <Typography variant='body2' color='text.secondary' noWrap>{aside}</Typography>}
      </Box>
      {children}
    </Box>
  )
}

/**
 * An observed flow in a centred dialog: what it is (verdict, service, hits, first and last time, the sample pair of
 * addresses), the traffic between its two zones over the last 24 hours, one bar per hour (the history the tab already
 * read: no new request), its latest occurrences with the guests they reached (the engine's memory, read when the
 * dialog opens, no Proxmox call), and the actions of a pending flow.
 */
export default function ObservedFlowDialog({ connectionId, suggestion: s, zones, source, destination, busy, onResolve, onClose }: Readonly<Props>) {
  const t = useTranslations('microsegPilot.observation')
  const format = useFormatter()
  const when = (iso: string) => formatWhen(format, iso)

  const srcZone = s.src_zone_id ? zones.get(s.src_zone_id)?.name ?? '' : ''
  const dstZone = s.dst_zone_id ? zones.get(s.dst_zone_id)?.name ?? '' : ''
  const service = serviceLabel(s.proto, s.dport)
  const colour = s.kind === 'blocked' ? 'info.main' : 'error.main'

  const { traffic, failed } = useZoneUncovered(connectionId)
  const series = traffic && dstZone ? flowTrafficSeries(traffic, dstZone, srcZone, s.kind) : null
  const from = traffic ? Date.parse(traffic.from) : 0
  const stepMs = (traffic?.step ?? 3600) * 1000
  const hour = (i: number) => format.dateTime(new Date(from + i * stepMs), { hour: '2-digit', minute: '2-digit' })
  const total = series?.reduce((a, b) => a + b, 0) ?? null

  const events = useMicrosegEvents(connectionId, { zone: dstZone, verdict: s.kind, q: String(s.dport) }, !!dstZone)
  const recent = events.events.filter(e => eventOfFlow(e, s, srcZone, dstZone)).slice(0, RECENT_SHOWN)
  // How far back the engine's memory went for this read (newest first): the oldest event it returned.
  const oldest = events.events.at(-1)?.ts ?? null

  return (
    <Dialog open onClose={onClose} maxWidth='md' fullWidth aria-labelledby='microseg-flow-title'>
      {/* Its own id: without one, DialogTitle takes the dialog's aria-labelledby id and the name gets the chips too. */}
      <DialogTitle id='microseg-flow-heading' sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, pr: 1 }}>
        <ObservedKindGlyph kind={s.kind} />
        {/* The dialog is named by the title text alone, not by the chips and the close button beside it. */}
        <Box component='span' id='microseg-flow-title' sx={{ flex: '1 1 0', minWidth: 0, display: 'flex' }}>
          <TruncatedText text={t('dialog.title', { source, destination, service })} fontWeight={600} sx={{ minWidth: 0 }} />
        </Box>
        <Chip size='small' variant='outlined' color={s.kind === 'blocked' ? 'info' : 'error'} label={t(`kind.${s.kind}`)} sx={{ flexShrink: 0 }} />
        {s.status !== 'pending' && <Chip size='small' variant='outlined' label={t(`status.${s.status}`)} sx={{ flexShrink: 0 }} />}
        <IconButton size='small' aria-label={t('dialog.close')} onClick={onClose}><i className='ri-close-line' /></IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, minWidth: 0 }}>
        <Section title={t('dialog.summary')}>
          <Line label={t('dialog.service')}>{serviceTitle(s.proto, s.dport)}</Line>
          <Line label={t('dialog.hits')}>{format.number(s.hits)}</Line>
          <Line label={t('dialog.firstSeen')}>{when(s.first_seen)}</Line>
          <Line label={t('dialog.lastSeen')}>{when(s.last_seen)}</Line>
          <Line label={t('dialog.addresses')}>{`${s.src_ip || t('unknownEndpoint')} → ${s.dst_ip || t('unknownEndpoint')}`}</Line>
          <Typography variant='caption' color='text.secondary'>{t('detail.sampleNote')}</Typography>
        </Section>

        {!failed && dstZone && (
          <Section title={t('dialog.trafficTitle')} aside={total === null ? undefined : t('dialog.trafficTotal', { count: total })}>
            <HourlyBars
              series={series}
              colour={colour}
              height={CHART_HEIGHT}
              ariaLabel={total === null ? t('dialog.trafficLoading') : t('dialog.trafficAria', { count: total })}
              barLabel={(i, n) => t('dialog.trafficBar', { from: hour(i), to: hour(i + 1), count: n })}
            />
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }} aria-hidden>
              <Typography variant='caption' color='text.secondary'>{traffic ? hour(0) : ''}</Typography>
              <Typography variant='caption' color='text.secondary'>{t('dialog.now')}</Typography>
            </Box>
            <Typography variant='caption' color='text.secondary'>
              {srcZone ? t('dialog.trafficScope', { source: srcZone, destination: dstZone }) : t('dialog.trafficScopeNoZone', { destination: dstZone })}
            </Typography>
          </Section>
        )}

        {dstZone && (
          <Section title={t('dialog.recentTitle')} aside={oldest ? t('dialog.recentSince', { time: when(oldest) }) : undefined}>
            {events.error && !events.events.length ? <MicrosegErrorAlert error={events.error} onRetry={events.reload} /> : null}
            {events.loading && !events.events.length && <CircularProgress size={18} />}
            {!events.loading && !events.error && recent.length === 0 && (
              <Typography variant='body2' color='text.secondary'>{t('dialog.recentEmpty')}</Typography>
            )}
            {recent.length > 0 && (
              <Table size='small' aria-label={t('dialog.recentTitle')}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={CELL_SX}>{t('dialog.colTime')}</TableCell>
                    <TableCell sx={CELL_SX}>{t('dialog.colSource')}</TableCell>
                    <TableCell sx={CELL_SX}>{t('dialog.colGuest')}</TableCell>
                    <TableCell sx={CELL_SX}>{t('dialog.colNode')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {recent.map(e => (
                    <TableRow key={e.seq} data-event={e.seq}>
                      <TableCell sx={CELL_SX}>{when(e.ts)}</TableCell>
                      <TableCell sx={CELL_SX}>{e.src_ip || t('unknownEndpoint')}</TableCell>
                      <TableCell sx={{ ...CELL_SX, maxWidth: 260 }}>
                        <TruncatedText text={t('dialog.guest', { name: e.guest || String(e.vmid), vmid: e.vmid, ip: e.dst_ip || '-' })} variant='body2' />
                      </TableCell>
                      <TableCell sx={CELL_SX}>{e.node}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5, gap: 1 }}>
        {s.status === 'pending' && <FlowActions suggestion={s} source={source} destination={destination} busy={busy} onResolve={onResolve} variant='buttons' />}
        <Button onClick={onClose} sx={{ ml: 'auto' }}>{t('dialog.close')}</Button>
      </DialogActions>
    </Dialog>
  )
}
