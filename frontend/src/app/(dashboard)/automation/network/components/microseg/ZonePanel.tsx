'use client'

import { useMemo } from 'react'
import { Alert, Box, Button, Chip, IconButton, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { StatusIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'
import { useMicrosegDrifts } from '@/lib/microseg/useMicrosegLists'
import type { MicrosegFlow, MicrosegSuggestion, MicrosegZone, SuggestionAction } from '@/lib/microseg/types'

import FlowSummary from './FlowSummary'
import MicrosegErrorAlert from './MicrosegErrorAlert'
import { ObservedKindGlyph, ResolveActions, ServiceHits, useResolveSuggestions } from './observationParts'
import PanelSection, { PanelFrame } from './PanelSection'
import PolicyPager, { usePaged } from './PolicyPager'
import { SelectionTrafficChart, TopSourcesList, TrafficSummaryLine, useSelectionTraffic } from './SelectionTraffic'
import { MemberChangeChip } from './ZoneRow'
import ZoneStateChip from './ZoneStateChip'
import { FlowRowActions, MemberAction, NewFlowButton, ZoneHeaderActions, useFlowEditor } from './ZonePanelActions'
import type { ZoneEdits } from './useZoneEdits'
import { flowsOfZone, type ZoneMember } from './zoneModel'
import { zonePosture, zoneSuggestions } from './zonePanelModel'

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
}

type FlowEditor = ReturnType<typeof useFlowEditor>

function MemberLine({ member, zoneId, edits }: { member: ZoneMember; zoneId: string; edits: ZoneEdits }) {
  const t = useTranslations('microsegPilot.overview.panel')
  const { guest, ref } = member
  const name = guest?.name ?? `${ref.type}/${ref.vmid}`
  return (
    <Box role='listitem' aria-label={name} sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, minHeight: 28 }}>
      {guest
        ? <StatusIcon type='vm' vmType={guest.type} status={guest.status} />
        : <i className='ri-question-line' style={{ opacity: 0.6 }} />}
      <Tooltip title={name}><Typography noWrap sx={{ flex: '0 1 auto' }}>{name}</Typography></Tooltip>
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
  onResolve: (action: SuggestionAction) => void
}) {
  const to = useTranslations('microsegPilot.observation')
  const source = s.src_zone_id ? zonesById.get(s.src_zone_id)?.name ?? to('deletedZone') : s.src_ip || to('unknownEndpoint')
  return (
    <Box role='listitem' aria-label={source} data-suggestion={s.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minHeight: 36, minWidth: 0, borderBottom: 1, borderColor: 'divider' }}>
      <ObservedKindGlyph kind={s.kind} />
      <Tooltip title={source}><Typography noWrap fontWeight={600} sx={{ flex: '1 1 0', minWidth: 0 }}>{source}</Typography></Tooltip>
      <ServiceHits suggestion={s} />
      <ResolveActions suggestion={s} busy={busy} onResolve={onResolve} />
    </Box>
  )
}

/** The Posture section: state, members running and stopped, NIC firewall off, the drifts of the zone and a way to them. */
function PostureLines({ zone, members, membersKnown, zones, connectionId, onOpenDrifts }: {
  zone: MicrosegZone
  members: ZoneMember[]
  membersKnown: boolean
  zones: MicrosegZone[]
  connectionId: string
  onOpenDrifts?: (zoneId: string) => void
}) {
  const t = useTranslations('microsegPilot.overview.sections')
  const { data } = useMicrosegDrifts(connectionId)
  const posture = zonePosture(zone, members, data?.computed ? data.drifts : null, zones)
  let drifts = t('driftsUnknown')
  if (posture.driftsKnown) drifts = posture.drifts ? t('drifts', { count: posture.drifts }) : t('driftsNone')
  const firewall = posture.firewallOff ? t('firewallOff', { count: posture.firewallOff }) : t('firewallOffNone')
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0 }} data-testid='zone-posture'>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <ZoneStateChip state={zone.state} />
        <Typography noWrap variant='body2' sx={{ flex: '1 1 0', minWidth: 0 }} data-testid='posture-members'>
          {membersKnown ? t('membersStatus', { running: posture.running, stopped: posture.stopped }) : t('membersStatusUnknown')}
        </Typography>
      </Box>
      <Typography noWrap variant='body2' color={posture.firewallOff ? 'warning.main' : 'text.secondary'} data-testid='posture-firewall'>{firewall}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <Typography noWrap variant='body2' color={posture.drifts ? 'warning.main' : 'text.secondary'} sx={{ flex: '1 1 0', minWidth: 0 }} data-testid='posture-drifts'>{drifts}</Typography>
        {onOpenDrifts && posture.drifts > 0 && (
          <Button size='small' onClick={() => onOpenDrifts(zone.id)} endIcon={<i className='ri-arrow-right-line' />} sx={{ flexShrink: 0 }}>{t('openDrifts')}</Button>
        )}
      </Box>
    </Box>
  )
}

