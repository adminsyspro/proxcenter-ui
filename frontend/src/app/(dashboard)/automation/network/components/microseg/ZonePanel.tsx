'use client'

import { Box, Chip, IconButton, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { StatusIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'
import type { MicrosegFlow, MicrosegZone } from '@/lib/microseg/types'

import FlowSummary from './FlowSummary'
import MicrosegErrorAlert from './MicrosegErrorAlert'
import PolicyPager, { usePaged } from './PolicyPager'
import { MemberChangeChip, STATE_DOT } from './ZoneRow'
import { FlowRowActions, MemberAction, NewFlowButton, ZoneHeaderActions, useFlowEditor } from './ZonePanelActions'
import type { ZoneEdits } from './useZoneEdits'
import { flowsOfZone, type ZoneMember } from './zoneModel'

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

function FlowsOf({ title, newLabel, flows, zonesById, editor, onNew }: {
  title: string
  newLabel: string
  flows: MicrosegFlow[]
  zonesById: Map<string, MicrosegZone>
  editor: FlowEditor
  onNew: () => void
}) {
  const t = useTranslations('microsegPilot.overview.panel')
  const paged = usePaged(flows, FLOWS_PAGE_SIZE)
  return (
    <Box component='section' aria-label={title} sx={{ mt: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <Typography variant='caption' color='text.secondary' noWrap sx={{ display: 'block', flex: '1 1 0', minWidth: 0 }}>{title}</Typography>
        <NewFlowButton label={newLabel} onClick={onNew} />
      </Box>
      {flows.length === 0 && <Typography variant='body2' color='text.disabled'>{t('noFlows')}</Typography>}
      {paged.rows.map(flow => (
        <Box key={flow.id} sx={{ display: 'flex', minHeight: 28, alignItems: 'center', gap: 0.5, minWidth: 0 }}>
          <FlowSummary flow={flow} zonesById={zonesById} />
          <FlowRowActions flow={flow} onEdit={editor.edit} onDelete={editor.remove} />
        </Box>
      ))}
      <PolicyPager count={paged.count} page={paged.page} size={paged.size} onPage={paged.setPage} />
    </Box>
  )
}

/** The zone clicked on the map: its members (ten per page) and the flows in and out, all editable in place. */
export default function ZonePanel({ zone, members, membersKnown, flows, zonesById, edits, onClose, onAssign }: Props) {
  const t = useTranslations('microsegPilot.overview.panel')
  const tz = useTranslations('microsegPilot.overview.zonePanel')
  const ts = useTranslations('microsegPilot.policy.zone')
  const paged = usePaged(members)
  const editor = useFlowEditor(edits)
  const { incoming, outgoing } = flowsOfZone(zone.id, flows)

  return (
    <Box
      component='aside'
      aria-label={t('label', { name: zone.name })}
      sx={{ width: { xs: '100%', lg: 400 }, flexShrink: 0, minWidth: 0, border: 1, borderColor: 'divider', borderRadius: 1, p: 2, maxHeight: 560, overflowY: 'auto', overflowX: 'hidden' }}
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

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, my: 1 }}>
        <Tooltip title={zone.label}>
          <Typography noWrap variant='body2' color='text.secondary' sx={{ flex: '1 1 0', minWidth: 0 }}>{zone.label}</Typography>
        </Tooltip>
        <ZoneHeaderActions zone={zone} edits={edits} onAssign={onAssign} onDeleted={onClose} />
      </Box>

      <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>{t('members')}</Typography>
      {edits.memberError != null && <MicrosegErrorAlert error={edits.memberError} onClose={edits.clearMemberError} />}
      {!membersKnown && <Typography variant='body2' color='text.disabled'>{t('membersUnknown')}</Typography>}
      {membersKnown && members.length === 0 && <Typography variant='body2' color='text.disabled'>{t('noMembers')}</Typography>}
      <Box role='list'>
        {paged.rows.map(m => <MemberLine key={`${m.ref.type}/${m.ref.vmid}`} member={m} zoneId={zone.id} edits={edits} />)}
      </Box>
      <PolicyPager count={paged.count} page={paged.page} size={paged.size} onPage={paged.setPage} />

      <FlowsOf title={ts('incoming')} newLabel={tz('newIncoming')} flows={incoming} zonesById={zonesById} editor={editor} onNew={() => editor.create({ dst_zone_id: zone.id })} />
      <FlowsOf title={ts('outgoing')} newLabel={tz('newOutgoing')} flows={outgoing} zonesById={zonesById} editor={editor} onNew={() => editor.create({ src_zone_id: zone.id })} />
      {editor.dialogs}
    </Box>
  )
}
