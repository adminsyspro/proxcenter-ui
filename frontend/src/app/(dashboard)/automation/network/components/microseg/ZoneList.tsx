'use client'

import { Box, Button, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { MicrosegFlow, MicrosegZone, PendingMember } from '@/lib/microseg/types'

import PolicyPager, { usePaged } from './PolicyPager'
import ZoneRow, { type ZoneRowProps } from './ZoneRow'
import { zoneMembers, type PolicyGuest } from './zoneModel'

type Props = Pick<ZoneRowProps, 'onEdit' | 'onDelete' | 'onSetState'> & {
  zones: MicrosegZone[]
  flows: MicrosegFlow[]
  tagPrefix: string
  guests: PolicyGuest[]
  guestsStatus: 'loading' | 'ready' | 'error'
  pendingMembers: PendingMember[]
  onAdd: () => void
}

/** The zones of the draft, ten per page. */
export default function ZoneList({ zones, flows, tagPrefix, guests, guestsStatus, pendingMembers, onAdd, ...handlers }: Props) {
  const t = useTranslations('microsegPilot.policy')
  const paged = usePaged(zones)
  const zonesById = new Map(zones.map(z => [z.id, z]))

  return (
    <Box component='section' aria-label={t('zonesTitle')}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Typography variant='subtitle1' fontWeight={600} sx={{ flex: 1 }}>{t('zonesTitle')}</Typography>
        <Button size='small' variant='contained' startIcon={<i className='ri-add-line' />} onClick={onAdd}>{t('addZone')}</Button>
      </Box>
      {zones.length === 0 ? (
        <Typography color='text.secondary' sx={{ py: 2 }}>{t('zonesEmpty')}</Typography>
      ) : (
        <>
          <Box role='list'>
            {paged.rows.map(zone => (
              <ZoneRow
                key={zone.id}
                zone={zone}
                members={zoneMembers(zone, tagPrefix, guests, pendingMembers)}
                membersKnown={guestsStatus === 'ready'}
                flows={flows}
                zonesById={zonesById}
                {...handlers}
              />
            ))}
          </Box>
          <PolicyPager count={paged.count} page={paged.page} size={paged.size} onPage={paged.setPage} />
        </>
      )}
    </Box>
  )
}
