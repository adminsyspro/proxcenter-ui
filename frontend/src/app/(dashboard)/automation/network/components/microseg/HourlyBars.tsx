'use client'

import { Box, Tooltip, useTheme } from '@mui/material'

/** The drawing box: one 10-unit slot per bucket (8 of bar, 2 of gap), stretched to the width of the parent. */
const SLOT = 10
const BAR = 8

type Props = {
  /** The count per bucket, oldest first; null draws an empty track (still reading). */
  series: number[] | null
  /** Buckets of the empty track. */
  size?: number
  /** The bar colour, a theme path (warning.main) or a CSS colour. */
  colour: string
  height: number
  ariaLabel: string
  /** A second series (outbound), drawn beside the first in each slot; absent or null: one series. */
  second?: number[] | null
  /** The colour of the second series, a CSS colour. */
  secondColour?: string
  /** The tooltip of a bar (its time span and count, and the second series' count when there is one); none while the series is read. */
  barLabel: (index: number, count: number, secondCount: number) => string
}

/**
 * Bars scaled on the highest bucket, one per bucket, a bucket at 0 as a 1-unit tick in the divider colour so the track
 * stays visible; each bar shows its label on hover (the hit target is the whole slot, taller than the bar). Plain SVG
 * attributes (an MUI Box would turn width and height into CSS); the colours go through `style` so a CSS-variable
 * palette (dark theme) resolves.
 */
export default function HourlyBars({ series, size = 24, colour, second = null, secondColour, height, ariaLabel, barLabel }: Readonly<Props>) {
  const theme = useTheme()
  const values = series ?? new Array<number>(size).fill(0)
  const others = second ? values.map((_, i) => second[i] ?? 0) : null
  const peak = Math.max(0, ...values, ...(others ?? []))
  const heightOf = (n: number) => (peak > 0 && n > 0 ? Math.max(2, (n / peak) * height) : 1)

  return (
    <Box
      component='svg'
      role='img'
      aria-label={ariaLabel}
      viewBox={`0 0 ${values.length * SLOT} ${height}`}
      preserveAspectRatio='none'
      sx={{ display: 'block', width: '100%', height, color: colour }}
    >
      {values.map((n, i) => {
        const n2 = others?.[i] ?? 0
        const h = heightOf(n)
        const half = BAR / 2
        const x = i * SLOT + (SLOT - BAR) / 2
        return (
          <Tooltip key={i} title={series ? barLabel(i, n, n2) : ''} disableInteractive>
            <g data-bucket={i} data-hits={n}>
              <rect x={i * SLOT} y={0} width={SLOT} height={height} fill='transparent' />
              {others ? (
                <>
                  <rect x={x} y={height - h} width={half} height={h} style={{ fill: n > 0 ? 'currentColor' : theme.palette.divider }} />
                  <rect x={x + half} y={height - heightOf(n2)} width={half} height={heightOf(n2)} style={{ fill: n2 > 0 ? secondColour : theme.palette.divider }} />
                </>
              ) : (
                <rect x={x} y={height - h} width={BAR} height={h} style={{ fill: n > 0 ? 'currentColor' : theme.palette.divider }} />
              )}
            </g>
          </Tooltip>
        )
      })}
    </Box>
  )
}
