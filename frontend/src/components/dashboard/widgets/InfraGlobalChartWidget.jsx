'use client'

import React, { useEffect, useMemo, useState } from 'react'

import { useTranslations } from 'next-intl'
import {
  Box, Checkbox, CircularProgress, IconButton, ListItemText, Menu, MenuItem,
  Tooltip, Typography, useTheme,
} from '@mui/material'
import { AreaChart, Area, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid } from 'recharts'
import ChartContainer from '@/components/ChartContainer'

import { widgetColors } from './themeColors'
import { mapTimeRange, formatTime } from './timeRangeUtils'

const NODE_COLORS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
  '#ec4899', '#f43f5e', '#ef4444', '#f97316',
  '#eab308', '#84cc16', '#22c55e', '#14b8a6',
  '#06b6d4', '#3b82f6', '#2563eb', '#7c3aed',
]

// ─── Custom Tooltip ──────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label, metric, isDark }) {
  if (!active || !payload?.length) return null
  const c = widgetColors(isDark)
  const time = formatTime(payload) || label

  
return (
    <div style={{ background: c.tooltipBg, border: `1px solid ${c.tooltipBorder}`, borderRadius: 6, overflow: 'hidden', fontSize: 10, minWidth: 100, color: c.tooltipText }}>
      <div style={{ background: metric === 'cpu' ? '#f97316' : '#3b82f6', color: '#fff', padding: '2px 8px', fontWeight: 700, fontSize: 9, display: 'flex', alignItems: 'center', gap: 4 }}>
        <i className={metric === 'cpu' ? 'ri-cpu-line' : 'ri-database-2-line'} style={{ fontSize: 10 }} />
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

// ─── Connection Filter ───────────────────────────────────────────────────────
function ConnectionFilter({ connections, selected, onChange, t }) {
  const [anchorEl, setAnchorEl] = useState(null)
  const allSelected = !selected || selected.length === 0

  const handleToggle = (id) => {
    if (allSelected) {
      onChange([id])
    } else if (selected.includes(id)) {
      const next = selected.filter(k => k !== id)

      onChange(next.length === 0 ? [] : next)
    } else {
      onChange([...selected, id])
    }
  }

  return (
    <>
      <Tooltip title={t('common.filter')}>
        <IconButton size='small' onClick={(e) => { e.stopPropagation(); setAnchorEl(e.currentTarget) }} sx={{ p: 0.25 }}>
          <i className='ri-filter-3-line' style={{ fontSize: 14, opacity: allSelected ? 0.65 : 1 }} />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)} slotProps={{ paper: { sx: { maxHeight: 300 } } }}>
        <MenuItem dense onClick={() => { onChange([]); setAnchorEl(null) }}>
          <Checkbox size='small' checked={allSelected} sx={{ p: 0, mr: 1 }} />
          <ListItemText primaryTypographyProps={{ fontSize: 12 }}>{t('common.all')}</ListItemText>
        </MenuItem>
        {connections.map(c => {
          const checked = allSelected || selected.includes(c.id)

          
return (
            <MenuItem key={c.id} dense onClick={() => handleToggle(c.id)}>
              <Checkbox size='small' checked={checked} sx={{ p: 0, mr: 1 }} />
              <ListItemText primaryTypographyProps={{ fontSize: 12 }}>{c.name}</ListItemText>
            </MenuItem>
          )
        })}
      </Menu>
    </>
  )
}

