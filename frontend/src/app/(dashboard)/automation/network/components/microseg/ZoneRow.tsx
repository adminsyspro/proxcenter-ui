'use client'

import { useState } from 'react'
import { Box, Button, Chip, Collapse, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { StatusIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'
import type { DiffKind } from '@/lib/microseg/pendingChanges'
import type { GuestRef, MicrosegFlow, MicrosegZone, ZoneState } from '@/lib/microseg/types'

import DiffChip from './DiffChip'
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
  /** How the zone differs from the applied revision, and each flow; null while the revision is read. */
  diffKind?: DiffKind
  flowDiff: ReadonlyMap<string, DiffKind> | null
  open: boolean
  onToggle: () => void
  onAddFlow: (zone: MicrosegZone) => void
  onEditFlow: (flow: MicrosegFlow) => void
  onDeleteFlow: (flow: MicrosegFlow) => void
}

/** The row actions show on hover or focus, and always on a touch screen (no hover). */
const HOVER_ACTIONS = {
  '& .zone-actions': { opacity: 0, transition: 'opacity 120ms' },
  '&:hover .zone-actions, &:focus-within .zone-actions': { opacity: 1 },
  '@media (hover: none)': { '& .zone-actions': { opacity: 1 } },
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

type FlowLinesProps = Pick<ZoneRowProps, 'zonesById' | 'flowDiff' | 'onEditFlow' | 'onDeleteFlow'> & { title: string; flows: MicrosegFlow[] }

function FlowLines({ title, flows, zonesById, flowDiff, onEditFlow, onDeleteFlow }: FlowLinesProps) {
  const t = useTranslations('microsegPilot.policy')
  const { canWrite } = useMicrosegWrite()
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>{title}</Typography>
      {flows.length === 0
        ? <Typography variant='body2' color='text.disabled'>{t('zone.noFlows')}</Typography>
        : flows.map(flow => (
          <Box key={flow.id} sx={{ display: 'flex', minHeight: 32, alignItems: 'center', gap: 0.5, minWidth: 0 }}>
            <FlowSummary flow={flow} zonesById={zonesById} />
            <DiffChip kind={flowDiff?.get(flow.id)} />
            <WriteTip title={t('flow.edit')}>
              <IconButton size='small' aria-label={t('flow.edit')} disabled={!canWrite} onClick={() => onEditFlow(flow)}><i className='ri-pencil-line' /></IconButton>
            </WriteTip>
            <WriteTip title={t('flow.delete')}>
              <IconButton size='small' aria-label={t('flow.delete')} disabled={!canWrite} onClick={() => onDeleteFlow(flow)}><i className='ri-delete-bin-line' /></IconButton>
            </WriteTip>
          </Box>
        ))}
    </Box>
  )
}

type DetailsProps = Pick<ZoneRowProps, 'zone' | 'members' | 'membersKnown' | 'flows' | 'zonesById' | 'onAssign' | 'onRemoveMember' | 'removeBusy' | 'flowDiff' | 'onEditFlow' | 'onDeleteFlow'>

/** Two columns side by side: the members on the left, the incoming and outgoing flows on the right (stacked when narrow). */
function ZoneDetails({ zone, members, membersKnown, flows, zonesById, onAssign, onRemoveMember, removeBusy, ...flowProps }: DetailsProps) {
  const t = useTranslations('microsegPilot.policy.zone')
  const { canWrite } = useMicrosegWrite()
  const paged = usePaged(members)
  const { incoming, outgoing } = flowsOfZone(zone.id, flows)

  return (
    <Box sx={{ pl: 7, pr: 2, pb: 1.5, minWidth: 0, display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) minmax(0, 1fr)' }, gap: { xs: 1.5, md: 3 } }}>
      <Box component='section' sx={{ minWidth: 0 }} aria-label={t('membersTitle')}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant='caption' color='text.secondary' sx={{ display: 'block', flex: 1 }}>{t('membersTitle')}</Typography>
          <WriteTip>
            <Button size='small' startIcon={<i className='ri-add-circle-line' />} disabled={!canWrite} onClick={() => onAssign(zone)}>{t('assign')}</Button>
          </WriteTip>
        </Box>
        {membersKnown && members.length === 0 && <Typography variant='body2' color='text.disabled'>{t('noMembers')}</Typography>}
        {!membersKnown && <Typography variant='body2' color='text.disabled'>{t('membersUnknown')}</Typography>}
        {paged.rows.map(m => <MemberLine key={`${m.ref.node}/${m.ref.type}/${m.ref.vmid}`} member={m} busy={!!removeBusy} onRemove={() => onRemoveMember(m.ref)} />)}
        <PolicyPager count={paged.count} page={paged.page} size={paged.size} onPage={paged.setPage} />
      </Box>
      <Box component='section' sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }} aria-label={t('flowsTitle')}>
        <FlowLines title={t('incoming')} flows={incoming} zonesById={zonesById} {...flowProps} />
        <FlowLines title={t('outgoing')} flows={outgoing} zonesById={zonesById} {...flowProps} />
      </Box>
    </Box>
  )
}

