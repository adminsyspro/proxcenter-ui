'use client'

import { Box, Stack, Typography, useTheme } from '@mui/material'
import { useLocale, useTranslations } from 'next-intl'
import { Area, AreaChart, Tooltip as RTooltip, XAxis, YAxis } from 'recharts'

import ChartContainer from '@/components/ChartContainer'
import { getDateLocale } from '@/lib/i18n/date'

import type { HealthScoreHistoryEntry } from '../../types'
import { COLORS } from '../../constants'
import { EmptyState, SectionCard } from './ui'

export default function HealthTrendCard({ history }: { history: HealthScoreHistoryEntry[] }) {
  const t = useTranslations()
  const theme = useTheme()
  const dateLocale = getDateLocale(useLocale())
  const points = history.map(h => ({
    label: new Date(`${h.date}T00:00:00`).toLocaleDateString(dateLocale, { day: 'numeric', month: 'short' }),
    score: h.score,
  }))
  const first = points[0]?.score
  const last = points.at(-1)?.score
  const delta = first !== undefined && last !== undefined ? last - first : null

  return (
    <SectionCard
      icon="ri-line-chart-line"
      title={t('resources.cockpit.healthTrend')}
      subtitle={t('resources.cockpit.healthTrendSub', { days: points.length })}
      action={delta !== null && points.length > 1 && (
        <Typography variant="body2" fontWeight={700} sx={{ color: delta >= 0 ? COLORS.success : COLORS.error }}>
          {delta >= 0 ? `+${delta}` : delta}
        </Typography>
      )}
    >
      {points.length < 2 ? (
        <EmptyState icon="ri-time-line" text={t('resources.cockpit.healthTrendEmpty')} />
      ) : (
        <Box sx={{ mx: -1 }}>
          <ChartContainer height={150}>
            <AreaChart data={points} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
              <defs>
                <linearGradient id="healthTrendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.primary} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={COLORS.primary} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: theme.palette.text.secondary }} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis domain={[(min: number) => Math.max(0, Math.floor((min - 5) / 10) * 10), 100]} allowDecimals={false} tick={{ fontSize: 10, fill: theme.palette.text.secondary }} tickLine={false} axisLine={false} />
              <RTooltip
                cursor={{ stroke: theme.palette.divider }}
                contentStyle={{ background: theme.palette.background.paper, border: `1px solid ${theme.palette.divider}`, borderRadius: 8, fontSize: 12 }}
                formatter={value => [String(value), t('resources.cockpit.score')]}
              />
              <Area type="monotone" dataKey="score" stroke={COLORS.primary} strokeWidth={2} fill="url(#healthTrendFill)" />
            </AreaChart>
          </ChartContainer>
        </Box>
      )}
      {points.length >= 2 && (
        <Stack direction="row" justifyContent="space-between" sx={{ mt: 1 }}>
          <Typography variant="caption" color="text.secondary">{t('resources.cockpit.healthTrendLow', { score: Math.min(...points.map(p => p.score)) })}</Typography>
          <Typography variant="caption" color="text.secondary">{t('resources.cockpit.healthTrendHigh', { score: Math.max(...points.map(p => p.score)) })}</Typography>
        </Stack>
      )}
    </SectionCard>
  )
}
