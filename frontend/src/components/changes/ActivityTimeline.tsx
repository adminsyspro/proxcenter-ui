'use client'

import { useLocale, useTranslations } from 'next-intl'

import { Box, Chip, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { Bar, BarChart, CartesianGrid, Rectangle, Tooltip, XAxis, YAxis } from 'recharts'

import ChartContainer from '@/components/ChartContainer'
import { FAMILIES, FAMILY_COLORS, FAMILY_LABELS, PERIODS } from '@/lib/changes/journal'
import type { Bucket, Family, Period } from '@/lib/changes/journal'

const HOUR = 3600 * 1000
const DAY = 24 * HOUR

interface ActivityTimelineProps {
  buckets: Bucket[]
  period: Period
  onPeriod: (period: Period) => void
  /** The `from` of the bucket the journal is narrowed to */
  selected: number | null
  onSelect: (bucket: Bucket | null) => void
  /** Clicking a legend entry filters the journal on that family */
  onFamily: (family: Family) => void
  family: Family | ''
  /** Changes and distinct resources in what the chart shows */
  summary: { changes: number; resources: number }
}

/** `13:00 → 14:00`, `Mon 19 Oct`, `19 Oct → 26 Oct`: a bucket as a clock slot. */
export function bucketLabel(b: { from: number; to: number }, locale: string): string {
  const step = b.to - b.from
  const day = (ms: number) => new Date(ms).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })
  const hour = (ms: number) => new Date(ms).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })

  if (step < DAY) return `${day(b.from)} ${hour(b.from)} → ${hour(b.to)}`
  if (step === DAY) return day(b.from)

  return `${day(b.from)} → ${day(b.to - DAY)}`
}

type ActivityRow = Record<string, any>

interface ActivityTooltipProps {
  /** Filled in by recharts */
  active?: boolean
  payload?: Array<{ payload?: ActivityRow }>
  colors: Readonly<Record<Family, string>>
}

/** A slot's count per family, and what a click on it does */
function ActivityTooltip({ active, payload, colors }: Readonly<ActivityTooltipProps>) {
  const t = useTranslations()
  const locale = useLocale()
  const row = active && payload?.[0]?.payload

  if (!row) return null

  return (
    <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, px: 1.5, py: 1, boxShadow: 2, minWidth: 160 }}>
      <Typography variant='caption' sx={{ fontWeight: 600, display: 'block', mb: 0.5 }}>
        {bucketLabel(row as Bucket, locale)}
      </Typography>
      {FAMILIES.filter(f => row[f] > 0).map(f => (
        <Box key={f} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ width: 8, height: 8, borderRadius: '2px', bgcolor: colors[f], flexShrink: 0 }} />
          <Typography variant='caption' sx={{ flex: 1 }}>{t(FAMILY_LABELS[f])}</Typography>
          <Typography variant='caption' sx={{ fontWeight: 600 }}>{row[f]}</Typography>
        </Box>
      ))}
      <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mt: 0.5 }}>
        {row.total > 0 ? t('changes.activityClick') : t('changes.activityEmpty')}
      </Typography>
    </Box>
  )
}

interface ActivityBarProps {
  family: Family
  selected: number | null
  /** Filled in by recharts, along with the geometry */
  payload?: ActivityRow
  [geometry: string]: unknown
}

/** One family's segment of a slot: rounded on top, dimmed outside the selection */
function ActivityBar({ family, selected, ...props }: Readonly<ActivityBarProps>) {
  return (
    <Rectangle
      {...(props as any)}
      radius={props.payload?.top === family ? [3, 3, 0, 0] : 0}
      fillOpacity={selected !== null && selected !== props.payload?.from ? 0.3 : 1}
    />
  )
}

/**
 * The journal's activity over a period, one stacked bar per clock slot and one
 * colour per family. A bar narrows the journal to its slot; a legend entry to
 * its family.
 */
