'use client'

import React from 'react'
import { Box, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts'

import ChartContainer from '@/components/ChartContainer'
import { formatPressure } from '@/lib/metrics/diskIo'

import ExpandableChart from './ExpandableChart'
import type { RrdTimeframe, SeriesPoint } from '../types'
import { formatRrdTick, formatRrdTooltipTs } from '../helpers'

const SOME_COLOR = '#f59e0b'
const FULL_COLOR = '#d97706'

export type IoPressureLabels = { title: string; heading: string; some: string; full: string }

// Only the three fields the rows need: recharts hands its content renderer
// many more, and a dataKey that may be a function.
type TooltipProps = {
  active?: boolean
  payload?: ReadonlyArray<{ dataKey?: unknown; value?: unknown; color?: string }>
  label?: unknown
  tf: RrdTimeframe
  labels: IoPressureLabels
}

/** The tooltip of the IO pressure chart: one row per share, "some" then "full". */
export function IoPressureTooltip({ active, payload, label, tf, labels }: TooltipProps) {
  if (!active || !payload?.length) return null

  return (
    <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11, minWidth: 160 }}>
      <Box sx={{ px: 1.5, py: 0.75, bgcolor: alpha(SOME_COLOR, 0.1), borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <i className="ri-pulse-line" style={{ fontSize: 13, color: SOME_COLOR }} />
        <Typography variant="caption" sx={{ fontWeight: 700, color: SOME_COLOR }}>{labels.heading}</Typography>
        <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6 }}>{formatRrdTooltipTs(Number(label), tf)}</Typography>
      </Box>
      <Box sx={{ px: 1.5, py: 0.75 }}>
        {payload.filter(entry => entry.value != null).map(entry => (
          <Box key={String(entry.dataKey)} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
            <Typography variant="caption" sx={{ flex: 1 }}>{String(entry.dataKey) === 'psiIoSome' ? labels.some : labels.full}</Typography>
            <Typography variant="caption" sx={{ fontWeight: 600 }}>{formatPressure(Number(entry.value))}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

type Props = {
  series: SeriesPoint[]
  tf: RrdTimeframe
  labels: IoPressureLabels
  /** Drag-to-zoom wiring of the Performance card, spread onto the chart. */
  dragProps?: Record<string, unknown>
  dragSelection?: React.ReactNode
}

/**
 * IO pressure stall of a guest on PVE 9 (#1011): the share of the last ten
 * seconds its tasks waited on disk I/O, "some" as an area and "full" dashed,
 * as the PVE summary draws it. The caller only mounts it when the RRD carries
 * the field (hasIoPressureSeries).
 */
export default function IoPressureChart({ series, tf, labels, dragProps, dragSelection }: Props) {
  return (
    <ExpandableChart title={labels.title} height={185}>
      <ChartContainer>
        <AreaChart data={series} margin={{ top: 2, right: 4, bottom: 0, left: 4 }} {...dragProps}>
          <defs>
            <linearGradient id="gradIoPressure" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SOME_COLOR} stopOpacity={0.35} />
              <stop offset="100%" stopColor={SOME_COLOR} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="t" tickFormatter={v => formatRrdTick(Number(v), tf)} minTickGap={40} tick={{ fontSize: 9 }} />
          <YAxis domain={[0, 'auto']} tickFormatter={v => `${v}%`} tick={{ fontSize: 9 }} width={40} />
          <Tooltip wrapperStyle={{ backgroundColor: 'transparent', boxShadow: 'none' }} content={({ active, payload, label }) => <IoPressureTooltip active={active} payload={payload} label={label} tf={tf} labels={labels} />} />
          <Area type="monotone" dataKey="psiIoSome" stroke={SOME_COLOR} fill="url(#gradIoPressure)" strokeWidth={1.5} isAnimationActive={false} connectNulls />
          <Area type="monotone" dataKey="psiIoFull" stroke={FULL_COLOR} fill="none" strokeWidth={1} strokeDasharray="4 2" isAnimationActive={false} connectNulls />
          {dragSelection}
        </AreaChart>
      </ChartContainer>
    </ExpandableChart>
  )
}
