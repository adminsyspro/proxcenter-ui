'use client'

import { useMemo, useState } from 'react'
import { Box, Tooltip, Typography } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import type { GuestType, MicrosegEvent, MicrosegZone } from '@/lib/microseg/types'

import type { BlockPhase } from '../dashboardModel'
import { zoneSeries } from '../dashboardPosture'
import { topSources, type SourceTotal, type TimelineVerdict } from '../postureTimeline'
import TrafficTimeline from '../TrafficTimeline'
import { useSliceName } from '../TrafficByZone'
import { useTimelineRange } from '../useTimelineRange'
import { useTrafficTimeline } from '../useTrafficTimeline'
import { objectDotSx } from './objectColour'

/** What a map panel charts: a zone (the flows logged in it) or a guest (its events in the orchestrator's memory). */
export type TrafficSelection = { kind: 'zone'; zone: MicrosegZone } | { kind: 'guest'; type: GuestType; vmid: number }

/**
 * The traffic over time of a map panel's selection, the Dashboard's chart filtered on it: for a zone the persisted
 * history of the range (the ring asked with `zone=` when the history is not served), stacked by source zone; for a
 * guest the events of its VMID in the ring. Also the same over every verdict, for the summary and the top sources.
 * The range is the Dashboard's, remembered per browser. No Proxmox call.
 */
export function useSelectionTraffic(connectionId: string, zones: MicrosegZone[], selection: TrafficSelection) {
  const [verdict, setVerdict] = useState<TimelineVerdict>('all')
  const [range, setRange] = useTimelineRange()
  const slices = useMemo(() => zoneSeries(zones), [zones])
  const guestType = selection.kind === 'guest' ? selection.type : null
  const guestVmid = selection.kind === 'guest' ? selection.vmid : null
  const keep = useMemo(
    () => (guestVmid === null ? null : (e: MicrosegEvent) => e.vmid === guestVmid && e.type === guestType),
    [guestType, guestVmid],
  )
  const zone = selection.kind === 'zone' ? selection.zone : null
  const { timeline, build, answer, rangeLock } = useTrafficTimeline({ connection: connectionId, zones, slices, groupBy: 'zone', verdict, range, zone, keep })
  const summary = useMemo(() => {
    const all = build('all')
    return { total: all.total, top: topSources(all), wouldBlock: build('would_block').total, blocked: build('blocked').total }
  }, [build])
  let phase: BlockPhase = 'loading'
  if (answer.data) phase = 'ready'
  else if (answer.error) phase = 'unavailable'
  return { timeline, summary, phase, rangeLock, verdict, setVerdict, range, setRange, memoryOnly: !!keep }
}

export type SelectionTrafficState = ReturnType<typeof useSelectionTraffic>

/** The compact chart of a panel section (its header is the title): verdict toggle, range chips for a zone. */
export function SelectionTrafficChart({ traffic }: { traffic: SelectionTrafficState }) {
  return (
    <TrafficTimeline
      compact
      phase={traffic.phase}
      timeline={traffic.timeline}
      verdict={traffic.verdict}
      onVerdict={traffic.setVerdict}
      range={traffic.range}
      onRange={traffic.setRange}
      rangeLock={traffic.rangeLock}
      showRange={!traffic.memoryOnly}
    />
  )
}

/** One line under the zone's chart: hits of the range, the top source and its share, would be blocked vs blocked. */
export function TrafficSummaryLine({ traffic }: { traffic: SelectionTrafficState }) {
  const t = useTranslations('microsegPilot.overview.sections')
  const nameOf = useSliceName()
  if (traffic.phase !== 'ready') return null
  const { total, top, wouldBlock, blocked } = traffic.summary
  const text = total > 0 && top[0]
    ? t('summary', { hits: total, source: nameOf(top[0]), share: Math.round(top[0].share), wouldBlock, blocked })
    : t('summaryNone')
  return (
    <Tooltip title={text}>
      <Typography variant='body2' color='text.secondary' noWrap data-testid='traffic-summary' sx={{ mt: 1 }}>{text}</Typography>
    </Tooltip>
  )
}

/** The busiest sources of the zone over the range: dot, name, hits, share; one line each. */
export function TopSourcesList({ top, phase }: { top: SourceTotal[]; phase: BlockPhase }) {
  const t = useTranslations('microsegPilot.overview.sections')
  const format = useFormatter()
  const nameOf = useSliceName()
  if (phase !== 'ready') return null
  if (!top.length) return <Typography variant='body2' color='text.disabled'>{t('topSourcesEmpty')}</Typography>
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
