import { Box, Typography } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Rectangle,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
  type BarShapeProps
} from 'recharts'

import ChartContainer from '@/components/ChartContainer'
import type { AiChart, AiChartKind, AiChartUnit } from '@/lib/ai/charts'

type Translate = (key: string, values?: Record<string, string>) => string

type ChartDatum = { label: string; detail?: string } & Record<string, number | string | undefined>

// Usage at or above these reads as a warning, then as critical, the same
// thresholds the alerts use for host RAM and storage.
const WARN_PCT = 80
const CRIT_PCT = 90

const ROW_HEIGHT_ONE_SERIES = 28
const ROW_HEIGHT_TWO_SERIES = 40
const HISTORY_HEIGHT = 180

// A VM idling at 2 % on a 0-100 axis is a flat line: the axis follows the
// peak, with headroom, and never runs past 100 %.
const historyPctMax = (dataMax: number) => Math.min(100, Math.max(5, Math.ceil((dataMax * 1.2) / 5) * 5))

const KIND_KEYS: Record<Exclude<AiChartKind, 'guest-ranking' | 'history'>, string> = {
  'host-usage': 'ai.charts.hostUsage',
  'storage-usage': 'ai.charts.storageUsage'
}

export const chartTitle = (chart: AiChart, t: Translate): string => {
  if (chart.kind === 'history') {
    return `${t(`ai.charts.history.${chart.metric}`, { target: chart.target ?? '' })} · ${t(`ai.charts.timeframes.${chart.timeframe}`)}`
  }

  return t(chart.kind === 'guest-ranking' ? `ai.charts.guest.${chart.metric}` : KIND_KEYS[chart.kind])
}

const UNIT_KEYS: Record<Exclude<AiChartUnit, '%'>, string> = {
  GB: 'ai.charts.units.gb',
  vCPU: 'ai.charts.units.vcpu',
  'Mbit/s': 'ai.charts.units.mbps',
  'MB/s': 'ai.charts.units.mbs'
}

// "93,1 %" in French, "93.1%" in English: the figures read like the prose around them.
const formatterFor = (locale: string, unitLabel: string): ((value: unknown) => string) => {
  if (unitLabel === '%') {
    const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 })

    return value => percent.format(Number(value) / 100)
  }

  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })

  return value => `${number.format(Number(value))} ${unitLabel}`
}

const TICK_FORMATS: Record<string, Intl.DateTimeFormatOptions> = {
  hour: { hour: '2-digit', minute: '2-digit' },
  day: { hour: '2-digit', minute: '2-digit' },
  week: { day: '2-digit', month: '2-digit' },
  month: { day: '2-digit', month: '2-digit' },
  year: { month: 'short', year: '2-digit' }
}

/** Axis ticks follow the period; the tooltip always gives day and time. */
const timeFormatters = (locale: string, timeframe: string | undefined) => {
  const tick = new Intl.DateTimeFormat(locale, TICK_FORMATS[timeframe ?? 'day'] ?? TICK_FORMATS.day)
  const full = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

  return {
    tick: (value: unknown) => tick.format(new Date(Number(value) * 1000)),
    full: (value: number) => full.format(new Date(value * 1000))
  }
}

type ChartTooltipProps = {
  active?: boolean
  payload?: Array<{ payload: ChartDatum }>
  chart: AiChart
  seriesLabel: (series: string) => string
  format: (value: unknown) => string
}

const ChartTooltip = ({ active, payload, chart, seriesLabel, format }: ChartTooltipProps) => {
  if (!active || !payload?.length) return null

  const row = payload[0].payload

  return (
    <Box sx={{ px: 2, py: 1.5, borderRadius: 1, bgcolor: 'background.paper', border: 1, borderColor: 'divider', boxShadow: 3 }}>
      <Typography variant='body2' sx={{ fontWeight: 600 }}>
        {row.label}
      </Typography>
      {row.detail && (
        <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>
          {row.detail}
        </Typography>
      )}
      {chart.series.map((s, i) => (
        <Typography key={s} variant='caption' sx={{ display: 'block' }}>
          {seriesLabel(s)} : {format(row[`v${i}`])}
        </Typography>
      ))}
    </Box>
  )
}

/**
 * One chart under an assistant answer (#459), drawn from a tool result (see
 * `lib/ai/charts.ts`): horizontal bars, one row per host, guest or storage.
 * Rendered inside the widget only, which makes it a client component.
 */
