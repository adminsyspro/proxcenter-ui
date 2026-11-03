'use client'

import { useState } from 'react'
import { Box, Paper, Skeleton, Tab, Tabs, ToggleButton, ToggleButtonGroup, Typography, alpha, useTheme } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import { formatBytes } from '@/utils/format'

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
  /** The sFlow bytes of the same groups, null when sFlow has nothing for the connection (no tab then). */
  volume?: PostureTimeline | null
  /** By zone the volume is what the members sent, by VLAN or node what the guests received. */
  volumeSent?: boolean
}

type Unit = 'events' | 'bytes'

export const TIMELINE_HEIGHT = 160
const LEFT = 36
const RIGHT = 4
const TOP = 8
const BOTTOM = 20
/** The drawing width before the box is measured (and where the browser cannot measure it): scaled to 100 % of the card. */
const FALLBACK_WIDTH = 600
/** Past a day, the covered window is said in hours. */
const DAY_MINUTES = 24 * 60
const TIP_WIDTH = 220
const VERDICTS: readonly TimelineVerdict[] = ['all', 'would_block', 'blocked']
const VERDICT_LABEL: Record<TimelineVerdict, string> = { all: 'postureTimelineAll', would_block: 'postureWouldBlock', blocked: 'postureBlocked' }

/** About five time labels under the bars, never two on the same bucket. */
function tickIndexes(count: number): number[] {
  if (count <= 1) return [0]
  return [...new Set([0, 1, 2, 3, 4].map(k => Math.round((k * (count - 1)) / 4)))]
}

/** The stacked bars of the buckets, with the scale, the time labels and the breakdown of the bucket under the pointer. */
function Bars({ timeline, measured, unit }: { timeline: PostureTimeline; measured: number | null; unit: Unit }) {
  const width = measured ?? FALLBACK_WIDTH
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
  const value = (n: number) => (unit === 'bytes' ? formatBytes(n, 1) : format.number(n))
  const clock = (at: number) => format.dateTime(new Date(at), { hour: '2-digit', minute: '2-digit' })
  const hovered = hover === null ? null : buckets[hover]
  const tipLeft = hover === null ? 0 : Math.min(Math.max(0, LEFT + hover * bw - TIP_WIDTH / 2), Math.max(0, width - TIP_WIDTH))

  return (
    <>
      <svg
        width={measured ?? '100%'}
        height={measured ? TIMELINE_HEIGHT : undefined}
        viewBox={`0 0 ${width} ${TIMELINE_HEIGHT}`}
        role='img'
        aria-label={unit === 'bytes' ? t('postureVolumeLabel') : t('postureTimelineLabel')}
        style={{ display: 'block' }}
        onMouseLeave={() => setHover(null)}
      >
        <line x1={LEFT} x2={LEFT + plotW} y1={TOP} y2={TOP} stroke={alpha(theme.palette.text.primary, 0.08)} />
        <line x1={LEFT} x2={LEFT + plotW} y1={TOP + plotH} y2={TOP + plotH} stroke={alpha(theme.palette.text.primary, 0.2)} />
        <text x={LEFT - 6} y={TOP + 4} textAnchor='end' fontSize={10} fill={theme.palette.text.secondary} data-testid='timeline-max'>{unit === 'bytes' ? formatBytes(max, 0) : format.number(max, { notation: 'compact' })}</text>
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
            {`${clock(hovered.start)} - ${clock(hovered.start + BUCKET_MS)} · ${unit === 'bytes' ? value(hovered.total) : t('postureTimelineEvents', { count: hovered.total })}`}
          </Typography>
          {series.filter(s => hovered.counts[s.key]).map(s => (
            <Box key={s.key} sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
              <Box sx={objectDotSx(s.color)} />
              <Typography variant='caption' noWrap sx={{ flex: 1, minWidth: 0 }}>{nameOf(s)}</Typography>
              <Typography variant='caption' sx={{ fontWeight: 600 }}>{value(hovered.counts[s.key])}</Typography>
            </Box>
          ))}
        </Paper>
      )}
    </>
  )
}

/**
 * The observed traffic over time, under the donut: the events of the orchestrator's memory per 5-minute bucket,
 * stacked per group of the donut in its colours, a verdict toggle, and the window the memory covers. A second tab,
 * "Volume (sFlow)", shows the sFlow bytes of the same groups, only when sFlow has data for the connection.
 */
export default function TrafficTimeline({ phase, timeline, verdict, onVerdict, volume = null, volumeSent = true }: Props) {
  const t = useTranslations('networkPage.dashboard')
  const [ref, size] = useBoxSize<HTMLDivElement>()
  const [chosen, setChosen] = useState<Unit>('events')
  // The Volume tab only exists while sFlow has data for the connection.
  const unit: Unit = volume ? chosen : 'events'
  const measured = size?.width ?? null

  let body: React.ReactNode
  if (unit === 'bytes' && volume) body = volume.total > 0 ? <Bars timeline={volume} measured={measured} unit='bytes' /> : <Typography variant='body2' color='text.secondary' data-testid='volume-empty'>{t('postureVolumeEmpty')}</Typography>
  else if (phase === 'loading') body = <Skeleton data-testid='timeline-loading' variant='rounded' height={TIMELINE_HEIGHT} />
  else if (phase === 'unavailable') body = <Typography variant='body2' color='text.secondary' data-testid='timeline-unavailable'>{t('postureTimelineUnavailable')}</Typography>
  else if (timeline.total === 0) body = <Typography variant='body2' color='text.secondary' data-testid='timeline-empty'>{t('postureTimelineEmpty')}</Typography>
  else body = <Bars timeline={timeline} measured={measured} unit='events' />

  let caption: string | null = null
  if (unit === 'bytes') caption = volumeSent ? t('postureVolumeCaptionSent') : t('postureVolumeCaptionReceived')
  else if (timeline.windowMinutes !== null) {
    const minutes = timeline.windowMinutes
    caption = minutes > DAY_MINUTES ? t('postureTimelineWindowHours', { hours: Math.round(minutes / 60) }) : t('postureTimelineWindow', { minutes })
  }

  const title = volume ? (
    <Tabs value={unit} onChange={(_, next: Unit) => setChosen(next)} sx={{ minHeight: 32, '& .MuiTab-root': { minHeight: 32, py: 0.5, px: 1.5, textTransform: 'none' } }}>
      <Tab value='events' label={t('postureTimelineTitle')} />
      <Tab value='bytes' label={t('postureVolumeTab')} data-testid='volume-tab' />
    </Tabs>
  ) : (
    <Typography variant='subtitle2' component='h3' sx={{ fontWeight: 700 }}>{t('postureTimelineTitle')}</Typography>
  )

  return (
    <Box data-testid='timeline' sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        {title}
        {caption && <Typography variant='caption' color='text.secondary' data-testid='timeline-caption'>{caption}</Typography>}
        {unit === 'events' && (
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
        )}
      </Box>
      <Box ref={ref} sx={{ position: 'relative', width: '100%', minWidth: 0 }}>{body}</Box>
    </Box>
  )
}
