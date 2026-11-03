'use client'

import { useState, type MouseEvent, type ReactNode } from 'react'
import { Box, IconButton } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { MicrosegFlow, MicrosegZone, ZoneState } from '@/lib/microseg/types'

import { useDialogAction } from './dialogParts'
import FlowDialog, { type FlowSaveValues } from './FlowDialog'
import MicrosegConfirmDialog from './MicrosegConfirmDialog'
import { WriteTip, useMicrosegWrite } from './microsegAccess'
import type { ZoneEdits } from './useZoneEdits'
import ZoneDialog from './ZoneDialog'
import ZoneEnforceDialog from './ZoneEnforceDialog'
import { ZoneStateMenu } from './ZoneRow'
import ZoneStateDialog from './ZoneStateDialog'
import type { ZoneFormValues } from './zoneForm'
import type { ZoneMember } from './zoneModel'

/** A compact write control: an icon with its tooltip, disabled (with the read-only hint) without the right. */
function WriteIcon({ label, icon, disabled = false, onClick, ...aria }: {
  label: string
  icon: string
  disabled?: boolean
  onClick: (e: MouseEvent<HTMLElement>) => void
  'aria-haspopup'?: 'menu'
}) {
  const { canWrite } = useMicrosegWrite()
  return (
    <WriteTip title={label}>
      <IconButton size='small' aria-label={label} disabled={!canWrite || disabled} onClick={onClick} {...aria}>
        <i className={icon} />
      </IconButton>
    </WriteTip>
  )
}

/**
 * The confirmation of a state change, the same as on the Policy sub-tab: enforcement checks the readiness (and asks the
 * name when not ready), every change is refused while the draft has pending changes, with the way to the plan.
 */
export function ZoneStateConfirm({ zone, state, edits, onClose }: { zone: MicrosegZone; state: ZoneState; edits: ZoneEdits; onClose: () => void }) {
  const { onOpenPlan, pendingChanges } = edits
  const viewPlan = onOpenPlan ? () => { onClose(); onOpenPlan() } : undefined
  const confirm = async () => {
    await edits.setZoneState(zone, state)
    onClose()
  }
  if (state === 'enforce') {
    return (
      <ZoneEnforceDialog
        connectionId={edits.connectionId}
        zone={zone}
        readyAfterHours={edits.readyAfterHours}
        pending={pendingChanges.pending}
        pendingCount={pendingChanges.count}
        onViewPlan={viewPlan}
        onConfirm={confirm}
        onCancel={onClose}
      />
    )
  }
  return (
    <ZoneStateDialog
      zone={zone}
      state={state}
      pending={pendingChanges.pending}
      pendingCount={pendingChanges.count}
      onViewPlan={viewPlan}
      onConfirm={confirm}
      onCancel={onClose}
    />
  )
}

type ZoneDialogOpen = { kind: 'edit' } | { kind: 'delete' } | { kind: 'state'; state: ZoneState } | null

/** Edit, state, delete and assign of the zone of the panel, one row of icons, with their dialogs. */
export function ZoneHeaderActions({ zone, edits, onAssign, onDeleted }: { zone: MicrosegZone; edits: ZoneEdits; onAssign: () => void; onDeleted: () => void }) {
  const t = useTranslations('microsegPilot.overview.zonePanel')
  const tp = useTranslations('microsegPilot.policy')
  const [open, setOpen] = useState<ZoneDialogOpen>(null)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const removal = useDialogAction()
  const close = () => setOpen(null)

  const save = async (values: ZoneFormValues) => {
    await edits.saveZone(zone, values)
    close()
  }
  const confirmDelete = async () => {
    if (await removal.run(() => edits.deleteZone(zone))) {
      close()
      onDeleted()
    }
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>
      <WriteIcon label={t('edit')} icon='ri-pencil-line' onClick={() => setOpen({ kind: 'edit' })} />
      <WriteIcon label={t('changeState')} icon='ri-toggle-line' aria-haspopup='menu' onClick={e => setAnchor(e.currentTarget)} />
      <WriteIcon label={t('delete')} icon='ri-delete-bin-line' onClick={() => { removal.reset(); setOpen({ kind: 'delete' }) }} />
      <WriteIcon label={t('assign')} icon='ri-add-circle-line' onClick={onAssign} />
      <ZoneStateMenu zone={zone} anchor={anchor} onClose={() => setAnchor(null)} onPick={state => setOpen({ kind: 'state', state })} />
      {open?.kind === 'edit' && <ZoneDialog zone={zone} onSave={save} onClose={close} />}
      {open?.kind === 'state' && <ZoneStateConfirm zone={zone} state={open.state} edits={edits} onClose={close} />}
      <MicrosegConfirmDialog
        open={open?.kind === 'delete'}
        title={tp('delete.zoneTitle', { name: zone.name })}
        body={tp('delete.zoneBody')}
        confirmLabel={tp('delete.confirm')}
        color='error'
        busy={removal.busy}
        error={removal.error}
        onConfirm={confirmDelete}
        onCancel={close}
      />
    </Box>
  )
}

