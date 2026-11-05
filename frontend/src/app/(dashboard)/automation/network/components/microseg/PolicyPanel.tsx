'use client'

import { useContext, useState } from 'react'
import { Box, Button } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { MicrosegZone, ZoneState } from '@/lib/microseg/types'

import AssignGuestsDialog from './AssignGuestsDialog'
import { useDialogAction } from './dialogParts'
import FlowTable from './FlowTable'
import MicrosegConfirmDialog from './MicrosegConfirmDialog'
import MicrosegErrorAlert from './MicrosegErrorAlert'
import { MicrosegActionsSlot, SlotActions } from './microsegAccess'
import type { MicrosegSubTabProps } from './microsegTabTypes'
import ZoneDialog from './ZoneDialog'
import { zoneGateOf } from './zoneGate'
import type { ZoneFormValues } from './zoneForm'
import ZoneList from './ZoneList'
import { ZoneStateConfirm, useFlowEditor } from './ZonePanelActions'
import { useZoneUncovered } from './useZoneUncovered'
import { usePendingChanges } from './usePendingChanges'
import { useZoneEdits } from './useZoneEdits'
import { useZoneGuests } from './useZoneGuests'

type Editing<T> = { item: T | null } | null

/**
 * The Policy sub-tab: zones of the draft (one compact line each, members and flows side by side under the chevron),
 * then its flows as one table grouped by destination zone, each zone and flow marked with how it differs from the
 * applied revision, each zone group with the traffic into it no flow covered over 24 hours (one history read for the
 * tab, no Proxmox call).
 * Every write carries the draft version; a VERSION_CONFLICT reloads the policy and keeps the dialog (and its input)
 * open. A zone state change starts a run, followed in the strip of the tab (it survives a switch of sub-tab).
 */
export default function PolicyPanel({ connectionId, policy, reloadPolicy, goToSubTab, startRun, onOpenPlan, onOpenPreflight }: MicrosegSubTabProps) {
  const t = useTranslations('microsegPilot.policy')
  const inSlot = useContext(MicrosegActionsSlot) !== null
  const { guests, status: guestsStatus } = useZoneGuests(connectionId)

  const [zoneDialog, setZoneDialog] = useState<Editing<MicrosegZone>>(null)
  const [deleting, setDeleting] = useState<MicrosegZone | null>(null)
  // Every state change goes through a dialog: it is applied at once, with the whole draft (UA30).
  const [changing, setChanging] = useState<{ zone: MicrosegZone; state: ZoneState } | null>(null)
  const [assigning, setAssigning] = useState<MicrosegZone | null>(null)
  const removal = useDialogAction()
  const edits = useZoneEdits({ connectionId, policy, reloadPolicy, startRun, onOpenPlan })
  const flowEditor = useFlowEditor(edits)
  const { diff } = usePendingChanges(connectionId, policy)
  const uncovered = useZoneUncovered(connectionId)

  const saveZone = (zone: MicrosegZone | null) => async (values: ZoneFormValues) => {
    await edits.saveZone(zone, values)
    setZoneDialog(null)
  }

  const confirmDelete = async () => {
    if (!deleting) return
    const ok = await removal.run(() => edits.deleteZone(deleting))
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
        connectionId={connectionId}
        zones={policy.zones}
        flows={policy.flows}
        tagPrefix={policy.policy.tag_prefix}
        guests={guests}
        guestsStatus={guestsStatus}
        pendingMembers={policy.pending_members}
        diff={diff}
        uncovered={uncovered.failed ? 'failed' : uncovered.series}
        onAdd={() => setZoneDialog({ item: null })}
        onEdit={zone => setZoneDialog({ item: zone })}
        onDelete={zone => { removal.reset(); setDeleting(zone) }}
        onAddFlow={zone => flowEditor.create({ dst_zone_id: zone.id })}
        onOpenDrifts={zone => goToSubTab('drifts', { zoneId: zone.id })}
        onEditFlow={flowEditor.edit}
        onDeleteFlow={flowEditor.remove}
        onSetState={onSetState}
        onAssign={setAssigning}
        onRemoveMember={ref => edits.changeMember(ref, '')}
        removeBusy={edits.memberBusy}
      />
      <FlowTable
        flows={policy.flows}
        zones={policy.zones}
        diff={diff}
        uncovered={uncovered.byZone}
        onOpenObservation={zoneId => goToSubTab('observation', { zoneId })}
        onAdd={dst => flowEditor.create(dst ? { dst_zone_id: dst } : {})}
        onEdit={flowEditor.edit}
        onDelete={flowEditor.remove}
      />

      {zoneDialog && <ZoneDialog zone={zoneDialog.item} onSave={saveZone(zoneDialog.item)} onClose={() => setZoneDialog(null)} gate={zoneGateOf(edits, () => setZoneDialog(null))} />}
      {flowEditor.dialogs}
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
        title={deleting ? t('delete.zoneTitle', { name: deleting.name }) : ''}
        body={t('delete.zoneBody')}
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
