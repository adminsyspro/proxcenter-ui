'use client'

import { useMemo, useState } from 'react'
import { Box, Tooltip, Typography } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import type { GuestType, MicrosegEvent, MicrosegZone } from '@/lib/microseg/types'

import type { BlockPhase } from '../dashboardModel'
import { zoneSeries } from '../dashboardPosture'
import { alignTimelines, topSources, type PostureTimeline, type SourceTotal, type TimelineVerdict } from '../postureTimeline'
import TrafficTimeline, { type TimelineDirection } from '../TrafficTimeline'
import { useSliceName } from '../TrafficByZone'
import { useTimelineRange } from '../useTimelineRange'
import { useTrafficTimeline } from '../useTrafficTimeline'
import { objectDotSx } from './objectColour'
import { useStoredChoice } from './useStoredChoice'
import { bareIp } from './zoneGraph'
import TruncatedText from './TruncatedText'

/** Sources (or destinations) listed in the panel; the header counts them all. */
const TOP_SOURCES = 5

/** What a map panel charts: a zone (the flows logged in it) or a guest (its events in the orchestrator's memory). */
export type TrafficSelection = { kind: 'zone'; zone: MicrosegZone } | { kind: 'guest'; type: GuestType; vmid: number; ips: readonly string[] }

/** The direction of a panel's chart, remembered per browser for every panel. */
export const PANEL_DIRECTION_KEY = 'proxcenter.microseg.panelDirection'
const DIRECTIONS: readonly TimelineDirection[] = ['both', 'in', 'out']

/**
 * The traffic over time of a map panel's selection, the Dashboard's chart filtered on it: for a zone the persisted
 * history of the range (the ring asked with `zone=` when the history is not served), stacked by source zone; for a
 * guest the events of its VMID in the ring. Inbound (by source zone) or outbound (the flows it emitted, by destination
 * zone), remembered per browser. Also the same over every verdict, for the summary and the top sources. The range is
 * the Dashboard's, remembered per browser. `enabled` false reads nothing (its sections are folded). No Proxmox call.
 */
/** One direction's figures over every verdict: its total, its ranked groups, would be blocked and blocked. */
function summaryOf(build: (v: TimelineVerdict) => PostureTimeline) {
  const all = build('all')
  return { total: all.total, ranked: topSources(all, Number.POSITIVE_INFINITY), wouldBlock: build('would_block').total, blocked: build('blocked').total }
}

/** A group of the Top list, with the direction it was seen in (Both mode lists sources and destinations together). */
export type TopEntry = SourceTotal & { dir: 'in' | 'out' }

export function useSelectionTraffic(connectionId: string, zones: MicrosegZone[], selection: TrafficSelection, enabled = true) {
  const [verdict, setVerdict] = useState<TimelineVerdict>('all')
  const [range, setRange] = useTimelineRange()
  const [direction, setDirection] = useStoredChoice<TimelineDirection>(PANEL_DIRECTION_KEY, DIRECTIONS, 'both')
  const slices = useMemo(() => zoneSeries(zones), [zones])
  const guestType = selection.kind === 'guest' ? selection.type : null
  const guestVmid = selection.kind === 'guest' ? selection.vmid : null
  const guestIps = selection.kind === 'guest' ? selection.ips.map(bareIp).sort().join(',') : ''
  // A guest: inbound, the events it logged (its VMID); outbound, the events whose source is one of its addresses.
  const keepIn = useMemo(() => (guestVmid === null ? null : (e: MicrosegEvent) => e.vmid === guestVmid && e.type === guestType), [guestType, guestVmid])
  const keepOut = useMemo(() => {
    if (guestVmid === null) return null
    const mine = new Set(guestIps ? guestIps.split(',') : [])
    return (e: MicrosegEvent) => mine.has(bareIp(e.src_ip))
  }, [guestVmid, guestIps])
  const zone = selection.kind === 'zone' ? selection.zone : null
  const connection = enabled ? connectionId : null
  // Both directions are read: the same history answer, or the ring the panel holds (inbound of a zone asks `zone=`).
  const inbound = useTrafficTimeline({ connection, zones, slices, groupBy: 'zone', verdict, range, zone, keep: keepIn })
  const outbound = useTrafficTimeline({ connection, zones, slices, groupBy: 'dstzone', verdict, range, zone, keep: keepOut })
  const inSummary = useMemo(() => summaryOf(inbound.build), [inbound.build])
  const outSummary = useMemo(() => summaryOf(outbound.build), [outbound.build])
  const aligned = useMemo(() => alignTimelines(inbound.timeline, outbound.timeline), [inbound.timeline, outbound.timeline])

  const both = direction === 'both'
  const one = direction === 'out' ? outSummary : inSummary
  const top: TopEntry[] = both
    ? [...inSummary.ranked.map(s => ({ ...s, dir: 'in' as const })), ...outSummary.ranked.map(s => ({ ...s, dir: 'out' as const }))]
      .sort((x, y) => y.hits - x.hits || (x.dir < y.dir ? -1 : 1))
    : one.ranked.map(s => ({ ...s, dir: direction === 'out' ? 'out' as const : 'in' as const }))
  const summary = {
    total: both ? inSummary.total + outSummary.total : one.total,
    top: top.slice(0, TOP_SOURCES),
    count: top.length,
    wouldBlock: one.wouldBlock,
    blocked: one.blocked,
    inbound: inSummary,
    outbound: outSummary,
  }
  let timeline = inbound.timeline
  if (both) timeline = aligned.above
  else if (direction === 'out') timeline = outbound.timeline
  const answer = direction === 'out' ? outbound.answer : inbound.answer
  let phase: BlockPhase = 'loading'
  if (answer.data) phase = 'ready'
  else if (answer.error) phase = 'unavailable'
  // Empty one way, traffic the other: the panel says so (none in Both).
  let otherTotal = 0
  if (direction === 'in') otherTotal = outSummary.total
  else if (direction === 'out') otherTotal = inSummary.total
  return {
    timeline, mirror: both ? aligned.below : null, summary, phase, rangeLock: inbound.rangeLock, verdict, setVerdict, range, setRange,
    direction, setDirection, memoryOnly: guestVmid !== null, otherTotal,
  }
}

