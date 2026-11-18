'use client'

import { Box, useTheme } from '@mui/material'

/** The drawing box: one 10-unit step per bucket, stretched to the width of the parent. */
const STEP = 10

type Props = {
  /** The count per bucket, oldest first; null draws a flat track (still reading). */
  series: number[] | null
  /** Buckets of the flat track. */
  size?: number
  /** The line colour, a theme path (warning.main) or a CSS colour. */
  colour: string
  /** A second series (outbound), drawn as its own line; absent or null: one line. */
  second?: number[] | null
  secondColour?: string
  height: number
  ariaLabel: string
}

/** The points of a line through the buckets, scaled on `peak`, inside a box `height` high (1 unit kept free at the top and bottom). */
export function linePoints(values: number[], peak: number, height: number): string {
  const room = height - 2
  return values.map((n, i) => `${i * STEP + STEP / 2},${(1 + room - (peak > 0 ? (n / peak) * room : 0)).toFixed(2)}`).join(' ')
}

/**
 * The series as a line over the buckets, a faint area under it, both scaled on the highest bucket of the two series; a
 * flat line in the divider colour while nothing was counted. Plain SVG attributes, the colours through `style` so a
 * CSS-variable palette (dark theme) resolves.
 */
export default function SparkLine({ series, size = 24, colour, second = null, secondColour, height, ariaLabel }: Readonly<Props>) {
  const theme = useTheme()
  const values = series ?? new Array<number>(size).fill(0)
  const others = second ? values.map((_, i) => second[i] ?? 0) : null
  const peak = Math.max(0, ...values, ...(others ?? []))
  const width = values.length * STEP
  const points = linePoints(values, peak, height)
  const stroke = peak > 0 ? 'currentColor' : theme.palette.divider
  return (
    <Box
      component='svg'
      role='img'
      aria-label={ariaLabel}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio='none'
      data-sparkline
      sx={{ display: 'block', width: '100%', height, color: colour }}
    >
      {peak > 0 && <polygon points={`${STEP / 2},${height} ${points} ${width - STEP / 2},${height}`} style={{ fill: 'currentColor', opacity: 0.15 }} />}
      <polyline points={points} fill='none' vectorEffect='non-scaling-stroke' strokeWidth={1.5} strokeLinejoin='round' style={{ stroke }} />
      {others && <polyline data-second points={linePoints(others, peak, height)} fill='none' vectorEffect='non-scaling-stroke' strokeWidth={1.5} strokeLinejoin='round' style={{ stroke: secondColour }} />}
    </Box>
  )
}
