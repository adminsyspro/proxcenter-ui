'use client'

import { useMemo, useState } from 'react'
import { Alert, Box, Button, Chip, IconButton, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { StatusIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'
import { useMicrosegDrifts } from '@/lib/microseg/useMicrosegLists'
import type { MicrosegFlow, MicrosegSuggestion, MicrosegZone, SuggestionAction } from '@/lib/microseg/types'

import MicrosegErrorAlert from './MicrosegErrorAlert'
import { DirectionGlyph, ObservedKindGlyph, ResolveActions, outboundZoneAcceptTip, ServiceHits, useResolveSuggestions } from './observationParts'
import PanelSection, { PanelFrame, usePanelSection } from './PanelSection'
import { PagedList, POLICY_PAGE_SIZE } from './PolicyPager'
import { SelectionTrafficChart, TOP_TITLE, TopSourcesList, TrafficSummaryLine, useSelectionTraffic } from './SelectionTraffic'
import { MemberChangeChip } from './ZoneRow'
import EgressChip, { useZoneEgress } from './EgressChip'
import ExpandDialog, { withCount, type DataTab } from './ExpandDialog'
import ZoneStateChip from './ZoneStateChip'
import { destinationName, endpoint } from './ObservationRow'
import { useGatewayName } from './useGatewayName'
import { bareIp } from './zoneGraph'
import { ExpandAddButton, FlowsList, MemberAction, NewFlowButton, ZoneHeaderActions, useExceptionEditor, useFlowEditor } from './ZonePanelActions'
import type { ZoneEdits } from './useZoneEdits'
import { useIgnoredDrifts } from './driftIgnore'
import { OneLine } from './dialogParts'
import { flowsOfZone, guestKey, type ZoneMember } from './zoneModel'
import { zoneDriftSignals, zoneSuggestions } from './zonePanelModel'
import TruncatedText from './TruncatedText'

const FLOWS_PAGE_SIZE = 5

type Props = {
  zone: MicrosegZone
  members: ZoneMember[]
  /** False while the guest list is loading or failed. */
  membersKnown: boolean
  flows: MicrosegFlow[]
  zonesById: Map<string, MicrosegZone>
  /** The writes on the draft (zone, state, members, flows, exceptions). */
  edits: ZoneEdits
  onClose: () => void
  onAssign: () => void
  connectionId: string
  /** The draft version the suggestions are resolved against. */
  version: number
  /** The pending observed flows the map holds. */
  suggestions: MicrosegSuggestion[]
  reloadPolicy: () => Promise<unknown>
  reloadSuggestions: () => Promise<unknown>
  onResolved: (action: SuggestionAction) => void
  /** Opens the Drifts sub-tab on this zone's drifts. */
  onOpenDrifts?: (zoneId: string) => void
  /** The map read only the first `limit` pending observed flows: the suggestions may miss some. */
  partialLimit?: number | null
  /** The guest name of each address the inventory knows, to name the destination of an outbound row. */
  peers?: ReadonlyMap<string, string>
}

function MemberLine({ member, zoneId, edits, firewallOff }: { member: ZoneMember; zoneId: string; edits: ZoneEdits; firewallOff: boolean }) {
  const t = useTranslations('microsegPilot.overview.panel')
  const tsec = useTranslations('microsegPilot.overview.sections')
  const { guest, ref } = member
  const name = guest?.name ?? `${ref.type}/${ref.vmid}`
  return (
    <Box role='listitem' aria-label={name} sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, minHeight: 28 }}>
      {guest
        ? (
          <Tooltip title={guest.status === 'running' ? tsec('memberRunning') : tsec('memberStopped')}>
            <span style={{ display: 'inline-flex' }}><StatusIcon type='vm' vmType={guest.type} status={guest.status} /></span>
          </Tooltip>
        )
        : <i className='ri-question-line' style={{ opacity: 0.6 }} />}
      {firewallOff && (
        <Tooltip title={tsec('memberFirewallOff')}>
          <i className='ri-shield-flash-line' data-testid='member-firewall-off' style={{ color: 'var(--mui-palette-error-main)', flexShrink: 0 }} aria-label={tsec('memberFirewallOff')} />
        </Tooltip>
      )}
      <TruncatedText text={name} sx={{ flex: '0 1 auto' }} />
      <Typography noWrap variant='body2' color='text.secondary' sx={{ flex: '1 1 0', minWidth: 0 }}>{`${ref.vmid} · ${ref.node}`}</Typography>
      {member.pending && <Chip size='small' color='warning' variant='outlined' label={t('pending')} sx={{ flexShrink: 0 }} />}
      <MemberChangeChip member={member} />
      <MemberAction member={member} zoneId={zoneId} edits={edits} />
    </Box>
  )
}

