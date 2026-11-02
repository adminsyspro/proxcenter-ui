'use client'

import { useMemo, type ReactNode } from 'react'

import { Box, ButtonBase, Link, Skeleton, Typography } from '@mui/material'
import { useTheme, type Theme } from '@mui/material/styles'
import { useFormatter, useTranslations } from 'next-intl'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { binaryUnit, osdLatency, trendStateOf, type TrendState } from '@/lib/ceph/overview'
import {
  insertGaps, isSlowOsd, mergeHistoryAndLive, niceAxis, tickAxisWidth, seriesFromHistory, seriesFromLive, SLOW_OSD_MIN_MS, slowOsdBaseline, slowestOsds,
  type PerfPoint, type PerfRow,
} from '@/lib/ceph/perfSeries'
import type { CephHistory } from '@/lib/orchestrator/client'
import type { CephInventory, CephOsd, CephRange } from '@/lib/ceph/types'

import type { CockpitTabProps } from './CephCockpit'
import { useCephHistory, useCephLastHour } from './hooks/useCephHistory'
import { CephOsdGlyph, fillColumnLg, fillGrowLg, HostGlyph, SectionCard, Tag, TABULAR, toneColor, TrendSlot, uncleanColor } from './ui'

/*
   Performance tab: real Ceph figures only (client IOPS, client throughput, recovery and
   unclean PGs, the slowest OSDs), never a node curve. Live draws the browser buffer (in
   Enterprise completed by the last hour of history where the buffer has holes), a longer
   period the backend history. Marks follow the visualisation charter: 2 px lines,
   a ~10 % wash under them, hairline solid grid, a legend for two series, one tooltip that
   lists every series at the pointed time, text in text tokens.
*/

type Translate = ReturnType<typeof useTranslations<'cephCockpit'>>

const CHART_HEIGHT = 170
const LINE_WIDTH = 2
const WASH_OPACITY = 0.1
const WRITE_DASH = '5 3'
const WRITE_WIDTH = 1.5
/** Width of the series key (legend and tooltip): long enough to show the dash pattern of the curve. */
const KEY_WIDTH = 18
const LEFT_AXIS_MIN = 62
const RIGHT_AXIS_MIN = 40

interface ChartSeries {
  key: Exclude<keyof PerfPoint, 't' | 'step'>
  label: string
  color: string
  axis: 'left' | 'right'
  dashed?: boolean
  /** Dash pattern and width of the line (the write series is thin and dotted, the unclean PGs a state line). */
  dash?: string
  width?: number
  /** No wash under the line. */
  bare?: boolean
  /** Formats the value in the tooltip. */
  value: (v: number) => string
}

interface AxisSpec {
  /** Tick text of a value on this axis. */
  tick: (v: number) => string
  integer?: boolean
  /** Display unit of the axis (1024 ** 2 for MiB), the ticks are clean figures of it. */
  divisor?: number
}

function chartColors(theme: Theme) {
  const p = theme.vars?.palette ?? theme.palette

  return { text: p.text.secondary, grid: p.divider, surface: p.background.paper, text1: p.text.primary }
}

/** Key of a series: the very stroke of its curve (colour, dash pattern, width, caps), drawn in SVG. */
function SeriesKey({ s, size }: { s: ChartSeries; size: number }) {
  const width = s.width ?? LINE_WIDTH

  return (
    <Box component='svg' aria-hidden data-testid='series-key' data-series={s.key} width={size} height={8} viewBox={`0 0 ${size} 8`} sx={{ flex: 'none', overflow: 'visible' }}>
      <line x1={1} x2={size - 1} y1={4} y2={4} stroke={s.color} strokeWidth={width} strokeDasharray={s.dashed ? (s.dash ?? '4 3') : undefined} strokeLinecap='round' />
    </Box>
  )
}

