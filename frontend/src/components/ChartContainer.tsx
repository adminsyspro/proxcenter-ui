'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Box } from '@mui/material'
import { ResponsiveContainer } from 'recharts'

type Props = {
  height?: number
  width?: number
  children: React.ReactElement
  sx?: any
}

/**
 * Drop-in replacement for Recharts <ResponsiveContainer>. Uses a ResizeObserver
 * on the wrapper element, then passes explicit numeric dimensions to
 * ResponsiveContainer. This avoids the "width(-1) height(-1)" warning that
 * Recharts 3 emits when its internal measurement runs before layout settles.
 *
 * Usage:
 *   <ChartContainer height={170}>...</ChartContainer>      // fills parent width, fixed height
 *   <ChartContainer>...</ChartContainer>                    // fills parent width and height
 *   <ChartContainer height={170} width={300}>...</Chart>    // fully explicit
 */
export default function ChartContainer({ height, width, children, sx }: Props) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [dims, setDims] = useState<{ w: number; h: number }>({ w: width || 0, h: height || 0 })

  useEffect(() => {
    if (!ref.current) return
    const el = ref.current
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      if (!r) return
      const w = width != null ? width : r.width
      const h = height != null ? height : r.height
      if (w > 0 && h > 0) setDims({ w, h })
    })
    ro.observe(el)
    const rect = el.getBoundingClientRect()
    const w = width != null ? width : rect.width
    const h = height != null ? height : rect.height
    if (w > 0 && h > 0) setDims({ w, h })
    return () => ro.disconnect()
  }, [width, height])

  const boxSx = {
    width: width != null ? width : '100%',
    height: height != null ? height : '100%',
    ...sx,
  }

  return (
    <Box ref={ref} sx={boxSx}>
      {dims.w > 0 && dims.h > 0 ? (
        <ResponsiveContainer width={dims.w} height={dims.h}>
          {children}
        </ResponsiveContainer>
      ) : null}
    </Box>
  )
}
