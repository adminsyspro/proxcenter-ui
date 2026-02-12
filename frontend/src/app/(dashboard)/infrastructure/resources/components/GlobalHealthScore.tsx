'use client'

import {
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Stack,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useTranslations } from 'next-intl'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  Tooltip as RTooltip,
} from 'recharts'

import type { KpiData, PredictiveAlert, HealthScoreHistoryEntry } from '../types'
import { COLORS } from '../constants'
import { formatPct } from '../helpers'

function getScoreColor(score: number) {
  if (score >= 80) return COLORS.success
  if (score >= 60) return COLORS.warning
  return COLORS.error
}

function getScoreLabel(score: number, t: ReturnType<typeof useTranslations>) {
  if (score >= 80) return t('monitoring.healthGood')
  if (score >= 60) return t('monitoring.healthWarning')
  return t('monitoring.healthCritical')
}

export default function GlobalHealthScore({
  score,
  kpis,
  alerts,
  loading,
  history,
}: {
  score: number
  kpis: KpiData | null
  alerts: PredictiveAlert[]
  loading?: boolean
  history?: HealthScoreHistoryEntry[]
}) {
  const t = useTranslations()
  const color = getScoreColor(score)

  // Calculate delta from history (F8)
  const delta = (() => {
    if (!history || history.length < 2) return null
    const recent = history[history.length - 1]
    const daysAgo = history.length > 30 ? history[history.length - 31] : history[0]
    return recent.score - daysAgo.score
  })()

  return (
    <Card variant="outlined">
      <CardContent sx={{ p: 2.5 }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={3}
          alignItems={{ md: 'center' }}
        >
          {/* Score circle */}
          <Stack direction="row" spacing={2} alignItems="center">
            <Box sx={{ position: 'relative', display: 'inline-flex' }}>
              <CircularProgress
                variant={loading ? 'indeterminate' : 'determinate'}
                value={score}
                size={72}
                thickness={5}
                sx={{
                  color,
                  '& .MuiCircularProgress-circle': {
                    strokeLinecap: 'round',
                  },
                }}
              />
              <Box
                sx={{
                  position: 'absolute',
                  top: 0, left: 0, bottom: 0, right: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Typography variant="h5" fontWeight={800} sx={{ color }}>
                  {loading ? '—' : score}
                </Typography>
              </Box>
            </Box>
            <Box>
              <Typography variant="h6" fontWeight={700}>
                {t('resources.infrastructureHealth')}
              </Typography>
              <Stack direction="row" spacing={1} alignItems="center">
                <Chip
                  size="small"
                  label={loading ? '...' : getScoreLabel(score, t)}
                  sx={{
                    height: 22,
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    bgcolor: alpha(color, 0.1),
                    color,
                  }}
                />
                {delta !== null && (
                  <Chip
                    size="small"
                    label={`${delta >= 0 ? '+' : ''}${delta}`}
                    sx={{
                      height: 22,
                      fontSize: '0.65rem',
                      fontWeight: 700,
                      bgcolor: alpha(delta >= 0 ? COLORS.success : COLORS.error, 0.1),
                      color: delta >= 0 ? COLORS.success : COLORS.error,
                    }}
                  />
                )}
              </Stack>
            </Box>
          </Stack>

          {/* KPI summary */}
          {kpis && !loading && (
            <Stack direction="row" spacing={3} sx={{ flex: 1 }}>
              {[
                { label: 'CPU', value: kpis.cpu.used, color: COLORS.cpu },
                { label: 'RAM', value: kpis.ram.used, color: COLORS.ram },
                {
                  label: t('resources.storageLabel'),
                  value: kpis.storage.total > 0 ? (kpis.storage.used / kpis.storage.total) * 100 : 0,
                  color: COLORS.storage,
                },
              ].map(item => (
                <Box key={item.label}>
                  <Typography variant="caption" color="text.secondary">
                    {item.label}
                  </Typography>
                  <Typography variant="body1" fontWeight={700} sx={{ color: item.color }}>
                    {formatPct(item.value)}
                  </Typography>
                </Box>
              ))}
              <Box>
                <Typography variant="caption" color="text.secondary">
                  {t('resources.efficiency')}
                </Typography>
                <Typography variant="body1" fontWeight={700}>
                  {kpis.efficiency}%
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  {t('resources.activeVms')}
                </Typography>
                <Typography variant="body1" fontWeight={700}>
                  {kpis.vms.running}/{kpis.vms.total}
                </Typography>
              </Box>
            </Stack>
          )}

          {/* Sparkline from history (F8) */}
          {history && history.length > 1 && (
            <Box sx={{ width: 120, height: 40, flexShrink: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history}>
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke={color}
                    strokeWidth={2}
                    dot={false}
                  />
                  <RTooltip
                    contentStyle={{ fontSize: 10, padding: '2px 6px' }}
                    formatter={(v: any) => [`${v}`, 'Score']}
                    labelFormatter={(l: any) => l}
                  />
                </LineChart>
              </ResponsiveContainer>
            </Box>
          )}
        </Stack>
      </CardContent>
    </Card>
  )
}
