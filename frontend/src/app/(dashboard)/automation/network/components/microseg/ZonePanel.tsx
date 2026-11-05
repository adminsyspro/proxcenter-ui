'use client'

import { useMemo } from 'react'
import { Alert, Box, Button, Chip, IconButton, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { StatusIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'
import { useMicrosegDrifts } from '@/lib/microseg/useMicrosegLists'
import { zoneEgress, type MicrosegFlow, type MicrosegSuggestion, type MicrosegZone, type SuggestionAction } from '@/lib/microseg/types'

import FlowSummary from './FlowSummary'
import MicrosegErrorAlert from './MicrosegErrorAlert'
import { DirectionGlyph, ObservedKindGlyph, ResolveActions, ServiceHits, useResolveSuggestions } from './observationParts'
import PanelSection, { PanelFrame, usePanelSection } from './PanelSection'
import PolicyPager, { usePaged } from './PolicyPager'
import { SelectionTrafficChart, TOP_TITLE, TopSourcesList, TrafficSummaryLine, useSelectionTraffic } from './SelectionTraffic'
import { MemberChangeChip } from './ZoneRow'
import EgressChip from './EgressChip'
import ZoneStateChip from './ZoneStateChip'
import { FlowRowActions, MemberAction, NewFlowButton, ZoneHeaderActions, useFlowEditor } from './ZonePanelActions'
import type { ZoneEdits } from './useZoneEdits'
import { useIgnoredDrifts } from './driftIgnore'
import { OneLine } from './dialogParts'
import { useNow } from './useNow'
import { flowsOfZone, guestKey, isEgressReady, pendingOutboundOf, type ZoneMember } from './zoneModel'
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
  /** The writes on the draft (zone, state, members, flows). */
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
}

type FlowEditor = ReturnType<typeof useFlowEditor>

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

function FlowsList({ flows, zonesById, editor }: { flows: MicrosegFlow[]; zonesById: Map<string, MicrosegZone>; editor: FlowEditor }) {
  const t = useTranslations('microsegPilot.overview.panel')
  const paged = usePaged(flows, FLOWS_PAGE_SIZE)
  return (
    <>
      {flows.length === 0 && <Typography variant='body2' color='text.disabled'>{t('noFlows')}</Typography>}
      {paged.rows.map(flow => (
        <Box key={flow.id} sx={{ display: 'flex', minHeight: 28, alignItems: 'center', gap: 0.5, minWidth: 0 }}>
          <FlowSummary flow={flow} zonesById={zonesById} />
          <FlowRowActions flow={flow} onEdit={editor.edit} onDelete={editor.remove} />
        </Box>
      ))}
      <PolicyPager count={paged.count} page={paged.page} size={paged.size} onPage={paged.setPage} />
    </>
  )
}

/** A pending suggestion towards the zone on one line: kind, source, service and hits, the ways out of Observation. */
function SuggestionLine({ suggestion: s, zonesById, busy, onResolve }: {
  suggestion: MicrosegSuggestion
  zonesById: Map<string, MicrosegZone>
  busy: boolean
  onResolve: (action: SuggestionAction, prefixLen?: number) => void
}) {
  const to = useTranslations('microsegPilot.observation')
  const source = s.src_zone_id ? zonesById.get(s.src_zone_id)?.name ?? to('deletedZone') : s.src_ip || to('unknownEndpoint')
  return (
    <Box role='listitem' aria-label={source} data-suggestion={s.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minHeight: 36, minWidth: 0, borderBottom: 1, borderColor: 'divider' }}>
      <DirectionGlyph direction={s.direction} />
      <ObservedKindGlyph kind={s.kind} />
      <TruncatedText text={source} fontWeight={600} sx={{ flex: '1 1 0', minWidth: 0 }} />
      <ServiceHits suggestion={s} />
      <ResolveActions suggestion={s} busy={busy} onResolve={onResolve} />
    </Box>
  )
}

/**
 * The zone clicked on the map, as tall as the map with its body scrolling, in foldable sections (remembered per
 * browser): the observed traffic over time (the Dashboard's chart filtered on this zone, inbound or outbound, with a
 * one-line summary), its top sources (or destinations), the pending suggestions towards it (resolved as in
 * Observation), its members (ten per page; NIC firewall off and stopped told on each), the flows in and out, all
 * editable in place. A chip in the header says the zone's drifts and opens the Drifts sub-tab on them. The engine's
 * drifts are read once per selection (the Drifts sub-tab's key), no refresh on focus.
 */
