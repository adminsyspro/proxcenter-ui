'use client'

// Platform status, Host section: load average and memory of the host over
// the last hour, 6 hours or 24 hours. The history lives in the memory of the
// frontend process (lib/platform/history.ts), so it starts again after a
// restart: the empty state says so instead of drawing a flat line.

import type { ReactNode } from 'react'

import { Box, Paper, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { useLocale, useTranslations } from 'next-intl'
import { Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceLine, Tooltip as RTooltip, XAxis, YAxis } from 'recharts'

import ChartContainer from '@/components/ChartContainer'
import { useSWRFetch } from '@/hooks/useSWRFetch'
import type { HostHistory, HostHistoryRange } from '@/lib/platform/types'
import { formatBytes } from '@/utils/format'

const RANGES: HostHistoryRange[] = ['1h', '6h', '24h']
const REFRESH_MS = 30_000
const CHART_HEIGHT = 190
const GIB = 2 ** 30

interface TooltipRow {
  key: string
  label: string
  color: string
  value: string
}

function ChartTooltip({ title, rows }: Readonly<{ title: string; rows: TooltipRow[] }>) {
  return (
    <Paper elevation={4} sx={{ px: 1.25, py: 0.75 }}>
      <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>
        {title}
      </Typography>
      {rows.map(row => (
        <Box key={row.key} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: row.color, flexShrink: 0 }} />
          <Typography variant='caption' sx={{ flex: 1 }}>
            {row.label}
          </Typography>
          <Typography variant='caption' fontWeight={600} sx={{ pl: 2 }}>
            {row.value}
          </Typography>
        </Box>
      ))}
    </Paper>
  )
}

function Legend({ items }: Readonly<{ items: { label: string; color: string; dashed?: boolean }[] }>) {
  return (
    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
      {items.map(item => (
        <Box key={item.label} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Box sx={{ width: 14, height: 0, borderTop: '2px', borderTopStyle: item.dashed ? 'dashed' : 'solid', borderColor: item.color }} />
          <Typography variant='caption' color='text.secondary'>
            {item.label}
          </Typography>
        </Box>
      ))}
    </Box>
  )
}

