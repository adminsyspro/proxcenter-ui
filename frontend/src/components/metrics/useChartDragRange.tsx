'use client'

import React from 'react'

import { ReferenceArea } from 'recharts'

import { RRD_MIN_STEP_SECONDS, type RrdWindow } from '@/lib/metrics/rrdRange'

type ChartMouseEvent = { activeLabel?: string | number } | null | undefined

function labelToMs(event: ChartMouseEvent): number | null {
  const raw = Number((event as any)?.activeLabel)

  return Number.isFinite(raw) && raw > 0 ? raw : null
}

/**
 * Drag a window straight on a chart. Recharts hands us the x value under the
 * cursor (`activeLabel`, an epoch in ms here), so the selection is expressed
 * in data coordinates and needs no pixel maths.
 *
 * The returned `chartProps` go on every chart of a card and `selection` is a
 * plain element, so spreading the same hook over the four charts of a
 * Performance card highlights the window on all of them at once.
 */
export default function useChartDragRange(onSelect: (window: RrdWindow) => void) {
  const [pressed, setPressed] = React.useState(false)
  const [start, setStart] = React.useState<number | null>(null)
  const [end, setEnd] = React.useState<number | null>(null)

  const reset = React.useCallback(() => {
    setPressed(false)
    setStart(null)
    setEnd(null)
  }, [])

  const finish = React.useCallback(() => {
    setPressed(false)

    if (start == null || end == null || start === end) {
      reset()

      return
    }

    const from = Math.floor(Math.min(start, end) / 1000)
    const to = Math.ceil(Math.max(start, end) / 1000)

    reset()

    // A drag narrower than the finest archive would select a window Proxmox
    // has no second point for, so widen it to the floor instead of handing
    // back an empty chart.
    if (to - from < RRD_MIN_STEP_SECONDS) {
      onSelect({ from, to: from + RRD_MIN_STEP_SECONDS })

      return
    }

    onSelect({ from, to })
  }, [start, end, onSelect, reset])

  const chartProps = {
    onMouseDown: (event: ChartMouseEvent) => {
      setPressed(true)
      setStart(labelToMs(event))
      setEnd(null)
    },
    onMouseMove: (event: ChartMouseEvent) => {
      if (!pressed) return
      const ms = labelToMs(event)

      if (ms == null) return

      // Recharts only knows where the cursor is once it has seen it move, so a
      // press on a chart that just re-rendered under a still cursor carries no
      // label. Take the first moved-to point as the anchor instead of losing
      // the whole drag.
      if (start == null) setStart(ms)
      else setEnd(ms)
    },
    onMouseUp: finish,
    onMouseLeave: reset,
  }

  const selection =
    start != null && end != null ? (
      <ReferenceArea x1={Math.min(start, end)} x2={Math.max(start, end)} strokeOpacity={0.4} fillOpacity={0.12} />
    ) : null

  return { chartProps, selection, dragging: start != null }
}
