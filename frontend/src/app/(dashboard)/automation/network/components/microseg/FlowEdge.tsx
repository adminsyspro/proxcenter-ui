'use client'

import { createContext, memo, useContext, useMemo } from 'react'
import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react'
import { Box, Tooltip, Typography, alpha, useMediaQuery } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import type { MicrosegSuggestion } from '@/lib/microseg/types'
import { VOLUME_LEVELS, fewSamples, flowRules, volumeText, type VolumeFigure, type VolumePeriod } from '@/lib/microseg/volume'
import { serviceTitle, serviceTokensTitle } from '@/lib/network/serviceNames'
import { formatBytes } from '@/utils/format'

import type { MapEdgeData } from './zoneGraph'
import { rangeOfPeriod, useEdgeVolumeHistory } from './useEdgeVolumeHistory'
import { useNow } from './useNow'
import { RANGE_LABEL } from '../postureTimeline'

/** At most this many observed flows are listed in the tooltip of an edge; the panel lists them all. */
const TOOLTIP_ROWS = 5

/** A click on the label of an edge does what a click on the edge does (ZoneCanvas provides it). */
export const EdgeClickContext = createContext<(edgeId: string) => void>(() => undefined)

/** How the map names a zone and the end of an edge, long ("web-1 (web)") and short ("web-1"). ZoneMap provides it. */
export type MapNames = { zone: (zoneId: string) => string; end: (nodeId: string) => string; short: (nodeId: string) => string }
export const MapNamesContext = createContext<MapNames>({ zone: id => id, end: id => id, short: id => id })

/**
 * What the tooltip of an edge reads its volume history with: the clusters of the policy, the period of the map and the
 * zone names of the rules. Null when sFlow does not measure the map (no chart). ZoneMap provides it.
 */
export type EdgeVolumeSource = { clusterIds: readonly string[]; period: VolumePeriod | 'all'; zoneName: (zoneId: string) => string | undefined }
export const EdgeVolumeContext = createContext<EdgeVolumeSource | null>(null)

export type EdgeT = (key: string, values?: Record<string, string | number>) => string

/** An observed edge between guests (or a "+N" node) shows the sample pair the engine kept, not every pair that talked. */
export const isSampled = (source: string, target: string) => /^(guest|more):/.test(source) || /^(guest|more):/.test(target)

/** What an edge says to a screen reader: "web to db: tcp/443", "web-1 (web) to db-1 (db): 2 unprotected flows". */
export function edgeAria(t: EdgeT, names: MapNames, source: string, target: string, d: MapEdgeData): string {
  return t('aria', { from: names.end(source), to: names.end(target), services: edgeContent(t, d) })
}

/**
 * What an edge carries, for its name: the count of an observed edge, the services of an allowed one or of an
 * exception, and the count of the exceptions between two zones.
 */
function edgeContent(t: EdgeT, d: MapEdgeData): string {
  if (d.kind === 'unprotected') return t('countUnprotected', { count: d.count })
  if (d.kind === 'blocked') return t('countBlocked', { count: d.count })
  return joinParts(d.services.length ? serviceTokensTitle(d.services) : null, d.exceptionCount ? t('exceptionCount', { count: d.exceptionCount }) : null)
}

/** The parts of a label that are there, in their order: "SSH, PostgreSQL · 1.4K", "HTTPS · 2 exceptions". */
export const joinParts = (...parts: Array<string | null>) => parts.filter(part => !!part).join(' · ')

/**
 * "14 hits between zone web and zone db on tcp/22": the hits are the zone pair's, not the guests'. On an edge drawn
 * from a guest (`sampled`, see isSampled) it adds "(sample pair shown)", since the guests are only the example kept.
 */
export function observedHits(t: EdgeT, names: MapNames, s: MicrosegSuggestion, unknown: string, sampled: boolean): string {
  const service = serviceTitle(s.proto, s.dport)
  const to = names.zone(s.dst_zone_id)
  if (s.src_zone_id) return t(sampled ? 'zoneHitsSampled' : 'zoneHits', { count: s.hits, from: names.zone(s.src_zone_id), to, service })
  return t(sampled ? 'sourceHitsSampled' : 'sourceHits', { count: s.hits, from: s.src_ip || unknown, to, service })
}

