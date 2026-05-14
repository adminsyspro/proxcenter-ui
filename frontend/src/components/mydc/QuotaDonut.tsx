'use client'

import { Box, CircularProgress, Stack, Typography } from '@mui/material'

export interface QuotaDonutProps {

  /** Label displayed under the donut (e.g., "vCPUs"). Omit for compact in-cell usage. */
  label?: string

  /** Current usage (same unit as `max`). */
  used: number

  /** Quota ceiling. `null`/`undefined` = unlimited (no fill, no %). */
  max: number | null | undefined

  /** Optional unit suffix shown in the caption when `formatValue` is not provided (e.g., "GB"). */
  unit?: string

  /** Remix icon class (e.g., "ri-cpu-line") shown inside the ring. */
  icon: string

  /** Label shown when `max` is unlimited (fallback `used` value inside). */
  unlimitedLabel: string

  /**
   * Pending request to visualise on top of the current usage (shifts the fill
   * to the projected total). Used by the VM create dialog to preview impact.
   * `0` or omitted = show current usage only.
   */
  requested?: number

  /** Outer size in px (default 104). */
  size?: number

  /**
   * Optional formatter for the numeric labels (used, requested, max). Lets
   * the caller feed raw MB and render "1.8 GB" so the percentage stays
   * accurate even for fractional values. Defaults to `${v} ${unit}`.
   */
  formatValue?: (v: number) => string
}

/**
 * Quota visualisation as a donut: current usage vs. quota, with optional
 * pending-request overlay. Colors: primary < 70 %, warning 70-89 %, error
 * ≥ 90 % or projected over max.
 */
export default function QuotaDonut({
  label,
  used,
  max,
  unit,
  icon,
  unlimitedLabel,
  requested = 0,
  size = 104,
  formatValue,
}: QuotaDonutProps) {
  const hasQuota = max != null && max > 0
  const projected = used + (requested > 0 ? requested : 0)
  const pct = hasQuota ? Math.round((projected / (max as number)) * 100) : 0
  const over = hasQuota && projected > (max as number)
  const clampedPct = Math.min(100, pct)


  // Red only when strictly over quota; orange from 70 % up (incl. at-limit),
  // blue below — so the user tells "blocked" from "near max" at a glance.
  const color: 'primary' | 'warning' | 'error' =
    over ? 'error' : pct >= 70 ? 'warning' : 'primary'

  const thickness = 4

  // Compact mode: no icon (cell already labelled by column header), tighter fonts.
  const compact = size < 80

  // Scale inner fonts with the donut size so long values like
  // "12.3 GB / 32.0 GB" don't overflow the ring at intermediate sizes (e.g. 88).
  const valueFontRem = Math.min(0.875, Math.max(0.7, size / 110))
  const captionFontRem = Math.min(0.65, Math.max(0.5, size / 150))

  // Cap inner-text width so anything still longer than expected gets ellipsised
  // instead of bleeding outside the circle.
  const innerMaxWidth = Math.round(size * 0.82)

  const fmt = formatValue ?? ((v: number) => `${v}${unit ? ` ${unit}` : ''}`)

  const donut = (
    <Box sx={{ position: 'relative', display: 'inline-flex' }}>
      <CircularProgress
        variant="determinate"
        value={100}
        size={size}
        thickness={thickness}
        sx={{ color: (theme) => theme.palette.action.hover }}
      />
      <CircularProgress
        variant="determinate"
        value={hasQuota ? clampedPct : 0}
        size={size}
        thickness={thickness}
        color={color}
        sx={{ position: 'absolute', left: 0 }}
      />
      <Box
        sx={{
          top: 0, left: 0, bottom: 0, right: 0, position: 'absolute',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column',
          gap: 0.25,
        }}
      >
        {!compact && (
          <Box
            component="i"
            className={icon}
            sx={{
              fontSize: Math.max(14, Math.round(size * 0.2)),
              lineHeight: 1,
              color: (theme) =>
                color === 'primary' ? theme.palette.primary.main
                : color === 'warning' ? theme.palette.warning.main
                : theme.palette.error.main,
            }}
          />
        )}
        {hasQuota ? (
          <>
            <Typography
              variant="subtitle2"
              sx={{
                fontWeight: 600,
                lineHeight: 1,
                fontSize: compact ? '0.75rem' : `${valueFontRem}rem`,
              }}
            >
              {pct}%
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                fontSize: compact ? '0.6rem' : `${captionFontRem}rem`,
                lineHeight: 1,
                maxWidth: innerMaxWidth,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                textAlign: 'center',
                display: 'block',
              }}
            >
              {requested > 0 ? `${fmt(projected)} / ${fmt(max as number)}` : `${fmt(used)} / ${fmt(max as number)}`}
            </Typography>
          </>
        ) : (
          <>
            <Typography
              variant="subtitle2"
              sx={{
                fontWeight: 600,
                lineHeight: 1,
                fontSize: compact ? '0.75rem' : `${valueFontRem}rem`,
                maxWidth: innerMaxWidth,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                textAlign: 'center',
                display: 'block',
              }}
            >
              {fmt(used)}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                fontSize: compact ? '0.6rem' : `${captionFontRem}rem`,
                lineHeight: 1,
                maxWidth: innerMaxWidth,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                textAlign: 'center',
                display: 'block',
              }}
            >
              {unlimitedLabel}
            </Typography>
          </>
        )}
      </Box>
    </Box>
  )

  if (!label) return donut

  return (
    <Stack alignItems="center" spacing={1} sx={{ minWidth: 140 }}>
      {donut}
      <Typography variant="body2" sx={{ fontWeight: 500 }}>{label}</Typography>
    </Stack>
  )
}