function LegendKeys({ series }: { series: ChartSeries[] }) {
  return (
    <Box component='span' sx={{ display: 'inline-flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
      {series.map(s => (
        <Typography key={s.key} component='span' variant='caption' color='text.secondary' sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
          <SeriesKey s={s} size={KEY_WIDTH} />
          {s.label}
        </Typography>
      ))}
    </Box>
  )
}

interface TipProps {
  active?: boolean
  label?: number
  payload?: { dataKey?: string | number; value?: number | null }[]
  series: ChartSeries[]
  time: (t: number) => string
}

/** One tooltip for every series at the pointed time: the value leads, the series name follows. */
export function PerfTooltip({ active, label, payload, series, time }: TipProps) {
  const theme = useTheme()
  const c = chartColors(theme)

  if (!active || typeof label !== 'number' || !payload) return null

  const rows = series.flatMap(s => {
    const hit = payload.find(p => p.dataKey === s.key)

    return hit && typeof hit.value === 'number' ? [{ s, v: hit.value }] : []
  })

  if (rows.length === 0) return null

  return (
    <Box data-testid='perf-tooltip' sx={{ px: 1.25, py: 1, borderRadius: 1, border: '1px solid', borderColor: 'divider', boxShadow: 3, minWidth: 150 }} style={{ background: c.surface }}>
      <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mb: 0.5 }}>{time(label)}</Typography>
      {rows.map(({ s, v }) => (
        <Box key={s.key} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <SeriesKey s={s} size={KEY_WIDTH} />
          <Typography component='span' sx={{ ...TABULAR, fontSize: 13, fontWeight: 700 }}>{s.value(v)}</Typography>
          <Typography component='span' variant='caption' color='text.secondary'>{s.label}</Typography>
        </Box>
      ))}
    </Box>
  )
}