/** The guests an edge of the node view stands for, pair by pair with their services (the first ones, then "+N more"). */
function GuestPairs({ d }: { d: MapEdgeData }) {
  const t = useTranslations('microsegPilot.overview.edge')
  const pairs = d.guestPairs ?? []
  if (!pairs.length) return null
  return (
    <>
      {d.kind !== 'exception' && <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>{t('pairsSampled')}</Typography>}
      {pairs.slice(0, TOOLTIP_ROWS).map(p => (
        <Typography key={p.key} variant='caption' sx={{ display: 'block' }}>{t('aria', { from: p.from, to: p.to, services: serviceTokensTitle(p.services) })}</Typography>
      ))}
      {pairs.length > TOOLTIP_ROWS && <Typography variant='caption' sx={{ display: 'block' }}>{t('more', { count: pairs.length - TOOLTIP_ROWS })}</Typography>}
    </>
  )
}

/**
 * The volume of an edge at the head of its label: bars lit against the largest edge of the map, then its bytes. The
 * edges keep one width whatever they carry.
 */
export function VolumeGauge({ level, volume }: { level: number; volume: VolumeFigure }) {
  return (
    <Box component='span' data-testid='edge-volume-gauge' data-level={level} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, mr: 0.75, color: 'text.secondary', fontWeight: 500 }}>
      <svg width={13} height={10} viewBox='0 0 13 10' aria-hidden style={{ flexShrink: 0 }}>
        {Array.from({ length: VOLUME_LEVELS }, (_, i) => {
          const h = 4 + i * 2
          return <rect key={i} x={i * 3.5} y={10 - h} width={2.5} height={h} rx={0.5} fill='currentColor' opacity={i < level ? 1 : 0.25} />
        })}
      </svg>
      {volumeText(volume, 0)}
    </Box>
  )
}

const SPARK_H = 48

/**
 * The volume of an edge over the period of the map as an area under its line, in the edge's colour, the width of the
 * card, with its range and its peak: read when the tooltip opens (the panel of the pair has the full chart). `whole`:
 * the edge shares its traffic with others, so the chart draws its whole pair of zones, said so in its caption.
 */
export function EdgeVolumeSpark({ d, source, whole = null }: { d: MapEdgeData; source: EdgeVolumeSource; whole?: { from: string; to: string } | null }) {
  const t = useTranslations('microsegPilot.overview.edge')
  const tr = useTranslations('networkPage.dashboard')
  const tn = useTranslations('microsegPilot.overview.node')
  // The whole pair, every service; else the traffic the edge shows (the map gave its pairs and services), else every
  // one its flows stand for.
  const rules = useMemo(() => {
    if (whole) return [{ src: whole.from, dst: whole.to, proto: 'any', dport: '' }]
    return d.volumeRules ?? flowRules(d.flows, d.observed, source.zoneName)
  }, [whole, d.volumeRules, d.flows, d.observed, source.zoneName])
  // An edge drawn from or to a guest reads the volume of its guests; the whole pair is read between its zones.
  const { series, range, loading } = useEdgeVolumeHistory(source.clusterIds, source.period, rules, whole ? null : d.volumeGuest)
  const peak = Math.max(0, ...series)
  const width = Math.max(1, series.length - 1)
  const y = (v: number) => SPARK_H - 1 - (peak > 0 ? (v / peak) * (SPARK_H - 4) : 0)
  const line = series.map((v, i) => `${i ? 'L' : 'M'}${i},${y(v).toFixed(1)}`).join(' ')
  return (
    <Box data-testid='edge-volume-spark'>
      <Box sx={{ height: SPARK_H, borderBottom: 1, borderColor: 'divider' }}>
        {!loading && series.length > 0 && (
          <svg width='100%' height={SPARK_H} viewBox={`0 0 ${width} ${SPARK_H}`} preserveAspectRatio='none' aria-hidden style={{ display: 'block' }}>
            <path d={`${line} L${width},${SPARK_H} L0,${SPARK_H} Z`} fill={alpha(d.color, 0.18)} />
            <path d={line} fill='none' stroke={d.color} strokeWidth={1.5} strokeLinejoin='round' vectorEffect='non-scaling-stroke' />
          </svg>
        )}
      </Box>
      <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mt: 0.25 }}>
        {whole
          ? t('volumeSparkPair', { from: whole.from || tn('external'), to: whole.to || tn('external'), range: tr(RANGE_LABEL[range]), peak: formatBytes(peak, 1) })
          : t('volumeSpark', { range: tr(RANGE_LABEL[range]), peak: formatBytes(peak, 1) })}
      </Typography>
    </Box>
  )
}

