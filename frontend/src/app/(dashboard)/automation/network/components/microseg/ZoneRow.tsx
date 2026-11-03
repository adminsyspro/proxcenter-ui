'use client'

import { useState } from 'react'
import { Box, Chip, Collapse, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { StatusIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'
import type { GuestRef, MicrosegFlow, MicrosegZone, ZoneState } from '@/lib/microseg/types'

import FlowSummary from './FlowSummary'
import PolicyPager, { usePaged } from './PolicyPager'
import { flowsOfZone, type ZoneMember } from './zoneModel'
import { WriteTip, useMicrosegWrite } from './microsegAccess'
import ZoneStateChip, { STATE_VISUAL } from './ZoneStateChip'

const STATES: ZoneState[] = ['observe', 'enforce', 'disabled']
export const STATE_DOT: Record<ZoneState, string> = { disabled: '#9e9e9e', observe: '#ed6c02', enforce: '#4caf50' }

export type ZoneRowProps = {
  zone: MicrosegZone
  members: ZoneMember[]
  /** False while the guest list is loading or failed: the member count is then unknown. */
  membersKnown: boolean
  flows: MicrosegFlow[]
  zonesById: Map<string, MicrosegZone>
  onEdit: (zone: MicrosegZone) => void
  onDelete: (zone: MicrosegZone) => void
  onSetState: (zone: MicrosegZone, state: ZoneState) => void
  onAssign: (zone: MicrosegZone) => void
  onRemoveMember: (ref: GuestRef) => void
  /** A member removal is in flight: the remove buttons wait. */
  removeBusy?: boolean
}

/** The shield of the zone in its color, with a dot for its state. */
function ZoneGlyph({ zone, label }: { zone: MicrosegZone; label: string }) {
  return (
    <Tooltip title={label}>
      <Box component='span' sx={{ position: 'relative', display: 'inline-flex', width: 18, height: 18, flexShrink: 0 }}>
        <i className='ri-shield-fill' style={{ fontSize: 18, color: zone.color || undefined, opacity: zone.state === 'disabled' ? 0.5 : 1 }} />
        <Box
          component='span'
          sx={{
            position: 'absolute', bottom: -2, right: -3, width: 9, height: 9, borderRadius: '50%', bgcolor: STATE_DOT[zone.state],
            border: '1.5px solid', borderColor: 'background.paper',
          }}
        />
      </Box>
    </Tooltip>
  )
}

/** The change queued for a tagged member: its removal, or its move to another zone. */
export function MemberChangeChip({ member }: { member: ZoneMember }) {
  const t = useTranslations('microsegPilot.policy.zone')
  if (member.change?.kind === 'removal') {
    return (
      <Tooltip title={t('memberRemovalHint')}>
        <Chip size='small' color='warning' variant='outlined' label={t('memberRemoval')} sx={{ flexShrink: 0 }} />
      </Tooltip>
    )
  }
  if (member.change?.kind === 'move') {
    return (
      <Tooltip title={t('memberMoveHint', { zone: member.change.zoneName })}>
        <Chip size='small' color='warning' variant='outlined' label={t('memberMove', { zone: member.change.zoneName })} sx={{ flexShrink: 1, minWidth: 0, maxWidth: 200 }} />
      </Tooltip>
    )
  }
  return null
}

/** The three states of a zone, the current one disabled. */
export function ZoneStateMenu({ zone, anchor, onClose, onPick }: { zone: MicrosegZone; anchor: HTMLElement | null; onClose: () => void; onPick: (state: ZoneState) => void }) {
  const t = useTranslations('microsegPilot.policy.zone')
  return (
    <Menu anchorEl={anchor} open={!!anchor} onClose={onClose}>
      {STATES.map(state => (
        <MenuItem key={state} disabled={state === zone.state} onClick={() => { onClose(); onPick(state) }}>
          <ListItemIcon sx={{ minWidth: 28, color: STATE_VISUAL[state].palette }}><i className={STATE_VISUAL[state].icon} style={{ fontSize: 18 }} /></ListItemIcon>
          <ListItemText>{t(`setState.${state}`)}</ListItemText>
        </MenuItem>
      ))}
    </Menu>
  )
}

function MemberLine({ member, busy, onRemove }: { member: ZoneMember; busy: boolean; onRemove: () => void }) {
  const t = useTranslations('microsegPilot.policy.zone')
  const { canWrite } = useMicrosegWrite()
  const { guest, ref } = member
  const name = guest?.name ?? `${ref.type}/${ref.vmid}`
  const where = `${ref.vmid} · ${ref.node}`
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, minHeight: 28 }}>
      {guest
        ? <StatusIcon type='vm' vmType={guest.type} status={guest.status} />
        : <i className='ri-question-line' style={{ opacity: 0.6 }} />}
      <Tooltip title={name}><Typography noWrap sx={{ flex: '0 1 auto' }}>{name}</Typography></Tooltip>
      <Typography noWrap variant='body2' color='text.secondary' sx={{ flex: '1 1 0', minWidth: 0 }}>{where}</Typography>
      {member.pending && <Chip size='small' color='warning' variant='outlined' label={t('memberPending')} sx={{ flexShrink: 0 }} />}
      <MemberChangeChip member={member} />
      <WriteTip title={t('removeMember')}>
        <IconButton size='small' aria-label={t('removeMember')} disabled={!canWrite || busy || member.change?.kind === 'removal'} onClick={onRemove} sx={{ flexShrink: 0 }}>
          <i className='ri-close-line' />
        </IconButton>
      </WriteTip>
    </Box>
  )
}

