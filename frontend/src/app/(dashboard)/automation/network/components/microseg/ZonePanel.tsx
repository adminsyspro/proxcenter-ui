'use client'

import { Box, Button, Chip, IconButton, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { StatusIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'
import type { MicrosegFlow, MicrosegZone } from '@/lib/microseg/types'

import FlowSummary from './FlowSummary'
import PolicyPager, { usePaged } from './PolicyPager'
import { STATE_DOT } from './ZoneRow'
import { flowsOfZone, type ZoneMember } from './zoneModel'

const FLOWS_PAGE_SIZE = 5

type Props = {
  zone: MicrosegZone
  members: ZoneMember[]
  /** False while the guest list is loading or failed. */
  membersKnown: boolean
  flows: MicrosegFlow[]
  zonesById: Map<string, MicrosegZone>
  onClose: () => void
  onEdit: () => void
  onAssign: () => void
}

function MemberLine({ member }: { member: ZoneMember }) {
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
    </Box>
  )
}

function FlowsOf({ title, flows, zonesById }: { title: string; flows: MicrosegFlow[]; zonesById: Map<string, MicrosegZone> }) {
  const t = useTranslations('microsegPilot.overview.panel')
  const paged = usePaged(flows, FLOWS_PAGE_SIZE)
  return (
    <Box sx={{ mt: 1.5 }}>
      <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>{title}</Typography>
      {flows.length === 0 && <Typography variant='body2' color='text.disabled'>{t('noFlows')}</Typography>}
      {paged.rows.map(flow => (
        <Box key={flow.id} sx={{ display: 'flex', minHeight: 28, alignItems: 'center' }}><FlowSummary flow={flow} zonesById={zonesById} /></Box>
      ))}
      <PolicyPager count={paged.count} page={paged.page} size={paged.size} onPage={paged.setPage} />
    </Box>
  )
}

/** The zone clicked on the map: its members (ten per page) and the flows in and out, with the two ways to change it. */
export default function ZonePanel({ zone, members, membersKnown, flows, zonesById, onClose, onEdit, onAssign }: Props) {
  const t = useTranslations('microsegPilot.overview.panel')
  const ts = useTranslations('microsegPilot.policy.zone')
  const paged = usePaged(members)
  const { incoming, outgoing } = flowsOfZone(zone.id, flows)

  return (
    <Box
      component='aside'
      aria-label={t('label', { name: zone.name })}
      sx={{ width: { xs: '100%', lg: 400 }, flexShrink: 0, minWidth: 0, border: 1, borderColor: 'divider', borderRadius: 1, p: 2, maxHeight: 560, overflowY: 'auto' }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <i className='ri-shield-fill' style={{ fontSize: 18, color: zone.color || undefined }} />
        <Tooltip title={zone.name}><Typography noWrap fontWeight={600} sx={{ flex: '1 1 0', minWidth: 0 }}>{zone.name}</Typography></Tooltip>
        <Chip
          size='small'
          variant='outlined'
          label={ts(`state.${zone.state}`)}
          icon={<Box component='span' sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: STATE_DOT[zone.state] }} />}
          sx={{ flexShrink: 0 }}
        />
        <IconButton size='small' aria-label={t('close')} onClick={onClose}><i className='ri-close-line' /></IconButton>
      </Box>
      {zone.label && <Typography noWrap variant='body2' color='text.secondary'>{zone.label}</Typography>}

      <Box sx={{ display: 'flex', gap: 1, my: 1.5, flexWrap: 'wrap' }}>
        <Button size='small' variant='outlined' startIcon={<i className='ri-pencil-line' />} onClick={onEdit}>{t('editInPolicy')}</Button>
        <Button size='small' variant='contained' startIcon={<i className='ri-add-circle-line' />} onClick={onAssign}>{t('assign')}</Button>
      </Box>

      <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>{t('members')}</Typography>
      {!membersKnown && <Typography variant='body2' color='text.disabled'>{t('membersUnknown')}</Typography>}
      {membersKnown && members.length === 0 && <Typography variant='body2' color='text.disabled'>{t('noMembers')}</Typography>}
      <Box role='list'>
        {paged.rows.map(m => <MemberLine key={`${m.ref.type}/${m.ref.vmid}`} member={m} />)}
      </Box>
      <PolicyPager count={paged.count} page={paged.page} size={paged.size} onPage={paged.setPage} />

      <FlowsOf title={ts('incoming')} flows={incoming} zonesById={zonesById} />
      <FlowsOf title={ts('outgoing')} flows={outgoing} zonesById={zonesById} />
    </Box>
  )
}
