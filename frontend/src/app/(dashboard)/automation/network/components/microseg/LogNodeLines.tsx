import { Box, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { MicrosegLogNode } from '@/lib/microseg/types'

/** A lag in seconds up to 120 s, then in minutes up to 120 min, then in hours. */
export function lagText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s <= 120) return `${s} s`
  const m = Math.round(s / 60)
  return m <= 120 ? `${m} min` : `${Math.round(m / 60)} h`
}

/** The log reader of each node on one line each: its rate over 15 minutes and how far behind the log it reads. */
export default function LogNodeLines({ nodes }: { nodes: readonly MicrosegLogNode[] }) {
  const t = useTranslations('microsegPilot.banner')
  return (
    <Box>
      {nodes.map(n => (
        <Typography key={n.node} variant='caption' sx={{ display: 'block', whiteSpace: 'nowrap' }}>
          {t('logNode', { node: n.node, rate: Math.round(n.lines_per_min_15m), lag: lagText(n.lag_seconds) })}
        </Typography>
      ))}
    </Box>
  )
}
