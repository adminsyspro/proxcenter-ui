'use client'

import { useState } from 'react'
import { Box, Paper, Skeleton, ToggleButton, ToggleButtonGroup, Typography, alpha, useTheme } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import type { BlockPhase } from './dashboardModel'
import { BUCKET_MS, type PostureTimeline, type TimelineVerdict } from './postureTimeline'
import { objectDotSx } from './microseg/objectColour'
import { useBoxSize } from './microseg/useBoxSize'
import { useSliceName } from './TrafficByZone'

type Props = {
  phase: BlockPhase
  timeline: PostureTimeline
  verdict: TimelineVerdict
  onVerdict: (verdict: TimelineVerdict) => void
}

export const TIMELINE_HEIGHT = 160
const LEFT = 36
const RIGHT = 4
const TOP = 8
const BOTTOM = 20
/** Before the box is measured (and where the browser cannot measure it). */
const FALLBACK_WIDTH = 600
const TIP_WIDTH = 220
const VERDICTS: readonly TimelineVerdict[] = ['all', 'would_block', 'blocked']
const VERDICT_LABEL: Record<TimelineVerdict, string> = { all: 'postureTimelineAll', would_block: 'postureWouldBlock', blocked: 'postureBlocked' }

/** About five time labels under the bars, never two on the same bucket. */
function tickIndexes(count: number): number[] {
  if (count <= 1) return [0]
  return [...new Set([0, 1, 2, 3, 4].map(k => Math.round((k * (count - 1)) / 4)))]
}

/** The stacked bars of the buckets, with the scale, the time labels and the breakdown of the bucket under the pointer. */
function Bars({ timeline, width }: { timeline: PostureTimeline; width: number }) {
  const theme = useTheme()
  const format = useFormatter()
  const t = useTranslations('networkPage.dashboard')
  const nameOf = useSliceName()
  const [hover, setHover] = useState<number | null>(null)
  const { buckets, series, max } = timeline
  const plotW = Math.max(40, width - LEFT - RIGHT)
  const plotH = TIMELINE_HEIGHT - TOP - BOTTOM
  const bw = plotW / buckets.length
  const gap = bw > 4 ? 1 : 0
  const scale = max > 0 ? plotH / max : 0
  const clock = (at: number) => format.dateTime(new Date(at), { hour: '2-digit', minute: '2-digit' })
  const hovered = hover === null ? null : buckets[hover]
  const tipLeft = hover === null ? 0 : Math.min(Math.max(0, LEFT + hover * bw - TIP_WIDTH / 2), Math.max(0, width - TIP_WIDTH))

  return (
    <>
      <svg width={width} height={TIMELINE_HEIGHT} role='img' aria-label={t('postureTimelineLabel')} style={{ display: 'block' }} onMouseLeave={() => setHover(null)}>
        <line x1={LEFT} x2={LEFT + plotW} y1={TOP} y2={TOP} stroke={alpha(theme.palette.text.primary, 0.08)} />
        <line x1={LEFT} x2={LEFT + plotW} y1={TOP + plotH} y2={TOP + plotH} stroke={alpha(theme.palette.text.primary, 0.2)} />
        <text x={LEFT - 6} y={TOP + 4} textAnchor='end' fontSize={10} fill={theme.palette.text.secondary} data-testid='timeline-max'>{format.number(max, { notation: 'compact' })}</text>
        <text x={LEFT - 6} y={TOP + plotH} textAnchor='end' fontSize={10} fill={theme.palette.text.secondary}>0</text>
        {buckets.map((b, i) => {
          let y = TOP + plotH
          const x = LEFT + i * bw
          return (
            <g key={b.start} data-testid={`bucket-${i}`} opacity={hover === null || hover === i ? 1 : 0.55}>
              {series.map(s => {
                const count = b.counts[s.key] ?? 0
                if (!count) return null
                const h = count * scale
                y -= h
                return <rect key={s.key} x={x + gap / 2} y={y} width={Math.max(1, bw - gap)} height={h} fill={s.color} />
              })}
              <rect x={x} y={TOP} width={bw} height={plotH} fill='transparent' onMouseEnter={() => setHover(i)} data-testid={`bucket-hit-${i}`} />
            </g>
          )
        })}
        {tickIndexes(buckets.length).map(i => (
          <text key={i} x={LEFT + (i + 0.5) * bw} y={TIMELINE_HEIGHT - 4} textAnchor='middle' fontSize={10} fill={theme.palette.text.secondary}>{clock(buckets[i].start)}</text>
        ))}
      </svg>
      {hovered && (
        <Paper data-testid='timeline-tip' elevation={4} sx={{ position: 'absolute', top: 0, left: tipLeft, width: TIP_WIDTH, p: 1, pointerEvents: 'none', zIndex: 1 }}>
          <Typography variant='caption' component='div' sx={{ fontWeight: 700, mb: 0.5 }}>
            {`${clock(hovered.start)} - ${clock(hovered.start + BUCKET_MS)} · ${t('postureTimelineEvents', { count: hovered.total })}`}
          </Typography>
          {series.filter(s => hovered.counts[s.key]).map(s => (
            <Box key={s.key} sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
              <Box sx={objectDotSx(s.color)} />
              <Typography variant='caption' noWrap sx={{ flex: 1, minWidth: 0 }}>{nameOf(s)}</Typography>
              <Typography variant='caption' sx={{ fontWeight: 600 }}>{format.number(hovered.counts[s.key])}</Typography>
            </Box>
          ))}
        </Paper>
      )}
    </>
  )
}

