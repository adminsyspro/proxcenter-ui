'use client'

import { useTranslations } from 'next-intl'
import { Box, Typography } from '@mui/material'

import { STATES } from './stateColors'
import TimelineRowItem, { dotSx, type TimelineRow } from './TimelineRowItem'

export type { TimelineRow }

interface Props {
  rows: TimelineRow[]
  /** End of the queried window, RFC 3339. */
  to?: string
  /** False for a range picked by hand: the row ends at a date, not now. */
  live?: boolean
}

export default function AvailabilityTimeline({ rows, to, live = true }: Readonly<Props>) {
  const t = useTranslations('availability')

  return (
    <Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {rows.map(row => (
          <TimelineRowItem key={`${row.result.ref.kind}:${row.result.ref.node ?? ''}`} row={row} to={to} live={live} />
        ))}
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 2, rowGap: 0.5, mt: 1.5 }}>
        {STATES.map(state => (
          <Box key={state} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Box sx={dotSx(state)} />
            <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>{t(`states.${state}`)}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  )
}
