'use client'

import { paletteAlpha } from './paletteAlpha'
import { useState } from 'react'
import { alpha, Box, Chip, FormControl, Link, MenuItem, Select, Skeleton, Tab, Tabs, ToggleButton, ToggleButtonGroup, Tooltip, Typography, useTheme } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import { SMALL_SELECT_SX } from '@/components/settings/destinations/DestinationDialogParts'
import { formatBytes } from '@/utils/format'

import type { BlockPhase } from './dashboardModel'
import { RANGE_LABEL, TIMELINE_RANGES, areaPaths, bucketXs, nearestBucket, type PostureTimeline, type TimelineRange, type TimelineVerdict } from './postureTimeline'
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
  /** The range of the chart (UA55), and how it is changed. */
  range: TimelineRange
  onRange: (range: TimelineRange) => void
  /**
   * Why the events chart cannot follow the range: its grouping needs guest-level events (only the orchestrator's memory
   * has them), or the history is not served by this orchestrator. Null when the range applies.
   */
  rangeLock?: 'grouping' | 'unavailable' | null
  /** The map panel's variant: lower, no title (the section header is it), the groups as a row of chips under it. */
  compact?: boolean
  /** Grows with the card it is in: the chart takes the free height, never under its usual height. */
  fill?: boolean
  /** A compact chart given room (a zone's details on the Policy sub-tab): taller than in a map panel, at a set height. */
  tall?: boolean
  /** Opens on the Volume (once sFlow measures it): a panel opened from the map, whose tooltips told the bytes. */
  volumeFirst?: boolean
  /** False for a chart of the orchestrator's memory only (a guest): no range chips. */
  showRange?: boolean
  /** A map panel's direction (inbound / outbound), on the line of the verdict; none on the Dashboard. */
  direction?: TimelineDirection
  onDirection?: (direction: TimelineDirection) => void
  /** What an empty chart says instead of the generic message (a guest of the map panel). */
  emptyText?: string
  /** No verdict toggle (nothing in any verdict). */
  hideVerdict?: boolean
  /** A way out of an empty chart, after its message (switch the direction). */
  emptyAction?: { label: string; onClick: () => void }
  /** Both directions (map panel): `timeline` inbound above the baseline, this one outbound under it. */
  mirror?: PostureTimeline | null
}

export type TimelineDirection = 'both' | 'in' | 'out'

type Unit = 'events' | 'bytes'

export const TIMELINE_HEIGHT = 160
export const COMPACT_TIMELINE_HEIGHT = 120
/** A compact chart grows with its width (a map panel, or the same panel in its expanded dialog), up to this height. */
export const COMPACT_TIMELINE_MAX_HEIGHT = 280
/** The height of a compact chart per pixel of width. */
const COMPACT_RATIO = 0.25
/** The height of a tall compact chart. */
export const COMPACT_TALL_HEIGHT = 320
const LEFT = 36
/** A byte scale ("57 GiB") needs a wider gutter than a count. */
const LEFT_BYTES = 52
const RIGHT = 4
const TOP = 8
const BOTTOM = 20
/** The drawing width before the box is measured (and where the browser cannot measure it): scaled to 100 % of the card. */
const FALLBACK_WIDTH = 600
/** Past a day, the covered window is said in hours. */
const DAY_MINUTES = 24 * 60
const TIP_WIDTH = 240
/** The space between the hover guide and its card. */
const TIP_GAP = 12
const VERDICTS: readonly TimelineVerdict[] = ['all', 'would_block', 'blocked']
const VERDICT_LABEL: Record<TimelineVerdict, string> = { all: 'postureTimelineAll', would_block: 'postureWouldBlock', blocked: 'postureBlocked' }
const RANGE_LOCK_MESSAGE = { grouping: 'postureRangeGrouping', unavailable: 'postureRangeUnavailable' } as const
/** Past a day of buckets the time labels carry the day. */
const DAY_MS = DAY_MINUTES * 60_000

/** About five time labels under the bars, never two on the same bucket. */
function tickIndexes(count: number): number[] {
  if (count <= 1) return [0]
  return [...new Set([0, 1, 2, 3, 4].map(k => Math.round((k * (count - 1)) / 4)))]
}

