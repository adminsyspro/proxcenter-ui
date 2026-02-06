'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Box,
  CircularProgress,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useTheme,
} from '@mui/material'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts'

const TIMEFRAMES = [
  { value: 'hour', label: '1h' },
  { value: 'day', label: '24h' },
  { value: 'week', label: '7d' },
]

export default function ResourceTrendsWidget({ data, loading: dashboardLoading }) {
  const t = useTranslations()
  const theme = useTheme()
  const [timeframe, setTimeframe] = useState('hour')
  const [trendsData, setTrendsData] = useState(null)
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

  // Fetch trends data when timeframe or nodes change
  useEffect(() => {
    const fetchTrends = async () => {
      const connIds = Object.keys(nodesByConnection)
      if (connIds.length === 0) return

      setLoading(true)
      try {
        // Fetch trends for all connections in parallel
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

        // Merge all results and calculate averages per timestamp
        const timeMap = new Map()

        results.forEach((connData) => {
          Object.values(connData).forEach((nodePoints) => {
            if (!Array.isArray(nodePoints)) return
            nodePoints.forEach((point) => {
              const key = point.t
              if (!timeMap.has(key)) {
                timeMap.set(key, { t: key, cpuSum: 0, ramSum: 0, count: 0 })
              }
              const entry = timeMap.get(key)
              entry.cpuSum += point.cpu || 0
              entry.ramSum += point.ram || 0
              entry.count += 1
            })
          })
        })

        // Convert to array with averages
        const aggregated = Array.from(timeMap.values())
          .map((entry) => ({
            t: entry.t,
            cpu: entry.count > 0 ? Math.round((entry.cpuSum / entry.count) * 10) / 10 : 0,
            ram: entry.count > 0 ? Math.round((entry.ramSum / entry.count) * 10) / 10 : 0,
          }))
          .sort((a, b) => {
            // Sort by time (HH:MM format)
            return a.t.localeCompare(b.t)
          })

        setTrendsData(aggregated)
      } catch (e) {
        console.error('Failed to fetch trends:', e)
        setTrendsData([])
      } finally {
        setLoading(false)
      }
    }

    fetchTrends()
  }, [nodesByConnection, timeframe])

  const cpuColor = theme.palette.primary.main
  const ramColor = theme.palette.secondary.main

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload || payload.length === 0) return null

    return (
      <Box
        sx={{
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          p: 1,
          boxShadow: 2,
        }}
      >
        <Typography variant="caption" sx={{ fontWeight: 600 }}>
          {label}
        </Typography>
        {payload.map((entry) => (
          <Typography
            key={entry.dataKey}
            variant="caption"
            sx={{ display: 'block', color: entry.color }}
          >
            {entry.dataKey === 'cpu' ? 'CPU' : 'RAM'}: {entry.value}%
          </Typography>
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

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Timeframe selector */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
        <ToggleButtonGroup
          value={timeframe}
          exclusive
          onChange={(e, val) => val && setTimeframe(val)}
          size="small"
        >
          {TIMEFRAMES.map((tf) => (
            <ToggleButton
              key={tf.value}
              value={tf.value}
              sx={{
                px: 1,
                py: 0.25,
                fontSize: '0.65rem',
                minWidth: 32,
              }}
            >
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
              <linearGradient id="cpuGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={cpuColor} stopOpacity={0.3} />
                <stop offset="95%" stopColor={cpuColor} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="ramGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={ramColor} stopOpacity={0.3} />
                <stop offset="95%" stopColor={ramColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
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
            <Legend
              iconSize={8}
              wrapperStyle={{ fontSize: 10, paddingTop: 4 }}
            />
            <Area
              type="monotone"
              dataKey="cpu"
              name="CPU"
              stroke={cpuColor}
              strokeWidth={2}
              fill="url(#cpuGradient)"
            />
            <Area
              type="monotone"
              dataKey="ram"
              name="RAM"
              stroke={ramColor}
              strokeWidth={2}
              fill="url(#ramGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </Box>
    </Box>
  )
}