/**
 * The zone clicked on the map, as tall as the map with its body scrolling, in foldable sections (remembered per
 * browser): the observed traffic over time (the Dashboard's chart filtered on the flows logged in this zone, with a
 * one-line summary), its posture, its top sources, the pending suggestions towards it (resolved as in Observation),
 * its members (ten per page), the flows in and out, all editable in place.
 */
export default function ZonePanel({
  zone, members, membersKnown, flows, zonesById, edits, onClose, onAssign,
  connectionId, version, suggestions, reloadPolicy, reloadSuggestions, onResolved, onOpenDrifts,
}: Props) {
  const t = useTranslations('microsegPilot.overview.panel')
  const tz = useTranslations('microsegPilot.overview.zonePanel')
  const tsec = useTranslations('microsegPilot.overview.sections')
  const ts = useTranslations('microsegPilot.policy.zone')
  const paged = usePaged(members)
  const editor = useFlowEditor(edits)
  const { incoming, outgoing } = flowsOfZone(zone.id, flows)
  const zones = useMemo(() => [...zonesById.values()], [zonesById])
  const traffic = useSelectionTraffic(connectionId, zones, { kind: 'zone', zone })
  const pending = useMemo(() => zoneSuggestions(suggestions, zone.id), [suggestions, zone.id])
  const pendingPage = usePaged(pending, FLOWS_PAGE_SIZE)
  const { busy, failure, clearFailure, resolve } = useResolveSuggestions(connectionId, version, reloadPolicy, reloadSuggestions)

  async function resolveOne(id: string, action: SuggestionAction) {
    const outcome = await resolve([id], action)
    if (outcome?.resolved) onResolved(action)
  }

  const header = (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <i className='ri-shield-fill' style={{ fontSize: 18, color: zone.color || undefined }} />
        <Tooltip title={zone.name}><Typography noWrap fontWeight={600} sx={{ flex: '1 1 0', minWidth: 0 }}>{zone.name}</Typography></Tooltip>
        <ZoneStateChip state={zone.state} />
        <IconButton size='small' aria-label={t('close')} onClick={onClose}><i className='ri-close-line' /></IconButton>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, mt: 1 }}>
        <Tooltip title={zone.label}>
          <Typography noWrap variant='body2' color='text.secondary' sx={{ flex: '1 1 0', minWidth: 0 }}>{zone.label}</Typography>
        </Tooltip>
        <ZoneHeaderActions zone={zone} edits={edits} onAssign={onAssign} onDeleted={onClose} />
      </Box>
    </>
  )

  return (
    <PanelFrame label={t('label', { name: zone.name })} width={400} header={header}>
      <PanelSection id='zone.traffic' title={tsec('traffic')}>
        <SelectionTrafficChart traffic={traffic} />
        <TrafficSummaryLine traffic={traffic} />
      </PanelSection>

      <PanelSection id='zone.posture' title={tsec('posture')}>
        <PostureLines zone={zone} members={members} membersKnown={membersKnown} zones={zones} connectionId={connectionId} onOpenDrifts={onOpenDrifts} />
      </PanelSection>

      <PanelSection id='zone.sources' title={tsec('topSources')} count={traffic.phase === 'ready' ? traffic.summary.top.length : null}>
        <TopSourcesList top={traffic.summary.top} phase={traffic.phase} />
      </PanelSection>

      <PanelSection id='zone.suggestions' title={tsec('suggestions')} count={pending.length}>
        {failure && <Alert severity='error' onClose={clearFailure} sx={{ mb: 1 }}>{failure}</Alert>}
        {pending.length === 0 && <Typography variant='body2' color='text.disabled'>{tsec('suggestionsEmpty')}</Typography>}
        <Box role='list'>
          {pendingPage.rows.map(s => (
            <SuggestionLine key={s.id} suggestion={s} zonesById={zonesById} busy={busy} onResolve={action => { void resolveOne(s.id, action) }} />
          ))}
        </Box>
        <PolicyPager count={pendingPage.count} page={pendingPage.page} size={pendingPage.size} onPage={pendingPage.setPage} />
      </PanelSection>

      <PanelSection id='zone.members' title={t('members')} count={membersKnown ? members.length : null}>
        {edits.memberError != null && <MicrosegErrorAlert error={edits.memberError} onClose={edits.clearMemberError} />}
        {!membersKnown && <Typography variant='body2' color='text.disabled'>{t('membersUnknown')}</Typography>}
        {membersKnown && members.length === 0 && <Typography variant='body2' color='text.disabled'>{t('noMembers')}</Typography>}
        <Box role='list'>
          {paged.rows.map(m => <MemberLine key={`${m.ref.type}/${m.ref.vmid}`} member={m} zoneId={zone.id} edits={edits} />)}
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
