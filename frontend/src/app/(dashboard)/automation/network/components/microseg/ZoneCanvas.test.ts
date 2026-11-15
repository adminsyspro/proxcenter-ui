import { describe, expect, it, vi } from 'vitest'
import { createTheme } from '@mui/material/styles'
import type { Node } from '@xyflow/react'

// The stylesheet of the canvas library cannot go through the PostCSS config of the test run.
vi.mock('@xyflow/react/dist/style.css', () => ({}))

import { GUEST_LAYER_Z, LABEL_LAYER_Z, canvasSx, fitKey } from './ZoneCanvas'

describe('zone canvas', () => {
  it('paints the edge labels above every edge and every node', () => {
    const sx = canvasSx(createTheme()) as unknown as Record<string, { zIndex?: number | string }>
    expect(sx['& .react-flow__edgelabel-renderer'].zIndex).toBe(LABEL_LAYER_Z)
    // Edges get z 1 (allowed) or 2 (observed), plus the z of a child node they reach (a few units at most).
    expect(LABEL_LAYER_Z).toBeGreaterThanOrEqual(100)
  })

  it('lifts the guests (and their names) above every edge, under the edge labels', () => {
    const sx = canvasSx(createTheme()) as unknown as Record<string, { zIndex?: number | string }>
    expect(sx['& .react-flow__node-guest, & .react-flow__node-more'].zIndex).toBe(`${GUEST_LAYER_Z} !important`)
    expect(GUEST_LAYER_Z).toBeGreaterThanOrEqual(10)
    expect(GUEST_LAYER_Z).toBeLessThan(LABEL_LAYER_Z)
  })

  it('refits when a circle grows, not when only its guests change', () => {
    const circle = (width: number, extra: Partial<Node> = {}): Node => ({ id: 'zone:zw', position: { x: 0, y: 0 }, data: {}, width, ...extra })
    const guest = (id: string): Node => ({ id, parentId: 'zone:zw', position: { x: 0, y: 0 }, data: {} })
    expect(fitKey([circle(220)])).not.toBe(fitKey([circle(320)]))
    expect(fitKey([circle(320), guest('g1')])).toBe(fitKey([circle(320), guest('g2')]))
  })
})