/**
 * Takes a member out of the zone (queued: the next apply removes the tag), or cancels a removal already queued by
 * clearing that pending change (the draft loses it, nothing is queued instead).
 */
export function MemberAction({ member, zoneId, edits }: { member: ZoneMember; zoneId: string; edits: ZoneEdits }) {
  const t = useTranslations('microsegPilot.overview.zonePanel')
  if (member.change?.kind === 'removal') {
    return <WriteIcon label={t('keepMember')} icon='ri-arrow-go-back-line' disabled={edits.memberBusy} onClick={() => edits.keepMember(member.ref)} />
  }
  return <WriteIcon label={t('removeMember')} icon='ri-close-line' disabled={edits.memberBusy} onClick={() => edits.changeMember(member.ref, '')} />
}

/** Edit and delete of a flow line of the panel. */
export function FlowRowActions({ flow, onEdit, onDelete }: { flow: MicrosegFlow; onEdit: (flow: MicrosegFlow) => void; onDelete: (flow: MicrosegFlow) => void }) {
  const t = useTranslations('microsegPilot.overview.zonePanel')
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
      <WriteIcon label={t('editFlow')} icon='ri-pencil-line' onClick={() => onEdit(flow)} />
      <WriteIcon label={t('deleteFlow')} icon='ri-delete-bin-line' onClick={() => onDelete(flow)} />
    </Box>
  )
}

export function NewFlowButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <WriteIcon label={label} icon='ri-add-line' onClick={onClick} />
}

type FlowInitial = Partial<Pick<FlowSaveValues, 'src_zone_id' | 'dst_zone_id'>>
type FlowEditing = { flow: MicrosegFlow | null; initial?: FlowInitial } | null

/** The flow dialog (edit, or a new flow prefilled) and the delete confirmation of the panel. */
export function useFlowEditor(edits: ZoneEdits): {
  edit: (flow: MicrosegFlow) => void
  create: (initial: FlowInitial) => void
  remove: (flow: MicrosegFlow) => void
  dialogs: ReactNode
} {
  const tp = useTranslations('microsegPilot.policy')
  const [editing, setEditing] = useState<FlowEditing>(null)
  const [deleting, setDeleting] = useState<MicrosegFlow | null>(null)
  const removal = useDialogAction()

  const save = async (values: FlowSaveValues) => {
    await edits.saveFlow(editing?.flow ?? null, values)
    setEditing(null)
  }
  const confirmDelete = async () => {
    if (deleting && await removal.run(() => edits.deleteFlow(deleting))) setDeleting(null)
  }

  const dialogs = (
    <>
      {editing && <FlowDialog flow={editing.flow} zones={edits.zones} initial={editing.initial} onSave={save} onClose={() => setEditing(null)} />}
      <MicrosegConfirmDialog
        open={deleting !== null}
        title={tp('delete.flowTitle')}
        body={tp('delete.flowBody')}
        confirmLabel={tp('delete.confirm')}
        color='error'
        busy={removal.busy}
        error={removal.error}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  )

  return {
    edit: flow => setEditing({ flow }),
    create: initial => setEditing({ flow: null, initial }),
    remove: flow => { removal.reset(); setDeleting(flow) },
    dialogs,
  }
}
