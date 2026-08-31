'use client'

import { memo } from 'react'

import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react'
import { useMediaQuery } from '@mui/material'

/**
 * What a flow edge knows besides its path. `observed` is the seam for the
 * /operations/network-flows coupling: once live sFlow pairs are correlated to
 * resolved flows (same IP-to-guest index, matched on src/dst IP and port), the
 * measured throughput lands here and drives the edge's weight and its stream
 * speed. Nothing populates it yet.
 */
export type FlowEdgeData = {
  /** Animated binary stream riding the edge; the overview's dimmed edges leave it off. */
  particle?: boolean
  color?: string
  observed?: { bps: number }
}

/**
 * A deterministic pseudo-random run of bits per edge, so the streams differ
 * from edge to edge but never change across renders (no hydration drift).
 */
export function bitsFor(id: string): string {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = ((h ^ id.charCodeAt(i)) * 16777619) >>> 0

  let out = ''
  for (let i = 0; i < 14; i++) {
    out += String(h & 1)
    h = ((h >>> 1) | ((h & 1) << 30)) >>> 0
  }

  return out
}

function FlowEdgeComponent(props: EdgeProps) {
  const [path] = getBezierPath(props)
  const data = (props.data ?? {}) as FlowEdgeData
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')

  return (
    <>
      <BaseEdge id={props.id} path={path} style={props.style} markerEnd={props.markerEnd} />
      {data.particle && !reducedMotion && (
        // Binary digits flowing along the wire, following its curvature. The
        // BaseEdge path carries the edge id, which anchors the textPath.
        <text dy={-2.5} fontSize={7} fill={data.color ?? '#4caf50'} opacity={0.9} aria-hidden style={{ fontFamily: 'monospace', letterSpacing: 2, userSelect: 'none', pointerEvents: 'none' }}>
          <textPath href={`#${props.id}`} startOffset='0%'>
            {bitsFor(props.id)}
            <animate attributeName='startOffset' from='-15%' to='100%' dur='2.6s' repeatCount='indefinite' />
          </textPath>
        </text>
      )}
    </>
  )
}

export const FlowEdge = memo(FlowEdgeComponent)
