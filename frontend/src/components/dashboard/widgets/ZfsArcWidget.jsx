'use client'

import React, { useMemo, useState } from 'react'

import { useTranslations } from 'next-intl'
import { Box, CircularProgress, Typography, useTheme } from '@mui/material'
import { AreaChart, Area, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid } from 'recharts'
import ChartContainer from '@/components/ChartContainer'

import { formatBytes } from '@/utils/format'

import { NODE_COLORS, widgetColors } from './themeColors'
import { formatTime } from './timeRangeUtils'
import ConnectionFilter from './ConnectionFilter'
import { useNodeTrends } from './useNodeTrends'

const METRICS = ['arc', 'arcPct']

// The ARC series colour of the node Summary chart, kept identical so the same
// metric reads the same way in both places.
const ARC_ACCENT = '#8b5cf6'

export const formatValue = (metric, value) => {
  if (value == null) return '-'

  return metric === 'arcPct' ? `${value}%` : formatBytes(value)
}

// ─── Custom Tooltip ──────────────────────────────────────────────────────────
export function ChartTooltip({ active, payload, label, metric, isDark }) {
  if (!active || !payload?.length) return null
  const c = widgetColors(isDark)
  const time = formatTime(payload) || label

  return (
    <div style={{ background: c.tooltipBg, border: `1px solid ${c.tooltipBorder}`, borderRadius: 6, overflow: 'hidden', fontSize: '0.7143rem', minWidth: 100, color: c.tooltipText }}>
      <div style={{ background: ARC_ACCENT, color: '#fff', padding: '2px 8px', fontWeight: 700, fontSize: '0.6429rem', display: 'flex', alignItems: 'center', gap: 4 }}>
        <i className='ri-ram-2-line' style={{ fontSize: '0.7143rem' }} />
        ZFS ARC {time && <span style={{ fontWeight: 400, opacity: 0.8, marginLeft: 'auto' }}>{time}</span>}
      </div>
      <div style={{ padding: '4px 8px' }}>
        {payload.filter(e => !e.hide).map((entry) => (
          <div key={entry.dataKey} style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: entry.color, flexShrink: 0 }} />
            <span style={{ flex: 1, color: c.tooltipText }}>{entry.name}</span>
            <span style={{ fontWeight: 700 }}>{formatValue(metric, entry.value)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Keeps only the nodes that actually report ARC.
 *
 * A node on PVE 8 has no `arcsize` column at all, and a node without ZFS
 * reports nothing usable: both are dropped rather than drawn as a flat zero
 * line that would read as "ARC collapsed".
 */
export function selectArcNodes(trendsData, nodeNames) {
  if (!trendsData?.length) return []

  return nodeNames.filter(name => trendsData.some(p => (p[`${name}_arc`] ?? 0) > 0))
}

// ─── Main Widget ─────────────────────────────────────────────────────────────
function ZfsArcWidget({ data, loading: dashboardLoading, config, onUpdateSettings, timeRange }) {
  const t = useTranslations()
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const c = widgetColors(isDark)
  const [metric, setMetric] = useState('arc')

  const selectedConnections = config?.settings?.selectedConnections || []

  const handleFilterChange = (newSelected) => {
    if (onUpdateSettings) onUpdateSettings({ selectedConnections: newSelected })
  }

  const { trendsData, nodeNames, loading, allConnections } = useNodeTrends({
    data, selectedConnections, timeRange, metrics: METRICS, defaultValue: null,
  })

  const arcNodes = useMemo(() => selectArcNodes(trendsData, nodeNames), [trendsData, nodeNames])

  if (dashboardLoading || loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4 }}>
        <CircularProgress size={24} />
      </Box>
    )
  }

  const isEmpty = arcNodes.length === 0
  const suffix = metric === 'arcPct' ? '_arcPct' : '_arc'

  return (
    <Box
      sx={{
        bgcolor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
        border: '1px solid', borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
        borderRadius: 'var(--proxcenter-card-radius)', p: 1.5, display: 'flex', flexDirection: 'column', gap: 0.75,
        transition: 'box-shadow 0.2s ease, border-color 0.2s ease',
        '&:hover': { borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)', boxShadow: isDark ? '0 2px 8px rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.08)' },
        height: '100%',
      }}
    >
      {/* Controls — kept mounted even on an empty chart, same reasoning as #611:
          the connection filter is persisted, so it must stay reachable. */}
      <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* A noContainer widget shows no title outside edit mode, so the toggle
            labels are what names the metric on screen. */}
        {[['arc', 'ARC'], ['arcPct', '% RAM']].map(([v, labelText]) => (
          <Box
            key={v}
            onClick={() => setMetric(v)}
            sx={{
              px: 1, py: 0.25, fontSize: '0.7143rem', fontWeight: metric === v ? 700 : 400, cursor: 'pointer',
              // textPrimary, not a hardcoded white: the active chip sits on a
              // near-white surface in light mode.
              borderRadius: 1, color: metric === v ? c.textPrimary : c.textMuted,
              bgcolor: metric === v ? c.surfaceActive : 'transparent',
              '&:hover': { bgcolor: c.surfaceSubtle, color: c.textPrimary },
            }}
          >
            {labelText}
          </Box>
        ))}
        {allConnections.length > 1 && (
          <ConnectionFilter connections={allConnections} selected={selectedConnections} onChange={handleFilterChange} t={t} />
        )}
      </Box>

      <Box sx={{ flex: 1, minHeight: 100, width: '100%' }}>
        {isEmpty ? (
          <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0.75, px: 1 }}>
            <Typography variant="caption" sx={{ opacity: 0.65, textAlign: 'center' }}>{t('dashboard.widgetArc.noData')}</Typography>
            {selectedConnections.length > 0 && (
              <Box onClick={() => handleFilterChange([])} sx={{
                px: 1, py: 0.25, borderRadius: 1, cursor: 'pointer', fontSize: '0.7143rem', fontWeight: 600,
                color: c.textMuted, bgcolor: c.borderLight,
                '&:hover': { bgcolor: c.surfaceSubtle, color: c.textPrimary },
              }}>{t('common.reset')}</Box>
            )}
          </Box>
        ) : (
        <ChartContainer>
          <AreaChart data={trendsData} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
            <defs>
              {arcNodes.map((name, i) => {
                const color = NODE_COLORS[i % NODE_COLORS.length]


return (
                  <linearGradient key={name} id={`arc-grad-${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={color} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={color} stopOpacity={0.02} />
                  </linearGradient>
                )
              })}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={c.borderLight} />
            <XAxis dataKey="t" tick={{ fontSize: '0.6429rem', fill: c.textMuted }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            {/* Bytes autoscale on their own axis: that is the whole point of a
                dedicated widget, ARC is orders of magnitude below total RAM. */}
            <YAxis
              domain={metric === 'arcPct' ? [0, 100] : [0, 'auto']}
              width={54}
              tick={{ fontSize: '0.6429rem', fill: c.textMuted }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => (metric === 'arcPct' ? `${v}%` : formatBytes(v, 0))}
            />
            <RTooltip content={<ChartTooltip metric={metric} isDark={isDark} />} wrapperStyle={{ backgroundColor: 'transparent', zIndex: 10 }} />
            {arcNodes.map((name, i) => {
              const color = NODE_COLORS[i % NODE_COLORS.length]


return (
                <Area
                  key={name}
                  type="monotone"
                  dataKey={`${name}${suffix}`}
                  name={name}
                  stroke={color}
                  strokeWidth={1.5}
                  fill={`url(#arc-grad-${i})`}
                  dot={false}
                  activeDot={{ r: 3, strokeWidth: 0 }}
                  connectNulls
                  isAnimationActive={false}
                />
              )
            })}
          </AreaChart>
        </ChartContainer>
        )}
      </Box>
    </Box>
  )
}

export default React.memo(ZfsArcWidget)
