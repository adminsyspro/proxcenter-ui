'use client'

import { useContext, useMemo, useState } from 'react'
import { Alert, Box, Chip, Collapse, IconButton, Tooltip, Typography } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import type { MicrosegFlow, MicrosegSuggestion, MicrosegZone, SuggestionAction } from '@/lib/microseg/types'
import { serviceTitle, serviceTokensTitle } from '@/lib/network/serviceNames'

import { OneLine } from './dialogParts'
import EgressChip, { useZoneEgress } from './EgressChip'
import ExpandDialog, { withCount, type DataTab } from './ExpandDialog'
import { MapNamesContext, isSampled, observedHits, type EdgeT } from './FlowEdge'
import { flowService } from './FlowSummary'
import { DirectionGlyph, ObservedKindGlyph, ResolveActions, outboundZoneAcceptTip, ServiceHits, useResolveSuggestions } from './observationParts'
import { destinationName } from './ObservationRow'
import { newPairFlow, pairEventFilter, pairFlows, pairSuggestions, trafficPairOf, type PairEnd } from './pairModel'
import PanelSection, { PanelFrame, usePanelSection } from './PanelSection'
import { PagedList } from './PolicyPager'
import { SelectionTrafficChart, TrafficSummaryLine, useSelectionTraffic } from './SelectionTraffic'
import { formatWhen } from './summaryModel'
import TruncatedText from './TruncatedText'
import type { ZoneEdits } from './useZoneEdits'
import { bareIp, type MapEdgeKind, type PanelEdgeData } from './zoneGraph'
import { FlowsList, NewFlowButton, useFlowEditor } from './ZonePanelActions'

const ROWS_PER_PAGE = 5

type Props = {
  source: string
  target: string
  data: PanelEdgeData
  /** The names of the two ends ("web-1 (web)", "web", "Unknown / External"). */
  from: string
  to: string
  /** The two ends as zones (or boundaries): the pair the panel is about. */
  src: PairEnd
  dst: PairEnd
  zonesById: Map<string, MicrosegZone>
  /** Every flow of the draft, and every pending observed flow the map holds. */
  flows: MicrosegFlow[]
  suggestions: MicrosegSuggestion[]
  unapplied: ReadonlySet<string> | null
  edits: ZoneEdits
  connectionId: string
  version: number
  reloadPolicy: () => Promise<unknown>
  reloadSuggestions: () => Promise<unknown>
  onResolved: (action: SuggestionAction) => void
  onClose: () => void
  onEdit: () => void
  /** The map read only the first `limit` pending observed flows: the suggestions may miss some. */
  partialLimit?: number | null
  /** The guest name of each address the inventory knows, to name the destination of an outbound row. */
  peers?: ReadonlyMap<string, string>
}

/** The look of the pair's status chip: the edge legend's wording, coloured as the map draws it. */
const STATUS_LOOK: Record<MapEdgeKind, { color: 'success' | 'error' | 'info' | 'default'; icon: string; legend: string }> = {
  allowed: { color: 'success', icon: 'ri-checkbox-circle-line', legend: 'allowed' },
  outside: { color: 'default', icon: 'ri-cloud-line', legend: 'allowed' },
  unprotected: { color: 'error', icon: 'ri-error-warning-line', legend: 'unprotected' },
  blocked: { color: 'info', icon: 'ri-forbid-line', legend: 'blocked' },
}

function PairStatusChip({ kind }: { kind: MapEdgeKind }) {
  const t = useTranslations('microsegPilot.overview.legend')
  const look = STATUS_LOOK[kind]
  return <Chip size='small' variant='outlined' color={look.color} icon={<i className={look.icon} style={{ fontSize: 14 }} />} label={t(look.legend)} sx={{ flexShrink: 0 }} />
}

const END_ICON: Record<Exclude<PairEnd['kind'], 'zone'>, string> = {
  external: 'ri-global-line', outside: 'ri-cloud-line', unzoned: 'ri-checkbox-blank-circle-line', ip: 'ri-map-pin-line',
}

function EndName({ end }: { end: PairEnd }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0, flex: '0 1 auto' }}>
      {end.zone
        ? <i className='ri-shield-fill' style={{ fontSize: 18, color: end.zone.color || undefined, flexShrink: 0 }} />
        : <i className={END_ICON[end.kind as Exclude<PairEnd['kind'], 'zone'>]} style={{ fontSize: 18, flexShrink: 0, opacity: 0.8 }} />}
      <TruncatedText text={end.name} fontWeight={600} sx={{ minWidth: 24 }} />
    </Box>
  )
}

/** The two ends of the pair on one line: icon and name of the source, an arrow, icon and name of the destination. */
function PairEnds({ src, dst }: { src: PairEnd; dst: PairEnd }) {
  return (
    <Box data-testid='pair-ends' sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, flex: '1 1 0' }}>
      <EndName end={src} />
      <i className='ri-arrow-right-line' aria-hidden style={{ flexShrink: 0, opacity: 0.7 }} />
      <EndName end={dst} />
    </Box>
  )
}

