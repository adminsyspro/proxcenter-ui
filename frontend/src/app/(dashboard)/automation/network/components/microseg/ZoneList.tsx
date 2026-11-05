'use client'

import { useCallback, useContext, useMemo, useState } from 'react'
import { Box, Button, IconButton, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { PolicyDiff } from '@/lib/microseg/pendingChanges'
import type { MicrosegFlow, MicrosegZone, PendingMember } from '@/lib/microseg/types'

import { zoneEgress } from '@/lib/microseg/types'
import { useMicrosegDrifts, useMicrosegSuggestions } from '@/lib/microseg/useMicrosegLists'

import { useIgnoredDrifts } from './driftIgnore'
import PolicyPager, { usePaged } from './PolicyPager'
import { useBoxSize } from './useBoxSize'
import { useNow } from './useNow'
import ZoneCard, { RemovedZoneCard, ZoneCardDetails, type ZoneCardProps } from './ZoneCard'
import type { ZoneRowProps } from './ZoneRow'
import { zoneDriftSignals } from './zonePanelModel'
import { isEgressReady, pendingOutboundOf, zoneMembers, type PolicyGuest, type ZoneMember } from './zoneModel'
import { uncoveredSeriesOf, type UncoveredSeries } from './useZoneUncovered'
import { MicrosegActionsSlot, SlotActions, WriteTip, useMicrosegWrite } from './microsegAccess'

type Props = Pick<ZoneRowProps, 'onEdit' | 'onDelete' | 'onSetState' | 'onAssign' | 'onRemoveMember' | 'removeBusy' | 'onAddFlow' | 'onEditFlow' | 'onDeleteFlow'>
  & Pick<ZoneCardProps, 'onOpenDrifts'> & {
  connectionId: string
  zones: MicrosegZone[]
  flows: MicrosegFlow[]
  tagPrefix: string
  guests: PolicyGuest[]
  guestsStatus: 'loading' | 'ready' | 'error'
  pendingMembers: PendingMember[]
  /** What the draft changes over the applied revision; null while the revision is read. */
  diff: PolicyDiff | null
  onAdd: () => void
  /** The uncovered traffic of the last 24 hours per zone (one read for the tab): null while read, 'failed' when it cannot be. */
  uncovered?: UncoveredSeries | null | 'failed'
  /** The observation window of the outbound readiness chip (the policy setting). */
  readyAfterHours?: number
}

/** The zones opened under their chevron, remembered per connection in this browser. */
// A new key for the cards: the open rows of the former list are not carried over, every card starts closed.
export const openZonesKey = (connectionId: string) => `microseg.policy.openCards.${connectionId}`

function readOpen(connectionId: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(openZonesKey(connectionId)) ?? '[]')
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

function useOpenZones(connectionId: string) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => readOpen(connectionId))
  const toggle = useCallback((id: string) => setOpen(prev => {
    const next = new Set(prev)
    if (!next.delete(id)) next.add(id)
    try {
      window.localStorage.setItem(openZonesKey(connectionId), JSON.stringify([...next]))
    } catch {
      // A blocked storage only forgets the choice.
    }
    return next
  }), [connectionId])
  return { open, toggle }
}

type Item = { zone: MicrosegZone; removed: boolean; members: ZoneMember[] }

/** The smallest card width, and the gap between cards (px). */
export const CARD_MIN = 280
const CARD_GAP = 16

/** How many cards a row holds at this width (auto-fill, at least one). */
export function cardColumns(width: number | undefined): number {
  return Math.max(1, Math.floor(((width ?? 0) + CARD_GAP) / (CARD_MIN + CARD_GAP)))
}

/**
 * The zones of the draft as cards in a grid (auto-fill, 280 px at least, equal heights per row), then those it removed
 * (struck through until the next apply), ten per page, "+" right of the title for a new zone. An opened card shows
 * its members and flows full width below its row. The drifts are read once (the engine's last full run, no Proxmox call).
 */