/** The last time label ends on the last bucket instead of being centred on it, where the edge of the chart cut it. */
export function tickAnchor(index: number, count: number): 'middle' | 'end' {
  return count > 1 && index === count - 1 ? 'end' : 'middle'
}

/** The breakdown of one bucket in the tooltip: a dot, a group, its value, for each group with a value. */
function TipRows({ series, counts, value }: { series: PostureTimeline['series']; counts: Record<string, number>; value: (n: number) => string }) {
  const nameOf = useSliceName()
  return (
    <>
      {series.filter(s => counts[s.key]).map(s => (
        <Box key={s.key} sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <Box sx={objectDotSx(s.color)} />
          <Typography variant='caption' noWrap sx={{ flex: 1, minWidth: 0 }}>{nameOf(s)}</Typography>
          <Typography variant='caption' sx={{ fontWeight: 600 }}>{value(counts[s.key])}</Typography>
        </Box>
      ))}
    </>
  )
}

/**
 * The stacked areas of the buckets (one per group, in the donut's order and colours, a line on each), with the scale,
 * the time labels, and on hover a guide at the nearest bucket with its breakdown. With `below` the chart is mirrored
 * like an interface graph: `timeline` (inbound) above the baseline, `below` (outbound) under it, on one scale.
 */
function Areas({ timeline, below = null, measured, unit, height = TIMELINE_HEIGHT }: {
  timeline: PostureTimeline
  below?: PostureTimeline | null
  measured: number | null
  unit: Unit
  height?: number
}) {
  const width = measured ?? FALLBACK_WIDTH
  const theme = useTheme()
  const format = useFormatter()
  const t = useTranslations('networkPage.dashboard')
  const [hover, setHover] = useState<number | null>(null)
  const { buckets, max } = timeline
  const left = unit === 'bytes' ? LEFT_BYTES : LEFT
  const box = { left, width: Math.max(40, width - left - RIGHT), top: TOP, height: height - TOP - BOTTOM }
  const half = below ? box.height / 2 : box.height
  const baseline = TOP + half
  const xs = bucketXs(buckets.length, box)
  const layers = [
    ...areaPaths(timeline, { ...box, height: half }).map(p => ({ ...p, id: below ? `in:${p.key}` : p.key, colour: timeline.series.find(s => s.key === p.key)?.color })),
    ...(below ? areaPaths(below, { ...box, top: baseline, height: half }, true).map(p => ({ ...p, id: `out:${p.key}`, colour: below.series.find(s => s.key === p.key)?.color })) : []),
  ]
  const value = (n: number) => (unit === 'bytes' ? formatBytes(n, 1) : format.number(n))
  const scaleText = unit === 'bytes' ? formatBytes(max, 0) : format.number(max, { notation: 'compact' })
  // Up to a day the labels are times; over a longer range they carry the weekday (the tooltip the date).
  const longRange = buckets.length > 1 && buckets[buckets.length - 1].start - buckets[0].start > DAY_MS
  const clock = (at: number) => format.dateTime(new Date(at), longRange ? { weekday: 'short', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit' })
  const stamp = (at: number) => format.dateTime(new Date(at), longRange ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit' })
  const hovered = hover === null ? null : buckets[hover]
  const hoveredBelow = hover === null || !below ? null : below.buckets[hover]
  const guideX = hover === null ? 0 : xs[buckets.length === 1 ? 0 : hover]
  // Beside the guide, right of it while there is room, else left: the guide and the dots on the lines stay visible.
  const rightOfGuide = guideX + TIP_GAP + TIP_WIDTH <= width
  const tipLeft = Math.max(0, rightOfGuide ? guideX + TIP_GAP : guideX - TIP_GAP - TIP_WIDTH)
  const pointAt = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = e.currentTarget.ownerSVGElement?.getBoundingClientRect()
    // Pointer x in the drawing's units (the SVG is scaled to 100 % until measured).
    const x = rect?.width ? ((e.clientX - rect.left) * width) / rect.width : e.clientX
    setHover(nearestBucket(x, buckets.length, box))
  }
  const events = (n: number) => (unit === 'bytes' ? value(n) : t('postureTimelineEvents', { count: n }))
  const span = hovered ? `${stamp(hovered.start)} - ${stamp(hovered.start + timeline.stepMs)}` : ''

  return (
    <>
      <svg
        width={measured ?? '100%'}
        height={measured ? height : undefined}
        viewBox={`0 0 ${width} ${height}`}
        role='img'
        aria-label={unit === 'bytes' ? t('postureVolumeLabel') : t('postureTimelineLabel')}
        style={{ display: 'block' }}
      >
        <line data-testid='timeline-baseline' x1={box.left} x2={box.left + box.width} y1={baseline} y2={baseline} stroke={paletteAlpha(theme, 'text.primary', 0.3)} />
        <text x={left - 6} y={TOP + 4} textAnchor='end' fontSize={10} fill={theme.palette.text.secondary} data-testid='timeline-max'>{scaleText}</text>
        <text x={left - 6} y={baseline + (below ? 3 : 0)} textAnchor='end' fontSize={10} fill={theme.palette.text.secondary}>0</text>
        {below && <text x={left - 6} y={TOP + box.height} textAnchor='end' fontSize={10} fill={theme.palette.text.secondary} data-testid='timeline-max-below'>{scaleText}</text>}
        {layers.map(p => (
          <g key={p.id} data-testid={`area-${p.id}`}>
            {/* As the inventory charts: a light fill under a 2 px line. */}
            <path d={p.area} fill={p.colour} fillOpacity={0.18} stroke='none' />
            <path d={p.line} fill='none' stroke={p.colour} strokeWidth={2} strokeLinejoin='round' strokeLinecap='round' />
          </g>
        ))}
        {tickIndexes(buckets.length).map(i => (
          <text key={i} x={xs[i]} y={height - 4} textAnchor={tickAnchor(i, buckets.length)} fontSize={10} fill={theme.palette.text.secondary}>{clock(buckets[i].start)}</text>
        ))}
        {hovered && (
          <line data-testid='timeline-guide' x1={guideX} x2={guideX} y1={TOP} y2={TOP + box.height} stroke={theme.palette.text.secondary} strokeWidth={1} strokeDasharray='3 3' pointerEvents='none' />
        )}
        {/* The value of each group at the hovered bucket, a dot on its line. */}
        {hover !== null && layers.map(p => (
          <circle key={p.id} data-testid='timeline-dot' cx={guideX} cy={p.tops[buckets.length === 1 ? 0 : hover]} r={3.5} fill={p.colour} stroke={theme.palette.background.paper} strokeWidth={1.5} pointerEvents='none' />
        ))}
        <rect
          data-testid='timeline-overlay'
          x={box.left}
          y={TOP}
          width={box.width}
          height={box.height}
          fill='transparent'
          onMouseMove={pointAt}
          onMouseLeave={() => setHover(null)}
        />
      </svg>
      {hovered && (
        // As the inventory charts' tooltip: a card, a tinted header (icon, what is measured, when), the values under it.
        <Box
          data-testid='timeline-tip'
          sx={{
            position: 'absolute', top: 0, left: tipLeft, width: TIP_WIDTH, pointerEvents: 'none', zIndex: 1, overflow: 'hidden',
            bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, boxShadow: '0 4px 14px rgba(0,0,0,0.15)',
          }}
        >
          <Box sx={{ px: 1.5, py: 0.75, bgcolor: alpha(theme.palette.primary.main, 0.1), borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
            <i className={unit === 'bytes' ? 'ri-exchange-line' : 'ri-pulse-line'} style={{ fontSize: 13, color: theme.palette.primary.main, flexShrink: 0 }} />
            <Typography variant='caption' noWrap sx={{ fontWeight: 700, color: 'primary.main', minWidth: 0 }}>{events(below ? hovered.total + (hoveredBelow?.total ?? 0) : hovered.total)}</Typography>
            <Typography variant='caption' noWrap sx={{ ml: 'auto', opacity: 0.6, flexShrink: 0 }}>{span}</Typography>
          </Box>
          <Box sx={{ px: 1.5, py: 0.75 }}>
            {below ? (
              <>
                <Typography variant='caption' component='div' sx={{ fontWeight: 600 }}>{`↓ ${t('postureDirectionIn')} · ${events(hovered.total)}`}</Typography>
                <TipRows series={timeline.series} counts={hovered.counts} value={value} />
                <Typography variant='caption' component='div' sx={{ fontWeight: 600, mt: 0.5 }}>{`↑ ${t('postureDirectionOut')} · ${events(hoveredBelow?.total ?? 0)}`}</Typography>
                <TipRows series={below.series} counts={hoveredBelow?.counts ?? {}} value={value} />
              </>
            ) : (
              <TipRows series={timeline.series} counts={hovered.counts} value={value} />
            )}
          </Box>
        </Box>
      )}
    </>
  )
}

/** The groups of a compact chart as one row of chips (dot and name), cut at the end of the row; ↓ in, ↑ out when mirrored. */
function LegendChips({ timeline, below = null }: { timeline: PostureTimeline; below?: PostureTimeline | null }) {
  const nameOf = useSliceName()
  const chips = [
    ...timeline.series.map(s => ({ s, id: below ? `in:${s.key}` : s.key, mark: below ? '↓ ' : '' })),
    ...(below?.series ?? []).map(s => ({ s, id: `out:${s.key}`, mark: '↑ ' })),
  ]
  return (
    <Box data-testid='timeline-legend' sx={{ display: 'flex', gap: 0.5, overflow: 'hidden', flexWrap: 'nowrap', minWidth: 0 }}>
      {chips.map(({ s, id, mark }) => (
        <Chip
          key={id}
          size='small'
          variant='outlined'
          icon={<Box component='span' sx={{ ...objectDotSx(s.color), ml: 1 }} />}
          label={`${mark}${nameOf(s)}`}
          sx={{ flexShrink: 0, height: 22, fontSize: 11 }}
        />
      ))}
    </Box>
  )
}

/**
 * The observed traffic over time, under the donut: the persisted history of the flows for the range chosen (by zone), or
 * the events of the orchestrator's memory per 5-minute bucket (by VLAN or node, or when the history is not served),
 * stacked areas per group of the donut in its colours, a verdict toggle, the range chips and the window covered. A
 * second tab, "Volume (sFlow)", shows the sFlow bytes of the same groups over the same range, only when sFlow has data
 * for the connection.
 */
export default function TrafficTimeline({ phase, timeline, verdict, onVerdict, volume = null, volumeSent = true, range, onRange, rangeLock = null, compact = false, fill = false, tall = false, showRange = true, direction, onDirection, emptyText, hideVerdict = false, emptyAction, mirror = null, volumeFirst = false }: Props) {
  const t = useTranslations('networkPage.dashboard')
  const [ref, size] = useBoxSize<HTMLDivElement>()
  const [chosen, setChosen] = useState<Unit>(volumeFirst ? 'bytes' : 'events')
  // The Volume tab only exists while sFlow has data for the connection.
  const unit: Unit = volume ? chosen : 'events'
  const measured = size?.width ?? null
  let base = TIMELINE_HEIGHT
  if (compact) base = tall ? COMPACT_TALL_HEIGHT : Math.min(COMPACT_TIMELINE_MAX_HEIGHT, Math.max(COMPACT_TIMELINE_HEIGHT, Math.round((size?.width ?? 0) * COMPACT_RATIO)))
  const height = fill ? Math.max(base, size?.height ?? 0) : base

  let body: React.ReactNode
  if (unit === 'bytes' && volume) body = volume.total > 0 ? <Areas timeline={volume} measured={measured} unit='bytes' height={height} /> : <Typography variant='body2' color='text.secondary' data-testid='volume-empty'>{t('postureVolumeEmpty')}</Typography>
  else if (phase === 'loading') body = <Skeleton data-testid='timeline-loading' variant='rounded' height={height} />
  else if (phase === 'unavailable') body = <Typography variant='body2' color='text.secondary' data-testid='timeline-unavailable'>{t('postureTimelineUnavailable')}</Typography>
  else if (timeline.total === 0 && !mirror?.total) {
    body = (
      <Typography variant='body2' color='text.secondary' data-testid='timeline-empty'>
        {emptyText ?? t(timeline.range ? 'postureTimelineEmptyRange' : 'postureTimelineEmpty')}
        {emptyAction && (
          <>
            {' · '}
            <Link component='button' type='button' variant='body2' onClick={emptyAction.onClick} data-testid='timeline-empty-action' sx={{ verticalAlign: 'baseline' }}>
              {emptyAction.label}
            </Link>
          </>
        )}
      </Typography>
    )
  }
  else body = <Areas timeline={timeline} below={mirror} measured={measured} unit='events' height={height} />

  let caption: string | null = null
  if (unit === 'bytes') caption = t(volumeSent ? 'postureVolumeCaptionSent' : 'postureVolumeCaptionReceived', { range: t(RANGE_LABEL[range]) })
  else if (timeline.range) caption = phase === 'ready' ? t('postureTimelineHistory', { range: t(RANGE_LABEL[timeline.range]) }) : null
  else if (timeline.windowMinutes !== null) {
    const minutes = timeline.windowMinutes
    caption = minutes > DAY_MINUTES ? t('postureTimelineWindowHours', { hours: Math.round(minutes / 60) }) : t('postureTimelineWindow', { minutes })
  }

  // The memory chart (a grouping by VLAN or node, or no history served) has one window; the Volume tab follows the range.
  const locked = unit === 'events' && rangeLock !== null
  // The map panel is narrow: its toggles are smaller, and the verdict a select, so they hold on two rows.
  // The selected button is filled with the primary colour, the others outlined in the secondary text colour: legible
  // in both themes (the default selected tint is too faint on a dark paper).
  const toggleSx = {
    '& .MuiToggleButton-root': {
      ...(compact ? { py: 0, px: 1, height: 30, fontSize: '0.8125rem', flex: '1 1 auto' } : { py: 0.25, px: 1, fontSize: 12 }),
      textTransform: 'none',
      color: 'text.secondary',
    },
    '& .MuiToggleButton-root.Mui-selected': {
      bgcolor: 'primary.main',
      color: 'primary.contrastText',
      '&:hover': { bgcolor: 'primary.dark' },
    },
  }
  const chips = (
    <Tooltip title={locked ? t(RANGE_LOCK_MESSAGE[rangeLock]) : ''}>
      <span data-testid='timeline-range-wrap' style={compact ? { display: 'flex' } : { flexShrink: 0 }}>
        <ToggleButtonGroup
          size='small'
          exclusive
          value={range}
          disabled={locked}
          onChange={(_, next: TimelineRange | null) => { if (next) onRange(next) }}
          aria-label={t('postureRangeLabel')}
          sx={{ ...toggleSx, ...(compact && { flex: 1 }) }}
        >
          {TIMELINE_RANGES.map(r => <ToggleButton key={r} value={r} data-testid={`range-${r}`}>{t(RANGE_LABEL[r])}</ToggleButton>)}
        </ToggleButtonGroup>
      </span>
    </Tooltip>
  )
  const directionToggle = direction && onDirection && (
    <ToggleButtonGroup
      size='small'
      exclusive
      value={direction}
      onChange={(_, next: TimelineDirection | null) => { if (next) onDirection(next) }}
      aria-label={t('postureDirectionLabel')}
      sx={{ ...toggleSx, flexShrink: 0 }}
    >
      <ToggleButton value='both' data-testid='direction-both'>{t('postureDirectionBoth')}</ToggleButton>
      <ToggleButton value='in' data-testid='direction-in'>{t('postureDirectionIn')}</ToggleButton>
      <ToggleButton value='out' data-testid='direction-out'>{t('postureDirectionOut')}</ToggleButton>
    </ToggleButtonGroup>
  )
  let verdictControl: React.ReactNode = null
  if (hideVerdict) verdictControl = null
  else if (unit === 'events' && compact) {
    verdictControl = (
      <FormControl size='small' sx={{ minWidth: 96 }}>
        <Select
          value={verdict}
          onChange={e => onVerdict(e.target.value as TimelineVerdict)}
          inputProps={{ 'aria-label': t('postureTimelineVerdict') }}
          sx={{ ...SMALL_SELECT_SX, height: 30, fontSize: '0.8125rem', '& .MuiSelect-select': { py: 0, pl: 1.25, display: 'flex', alignItems: 'center', minHeight: 0 } }}
        >
          {VERDICTS.map(v => <MenuItem key={v} value={v} sx={{ fontSize: '0.8125rem' }}>{t(VERDICT_LABEL[v])}</MenuItem>)}
        </Select>
      </FormControl>
    )
  } else if (unit === 'events') {
    verdictControl = (
      <ToggleButtonGroup
        size='small'
        exclusive
        value={verdict}
        onChange={(_, next: TimelineVerdict | null) => { if (next) onVerdict(next) }}
        aria-label={t('postureTimelineVerdict')}
        sx={toggleSx}
      >
        {VERDICTS.map(v => <ToggleButton key={v} value={v}>{t(VERDICT_LABEL[v])}</ToggleButton>)}
      </ToggleButtonGroup>
    )
  }
  const toggles = (
    <>
      {directionToggle}
      {verdictControl}
      {showRange && chips}
    </>
  )
  const captionLine = caption && <Typography variant='caption' color='text.secondary' noWrap={compact} data-testid='timeline-caption'>{caption}</Typography>
  const chart = <Box ref={ref} data-testid='timeline-chart' sx={{ position: 'relative', width: '100%', minWidth: 0, ...(fill && { flex: '1 1 0', minHeight: base, overflow: 'hidden' }) }}>{body}</Box>

  if (compact) {
    // The groups of controls share the full width, their buttons at the small size: two rows in a map panel, one row
    // in the expanded dialog, never scrolled sideways. What the chart counts, its range, its direction and, for the
    // connections only, the verdict.
    const unitToggle = volume && (
      <ToggleButtonGroup size='small' exclusive value={unit} onChange={(_, next: Unit | null) => { if (next) setChosen(next) }} aria-label={t('postureUnitLabel')} sx={toggleSx}>
        <ToggleButton value='events'>{t('postureUnitEvents')}</ToggleButton>
        <ToggleButton value='bytes' data-testid='volume-tab'>{t('postureColVolume')}</ToggleButton>
      </ToggleButtonGroup>
    )
    return (
      <Box data-testid='timeline' sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, minWidth: 0 }}>
        {captionLine}
        <Box data-testid='timeline-toggles' sx={{ display: 'flex', alignItems: 'center', columnGap: 1, rowGap: 0.75, flexWrap: 'wrap', minWidth: 0, '& > *': { flex: '1 1 auto' } }}>
          {unitToggle}
          {showRange && chips}
          {directionToggle}
          {verdictControl}
        </Box>
        {chart}
        {phase === 'ready' && (timeline.total > 0 || !!mirror?.total) && <LegendChips timeline={timeline} below={mirror} />}
      </Box>
    )
  }

  const title: React.ReactNode = volume ? (
    <Tabs value={unit} onChange={(_, next: Unit) => setChosen(next)} sx={{ minHeight: 32, '& .MuiTab-root': { minHeight: 32, py: 0.5, px: 1.5, textTransform: 'none' } }}>
      <Tab value='events' label={t('postureTimelineTitle')} />
      <Tab value='bytes' label={t('postureVolumeTab')} data-testid='volume-tab' />
    </Tabs>
  ) : (
    <Typography variant='subtitle2' component='h3' sx={{ fontWeight: 700 }}>{t('postureTimelineTitle')}</Typography>
  )

  return (
    <Box data-testid='timeline' sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, ...(fill && { flex: '1 1 auto' }) }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        {title}
        {captionLine}
        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>{toggles}</Box>
      </Box>
      {chart}
    </Box>
  )
}
