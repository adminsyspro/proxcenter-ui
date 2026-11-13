'use client'

import { useId } from 'react'

import { useTranslations } from 'next-intl'
import { Box, Tooltip, Typography, alpha, useTheme } from '@mui/material'
import { Area, AreaChart, YAxis } from 'recharts'

import ChartContainer from '@/components/ChartContainer'
import type { FleetLoad, FleetTrendPoint, GpuThresholds } from '@/lib/gpu/pressure'

type Tone = 'ok' | 'warning' | 'error'

export function KpiFrame({ testId, color, alert, children }: { testId: string; color: string; alert?: boolean; children: React.ReactNode }) {
  const theme = useTheme()
  return (
    <Box
      data-testid={testId}
      sx={{
        position: 'relative',
        overflow: 'hidden',
        border: 1,
        borderColor: alert ? color : 'divider',
        borderRadius: 2,
        px: 1.75,
        pt: 1.25,
        pb: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        background: `linear-gradient(135deg, ${alpha(color, 0.08)} 0%, ${alpha(theme.palette.background.paper, 0)} 60%)`,
      }}
    >
      {children}
    </Box>
  )
}

export function KpiHead({ icon, color, label, aside }: { icon: string; color: string; label: string; aside?: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
      <Box sx={{ width: 30, height: 30, borderRadius: 1.5, display: 'grid', placeItems: 'center', bgcolor: alpha(color, 0.14), color, flexShrink: 0 }}>
        <i className={icon} style={{ fontSize: 17 }} aria-hidden />
      </Box>
      <Typography variant='caption' color='text.secondary' sx={{ fontWeight: 600, flex: 1, minWidth: 0 }} noWrap>{label}</Typography>
      {aside && <Typography variant='caption' color='text.secondary' noWrap>{aside}</Typography>}
    </Box>
  )
}

/** The last hours of one fleet measure, as a thin area in the tile's colour. */
function Spark({ data, field, color, max }: { data: FleetTrendPoint[]; field: 'util' | 'memory' | 'power'; color: string; max?: number }) {
  const gradient = useId().replace(/:/g, '')
  const read = data.filter(p => p[field] !== null)
  if (read.length < 2) return <Box sx={{ height: 34 }} />
  return (
    <Box sx={{ mx: -1.75, mb: -1 }} aria-hidden>
      <ChartContainer height={38}>
        <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradient} x1='0' y1='0' x2='0' y2='1'>
              <stop offset='0%' stopColor={color} stopOpacity={0.35} />
              <stop offset='100%' stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={[0, max ?? 'auto']} />
          <Area type='monotone' dataKey={field} stroke={color} strokeWidth={2} fill={`url(#${gradient})`} dot={false} connectNulls={false} isAnimationActive={false} />
        </AreaChart>
      </ChartContainer>
    </Box>
  )
}

/** One segment per measured GPU, coloured when the GPU is concerned. */
function Segments({ hit, total, color }: { hit: number; total: number; color: string }) {
  const theme = useTheme()
  if (!total) return <Box sx={{ height: 8 }} />
  if (total > 24) {
    return (
      <Box sx={{ height: 8, borderRadius: 4, bgcolor: alpha(theme.palette.text.primary, 0.08), overflow: 'hidden' }}>
        <Box sx={{ width: `${(hit / total) * 100}%`, height: '100%', bgcolor: color }} />
      </Box>
    )
  }
  return (
    <Box sx={{ display: 'flex', gap: '3px', height: 8 }}>
      {Array.from({ length: total }, (_, i) => (
        <Box key={i} sx={{ flex: 1, borderRadius: 1, bgcolor: i < hit ? color : alpha(theme.palette.text.primary, 0.08) }} />
      ))}
    </Box>
  )
}

/**
 * The six figures of the GPU fleet (#672): load, memory and power with their
 * last hours, then how many GPUs are saturated, short of memory and hot or
 * slowed down, out of those measured. Colour is never alone: every tile has
 * its label and its value.
 */