export default function ZoneList({ connectionId, zones, flows, tagPrefix, guests, guestsStatus, pendingMembers, diff, onAdd, onOpenDrifts, uncovered = 'failed', readyAfterHours, ...handlers }: Props) {
  const t = useTranslations('microsegPilot.policy')
  const inSlot = useContext(MicrosegActionsSlot) !== null
  const { canWrite } = useMicrosegWrite()
  const { open, toggle } = useOpenZones(connectionId)
  const [gridRef, size] = useBoxSize<HTMLDivElement>()
  const { data: drifts } = useMicrosegDrifts(connectionId, { once: true })
  const { ignored } = useIgnoredDrifts(connectionId)
  // The outbound readiness needs the pending outbound would-block flows: read once, and only when a zone observes its outbound.
  const now = useNow()
  const observingEgress = zones.some(z => zoneEgress(z) === 'observe')
  const { data: outbound } = useMicrosegSuggestions(observingEgress ? connectionId : null, { kind: 'would_block', status: 'pending', direction: 'out', limit: 200 })
  const egressReady = (zone: MicrosegZone) =>
    zoneEgress(zone) === 'observe' && !!outbound && outbound.length < 200 && isEgressReady(zone, pendingOutboundOf(outbound, zone.id), readyAfterHours, now)

  const items: Item[] = useMemo(() => [
    ...zones.map(zone => ({ zone, removed: false, members: zoneMembers(zone, tagPrefix, guests, pendingMembers, zones) })),
    ...(diff?.removedZones ?? []).map(zone => ({ zone, removed: true, members: [] })),
  ], [zones, tagPrefix, guests, pendingMembers, diff])
  const paged = usePaged(items)
  const zonesById = useMemo(() => new Map([...(diff?.removedZones ?? []), ...zones].map(z => [z.id, z])), [zones, diff])
  const columns = cardColumns(size?.width)
  const membersKnown = guestsStatus === 'ready'

  // Rows of cards, each followed by the details of its opened cards (full width, below the row).
  const rows: Item[][] = []
  for (let i = 0; i < paged.rows.length; i += columns) rows.push(paged.rows.slice(i, i + columns))

  const card = (item: Item) => {
    if (item.removed) return <RemovedZoneCard key={`removed-${item.zone.id}`} zone={item.zone} />
    const signals = zoneDriftSignals(item.zone, item.members, drifts?.computed ? drifts.drifts : null, zones, ignored)
    return (
      <ZoneCard
        key={item.zone.id}
        zone={item.zone}
        members={item.members}
        membersKnown={membersKnown}
        flows={flows}
        zonesById={zonesById}
        diffKind={diff?.zones.get(item.zone.id)}
        flowDiff={diff?.flows ?? null}
        open={open.has(item.zone.id)}
        onToggle={() => toggle(item.zone.id)}
        drifts={signals?.count ?? null}
        onOpenDrifts={onOpenDrifts}
        egressReady={egressReady(item.zone)}
        uncovered={uncovered === 'failed' ? null : {
          series: uncovered ? uncoveredSeriesOf(uncovered, item.zone.name, diff?.renamedZones.get(item.zone.id)) : null,
          from: uncovered?.from ?? 0,
          stepMs: uncovered?.stepMs ?? 3_600_000,
        }}
        {...handlers}
      />
    )
  }
  const details = (item: Item) => (
    <Box key={`details-${item.zone.id}`} role='listitem' sx={{ gridColumn: '1 / -1', minWidth: 0 }}>
      <ZoneCardDetails
        zone={item.zone}
        members={item.members}
        membersKnown={membersKnown}
        flows={flows}
        zonesById={zonesById}
        flowDiff={diff?.flows ?? null}
        open
        onToggle={() => toggle(item.zone.id)}
        {...handlers}
      />
    </Box>
  )

  return (
    <Box component='section' aria-label={t('zonesTitle')}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Typography variant='subtitle1' fontWeight={600}>{t('zonesTitle')}</Typography>
        {/* "+" right of the title: no card spends a grid cell on it. */}
        <WriteTip title={t('addZone')}>
          <IconButton size='small' color='primary' aria-label={t('addZone')} data-testid='new-zone-button' onClick={onAdd} disabled={!canWrite}>
            <i className='ri-add-line' />
          </IconButton>
        </WriteTip>
        <Box sx={{ flex: 1 }} />
        {/* Also on the row of the sub-tabs. */}
        {inSlot && (
          <SlotActions order={2}>
            <WriteTip>
              <Button size='small' variant='contained' startIcon={<i className='ri-add-line' />} onClick={onAdd} disabled={!canWrite}>{t('addZone')}</Button>
            </WriteTip>
          </SlotActions>
        )}
      </Box>
      {items.length === 0 && <Typography color='text.secondary' sx={{ pb: 1.5 }}>{t('zonesEmpty')}</Typography>}
      <Box
        ref={gridRef}
        role='list'
        sx={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${CARD_MIN}px, 1fr))`, gap: `${CARD_GAP}px`, alignItems: 'stretch' }}
      >
        {rows.flatMap(row => [
          ...row.map(card),
          ...row.filter(item => !item.removed && open.has(item.zone.id)).map(details),
        ])}
      </Box>
      <PolicyPager count={paged.count} page={paged.page} size={paged.size} onPage={paged.setPage} />
    </Box>
  )
}