function ObservedRow({ s, example, zonesById, peers, busy, onResolve }: {
  s: MicrosegSuggestion
  /** "Example: web-1 → db-1" when the edge is drawn between guests. */
  example: string | null
  zonesById: Map<string, MicrosegZone>
  peers?: ReadonlyMap<string, string>
  busy: boolean
  onResolve: (action: SuggestionAction, prefixLen?: number) => void
}) {
  const t = useTranslations('microsegPilot.overview')
  const to = useTranslations('microsegPilot.observation')
  const tp = useTranslations('microsegPilot.policy')
  const te = useTranslations('microsegPilot.overview.edge')
  const names = useContext(MapNamesContext)
  const format = useFormatter()
  const [open, setOpen] = useState(false)
  const when = (iso: string) => formatWhen(format, iso)
  const service = serviceTitle(s.proto, s.dport)
  const zoneName = (id: string) => zonesById.get(id)?.name ?? to('deletedZone')
  const source = s.src_zone_id ? zoneName(s.src_zone_id) : s.src_ip || to('unknownEndpoint')
  // The destination of an outbound row may be an address, a guest or many destinations.
  const destination = destinationName(s, zonesById, ip => peers?.get(bareIp(ip)), to as (key: string) => string)
  const accept = t('flowPanel.acceptAs', { from: s.src_zone_id ? source : to('unknownEndpoint'), to: destination, service })
  const hitsNames = { ...names, zone: (id: string) => (id ? zoneName(id) : destination) }

  return (
    <Box role='listitem' aria-label={to('rowLabel', { source, destination })} data-suggestion={s.id} sx={{ borderBottom: 1, borderColor: 'divider', minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minHeight: 36, minWidth: 0 }}>
        <IconButton size='small' aria-expanded={open} aria-label={open ? tp('hideDetails') : tp('showDetails')} onClick={() => setOpen(v => !v)}>
          <i className={open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} />
        </IconButton>
        <DirectionGlyph direction={s.direction} />
        <ObservedKindGlyph kind={s.kind} />
        <TruncatedText text={`${source} → ${destination}`} fontWeight={600} sx={{ flex: '1 1 0', minWidth: 0 }} />
        <ServiceHits suggestion={s} />
        <ResolveActions suggestion={s} busy={busy} onResolve={onResolve} acceptLabel={accept} acceptTip={outboundZoneAcceptTip(to, s, source, destination)} />
      </Box>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ pl: 5, pb: 1, minWidth: 0 }}>
          <OneLine text={observedHits(te as EdgeT, hitsNames, s, to('unknownEndpoint'), example !== null)} />
          {example && <OneLine text={example} />}
          <OneLine text={t('flowPanel.addresses', { from: s.src_ip || to('unknownEndpoint'), to: s.dst_ip || to('unknownEndpoint') })} />
          <OneLine text={to('detail.firstSeen', { time: when(s.first_seen) })} />
          <OneLine text={to('detail.lastSeen', { time: when(s.last_seen) })} />
          <OneLine text={t('flowPanel.status', { status: to(`status.${s.status}`) })} />
        </Box>
      </Collapse>
    </Box>
  )
}

/**
 * The pair clicked on the map (an edge, a cell of the matrix, a ribbon of the Sankey diagram), laid out as the zone
 * panel: the two ends with the pair's status (and the source zone's outbound state), then foldable sections: the
 * observed traffic between them (the zone chart restricted to the pair, inbound as the destination logged it, outbound
 * as the source logged it), the pending suggestions of the pair (one line each, details under the chevron, resolved as
 * in Observation; a 409 re-reads the draft and the list) and the flows declared between them, editable in place. The
 * same content opens in a dialog (Expand) with the pair's events.
 */
