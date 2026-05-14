'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

import { Box } from '@mui/material'

interface Props {
  height?: number

  /** Render a chart with the measured width. Receives the integer pixel width. */
  children: (width: number) => ReactNode

  /** Fallback when no series data is available. */
  fallback?: ReactNode
  hasData: boolean
}

/**
 * Wrapper that measures its own pixel width via ResizeObserver and only renders
 * the chart once the layout settles. Avoids the Recharts "width(-1) height(-1)"
 * warning that fires when a chart inside a TableCell mounts before the cell is
 * sized.
 */
export default function SparklineCell({ height = 24, children, fallback, hasData }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const node = ref.current

    if (!node) return

    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0
      const rounded = Math.max(0, Math.round(w))

      setWidth((prev) => (prev === rounded ? prev : rounded))
    })

    ro.observe(node)

return () => ro.disconnect()
  }, [])

  return (
    <Box ref={ref} sx={{ width: '100%', height, overflow: 'visible' }}>
      {hasData && width > 0 ? children(width) : fallback}
    </Box>
  )
}