/** The period selector, shown by the Host section in its header. */
export function HistoryRangeToggle({ value, onChange }: Readonly<{ value: HostHistoryRange; onChange: (range: HostHistoryRange) => void }>) {
  const t = useTranslations('platformStatus.history')

  return (
    <ToggleButtonGroup size='small' exclusive value={value} onChange={(_e, v: HostHistoryRange | null) => v && onChange(v)} aria-label={t('range')}>
      {RANGES.map(r => (
        <ToggleButton key={r} value={r} sx={{ py: 0.25, px: 1.25 }}>
          {t(`ranges.${r}`)}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  )
}

export default function HostHistoryCharts({ range }: Readonly<{ range: HostHistoryRange }>) {
  const t = useTranslations('platformStatus.history')
  const locale = useLocale()
  const theme = useTheme()
  const { data, error } = useSWRFetch<HostHistory>(`/api/v1/system/status/history?range=${range}`, {
    refreshInterval: REFRESH_MS,
    keepPreviousData: true
  })

  const axisColor = theme.palette.text.secondary
  const gridColor = theme.palette.divider
  const series = {
    load1: theme.palette.primary.main,
    load5: theme.palette.info.main,
    load15: theme.palette.text.disabled,
    memory: theme.palette.primary.main,
    limit: theme.palette.error.main
  }

  const timeFormat = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' })
  const fullFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'medium' })
  const tick = (ms: number) => timeFormat.format(ms)
  const samples = data?.samples ?? []
  const domain: [number, number] | undefined = data ? [data.from, data.to] : undefined
  const loadMax = Math.max(data?.cpus ?? 0, ...samples.map(s => Math.max(s.load1, s.load5, s.load15)), 1)
  const memTotalGib = (data?.memTotalBytes ?? 0) / GIB
  const memory = samples.map(s => ({ t: s.t, used: s.memUsedBytes / GIB }))

  const axis = {
    dataKey: 't',
    type: 'number' as const,
    scale: 'time' as const,
    domain,
    tickFormatter: tick,
    tick: { fill: axisColor, fontSize: 10 },
    stroke: axisColor,
    minTickGap: 40
  }

  let body: ReactNode

  if (error && !data) {
    body = (
      <Typography variant='body2' color='text.secondary'>
        {t('unavailable')}
      </Typography>
    )
  } else if (samples.length < 2) {
    body = (
      <Typography variant='body2' color='text.secondary' sx={{ py: 2 }}>
        {t('collecting')}
      </Typography>
    )
  } else {
    body = (
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: '32px' }}>
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 0.5, flexWrap: 'wrap' }}>
            <Typography variant='body2' fontWeight={600}>
              {t('load')}
            </Typography>
            <Legend
              items={[
                { label: t('load1'), color: series.load1 },
                { label: t('load5'), color: series.load5 },
                { label: t('load15'), color: series.load15 },
                { label: t('cores', { cpus: data!.cpus }), color: series.limit, dashed: true }
              ]}
            />
          </Box>
          <ChartContainer height={CHART_HEIGHT}>
            <LineChart data={samples} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={gridColor} vertical={false} />
              <XAxis {...axis} />
              <YAxis domain={[0, Math.ceil(loadMax * 1.1)]} tick={{ fill: axisColor, fontSize: 10 }} stroke={axisColor} width={36} allowDecimals={false} />
              <RTooltip
                content={({ active, payload }) => {
                  const point = payload?.[0]?.payload

                  if (!active || !point) return null

                  return (
                    <ChartTooltip
                      title={fullFormat.format(point.t)}
                      rows={[
                        { key: 'load1', label: t('load1'), color: series.load1, value: point.load1.toFixed(2) },
                        { key: 'load5', label: t('load5'), color: series.load5, value: point.load5.toFixed(2) },
                        { key: 'load15', label: t('load15'), color: series.load15, value: point.load15.toFixed(2) }
                      ]}
                    />
                  )
                }}
              />
              {data!.cpus > 0 && <ReferenceLine y={data!.cpus} stroke={series.limit} strokeDasharray='6 4' />}
              <Line type='monotone' dataKey='load15' stroke={series.load15} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line type='monotone' dataKey='load5' stroke={series.load5} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line type='monotone' dataKey='load1' stroke={series.load1} strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ChartContainer>
        </Box>

        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 0.5, flexWrap: 'wrap' }}>
            <Typography variant='body2' fontWeight={600}>
              {t('memory')}
            </Typography>
            <Legend
              items={[
                { label: t('memoryUsed'), color: series.memory },
                { label: t('memoryTotal', { total: formatBytes(data!.memTotalBytes, 1) }), color: series.limit, dashed: true }
              ]}
            />
          </Box>
          <ChartContainer height={CHART_HEIGHT}>
            <AreaChart data={memory} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id='platformMemoryFill' x1='0' y1='0' x2='0' y2='1'>
                  <stop offset='0%' stopColor={series.memory} stopOpacity={0.3} />
                  <stop offset='100%' stopColor={series.memory} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={gridColor} vertical={false} />
              <XAxis {...axis} />
              <YAxis
                domain={[0, memTotalGib > 0 ? Math.ceil(memTotalGib) : 'auto']}
                tick={{ fill: axisColor, fontSize: 10 }}
                stroke={axisColor}
                width={52}
                unit=' GiB'
                allowDecimals={false}
              />
              <RTooltip
                content={({ active, payload }) => {
                  const point = payload?.[0]?.payload

                  if (!active || !point) return null

                  return (
                    <ChartTooltip
                      title={fullFormat.format(point.t)}
                      rows={[{ key: 'used', label: t('memoryUsed'), color: series.memory, value: formatBytes(point.used * GIB, 1) }]}
                    />
                  )
                }}
              />
              {memTotalGib > 0 && <ReferenceLine y={memTotalGib} stroke={series.limit} strokeDasharray='6 4' />}
              <Area type='monotone' dataKey='used' stroke={series.memory} strokeWidth={2} fill='url(#platformMemoryFill)' dot={false} isAnimationActive={false} />
            </AreaChart>
          </ChartContainer>
        </Box>
      </Box>
    )
  }

  return <Box sx={{ mb: 2 }}>{body}</Box>
}
