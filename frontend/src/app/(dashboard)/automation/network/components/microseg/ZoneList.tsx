'use client'

import { useCallback, useState } from 'react'
import { Box, Button, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { PolicyDiff } from '@/lib/microseg/pendingChanges'
import type { MicrosegFlow, MicrosegZone, PendingMember } from '@/lib/microseg/types'

import PolicyPager, { usePaged } from './PolicyPager'
import ZoneRow, { RemovedZoneRow, type ZoneRowProps } from './ZoneRow'
import { zoneMembers, type PolicyGuest } from './zoneModel'
import { SlotActions, WriteTip, useMicrosegWrite } from './microsegAccess'

type Props = Pick<ZoneRowProps, 'onEdit' | 'onDelete' | 'onSetState' | 'onAssign' | 'onRemoveMember' | 'removeBusy' | 'onAddFlow' | 'onEditFlow' | 'onDeleteFlow'> & {
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
}

/** The zones opened under their chevron, remembered per connection in this browser. */
export const openZonesKey = (connectionId: string) => `microseg.policy.openZones.${connectionId}`

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

type Item = { zone: MicrosegZone; removed: boolean }

/** The zones of the draft, then those it removed (struck through until the next apply), ten per page. */
export default function ZoneList({ connectionId, zones, flows, tagPrefix, guests, guestsStatus, pendingMembers, diff, onAdd, ...handlers }: Props) {
  const t = useTranslations('microsegPilot.policy')
  const items: Item[] = [...zones.map(zone => ({ zone, removed: false })), ...(diff?.removedZones ?? []).map(zone => ({ zone, removed: true }))]
  const paged = usePaged(items)
  const { canWrite } = useMicrosegWrite()
  const { open, toggle } = useOpenZones(connectionId)
  const zonesById = new Map([...(diff?.removedZones ?? []), ...zones].map(z => [z.id, z]))

  return (
    <Box component='section' aria-label={t('zonesTitle')}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Typography variant='subtitle1' fontWeight={600} sx={{ flex: 1 }}>{t('zonesTitle')}</Typography>
        <SlotActions order={2}>
          <WriteTip>
            <Button size='small' variant='contained' startIcon={<i className='ri-add-line' />} onClick={onAdd} disabled={!canWrite}>{t('addZone')}</Button>
          </WriteTip>
        </SlotActions>
      </Box>
      {items.length === 0 ? (
        <Typography color='text.secondary' sx={{ py: 2 }}>{t('zonesEmpty')}</Typography>
      ) : (
        <>
          <Box role='list'>
            {paged.rows.map(({ zone, removed }) => (removed
              ? <RemovedZoneRow key={`removed-${zone.id}`} zone={zone} />
              : (
                <ZoneRow
                  key={zone.id}
                  zone={zone}
                  members={zoneMembers(zone, tagPrefix, guests, pendingMembers, zones)}
                  membersKnown={guestsStatus === 'ready'}
                  flows={flows}
                  zonesById={zonesById}
                  diffKind={diff?.zones.get(zone.id)}
                  flowDiff={diff?.flows ?? null}
                  open={open.has(zone.id)}
                  onToggle={() => toggle(zone.id)}
                  {...handlers}
                />
              )))}
          </Box>
          <PolicyPager count={paged.count} page={paged.page} size={paged.size} onPage={paged.setPage} />
        </>
      )}
    </Box>
  )
}