/** A pending suggestion towards the zone on one line: kind, source, service and hits, the ways out of Observation. */
function SuggestionLine({ suggestion: s, zonesById, peers, busy, onResolve }: {
  suggestion: MicrosegSuggestion
  zonesById: Map<string, MicrosegZone>
  peers?: ReadonlyMap<string, string>
  busy: boolean
  onResolve: (action: SuggestionAction, prefixLen?: number) => void
}) {
  const to = useTranslations('microsegPilot.observation')
  const gatewayName = useGatewayName(zonesById.values())
  // The peer of an inbound row is its source, the peer of an outbound row (emitted by this zone) is its destination.
  const source = s.direction === 'out'
    ? destinationName(s, zonesById, ip => peers?.get(bareIp(ip)) ?? gatewayName(ip), to as (key: string) => string)
    : endpoint(s.src_zone_id, s.src_ip, zonesById, to as (key: string) => string, gatewayName)
  return (
    <Box role='listitem' aria-label={source} data-suggestion={s.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minHeight: 36, minWidth: 0, borderBottom: 1, borderColor: 'divider' }}>
      <DirectionGlyph direction={s.direction} />
      <ObservedKindGlyph kind={s.kind} />
      <TruncatedText text={source} fontWeight={600} sx={{ flex: '1 1 0', minWidth: 0 }} />
      <ServiceHits suggestion={s} />
      <ResolveActions suggestion={s} busy={busy} onResolve={onResolve} acceptTip={outboundZoneAcceptTip(to, s, s.src_zone_id ? zonesById.get(s.src_zone_id)?.name ?? to('deletedZone') : s.src_ip || to('unknownEndpoint'), s.dst_zone_id ? zonesById.get(s.dst_zone_id)?.name ?? to('deletedZone') : '')} />
    </Box>
  )
}

type WorkProps = Omit<Props, 'onClose'> & {
  /** The member errors show here; the Policy sub-tab says them above its zones already. */
  memberErrors?: boolean
}

/**
 * What the zone panel shows, shared by the panel of the map and the details of a zone card on the Policy sub-tab: the
 * observed traffic and its top sources, then the pending suggestions, the members, the exceptions and the flows in
 * and out, all editable in place, with the bodies again for the expanded dialog.
 */
