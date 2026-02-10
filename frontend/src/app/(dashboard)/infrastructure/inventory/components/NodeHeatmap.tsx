'use client'

import React, { useEffect, useState } from 'react'

import {
  Box,
  CircularProgress,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'

import { fetchRrd, buildSeriesFromRrd } from '../helpers'
import type { SeriesPoint } from '../types'

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface Props {
  connId: string
  nodeName: string
  primaryColor: string
}

type Metric = 'cpu' | 'ram'

interface DayCell {
  date: string          // YYYY-MM-DD
  label: string         // e.g. "Mon 3 Feb"
  value: number | null  // average % or null (no data)
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function colorForValue(value: number | null, color: string, fallback: string): string {
  if (value == null) return fallback
  if (value <= 20) return alpha(color, 0.15)
  if (value <= 40) return alpha(color, 0.35)
  if (value <= 60) return alpha(color, 0.55)
  if (value <= 80) return alpha(color, 0.75)
  return alpha(color, 0.95)
}

/** Build a 7×5 grid (rows=days Mon→Sun, cols=weeks) from series data. */
function buildGrid(series: SeriesPoint[], metric: Metric): DayCell[][] {
  // Group data points by calendar day
  const byDay = new Map<string, number[]>()

  for (const pt of series) {
    const val = metric === 'cpu' ? pt.cpuPct : pt.ramPct
    if (val == null) continue
    const d = new Date(pt.t)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const arr = byDay.get(key)
    if (arr) arr.push(val)
    else byDay.set(key, [val])
  }

  // Find the Monday ~5 weeks ago
  const now = new Date()
  const todayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const dayOfWeek = now.getDay() // 0=Sun
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  // Go back 4 more weeks from this Monday = 5 weeks total
  const startMs = todayMs - (mondayOffset + 28) * 86_400_000

  const WEEKS = 5
  const DAYS = 7
  const grid: DayCell[][] = Array.from({ length: DAYS }, () => [])

  for (let w = 0; w < WEEKS; w++) {
    for (let d = 0; d < DAYS; d++) {
      const cellMs = startMs + (w * 7 + d) * 86_400_000
      const cellDate = new Date(cellMs)
      const key = `${cellDate.getFullYear()}-${String(cellDate.getMonth() + 1).padStart(2, '0')}-${String(cellDate.getDate()).padStart(2, '0')}`

      const vals = byDay.get(key)
      const avg = vals && vals.length > 0
        ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length)
        : null

      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      const label = `${dayNames[cellDate.getDay()]} ${cellDate.getDate()} ${monthNames[cellDate.getMonth()]}`

      grid[d].push({ date: key, label, value: avg })
    }
  }

  return grid
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function NodeHeatmap({ connId, nodeName, primaryColor }: Props) {
  const [metric, setMetric] = useState<Metric>('cpu')
  const [series, setSeries] = useState<SeriesPoint[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true

    async function load() {
      setLoading(true)
      try {
        const raw = await fetchRrd(connId, `/nodes/${nodeName}`, 'month')
        const built = buildSeriesFromRrd(raw)
        if (alive) setSeries(built)
      } catch {
        // silent — heatmap is non-critical
      } finally {
        if (alive) setLoading(false)
      }
    }

    load()
    return () => { alive = false }
  }, [connId, nodeName])

  const grid = buildGrid(series, metric)
  const dayLabels = ['M', '', 'W', '', 'F', '', '']

  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 120 }}>
        <CircularProgress size={24} />
      </Box>
    )
  }

  return (
    <Box>
      {/* Toggle CPU / RAM */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="caption" sx={{ fontWeight: 700, opacity: 0.7 }}>
          30-day load
        </Typography>
        <ToggleButtonGroup
          value={metric}
          exclusive
          onChange={(_, v) => { if (v) setMetric(v) }}
          size="small"
          sx={{
            height: 22,
            '& .MuiToggleButton-root': {
              px: 1,
              py: 0,
              fontSize: '0.65rem',
              fontWeight: 700,
              textTransform: 'none',
              lineHeight: 1,
            },
          }}
        >
          <ToggleButton value="cpu">CPU</ToggleButton>
          <ToggleButton value="ram">RAM</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* Grid */}
      <Box sx={{ display: 'flex', gap: '3px' }}>
        {/* Day labels column */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '3px', pt: '1px' }}>
          {dayLabels.map((lbl, i) => (
            <Box
              key={i}
              sx={{
                width: 14,
                height: 14,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
              }}
            >
              <Typography variant="caption" sx={{ fontSize: 9, opacity: 0.5, lineHeight: 1 }}>
                {lbl}
              </Typography>
            </Box>
          ))}
        </Box>

        {/* Week columns */}
        {Array.from({ length: grid[0]?.length ?? 0 }, (_, weekIdx) => (
          <Box key={weekIdx} sx={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {grid.map((row, dayIdx) => {
              const cell = row[weekIdx]
              if (!cell) return null
              const metricLabel = metric === 'cpu' ? 'CPU' : 'RAM'
              const tip = cell.value != null
                ? `${cell.label} — ${metricLabel}: ${cell.value}%`
                : `${cell.label} — no data`

              return (
                <Tooltip key={dayIdx} title={tip} arrow placement="top">
                  <Box
                    sx={{
                      width: 14,
                      height: 14,
                      borderRadius: '3px',
                      bgcolor: (theme) => colorForValue(cell.value, primaryColor, theme.palette.action.hover),
                      cursor: 'default',
                      transition: 'transform 0.1s',
                      '&:hover': { transform: 'scale(1.3)', zIndex: 1 },
                    }}
                  />
                </Tooltip>
              )
            })}
          </Box>
        ))}
      </Box>
    </Box>
  )
}
