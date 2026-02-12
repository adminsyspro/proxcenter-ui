'use client'

import { useState, useMemo } from 'react'
import {
  Box,
  Card,
  CardContent,
  Skeleton,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useTheme,
} from '@mui/material'
import { useTranslations } from 'next-intl'
import {
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  ReferenceLine,
  ComposedChart,
  Line,
  Area,
} from 'recharts'

import type { ResourceTrend, ResourceThresholds } from '../types'
import { COLORS, DEFAULT_THRESHOLDS } from '../constants'
import { InsightsIcon } from './icons'

export default function ProjectionChart({ data, loading, period, thresholds, historyRange, projectionRange, onHistoryRangeChange, onProjectionRangeChange }: {
  data: ResourceTrend[]
  loading?: boolean
  period?: { start: string | null; end: string | null; daysCount: number } | null
  thresholds?: ResourceThresholds
  historyRange?: number
  projectionRange?: number
  onHistoryRangeChange?: (range: number) => void
  onProjectionRangeChange?: (range: number) => void
}) {
  const theme = useTheme()
  const t = useTranslations()
  const [selectedResource, setSelectedResource] = useState<'all' | 'cpu' | 'ram' | 'storage'>('all')
  const th = thresholds || DEFAULT_THRESHOLDS

  const displayData = useMemo(() => {
    if (!historyRange || !data.length) return data
    const projCount = projectionRange || 30
    const histCount = data.length - projCount
    if (histCount <= 0) return data
    const trimmedHistStart = Math.max(0, histCount - historyRange)
    return [...data.slice(trimmedHistStart, histCount), ...data.slice(histCount)]
  }, [data, historyRange, projectionRange])

  if (loading) {
    return (
      <Card variant="outlined" sx={{ height: '100%' }}>
        <CardContent>
          <Skeleton variant="text" width="50%" height={32} sx={{ mb: 2 }} />
          <Skeleton variant="rectangular" height={300} sx={{ borderRadius: 2 }} />
        </CardContent>
      </Card>
    )
  }

  const projCount = projectionRange || 30
  const historicalCount = Math.max(0, displayData.length - projCount)

  const formatPeriod = () => {
    if (!period || !period.start || !period.end) return ''
    const startDate = new Date(period.start)
    const endDate = new Date(period.end)
    const formatOptions: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }
    return `${startDate.toLocaleDateString('fr-FR', formatOptions)} → ${endDate.toLocaleDateString('fr-FR', formatOptions)}`
  }

  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }} flexWrap="wrap" useFlexGap spacing={1}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <InsightsIcon sx={{ color: COLORS.primary }} />
            <Typography variant="h6" fontWeight={700}>
              {t('resources.evolutionProjections')}
              {period && period.start && (
                <Typography component="span" variant="body2" sx={{ ml: 1, color: 'text.secondary', fontWeight: 400 }}>
                  ({formatPeriod()})
                </Typography>
              )}
            </Typography>
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            {onHistoryRangeChange && (
              <ToggleButtonGroup value={historyRange || 180} exclusive onChange={(_, v) => v && onHistoryRangeChange(v)} size="small">
                <ToggleButton value={7} sx={{ px: 1, py: 0.25, textTransform: 'none', fontSize: '0.7rem' }}>7j</ToggleButton>
                <ToggleButton value={30} sx={{ px: 1, py: 0.25, textTransform: 'none', fontSize: '0.7rem' }}>30j</ToggleButton>
                <ToggleButton value={90} sx={{ px: 1, py: 0.25, textTransform: 'none', fontSize: '0.7rem' }}>90j</ToggleButton>
                <ToggleButton value={180} sx={{ px: 1, py: 0.25, textTransform: 'none', fontSize: '0.7rem' }}>180j</ToggleButton>
              </ToggleButtonGroup>
            )}
            {onProjectionRangeChange && (
              <ToggleButtonGroup value={projectionRange || 30} exclusive onChange={(_, v) => v && onProjectionRangeChange(v)} size="small">
                <ToggleButton value={7} sx={{ px: 1, py: 0.25, textTransform: 'none', fontSize: '0.7rem' }}>+7j</ToggleButton>
                <ToggleButton value={30} sx={{ px: 1, py: 0.25, textTransform: 'none', fontSize: '0.7rem' }}>+30j</ToggleButton>
                <ToggleButton value={90} sx={{ px: 1, py: 0.25, textTransform: 'none', fontSize: '0.7rem' }}>+90j</ToggleButton>
              </ToggleButtonGroup>
            )}
            <ToggleButtonGroup value={selectedResource} exclusive onChange={(_, v) => v && setSelectedResource(v)} size="small">
              <ToggleButton value="all" sx={{ px: 1.5, py: 0.5, textTransform: 'none' }}>{t('resources.filterAll')}</ToggleButton>
              <ToggleButton value="cpu" sx={{ px: 1.5, py: 0.5, textTransform: 'none' }}>CPU</ToggleButton>
              <ToggleButton value="ram" sx={{ px: 1.5, py: 0.5, textTransform: 'none' }}>RAM</ToggleButton>
              <ToggleButton value="storage" sx={{ px: 1.5, py: 0.5, textTransform: 'none' }}>{t('resources.storageLabel')}</ToggleButton>
            </ToggleButtonGroup>
          </Stack>
        </Stack>

        <Box sx={{ width: '100%', height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={displayData}>
              <defs>
                <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS.cpu} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={COLORS.cpu} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="ramGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS.ram} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={COLORS.ram} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="storageGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS.storage} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={COLORS.storage} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" tick={{ fontSize: 10 }} interval="preserveStartEnd" tickLine={false} axisLine={{ stroke: theme.palette.divider }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} tickLine={false} axisLine={{ stroke: theme.palette.divider }} />
              <RTooltip contentStyle={{ background: theme.palette.background.paper, border: `1px solid ${theme.palette.divider}`, borderRadius: 8 }} formatter={(v: any, name: string) => [`${Number(v).toFixed(1)}%`, name]} />
              <ReferenceLine y={th.cpu.critical} stroke={COLORS.error} strokeDasharray="5 5" strokeOpacity={0.5} />
              {th.cpu.warning !== th.cpu.critical && <ReferenceLine y={th.cpu.warning} stroke={COLORS.warning} strokeDasharray="3 3" strokeOpacity={0.3} />}
              {historicalCount > 0 && <ReferenceLine x={displayData[historicalCount - 1]?.t} stroke={theme.palette.divider} strokeDasharray="3 3" label={{ value: 'Projection →', position: 'top', fontSize: 10, fill: theme.palette.text.secondary }} />}

              {(selectedResource === 'all' || selectedResource === 'cpu') && (
                <>
                  <Area type="monotone" dataKey="cpu" name="CPU" stroke={COLORS.cpu} strokeWidth={2} fill="url(#cpuGrad)" dot={false} />
                  <Line type="monotone" dataKey="cpuProjection" name={t('resources.cpuProjected')} stroke={COLORS.cpu} strokeWidth={2} strokeDasharray="6 4" dot={false} opacity={0.8} />
                </>
              )}
              {(selectedResource === 'all' || selectedResource === 'ram') && (
                <>
                  <Area type="monotone" dataKey="ram" name="RAM" stroke={COLORS.ram} strokeWidth={2} fill="url(#ramGrad)" dot={false} />
                  <Line type="monotone" dataKey="ramProjection" name={t('resources.ramProjected')} stroke={COLORS.ram} strokeWidth={2} strokeDasharray="6 4" dot={false} opacity={0.8} />
                </>
              )}
              {(selectedResource === 'all' || selectedResource === 'storage') && (
                <>
                  <Area type="monotone" dataKey="storage" name={t('resources.storageLabel')} stroke={COLORS.storage} strokeWidth={2} fill="url(#storageGrad)" dot={false} />
                  <Line type="monotone" dataKey="storageProjection" name={t('resources.storageProjected')} stroke={COLORS.storage} strokeWidth={2} strokeDasharray="6 4" dot={false} opacity={0.8} />
                </>
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </Box>

        <Stack direction="row" spacing={3} justifyContent="center" sx={{ mt: 2 }}>
          {(selectedResource === 'all' || selectedResource === 'cpu') && <Stack direction="row" alignItems="center" spacing={0.75}><Box sx={{ width: 12, height: 3, bgcolor: COLORS.cpu, borderRadius: 1 }} /><Typography variant="caption">CPU</Typography></Stack>}
          {(selectedResource === 'all' || selectedResource === 'ram') && <Stack direction="row" alignItems="center" spacing={0.75}><Box sx={{ width: 12, height: 3, bgcolor: COLORS.ram, borderRadius: 1 }} /><Typography variant="caption">RAM</Typography></Stack>}
          {(selectedResource === 'all' || selectedResource === 'storage') && <Stack direction="row" alignItems="center" spacing={0.75}><Box sx={{ width: 12, height: 3, bgcolor: COLORS.storage, borderRadius: 1 }} /><Typography variant="caption">{t('resources.storageLabel')}</Typography></Stack>}
          <Stack direction="row" alignItems="center" spacing={0.75}><Box sx={{ width: 12, height: 2, borderTop: '2px dashed', borderColor: 'text.secondary' }} /><Typography variant="caption" color="text.secondary">Projection</Typography></Stack>
        </Stack>
      </CardContent>
    </Card>
  )
}
