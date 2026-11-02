'use client'

import { createContext, memo, useContext } from 'react'
import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react'
import { Box, Tooltip, Typography, useMediaQuery } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import type { MapEdgeData } from './zoneGraph'

/** At most this many observed flows are listed in the tooltip of an edge; the panel lists them all. */
const TOOLTIP_ROWS = 5

/** A click on the label of an edge does what a click on the edge does (ZoneCanvas provides it). */
export const EdgeClickContext = createContext<(edgeId: string) => void>(() => undefined)

function EdgeDetails({ d }: { d: MapEdgeData }) {
  const t = useTranslations('microsegPilot.overview.edge')
  const to = useTranslations('microsegPilot.observation')
  const format = useFormatter()
  const when = (iso: string) => {
    const date = new Date(iso)
    return Number.isNaN(date.getTime()) ? iso : format.dateTime(date, { dateStyle: 'medium', timeStyle: 'short' })
  }
  if (d.kind === 'allowed' || d.kind === 'outside') {
    return (
      <Box>
        <Typography variant='caption' sx={{ display: 'block' }}>{t(d.kind, { services: d.services.join(', ') })}</Typography>
        {d.draft && <Typography variant='caption' sx={{ display: 'block' }}>{t('draft')}</Typography>}
      </Box>
    )
  }
  return (
    <Box>
      <Typography variant='caption' fontWeight={600} sx={{ display: 'block' }}>{t(d.kind, { count: d.count })}</Typography>
      {d.observed.slice(0, TOOLTIP_ROWS).map(s => (
        <Typography key={s.id} variant='caption' sx={{ display: 'block' }}>
          {`${s.dport ? `${s.proto}/${s.dport}` : s.proto} · ${to('hits', { count: s.hits })} · ${to('detail.firstSeen', { time: when(s.first_seen) })} · ${to('detail.lastSeen', { time: when(s.last_seen) })}`}
        </Typography>
      ))}
      {d.observed.length > TOOLTIP_ROWS && <Typography variant='caption' sx={{ display: 'block' }}>{t('more', { count: d.observed.length - TOOLTIP_ROWS })}</Typography>}
    </Box>
  )
}

/**
 * An edge of the zone map, drawn from the shape the graph computed (React Flow's handle positions are not used):
 * the arrow, the grouped ports as an ellipsized label with the details in a tooltip, and, on an applied allowed
 * flow only, a particle that follows the edge (not drawn under prefers-reduced-motion). A dimmed edge (focus mode)
 * dims its label too.
 */
function FlowEdgeComponent({ id, style, markerEnd, data }: EdgeProps) {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)', { noSsr: true })
  const onClick = useContext(EdgeClickContext)
  const d = data as unknown as MapEdgeData & { dimmed?: boolean }
  const dim = d.dimmed ? 'microseg-dim' : undefined

  return (
    <>
      <BaseEdge id={id} path={d.path} style={style} markerEnd={markerEnd} interactionWidth={14} className={dim} />
      {d.particle && !reducedMotion && (
        <circle r={3} fill={d.color} opacity={0.9} aria-hidden className={dim} style={{ pointerEvents: 'none' }}>
          <animateMotion dur='2.8s' repeatCount='indefinite' path={d.path} />
        </circle>
      )}
      <EdgeLabelRenderer>
        <Box
          className={['nodrag', 'nopan', dim].filter(Boolean).join(' ')}
          onClick={event => { event.stopPropagation(); onClick(id) }}
          sx={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${d.label_x}px, ${d.label_y}px)`, pointerEvents: 'all', maxWidth: d.label_w, cursor: 'pointer' }}
        >
          <Tooltip title={<EdgeDetails d={d} />}>
            <Typography
              noWrap
              variant='caption'
              sx={{
                display: 'block', px: 0.75, borderRadius: 1, border: '1px solid', borderColor: d.color, borderStyle: d.kind === 'unprotected' ? 'dashed' : 'solid',
                bgcolor: 'background.paper', color: 'text.primary', fontWeight: 600, lineHeight: `${d.label_h - 2}px`, fontSize: d.small ? '0.68rem' : undefined,
              }}
            >
              {d.label}
            </Typography>
          </Tooltip>
        </Box>
      </EdgeLabelRenderer>
    </>
  )
}

export const FlowEdge = memo(FlowEdgeComponent)
