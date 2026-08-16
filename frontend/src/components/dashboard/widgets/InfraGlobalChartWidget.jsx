'use client'

import React, { useState } from 'react'

import { useTranslations } from 'next-intl'
import { Box, CircularProgress, Typography, useTheme } from '@mui/material'
import { AreaChart, Area, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid } from 'recharts'
import ChartContainer from '@/components/ChartContainer'

import { NODE_COLORS, widgetColors } from './themeColors'
import { formatTime } from './timeRangeUtils'
import ConnectionFilter from './ConnectionFilter'
import { useNodeTrends } from './useNodeTrends'

const METRICS = ['cpu', 'ram']

// ─── Custom Tooltip ──────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label, metric, isDark }) {
  if (!active || !payload?.length) return null
  const c = widgetColors(isDark)
  const time = formatTime(payload) || label

  
return (
    <div style={{ background: c.tooltipBg, border: `1px solid ${c.tooltipBorder}`, borderRadius: 6, overflow: 'hidden', fontSize: '0.7143rem', minWidth: 100, color: c.tooltipText }}>
      <div style={{ background: metric === 'cpu' ? '#f97316' : '#3b82f6', color: '#fff', padding: '2px 8px', fontWeight: 700, fontSize: '0.6429rem', display: 'flex', alignItems: 'center', gap: 4 }}>
        <i className={metric === 'cpu' ? 'ri-cpu-line' : 'ri-database-2-line'} style={{ fontSize: '0.7143rem' }} />
        {metric.toUpperCase()} {time && <span style={{ fontWeight: 400, opacity: 0.8, marginLeft: 'auto' }}>{time}</span>}
      </div>
      <div style={{ padding: '4px 8px' }}>
        {payload.filter(e => !e.hide).map((entry) => (
          <div key={entry.dataKey} style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: entry.color, flexShrink: 0 }} />
            <span style={{ flex: 1, color: c.tooltipText }}>{entry.name}</span>
            <span style={{ fontWeight: 700, fontFamily: '"JetBrains Mono", monospace' }}>{entry.value}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Main Widget ─────────────────────────────────────────────────────────────
function InfraGlobalChartWidget({ data, loading: dashboardLoading, config, onUpdateSettings, timeRange }) {
  const t = useTranslations()
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const c = widgetColors(isDark)
  const [metric, setMetric] = useState('ram')
  const selectedConnections = config?.settings?.selectedConnections || []

  const handleFilterChange = (newSelected) => {
    if (onUpdateSettings) onUpdateSettings({ selectedConnections: newSelected })
  }

  const { trendsData, nodeNames, loading, allConnections } = useNodeTrends({
    data, selectedConnections, timeRange, metrics: METRICS,
  })

  if (dashboardLoading || loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4 }}>
        <CircularProgress size={24} />
      </Box>
    )
  }

  const isEmpty = !trendsData || trendsData.length === 0

  // Nothing to plot and no connection filter to blame: there is no control the
  // user could act on, so the bare empty state is still the right answer.
  if (isEmpty && selectedConnections.length === 0) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4, opacity: 0.65 }}>
        <Typography variant="caption">{t('common.noData')}</Typography>
      </Box>
    )
  }

  const suffix = metric === 'cpu' ? '_cpu' : '_ram'

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
      {/* Controls */}
      <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap' }}>
        {['cpu', 'ram'].map((v) => (
          <Box
            key={v}
            onClick={() => setMetric(v)}
            sx={{
              px: 1, py: 0.25, fontSize: '0.7143rem', fontWeight: metric === v ? 700 : 400, cursor: 'pointer',
              borderRadius: 1, color: metric === v ? '#fff' : c.textMuted,
              bgcolor: metric === v ? c.surfaceActive : 'transparent',
              '&:hover': { bgcolor: c.surfaceSubtle },
            }}
          >
            {v.toUpperCase()}
          </Box>
        ))}
        {allConnections.length > 1 && (
          <ConnectionFilter connections={allConnections} selected={selectedConnections} onChange={handleFilterChange} t={t} />
        )}
      </Box>

      {/* Chart — an active connection filter can empty it, so the empty state
          stays here and never replaces the controls above (#611). */}
      <Box sx={{ flex: 1, minHeight: 100, width: '100%' }}>
        {isEmpty ? (
          <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0.75 }}>
            <Typography variant="caption" sx={{ opacity: 0.65 }}>{t('common.noResults')}</Typography>
            <Box onClick={() => handleFilterChange([])} sx={{
              px: 1, py: 0.25, borderRadius: 1, cursor: 'pointer', fontSize: '0.7143rem', fontWeight: 600,
              color: c.textMuted, bgcolor: c.borderLight,
              '&:hover': { bgcolor: c.surfaceSubtle, color: '#fff' },
            }}>{t('common.reset')}</Box>
          </Box>
        ) : (
        <ChartContainer>
          <AreaChart data={trendsData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <defs>
              {nodeNames.map((name, i) => {
                const color = NODE_COLORS[i % NODE_COLORS.length]

                
return (
                  <linearGradient key={name} id={`infra-grad-${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={color} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={color} stopOpacity={0.02} />
                  </linearGradient>
                )
              })}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={c.borderLight} />
            <XAxis dataKey="t" tick={{ fontSize: '0.6429rem', fill: c.textMuted }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis domain={[0, 100]} tick={{ fontSize: '0.6429rem', fill: c.textMuted }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
            <RTooltip content={<ChartTooltip metric={metric} isDark={isDark} />} wrapperStyle={{ backgroundColor: 'transparent', zIndex: 10 }} />
            {nodeNames.map((name, i) => {
              const color = NODE_COLORS[i % NODE_COLORS.length]

              
return (
                <Area
                  key={name}
                  type="monotone"
                  dataKey={`${name}${suffix}`}
                  name={name}
                  stroke={color}
                  strokeWidth={1.5}
                  fill={`url(#infra-grad-${i})`}
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

export default React.memo(InfraGlobalChartWidget)
