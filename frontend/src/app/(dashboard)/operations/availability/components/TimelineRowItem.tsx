'use client'

import { memo, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'

import { useFormatter, useTranslations } from 'next-intl'
import { Box, Popover, Tooltip, Typography } from '@mui/material'
import type { Theme } from '@mui/material/styles'

import type { AvailabilityState, Result, Slot } from '@/lib/availability/types'

import { useOutageMatches, type OutageMatch } from '../hooks/useOutageMatches'

import { stateRun, useAvailabilityFormat } from './availabilityFormat'
import BarDetail from './BarDetail'
import RowGlyph from './RowGlyph'
import { STATES, stateColor } from './stateColors'
import { maxBarsFor, statusBars, type StatusBar } from './statusBars'

export interface TimelineRow {
  label: string
  result: Result
  /** Guest rows: `lxc` for a container, a VM otherwise. */
  guestType?: string
}

// One flex child per bar, colored from the row's own selectors: no per-bar sx,
// no Tooltip, one pointer handler on the row. A module-level function of the
// theme: built once, not per render. Thin upright bars 2 px apart, the strip
// rounded at both ends, as on a status page; the bar under the pointer stays
// lit while the others dim.
const barSx = (theme: Theme) => ({
  display: 'flex',
  columnGap: '2px',
  height: 32,
  '& > span': { flex: '1 1 0', minWidth: 0, borderRadius: '1px', transition: 'opacity 120ms' },
  '& > span:first-of-type': { borderStartStartRadius: 4, borderEndStartRadius: 4 },
  '& > span:last-of-type': { borderStartEndRadius: 4, borderEndEndRadius: 4 },
  '&:hover > span': { opacity: 0.5 },
  '& > span:hover': { opacity: 1 },
  ...Object.fromEntries(STATES.map(s => [`& > span[data-state="${s}"]`, { backgroundColor: barColor(theme, s) }])),
})

/** The bars a row of the element holds, from its width; MAX_BARS until it is measured (or without ResizeObserver). */
function useMaxBars() {
  const ref = useRef<HTMLDivElement>(null)
  const [maxBars, setMaxBars] = useState(() => maxBarsFor(0))

  useEffect(() => {
    const el = ref.current

    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => setMaxBars(maxBarsFor(entry.contentRect.width)))

    observer.observe(el)

    return () => observer.disconnect()
  }, [])

  return { ref, maxBars }
}

/** Fill of a bar or a legend mark: a period never seen is an empty grey bar, not a hole. */
export const barColor = (theme: Theme, state: AvailabilityState) => (state === 'absent' ? theme.palette.action.hover : stateColor(theme, state))

export const dotSx = (state: Slot['state']) => (theme: Theme) => ({
  width: 4,
  height: 12,
  borderRadius: '1px',
  flexShrink: 0,
  backgroundColor: barColor(theme, state),
})

// The current state, worded on the right of the row in its own color.
const STATE_TEXT_COLOR: Partial<Record<AvailabilityState, string>> = { up: 'success.main', down: 'error.main', maintenance: 'info.main' }

// The outages of a bar listed in its tooltip before folding the rest into a count.
const SHOWN_RUNS = 3

// The bars of a row, apart so that hovering the row (a state change) does not
// recreate them.
const BarCells = memo(function BarCells({ bars }: Readonly<{ bars: StatusBar[] }>) {
  return <>{bars.map((bar, i) => <span key={bar.start} data-i={i} data-state={bar.state} />)}</>
})

/** The distinct incidents of the matches, then their distinct alerts. */
function registerOf(matches: OutageMatch[]) {
  const incidents = [...new Map(matches.flatMap(m => (m.incident ? [[m.incident.id, m.incident] as const] : []))).values()]
  const alerts = [...new Map(matches.flatMap(m => m.alerts.map(a => [a.id, a] as const))).values()]

  return { incidents, alerts }
}

interface Props {
  row: TimelineRow
  /** End of the queried window, RFC 3339: no period ends after it. */
  to?: string
  /** False for a range picked by hand: the row ends at a date, not now. */
  live?: boolean
  /** A summary of several rows: a click shows those rows instead of the detail of the bar. */
  onExpand?: () => void
}

