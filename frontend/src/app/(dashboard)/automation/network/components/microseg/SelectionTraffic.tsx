'use client'

import { useMemo, useState } from 'react'
import { Box, Tooltip, Typography } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import type { GuestType, MicrosegEvent, MicrosegZone } from '@/lib/microseg/types'

import type { BlockPhase } from '../dashboardModel'
import { zoneSeries } from '../dashboardPosture'
import { topSources, type SourceTotal, type TimelineVerdict } from '../postureTimeline'
import TrafficTimeline, { type TimelineDirection } from '../TrafficTimeline'
import { useSliceName } from '../TrafficByZone'
import { useTimelineRange } from '../useTimelineRange'
import { useTrafficTimeline } from '../useTrafficTimeline'
import { objectDotSx } from './objectColour'
import { useStoredChoice } from './useStoredChoice'
import { bareIp } from './zoneGraph'

/** Sources (or destinations) listed in the panel; the header counts them all. */
const TOP_SOURCES = 5

/** What a map panel charts: a zone (the flows logged in it) or a guest (its events in the orchestrator's memory). */
export type TrafficSelection = { kind: 'zone'; zone: MicrosegZone } | { kind: 'guest'; type: GuestType; vmid: number; ips: readonly string[] }

/** The direction of a panel's chart, remembered per browser for every panel. */
export const PANEL_DIRECTION_KEY = 'proxcenter.microseg.panelDirection'
const DIRECTIONS: readonly TimelineDirection[] = ['in', 'out']

/**
 * The traffic over time of a map panel's selection, the Dashboard's chart filtered on it: for a zone the persisted
 * history of the range (the ring asked with `zone=` when the history is not served), stacked by source zone; for a
 * guest the events of its VMID in the ring. Inbound (by source zone) or outbound (the flows it emitted, by destination
 * zone), remembered per browser. Also the same over every verdict, for the summary and the top sources. The range is
 * the Dashboard's, remembered per browser. `enabled` false reads nothing (its sections are folded). No Proxmox call.
 */
export function useSelectionTraffic(connectionId: string, zones: MicrosegZone[], selection: TrafficSelection, enabled = true) {
  const [verdict, setVerdict] = useState<TimelineVerdict>('all')
  const [range, setRange] = useTimelineRange()
  const [direction, setDirection] = useStoredChoice<TimelineDirection>(PANEL_DIRECTION_KEY, DIRECTIONS, 'in')
  const slices = useMemo(() => zoneSeries(zones), [zones])
  const guestType = selection.kind === 'guest' ? selection.type : null
  const guestVmid = selection.kind === 'guest' ? selection.vmid : null
  const guestIps = selection.kind === 'guest' ? selection.ips.map(bareIp).sort().join(',') : ''
  // A guest: inbound, the events it logged (its VMID); outbound, the events whose source is one of its addresses.
  const keep = useMemo(() => {
    if (guestVmid === null) return null
    if (direction === 'in') return (e: MicrosegEvent) => e.vmid === guestVmid && e.type === guestType
    const mine = new Set(guestIps ? guestIps.split(',') : [])
    return (e: MicrosegEvent) => mine.has(bareIp(e.src_ip))
  }, [guestType, guestVmid, guestIps, direction])
  const zone = selection.kind === 'zone' ? selection.zone : null
  const { timeline, build, answer, rangeLock } = useTrafficTimeline({
    connection: enabled ? connectionId : null, zones, slices, groupBy: direction === 'in' ? 'zone' : 'dstzone', verdict, range, zone, keep,
  })
  const summary = useMemo(() => {
    const all = build('all')
    const ranked = topSources(all, Number.POSITIVE_INFINITY)
    return { total: all.total, top: ranked.slice(0, TOP_SOURCES), count: ranked.length, wouldBlock: build('would_block').total, blocked: build('blocked').total }
  }, [build])
  let phase: BlockPhase = 'loading'
  if (answer.data) phase = 'ready'
  else if (answer.error) phase = 'unavailable'
  return { timeline, summary, phase, rangeLock, verdict, setVerdict, range, setRange, direction, setDirection, memoryOnly: !!keep }
}

export type SelectionTrafficState = ReturnType<typeof useSelectionTraffic>

/** The compact chart of a panel section (its header is the title): verdict toggle, range chips for a zone. */
export function SelectionTrafficChart({ traffic, emptyText }: { traffic: SelectionTrafficState; emptyText?: string }) {
  // Nothing in any verdict: no verdict to pick (a verdict that empties the chart keeps its toggle to go back).
  const nothing = traffic.phase === 'ready' && traffic.summary.total === 0
  return (
    <TrafficTimeline
      emptyText={emptyText}
      hideVerdict={nothing}
      compact
      phase={traffic.phase}
      timeline={traffic.timeline}
      verdict={traffic.verdict}
      onVerdict={traffic.setVerdict}
      range={traffic.range}
      onRange={traffic.setRange}
      rangeLock={traffic.rangeLock}
      showRange={!traffic.memoryOnly}
      direction={traffic.direction}
      onDirection={traffic.setDirection}
    />
  )
}

/** One line under the zone's chart: hits of the range, the top source and its share, would be blocked vs blocked. */
export function TrafficSummaryLine({ traffic }: { traffic: SelectionTrafficState }) {
  const t = useTranslations('microsegPilot.overview.sections')
  const nameOf = useSliceName()
  if (traffic.phase !== 'ready') return null
  const { total, top, wouldBlock, blocked } = traffic.summary
  const key = traffic.direction === 'out' ? 'summaryOut' : 'summary'
  const text = total > 0 && top[0]
    ? t(key, { hits: total, source: nameOf(top[0]), share: Math.round(top[0].share), wouldBlock, blocked })
    : t('summaryNone')
  return (
    <Tooltip title={text}>
      <Typography variant='body2' color='text.secondary' noWrap data-testid='traffic-summary' sx={{ mt: 1 }}>{text}</Typography>
    </Tooltip>
  )
}

/** The busiest sources of the zone over the range: dot, name, hits, share; one line each. */
export function TopSourcesList({ top, phase, outbound = false }: { top: SourceTotal[]; phase: BlockPhase; outbound?: boolean }) {
  const t = useTranslations('microsegPilot.overview.sections')
  const format = useFormatter()
  const nameOf = useSliceName()
  if (phase !== 'ready') return null
  if (!top.length) return <Typography variant='body2' color='text.disabled'>{t(outbound ? 'topDestinationsEmpty' : 'topSourcesEmpty')}</Typography>
  return (
    <Box role='list'>
      {top.map(s => (
        <Box role='listitem' key={s.key} data-source={s.key} sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 28, minWidth: 0 }}>
          <Box sx={objectDotSx(s.color)} />
          <Tooltip title={nameOf(s)}><Typography noWrap sx={{ flex: '1 1 0', minWidth: 0 }}>{nameOf(s)}</Typography></Tooltip>
          <Typography variant='body2' sx={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{format.number(s.hits)}</Typography>
          <Typography variant='caption' color='text.secondary' sx={{ flexShrink: 0, width: 40, textAlign: 'right' }}>{`${Math.round(s.share)}%`}</Typography>
        </Box>
      ))}
    </Box>
  )
}
