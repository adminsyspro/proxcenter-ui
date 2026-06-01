'use client'

import React, { useEffect, useState } from 'react'

import { Box } from '@mui/material'

import { gaugeGeometry, GAUGE_VIEWBOX } from '../gaugeGeometry'

/**
 * Shared circular gauge. Renders only the dial (track + value arc) plus a
 * caller-supplied center overlay (`children`). Its diameter is `size`, given
 * in `em` so it tracks the inherited font size — which the appearance "font
 * size" setting drives through `html { font-size }`. The SVG uses a normalized
 * 0–100 viewBox and scales purely via CSS, so the dial grows/shrinks with the
 * font setting (not with the widget's pixel size).
 *
 * Fill is computed from either `value` as a percentage (0–100) or, when `max`
 * is provided, the ratio `value / max`.
 *
 * The center overlay sets a fluid `font-size` (container-query units relative
 * to the gauge), so children should size their text in `em` to track it.
 */
export default function CircularGauge({
  value = 0,
  max = null,
  color,
  trackColor,
  size = '4.5em',
  animate = true,
  children,
}) {
  const target = max != null
    ? (max > 0 ? value / max : 0)
    : (value || 0) / 100
  const fraction = Math.min(Math.max(target, 0), 1)

  const [shown, setShown] = useState(animate ? 0 : fraction)

  useEffect(() => {
    if (!animate) {
      setShown(fraction)

      return undefined
    }

    const timer = setTimeout(() => setShown(fraction), 50)

    return () => clearTimeout(timer)
  }, [fraction, animate])

  const geo = gaugeGeometry(shown)

  return (
    <Box
      sx={{
        position: 'relative',
        width: size,
        height: size,
        flexShrink: 0,
        containerType: 'size',
      }}
    >
      <svg
        viewBox={`0 0 ${GAUGE_VIEWBOX} ${GAUGE_VIEWBOX}`}
        width="100%"
        height="100%"
        style={{ transform: 'rotate(-90deg)', display: 'block' }}
      >
        <circle
          cx={geo.center}
          cy={geo.center}
          r={geo.radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={geo.strokeWidth}
        />
        <circle
          cx={geo.center}
          cy={geo.center}
          r={geo.radius}
          fill="none"
          stroke={color}
          strokeWidth={geo.strokeWidth}
          strokeDasharray={geo.circumference}
          strokeDashoffset={geo.dashoffset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1), stroke 0.3s ease' }}
        />
      </svg>
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          // Fluid baseline: ~26% of the gauge's smaller dimension, bounded so
          // the label stays readable at tiny sizes and never overflows at large
          // ones. Children use `em` to scale relative to this.
          fontSize: 'clamp(0.6rem, 26cqmin, 2rem)',
          lineHeight: 1,
          fontFamily: '"JetBrains Mono", monospace',
        }}
      >
        {children}
      </Box>
    </Box>
  )
}