export default function AIChart({ chart, t, locale }: { chart: AiChart; t: Translate; locale: string }) {
  const theme = useTheme()
  const isPct = chart.unit === '%'
  const format = formatterFor(locale, chart.unit === '%' ? '%' : t(UNIT_KEYS[chart.unit]))
  const twoSeries = chart.series.length === 2
  const seriesColors = [theme.palette.primary.main, theme.palette.info.main]

  // The brand orange would read as the warning orange on a usage bar.
  const okColor = isPct ? theme.palette.info.main : theme.palette.primary.main

  const isHistory = chart.kind === 'history'
  const times = timeFormatters(locale, chart.timeframe)

  const seriesLabel = (s: string) =>
    chart.kind === 'guest-ranking' ? t(`ai.charts.guest.${s}`) : t(`ai.charts.series.${s}`)

  // A single percentage is coloured by severity; two series keep their own
  // colour so CPU and RAM stay apart.
  const barColor = (value: number) => {
    if (!isPct || twoSeries) return okColor
    if (value >= CRIT_PCT) return theme.palette.error.main
    if (value >= WARN_PCT) return theme.palette.warning.main

    return okColor
  }

  const data: ChartDatum[] = chart.rows.map(row => ({
    // A history point is named by its time, which the tooltip then shows.
    label: isHistory && row.time !== undefined ? times.full(row.time) : row.label,
    time: row.time,
    detail: row.detail,
    ...Object.fromEntries(row.values.map((v, i) => [`v${i}`, v]))
  }))

  const severityShape = (props: BarShapeProps) => (
    <Rectangle {...props} fill={barColor(Number((props.payload as ChartDatum | undefined)?.v0))} />
  )

  const longest = Math.max(...chart.rows.map(r => r.label.length))
  const height = chart.rows.length * (twoSeries ? ROW_HEIGHT_TWO_SERIES : ROW_HEIGHT_ONE_SERIES) + 32
  const tick = { fontSize: 11, fill: theme.palette.text.secondary }

  return (
    <Box
      role='figure'
      aria-label={chartTitle(chart, t)}
      sx={{ mt: 3, p: 3, pb: 1.5, borderRadius: 1.5, border: 1, borderColor: 'divider' }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 1.5 }}>
        <Typography variant='body2' sx={{ fontWeight: 600 }}>
          {chartTitle(chart, t)}
        </Typography>
        {twoSeries && (
          <Box sx={{ display: 'flex', gap: 3 }}>
            {chart.series.map((s, i) => (
              <Box key={s} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ width: 8, height: 8, borderRadius: 0.5, bgcolor: seriesColors[i] }} />
                <Typography variant='caption' color='text.secondary'>
                  {seriesLabel(s)}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
      </Box>
      {isHistory ? (
        <ChartContainer height={HISTORY_HEIGHT}>
          <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray='3 3' stroke={theme.palette.divider} />
            <XAxis
              dataKey='time'
              type='number'
              scale='time'
              domain={['dataMin', 'dataMax']}
              tickFormatter={times.tick}
              tick={tick}
              axisLine={false}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis
              domain={isPct ? [0, historyPctMax] : [0, 'auto']}
              tickCount={5}
              allowDecimals={false}
              tickFormatter={format}
              tick={tick}
              axisLine={false}
              tickLine={false}
              width={isPct ? 44 : 64}
            />
            <RechartsTooltip
              cursor={{ stroke: theme.palette.divider }}
              content={<ChartTooltip chart={chart} seriesLabel={seriesLabel} format={format} />}
            />
            {chart.series.map((s, i) => (
              <Area
                key={s}
                type='monotone'
                dataKey={`v${i}`}
                name={seriesLabel(s)}
                stroke={seriesColors[i]}
                fill={seriesColors[i]}
                fillOpacity={0.12}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ChartContainer>
      ) : (
      <ChartContainer height={height}>
        <BarChart data={data} layout='vertical' margin={{ top: 0, right: isPct ? 52 : 72, left: 0, bottom: 0 }} barGap={2}>
          <CartesianGrid horizontal={false} strokeDasharray='3 3' stroke={theme.palette.divider} />
          <XAxis
            type='number'
            domain={isPct ? [0, 100] : [0, 'auto']}
            tickFormatter={format}
            tick={tick}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type='category'
            dataKey='label'
            tick={tick}
            axisLine={false}
            tickLine={false}
            width={Math.min(170, Math.max(56, longest * 7 + 8))}
          />
          <RechartsTooltip
            cursor={{ fill: theme.palette.action.hover }}
            content={<ChartTooltip chart={chart} seriesLabel={seriesLabel} format={format} />}
          />
          {chart.series.map((s, i) => (
            <Bar
              key={s}
              dataKey={`v${i}`}
              name={seriesLabel(s)}
              fill={twoSeries ? seriesColors[i] : okColor}
              radius={[0, 4, 4, 0]}
              maxBarSize={twoSeries ? 12 : 16}
              isAnimationActive={false}
              {...(twoSeries ? {} : { shape: severityShape })}
            >
              <LabelList
                dataKey={`v${i}`}
                position='right'
                formatter={format}
                style={{ fontSize: 11, fill: theme.palette.text.secondary }}
              />
            </Bar>
          ))}
        </BarChart>
      </ChartContainer>
      )}
    </Box>
  )
}
