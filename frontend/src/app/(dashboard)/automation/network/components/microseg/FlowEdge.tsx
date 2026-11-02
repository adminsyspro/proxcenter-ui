'use client'

import { memo } from 'react'
import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react'
import { Box, Tooltip, Typography, useMediaQuery } from '@mui/material'
import { useTranslations } from 'next-intl'

import { NODE_H, NODE_W, type MapEdgeData } from './zoneGraph'

type Point = { x: number; y: number }

const GAP = 4
const round = (v: number) => Math.round(v * 100) / 100 + 0

/**
 * A straight edge between two node centers, clipped on the side of the two
 * boxes, then shifted along its own normal by `offset` (so the edges of a pair
 * run side by side, each direction on its own side). Null when there is no room
 * for an edge between the boxes.
 */
export function edgeGeometry(
  from: Point,
  to: Point,
  { halfW, halfH, gap, offset }: { halfW: number; halfH: number; gap: number; offset: number },
) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) return null
  const ux = dx / len
  const uy = dy / len
  const reach = Math.min(ux === 0 ? Infinity : halfW / Math.abs(ux), uy === 0 ? Infinity : halfH / Math.abs(uy)) + gap
  if (len < 2 * reach + 8) return null
  const nx = -uy * offset
  const ny = ux * offset
  const start = { x: round(from.x + ux * reach + nx), y: round(from.y + uy * reach + ny) }
  const end = { x: round(to.x - ux * reach + nx), y: round(to.y - uy * reach + ny) }
  return {
    start,
    end,
    mid: { x: round((start.x + end.x) / 2), y: round((start.y + end.y) / 2) },
    path: `M ${start.x} ${start.y} L ${end.x} ${end.y}`,
  }
}

/**
 * An edge of the zone map: an arrow from one box to the other, the protocols and
 * ports as an ellipsized label with the full text in a tooltip, and, on an
 * allowed flow only, a particle that follows the edge. The particle is not
 * drawn under prefers-reduced-motion.
 */
function FlowEdgeComponent({ id, sourceX, sourceY, targetX, targetY, style, markerEnd, data }: EdgeProps) {
  const t = useTranslations('microsegPilot.overview.edge')
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)', { noSsr: true })
  const d = data as unknown as MapEdgeData
  const geometry = edgeGeometry({ x: sourceX, y: sourceY }, { x: targetX, y: targetY }, { halfW: NODE_W / 2, halfH: NODE_H / 2, gap: GAP, offset: d.offset })
  if (!geometry) return null

  const label = d.services.join(', ')
  return (
    <>
      <BaseEdge id={id} path={geometry.path} style={style} markerEnd={markerEnd} interactionWidth={12} />
      {d.particle && !reducedMotion && (
        <circle r={3} fill={d.color} opacity={0.9} aria-hidden style={{ pointerEvents: 'none' }}>
          <animateMotion dur='2.8s' repeatCount='indefinite' path={geometry.path} />
        </circle>
      )}
      <EdgeLabelRenderer>
        <Box
          className='nodrag nopan'
          sx={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${geometry.mid.x}px, ${geometry.mid.y}px)`, pointerEvents: 'all', maxWidth: 170 }}
        >
          <Tooltip title={t(d.kind, { count: d.count, services: label })}>
            <Typography
              noWrap
              variant='caption'
              sx={{ display: 'block', px: 0.75, borderRadius: 1, border: '1px solid', borderColor: d.color, bgcolor: 'background.paper', color: d.color, fontWeight: 600 }}
            >
              {label}
            </Typography>
          </Tooltip>
        </Box>
      </EdgeLabelRenderer>
    </>
  )
}

export const FlowEdge = memo(FlowEdgeComponent)