/** A key figure of the card: its name above, its value below. */
function Stat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <Box sx={{ minWidth: 0 }} data-testid={testId}>
      <Typography variant='caption' color='text.secondary' noWrap sx={{ display: 'block', lineHeight: 1.3 }}>{label}</Typography>
      <Typography variant='body2' fontWeight={600} noWrap sx={{ lineHeight: 1.4 }}>{value}</Typography>
    </Box>
  )
}

/** "2 hours ago", or the raw text when it is not a date. */
function relative(format: ReturnType<typeof useFormatter>, iso: string, now: number): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : format.relativeTime(d, now)
}

/** One line per observed flow: its service (and its source when it is in no zone), its hits, when it was last seen. */
/** The size of the small print of the card: the notes under what matters. */
const NOTE_SX = { display: 'block', fontSize: '0.6875rem', lineHeight: 1.35, color: 'text.disabled' } as const
const HEAD_SX = { fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'text.secondary' } as const
const CELL_SX = { fontSize: '0.8125rem', lineHeight: 1.5 } as const

/**
 * The observed flows of the edge as the table the card is read for: one line per flow, its service (and its source
 * when it is in no zone), its hits and when it was last seen, under their column names.
 */
function ObservedRows({ d, unknown }: { d: MapEdgeData; unknown: string }) {
  const t = useTranslations('microsegPilot.overview.edge')
  const format = useFormatter()
  const now = useNow(60_000)
  return (
    <Box data-testid='edge-observed' sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', columnGap: 1.5, rowGap: 0.25, alignItems: 'baseline' }}>
      <Typography sx={HEAD_SX}>{t('colService')}</Typography>
      <Typography sx={{ ...HEAD_SX, textAlign: 'right' }}>{t('colHits')}</Typography>
      <Typography sx={{ ...HEAD_SX, textAlign: 'right' }}>{t('colSeen')}</Typography>
      <Box sx={{ gridColumn: '1 / -1', borderBottom: 1, borderColor: 'divider' }} />
      {d.observed.slice(0, TOOLTIP_ROWS).map(s => (
        <Box key={s.id} sx={{ display: 'contents' }} data-testid='edge-observed-row'>
          <Typography noWrap sx={{ ...CELL_SX, fontWeight: 600, color: 'text.primary' }}>
            {serviceTitle(s.proto, s.dport)}
            {!s.src_zone_id && <Box component='span' sx={{ fontWeight: 400, color: 'text.secondary' }}>{` · ${s.src_ip || unknown}`}</Box>}
          </Typography>
          <Typography sx={{ ...CELL_SX, fontWeight: 600, color: 'text.primary', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{format.number(s.hits)}</Typography>
          <Typography noWrap sx={{ ...CELL_SX, color: 'text.secondary', textAlign: 'right' }}>{relative(format, s.last_seen, now)}</Typography>
        </Box>
      ))}
      {d.observed.length > TOOLTIP_ROWS && <Typography sx={{ ...CELL_SX, color: 'text.secondary', gridColumn: '1 / -1' }}>{t('more', { count: d.observed.length - TOOLTIP_ROWS })}</Typography>}
    </Box>
  )
}

/**
 * The tooltip of an edge as a card on the surface of the theme: what it is (its kind and services, in its colour),
 * its key figures (log occurrences, sFlow volume and packets), the chart of its volume over the period, then its
 * observed flows one per line (service, hits, last seen) or the sample pairs of the node view.
 */
/** How the tooltip of an edge is drawn: the card on the surface of the theme, not the grey bubble. */
export const EDGE_CARD_TOOLTIP = { tooltip: { sx: { bgcolor: 'background.paper', color: 'text.primary', border: 1, borderColor: 'divider', boxShadow: 6, p: 0, maxWidth: 400 } } } as const

/** `heading`: the two ends of the edge, where the card does not sit on it (a ribbon of the Sankey diagram). */
export function EdgeDetails({ d, source, target, heading }: { d: MapEdgeData; source: string; target: string; heading?: string }) {
  const t = useTranslations('microsegPilot.overview.edge')
  const tr = useTranslations('networkPage.dashboard')
  const to = useTranslations('microsegPilot.observation')
  const volumeSource = useContext(EdgeVolumeContext)
  const names = useContext(MapNamesContext)
  const format = useFormatter()
  const observed = d.kind === 'unprotected' || d.kind === 'blocked'
  const measured = d.kind !== 'exception' && !!d.volume && d.volume.bytes > 0
  // The chart of its volume over the period: an edge sFlow measured something on, drawing the traffic it shows.
  // A shared edge that counts nothing itself charts its whole pair: the chart of every edge of the map says something.
  const whole = d.volumeShared && !measured && d.volumePair && d.volumePair.figure.bytes > 0 ? d.volumePair : null
  const spark = volumeSource && (whole || (measured && d.volumeLevel)) ? volumeSource : null
  const sampled = observed && isSampled(source, target)
  // The table of its observed flows (the node view lists its pairs of guests instead).
  const listed = observed && !d.guestPairs && d.observed.length > 0
  const title = observed ? t(d.kind, { count: d.count }) : t(d.kind, { services: serviceTokensTitle(d.services) })
  const stats: Array<{ label: string; value: string; testId?: string }> = []
  if (observed && d.hits !== null) stats.push({ label: t('statHits'), value: format.number(d.hits) })
  // A shared edge sets what it counts beside its whole pair (the panel's figure); another its volume and packets.
  const pairFigure = d.volumeShared && d.volumePair ? d.volumePair.figure : null
  if (pairFigure) {
    stats.push({ label: t('statEdgeVolume'), value: volumeText(d.volume ?? { bytes: 0, packets: 0 }, 1), testId: 'edge-volume' })
    stats.push({ label: t('statPairVolume'), value: volumeText(pairFigure, 1), testId: 'edge-pair-volume' })
  } else if (measured) {
    stats.push({ label: t('statVolume'), value: volumeText(d.volume!, 1), testId: 'edge-volume' })
    stats.push({ label: t('statPackets'), value: format.number(d.volume!.packets, { notation: 'compact' }) })
  }
  let volumeNote: string | null = null
  // The volume is told over the period of the map, the last 24 hours when the map shows the flows seen whenever.
  const overRange = volumeSource ? tr(RANGE_LABEL[rangeOfPeriod(volumeSource.period)]) : null
  if (measured && d.kind === 'blocked') volumeNote = overRange ? t('volumeBlockedNoteRange', { range: overRange }) : t('volumeBlockedNote')
  else if (measured) volumeNote = overRange ? t('volumeNoteRange', { range: overRange }) : t('volumeNote')
  // sFlow keeps one packet in hundreds: on a few samples the figure is an order of magnitude.
  const estimate = measured && fewSamples(d.volume) ? t('volumeFewSamples', { count: d.volume!.samples ?? 0 }) : null
  // Shared: part of its traffic is counted elsewhere, or all of it (nothing left to this edge).
  let shared: string | null = null
  if (d.kind !== 'exception' && d.volumeShared && volumeSource) {
    if (d.volumeUntold) shared = t('volumeUntold')
    else shared = t((d.volume?.bytes ?? 0) > 0 ? 'volumeShared' : 'volumeSharedAll')
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, p: 1.5, width: 380, maxWidth: '100%' }} data-testid='edge-card'>
      <Box>
        {heading && <Typography variant='caption' color='text.secondary' noWrap sx={{ display: 'block' }} data-testid='edge-card-heading'>{heading}</Typography>}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box component='span' aria-hidden sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: d.color, flexShrink: 0 }} />
          <Typography variant='body2' fontWeight={600} sx={{ minWidth: 0 }}>{title}</Typography>
        </Box>
        {d.exceptionCount > 0 && <Typography variant='caption' color='text.secondary' sx={{ display: 'block', pl: 2.25 }}>{t('exceptionsBetween', { count: d.exceptionCount })}</Typography>}
        {d.draft && <Typography variant='caption' color='text.secondary' sx={{ display: 'block', pl: 2.25 }}>{t('draft')}</Typography>}
        {sampled && <Typography variant='caption' color='text.secondary' sx={{ display: 'block', pl: 2.25 }}>{t('example', { from: names.short(source), to: names.short(target) })}</Typography>}
      </Box>
      {stats.length > 0 && (
        <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))`, gap: 1, py: 1, borderTop: 1, borderBottom: 1, borderColor: 'divider' }}>
          {stats.map(stat => <Stat key={stat.label} {...stat} />)}
        </Box>
      )}
      {spark && <EdgeVolumeSpark d={d} source={spark} whole={whole ? { from: whole.from, to: whole.to } : null} />}
      {!observed && !measured && !shared && <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>{d.kind === 'exception' || !volumeSource ? t('noCounter') : t('volumeNone')}</Typography>}
      <GuestPairs d={d} />
      {listed && <ObservedRows d={d} unknown={to('unknownEndpoint')} />}
      {/* The small print, last: how the figures above are to be read. */}
      {(volumeNote || estimate || shared || (listed && sampled)) && (
        <Box data-testid='edge-notes' sx={{ pt: 0.75, borderTop: 1, borderColor: 'divider' }}>
          {volumeNote && <Typography sx={NOTE_SX}>{volumeNote}</Typography>}
          {estimate && <Typography sx={NOTE_SX} data-testid='edge-volume-estimate'>{estimate}</Typography>}
          {shared && <Typography sx={NOTE_SX} data-testid='edge-volume-shared'>{shared}</Typography>}
          {listed && sampled && <Typography sx={NOTE_SX}>{t('hitsSampled')}</Typography>}
        </Box>
      )}
    </Box>
  )
}

/**
 * An edge of the zone map, drawn from the shape the graph computed (React Flow's handle positions are not used):
 * the arrow, the grouped services (names of the known ports) as an ellipsized label with the details in a tooltip (an exception is dashed, label included), and, on an applied allowed
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
  const format = useFormatter()
  // An observed edge says how often its flows were logged after its services ("SSH, PostgreSQL · 1.4K"), a link
  // between two zones how many exceptions it stands for ("HTTPS · 2 exceptions").
  const label = joinParts(
    d.label,
    d.hits != null ? format.number(d.hits, { notation: 'compact' }) : null,
    d.exceptionCount ? t('exceptionCount', { count: d.exceptionCount }) : null,
  )

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
          <Tooltip
            title={<EdgeDetails d={d} source={source} target={target} />}
            slotProps={EDGE_CARD_TOOLTIP}
          >
            <Typography
              noWrap
              variant='caption'
              sx={{
                display: 'block', px: 0.75, borderRadius: 1, border: '1px solid', borderColor: d.color, borderStyle: d.kind === 'unprotected' || d.kind === 'exception' ? 'dashed' : 'solid',
                bgcolor: 'background.paper', color: 'text.primary', fontWeight: 600, lineHeight: `${d.label_h - 2}px`, fontSize: d.small ? '0.68rem' : undefined,
              }}
              data-testid={`flow-label-${id}`}
            >
              {d.volume && d.volume.bytes > 0 && !!d.volumeLevel && <VolumeGauge level={d.volumeLevel} volume={d.volume} />}
              {label}
            </Typography>
          </Tooltip>
        </Box>
      </EdgeLabelRenderer>
    </>
  )
}

export const FlowEdge = memo(FlowEdgeComponent)
