'use client'

import React from 'react'

import { Box, Card, CardContent, Typography, useTheme } from '@mui/material'
import { lighten } from '@mui/material/styles'
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
  const tooltipStyle = { backgroundColor: theme.palette.background.paper, borderColor: theme.palette.divider, color: theme.palette.text.primary }

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
                contentStyle={tooltipStyle}
                labelFormatter={v => new Date(Number(v)).toLocaleString()}
                formatter={(v: any) => {
                  const n = Number(v)


return [Number.isFinite(n) ? `${n}%` : '—', '']
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
  const tooltipStyle = { backgroundColor: theme.palette.background.paper, borderColor: theme.palette.divider, color: theme.palette.text.primary }

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
                contentStyle={tooltipStyle}
                labelFormatter={v => new Date(Number(v)).toLocaleString()}
                formatter={(v: any, name: any) => {
                  const n = Number(v)


return [Number.isFinite(n) ? formatBps(n) : '—', name]
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
