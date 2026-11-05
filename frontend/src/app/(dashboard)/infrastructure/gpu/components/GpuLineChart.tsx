'use client'

import { useId } from 'react'

import { useLocale } from 'next-intl'
import { Box, Typography, useTheme } from '@mui/material'
import { Area, AreaChart, CartesianGrid, ReferenceLine, Tooltip as RTooltip, XAxis, YAxis } from 'recharts'

import ChartContainer from '@/components/ChartContainer'
import { getDateLocale } from '@/lib/i18n/date'
import { OTHER_COLOR, SERIES_COLORS, type ChartData } from '@/lib/gpu/pressure'

type Props = {
  title: string
  unit: string
  data: ChartData
  /** Fixed y range, [0, 100] for percentages. */
  domain?: [number, number | 'auto']
  /** Dashed line at the operator's threshold, with its label. */
  threshold?: { value: number; label: string }
  /** Long ranges label the axis with the day, short ones with the time. */
  withDate: boolean
  height?: number
  /** One colour for every series, the theme's own on a single GPU. */
  color?: string
}

export function formatTick(seconds: number, locale: string, withDate: boolean): string {
  const d = new Date(seconds * 1000)
  return withDate
    ? d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })
    : d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
}

/**
 * One measure of the GPUs over time, one line per GPU. One axis only: the
 * four measures (load, memory, temperature, power) are four charts.
 */
export default function GpuLineChart({ title, unit, data, domain, threshold, withDate, height = 190, color }: Props) {
  const theme = useTheme()
  const dark = theme.palette.mode === 'dark'
  const locale = getDateLocale(useLocale())
  const colors = dark ? SERIES_COLORS.dark : SERIES_COLORS.light
  const colorOf = (i: number | null) => color ?? (i === null ? OTHER_COLOR : colors[i])
  const axisTick = { fontSize: 10, fill: theme.palette.text.secondary }
  const labels = new Map(data.series.map(s => [s.key, s.label]))
  // Gradient ids are document-wide: one prefix per chart instance.
  const gradient = useId().replace(/:/g, '')
  // Many overlapping fills turn to mud: the fill fades as series add up.
  const fillOpacity = data.series.length > 3 ? 0.12 : 0.3

  return (
    <Box data-testid='gpu-line-chart' sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 1.5, display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
      <Typography variant='subtitle2' sx={{ fontWeight: 700 }}>{title}</Typography>
      <Box sx={{ mx: -1 }}>
        <ChartContainer height={height}>
          <AreaChart data={data.rows} margin={{ top: 6, right: 12, left: 4, bottom: 0 }}>
            <defs>
              {data.series.map(s => (
                <linearGradient key={s.key} id={`${gradient}-${s.key}`} x1='0' y1='0' x2='0' y2='1'>
                  <stop offset='0%' stopColor={colorOf(s.colorIndex)} stopOpacity={fillOpacity} />
                  <stop offset='100%' stopColor={colorOf(s.colorIndex)} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid vertical={false} stroke={theme.palette.divider} strokeDasharray='2 4' />
            <XAxis
              dataKey='time'
              type='number'
              domain={['dataMin', 'dataMax']}
              tickFormatter={v => formatTick(v, locale, withDate)}
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              minTickGap={32}
            />
            <YAxis domain={domain ?? [0, 'auto']} tick={axisTick} tickLine={false} axisLine={false} width={52} tickFormatter={v => `${v}${unit}`} allowDecimals={false} />
            {threshold && (
              <ReferenceLine
                y={threshold.value}
                stroke={theme.palette.warning.main}
                strokeDasharray='4 4'
                ifOverflow='extendDomain'
                label={{ value: threshold.label, position: 'insideTopRight', fontSize: 10, fill: theme.palette.text.secondary }}
              />
            )}
            <RTooltip
              cursor={{ stroke: theme.palette.text.disabled, strokeWidth: 1 }}
              contentStyle={{ background: theme.palette.background.paper, border: `1px solid ${theme.palette.divider}`, borderRadius: 8, fontSize: 12 }}
              labelFormatter={v => new Date(Number(v) * 1000).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              formatter={(value, key) => [value === null || value === undefined ? '-' : `${value}${unit}`, labels.get(String(key)) ?? String(key)]}
              itemSorter={item => -Number(item.value ?? 0)}
            />
            {data.series.map(s => (
              <Area
                key={s.key}
                dataKey={s.key}
                name={s.label}
                type='monotone'
                stroke={colorOf(s.colorIndex)}
                strokeWidth={2}
                fill={`url(#${gradient}-${s.key})`}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: theme.palette.background.paper }}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ChartContainer>
      </Box>
      {data.series.length > 1 && (
        <Box component='ul' aria-label={title} sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, m: 0, p: 0, listStyle: 'none' }}>
          {data.series.map(s => (
            <Box component='li' key={s.key} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
              <Box sx={{ width: 12, height: 3, borderRadius: 2, bgcolor: colorOf(s.colorIndex), flexShrink: 0 }} />
              <Typography variant='caption' color='text.secondary' sx={{ whiteSpace: 'nowrap' }}>{s.label}</Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}