// Re-rendering a row is cheap: its bars only change with its result.
function TimelineRowItem({ row, to, live = true, onExpand }: Readonly<Props>) {
  const t = useTranslations('availability')
  const format = useFormatter()
  const { rate, dateTime, duration, ago } = useAvailabilityFormat()
  const [hovered, setHovered] = useState<number | null>(null)
  // The bar clicked, and the element its detail hangs from.
  const [selected, setSelected] = useState<{ index: number; anchor: HTMLElement } | null>(null)
  const { result } = row
  const { ref: barsRef, maxBars } = useMaxBars()
  const bars = useMemo(() => statusBars(result.slots, to, maxBars), [result.slots, to, maxBars])
  const last = result.slots[result.slots.length - 1]?.state ?? 'absent'
  const summary = result.availability === null
    ? t('timeline.rowSummaryUnmeasured', { label: row.label })
    : t('timeline.rowSummary', {
      label: row.label,
      availability: rate(result.availability),
      incidents: result.incidents.length,
    })
  const bar = hovered === null ? null : bars[hovered] ?? null
  // The outages of the bar under the pointer, whole: a bar is a few slots, the
  // run of down slots is what tells when each outage began and ended.
  const runs = bar ? bar.downStarts.map(i => stateRun(result.slots, result.slots[i], to)) : []
  // A summary row stands for no single object: no register to look up.
  const outages = onExpand ? [] : runs.map(run => ({
    connection_id: result.ref.connection_id, kind: result.ref.kind, node: result.ref.node ?? '', vmid: result.ref.vmid ?? 0, from: run.start, to: run.end,
  }))
  const { matches } = useOutageMatches(outages)
  const { incidents, alerts } = registerOf(matches ?? [])

  const lines = bar
    ? [
      t('timeline.bar', { from: dateTime(bar.start), to: dateTime(bar.end) }),
      bar.availability === null ? t(`states.${bar.state}`) : t('timeline.barRate', { availability: rate(bar.availability) }),
      ...runs.slice(0, SHOWN_RUNS).map(run =>
        t('timeline.run', { state: t(`states.${run.state}`), from: dateTime(run.start), to: dateTime(run.end), duration: duration(run.start, run.end) })),
      runs.length > SHOWN_RUNS ? t('timeline.moreOutages', { count: runs.length - SHOWN_RUNS }) : null,
      ...incidents.map(i => t('timeline.incident', { title: i.title, comments: i.comment_count })),
      incidents.length === 0 && alerts.length > 0 ? t('timeline.alertsNoIncident', { count: alerts.length }) : null,
      t(onExpand ? 'timeline.detail.hintHosts' : 'timeline.detail.hint'),
    ].filter((line): line is string => line !== null)
    : []

  const selectedBar = selected ? bars[selected.index] ?? null : null
  // A range picked by hand: its bounds as dates, not "30 days ago" and "now".
  const past = !live
  const short = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' })

  const onClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement
    const index = target.dataset?.i

    if (index === undefined) return
    if (onExpand) onExpand()
    else setSelected({ index: Number(index), anchor: target })
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, mb: 1 }}>
        <RowGlyph kind={result.ref.kind} guestType={row.guestType} state={last} />
        <Typography variant='body1' noWrap sx={{ fontWeight: 500 }}>{row.label}</Typography>
        <Typography variant='body2' noWrap sx={{ marginInlineStart: 'auto', fontWeight: 500, color: STATE_TEXT_COLOR[last] ?? 'text.secondary' }}>
          {t(`states.${last}`)}
        </Typography>
      </Box>
      <Tooltip
        followCursor
        open={bar !== null && selected === null}
        title={lines.map((line, i) => <div key={i}>{line}</div>)}
      >
        <Box
          ref={barsRef}
          role='img'
          aria-label={summary}
          sx={[barSx, { cursor: 'pointer' }]}
          onClick={onClick}
          onMouseMove={event => {
            const index = (event.target as HTMLElement).dataset?.i

            // Between two bars the pointer is on the row: the last bar stays.
            if (index !== undefined && Number(index) !== hovered) setHovered(Number(index))
          }}
          onMouseLeave={() => setHovered(null)}
        >
          <BarCells bars={bars} />
        </Box>
      </Tooltip>
      <Popover
        open={selectedBar !== null}
        anchorEl={selected?.anchor}
        onClose={() => setSelected(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        transformOrigin={{ vertical: 'top', horizontal: 'center' }}
        slotProps={{ paper: { sx: { mt: 1 } } }}
      >
        {selectedBar && <BarDetail result={result} bar={selectedBar} to={to} onClose={() => setSelected(null)} />}
      </Popover>
      {bars.length > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 1 }}>
          <Typography variant='body2' color='text.secondary' noWrap>{past ? short(bars[0].start) : ago(bars[0].start, bars[bars.length - 1].end)}</Typography>
          <Box sx={{ flex: 1, borderTop: 1, borderColor: 'divider' }} />
          <Typography variant='body2' color='text.secondary' noWrap>
            {result.availability === null ? t('connection.notMeasured') : t('timeline.barRate', { availability: rate(result.availability) })}
          </Typography>
          <Box sx={{ flex: 1, borderTop: 1, borderColor: 'divider' }} />
          <Typography variant='body2' color='text.secondary' noWrap>{past ? short(bars[bars.length - 1].end) : t('timeline.now')}</Typography>
        </Box>
      )}
    </Box>
  )
}

export default memo(
  TimelineRowItem,
  (a, b) => a.row.result === b.row.result && a.row.label === b.row.label && a.row.guestType === b.row.guestType && a.to === b.to && a.live === b.live && a.onExpand === b.onExpand,
)
