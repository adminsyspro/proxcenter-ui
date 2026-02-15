'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Box,
  CircularProgress,
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
  const [timeframe, setTimeframe] = useState('day')
  const [metric, setMetric] = useState('cpu')
  const [trendsData, setTrendsData] = useState(null)
  const [nodeNames, setNodeNames] = useState([])
  const [loading, setLoading] = useState(false)

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
              const key = point.t
              if (!timeMap.has(key)) {
                timeMap.set(key, { t: key })
              }
              const entry = timeMap.get(key)
              entry[`${nodeName}_cpu`] = point.cpu || 0
              entry[`${nodeName}_ram`] = point.ram || 0
            })
          })
        })

        // Also compute global average for each timestamp
        const aggregated = Array.from(timeMap.values())
          .map((entry) => {
            const names = [...allNodeNames]
            let cpuSum = 0, ramSum = 0, count = 0

            names.forEach((name) => {
              if (entry[`${name}_cpu`] !== undefined) {
                cpuSum += entry[`${name}_cpu`]
                ramSum += entry[`${name}_ram`]
                count++
              }
            })

            entry.cpu_avg = count > 0 ? Math.round((cpuSum / count) * 10) / 10 : 0
            entry.ram_avg = count > 0 ? Math.round((ramSum / count) * 10) / 10 : 0
            return entry
          })
          .sort((a, b) => a.t.localeCompare(b.t))

        setNodeNames([...allNodeNames].sort())
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
  const avgKey = metric === 'cpu' ? 'cpu_avg' : 'ram_avg'

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
          <ToggleButton value="cpu" sx={{ px: 1.5, py: 0.25, fontSize: '0.65rem', minWidth: 40 }}>
            CPU
          </ToggleButton>
          <ToggleButton value="ram" sx={{ px: 1.5, py: 0.25, fontSize: '0.65rem', minWidth: 40 }}>
            RAM
          </ToggleButton>
        </ToggleButtonGroup>

        <ToggleButtonGroup
          value={timeframe}
          exclusive
          onChange={(e, val) => val && setTimeframe(val)}
          size="small"
        >
          {TIMEFRAMES.map((tf) => (
            <ToggleButton key={tf.value} value={tf.value} sx={{ px: 1, py: 0.25, fontSize: '0.65rem', minWidth: 32 }}>
              {tf.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>

      {/* Chart */}
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={trendsData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
            <defs>
              {nodeNames.map((name, i) => {
                const color = NODE_COLORS[i % NODE_COLORS.length]
                return (
                  <linearGradient key={name} id={`grad-${i}`} x1="0" y1="0" x2="0" y2="1">
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
                  fill={`url(#grad-${i})`}
                  dot={false}
                  activeDot={{ r: 3, strokeWidth: 0 }}
                />
              )
            })}
          </AreaChart>
        </ResponsiveContainer>
      </Box>

      {/* Legend — compact node list */}
      {nodeNames.length > 1 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 0.5, justifyContent: 'center' }}>
          {nodeNames.map((name, i) => (
            <Box key={name} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: NODE_COLORS[i % NODE_COLORS.length] }} />
              <Typography variant="caption" sx={{ fontSize: 9, color: 'text.secondary' }}>{name}</Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}

export default React.memo(InfraGlobalChartWidget)
