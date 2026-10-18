'use client'

// Usage history of one vDC (#902): one counter at a time over a chosen range,
// the peak of each period as the curve, the quota as a dashed line, and the
// CSV export of the same range. Shared by the provider's vDC panel and the
// tenant's My vDC page; only the route differs.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'

import { Box, IconButton, LinearProgress, Paper, Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { Area, AreaChart, CartesianGrid, ReferenceLine, Tooltip as RTooltip, XAxis, YAxis } from 'recharts'

import ChartContainer from '@/components/ChartContainer'

export type UsageRange = '24h' | '7d' | '30d' | '12m'
type Counter = 'usedVcpus' | 'usedRamMb' | 'usedStorageMb' | 'usedVms' | 'usedSnapshots' | 'usedBackups'
type Stats = { max: number; avg: number; last: number }

interface Period {
  periodStart: string
  periodEnd: string
  samples: number
  counters: Record<Counter, Stats>
}

interface History {
  bucket: string
  deleted?: boolean
  enabled: boolean
  intervalMinutes: number
  retentionDays: number
  lastSampledAt: string | null
  periods: Period[]
}

export interface VdcQuotaLike {
  maxVcpus?: number | null
  maxRamMb?: number | null
  maxStorageMb?: number | null
  maxVms?: number | null
  maxSnapshots?: number | null
  maxBackups?: number | null
}

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const TICK_FORMATS: Record<UsageRange, Intl.DateTimeFormatOptions> = {
  '24h': { hour: '2-digit', minute: '2-digit' },
  '7d': { day: '2-digit', month: '2-digit', hour: '2-digit' },
  '30d': { day: '2-digit', month: 'short' },
  '12m': { month: 'short', year: '2-digit' },
}
const BUCKET_MS: Record<string, number> = { sample: 0, hour: HOUR_MS, day: DAY_MS, month: 31 * DAY_MS }

export interface ChartRow {
  t: number
  peak: number | null
  avg: number | null
  last: number | null
  samples: number
}

/**
 * Breaks the curve over an outage (sampler stopped, server down): an empty
 * row between the two points, so the chart shows a hole instead of a straight
 * line. A step is a hole when it exceeds `minGapMs` and three times the
 * spacing of its neighbours, so a change of cadence is not mistaken for one.
 */
export function breakGaps(rows: ChartRow[], minGapMs: number): ChartRow[] {
  const step = (i: number) => (i >= 1 && i < rows.length ? rows[i].t - rows[i - 1].t : 0)
  const out: ChartRow[] = []
  rows.forEach((row, i) => {
    const prev = rows[i - 1]
    if (prev && step(i) > Math.max(minGapMs, 3 * Math.max(step(i - 1), step(i + 1)))) {
      out.push({ t: Math.round((prev.t + row.t) / 2), peak: null, avg: null, last: null, samples: 0 })
    }
    out.push(row)
  })
  return out
}

export const RANGES: Record<UsageRange, { spanMs: number; bucket: string }> = {
  '24h': { spanMs: DAY_MS, bucket: 'sample' },
  '7d': { spanMs: 7 * DAY_MS, bucket: 'hour' },
  '30d': { spanMs: 30 * DAY_MS, bucket: 'day' },
  '12m': { spanMs: 365 * DAY_MS, bucket: 'month' },
}

const COUNTERS: Array<{ key: Counter; icon: string; label: string; quota: keyof VdcQuotaLike; mb: boolean }> = [
  { key: 'usedVcpus', icon: 'ri-cpu-line', label: 'counterVcpus', quota: 'maxVcpus', mb: false },
  { key: 'usedRamMb', icon: 'ri-ram-2-line', label: 'counterRam', quota: 'maxRamMb', mb: true },
  { key: 'usedStorageMb', icon: 'ri-hard-drive-2-line', label: 'counterStorage', quota: 'maxStorageMb', mb: true },
  { key: 'usedVms', icon: 'ri-computer-line', label: 'counterVms', quota: 'maxVms', mb: false },
  { key: 'usedSnapshots', icon: 'ri-camera-lens-line', label: 'counterSnapshots', quota: 'maxSnapshots', mb: false },
  { key: 'usedBackups', icon: 'ri-archive-line', label: 'counterBackups', quota: 'maxBackups', mb: false },
]

/** Query string of a range ending now; `to` is rounded up to the minute so a re-render does not refetch. */
export function historyQuery(range: UsageRange, now: number, format?: 'csv'): string {
  const { spanMs, bucket } = RANGES[range]
  const to = Math.ceil(now / 60_000) * 60_000
  const params = new URLSearchParams({
    from: new Date(to - spanMs).toISOString(),
    to: new Date(to).toISOString(),
    bucket,
  })

  if (format) params.set('format', format)

  return params.toString()
}

/** Round an axis top up to 1, 1.5, 2, 2.5... times a power of ten, so the ticks fall on round values. */
export function niceCeil(v: number): number {
  if (!(v > 0)) return 1
  const step = 10 ** Math.floor(Math.log10(v))

  return (Math.ceil((v / step) * 2) / 2) * step
}

interface Props {
  /** /api/v1/admin/vdcs/{id}/usage/history or /api/v1/vdcs/{id}/usage/history */
  historyUrl: string
  quota?: VdcQuotaLike | null
  /** Drop the outer card and the title (the provider dialog has its own). */
  bare?: boolean
  /** Range shown first (a deleted vDC opens on the range holding its last samples). */
  initialRange?: UsageRange
}

/** The shortest range that still holds a sample taken at `lastSampledAt`. */
export function rangeHolding(lastSampledAt: string | null | undefined, now: number = Date.now()): UsageRange {
  const age = lastSampledAt ? now - Date.parse(lastSampledAt) : 0

  return (Object.keys(RANGES) as UsageRange[]).find(r => age < RANGES[r].spanMs) ?? '12m'
}

export default function VdcUsageHistoryChart({ historyUrl, quota, bare = false, initialRange = '24h' }: Props) {
  const t = useTranslations('vdcUsageHistory')
  const locale = useLocale()
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const accent = theme.palette.primary.main

  const [range, setRange] = useState<UsageRange>(initialRange)
  const [counter, setCounter] = useState<Counter>('usedStorageMb')
  const [history, setHistory] = useState<History | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const url = `${historyUrl}?${historyQuery(range, now)}`

  useEffect(() => {
    let cancelled = false

    fetch(url, { cache: 'no-store' })
      .then(async res => {
        const json = await res.json().catch(() => ({}))

        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
        if (cancelled) return
        setHistory(json?.data && Array.isArray(json.data.periods) ? json.data : null)
        setError(null)
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message || String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [url])

  const spec = COUNTERS.find(c => c.key === counter)!
  const toUnit = useCallback((v: number) => (spec.mb ? Math.round((v / 1024) * 10) / 10 : v), [spec.mb])
  const formatValue = (v: number) => (spec.mb ? `${v.toFixed(1)} GB` : String(Math.round(v * 100) / 100))
  const quotaRaw = quota?.[spec.quota]
  const quotaValue = quotaRaw != null ? toUnit(Number(quotaRaw)) : null

  const rows = useMemo(() => {
    const points: ChartRow[] = (history?.periods ?? []).map(p => ({
      t: new Date(p.periodStart).getTime(),
      peak: toUnit(p.counters[counter].max),
      avg: toUnit(p.counters[counter].avg),
      last: toUnit(p.counters[counter].last),
      samples: p.samples,
    }))
    // A hole is at least three sampling intervals, or two aggregation buckets.
    const minGapMs = Math.max(3 * (history?.intervalMinutes ?? 15) * 60_000, 2 * (BUCKET_MS[history?.bucket ?? 'sample'] ?? 0))

    return breakGaps(points, minGapMs)
  }, [history, counter, toUnit])

  const tickFormat = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, TICK_FORMATS[range])

    return (ms: number) => fmt.format(new Date(ms))
  }, [range, locale])

  const fullFormat = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }), [locale])

  const dataMax = rows.reduce((m, r) => Math.max(m, r.peak ?? 0), 0)
  const yMax = niceCeil(Math.max(dataMax, quotaValue ?? 0) * 1.1)

  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'
  const axisColor = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)'
  const csvHref = `${historyUrl}?${historyQuery(range, now, 'csv')}`

  // What the sampler does for this vDC, and what the empty chart says.
  let status = t('cadence', { minutes: history?.intervalMinutes ?? 15, days: history?.retentionDays ?? 0 })
  let emptyText = t('empty', { minutes: history?.intervalMinutes ?? 15 })
  if (history && !history.enabled) {
    status = t('disabled')
    emptyText = t('disabled')
  }
  if (history?.deleted) {
    status = t('deletedCaption', { days: history.retentionDays })
    emptyText = t('emptyDeleted')
  }
  const showEmpty = !error && !loading && rows.length === 0
  const caption = history
    ? [
        status,
        history.lastSampledAt ? t('lastSample', { date: fullFormat.format(new Date(history.lastSampledAt)) }) : t('noSampleYet'),
      ].join(' · ')
    : ''

  const tooltip = ({ active, payload }: any) => {
    const row = payload?.[0]?.payload
    if (!active || row?.peak == null) return null

    return (
      <Paper elevation={6} sx={{ px: 1.25, py: 1, minWidth: 170 }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
          {fullFormat.format(new Date(row.t))}
        </Typography>
        {[
          ['peak', row.peak],
          ['average', row.avg],
          ['last', row.last],
        ].map(([k, v]) => (
          <Stack key={k as string} direction="row" justifyContent="space-between" spacing={2}>
            <Typography variant="caption">{t(k as string)}</Typography>
            <Typography variant="caption" sx={{ fontWeight: 600 }}>{formatValue(v as number)}</Typography>
          </Stack>
        ))}
        <Stack direction="row" justifyContent="space-between" spacing={2}>
          <Typography variant="caption" color="text.secondary">{t('samples')}</Typography>
          <Typography variant="caption" color="text.secondary">{row.samples}</Typography>
        </Stack>
      </Paper>
    )
  }

  const body = (
    <Box data-testid="vdc-usage-history">
      {!bare && (
        <Typography variant="subtitle1" sx={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <i className="ri-line-chart-line" />
          {t('title')}
        </Typography>
      )}
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1, flexWrap: 'wrap', rowGap: 1 }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={counter}
          onChange={(_e, v) => v && setCounter(v)}
          sx={{ flexWrap: 'wrap' }}
        >
          {COUNTERS.map(c => (
            <ToggleButton key={c.key} value={c.key} sx={{ px: 1.25, py: 0.25, gap: 0.75, textTransform: 'none' }}>
              <i className={c.icon} style={{ fontSize: 14 }} />
              {t(c.label)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Box sx={{ flexGrow: 1 }} />
        <ToggleButtonGroup
          size="small"
          exclusive
          value={range}
          onChange={(_e, v) => {
            if (v && v !== range) {
              setLoading(true)
              setRange(v)
              setNow(Date.now())
            }
          }}
        >
          {(Object.keys(RANGES) as UsageRange[]).map(r => (
            <ToggleButton key={r} value={r} sx={{ px: 1.25, py: 0.25, textTransform: 'none' }}>
              {t(`range${r}`)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Tooltip title={t('exportCsv')}>
          <IconButton size="small" component="a" href={csvHref} download aria-label={t('exportCsv')}>
            <i className="ri-download-2-line" style={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
      </Stack>
      {loading && <LinearProgress sx={{ mb: 1, height: 2 }} />}
      {error && (
        <Typography variant="body2" color="error" sx={{ py: 4, textAlign: 'center' }}>{error}</Typography>
      )}
      {showEmpty && (
        <Box sx={{ py: 6, textAlign: 'center', color: 'text.secondary' }}>
          <i className="ri-line-chart-line" style={{ fontSize: 32, opacity: 0.4 }} />
          <Typography variant="body2" sx={{ mt: 1 }}>{emptyText}</Typography>
        </Box>
      )}
      {!error && !showEmpty && (
        <ChartContainer height={220}>
          <AreaChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="vdcUsageFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={accent} stopOpacity={0.3} />
                <stop offset="100%" stopColor={accent} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={gridColor} vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickFormatter={tickFormat}
              tick={{ fill: axisColor, fontSize: 10 }}
              stroke={axisColor}
              minTickGap={32}
            />
            <YAxis
              domain={[0, yMax]}
              allowDecimals={spec.mb}
              tickFormatter={(v: number) => (spec.mb ? `${Math.round(v)}` : `${Math.round(v * 10) / 10}`)}
              tick={{ fill: axisColor, fontSize: 10 }}
              stroke={axisColor}
              width={44}
              unit={spec.mb ? ' GB' : undefined}
            />
            <RTooltip content={tooltip} />
            {quotaValue != null && (
              <ReferenceLine
                y={quotaValue}
                stroke={theme.palette.error.main}
                strokeDasharray="6 4"
                label={{ value: `${t('quota')} ${formatValue(quotaValue)}`, position: 'insideTopRight', fill: theme.palette.text.secondary, fontSize: 10 }}
              />
            )}
            <Area
              type="monotone"
              dataKey="peak"
              name={t('peak')}
              stroke={accent}
              strokeWidth={2}
              fill="url(#vdcUsageFill)"
              dot={rows.length <= 60 ? { r: 3, strokeWidth: 0, fill: accent } : false}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ChartContainer>
      )}
      {caption && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          {caption}
        </Typography>
      )}
    </Box>
  )

  if (bare) return body

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      {body}
    </Paper>
  )
}
