import React from 'react'

import { Box, Tooltip, Typography } from '@mui/material'

import { formatBytes } from '@/utils/format'

import { getMetricIcon } from '../helpers'

const GRADIENT_BAR = 'linear-gradient(90deg, #22c55e 0%, #eab308 50%, #ef4444 100%)'
const GRADIENT_GLASS = 'linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.05) 45%, transparent 50%)'

function gradientSx(pct: number) {
  return {
    background: GRADIENT_BAR,
    backgroundSize: pct > 0 ? `${(100 / pct) * 100}% 100%` : '100% 100%',
  }
}

/** A second, non-usage figure drawn on the same axis as the fill — #969 uses it
 *  for the resources provisioned to guests, which may exceed capacity. */
export type UsageBarMarker = {
  /** Position on the bar, as a percentage of capacity. May exceed 100. */
  pct: number
  /** Read out to assistive tech, since a dashed rule carries no text. */
  label?: string
  /** Shown on hover. The detail lives here so the card gains no extra line. */
  tooltip?: React.ReactNode
}

/** How far the arrow stands above the track, in px. The marker box starts there
 *  so the arrow's tip lands exactly on the top edge of the bar. */
const ARROW_HEIGHT = 6

/** Track + fill, shared by both modes so the marker only has to exist once. */
function BarTrack({ pct, marker }: { pct: number; marker?: UsageBarMarker }) {
  const markerPct = marker ? Math.max(0, Math.min(100, marker.pct)) : 0
  const overflows = !!marker && marker.pct > 100

  // The marker lives beside the track, not inside it: the track clips its own
  // children so the arrow could never rise above the bar from in there.
  const rule = marker ? (
    <Box
      data-testid="usage-bar-marker"
      aria-label={marker.label}
      // `left` stays inline: it is data, not styling. The 1px pull keeps the
      // rule on the bar when it sits at 100%.
      style={{ left: `${markerPct}%` }}
      sx={{
        position: 'absolute',
        top: -ARROW_HEIGHT,
        bottom: 0,
        // Wider than the rule it draws: a 2px dashed line is not a hover target.
        width: 14,
        ml: '-7px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        transform: 'translateX(-1px)',
        transition: 'left 300ms ease',
        cursor: marker.tooltip ? 'help' : 'default',
      }}
    >
      <Box
        data-testid="usage-bar-marker-arrow"
        aria-hidden
        sx={{
          flex: '0 0 auto',
          width: 0,
          height: 0,
          borderLeft: '5px solid transparent',
          borderRight: '5px solid transparent',
          borderTop: `${ARROW_HEIGHT}px solid`,
          borderTopColor: 'text.primary',
          opacity: 0.85,
        }}
      />
      <Box sx={{ flex: 1, width: 0, borderLeft: '2px dashed', borderColor: 'text.primary', opacity: 0.75 }} />
    </Box>
  ) : null

  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.25 }}>
      <Box sx={{ position: 'relative', flex: 1, minWidth: 0 }}>
        <Box
          data-testid="usage-bar-track"
          sx={{
            position: 'relative',
            height: 14,
            borderRadius: 0,
            bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.12)',
            overflow: 'hidden',
          }}
        >
          <Box
            sx={{
              height: '100%',
              width: `${pct}%`,
              ...gradientSx(pct),
              borderRadius: 0,
              transition: 'all 300ms ease',
              position: 'relative',
              '&::after': {
                content: '""',
                position: 'absolute',
                inset: 0,
                borderRadius: 0,
                background: GRADIENT_GLASS,
                pointerEvents: 'none',
              },
            }}
          />
        </Box>
        {rule && marker?.tooltip ? (
          <Tooltip title={marker.tooltip} arrow placement="top">
            {rule}
          </Tooltip>
        ) : rule}
      </Box>
      {overflows ? (
        <Box
          data-testid="usage-bar-overflow"
          aria-hidden
          component="i"
          className="ri-arrow-right-s-fill"
          sx={{ fontSize: 14, lineHeight: 1, color: 'text.primary', opacity: 0.75, flex: '0 0 auto' }}
        />
      ) : null}
    </Box>
  )
}

function UsageBar({
  label,
  used,
  capacity,
  mode,
  icon,
  themeColor,
  extra,
  marker,
}: {
  label: string
  used: number
  capacity: number
  mode: 'bytes' | 'pct'
  icon?: string
  themeColor: string
  extra?: React.ReactNode
  marker?: UsageBarMarker
}) {
  const iconClass = icon || getMetricIcon(label)

  if (mode === 'pct') {
    const u = Math.max(0, Math.min(100, Number(used || 0)))
    const free = Math.max(0, 100 - u)

    return (
      <Box sx={{ mb: 2.5 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
            <i className={iconClass} style={{ fontSize: 14, color: themeColor }} />
            <Typography variant="body2" sx={{ fontWeight: 700, color: 'text.primary' }}>
              {label}
            </Typography>
            {extra}
          </Box>
          <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.secondary' }}>
            Free: {Math.round(free)}%
          </Typography>
        </Box>

        <BarTrack pct={u} marker={marker} />

        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, mt: 0.5 }}>
          <Typography variant="caption" sx={{ color: 'text.primary', fontWeight: 500 }}>
            Used: {Math.round(u)}%
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Capacity: 100%
          </Typography>
        </Box>
      </Box>
    )
  }

  const cap = Math.max(0, Number(capacity || 0))
  const u = Math.max(0, Math.min(Number(used || 0), cap || Number(used || 0)))
  const free = Math.max(0, cap - u)
  const pctVal = cap > 0 ? Math.round((u / cap) * 100) : 0

  return (
    <Box sx={{ mb: 2.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
          <i className={iconClass} style={{ fontSize: 14, color: themeColor }} />
          <Typography variant="body2" sx={{ fontWeight: 700, color: 'text.primary' }}>
            {label}
          </Typography>
          {extra}
        </Box>
        <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.secondary' }}>
          Free: {formatBytes(free)}
        </Typography>
      </Box>

      <BarTrack pct={pctVal} marker={marker} />

      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, mt: 0.5 }}>
        <Typography variant="caption" sx={{ color: 'text.primary', fontWeight: 500 }}>
          Used: {formatBytes(u)}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Capacity: {formatBytes(cap)}
        </Typography>
      </Box>
    </Box>
  )
}

export default UsageBar