export function useZoneWork({
  zone, members, membersKnown, flows, zonesById, edits, onAssign,
  connectionId, version, suggestions, reloadPolicy, reloadSuggestions, onResolved, partialLimit = null, peers, memberErrors = true,
}: WorkProps) {
  const t = useTranslations('microsegPilot.overview.panel')
  const tz = useTranslations('microsegPilot.overview.zonePanel')
  const tsec = useTranslations('microsegPilot.overview.sections')
  const ts = useTranslations('microsegPilot.policy.zone')
  const tt = useTranslations('microsegPilot.overview.target.panel')
  const te = useTranslations('microsegPilot.policy.exceptions')
  const editor = useFlowEditor(edits)
  const exceptions = useExceptionEditor(edits, zone, members, membersKnown)
  const { incoming, outgoing } = flowsOfZone(zone.id, flows)
  const zones = useMemo(() => [...zonesById.values()], [zonesById])
  // The map reads every pending observed flow, outbound ones included: the readiness needs no read of its own, unless that read was cut (partialLimit).
  const { state: egress, ready: egressReady } = useZoneEgress(zone, suggestions, edits.readyAfterHours, partialLimit !== null)
  const trafficSection = usePanelSection('zone.traffic')
  const sourcesSection = usePanelSection('zone.sources')
  // Nothing is read for the chart while both sections it feeds are folded.
  const traffic = useSelectionTraffic(connectionId, zones, { kind: 'zone', zone }, trafficSection[0] || sourcesSection[0])
  const { data: drifts } = useMicrosegDrifts(connectionId, { once: true })
  const { ignored } = useIgnoredDrifts(connectionId)
  const signals = useMemo(
    () => zoneDriftSignals(zone, members, drifts?.computed ? drifts.drifts : null, zones, ignored),
    [zone, members, drifts, zones, ignored],
  )
  const pending = useMemo(() => zoneSuggestions(suggestions, zone.id), [suggestions, zone.id])
  const { busy, failure, clearFailure, resolve } = useResolveSuggestions(connectionId, version, reloadPolicy, reloadSuggestions)

  async function resolveOne(id: string, action: SuggestionAction, prefixLen?: number) {
    const outcome = await resolve([id], action, prefixLen)
    if (outcome?.resolved) onResolved(action)
  }

  const trafficSections = (
    <>
      <PanelSection id='zone.traffic' title={tsec('traffic')} state={trafficSection}>
        <SelectionTrafficChart traffic={traffic} />
        <TrafficSummaryLine traffic={traffic} />
      </PanelSection>

      <PanelSection
        id='zone.sources'
        title={tsec(TOP_TITLE[traffic.direction])}
        count={traffic.phase === 'ready' ? traffic.summary.count : null}
        state={sourcesSection}
      >
        <TopSourcesList top={traffic.summary.top} phase={traffic.phase} mode={traffic.direction} />
      </PanelSection>

    </>
  )

  const suggestionsBody = (size = FLOWS_PAGE_SIZE) => (
    <>
      {failure && <Alert severity='error' onClose={clearFailure} sx={{ mb: 1 }}>{failure}</Alert>}
      {partialLimit !== null && <OneLine text={tt('partial', { count: partialLimit })} />}
      {pending.length === 0 && <Typography variant='body2' color='text.disabled'>{tsec('suggestionsEmpty')}</Typography>}
      <PagedList items={pending} size={size} render={rows => (
        <Box role='list'>
          {rows.map(s => (
            <SuggestionLine key={s.id} suggestion={s} zonesById={zonesById} peers={peers} busy={busy} onResolve={(action, prefixLen) => { void resolveOne(s.id, action, prefixLen) }} />
          ))}
        </Box>
      )} />
    </>
  )
  const membersBody = (size = POLICY_PAGE_SIZE) => (
    <>
      {memberErrors && edits.memberError != null && <MicrosegErrorAlert error={edits.memberError} onClose={edits.clearMemberError} />}
      {!membersKnown && <Typography variant='body2' color='text.disabled'>{t('membersUnknown')}</Typography>}
      {membersKnown && members.length === 0 && <Typography variant='body2' color='text.disabled'>{t('noMembers')}</Typography>}
      <PagedList items={members} size={size} render={rows => (
        <Box role='list'>
          {rows.map(m => <MemberLine key={`${m.ref.type}/${m.ref.vmid}`} member={m} zoneId={zone.id} edits={edits} firewallOff={!!signals?.firewallOff.has(guestKey(m.ref))} />)}
        </Box>
      )} />
    </>
  )
  const newIncoming = <NewFlowButton label={tz('newIncoming')} onClick={() => editor.create({ dst_zone_id: zone.id })} />
  const newOutgoing = <NewFlowButton label={tz('newOutgoing')} onClick={() => editor.create({ src_zone_id: zone.id })} />
  const newException = <NewFlowButton label={te('add')} onClick={exceptions.create} />
  const exceptionsBody = (size = FLOWS_PAGE_SIZE) => exceptions.list(size)
  const incomingBody = (size = FLOWS_PAGE_SIZE) => <FlowsList flows={incoming} zonesById={zonesById} editor={editor} size={size} />
  const outgoingBody = (size = FLOWS_PAGE_SIZE) => <FlowsList flows={outgoing} zonesById={zonesById} editor={editor} size={size} />

  const dataSections = (
    <>
      <PanelSection id='zone.suggestions' title={tsec('suggestions')} count={pending.length}>{suggestionsBody()}</PanelSection>
      <PanelSection id='zone.members' title={t('members')} count={membersKnown ? members.length : null}>{membersBody()}</PanelSection>
      <PanelSection id='zone.exceptions' title={te('title')} count={exceptions.count} action={newException}>{exceptionsBody()}</PanelSection>
      <PanelSection id='zone.incoming' title={ts('incoming')} count={incoming.length} action={newIncoming}>{incomingBody()}</PanelSection>
      <PanelSection id='zone.outgoing' title={ts('outgoing')} count={outgoing.length} action={newOutgoing}>{outgoingBody()}</PanelSection>
    </>
  )

  // The same bodies in the dialog, one sub-tab each, the count in the label and the add button above the flows.
  const dataTabs: DataTab[] = [
    { id: 'suggestions', label: withCount(tz('subSuggestions'), pending.length), content: suggestionsBody },
    { id: 'members', label: withCount(tz('subMembers'), membersKnown ? members.length : null), action: <ExpandAddButton label={tz('addMembers')} onClick={onAssign} />, content: membersBody },
    { id: 'exceptions', label: withCount(te('title'), exceptions.count), action: <ExpandAddButton label={te('add')} onClick={exceptions.create} />, content: exceptionsBody },
    { id: 'incoming', label: withCount(tz('subIncoming'), incoming.length), action: <ExpandAddButton label={tz('addFlow')} onClick={() => editor.create({ dst_zone_id: zone.id })} />, content: incomingBody },
    { id: 'outgoing', label: withCount(tz('subOutgoing'), outgoing.length), action: <ExpandAddButton label={tz('addFlow')} onClick={() => editor.create({ src_zone_id: zone.id })} />, content: outgoingBody },
  ]

  const dialogs = <>{editor.dialogs}{exceptions.dialogs}</>

  return { trafficSections, dataSections, dataTabs, dialogs, signals, egress, egressReady }
}

