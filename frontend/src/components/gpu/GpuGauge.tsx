'use client'

import { Box } from '@mui/material'

import { GRADIENT_GLASS, gradientSx } from '@/app/(dashboard)/infrastructure/inventory/components/UsageBar'

/**
 * A GPU gauge drawn like every usage gauge of the product (inventory, resources
 * cockpit): a green to red gradient laid over the whole axis, so the colour
 * says how far the fill went, under a light glass sheen. The figure beside it
 * is the caller's; `gaugeTone` colours it once a threshold is near.
 */
export default function GpuGauge({
  pct,
  label,
  height = 8,
  testId
}: {
  /** 0 to 100; null draws the empty track (not measured). */
  pct: number | null
  /** Read out by assistive tech: the gauge carries no text of its own. */
  label?: string
  height?: number
  testId?: string
}) {
  const fill = pct === null ? 0 : Math.max(0, Math.min(100, pct))
  return (
    <Box
      role='meter'
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct === null ? undefined : Math.round(fill)}
      data-testid={testId}
      sx={{
        position: 'relative',
        height,
        borderRadius: 0.5,
        overflow: 'hidden',
        bgcolor: theme => (theme.palette.mode === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.12)')
      }}
    >
      {pct !== null && fill > 0 && (
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            width: `${Math.max(2, fill)}%`,
            ...gradientSx(Math.max(2, fill)),
            transition: 'width 300ms ease',
            '&::after': { content: '""', position: 'absolute', inset: 0, background: GRADIENT_GLASS, pointerEvents: 'none' }
          }}
        />
      )}
    </Box>
  )
}

/** The colour of the figure beside a gauge: plain, then warning 20 points before the threshold, error past it. */
export function gaugeTone(pct: number | null, threshold: number): 'text.primary' | 'warning.main' | 'error.main' {
  if (pct === null) return 'text.primary'
  if (pct >= threshold) return 'error.main'
  return pct >= threshold - 20 ? 'warning.main' : 'text.primary'
}