/**
 * The observed traffic over time, under the donut: the events of the orchestrator's memory per 5-minute bucket,
 * stacked per group of the donut in its colours, a verdict toggle, and the window the memory covers.
 */
export default function TrafficTimeline({ phase, timeline, verdict, onVerdict }: Props) {
  const t = useTranslations('networkPage.dashboard')
  const [ref, size] = useBoxSize<HTMLDivElement>()

  let body: React.ReactNode
  if (phase === 'loading') body = <Skeleton data-testid='timeline-loading' variant='rounded' height={TIMELINE_HEIGHT} />
  else if (phase === 'unavailable') body = <Typography variant='body2' color='text.secondary' data-testid='timeline-unavailable'>{t('postureTimelineUnavailable')}</Typography>
  else if (timeline.total === 0) body = <Typography variant='body2' color='text.secondary' data-testid='timeline-empty'>{t('postureTimelineEmpty')}</Typography>
  else body = <Bars timeline={timeline} width={size?.width ?? FALLBACK_WIDTH} />

  return (
    <Box data-testid='timeline' sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        <Typography variant='subtitle2' component='h3' sx={{ fontWeight: 700 }}>{t('postureTimelineTitle')}</Typography>
        {timeline.windowMinutes !== null && (
          <Typography variant='caption' color='text.secondary' data-testid='timeline-caption'>{t('postureTimelineWindow', { minutes: timeline.windowMinutes })}</Typography>
        )}
        <ToggleButtonGroup
          size='small'
          exclusive
          value={verdict}
          onChange={(_, next: TimelineVerdict | null) => { if (next) onVerdict(next) }}
          aria-label={t('postureTimelineVerdict')}
          sx={{ ml: 'auto', '& .MuiToggleButton-root': { py: 0.25, px: 1, textTransform: 'none', fontSize: 12 } }}
        >
          {VERDICTS.map(v => <ToggleButton key={v} value={v}>{t(VERDICT_LABEL[v])}</ToggleButton>)}
        </ToggleButtonGroup>
      </Box>
      <Box ref={ref} sx={{ position: 'relative', width: '100%', minWidth: 0 }}>{body}</Box>
    </Box>
  )
}
