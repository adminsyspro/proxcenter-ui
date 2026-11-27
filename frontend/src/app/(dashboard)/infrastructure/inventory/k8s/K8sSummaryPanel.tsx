'use client'

import type { ReactNode } from 'react'
import { Box, Typography, Divider, useTheme } from '@mui/material'
import { useTranslations } from 'next-intl'
import { PieChart, Pie, Cell } from 'recharts'
import ChartContainer from '@/components/ChartContainer'
import CircularGauge from '@/components/dashboard/widgets/CircularGauge'
import { utilizationGradientColor } from '@/lib/k8s/metrics'
import { healthDotColor } from './ClusterCard'

/** Aggregate figures across all clusters, computed once by the dashboard. */
export type K8sSummary = {
  clusters: number
  nodesReady: number
  nodesTotal: number
  pods: number
  podsTruncated: boolean
  hasPods: boolean
  cpuPct: number
  memPct: number
  hasUtil: boolean
  health: { healthy: number; degraded: number; down: number }
}

// Health colours sourced from the shared helper so the donut, the legend and
// the per-row pastille stay identical.
const DOT = {
  healthy: healthDotColor('healthy'),
  degraded: healthDotColor('degraded'),
  down: healthDotColor('unreachable'),
  pending: healthDotColor('unknown'),
}

/** Count: icon + large value + small uppercase label. */
function Count({ iconEl, value, label }: { iconEl: ReactNode; value: string; label: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
      {iconEl}
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: '1.9rem', fontWeight: 700, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
          {value}
        </Typography>
        <Typography sx={{ fontSize: '0.64rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.6, opacity: 0.6, mt: 0.5 }}>
          {label}
        </Typography>
      </Box>
    </Box>
  )
}

/** CPU/RAM dial: reuses the shared CircularGauge (matches the cluster detail page). */
function Gauge({ value, icon, label, trackColor }: { value: number; icon: string; label: string; trackColor: string }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.75 }}>
      <CircularGauge value={value} color={utilizationGradientColor(value)} trackColor={trackColor} size="4.6em">
        <Box component="span" sx={{ fontWeight: 700, fontSize: '1.15em' }}>{value}%</Box>
      </CircularGauge>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, opacity: 0.7 }}>
        <Box component="i" className={icon} sx={{ fontSize: 14, opacity: 0.7 }} />
        {label}
      </Box>
    </Box>
  )
}

export default function K8sSummaryPanel({ summary }: { summary: K8sSummary }) {
  const t = useTranslations()
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const trackColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'

  const { healthy, degraded, down } = summary.health
  // Clusters not yet resolved to a definitive state (integrating / unknown):
  // the remainder, so the donut always sums to the cluster count.
  const pending = Math.max(0, summary.clusters - healthy - degraded - down)

  const segments = [
    { key: 'healthy', value: healthy, color: DOT.healthy },
    { key: 'degraded', value: degraded, color: DOT.degraded },
    { key: 'down', value: down, color: DOT.down },
    { key: 'pending', value: pending, color: DOT.pending },
  ]
  const pieData = segments.filter(s => s.value > 0)

  // Heart tint = the most attention-worthy state present (down > degraded >
  // healthy > pending-only).
  let heartColor = DOT.pending
  if (down > 0) heartColor = DOT.down
  else if (degraded > 0) heartColor = DOT.degraded
  else if (healthy > 0) heartColor = DOT.healthy

  // Legend: always show the three definitive buckets; add "pending" only when a
  // cluster is still integrating.
  const legend = [
    { key: 'healthy', label: t('kubernetes.health.healthy'), value: healthy, color: DOT.healthy },
    { key: 'degraded', label: t('kubernetes.health.degraded'), value: degraded, color: DOT.degraded },
    { key: 'down', label: t('kubernetes.health.unreachable'), value: down, color: DOT.down },
    ...(pending > 0 ? [{ key: 'pending', label: t('kubernetes.health.unknown'), value: pending, color: DOT.pending }] : []),
  ]

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 'var(--proxcenter-card-radius)', p: 2.5, mb: 1.5 }}>
      {/* Counts */}
      <Box sx={{ display: 'flex', gap: { xs: 3, sm: 5 }, flexWrap: 'wrap', rowGap: 2 }}>
        <Count
          iconEl={<img src="/images/kubernetes-logo.svg" alt="" width={28} height={28} />}
          value={String(summary.clusters)}
          label={t('kubernetes.kpi.clusters')}
        />
        {summary.nodesTotal > 0 && (
          <Count
            iconEl={<Box component="i" className="ri-server-line" sx={{ fontSize: 26, opacity: 0.55 }} />}
            value={`${summary.nodesReady}/${summary.nodesTotal}`}
            label={t('kubernetes.kpi.nodes')}
          />
        )}
        {summary.hasPods && (
          <Count
            iconEl={<Box component="i" className="ri-box-3-line" sx={{ fontSize: 26, opacity: 0.55 }} />}
            value={`${summary.pods}${summary.podsTruncated ? '+' : ''}`}
            label={t('kubernetes.kpi.pods')}
          />
        )}
      </Box>

      <Divider sx={{ my: 2 }} />

      {/* Visualizations */}
      <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center', rowGap: 2.5 }}>
        {summary.hasUtil && (
          <Gauge value={summary.cpuPct} icon="ri-cpu-line" label={t('kubernetes.kpi.cpu')} trackColor={trackColor} />
        )}
        {summary.hasUtil && (
          <Gauge value={summary.memPct} icon="ri-ram-line" label={t('kubernetes.kpi.ram')} trackColor={trackColor} />
        )}

        {/* Health donut + legend */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box sx={{ position: 'relative', width: 104, height: 104, flexShrink: 0 }}>
            <ChartContainer width={104} height={104}>
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="key"
                  innerRadius="66%"
                  outerRadius="92%"
                  startAngle={90}
                  endAngle={-270}
                  paddingAngle={pieData.length > 1 ? 3 : 0}
                  stroke="none"
                >
                  {pieData.map(s => <Cell key={s.key} fill={s.color} />)}
                </Pie>
              </PieChart>
            </ChartContainer>
            <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <Box component="i" className="ri-heart-pulse-line" sx={{ fontSize: 26, color: heartColor }} />
            </Box>
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            <Typography sx={{ fontSize: '0.64rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.6, opacity: 0.6 }}>
              {t('kubernetes.kpi.status')}
            </Typography>
            {legend.map(l => (
              <Box key={l.key} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: l.color, flexShrink: 0 }} />
                <Typography sx={{ fontSize: '0.9rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', minWidth: 14 }}>
                  {l.value}
                </Typography>
                <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>{l.label}</Typography>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
