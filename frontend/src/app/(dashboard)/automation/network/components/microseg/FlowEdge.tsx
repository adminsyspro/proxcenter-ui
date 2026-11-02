'use client'

import { memo } from 'react'
import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react'
import { Box, Tooltip, Typography, useMediaQuery } from '@mui/material'
import { useTranslations } from 'next-intl'

import { edgeGeometry } from './edgeGeometry'
import { NODE_H, NODE_W, type MapEdgeData } from './zoneGraph'

const GAP = 4

/**
 * An edge of the zone map: an arrow (straight, or bowed to stay clear of the other nodes) from one box to the other, the protocols and
 * ports as an ellipsized label with the full text in a tooltip, and, on an
 * allowed flow only, a particle that follows the edge. The particle is not
 * drawn under prefers-reduced-motion.
 */
function FlowEdgeComponent({ id, sourceX, sourceY, targetX, targetY, style, markerEnd, data }: EdgeProps) {
  const t = useTranslations('microsegPilot.overview.edge')
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)', { noSsr: true })
  const d = data as unknown as MapEdgeData
  const geometry = edgeGeometry({ x: sourceX, y: sourceY }, { x: targetX, y: targetY }, {
    halfW: NODE_W / 2, halfH: NODE_H / 2, gap: GAP, offset: d.offset, bow: d.bow, at: d.labelAt,
  })
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
              sx={{ display: 'block', px: 0.75, borderRadius: 1, border: '1px solid', borderColor: d.color, bgcolor: 'background.paper', color: 'text.primary', fontWeight: 600 }}
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
