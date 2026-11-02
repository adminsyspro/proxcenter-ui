'use client'

import { Box, Tooltip, Typography } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import { SLOW_OSD_MIN_MS } from '@/lib/ceph/perfSeries'

import type { OsdLatencyPoint } from './hooks/useCephOsdLatencySeries'
import { Sparkline, TABULAR } from './ui'

/** Min / mean / max of a window: the lowest step mean, the mean of the step means, the highest step max. */
export function latencyWindow(points: readonly OsdLatencyPoint[]): { min: number; avg: number; max: number } {
  const avgs = points.map(p => p.avg)

  return { min: Math.min(...avgs), avg: avgs.reduce((s, v) => s + v, 0) / avgs.length, max: Math.max(...points.map(p => p.max)) }
}

/**
 * Compact latency curve of an OSD (64 x 18 px, straight segments). Neutral, orange when the last
 * value is at or above the slow OSD floor. Under 2 points: a discreet "collecting" text.
 * The tooltip gives the min / mean / max of the window, and says when the curve is the session's own.
 */
export default function OsdLatencyTrend({ points, session }: { points: readonly OsdLatencyPoint[] | undefined; session: boolean }) {
  const t = useTranslations('cephCockpit')
  const format = useFormatter()

  if (!points || points.length < 2) {
    return <Typography component='span' data-testid='osd-trend-collecting' variant='caption' color='text.disabled' sx={{ whiteSpace: 'nowrap' }}>{t('osd.trend.collecting')}</Typography>
  }

  const w = latencyWindow(points)
  const slow = points[points.length - 1].avg >= SLOW_OSD_MIN_MS
  const n = (v: number) => format.number(v, { maximumFractionDigits: 1 })
  const label = t(session ? 'osd.trend.tooltipSession' : 'osd.trend.tooltip', { min: n(w.min), avg: n(w.avg), max: n(w.max) })

  return (
    <Tooltip title={label}>
      <Box
        component='span'
        role='img'
        aria-label={label}
        data-testid='osd-trend'
        data-slow={slow ? 'true' : 'false'}
        sx={{ display: 'inline-block', width: 64, height: 18, flexShrink: 0, ...TABULAR }}
      >
        <Sparkline data={points.map(p => p.avg)} tone={slow ? 'warning' : 'neutral'} height={18} minExtent={Math.max(w.max, SLOW_OSD_MIN_MS)} />
      </Box>
    </Tooltip>
  )
}
