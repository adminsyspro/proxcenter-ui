'use client'

import { createContext, memo, useContext } from 'react'
import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react'
import { Box, Tooltip, Typography, useMediaQuery } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import type { MicrosegSuggestion } from '@/lib/microseg/types'

import type { MapEdgeData } from './zoneGraph'
import { formatWhen } from './summaryModel'

/** At most this many observed flows are listed in the tooltip of an edge; the panel lists them all. */
const TOOLTIP_ROWS = 5

/** A click on the label of an edge does what a click on the edge does (ZoneCanvas provides it). */
export const EdgeClickContext = createContext<(edgeId: string) => void>(() => undefined)

/** How the map names a zone and the end of an edge, long ("web-1 (web)") and short ("web-1"). ZoneMap provides it. */
export type MapNames = { zone: (zoneId: string) => string; end: (nodeId: string) => string; short: (nodeId: string) => string }
export const MapNamesContext = createContext<MapNames>({ zone: id => id, end: id => id, short: id => id })

export type EdgeT = (key: string, values?: Record<string, string | number>) => string

/** An observed edge between guests (or a "+N" node) shows the sample pair the engine kept, not every pair that talked. */
export const isSampled = (source: string, target: string) => /^(guest|more):/.test(source) || /^(guest|more):/.test(target)

/** What an edge says to a screen reader: "web to db: tcp/443", "web-1 (web) to db-1 (db): 2 unprotected flows". */
export function edgeAria(t: EdgeT, names: MapNames, source: string, target: string, d: MapEdgeData): string {
  return t('aria', { from: names.end(source), to: names.end(target), services: edgeContent(t, d) })
}

/** What an edge carries, for its name: the count of an observed edge, the services of an allowed one. */
function edgeContent(t: EdgeT, d: MapEdgeData): string {
  if (d.kind === 'unprotected') return t('countUnprotected', { count: d.count })
  if (d.kind === 'blocked') return t('countBlocked', { count: d.count })
  return d.services.join(', ')
}

/**
 * "14 hits between zone web and zone db on tcp/22": the hits are the zone pair's, not the guests'. On an edge drawn
 * from a guest (`sampled`, see isSampled) it adds "(sample pair shown)", since the guests are only the example kept.
 */
export function observedHits(t: EdgeT, names: MapNames, s: MicrosegSuggestion, unknown: string, sampled: boolean): string {
  const service = s.dport ? `${s.proto}/${s.dport}` : s.proto
  const to = names.zone(s.dst_zone_id)
  if (s.src_zone_id) return t(sampled ? 'zoneHitsSampled' : 'zoneHits', { count: s.hits, from: names.zone(s.src_zone_id), to, service })
  return t(sampled ? 'sourceHitsSampled' : 'sourceHits', { count: s.hits, from: s.src_ip || unknown, to, service })
}

function EdgeDetails({ d, source, target }: { d: MapEdgeData; source: string; target: string }) {
  const t = useTranslations('microsegPilot.overview.edge')
  const to = useTranslations('microsegPilot.observation')
  const names = useContext(MapNamesContext)
  const format = useFormatter()
  const when = (iso: string) => formatWhen(format, iso)
  const sampled = isSampled(source, target)
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
      {sampled && (
        <Typography variant='caption' sx={{ display: 'block' }}>{t('example', { from: names.short(source), to: names.short(target) })}</Typography>
      )}
      {d.observed.slice(0, TOOLTIP_ROWS).map(s => (
        <Typography key={s.id} variant='caption' sx={{ display: 'block' }}>
          {`${observedHits(t as EdgeT, names, s, to('unknownEndpoint'), sampled)} · ${to('detail.lastSeen', { time: when(s.last_seen) })}`}
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
function FlowEdgeComponent({ id, source, target, style, markerEnd, data }: EdgeProps) {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)', { noSsr: true })
  const onClick = useContext(EdgeClickContext)
  const names = useContext(MapNamesContext)
  const t = useTranslations('microsegPilot.overview.edge')
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
          role='button'
          tabIndex={0}
          aria-label={edgeAria(t as EdgeT, names, source, target, d)}
          onClick={event => { event.stopPropagation(); onClick(id) }}
          onKeyDown={event => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            onClick(id)
          }}
          sx={theme => ({
            position: 'absolute', transform: `translate(-50%, -50%) translate(${d.label_x}px, ${d.label_y}px)`, pointerEvents: 'all', maxWidth: d.label_w,
            cursor: 'pointer', borderRadius: 1, '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
          })}
        >
          <Tooltip title={<EdgeDetails d={d} source={source} target={target} />}>
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