function FlowLines({ title, flows, zonesById }: { title: string; flows: MicrosegFlow[]; zonesById: Map<string, MicrosegZone> }) {
  const t = useTranslations('microsegPilot.policy.zone')
  return (
    <Box sx={{ mt: 1 }}>
      <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>{title}</Typography>
      {flows.length === 0
        ? <Typography variant='body2' color='text.disabled'>{t('noFlows')}</Typography>
        : flows.map(flow => (
          <Box key={flow.id} sx={{ display: 'flex', minHeight: 28, alignItems: 'center' }}><FlowSummary flow={flow} zonesById={zonesById} /></Box>
        ))}
    </Box>
  )
}

function ZoneDetails({ zone, members, membersKnown, flows, zonesById, onRemoveMember, removeBusy }: Pick<ZoneRowProps, 'zone' | 'members' | 'membersKnown' | 'flows' | 'zonesById' | 'onRemoveMember' | 'removeBusy'>) {
  const t = useTranslations('microsegPilot.policy.zone')
  const paged = usePaged(members)
  const { incoming, outgoing } = flowsOfZone(zone.id, flows)

  return (
    <Box sx={{ pl: 7, pr: 2, pb: 1.5, minWidth: 0 }}>
      <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>{t('membersTitle')}</Typography>
      {membersKnown && members.length === 0 && <Typography variant='body2' color='text.disabled'>{t('noMembers')}</Typography>}
      {!membersKnown && <Typography variant='body2' color='text.disabled'>{t('membersUnknown')}</Typography>}
      {paged.rows.map(m => <MemberLine key={`${m.ref.node}/${m.ref.type}/${m.ref.vmid}`} member={m} busy={!!removeBusy} onRemove={() => onRemoveMember(m.ref)} />)}
      <PolicyPager count={paged.count} page={paged.page} size={paged.size} onPage={paged.setPage} />
      <FlowLines title={t('incoming')} flows={incoming} zonesById={zonesById} />
      <FlowLines title={t('outgoing')} flows={outgoing} zonesById={zonesById} />
    </Box>
  )
}

/** One zone on one line: chevron, colored shield with its state dot, name, label, state, members, actions. */
export default function ZoneRow({ zone, members, membersKnown, flows, zonesById, onEdit, onDelete, onSetState, onAssign, onRemoveMember, removeBusy }: ZoneRowProps) {
  const t = useTranslations('microsegPilot.policy.zone')
  const tp = useTranslations('microsegPilot.policy')
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const { canWrite } = useMicrosegWrite()
  const running = members.filter(m => m.guest?.status === 'running').length
  const summary = membersKnown ? t('memberSummary', { count: members.length, running }) : '-'

  return (
    <Box role='listitem' aria-label={zone.name} sx={{ borderBottom: 1, borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 48, px: 1 }}>
        <IconButton size='small' aria-expanded={open} aria-label={open ? tp('hideDetails') : tp('showDetails')} onClick={() => setOpen(v => !v)}>
          <i className={open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} />
        </IconButton>
        <ZoneGlyph zone={zone} label={t(`state.${zone.state}`)} />
        <Tooltip title={zone.name}><Typography noWrap fontWeight={600} sx={{ flex: '0 1 auto', maxWidth: 220 }}>{zone.name}</Typography></Tooltip>
        <Tooltip title={zone.label}><Typography noWrap color='text.secondary' sx={{ flex: '1 1 0', minWidth: 0 }}>{zone.label}</Typography></Tooltip>
        <ZoneStateChip state={zone.state} />
        <Typography noWrap variant='body2' color='text.secondary' sx={{ flexShrink: 0 }}>{summary}</Typography>
        <WriteTip title={t('changeState')}>
          <IconButton size='small' aria-label={t('changeState')} aria-haspopup='menu' disabled={!canWrite} onClick={e => setAnchor(e.currentTarget)}>
            <i className='ri-toggle-line' />
          </IconButton>
        </WriteTip>
        <WriteTip title={t('assign')}>
          <IconButton size='small' aria-label={t('assign')} disabled={!canWrite} onClick={() => onAssign(zone)}><i className='ri-add-circle-line' /></IconButton>
        </WriteTip>
        <WriteTip title={t('edit')}>
          <IconButton size='small' aria-label={t('edit')} disabled={!canWrite} onClick={() => onEdit(zone)}><i className='ri-pencil-line' /></IconButton>
        </WriteTip>
        <WriteTip title={t('delete')}>
          <IconButton size='small' aria-label={t('delete')} disabled={!canWrite} onClick={() => onDelete(zone)}><i className='ri-delete-bin-line' /></IconButton>
        </WriteTip>
        <ZoneStateMenu zone={zone} anchor={anchor} onClose={() => setAnchor(null)} onPick={state => onSetState(zone, state)} />
      </Box>
      <Collapse in={open} unmountOnExit>
        <ZoneDetails zone={zone} members={members} membersKnown={membersKnown} flows={flows} zonesById={zonesById} onRemoveMember={onRemoveMember} removeBusy={removeBusy} />
      </Collapse>
    </Box>
  )
}