export default function ActivityTimeline({
  buckets,
  period,
  onPeriod,
  selected,
  onSelect,
  onFamily,
  family,
  summary
}: Readonly<ActivityTimelineProps>) {
  const t = useTranslations()
  const locale = useLocale()
  const theme = useTheme()
  const mode = theme.palette.mode === 'dark' ? 'dark' : 'light'
  const colors = Object.fromEntries(FAMILIES.map(f => [f, FAMILY_COLORS[f][mode]])) as Record<Family, string>
  const surface = theme.palette.background.paper
  const ink = theme.palette.text.secondary

  const step = buckets.length > 1 ? buckets[1].from - buckets[0].from : DAY

  const data = buckets.map(b => {
    // The topmost non-empty family carries the rounded end of the bar
    const top = [...FAMILIES].reverse().find(f => b.counts[f] > 0)

    return { ...b.counts, from: b.from, to: b.to, total: b.total, top }
  })

  const tick = (ms: number) => {
    const d = new Date(ms)

    if (step < DAY && step <= HOUR) return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })

    return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })
  }

  const selectedBucket = selected === null ? undefined : buckets.find(b => b.from === selected)
  const present = FAMILIES.filter(f => buckets.some(b => b.counts[f] > 0))

  return (
    <Box sx={{ px: 2, pt: 2, pb: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.5, mb: 1 }}>
        <Typography variant='subtitle2' sx={{ fontWeight: 600 }}>{t('changes.activity')}</Typography>
        <Typography variant='caption' color='text.secondary'>
          {t('changes.activitySummary', summary)}
        </Typography>
        {selectedBucket && (
          <Chip
            size='small'
            icon={<i className='ri-time-line' style={{ fontSize: 14 }} />}
            label={bucketLabel(selectedBucket, locale)}
            onDelete={() => onSelect(null)}
            sx={{ height: 22 }}
          />
        )}
        <ToggleButtonGroup
          exclusive
          size='small'
          value={period}
          onChange={(_e, p: Period | null) => p && onPeriod(p)}
          sx={{ ml: 'auto', '& .MuiToggleButton-root': { py: 0.25, px: 1.25, fontSize: '0.75rem', textTransform: 'none' } }}
        >
          {PERIODS.map(p => <ToggleButton key={p} value={p}>{t(`changes.period.${p}`)}</ToggleButton>)}
        </ToggleButtonGroup>
      </Box>

      {/* The chart keeps its keyboard layer: the focus ring shows for the
          keyboard only, not after a click on a bar */}
      <ChartContainer height={110} sx={{ '& :focus:not(:focus-visible)': { outline: 'none' } }}>
        <BarChart
          data={data}
          margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
          barCategoryGap={2}
          onClick={state => {
            const b = buckets[Number(state?.activeTooltipIndex)]

            if (b) onSelect(b.total === 0 || b.from === selected ? null : b)
          }}
          style={{ cursor: 'pointer' }}
        >
          <CartesianGrid vertical={false} stroke={theme.palette.divider} strokeDasharray='3 3' />
          <XAxis
            dataKey='from'
            tickFormatter={tick}
            tick={{ fontSize: 11, fill: ink }}
            axisLine={false}
            tickLine={false}
            minTickGap={28}
          />
          <YAxis width={28} allowDecimals={false} tick={{ fontSize: 11, fill: ink }} axisLine={false} tickLine={false} />
          <Tooltip
            cursor={{ fill: theme.palette.action.hover }}
            isAnimationActive={false}
            content={<ActivityTooltip colors={colors} />}
          />
          {FAMILIES.map(f => (
            <Bar
              key={f}
              dataKey={f}
              stackId='activity'
              fill={colors[f]}
              stroke={surface}
              strokeWidth={1}
              isAnimationActive={false}
              shape={<ActivityBar family={f} selected={selected} />}
            />
          ))}
        </BarChart>
      </ChartContainer>

      {present.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
          {present.map(f => (
            <Chip
              key={f}
              size='small'
              variant={family === f ? 'filled' : 'outlined'}
              onClick={() => onFamily(f)}
              label={t(FAMILY_LABELS[f])}
              avatar={<Box component='span' sx={{ width: '8px !important', height: '8px !important', borderRadius: '2px', bgcolor: colors[f], ml: '8px !important' }} />}
              sx={{ height: 22, fontSize: '0.75rem', borderColor: 'divider' }}
            />
          ))}
        </Box>
      )}
    </Box>
  )
}
