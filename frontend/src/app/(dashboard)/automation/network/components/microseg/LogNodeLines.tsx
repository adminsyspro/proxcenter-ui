import { Box, Typography } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import type { MicrosegLogNode } from '@/lib/microseg/types'

/** The lag unit and how many of it: seconds up to 120 s, then minutes up to 120 min, then hours. */
export function lagParts(seconds: number): { unit: 'second' | 'minute' | 'hour'; count: number } {
  const s = Math.max(0, Math.round(seconds))
  if (s <= 120) return { unit: 'second', count: s }
  const m = Math.round(s / 60)
  return m <= 120 ? { unit: 'minute', count: m } : { unit: 'hour', count: Math.round(m / 60) }
}

/** The log reader of each node on one line each: its rate over 15 minutes and how far behind the log it reads. */
export default function LogNodeLines({ nodes }: { nodes: readonly MicrosegLogNode[] }) {
  const t = useTranslations('microsegPilot.banner')
  const format = useFormatter()
  return (
    <Box>
      {nodes.map(n => {
        const { unit, count } = lagParts(n.lag_seconds)
        return (
          <Typography key={n.node} variant='caption' sx={{ display: 'block', whiteSpace: 'nowrap' }}>
            {t('logNode', { node: n.node, rate: format.number(Math.round(n.lines_per_min_15m)), lag: format.number(count, { style: 'unit', unit, unitDisplay: 'short' }) })}
          </Typography>
        )
      })}
    </Box>
  )
}