/**
 * The zone clicked on the map, as tall as the map with its body scrolling, in foldable sections (remembered per
 * browser): the observed traffic over time (the Dashboard's chart filtered on this zone, inbound or outbound, with a
 * one-line summary), its top sources (or destinations), the pending suggestions towards it (resolved as in
 * Observation), its members (ten per page; NIC firewall off and stopped told on each), its exceptions, the flows in
 * and out, all editable in place. A chip in the header says the zone's drifts and opens the Drifts sub-tab on them. The engine's
 * drifts are read once per selection (the Drifts sub-tab's key), no refresh on focus.
 */
export default function ZonePanel(props: Props) {
  const { zone, onClose, onAssign, edits, connectionId, onOpenDrifts } = props
  const t = useTranslations('microsegPilot.overview.panel')
  const tz = useTranslations('microsegPilot.overview.zonePanel')
  const tsec = useTranslations('microsegPilot.overview.sections')
  const { trafficSections, dataSections, dataTabs, dialogs, signals, egress, egressReady } = useZoneWork(props)
  const [expanded, setExpanded] = useState(false)

  const header = (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
        <i className='ri-shield-fill' style={{ fontSize: 18, color: zone.color || undefined, flexShrink: 0 }} />
        <TruncatedText text={zone.name} fontWeight={600} sx={{ flex: '0 1 auto', minWidth: 0 }} />
        {!!signals?.count && (
          <Chip
            size='small'
            color='warning'
            variant='outlined'
            data-testid='zone-drifts-chip'
            icon={<i className='ri-error-warning-line' />}
            label={tsec('drifts', { count: signals.count })}
            onClick={onOpenDrifts ? () => onOpenDrifts(zone.id) : undefined}
            sx={{ flexShrink: 0 }}
          />
        )}
        {/* One row over the whole width: the states as icons (their words in the tooltips), the actions, enlarge and close. */}
        <Box data-testid='zone-panel-controls' sx={{ flex: '1 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.25, ml: 1 }}>
          <ZoneStateChip state={zone.state} iconOnly />
          <EgressChip state={egress} ready={egressReady} iconOnly />
          <ZoneHeaderActions zone={zone} edits={edits} onAssign={onAssign} onDeleted={onClose} spread />
          <IconButton size='small' aria-label={tz('expand')} onClick={() => setExpanded(true)}><i className='ri-fullscreen-line' /></IconButton>
          <IconButton size='small' aria-label={t('close')} onClick={onClose}><i className='ri-close-line' /></IconButton>
        </Box>
      </Box>
      {zone.label && <TruncatedText text={zone.label} variant='body2' color='text.secondary' sx={{ mt: 0.5, minWidth: 0 }} />}
    </>
  )

  return (
    <PanelFrame label={t('label', { name: zone.name })} width={400} header={header}>
      {trafficSections}
      {dataSections}
      {dialogs}
      {expanded && (
        <ExpandDialog
          scope={{
            label: tz('detailsTitle', { name: zone.name }),
            lead: <i className='ri-shield-fill' style={{ fontSize: 20, color: zone.color || undefined }} />,
            title: tz('detailsTitle', { name: zone.name }),
            subtitle: <Typography component='span' variant='body2' color='text.secondary' noWrap sx={{ minWidth: 0 }}>{zone.label}</Typography>,
            chips: <><ZoneStateChip state={zone.state} /><EgressChip state={egress} ready={egressReady} /></>,
            keepEvent: e => e.zone === zone.name || e.src_zone === zone.name,
            logsEmpty: tz('logsEmpty'),
          }}
          connectionId={connectionId}
          traffic={trafficSections}
          dataTabs={dataTabs}
          onClose={() => setExpanded(false)}
        />
      )}
    </PanelFrame>
  )
}