/**
 * One zone on one compact line: chevron, coloured shield with its state dot, name, description, state chip (a menu),
 * diff badge, counters (members, incoming, outgoing), then the actions (edit, state, a flow into the zone, delete)
 * on hover or focus. The chevron opens the members and the flows side by side.
 */
export default function ZoneRow(props: ZoneRowProps) {
  const { zone, members, membersKnown, flows, diffKind, open, onToggle, onEdit, onDelete, onSetState, onAddFlow } = props
  const t = useTranslations('microsegPilot.policy.zone')
  const tp = useTranslations('microsegPilot.policy')
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const { canWrite } = useMicrosegWrite()
  const { incoming, outgoing } = flowsOfZone(zone.id, flows)
  const membersText = membersKnown ? t('memberCount', { count: members.length }) : t('memberCountUnknown')

  return (
    <Box role='listitem' aria-label={zone.name} sx={{ borderBottom: 1, borderColor: 'divider', ...HOVER_ACTIONS }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 44, px: 1 }}>
        <IconButton size='small' aria-expanded={open} aria-label={open ? tp('hideDetails') : tp('showDetails')} onClick={onToggle}>
          <i className={open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} />
        </IconButton>
        <ZoneGlyph zone={zone} label={t(`state.${zone.state}`)} />
        <Tooltip title={zone.name}><Typography noWrap fontWeight={600} sx={{ flex: '0 1 auto', maxWidth: 220 }}>{zone.name}</Typography></Tooltip>
        <Tooltip title={zone.label}><Typography noWrap variant='body2' color='text.secondary' sx={{ flex: '1 1 0', minWidth: 0 }}>{zone.label}</Typography></Tooltip>
        <ZoneStateChip state={zone.state} onClick={canWrite ? setAnchor : undefined} />
        <DiffChip kind={diffKind} />
        <Typography noWrap variant='body2' color='text.secondary' sx={{ flexShrink: 0 }}>
          {t('counters', { members: membersText, incoming: incoming.length, outgoing: outgoing.length })}
        </Typography>
        <Box className='zone-actions' sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <WriteTip title={t('edit')}>
            <IconButton size='small' aria-label={t('edit')} disabled={!canWrite} onClick={() => onEdit(zone)}><i className='ri-pencil-line' /></IconButton>
          </WriteTip>
          <WriteTip title={t('changeState')}>
            <IconButton size='small' aria-label={t('changeState')} aria-haspopup='menu' disabled={!canWrite} onClick={e => setAnchor(e.currentTarget)}>
              <i className='ri-toggle-line' />
            </IconButton>
          </WriteTip>
          <WriteTip title={t('addFlowInto', { zone: zone.name })}>
            <IconButton size='small' aria-label={t('addFlowInto', { zone: zone.name })} disabled={!canWrite} onClick={() => onAddFlow(zone)}><i className='ri-route-line' /></IconButton>
          </WriteTip>
          <WriteTip title={t('delete')}>
            <IconButton size='small' aria-label={t('delete')} disabled={!canWrite} onClick={() => onDelete(zone)}><i className='ri-delete-bin-line' /></IconButton>
          </WriteTip>
        </Box>
        <ZoneStateMenu zone={zone} anchor={anchor} onClose={() => setAnchor(null)} onPick={state => onSetState(zone, state)} />
      </Box>
      <Collapse in={open} unmountOnExit>
        <ZoneDetails {...props} />
      </Collapse>
    </Box>
  )
}

/** A zone the draft removed: struck through with its badge until the next apply, without actions. */
export function RemovedZoneRow({ zone }: { zone: MicrosegZone }) {
  const t = useTranslations('microsegPilot.policy.zone')
  return (
    <Box role='listitem' aria-label={zone.name} data-removed sx={{ borderBottom: 1, borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 44, px: 1, opacity: 0.7 }}>
        <Box sx={{ width: 34, flexShrink: 0 }} />
        <ZoneGlyph zone={zone} label={t(`state.${zone.state}`)} />
        <Typography noWrap fontWeight={600} sx={{ flex: '0 1 auto', maxWidth: 220, textDecoration: 'line-through' }}>{zone.name}</Typography>
        <Typography noWrap variant='body2' color='text.secondary' sx={{ flex: '1 1 0', minWidth: 0, textDecoration: 'line-through' }}>{zone.label}</Typography>
        <DiffChip kind='removed' />
      </Box>
    </Box>
  )
}