export type SelectionTrafficState = ReturnType<typeof useSelectionTraffic>

/** The compact chart of a panel section (its header is the title): verdict toggle, range chips for a zone. */
export function SelectionTrafficChart({ traffic, emptyText }: { traffic: SelectionTrafficState; emptyText?: string }) {
  const t = useTranslations('microsegPilot.overview.sections')
  // Nothing in any verdict: no verdict to pick (a verdict that empties the chart keeps its toggle to go back).
  const nothing = traffic.phase === 'ready' && traffic.summary.total === 0
  // Empty this way, traffic the other way: say so, with a way to it.
  const inbound = traffic.direction === 'in'
  const hint = nothing && traffic.otherTotal > 0
  const text = hint ? t(inbound ? 'emptyInboundHint' : 'emptyOutboundHint', { count: traffic.otherTotal }) : emptyText
  const action = hint ? { label: t(inbound ? 'showOutbound' : 'showInbound'), onClick: () => traffic.setDirection(inbound ? 'out' : 'in') } : undefined
  return (
    <TrafficTimeline
      emptyText={text}
      emptyAction={action}
      mirror={traffic.mirror}
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
  let text: string
  if (traffic.direction === 'both') {
    const side = (part: typeof traffic.summary.inbound, plain: string, withTop: string) => {
      const first = part.ranked[0]
      return part.total > 0 && first
        ? t(withTop, { count: part.total, source: nameOf(first), share: Math.round(first.share) })
        : t(plain, { count: part.total })
    }
    text = `${side(traffic.summary.inbound, 'summaryBothIn', 'summaryBothInTop')} · ${side(traffic.summary.outbound, 'summaryBothOut', 'summaryBothOutTop')}`
  } else {
    const { total, top, wouldBlock, blocked } = traffic.summary
    const key = traffic.direction === 'out' ? 'summaryOut' : 'summary'
    text = total > 0 && top[0]
      ? t(key, { hits: total, source: nameOf(top[0]), share: Math.round(top[0].share), wouldBlock, blocked })
      : t('summaryNone')
  }
  return (
    <Tooltip title={text}>
      <Typography variant='body2' color='text.secondary' noWrap data-testid='traffic-summary' sx={{ mt: 1 }}>{text}</Typography>
    </Tooltip>
  )
}

const EMPTY_KEY: Record<TimelineDirection, string> = { both: 'topBothEmpty', in: 'topSourcesEmpty', out: 'topDestinationsEmpty' }
/** The title of the Top section in each direction. */
export const TOP_TITLE: Record<TimelineDirection, string> = { both: 'topBoth', in: 'topSources', out: 'topDestinations' }

/**
 * The busiest sources (inbound), destinations (outbound) or both of the zone over the range: dot, name, hits, share;
 * one line each. Both: a glyph tells the direction (into the zone from a source, from the zone to a destination).
 */
export function TopSourcesList({ top, phase, mode = 'in' }: { top: TopEntry[]; phase: BlockPhase; mode?: TimelineDirection }) {
  const t = useTranslations('microsegPilot.overview.sections')
  const format = useFormatter()
  const nameOf = useSliceName()
  if (phase !== 'ready') return null
  if (!top.length) return <Typography variant='body2' color='text.disabled'>{t(EMPTY_KEY[mode])}</Typography>
  const both = mode === 'both'
  return (
    <Box role='list'>
      {top.map(s => {
        const name = nameOf(s)
        const where = s.dir === 'in' ? t('fromInto', { name }) : t('toFrom', { name })
        return (
          <Box role='listitem' key={`${s.dir}:${s.key}`} data-source={both ? `${s.dir}:${s.key}` : s.key} sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 28, minWidth: 0 }}>
            {both && (
              <Tooltip title={where}>
                <i className={s.dir === 'in' ? 'ri-arrow-right-down-line' : 'ri-arrow-right-up-line'} aria-label={where} style={{ flexShrink: 0, opacity: 0.8 }} />
              </Tooltip>
            )}
            <Box sx={objectDotSx(s.color)} />
            <TruncatedText text={name} title={both ? where : name} sx={{ flex: '1 1 0', minWidth: 0 }} />
            <Typography variant='body2' sx={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{format.number(s.hits)}</Typography>
            <Typography variant='caption' color='text.secondary' sx={{ flexShrink: 0, width: 40, textAlign: 'right' }}>{`${Math.round(s.share)}%`}</Typography>
          </Box>
        )
      })}
    </Box>
  )
}
