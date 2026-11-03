'use client'

import { useContext, useState } from 'react'
import { Box, Button } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { MicrosegFlow, MicrosegZone, ZoneState } from '@/lib/microseg/types'

import AssignGuestsDialog from './AssignGuestsDialog'
import { useDialogAction } from './dialogParts'
import FlowDialog, { type FlowSaveValues } from './FlowDialog'
import FlowList from './FlowList'
import MicrosegConfirmDialog from './MicrosegConfirmDialog'
import MicrosegErrorAlert from './MicrosegErrorAlert'
import { MicrosegActionsSlot, SlotActions } from './microsegAccess'
import type { MicrosegSubTabProps } from './microsegTabTypes'
import ZoneDialog from './ZoneDialog'
import type { ZoneFormValues } from './zoneForm'
import ZoneList from './ZoneList'
import { ZoneStateConfirm } from './ZonePanelActions'
import { useZoneEdits } from './useZoneEdits'
import { useZoneGuests } from './useZoneGuests'

type Editing<T> = { item: T | null } | null
type Deleting = { kind: 'zone'; zone: MicrosegZone } | { kind: 'flow'; flow: MicrosegFlow } | null

/**
 * The Policy sub-tab: zones and flows of the draft. Every write carries the
 * draft version; a VERSION_CONFLICT reloads the policy and keeps the dialog
 * (and its input) open. A zone state change starts a run, followed in the strip
 * of the tab (it survives a switch of sub-tab).
 */
export default function PolicyPanel({ connectionId, policy, reloadPolicy, startRun, onOpenPlan, onOpenPreflight }: MicrosegSubTabProps) {
  const t = useTranslations('microsegPilot.policy')
  const inSlot = useContext(MicrosegActionsSlot) !== null
  const { guests, status: guestsStatus } = useZoneGuests(connectionId)

  const [zoneDialog, setZoneDialog] = useState<Editing<MicrosegZone>>(null)
  const [flowDialog, setFlowDialog] = useState<Editing<MicrosegFlow>>(null)
  const [deleting, setDeleting] = useState<Deleting>(null)
  // Every state change goes through a dialog: it is applied at once, with the whole draft (UA30).
  const [changing, setChanging] = useState<{ zone: MicrosegZone; state: ZoneState } | null>(null)
  const [assigning, setAssigning] = useState<MicrosegZone | null>(null)
  const removal = useDialogAction()
  const edits = useZoneEdits({ connectionId, policy, reloadPolicy, startRun, onOpenPlan })

  const saveZone = (zone: MicrosegZone | null) => async (values: ZoneFormValues) => {
    await edits.saveZone(zone, values)
    setZoneDialog(null)
  }

  const saveFlow = (flow: MicrosegFlow | null) => async (values: FlowSaveValues) => {
    await edits.saveFlow(flow, values)
    setFlowDialog(null)
  }

  const confirmDelete = async () => {
    if (!deleting) return
    const ok = await removal.run(() => (deleting.kind === 'zone' ? edits.deleteZone(deleting.zone) : edits.deleteFlow(deleting.flow)))
    if (ok) setDeleting(null)
  }

  const onSetState = (zone: MicrosegZone, state: ZoneState) => {
    edits.clearMemberError()
    setChanging({ zone, state })
  }

  return (
    <Box>
      {onOpenPreflight && (
        <SlotActions order={1}>
          {/* In place (no slot): its own right-aligned row above the sections. */}
          <Box sx={{ display: inSlot ? 'contents' : 'flex', justifyContent: 'flex-end', mb: inSlot ? 0 : 1 }}>
            <Button size='small' variant='outlined' startIcon={<i className='ri-heart-pulse-line' />} onClick={onOpenPreflight}>{t('preflightButton')}</Button>
          </Box>
        </SlotActions>
      )}
      {edits.memberError != null && <MicrosegErrorAlert error={edits.memberError} onClose={edits.clearMemberError} />}

      <ZoneList
        zones={policy.zones}
        flows={policy.flows}
        tagPrefix={policy.policy.tag_prefix}
        guests={guests}
        guestsStatus={guestsStatus}
        pendingMembers={policy.pending_members}
        onAdd={() => setZoneDialog({ item: null })}
        onEdit={zone => setZoneDialog({ item: zone })}
        onDelete={zone => { removal.reset(); setDeleting({ kind: 'zone', zone }) }}
        onSetState={onSetState}
        onAssign={setAssigning}
        onRemoveMember={ref => edits.changeMember(ref, '')}
        removeBusy={edits.memberBusy}
      />
      <FlowList
        flows={policy.flows}
        zones={policy.zones}
        onAdd={() => setFlowDialog({ item: null })}
        onEdit={flow => setFlowDialog({ item: flow })}
        onDelete={flow => { removal.reset(); setDeleting({ kind: 'flow', flow }) }}
      />

      {zoneDialog && <ZoneDialog zone={zoneDialog.item} onSave={saveZone(zoneDialog.item)} onClose={() => setZoneDialog(null)} />}
      {flowDialog && <FlowDialog flow={flowDialog.item} zones={policy.zones} onSave={saveFlow(flowDialog.item)} onClose={() => setFlowDialog(null)} />}
      {assigning && (
        <AssignGuestsDialog
          open
          connectionId={connectionId}
          zone={assigning}
          policy={policy}
          reloadPolicy={reloadPolicy}
          onClose={() => setAssigning(null)}
        />
      )}
      {changing && <ZoneStateConfirm zone={changing.zone} state={changing.state} edits={edits} onClose={() => setChanging(null)} />}
      <MicrosegConfirmDialog
        open={deleting !== null}
        title={deleting?.kind === 'zone' ? t('delete.zoneTitle', { name: deleting.zone.name }) : t('delete.flowTitle')}
        body={deleting?.kind === 'zone' ? t('delete.zoneBody') : t('delete.flowBody')}
        confirmLabel={t('delete.confirm')}
        color='error'
        busy={removal.busy}
        error={removal.error}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </Box>
  )
}