export default function EdgePanel({
  source, target, data, from, to, src, dst, zonesById, flows, suggestions, unapplied, edits,
  connectionId, version, reloadPolicy, reloadSuggestions, onResolved, onClose, onEdit, partialLimit = null, peers,
}: Props) {
  const t = useTranslations('microsegPilot.overview')
  const tz = useTranslations('microsegPilot.overview.zonePanel')
  const te = useTranslations('microsegPilot.overview.edgePanel')
  const tsec = useTranslations('microsegPilot.overview.sections')
  const tt = useTranslations('microsegPilot.overview.target.panel')
  const names = useContext(MapNamesContext)
  const zones = useMemo(() => [...zonesById.values()], [zonesById])
  const observedKind = data.kind === 'unprotected' || data.kind === 'blocked'
  const tokens = [...new Set([...data.flows, ...data.observed].map(f => flowService(f)))].sort()
  const servicesTip = tokens.length ? serviceTokensTitle(tokens) : data.label
  const example = observedKind && isSampled(source, target) ? t('edge.example', { from: names.short(source), to: names.short(target) }) : null
  // The ends are rebuilt on every render of the map: the lists are cheap (the pending flows the map holds, the draft's flows).
  const pending = pairSuggestions(data.observed, suggestions, src, dst)
  const declared = pairFlows(flows, src, dst, data.flows)
  const pair = trafficPairOf(src, dst)
  const egress = useZoneEgress(src.zone, suggestions, edits.readyAfterHours, partialLimit !== null)
  const showEgress = !!src.zone && (dst.kind === 'outside' || egress.state !== 'off')
  const trafficSection = usePanelSection('edge.traffic')
  const traffic = useSelectionTraffic(connectionId, zones, { kind: 'pair', ...pair }, trafficSection[0])
  const editor = useFlowEditor(edits)
  const initial = newPairFlow(src, dst)
  const { busy, failure, clearFailure, resolve: resolveIds } = useResolveSuggestions(connectionId, version, reloadPolicy, reloadSuggestions)
  const [expanded, setExpanded] = useState(false)

  async function resolve(id: string, action: SuggestionAction, prefixLen?: number) {
    const outcome = await resolveIds([id], action, prefixLen)
    if (outcome?.resolved) onResolved(action)
  }

  const chips = (
    <>
      <PairStatusChip kind={data.kind} />
      {showEgress && <EgressChip state={egress.state} ready={egress.ready} />}
    </>
  )
  const header = (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <PairEnds src={src} dst={dst} />
        <IconButton size='small' aria-label={tz('expand')} onClick={() => setExpanded(true)}><i className='ri-fullscreen-line' /></IconButton>
        <IconButton size='small' aria-label={t('panel.close')} onClick={onClose}><i className='ri-close-line' /></IconButton>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, mt: 1 }}>
        {chips}
        <TruncatedText text={data.label} title={servicesTip} variant='body2' color='text.secondary' sx={{ flex: '1 1 0', minWidth: 0 }} />
        <Tooltip title={t('panel.editInPolicy')}>
          <IconButton size='small' aria-label={t('panel.editInPolicy')} onClick={onEdit}><i className='ri-pencil-line' /></IconButton>
        </Tooltip>
      </Box>
    </>
  )

  const trafficBody = (
    <>
      <SelectionTrafficChart traffic={traffic} />
      <TrafficSummaryLine traffic={traffic} />
    </>
  )
  const suggestionsBody = (size = ROWS_PER_PAGE) => (
    <>
      {failure && <Alert severity='error' onClose={clearFailure} sx={{ mb: 1 }}>{failure}</Alert>}
      {partialLimit !== null && <OneLine text={tt('partial', { count: partialLimit })} />}
      {example && <OneLine text={example} />}
      {example && <OneLine text={t('flowPanel.sampleNote')} />}
      {pending.length === 0 && <Typography variant='body2' color='text.disabled'>{te('suggestionsEmpty')}</Typography>}
      <PagedList items={pending} size={size} render={rows => (
        <Box role='list'>
          {rows.map(s => (
            <ObservedRow key={s.id} s={s} example={example} zonesById={zonesById} peers={peers} busy={busy} onResolve={(action, prefixLen) => { void resolve(s.id, action, prefixLen) }} />
          ))}
        </Box>
      )} />
    </>
  )
  const newFlow = initial ? <NewFlowButton label={te('newFlow')} onClick={() => editor.create(initial)} /> : undefined
  const flowsBody = (size = ROWS_PER_PAGE) => <FlowsList flows={declared} zonesById={zonesById} editor={editor} size={size} unapplied={unapplied} />

  const dataTabs: DataTab[] = [
    { id: 'suggestions', label: withCount(tz('subSuggestions'), pending.length), content: suggestionsBody },
    { id: 'flows', label: withCount(te('declaredFlows'), declared.length), action: newFlow, content: flowsBody },
  ]

  return (
    <PanelFrame label={t('flowPanel.label', { from, to })} width={400} header={header}>
      <PanelSection id='edge.traffic' title={tsec('traffic')} state={trafficSection}>{trafficBody}</PanelSection>
      <PanelSection id='edge.suggestions' title={tsec('suggestions')} count={pending.length}>{suggestionsBody()}</PanelSection>
      <PanelSection id='edge.flows' title={te('declaredFlows')} count={declared.length} action={newFlow}>{flowsBody()}</PanelSection>
      {editor.dialogs}
      {expanded && (
        <ExpandDialog
          scope={{
            label: te('dialogLabel', { from: src.name, to: dst.name }),
            title: te('detailsTitle'),
            subtitle: <PairEnds src={src} dst={dst} />,
            chips,
            keepEvent: pairEventFilter(pair),
            logsEmpty: te('logsEmpty'),
          }}
          connectionId={connectionId}
          traffic={trafficBody}
          dataTabs={dataTabs}
          onClose={() => setExpanded(false)}
        />
      )}
    </PanelFrame>
  )
}
