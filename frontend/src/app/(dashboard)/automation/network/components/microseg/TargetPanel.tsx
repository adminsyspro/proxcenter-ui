'use client'

import { useMemo } from 'react'
import { Alert, Box, Button, Chip, IconButton, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { StatusIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'
import type { MicrosegFlow, MicrosegSuggestion, MicrosegZone, SuggestionAction } from '@/lib/microseg/types'
import { serviceTitle, sharedServiceNames } from '@/lib/network/serviceNames'

import { OneLine } from './dialogParts'
import FlowSummary from './FlowSummary'
import { ObservedKindGlyph, ResolveActions, outboundZoneAcceptTip, ServiceHits, useResolveSuggestions } from './observationParts'
import { destinationName } from './ObservationRow'
import PanelSection, { PanelFrame, usePanelSection } from './PanelSection'
import PolicyPager, { usePaged } from './PolicyPager'
import { SelectionTrafficChart, useSelectionTraffic } from './SelectionTraffic'
import { targetSuggestions, type TargetFlow, type TargetGuest } from './targetModel'
import { bareIp } from './zoneGraph'
import ZoneStateChip from './ZoneStateChip'
import TruncatedText from './TruncatedText'

const ROWS_PER_PAGE = 5
/** A guest name keeps at least this much of the row (a 12-character name such as "pcz-demo-34"), cut beyond. */
const NAME_MIN_WIDTH = 96
/** The room a name holds in its row: NAME_MIN_WIDTH, less for a name too short to fill it (its length, with a margin for wide letters). */
const nameFloor = (name: string) => `min(${NAME_MIN_WIDTH}px, ${name.length + 3}ch)`
/** The flex shrink factor of the text of a row that is cut before any other. */
const FIRST_TO_YIELD = 1000
/** What is left of the emitting zone of a row at its narrowest: room for an ellipsis to hover. */
const FROM_ZONE_FLOOR = '2ch'

type Props = {
  target: TargetGuest
  zonesById: Map<string, MicrosegZone>
  /** The pending observed flows of the map. */
  suggestions: MicrosegSuggestion[]
  flows: MicrosegFlow[]
  /** The guest name of each known address (bare form). */
  peers: ReadonlyMap<string, string>
  connectionId: string
  version: number
  reloadPolicy: () => Promise<unknown>
  reloadSuggestions: () => Promise<unknown>
  onResolved: (action: SuggestionAction) => void
  onOpenZone: (zoneId: string) => void
  onClose: () => void
  /** The map read only the first `limit` pending observed flows: the list may miss some. */
  partialLimit?: number | null
}

const Empty = ({ text }: { text: string }) => <Typography variant='body2' color='text.disabled'>{text}</Typography>

/** An observed flow of the guest on one line: direction, peer, service, hits, kind, the three ways out. */
function ObservedLine({ row, peers, zonesById, sharedServices, busy, onResolve }: {
  row: TargetFlow
  peers: ReadonlyMap<string, string>
  zonesById: Map<string, MicrosegZone>
  sharedServices: ReadonlySet<string>
  busy: boolean
  onResolve: (action: SuggestionAction, prefixLen?: number) => void
}) {
  const t = useTranslations('microsegPilot.overview')
  const to = useTranslations('microsegPilot.observation')
  const s = row.suggestion
  const emitter = row.peerZoneId ? zonesById.get(row.peerZoneId)?.name ?? to('deletedZone') : ''
  const guestOf = (ip: string) => peers.get(bareIp(ip))
  // An outbound row's peer is its destination (never the zone that emits it), an inbound row's its source.
  const peer = s.direction === 'out' && row.direction === 'out'
    ? destinationName(s, zonesById, guestOf, to as (key: string) => string)
    : (row.peerIp && guestOf(row.peerIp)) || row.peerIp || emitter || to('unknownEndpoint')
  const where = t(row.direction === 'out' ? 'target.panel.outgoing' : 'target.panel.incoming', { peer })
  const service = serviceTitle(s.proto, s.dport)
  const from = s.src_zone_id ? zonesById.get(s.src_zone_id)?.name ?? to('deletedZone') : to('unknownEndpoint')
  // The other end as the Observation table names it: its zone, else the guest or the address, else many destinations.
  const destination = destinationName(s, zonesById, guestOf, to as (key: string) => string)
  const accept = t('flowPanel.acceptAs', { from, to: destination, service })
  const sampleTip = t('target.panel.acceptTip', { from, to: destination, service })
  const zoneTip = outboundZoneAcceptTip(to, s, from, destination)
  const acceptTip = zoneTip ? `${zoneTip} ${sampleTip}` : sampleTip
  const fromZone = row.fromZone ? t('target.panel.fromZone', { zone: zonesById.get(row.fromZone)?.name ?? to('deletedZone') }) : ''
  const kind = s.kind === 'blocked' ? 'blocked' : 'unprotected'
  return (
    <Box role='listitem' aria-label={where} data-suggestion={s.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minHeight: 36, minWidth: 0, borderBottom: 1, borderColor: 'divider' }}>
      <Tooltip title={fromZone ? `${where}, ${fromZone}` : where}>
        <i className={row.direction === 'out' ? 'ri-arrow-right-up-line' : 'ri-arrow-left-down-line'} style={{ flexShrink: 0 }} aria-hidden />
      </Tooltip>
      {/* The kind chip never shrinks: its label stays whole. What gives way is the emitting zone first (its shrink
          factor dwarfs the others; it keeps FROM_ZONE_FLOOR, so that its ellipsis can still be hovered, and the
          tooltip of the direction icon, which always opens, says it too), then the service and its hits, each cut
          with its full text as tooltip; the peer's name keeps NAME_MIN_WIDTH, or its own width when it is shorter. */}
      <TruncatedText text={peer} title={where} fontWeight={600} sx={{ flex: '1 1 0', minWidth: nameFloor(peer) }} />
      {fromZone && <TruncatedText text={fromZone} color='text.secondary' variant='caption' sx={{ flex: `0 ${FIRST_TO_YIELD} auto`, minWidth: FROM_ZONE_FLOOR, maxWidth: 110 }} />}
      <ServiceHits suggestion={s} sharedServices={sharedServices} yields />
      <Tooltip title={t(`legend.${kind}`)}>
        <Chip
          size='small'
          variant='outlined'
          color={kind === 'blocked' ? 'info' : 'error'}
          icon={<ObservedKindGlyph kind={s.kind} />}
          label={t(`legend.${kind}`)}
          sx={{ flexShrink: 0 }}
        />
      </Tooltip>
      <ResolveActions suggestion={s} busy={busy} onResolve={onResolve} acceptLabel={accept} acceptTip={acceptTip} />
    </Box>
  )
}

/**
 * The guest the map is targeted on, as tall as the map with its body scrolling, in foldable sections (remembered per
 * browser): the guest (its zone, a button opens the zone panel, its addresses), its flows (the pending observed flows
 * its addresses are the sample source or destination of, each with the three ways out of the Observation sub-tab; one
 * line per row, five per page), the rules of its zone (the allowed flows, context, folded by default), and its
 * observed traffic over time (its events in the orchestrator's memory).
 */
export default function TargetPanel({ target, zonesById, suggestions, flows, peers, connectionId, version, reloadPolicy, reloadSuggestions, onResolved, onOpenZone, onClose, partialLimit = null }: Props) {
  const t = useTranslations('microsegPilot.overview')
  const zone = target.zoneId ? zonesById.get(target.zoneId) ?? null : null
  const observed = useMemo(() => targetSuggestions(suggestions, target), [suggestions, target])
  const sharedServices = useMemo(() => sharedServiceNames(observed.map(r => r.suggestion)), [observed])
  const allowed = useMemo(() => (zone ? flows.filter(f => f.src_zone_id === zone.id || f.dst_zone_id === zone.id) : []), [flows, zone])
  const observedPage = usePaged(observed, ROWS_PER_PAGE)
  const allowedPage = usePaged(allowed, ROWS_PER_PAGE)
  const { busy, failure, clearFailure, resolve: resolveIds } = useResolveSuggestions(connectionId, version, reloadPolicy, reloadSuggestions)
  const zones = useMemo(() => [...zonesById.values()], [zonesById])
  const trafficSection = usePanelSection('guest.traffic')
  const traffic = useSelectionTraffic(connectionId, zones, { kind: 'guest', type: target.type, vmid: target.vmid, ips: target.ips }, trafficSection[0])
  const ips = target.ips.length ? t('node.guestIps', { ips: target.ips.join(', ') }) : t('node.guestNoIp')

  async function resolve(id: string, action: SuggestionAction, prefixLen?: number) {
    const outcome = await resolveIds([id], action, prefixLen)
    if (outcome?.resolved) onResolved(action)
  }

  let observedEmpty: string | null = null
  if (!target.ips.length) observedEmpty = t('target.panel.noIps')
  else if (!observed.length) observedEmpty = t('target.panel.noObserved')

  const header = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
      <StatusIcon type='vm' vmType={target.type} status={target.status} />
      <TruncatedText text={target.name} fontWeight={600} sx={{ flex: '0 1 auto', minWidth: NAME_MIN_WIDTH }} />
      <Typography noWrap variant='body2' color='text.secondary' sx={{ flex: '1 1 0', minWidth: 0 }}>
        {t('target.panel.where', { type: t(`target.type.${target.type}`), vmid: target.vmid, node: target.node })}
      </Typography>
      <IconButton size='small' aria-label={t('panel.close')} onClick={onClose}><i className='ri-close-line' /></IconButton>
    </Box>
  )

  return (
    <PanelFrame label={t('target.panel.label', { name: target.name })} width={440} header={header} dataTarget={target.key}>
      <PanelSection id='guest.guest' title={t('sections.guest')}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          {zone ? (
            <>
              <Chip
                size='small'
                variant='outlined'
                icon={<i className='ri-shield-fill' style={{ color: zone.color || undefined }} />}
                label={zone.name}
                sx={{ minWidth: 0, flex: '0 1 auto' }}
              />
              <ZoneStateChip state={zone.state} />
            </>
          ) : <Chip size='small' variant='outlined' label={t('target.panel.noZone')} sx={{ flexShrink: 0 }} />}
          <Box sx={{ flex: 1 }} />
          {zone && (
            <Button size='small' variant='outlined' startIcon={<i className='ri-shield-line' />} onClick={() => onOpenZone(zone.id)} sx={{ flexShrink: 0 }}>
              {t('target.panel.openZone')}
            </Button>
          )}
        </Box>
        <TruncatedText text={ips} variant='body2' color='text.secondary' sx={{ mt: 0.5 }} />
      </PanelSection>

      <PanelSection id='guest.flows' title={t('sections.flows')} count={observed.length}>
        {failure && <Alert severity='error' onClose={clearFailure} sx={{ mb: 1.5 }}>{failure}</Alert>}
        {partialLimit !== null && <OneLine text={t('target.panel.partial', { count: partialLimit })} />}
        {observedEmpty && <Empty text={observedEmpty} />}
        <Box role='list'>
          {observedPage.rows.map(row => (
            <ObservedLine key={row.suggestion.id} row={row} peers={peers} zonesById={zonesById} sharedServices={sharedServices} busy={busy} onResolve={(action, prefixLen) => resolve(row.suggestion.id, action, prefixLen)} />
          ))}
        </Box>
        <PolicyPager count={observedPage.count} page={observedPage.page} size={observedPage.size} onPage={observedPage.setPage} />
      </PanelSection>

      <PanelSection id='guest.zoneRules' title={t('sections.zoneRules')} count={zone ? allowed.length : null} defaultOpen={false}>
        {!zone && <Empty text={t('target.panel.noZoneFlows')} />}
        {zone && !allowed.length && <Empty text={t('panel.noFlows')} />}
        <Box role='list'>
          {allowedPage.rows.map(f => (
            <Box role='listitem' key={f.id} sx={{ display: 'flex', alignItems: 'center', minHeight: 28, minWidth: 0 }}>
              <FlowSummary flow={f} zonesById={zonesById} sideMinWidth={NAME_MIN_WIDTH / 2} />
            </Box>
          ))}
        </Box>
        <PolicyPager count={allowedPage.count} page={allowedPage.page} size={allowedPage.size} onPage={allowedPage.setPage} />
      </PanelSection>

      <PanelSection id='guest.traffic' title={t('sections.traffic')} state={trafficSection}>
        <SelectionTrafficChart traffic={traffic} emptyText={t('sections.guestTrafficEmpty')} />
      </PanelSection>
    </PanelFrame>
  )
}
