'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import {
  Box,
  CircularProgress,
  IconButton,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useTheme,
  alpha,
} from '@mui/material'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'

const TIMEFRAMES = [
  { value: 'hour', label: '1h' },
  { value: 'day', label: '24h' },
  { value: 'week', label: '7d' },
]

// Color palette for nodes
const NODE_COLORS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
  '#ec4899', '#f43f5e', '#ef4444', '#f97316',
  '#eab308', '#84cc16', '#22c55e', '#14b8a6',
  '#06b6d4', '#3b82f6', '#2563eb', '#7c3aed',
]

function InfraGlobalChartWidget({ data, loading: dashboardLoading }) {
  const t = useTranslations()
  const theme = useTheme()
  const [timeframe, setTimeframe] = useState('week')
  const [metric, setMetric] = useState('ram')
  const [trendsData, setTrendsData] = useState(null)
  const [nodeNames, setNodeNames] = useState([])
  const [loading, setLoading] = useState(false)
  const [hiddenNodes, setHiddenNodes] = useState(new Set())
  const [expanded, setExpanded] = useState(false)

  const toggleNodeVisibility = (name) => {
    setHiddenNodes(prev => {
      const allOthersHidden = nodeNames.every(n => n === name || prev.has(n))
      if (allOthersHidden) return new Set()
      return new Set(nodeNames.filter(n => n !== name))
    })
  }

  // Group nodes by connection
  const nodesByConnection = useMemo(() => {
    const nodes = data?.nodes || []
    const grouped = {}

    nodes.forEach((node) => {
      const connId = node.connectionId
      if (!connId) return
      if (!grouped[connId]) grouped[connId] = []
      grouped[connId].push({ node: node.name })
    })

    return grouped
  }, [data?.nodes])

  // Fetch trends data
  useEffect(() => {
    const fetchTrends = async () => {
      const connIds = Object.keys(nodesByConnection)
      if (connIds.length === 0) return

      setLoading(true)
      try {
        const results = await Promise.all(
          connIds.map(async (connId) => {
            const items = nodesByConnection[connId]
            const res = await fetch(`/api/v1/connections/${connId}/nodes/trends`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ items, timeframe }),
            })
            if (!res.ok) return {}
            const json = await res.json()
            return json.data || {}
          })
        )

        // Collect all node names and build per-timestamp data with per-node values
        const allNodeNames = new Set()
        const timeMap = new Map()

        results.forEach((connData) => {
          Object.entries(connData).forEach(([nodeKey, nodePoints]) => {
            const nodeName = nodeKey.replace(/^node:/, '')
            allNodeNames.add(nodeName)

            if (!Array.isArray(nodePoints)) return
            nodePoints.forEach((point) => {
              // Use epoch (ts) as map key for correct ordering, fall back to t
              const key = point.ts || point.t
              if (!timeMap.has(key)) {
                timeMap.set(key, { ts: point.ts || 0, t: point.t })
              }
              const entry = timeMap.get(key)
              entry[`${nodeName}_cpu`] = point.cpu || 0
              entry[`${nodeName}_ram`] = point.ram || 0
            })
          })
        })

        // Sort by epoch timestamp (ts), not by display string
        const aggregated = Array.from(timeMap.values())
          .sort((a, b) => a.ts - b.ts)

        // Gap-fill: PVE 8 vs 9 return different point counts, causing gaps.
        // Forward-fill then backward-fill to cover both trailing and leading gaps.
        const sortedNames = [...allNodeNames].sort()
        const keys = sortedNames.flatMap(name => [`${name}_cpu`, `${name}_ram`])
        const lastKnown = {}
        for (const slot of aggregated) {
          for (const key of keys) {
            if (slot[key] != null) {
              lastKnown[key] = slot[key]
            } else if (lastKnown[key] != null) {
              slot[key] = lastKnown[key]
            }
          }
        }
        const firstKnown = {}
        for (let i = aggregated.length - 1; i >= 0; i--) {
          const slot = aggregated[i]
          for (const key of keys) {
            if (slot[key] != null) {
              firstKnown[key] = slot[key]
            } else if (firstKnown[key] != null) {
              slot[key] = firstKnown[key]
            }
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
  }, [nodesByConnection, timeframe])

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload || payload.length === 0) return null

    return (
      <Box
        sx={{
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          p: 1.5,
          boxShadow: 3,
          maxWidth: 220,
        }}
      >
        <Typography variant="caption" sx={{ fontWeight: 700, mb: 0.5, display: 'block' }}>
          {label}
        </Typography>
        {payload.map((entry) => (
          <Box key={entry.dataKey} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
            <Typography variant="caption" sx={{ color: 'text.secondary', flex: 1 }}>
              {entry.name}
            </Typography>
            <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>
              {entry.value}%
            </Typography>
          </Box>
        ))}
      </Box>
    )
  }

  if (dashboardLoading || loading) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress size={24} />
      </Box>
    )
  }

  if (!trendsData || trendsData.length === 0) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography variant="caption" color="text.secondary">
          {t('common.noData')}
        </Typography>
      </Box>
    )
  }

  const suffix = metric === 'cpu' ? '_cpu' : '_ram'

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Controls */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, gap: 1 }}>
        <ToggleButtonGroup
          value={metric}
          exclusive
          onChange={(e, val) => val && setMetric(val)}
          size="small"
        >
          {['cpu', 'ram'].map((v) => (
            <ToggleButton key={v} value={v} sx={{ px: 1.5, py: 0.5, fontSize: '0.75rem', minWidth: 48, fontWeight: metric === v ? 700 : 400, '&.Mui-selected': { bgcolor: 'primary.main', color: 'primary.contrastText', '&:hover': { bgcolor: 'primary.dark' } } }}>
              {v.toUpperCase()}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <ToggleButtonGroup
            value={timeframe}
            exclusive
            onChange={(e, val) => val && setTimeframe(val)}
            size="small"
          >
            {TIMEFRAMES.map((tf) => (
              <ToggleButton key={tf.value} value={tf.value} sx={{ px: 1.5, py: 0.5, fontSize: '0.75rem', minWidth: 42, fontWeight: timeframe === tf.value ? 700 : 400, '&.Mui-selected': { bgcolor: 'primary.main', color: 'primary.contrastText', '&:hover': { bgcolor: 'primary.dark' } } }}>
                {tf.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <IconButton size="small" onClick={() => setExpanded(true)} sx={{ opacity: 0.4, '&:hover': { opacity: 1 } }}>
            <i className="ri-expand-diagonal-line" style={{ fontSize: 16 }} />
          </IconButton>
        </Box>
      </Box>

      {/* Chart */}
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <AreaChart data={trendsData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
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
            <CartesianGrid strokeDasharray="3 3" stroke={alpha(theme.palette.divider, 0.5)} />
            <XAxis
              dataKey="t"
              tick={{ fontSize: 10, fill: theme.palette.text.secondary }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fontSize: 10, fill: theme.palette.text.secondary }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip content={<CustomTooltip />} />
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
                  hide={hiddenNodes.has(name)}
                />
              )
            })}
          </AreaChart>
        </ResponsiveContainer>
      </Box>

      {/* Legend — compact node list, click to isolate */}
      {nodeNames.length > 1 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 0.5, justifyContent: 'center' }}>
          {nodeNames.map((name, i) => (
            <Box
              key={name}
              onClick={() => toggleNodeVisibility(name)}
              sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', opacity: hiddenNodes.has(name) ? 0.3 : 1, '&:hover': { opacity: hiddenNodes.has(name) ? 0.5 : 0.8 } }}
            >
              <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: NODE_COLORS[i % NODE_COLORS.length] }} />
              <Typography variant="caption" sx={{ fontSize: 9, color: 'text.secondary', textDecoration: hiddenNodes.has(name) ? 'line-through' : 'none' }}>{name}</Typography>
            </Box>
          ))}
        </Box>
      )}

      {/* Expanded overlay — portal to body to escape widget overflow */}
      {expanded && typeof document !== 'undefined' && createPortal(
        <Box
          onClick={() => setExpanded(false)}
          sx={{
            position: 'fixed', inset: 0, zIndex: 1300,
            bgcolor: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            p: 4,
          }}
        >
          <Box
            onClick={(e) => e.stopPropagation()}
            sx={{
              bgcolor: 'background.paper',
              borderRadius: 2,
              border: '1px solid',
              borderColor: 'divider',
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
              width: '95%',
              maxWidth: 1200,
              p: 3,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
              <Typography fontWeight={600}>Infra {metric.toUpperCase()}</Typography>
              <IconButton size="small" onClick={() => setExpanded(false)}>
                <i className="ri-close-line" style={{ fontSize: 18 }} />
              </IconButton>
            </Box>
            <Box sx={{ height: 500 }}>
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <AreaChart data={trendsData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <defs>
                    {nodeNames.map((name, i) => {
                      const color = NODE_COLORS[i % NODE_COLORS.length]
                      return (
                        <linearGradient key={name} id={`infra-grad-ex-${i}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={color} stopOpacity={0.25} />
                          <stop offset="95%" stopColor={color} stopOpacity={0.02} />
                        </linearGradient>
                      )
                    })}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={alpha(theme.palette.divider, 0.5)} />
                  <XAxis dataKey="t" tick={{ fontSize: 11, fill: theme.palette.text.secondary }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: theme.palette.text.secondary }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
                  <Tooltip content={<CustomTooltip />} />
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
                        fill={`url(#infra-grad-ex-${i})`}
                        dot={false}
                        activeDot={{ r: 3, strokeWidth: 0 }}
                        connectNulls
                        hide={hiddenNodes.has(name)}
                      />
                    )
                  })}
                </AreaChart>
              </ResponsiveContainer>
            </Box>
            {/* Legend in overlay */}
            {nodeNames.length > 1 && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 2, justifyContent: 'center' }}>
                {nodeNames.map((name, i) => (
                  <Box
                    key={name}
                    onClick={() => toggleNodeVisibility(name)}
                    sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', opacity: hiddenNodes.has(name) ? 0.3 : 1, '&:hover': { opacity: hiddenNodes.has(name) ? 0.5 : 0.8 } }}
                  >
                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: NODE_COLORS[i % NODE_COLORS.length] }} />
                    <Typography variant="caption" sx={{ fontSize: 11, textDecoration: hiddenNodes.has(name) ? 'line-through' : 'none' }}>{name}</Typography>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        </Box>,
        document.body
      )}
    </Box>
  )
}

export default React.memo(InfraGlobalChartWidget)
