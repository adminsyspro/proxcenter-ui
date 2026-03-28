'use client'

import React from 'react'

import { Box, Card, CardContent, Typography, useTheme } from '@mui/material'
import { lighten, alpha } from '@mui/material/styles'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts'

import type { SeriesPoint } from '../types'
import { formatTime, formatBps } from '../helpers'

function AreaPctChart({
  title,
  data,
  dataKey,
  color,
  height = 240,
}: {
  title: string
  data: SeriesPoint[]
  dataKey: 'cpuPct' | 'ramPct'
  color?: string
  height?: number
}) {
  const theme = useTheme()
  const chartColor = color || theme.palette.primary.main
  const icon = dataKey === 'cpuPct' ? 'ri-cpu-line' : 'ri-ram-line'
  const iconColor = dataKey === 'cpuPct' ? '#2196f3' : '#10b981'

  return (
    <Card variant="outlined" sx={{ width: '100%', borderRadius: 2 }}>
      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Typography fontWeight={700} fontSize={13} sx={{ mb: 0.5 }}>
          {title}
        </Typography>

        <Box sx={{ width: '100%', height }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <XAxis dataKey="t" tickFormatter={v => formatTime(Number(v))} minTickGap={24} tick={{ fontSize: 10 }} />
              <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 10 }} width={35} />
              <Tooltip
                wrapperStyle={{ backgroundColor: 'transparent', boxShadow: 'none' }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  return (
                    <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11, minWidth: 160 }}>
                      <Box sx={{ px: 1.5, py: 0.75, bgcolor: alpha(iconColor, 0.1), borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <i className={icon} style={{ fontSize: 13, color: iconColor }} />
                        <Typography variant="caption" sx={{ fontWeight: 700, color: iconColor }}>{title}</Typography>
                        <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6 }}>{new Date(Number(label)).toLocaleTimeString()}</Typography>
                      </Box>
                      <Box sx={{ px: 1.5, py: 0.75 }}>
                        {payload.map(entry => {
                          const v = Number(entry.value)
                          const valColor = v >= 80 ? '#f44336' : v >= 60 ? '#ff9800' : '#4caf50'
                          return (
                            <Box key={String(entry.dataKey)} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
                              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                              <Typography variant="caption" sx={{ flex: 1 }}>{title}</Typography>
                              <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace', color: valColor }}>{v.toFixed(1)}%</Typography>
                            </Box>
                          )
                        })}
                      </Box>
                    </Box>
                  )
                }}
              />
              <Area
                type="monotone"
                dataKey={dataKey}
                dot={false}
                stroke={chartColor}
                fill={chartColor}
                fillOpacity={0.18}
                strokeWidth={2}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </Box>
      </CardContent>
    </Card>
  )
}

function AreaBpsChart2({
  title,
  data,
  keyA,
  keyB,
  labelA,
  labelB,
  colorA,
  colorB,
  height = 260,
}: {
  title: string
  data: SeriesPoint[]
  keyA: keyof SeriesPoint
  keyB: keyof SeriesPoint
  labelA: string
  labelB: string
  colorA?: string
  colorB?: string
  height?: number
}) {
  const theme = useTheme()
  const chartColorA = colorA || theme.palette.primary.main
  const chartColorB = colorB || lighten(theme.palette.primary.main, 0.3)
  const iconColor = '#06b6d4'

  return (
    <Card variant="outlined" sx={{ width: '100%', borderRadius: 2 }}>
      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Typography fontWeight={700} fontSize={13} sx={{ mb: 0.5 }}>
          {title}
        </Typography>

        <Box sx={{ width: '100%', height }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <XAxis dataKey="t" tickFormatter={v => formatTime(Number(v))} minTickGap={24} tick={{ fontSize: 10 }} />
              <YAxis tickFormatter={v => formatBps(Number(v))} tick={{ fontSize: 10 }} width={50} />
              <Tooltip
                wrapperStyle={{ backgroundColor: 'transparent', boxShadow: 'none' }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  return (
                    <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11, minWidth: 180 }}>
                      <Box sx={{ px: 1.5, py: 0.75, bgcolor: alpha(iconColor, 0.1), borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <i className="ri-exchange-line" style={{ fontSize: 13, color: iconColor }} />
                        <Typography variant="caption" sx={{ fontWeight: 700, color: iconColor }}>{title}</Typography>
                        <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6 }}>{new Date(Number(label)).toLocaleTimeString()}</Typography>
                      </Box>
                      <Box sx={{ px: 1.5, py: 0.75 }}>
                        {payload.map(entry => (
                          <Box key={String(entry.dataKey)} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
                            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                            <Typography variant="caption" sx={{ flex: 1 }}>{entry.name}</Typography>
                            <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>{formatBps(Number(entry.value))}</Typography>
                          </Box>
                        ))}
                      </Box>
                    </Box>
                  )
                }}
              />
              <Area
                type="monotone"
                dataKey={keyA as any}
                name={labelA}
                dot={false}
                stroke={chartColorA}
                fill={chartColorA}
                fillOpacity={0.14}
                strokeWidth={2}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey={keyB as any}
                name={labelB}
                dot={false}
                stroke={chartColorB}
                fill={chartColorB}
                fillOpacity={0.14}
                strokeWidth={2}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </Box>
      </CardContent>
    </Card>
  )
}


export { AreaPctChart, AreaBpsChart2 }