export default function LoadKpis({ fleet, thresholds, trend, unit }: { fleet: FleetLoad; thresholds: GpuThresholds; trend: FleetTrendPoint[]; unit: string }) {
  const t = useTranslations('gpu.load')
  const theme = useTheme()
  const gib = (mib: number) => `${(mib / 1024).toFixed(mib >= 10240 ? 0 : 1)}`
  // Load in the theme's colour, memory in its info blue, power in the violet of
  // the chart palette (the theme's secondary is a grey).
  const colors = { load: theme.palette.primary.main, memory: theme.palette.info.main, power: theme.palette.mode === 'dark' ? '#8b7cf6' : '#6250d6' }
  const toneColor = (tone: Tone) => (tone === 'error' ? theme.palette.error.main : tone === 'warning' ? theme.palette.warning.main : theme.palette.success.main)
  const counts: Array<{ testId: string; icon: string; label: string; aside: string; hit: number; tone: Tone }> = [
    { testId: 'gpu-load-saturated', icon: 'ri-speed-up-line', label: t('saturatedCount'), aside: t('threshold', { value: thresholds.util_pct }), hit: fleet.saturated, tone: fleet.saturated ? 'warning' : 'ok' },
    { testId: 'gpu-load-memory-pressure', icon: 'ri-database-2-line', label: t('memoryPressureCount'), aside: t('threshold', { value: thresholds.memory_pct }), hit: fleet.memoryPressure, tone: fleet.memoryPressure ? 'warning' : 'ok' },
    { testId: 'gpu-load-throttled', icon: 'ri-temp-hot-line', label: t('throttledCount'), aside: t('tempThreshold', { value: thresholds.temp_c }), hit: fleet.hotOrThrottled, tone: fleet.hotOrThrottled ? 'error' : 'ok' },
  ]

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 1.5 }}>
      <KpiFrame testId='gpu-load-util' color={colors.load}>
        <KpiHead icon='ri-dashboard-3-line' color={colors.load} label={t('avgUtil')} aside={t('gpusRead', { count: fleet.gpus })} />
        <Typography variant='h5' sx={{ fontWeight: 700 }}>{Math.round(fleet.avgUtil)} %</Typography>
        <Spark data={trend} field='util' color={colors.load} max={100} />
      </KpiFrame>
      <KpiFrame testId='gpu-load-memory' color={colors.memory}>
        <KpiHead icon='ri-cpu-line' color={colors.memory} label={t('memory')} aside={`${gib(fleet.memoryUsed)} / ${gib(fleet.memoryTotal)} ${unit}`} />
        <Typography variant='h5' sx={{ fontWeight: 700 }}>{Math.round(fleet.memoryPct)} %</Typography>
        <Spark data={trend} field='memory' color={colors.memory} max={100} />
      </KpiFrame>
      <KpiFrame testId='gpu-load-power' color={colors.power}>
        <KpiHead icon='ri-flashlight-line' color={colors.power} label={t('power')} />
        <Typography variant='h5' sx={{ fontWeight: 700 }}>{Math.round(fleet.power)} W</Typography>
        <Spark data={trend} field='power' color={colors.power} />
      </KpiFrame>
      {counts.map(c => {
        const color = toneColor(c.tone)
        return (
          <KpiFrame key={c.testId} testId={c.testId} color={color} alert={c.tone !== 'ok'}>
            <KpiHead icon={c.icon} color={color} label={c.label} aside={c.aside} />
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
              <Typography variant='h5' sx={{ fontWeight: 700, color: c.tone === 'ok' ? 'text.primary' : color }}>{c.hit}</Typography>
              <Typography variant='caption' color='text.secondary'>{t('ofMeasured', { count: fleet.gpus })}</Typography>
            </Box>
            <Tooltip title={t('ofMeasured', { count: fleet.gpus })} disableInteractive>
              <Box sx={{ pt: 0.75, pb: 0.5 }}>
                <Segments hit={c.hit} total={fleet.gpus} color={color} />
              </Box>
            </Tooltip>
          </KpiFrame>
        )
      })}
    </Box>
  )
}
