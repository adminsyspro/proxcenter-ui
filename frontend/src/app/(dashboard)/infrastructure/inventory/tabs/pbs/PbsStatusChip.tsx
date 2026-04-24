'use client'

import React from 'react'
import { Chip, alpha, useTheme, type ChipProps } from '@mui/material'

/**
 * Status chip with homogeneous light/dark rendering.
 * Uses theme color with 16% opacity background + full-intensity text color,
 * pill-shaped radius, consistent height.
 */
export type PbsStatusChipColor = 'success' | 'error' | 'warning' | 'info' | 'primary' | 'secondary' | 'default'

interface PbsStatusChipProps extends Omit<ChipProps, 'color' | 'variant'> {
  color?: PbsStatusChipColor
  withDot?: boolean
}

export default function PbsStatusChip({ color = 'default', withDot = false, sx, label, ...rest }: PbsStatusChipProps) {
  const theme = useTheme()
  const palette = color === 'default' ? null : color

  const bg = palette
    ? alpha(theme.palette[palette].main, 0.16)
    : alpha(theme.palette.text.primary, 0.08)
  const fg = palette ? theme.palette[palette].main : theme.palette.text.secondary

  return (
    <Chip
      size="small"
      label={
        withDot ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: 'currentColor',
                opacity: 0.9,
                flexShrink: 0,
              }}
            />
            {label}
          </span>
        ) : (
          label
        )
      }
      sx={{
        height: 24,
        fontWeight: 700,
        borderRadius: '14px',
        border: 'none',
        backgroundColor: `${bg} !important`,
        color: `${fg} !important`,
        '& .MuiChip-label': {
          px: 1,
          display: 'flex',
          alignItems: 'center',
          color: 'inherit',
        },
        '& .MuiChip-icon': {
          color: 'inherit',
        },
        ...sx,
      }}
      {...rest}
    />
  )
}
