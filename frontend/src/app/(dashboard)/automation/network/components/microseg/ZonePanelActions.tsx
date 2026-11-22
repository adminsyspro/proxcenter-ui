'use client'

import { useCallback, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { Box, Button, Chip, IconButton, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { zoneEgress, type MicrosegException, type MicrosegFlow, type MicrosegZone, type ZoneState } from '@/lib/microseg/types'

import { useDialogAction } from './dialogParts'
import DiscardDraft from './DiscardDraft'
import ExceptionDialog, { clusterGuestsRead, exceptionEditable, useExceptionScope } from './ExceptionDialog'
import { exceptionDraft, exceptionsOfZone, ofCluster, zoneDeleteBody, type ExceptionDraft } from './exceptionModel'
import { ExceptionLine } from './ExceptionLine'
import FlowDialog, { type FlowSaveValues } from './FlowDialog'
import FlowSummary from './FlowSummary'
import { PagedList } from './PolicyPager'
import MicrosegConfirmDialog from './MicrosegConfirmDialog'
import { WriteTip, useMicrosegClusterWrite, useMicrosegWrite } from './microsegAccess'
import { usePendingChanges } from './usePendingChanges'
import { useGroupGuests } from './useGroupGuests'
import type { ExceptionCreated, ZoneEdits } from './useZoneEdits'
import { zoneGateOf } from './zoneGate'
import ZoneDialog from './ZoneDialog'
import ZoneEgressDialog from './ZoneEgressDialog'
import ZoneEnforceDialog from './ZoneEnforceDialog'
import { ZoneStateMenu } from './ZoneRow'
import ZoneStateDialog from './ZoneStateDialog'
import type { ZoneFormValues } from './zoneForm'
import type { ZoneMember } from './zoneModel'

/**
 * A compact write control: an icon with its tooltip, disabled (with the reason) without the right: the policy write of
 * the tab, or `allowed` for a write of one cluster's own data.
 */
function WriteIcon({ label, icon, disabled = false, allowed, onClick, ...aria }: {
  label: string
  icon: string
  disabled?: boolean
  allowed?: boolean
  onClick: (e: MouseEvent<HTMLElement>) => void
  'aria-haspopup'?: 'menu'
}) {
  const write = useMicrosegWrite()
  const canWrite = allowed ?? write.canWrite
  return (
    <WriteTip allowed={allowed} title={label}>
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
  // The other way out of the refusal: the pending changes discarded, the state change can then go.
  const discard = pendingChanges.pending
    ? <DiscardDraft connectionId={edits.connectionId} policy={edits.policy} count={pendingChanges.count} variant='outlined' />
    : undefined
  if (state === 'enforce') {
    return (
      <ZoneEnforceDialog
        connectionId={edits.connectionId}
        clusterName={edits.clusterName}
        zone={zone}
        readyAfterHours={edits.readyAfterHours}
        pending={pendingChanges.pending}
        pendingCount={pendingChanges.count}
        onViewPlan={viewPlan}
        discard={discard}
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
      discard={discard}
      onConfirm={confirm}
      onCancel={onClose}
    />
  )
}

export type EgressAction = 'block' | 'reopen'

/**
 * Blocking or reopening the outbound of a zone, the same from the zone panel and from the Policy sub-tab. Blocking
 * always asks (the readiness, the name when not ready). Reopening is one click; with pending changes in the draft
 * it goes through the refusal, as the change applies the whole draft.
 */
export function useEgressChange(edits: ZoneEdits) {
  const [change, setChange] = useState<{ zone: MicrosegZone; action: EgressAction } | null>(null)
  const close = () => setChange(null)
  const ask = (zone: MicrosegZone, action: EgressAction) => {
    if (action === 'reopen' && !edits.pendingChanges.pending) {
      edits.setZoneEgressState(zone, 'observe').catch(edits.reportError)
      return
    }
    setChange({ zone, action })
  }
  const dialog = change ? (
    <ZoneEgressDialog
      connectionId={edits.connectionId}
      zone={change.zone}
      action={change.action}
      readyAfterHours={edits.readyAfterHours}
      gate={zoneGateOf(edits, close)}
      onConfirm={async () => {
        await edits.setZoneEgressState(change.zone, change.action === 'block' ? 'enforce' : 'observe')
        close()
      }}
      onCancel={close}
    />
  ) : null
  return { ask, dialog }
}

type ZoneDialogOpen = { kind: 'edit' } | { kind: 'delete' } | { kind: 'state'; state: ZoneState } | null

/** Edit, state, delete and assign of the zone of the panel, one row of icons, with their dialogs. */
export function ZoneHeaderActions({ zone, edits, onAssign, onDeleted, spread = false }: { zone: MicrosegZone; edits: ZoneEdits; onAssign: () => void; onDeleted: () => void; spread?: boolean }) {
  const t = useTranslations('microsegPilot.overview.zonePanel')
  const tp = useTranslations('microsegPilot.policy')
  const [open, setOpen] = useState<ZoneDialogOpen>(null)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const removal = useDialogAction()
  const egressChange = useEgressChange(edits)
  const close = () => setOpen(null)

  const save = async (values: ZoneFormValues, onExceptionCreated: ExceptionCreated) => {
    await edits.saveZone(zone, values, onExceptionCreated)
    close()
  }
  const confirmDelete = async () => {
    if (await removal.run(() => edits.deleteZone(zone))) {
      close()
      onDeleted()
    }
  }
  const egress = zoneEgress(zone)
  // Assigning writes the members of each guest's cluster: the right on one cluster of the policy opens it.
  const { canWriteSome: canAssign } = useMicrosegClusterWrite()

  return (
    // `spread`: the icons are laid out by the row they sit in (spread over its width), not grouped.
    <Box sx={spread ? { display: 'contents' } : { display: 'flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>
      <WriteIcon label={t('edit')} icon='ri-pencil-line' onClick={() => setOpen({ kind: 'edit' })} />
      {egress === 'observe' && <WriteIcon label={t('egressBlock')} icon='ri-lock-line' onClick={() => egressChange.ask(zone, 'block')} />}
      {egress === 'enforce' && <WriteIcon label={t('egressReopen')} icon='ri-lock-unlock-line' onClick={() => egressChange.ask(zone, 'reopen')} />}
      <WriteIcon label={t('changeState')} icon='ri-toggle-line' aria-haspopup='menu' onClick={e => setAnchor(e.currentTarget)} />
      <WriteIcon label={t('delete')} icon='ri-delete-bin-line' onClick={() => { removal.reset(); setOpen({ kind: 'delete' }) }} />
      <WriteIcon label={t('assign')} icon='ri-add-circle-line' allowed={canAssign} onClick={onAssign} />
      <ZoneStateMenu zone={zone} anchor={anchor} onClose={() => setAnchor(null)} onPick={state => setOpen({ kind: 'state', state })} />
      {open?.kind === 'edit' && <ZoneDialog zone={zone} connectionId={edits.connectionId} readyAfterHours={edits.readyAfterHours} onSave={save} flows={edits.flows} policy={edits.policy} clusterName={edits.clusterName} onClose={close} gate={zoneGateOf(edits, close)} />}
      {open?.kind === 'state' && <ZoneStateConfirm zone={zone} state={open.state} edits={edits} onClose={close} />}
      {egressChange.dialog}
      <MicrosegConfirmDialog
        open={open?.kind === 'delete'}
        title={tp('delete.zoneTitle', { name: zone.name })}
        body={zoneDeleteBody(tp, zone.id, edits.policy.exceptions)}
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
 * clearing that pending change (the draft loses it, nothing is queued instead). Both go through the member's cluster.
 */
export function MemberAction({ member, zoneId, edits }: { member: ZoneMember; zoneId: string; edits: ZoneEdits }) {
  const t = useTranslations('microsegPilot.overview.zonePanel')
  const allowed = useMicrosegClusterWrite().canWriteOn(member.connectionId)
  if (member.change?.kind === 'removal') {
    return <WriteIcon label={t('keepMember')} icon='ri-arrow-go-back-line' disabled={edits.memberBusy} allowed={allowed} onClick={() => edits.keepMember(member.ref, member.connectionId)} />
  }
  return <WriteIcon label={t('removeMember')} icon='ri-close-line' disabled={edits.memberBusy} allowed={allowed} onClick={() => edits.changeMember(member.ref, '', member.connectionId)} />
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

/**
 * A paged list of declared flows, one line each with its edit and delete; the ones the last applied revision does not
 * have marked Draft when `unapplied` is known.
 */
export function FlowsList({ flows, zonesById, editor, size, unapplied = null }: {
  flows: MicrosegFlow[]
  zonesById: Map<string, MicrosegZone>
  editor: Pick<FlowEditor, 'edit' | 'remove'>
  size: number
  unapplied?: ReadonlySet<string> | null
}) {
  const t = useTranslations('microsegPilot.overview')
  return (
    <>
      {flows.length === 0 && <Typography variant='body2' color='text.disabled'>{t('panel.noFlows')}</Typography>}
      <PagedList items={flows} size={size} render={rows => (
        <Box role='list'>
          {rows.map(flow => (
            <Box role='listitem' key={flow.id} sx={{ display: 'flex', minHeight: 28, alignItems: 'center', gap: 0.5, minWidth: 0 }}>
              <FlowSummary flow={flow} zonesById={zonesById} />
              {unapplied?.has(flow.id) && (
                <Tooltip title={t('edge.draft')}><Chip size='small' color='warning' variant='outlined' label={t('flowPanel.draft')} sx={{ flexShrink: 0 }} /></Tooltip>
              )}
              <FlowRowActions flow={flow} onEdit={editor.edit} onDelete={editor.remove} />
            </Box>
          ))}
        </Box>
      )} />
    </>
  )
}

/** An add icon: a flow (the policy write of the tab), or with `allowed` a write of one cluster's own data (an exception). */
export function NewFlowButton({ label, allowed, onClick }: { label: string; allowed?: boolean; onClick: () => void }) {
  return <WriteIcon label={label} icon='ri-add-line' allowed={allowed} onClick={onClick} />
}

/**
 * The add action of a sub-tab of the expand dialog: a small outlined button, icon and label, disabled without the write
 * right (the policy write of the tab, or `allowed` for members and exceptions, written on one cluster).
 */
export function ExpandAddButton({ label, allowed, onClick }: { label: string; allowed?: boolean; onClick: () => void }) {
  const write = useMicrosegWrite()
  const canWrite = allowed ?? write.canWrite
  return (
    <WriteTip allowed={allowed}>
      <Button size='small' variant='outlined' disabled={!canWrite} onClick={onClick} startIcon={<i className='ri-add-line' />} sx={{ height: 30, flexShrink: 0, whiteSpace: 'nowrap' }}>{label}</Button>
    </WriteTip>
  )
}

type FlowInitial = Partial<Pick<FlowSaveValues, 'src_zone_id' | 'dst_zone_id'>>
type FlowEditing = { flow: MicrosegFlow | null; initial?: FlowInitial } | null

type FlowEditor = {
  edit: (flow: MicrosegFlow) => void
  create: (initial: FlowInitial) => void
  remove: (flow: MicrosegFlow) => void
  dialogs: ReactNode
}

/** The flow dialog (edit, or a new flow prefilled) and the delete confirmation of the panel. */
export function useFlowEditor(edits: ZoneEdits): FlowEditor {
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

  // Stable across renders: a consumer can keep them in a memoised value (the Firewalling zone tools).
  const { reset } = removal
  const edit = useCallback((flow: MicrosegFlow) => setEditing({ flow }), [])
  const create = useCallback((initial: FlowInitial) => setEditing({ flow: null, initial }), [])
  const remove = useCallback((flow: MicrosegFlow) => { reset(); setDeleting(flow) }, [reset])

  return { edit, create, remove, dialogs }
}

type ExceptionEditor = {
  /** How many exceptions the zone has. */
  count: number
  /** The user may write an exception on at least one cluster (each is written on its own cluster). */
  canCreate: boolean
  /** Opens the exception dialog empty. */
  create: () => void
  /** The exceptions of the zone, `size` a page. */
  list: (size: number) => ReactNode
  dialogs: ReactNode
}

/**
 * The exceptions of the zone of the panel, written at once (each write carries the draft version): one line each,
 * paged, the pencil opening the exception dialog prefilled, the bin its confirmation, as for a flow of the panel.
 * The guests are the list the tab already holds (no new request when warm): any of them may be a source.
 * `only` keeps the exceptions of the zone with these ids (the panel of a link of the map lists the ones it stands for).
 * As the flows do, the list shows what the draft changes over the last applied revision, once that revision is read:
 * an exception added or changed carries the draft mark, and one removed from the draft, still enforced until the next
 * apply, stays listed struck, after the others.
 * On a shared policy each exception belongs to one cluster: its line shows that cluster, its guests are matched among
 * that cluster's guests, it is written through that cluster, and one of a cluster the user cannot see is not editable.
 */
export function useExceptionEditor(
  edits: ZoneEdits, zone: MicrosegZone, members: ZoneMember[], membersKnown: boolean, only?: ReadonlySet<string>,
): ExceptionEditor {
  const t = useTranslations('microsegPilot.policy')
  // An exception is written on its own cluster: the right on that cluster, not on the whole policy.
  const { canWriteOn, canWriteSome } = useMicrosegClusterWrite()
  const scope = useExceptionScope(edits.policy, edits.connectionId, edits.clusterName)
  const { guests, status, errors } = useGroupGuests(scope.guestIds)
  // While the guests (of any cluster) or the members are not known, a status read from them would be a false warning.
  const guestsKnown = membersKnown && status === 'ready' && Object.keys(errors).length === 0
  const { clusters } = scope
  /** The cluster of an exception on a shared policy (its guests are among that cluster's), none on one cluster. */
  const clusterOf = (e: MicrosegException) => (clusters ? e.connection_id || edits.connectionId : undefined)
  // The exception being edited, `null` for a new one; undefined while the dialog is closed.
  const [editing, setEditing] = useState<ExceptionDraft | null | undefined>(undefined)
  const [deleting, setDeleting] = useState<MicrosegException | null>(null)
  const removal = useDialogAction()
  const all = edits.policy.exceptions
  const exceptions = useMemo(() => exceptionsOfZone(zone.id, all).filter(e => !only || only.has(e.id)), [zone.id, all, only])
  const { diff } = usePendingChanges(edits.connectionId, edits.policy)
  const rows = useMemo(() => {
    const gone = exceptionsOfZone(zone.id, diff?.removedExceptions ?? []).filter(e => !only || only.has(e.id))
    const draft = (e: MicrosegException) => (diff?.exceptions.has(e.id) ? 'draft' as const : undefined)
    return [...exceptions.map(e => ({ e, mark: draft(e) })), ...gone.map(e => ({ e, mark: 'removed' as const }))]
  }, [exceptions, diff, zone.id, only])

  const save = async (draft: ExceptionDraft) => {
    await edits.saveException(zone.id, draft)
    setEditing(undefined)
  }
  const confirmDelete = async () => {
    if (deleting && await removal.run(() => edits.deleteException(deleting.id))) setDeleting(null)
  }

  const list = (size: number) => (
    <>
      {rows.length === 0 && <Typography variant='body2' color='text.disabled'>{t('exceptions.none')}</Typography>}
      <PagedList items={rows} size={size} render={page => (
        <Box role='list'>
          {page.map(({ e, mark }) => {
            const cluster = clusterOf(e)
            return (
              <ExceptionLine
                key={`${mark === 'removed' ? 'removed' : 'draft'}-${e.id}`}
                mark={mark}
                exception={exceptionDraft(e)}
                guests={ofCluster(guests, cluster)}
                members={ofCluster(members, cluster)}
                cluster={clusters && cluster ? { id: cluster, name: clusters.name(cluster) } : undefined}
                zoneState={zone.state}
                guestsKnown={guestsKnown && clusterGuestsRead(clusters, cluster)}
                disabled={!canWriteOn(cluster ?? '') || !exceptionEditable(clusters, cluster)}
                onEdit={() => setEditing(exceptionDraft(e))}
                onDelete={() => { removal.reset(); setDeleting(e) }}
              />
            )
          })}
        </Box>
      )} />
    </>
  )

  const dialogs = (
    <>
      <ExceptionDialog open={editing !== undefined} exception={editing ?? null} guests={guests} members={members} clusters={clusters} onSave={save} onClose={() => setEditing(undefined)} />
      <MicrosegConfirmDialog
        open={deleting !== null}
        title={t('delete.exceptionTitle')}
        body={t('delete.exceptionBody')}
        confirmLabel={t('delete.confirm')}
        color='error'
        busy={removal.busy}
        error={removal.error}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  )

  return { count: exceptions.length, canCreate: canWriteSome, create: () => setEditing(null), list, dialogs }
}
