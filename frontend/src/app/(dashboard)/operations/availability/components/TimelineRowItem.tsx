'use client'

import { memo, useState } from 'react'
import type { MouseEvent } from 'react'

import { useTranslations } from 'next-intl'
import { Box, Tooltip, Typography } from '@mui/material'
import type { Theme } from '@mui/material/styles'

import type { Result, Slot } from '@/lib/availability/types'

import { stateRun, useAvailabilityFormat } from './availabilityFormat'
import RowGlyph from './RowGlyph'
import { STATES, stateColor } from './stateColors'

export interface TimelineRow {
  label: string
  result: Result
  /** Guest rows: `lxc` for a container, a VM otherwise. */
  guestType?: string
}

// One flex child per slot, colored from the row's own selectors: with 1440
// slots a row, no per-slot sx, no Tooltip, one click handler on the row. A
// module-level function of the theme: built once, not per render.
const barSx = (theme: Theme) => ({
  display: 'flex',
  height: 22,
  borderRadius: 0.5,
  overflow: 'hidden',
  '& > span': { flex: '1 1 0', minWidth: 0 },
  ...Object.fromEntries(
    STATES.map(s => [
      `& > span[data-state="${s}"]`,
      s === 'absent'
        ? { backgroundColor: 'transparent', borderTop: `1px solid ${theme.palette.divider}`, borderBottom: `1px solid ${theme.palette.divider}` }
        : { backgroundColor: stateColor(theme, s) },
    ]),
  ),
})

export const dotSx = (state: Slot['state']) => (theme: Theme) => ({
  width: 8,
  height: 8,
  borderRadius: '50%',
  flexShrink: 0,
  backgroundColor: stateColor(theme, state),
  ...(state === 'absent' ? { border: `1px solid ${theme.palette.divider}` } : {}),
})

/** Index of the slot under the pointer, null off the bar. */
function slotIndex(event: MouseEvent<HTMLElement>, count: number): number | null {
  const rect = event.currentTarget.getBoundingClientRect()

  if (count === 0 || rect.width <= 0) return null

  const index = Math.floor(((event.clientX - rect.left) / rect.width) * count)

  return Math.min(count - 1, Math.max(0, index))
}

// The 1440 spans of a row, apart so that hovering the row (a state change)
// does not recreate them.
const SlotCells = memo(function SlotCells({ slots }: { slots: Slot[] }) {
  return <>{slots.map(slot => <span key={slot.start} data-state={slot.state} />)}</>
})

interface Props {
  row: TimelineRow
  /** End of the queried window, RFC 3339: no period ends after it. */
  to?: string
}

// Re-rendering a row is cheap: its spans only change with its result.
function TimelineRowItem({ row, to }: Props) {
  const t = useTranslations('availability')
  const { rate, dateTime, duration } = useAvailabilityFormat()
  const [hovered, setHovered] = useState<number | null>(null)
  const { result } = row
  const last = result.slots[result.slots.length - 1]?.state ?? 'absent'
  const summary = result.availability === null
    ? t('timeline.rowSummaryUnmeasured', { label: row.label })
    : t('timeline.rowSummary', {
      label: row.label,
      availability: rate(result.availability),
      incidents: result.incidents.length,
    })
  // The period the row stayed in the state under the pointer: one slot of a
  // 24 h row is a minute, the run is what tells when an outage began and ended.
  const run = hovered === null ? null : stateRun(result.slots, result.slots[hovered], to)

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 200px) 72px 1fr', alignItems: 'center', columnGap: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <RowGlyph kind={result.ref.kind} guestType={row.guestType} state={last} />
        <Typography variant='body2' noWrap>{row.label}</Typography>
      </Box>
      <Typography variant='body2' color='text.secondary' sx={{ textAlign: 'end' }}>
        {result.availability === null ? t('connection.notMeasured') : rate(result.availability)}
      </Typography>
      <Tooltip
        followCursor
        open={run !== null}
        title={run ? t('timeline.run', { state: t(`states.${run.state}`), from: dateTime(run.start), to: dateTime(run.end), duration: duration(run.start, run.end) }) : ''}
      >
        <Box
          role='img'
          aria-label={summary}
          sx={barSx}
          onMouseMove={event => {
            const index = slotIndex(event, result.slots.length)

            if (index !== hovered) setHovered(index)
          }}
          onMouseLeave={() => setHovered(null)}
        >
          <SlotCells slots={result.slots} />
        </Box>
      </Tooltip>
    </Box>
  )
}

export default memo(
  TimelineRowItem,
  (a, b) => a.row.result === b.row.result && a.row.label === b.row.label && a.row.guestType === b.row.guestType && a.to === b.to,
)