export default function ZonePanel({
  zone, members, membersKnown, flows, zonesById, edits, onClose, onAssign,
  connectionId, version, suggestions, reloadPolicy, reloadSuggestions, onResolved, onOpenDrifts, partialLimit = null,
}: Props) {
  const t = useTranslations('microsegPilot.overview.panel')
  const tz = useTranslations('microsegPilot.overview.zonePanel')
  const tsec = useTranslations('microsegPilot.overview.sections')
  const ts = useTranslations('microsegPilot.policy.zone')
  const tt = useTranslations('microsegPilot.overview.target.panel')
  const paged = usePaged(members)
  const editor = useFlowEditor(edits)
  const { incoming, outgoing } = flowsOfZone(zone.id, flows)
  const zones = useMemo(() => [...zonesById.values()], [zonesById])
  const egress = zoneEgress(zone)
  const now = useNow()
  // The map reads every pending observed flow, outbound ones included: the readiness needs no read of its own, unless that read was cut (partialLimit).
  const egressReady = egress === 'observe' && partialLimit === null && isEgressReady(zone, pendingOutboundOf(suggestions, zone.id), edits.readyAfterHours, now)
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
  const pendingPage = usePaged(pending, FLOWS_PAGE_SIZE)
  const { busy, failure, clearFailure, resolve } = useResolveSuggestions(connectionId, version, reloadPolicy, reloadSuggestions)

  async function resolveOne(id: string, action: SuggestionAction, prefixLen?: number) {
    const outcome = await resolve([id], action, prefixLen)
    if (outcome?.resolved) onResolved(action)
  }

  const header = (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <i className='ri-shield-fill' style={{ fontSize: 18, color: zone.color || undefined }} />
        <TruncatedText text={zone.name} fontWeight={600} sx={{ flex: '1 1 0', minWidth: 0 }} />
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
        <ZoneStateChip state={zone.state} />
        <EgressChip state={egress} ready={egressReady} />
        <IconButton size='small' aria-label={t('close')} onClick={onClose}><i className='ri-close-line' /></IconButton>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, mt: 1 }}>
        <TruncatedText text={zone.label} variant='body2' color='text.secondary' sx={{ flex: '1 1 0', minWidth: 0 }} />
        <ZoneHeaderActions zone={zone} edits={edits} onAssign={onAssign} onDeleted={onClose} />
      </Box>
    </>
  )

  return (
    <PanelFrame label={t('label', { name: zone.name })} width={400} header={header}>
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

      <PanelSection id='zone.suggestions' title={tsec('suggestions')} count={pending.length}>
        {failure && <Alert severity='error' onClose={clearFailure} sx={{ mb: 1 }}>{failure}</Alert>}
        {partialLimit !== null && <OneLine text={tt('partial', { count: partialLimit })} />}
        {pending.length === 0 && <Typography variant='body2' color='text.disabled'>{tsec('suggestionsEmpty')}</Typography>}
        <Box role='list'>
          {pendingPage.rows.map(s => (
            <SuggestionLine key={s.id} suggestion={s} zonesById={zonesById} busy={busy} onResolve={(action, prefixLen) => { void resolveOne(s.id, action, prefixLen) }} />
          ))}
        </Box>
        <PolicyPager count={pendingPage.count} page={pendingPage.page} size={pendingPage.size} onPage={pendingPage.setPage} />
      </PanelSection>

      <PanelSection id='zone.members' title={t('members')} count={membersKnown ? members.length : null}>
        {edits.memberError != null && <MicrosegErrorAlert error={edits.memberError} onClose={edits.clearMemberError} />}
        {!membersKnown && <Typography variant='body2' color='text.disabled'>{t('membersUnknown')}</Typography>}
        {membersKnown && members.length === 0 && <Typography variant='body2' color='text.disabled'>{t('noMembers')}</Typography>}
        <Box role='list'>
          {paged.rows.map(m => <MemberLine key={`${m.ref.type}/${m.ref.vmid}`} member={m} zoneId={zone.id} edits={edits} firewallOff={!!signals?.firewallOff.has(guestKey(m.ref))} />)}
        </Box>
        <PolicyPager count={paged.count} page={paged.page} size={paged.size} onPage={paged.setPage} />
      </PanelSection>

      <PanelSection id='zone.incoming' title={ts('incoming')} count={incoming.length} action={<NewFlowButton label={tz('newIncoming')} onClick={() => editor.create({ dst_zone_id: zone.id })} />}>
        <FlowsList flows={incoming} zonesById={zonesById} editor={editor} />
      </PanelSection>
      <PanelSection id='zone.outgoing' title={ts('outgoing')} count={outgoing.length} action={<NewFlowButton label={tz('newOutgoing')} onClick={() => editor.create({ src_zone_id: zone.id })} />}>
        <FlowsList flows={outgoing} zonesById={zonesById} editor={editor} />
      </PanelSection>
      {editor.dialogs}
    </PanelFrame>
  )
}