// ─── Main Widget ─────────────────────────────────────────────────────────────
function InfraGlobalChartWidget({ data, loading: dashboardLoading, config, onUpdateSettings, timeRange }) {
  const t = useTranslations()
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const c = widgetColors(isDark)
  const [metric, setMetric] = useState('ram')
  const [trendsData, setTrendsData] = useState(null)
  const [nodeNames, setNodeNames] = useState([])
  const [loading, setLoading] = useState(false)

  const selectedConnections = config?.settings?.selectedConnections || []

  const handleFilterChange = (newSelected) => {
    if (onUpdateSettings) onUpdateSettings({ selectedConnections: newSelected })
  }

  // All connections for filter (try clusters first, fallback to unique connections from nodes)
  const allConnections = useMemo(() => {
    const clusters = (data?.clusters || []).map(c => ({ id: c.id, name: c.name }))

    if (clusters.length > 0) return clusters
    const seen = new Set()

    return (data?.nodes || []).reduce((acc, n) => {
      const id = n.connectionId || n.connId

      if (id && !seen.has(id)) { seen.add(id); acc.push({ id, name: n.connection || id }) }

      return acc
    }, [])
  }, [data?.clusters, data?.nodes])

  // Stable key for nodes
  const nodesStableKey = (data?.nodes || []).map(n => `${n.connectionId || n.connId}:${n.name}`).join(',')
  const selectedKey = selectedConnections.join(',')

  // Group nodes by connection, filtered
  const nodesByConnection = useMemo(() => {
    const nodes = data?.nodes || []
    const grouped = {}
    const validConnIds = new Set(nodes.map(n => n.connectionId || n.connId).filter(Boolean))

    // If selectedConnections references IDs that don't exist, ignore the filter
    const effectiveFilter = selectedConnections.length > 0 && selectedConnections.some(id => validConnIds.has(id))
      ? selectedConnections : []

    nodes.forEach((node) => {
      const connId = node.connectionId || node.connId

      if (!connId) return
      if (effectiveFilter.length > 0 && !effectiveFilter.includes(connId)) return
      if (!grouped[connId]) grouped[connId] = []
      grouped[connId].push({ node: node.node || node.name })
    })

    return grouped
  }, [nodesStableKey, selectedKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch trends
  useEffect(() => {
    const fetchTrends = async () => {
      const connIds = Object.keys(nodesByConnection)

      if (connIds.length === 0) return

      // Only show full loading on first fetch, not on refresh
      if (!trendsData) setLoading(true)

      try {
        const results = await Promise.all(
          connIds.map(async (connId) => {
            const items = nodesByConnection[connId]

            const res = await fetch(`/api/v1/connections/${connId}/nodes/trends`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ items, timeframe: mapTimeRange(timeRange).trendsTimeframe }),
            })

            if (!res.ok) return {}
            const json = await res.json()

            
return json.data || {}
          })
        )

        const allNodeNames = new Set()
        const timeMap = new Map()

        results.forEach((connData) => {
          Object.entries(connData).forEach(([nodeKey, nodePoints]) => {
            const nodeName = nodeKey.replace(/^node:/, '')

            allNodeNames.add(nodeName)
            if (!Array.isArray(nodePoints)) return
            nodePoints.forEach((point) => {
              const key = point.ts || point.t

              if (!timeMap.has(key)) timeMap.set(key, { ts: point.ts || 0, t: point.t })
              const entry = timeMap.get(key)

              entry[`${nodeName}_cpu`] = point.cpu || 0
              entry[`${nodeName}_ram`] = point.ram || 0
            })
          })
        })

        const aggregated = Array.from(timeMap.values()).sort((a, b) => a.ts - b.ts)
        const sortedNames = [...allNodeNames].sort((a, b) => a.localeCompare(b))
        const keys = sortedNames.flatMap(name => [`${name}_cpu`, `${name}_ram`])
        const lastKnown = {}

        for (const slot of aggregated) {
          for (const key of keys) {
            if (slot[key] != null) lastKnown[key] = slot[key]
            else if (lastKnown[key] != null) slot[key] = lastKnown[key]
          }
        }

        const firstKnown = {}

        for (let i = aggregated.length - 1; i >= 0; i--) {
          const slot = aggregated[i]

          for (const key of keys) {
            if (slot[key] != null) firstKnown[key] = slot[key]
            else if (firstKnown[key] != null) slot[key] = firstKnown[key]
          }
        }

        setNodeNames(sortedNames)
        setTrendsData(aggregated)
      } catch (e) {
        console.error('Failed to fetch infra trends:', e)
        setTrendsData([])
      } finally {
        setLoading(false)
      }
    }

    fetchTrends()
  }, [nodesStableKey, selectedKey, timeRange]) // eslint-disable-line react-hooks/exhaustive-deps

  if (dashboardLoading || loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4 }}>
        <CircularProgress size={24} />
      </Box>
    )
  }

  if (!trendsData || trendsData.length === 0) {
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
        borderRadius: 2.5, p: 1.5, display: 'flex', flexDirection: 'column', gap: 0.75,
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
              px: 1, py: 0.25, fontSize: 10, fontWeight: metric === v ? 700 : 400, cursor: 'pointer',
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

      {/* Chart */}
      <Box sx={{ flex: 1, minHeight: 100, width: '100%' }}>
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
            <XAxis dataKey="t" tick={{ fontSize: 9, fill: c.textMuted }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: c.textMuted }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
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
      </Box>

    </Box>
  )
}

export default React.memo(InfraGlobalChartWidget)