/** Time axis ticks: seconds on a few minutes, hours and minutes on a day or so, the date beyond. */
function useTimeFormat(rows: PerfRow[]) {
  const format = useFormatter()
  const span = rows.length > 1 ? rows[rows.length - 1].t - rows[0].t : 0

  const tick = (t: number) => {
    const d = new Date(t)

    if (span <= 15 * 60_000) return format.dateTime(d, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    if (span <= 36 * 3_600_000) return format.dateTime(d, { hour: '2-digit', minute: '2-digit' })

    return format.dateTime(d, { month: 'short', day: 'numeric' })
  }
  const full = (t: number) => format.dateTime(new Date(t), span > 36 * 3_600_000
    ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  return { tick, full }
}

/** Area chart on a real time axis; a null row (collection gap) breaks the line. */
export function PerfChart({ rows, series, left, right, label }: { rows: PerfRow[]; series: ChartSeries[]; left: AxisSpec; right?: AxisSpec; label: string }) {
  const theme = useTheme()
  const c = chartColors(theme)
  const time = useTimeFormat(rows)
  const axisOf = (spec: AxisSpec, side: 'left' | 'right') => niceAxis(
    Math.max(0, ...rows.flatMap(r => series.filter(s => s.axis === side).map(s => r[s.key] ?? 0))),
    spec.divisor,
    spec.integer,
  )
  const leftAxis = axisOf(left, 'left')
  const rightAxis = right ? axisOf(right, 'right') : null
  // Wide enough for the longest tick label ("200 KiB/s"), or recharts breaks it on two lines and crops the top.
  const leftWidth = tickAxisWidth(leftAxis.ticks.map(left.tick), LEFT_AXIS_MIN)
  const rightWidth = right && rightAxis ? tickAxisWidth(rightAxis.ticks.map(right.tick), RIGHT_AXIS_MIN) : RIGHT_AXIS_MIN
  const axisText = { fontSize: 10.5, fill: c.text, fontVariantNumeric: 'tabular-nums' as const }

  return (
    <Box
      role='img'
      aria-label={label}
      data-testid='perf-chart'
      sx={theme => ({
        height: CHART_HEIGHT,
        width: '100%',
        // Wide: the chart takes the height left in its card (never under CHART_HEIGHT); the plot is laid over it
        // so that it adds no height of its own and cannot feed back on the card.
        [theme.breakpoints.up('lg')]: { height: 'auto', flex: '1 1 0', minHeight: CHART_HEIGHT, position: 'relative' },
      })}
    >
      <Box data-testid='perf-chart-plot' sx={theme => ({ width: '100%', height: '100%', [theme.breakpoints.up('lg')]: { position: 'absolute', inset: 0 } })}>
      <ResponsiveContainer width='100%' height='100%'>
        <AreaChart data={rows} margin={{ top: 6, right: right ? 4 : 10, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={c.grid} strokeWidth={1} />
          <XAxis
            dataKey='t'
            type='number'
            scale='time'
            domain={['dataMin', 'dataMax']}
            tickFormatter={time.tick}
            tickCount={5}
            tick={axisText}
            tickLine={false}
            axisLine={{ stroke: c.grid }}
            minTickGap={36}
          />
          <YAxis yAxisId='left' width={leftWidth} domain={[0, leftAxis.max]} ticks={leftAxis.ticks} interval={0} tickFormatter={left.tick} tick={axisText} tickLine={false} axisLine={false} />
          {right && rightAxis && (
            <YAxis yAxisId='right' orientation='right' width={rightWidth} domain={[0, rightAxis.max]} ticks={rightAxis.ticks} interval={0} tickFormatter={right.tick} tick={axisText} tickLine={false} axisLine={false} />
          )}
          <Tooltip
            isAnimationActive={false}
            cursor={{ stroke: c.text, strokeWidth: 1 }}
            content={<PerfTooltip series={series} time={time.full} />}
          />
          {series.map(s => (
            <Area
              key={s.key}
              yAxisId={s.axis}
              dataKey={s.key}
              type='linear'
              stroke={s.color}
              strokeWidth={s.width ?? LINE_WIDTH}
              strokeDasharray={s.dashed ? (s.dash ?? '4 3') : undefined}
              strokeLinecap='round'
              strokeLinejoin='round'
              fill={s.color}
              fillOpacity={s.bare ? 0 : WASH_OPACITY}
              connectNulls={false}
              dot={false}
              activeDot={{ r: 4, fill: s.color, stroke: c.surface, strokeWidth: 2 }}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
      </Box>
    </Box>
  )
}

interface Source {
  range: CephRange
  state: TrendState
  period: string
  /** Card subtitle. */
  caption: string
  points: PerfPoint[]
}

/** A chart card: the curve, or the state of the period (skeleton, unavailable, not enough data, waiting for Live, nothing to plot). */
function ChartCard({ icon, title, testId, source, series, idle, children, t }: {
  icon: string
  title: string
  testId: string
  source: Source
  series: ChartSeries[]
  /** Content state shown instead of a chart that would be scaled on nothing. */
  idle?: { testId: string; text: string }
  children: ReactNode
  t: Translate
}) {
  const live = source.state === 'live'
  const enough = source.points.length >= 2
  const showsData = (live || source.state === 'ready') && enough
  const showIdle = showsData && idle !== undefined

  return (
    <Box data-testid={testId} sx={[{ minWidth: 0 }, fillColumnLg]}>
      <SectionCard fill icon={icon} title={title} subtitle={source.caption} action={showsData && !showIdle ? <LegendKeys series={series} /> : undefined}>
        {live && !enough ? (
          <Box data-testid='perf-live-waiting' sx={{ display: 'flex', alignItems: 'center', gap: 0.75, height: CHART_HEIGHT, color: 'text.disabled' }}>
            <i className='ri-time-line' style={{ fontSize: 14 }} aria-hidden />
            <Typography component='span' variant='caption' sx={{ color: 'inherit' }}>{t('perf.live.waiting')}</Typography>
          </Box>
        ) : showIdle ? (
          <Box data-testid={idle.testId} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, height: CHART_HEIGHT, color: 'text.secondary' }}>
            <i className='ri-checkbox-circle-line' style={{ fontSize: 16 }} aria-hidden />
            <Typography component='span' variant='body2' sx={{ color: 'inherit' }}>{idle.text}</Typography>
          </Box>
        ) : (
          <TrendSlot state={source.state} enough={enough} period={source.period} t={t} height={CHART_HEIGHT}>{children}</TrendSlot>
        )}
      </SectionCard>
    </Box>
  )
}

function SlowestCard({ source, history, osds, inventory, onOpen, onAll, t }: {
  source: Source
  history: CephHistory | null
  osds: CephOsd[]
  inventory: CephInventory | null
  onOpen: (id: number) => void
  onAll: () => void
  t: Translate
}) {
  const theme = useTheme()
  const format = useFormatter()
  const live = source.state === 'live'
  const rows = useMemo(() => slowestOsds(live ? { osds } : { history: history ?? undefined }), [live, osds, history])
  const byId = useMemo(() => new Map(osds.map(o => [o.id, o])), [osds])
  // The baseline is the cluster's, never the displayed rows: Live = median of every up OSD with a reading,
  // a period = the mean latency of the window.
  const mean = useMemo(() => {
    const v = (history?.points ?? []).map(p => p.osd_lat_avg_ms).filter((x): x is number => typeof x === 'number' && Number.isFinite(x))

    return v.length > 0 ? v.reduce((s, x) => s + x, 0) / v.length : null
  }, [history])
  const baseline = useMemo(() => (live ? slowOsdBaseline(osds) : mean), [live, osds, mean])
  const clusterMean = live ? osdLatency(osds)?.avg ?? null : mean
  // Absolute bars: the scale is at least twice the threshold, so 1 ms is a sliver, never a full bar.
  const scale = Math.max(rows[0]?.avgMs ?? 0, 2 * SLOW_OSD_MIN_MS)
  const thresholdAt = (SLOW_OSD_MIN_MS / scale) * 100
  const ms = (v: number) => format.number(v, { maximumFractionDigits: v < 10 ? 1 : 0 })
  const palette = theme.vars?.palette ?? theme.palette

  let body: ReactNode

  if (source.state === 'loading' || source.state === 'unavailable') {
    body = <TrendSlot state={source.state} enough={false} period={source.period} t={t} height={CHART_HEIGHT}>{null}</TrendSlot>
  } else if (rows.length === 0) {
    body = <Typography data-testid='slowest-empty' variant='body2' color='text.secondary'>{t('perf.slowest.empty')}</Typography>
  } else {
    body = (
      <Box sx={{ display: 'flex', flexDirection: 'column', mx: -1 }}>
        {rows.map(r => {
          const osd = byId.get(r.id)
          const slow = isSlowOsd(r.avgMs, baseline)
          const width = Math.max(1, Math.min(100, (r.avgMs / scale) * 100))

          return (
            <ButtonBase
              key={r.id}
              data-testid='slowest-osd'
              data-osd={r.id}
              data-slow={slow ? 'true' : 'false'}
              aria-label={t(slow ? 'perf.slowest.openSlow' : 'perf.slowest.open', { id: r.id })}
              onClick={() => onOpen(r.id)}
              sx={{
                display: 'grid', gridTemplateColumns: 'auto 64px minmax(0, max-content) minmax(40px, 1fr) 64px auto',
                alignItems: 'center', columnGap: 1.25, px: 1, py: 0.75, borderRadius: 1, textAlign: 'left', width: '100%',
                '&:hover': { bgcolor: 'action.hover' },
                '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main' },
              }}
            >
              <CephOsdGlyph osd={osd} />
              <Typography component='span' sx={{ ...TABULAR, fontSize: 13, fontWeight: 700 }} noWrap>{`osd.${r.id}`}</Typography>
              <Box component='span' sx={{ minWidth: 0 }}>
                {osd ? (
                  <Tag>
                    {osd.deviceClass}
                    {osd.deviceClass && osd.host ? <Box component='span' sx={{ mr: 0.75 }}>{t('ui.separator')}</Box> : null}
                    {osd.host ? <><HostGlyph host={osd.host} inventory={inventory} />{osd.host}</> : null}
                  </Tag>
                ) : null}
              </Box>
              <Box component='span' aria-hidden sx={{ position: 'relative', height: 8, borderRadius: 4, bgcolor: 'divider' }}>
                <Box
                  component='span'
                  data-testid='slowest-bar'
                  data-width={Math.round(width * 10) / 10}
                  sx={{ display: 'block', height: '100%', borderRadius: 4, minWidth: 3, overflow: 'hidden' }}
                  style={{ width: `${width}%`, background: slow ? palette.warning.main : toneColor(theme, 'neutral'), opacity: slow ? 1 : 0.55 }}
                />
                <Box
                  component='span'
                  data-testid='slowest-threshold'
                  data-at={Math.round(thresholdAt * 10) / 10}
                  title={t('perf.slowest.threshold', { ms: SLOW_OSD_MIN_MS })}
                  sx={{ position: 'absolute', top: -2, bottom: -2, width: '1px', bgcolor: 'text.secondary' }}
                  style={{ left: `${thresholdAt}%` }}
                />
              </Box>
              <Typography
                component='span'
                title={r.maxMs > r.avgMs ? t('perf.slowest.max', { ms: ms(r.maxMs) }) : undefined}
                sx={{ ...TABULAR, fontSize: 13, fontWeight: slow ? 700 : 500, textAlign: 'right' }}
              >
                {slow && <i className='ri-alert-line' data-testid='slowest-flag' role='img' aria-label={t('perf.slowest.slow')} style={{ fontSize: 14, marginRight: 4, verticalAlign: '-2px', color: palette.warning.main }} />}
                {t('perf.slowest.value', { ms: ms(r.avgMs) })}
              </Typography>
              <i className='ri-arrow-right-s-line' style={{ fontSize: 16, opacity: 0.45 }} aria-hidden />
            </ButtonBase>
          )
        })}
        <Typography variant='caption' color='text.secondary' sx={{ ...TABULAR, display: 'block', mt: 1, px: 1 }}>
          {clusterMean !== null && `${t('perf.slowest.mean', { ms: ms(clusterMean) })}${t('ui.separator')}`}
          <Link component='button' type='button' underline='hover' onClick={onAll} sx={{ fontSize: 'inherit', fontWeight: 600, verticalAlign: 'baseline' }}>
            {osds.length > 0 ? t('perf.slowest.all', { count: osds.length }) : t('perf.slowest.allPlain')}
          </Link>
        </Typography>
      </Box>
    )
  }

  return (
    <Box data-testid='perf-slowest' sx={[{ minWidth: 0 }, fillColumnLg]}>
      <SectionCard
        fill
        icon='ri-speed-mini-line'
        title={t('perf.slowest.title')}
        subtitle={live ? t('perf.slowest.subtitleLive') : t('perf.slowest.subtitlePeriod')}
      >
        {body}
      </SectionCard>
    </Box>
  )
}

const NO_OSDS: CephOsd[] = []

export default function PerformanceTab({ conn, live, inventory, url, enterprise, onNavigate }: CockpitTabProps) {
  const t = useTranslations('cephCockpit')
  const format = useFormatter()
  const theme = useTheme()
  const range: CephRange = enterprise ? url.range : 'live'
  const { history, loading, error } = useCephHistory(conn, range, enterprise)
  // Enterprise Live: the last hour of history fills the holes of the buffer (paused while the tab is hidden).
  const lastHour = useCephLastHour(conn, enterprise && range === 'live').history
  const osds = inventory.inventory?.osds.list ?? NO_OSDS

  const state = trendStateOf(range, history, loading, error)
  const points = useMemo(() => {
    if (range === 'live') return mergeHistoryAndLive(lastHour ? seriesFromHistory(lastHour) : [], seriesFromLive(live.buffer))

    return history ? seriesFromHistory(history) : []
  }, [range, live.buffer, history, lastHour])
  const rows = useMemo(() => insertGaps(points), [points])
  const caption = range === 'live' && lastHour && lastHour.points.length > 0 ? t('perf.live.captionHistory') : t(`range.${range}`)
  const source: Source = { range, state, period: range === 'live' ? '' : t(`range.${range}`), caption, points }

  const num = (v: number, digits = 0) => format.number(v, { maximumFractionDigits: digits })
  const compact = (v: number) => format.number(v, { notation: 'compact', maximumFractionDigits: 1 })

  const maxBytes = Math.max(0, ...points.flatMap(p => [p.readBytes, p.writeBytes]))
  const maxRecovery = Math.max(0, ...points.map(p => p.recoveryBytes))
  const rate = binaryUnit(maxBytes)
  const recRate = binaryUnit(maxRecovery)
  const rateText = (unit: { divisor: number; unit: string }) => (v: number) => `${num(v / unit.divisor, v / unit.divisor < 10 && v > 0 ? 1 : 0)} ${unit.unit}/s`
  const label = (title: string) => t('perf.chartLabel', { title, period: t(`range.${range}`) })

  // Nothing to plot on the window (no recovery, every PG clean): a content state, not a chart scaled on zero.
  const recoveryIdle = points.length >= 2 && points.every(p => p.recoveryBytes === 0 && p.pgsUnclean === 0)

  const read = toneColor(theme, 'read')
  const write = toneColor(theme, 'write')
  const recovery = toneColor(theme, 'recovery')
  const unclean = uncleanColor(theme)

  const iopsSeries: ChartSeries[] = [
    { key: 'readOps', label: t('perf.series.read'), color: read, axis: 'left', value: v => num(v) },
    { key: 'writeOps', label: t('perf.series.write'), color: write, axis: 'left', dashed: true, dash: WRITE_DASH, width: WRITE_WIDTH, value: v => num(v) },
  ]
  const throughputSeries: ChartSeries[] = [
    { key: 'readBytes', label: t('perf.series.read'), color: read, axis: 'left', value: rateText(binaryUnit(maxBytes)) },
    { key: 'writeBytes', label: t('perf.series.write'), color: write, axis: 'left', dashed: true, dash: WRITE_DASH, width: WRITE_WIDTH, value: rateText(binaryUnit(maxBytes)) },
  ]
  const recoverySeries: ChartSeries[] = [
    { key: 'recoveryBytes', label: t('perf.series.recovery'), color: recovery, axis: 'left', value: rateText(binaryUnit(maxRecovery)) },
    { key: 'pgsUnclean', label: t('perf.series.unclean'), color: unclean, axis: 'right', dashed: true, bare: true, value: v => num(v) },
  ]

  return (
    <Box
      data-testid='perf-grid'
      sx={[
        { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: 2, alignItems: 'stretch' },
        fillGrowLg,
        // Wide: a 2 x 2 grid that fills the height.
        (theme: Theme) => ({ [theme.breakpoints.up('lg')]: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gridTemplateRows: 'repeat(2, 1fr)' } }),
      ]}
    >
      <ChartCard icon='ri-speed-up-line' title={t('perf.iops.title')} testId='perf-iops' source={source} series={iopsSeries} t={t}>
        <PerfChart rows={rows} series={iopsSeries} left={{ tick: compact, integer: true }} label={label(t('perf.iops.title'))} />
      </ChartCard>
      <ChartCard icon='ri-swap-line' title={t('perf.throughput.title')} testId='perf-throughput' source={source} series={throughputSeries} t={t}>
        <PerfChart rows={rows} series={throughputSeries} left={{ tick: rateText(rate), divisor: rate.divisor, integer: rate.divisor === 1 }} label={label(t('perf.throughput.title'))} />
      </ChartCard>
      <ChartCard icon='ri-loop-right-line' title={t('perf.recovery.title')} testId='perf-recovery' source={source} series={recoverySeries} idle={recoveryIdle ? { testId: 'perf-recovery-idle', text: t('perf.recovery.idle') } : undefined} t={t}>
        <PerfChart rows={rows} series={recoverySeries} left={{ tick: rateText(recRate), divisor: recRate.divisor, integer: recRate.divisor === 1 }} right={{ tick: compact, integer: true }} label={label(t('perf.recovery.title'))} />
      </ChartCard>
      <SlowestCard
        source={source}
        history={history}
        osds={osds}
        inventory={inventory.inventory}
        onOpen={id => onNavigate({ tab: 'osd', item: { kind: 'osd', id } })}
        onAll={() => onNavigate({ tab: 'osd' })}
        t={t}
      />
    </Box>
  )
}
