'use client'

import { useTranslations } from 'next-intl'
import { Box, Button, IconButton, Tooltip, Typography } from '@mui/material'

import type { AvailabilityState, Result, Slot } from '@/lib/availability/types'

import { useIncidentsEnabled } from '@/components/incidents/useIncidentsEnabled'

import { useOutageMatches } from '../hooks/useOutageMatches'

import { slotEnd, stateRun, useAvailabilityFormat } from './availabilityFormat'
import { useIncidentDialog } from './IncidentDialogContext'
import { stateColor } from './stateColors'
import type { StatusBar } from './statusBars'

/** The states a bar spends time in, in the order the detail lists them. */
const SPENT: readonly AvailabilityState[] = ['up', 'down', 'maintenance', 'unobserved']

/** The states worth an event line: anything but a calm, seen period. */
const EVENT_STATES = new Set<AvailabilityState>(['down', 'maintenance', 'unobserved'])

const mark = (state: AvailabilityState) => ({
  width: 8,
  height: 8,
  borderRadius: '2px',
  flexShrink: 0,
  bgcolor: (theme: Parameters<typeof stateColor>[0]) => (state === 'absent' ? theme.palette.action.hover : stateColor(theme, state)),
})

interface Props {
  result: Result
  bar: StatusBar
  /** End of the queried window, RFC 3339: no period ends after it. */
  to?: string
  onClose: () => void
}

/** What a bar holds: time per state, its slots one by one, and each outage or maintenance with its incident. */
export default function BarDetail({ result, bar, to, onClose }: Readonly<Props>) {
  const t = useTranslations('availability')
  const { rate, dateTime, duration, span } = useAvailabilityFormat()
  const incidentsEnabled = useIncidentsEnabled()
  const { open } = useIncidentDialog()

  const slots = result.slots.slice(bar.first, bar.first + bar.count)
  const spent = new Map<AvailabilityState, number>()

  for (const s of slots) {
    spent.set(s.state, (spent.get(s.state) ?? 0) + (Date.parse(slotEnd(result.slots, s, to)) - Date.parse(s.start)) / 1000)
  }

  // Each event of the bar whole: an outage begun before the bar or ending after it keeps its real bounds.
  const events = slots
    .filter((s, i) => EVENT_STATES.has(s.state) && (i === 0 || slots[i - 1].state !== s.state))
    .map((s: Slot) => stateRun(result.slots, s, to))
  const downs = events.filter(e => e.state === 'down')
  const { matches } = useOutageMatches(downs.map(run => ({
    connection_id: result.ref.connection_id, kind: result.ref.kind, node: result.ref.node ?? '', vmid: result.ref.vmid ?? 0, from: run.start, to: run.end,
  })))

  const viewIncident = (incidentId: string) => {
    onClose()
    open(incidentId)
  }

  const openIncident = (alertId: string) => {
    onClose()
    open(null, alertId)
  }

  return (
    <Box role='region' aria-label={t('timeline.detail.title')} sx={{ p: 4, width: 420, maxWidth: 'calc(100vw - 32px)', display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant='subtitle2'>{t('timeline.bar', { from: dateTime(bar.start), to: dateTime(bar.end) })}</Typography>
          <Typography variant='body2' color='text.secondary'>
            {bar.availability === null ? t(`states.${bar.state}`) : t('timeline.barRate', { availability: rate(bar.availability) })}
          </Typography>
        </Box>
        <IconButton size='small' aria-label={t('timeline.detail.close')} onClick={onClose}>
          <i className='ri-close-line' aria-hidden='true' />
        </IconButton>
      </Box>

      <Box>
        <Box role='img' aria-label={t('timeline.detail.slots')} sx={{ display: 'flex', gap: '1px', height: 16 }}>
          {slots.map(s => (
            <Tooltip key={s.start} title={`${dateTime(s.start)} · ${t(`states.${s.state}`)}`} disableInteractive>
              <Box sx={{ ...mark(s.state), flex: '1 1 0', width: 'auto', height: '100%', minWidth: 0, borderRadius: '1px' }} />
            </Tooltip>
          ))}
        </Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 3, rowGap: 0.5, mt: 1.5 }}>
          {SPENT.filter(s => spent.get(s)).map(s => (
            <Box key={s} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={mark(s)} />
              <Typography variant='caption' color='text.secondary'>{t('timeline.detail.spent', { state: t(`states.${s}`), duration: span(spent.get(s) ?? 0) })}</Typography>
            </Box>
          ))}
        </Box>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography variant='overline' color='text.secondary' sx={{ lineHeight: 1.5 }}>{t('timeline.detail.events')}</Typography>
        {events.length === 0 && <Typography variant='body2' color='text.secondary'>{t('timeline.detail.none')}</Typography>}
        {events.map(run => {
          const match = run.state === 'down' ? matches?.[downs.indexOf(run)] : undefined

          return (
            <Box key={`${run.state}-${run.start}`} sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Box sx={mark(run.state)} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant='body2' sx={{ fontWeight: 500 }}>{t(`states.${run.state}`)} · {duration(run.start, run.end)}</Typography>
                <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>
                  {t('timeline.bar', { from: dateTime(run.start), to: dateTime(run.end) })}
                </Typography>
                {match?.incident && (
                  <Typography variant='caption' color='text.secondary' noWrap sx={{ display: 'block' }}>{match.incident.title}</Typography>
                )}
              </Box>
              {incidentsEnabled && match?.incident && (
                <Button size='small' variant='outlined' onClick={() => match.incident && viewIncident(match.incident.id)}>{t('timeline.detail.viewIncident')}</Button>
              )}
              {incidentsEnabled && match && !match.incident && match.alerts.length > 0 && (
                <Button size='small' variant='outlined' onClick={() => openIncident(match.alerts[0].id)}>{t('timeline.detail.openIncident')}</Button>
              )}
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
