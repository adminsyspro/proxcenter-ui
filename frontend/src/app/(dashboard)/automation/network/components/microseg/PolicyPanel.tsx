'use client'

import { useContext, useMemo, useState } from 'react'
import { Box, Button } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { MicrosegZone, ZoneState } from '@/lib/microseg/types'
import { clustersToRead, useMergedClusters } from '@/lib/microseg/useMerged'
import { useCachedMicrosegStatus } from '@/lib/microseg/useMicrosegStatus'

import AssignGuestsDialog from './AssignGuestsDialog'
import { zoneDeleteBody } from './exceptionModel'
import { shownClusterName } from './ClusterRunRow'
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
import { ZoneStateConfirm, useEgressChange, useFlowEditor } from './ZonePanelActions'
import { useZoneUncovered } from './useZoneUncovered'
import { usePendingChanges } from './usePendingChanges'
import { useZoneEdits, type ExceptionCreated } from './useZoneEdits'
import { useGroupGuests, withUnreachable } from './useGroupGuests'
import { GroupGuestsUnread } from './GroupGuestsUnread'
import { targetPeers } from './targetModel'

type Editing<T> = { item: T | null } | null

/** A cluster named by its ID, when the tab gives no lookup. */
const bareId = (id: string) => id

/**
 * The Policy sub-tab: zones of the draft (one compact line each, members and flows side by side under the chevron),
 * then its flows as one table grouped by destination zone, each zone and flow marked with how it differs from the
 * applied revision, each zone group with the traffic into it no flow covered over 24 hours (one history read for the
 * tab, no Proxmox call).
 * Every write carries the draft version; a VERSION_CONFLICT reloads the policy and keeps the dialog (and its input)
 * open. A zone state change starts a run, followed in the strip of the tab (it survives a switch of sub-tab).
 */
export default function PolicyPanel({ connectionId, policy, reloadPolicy, goToSubTab, startRun, onOpenPlan, onOpenPreflight, anchor, clusterIds, clusterName }: MicrosegSubTabProps) {
  const t = useTranslations('microsegPilot.policy')
  const inSlot = useContext(MicrosegActionsSlot) !== null
  // The guests of every cluster sharing the policy (the connection alone until the group is known).
  const groupIds = clusterIds ?? [connectionId]
  const { guests, status: guestsStatus, errors: readErrors } = useGroupGuests(groupIds)
  const shared = groupIds.length > 1
  // The statuses the banner reads (the visible clusters of a shared policy), from its cache: no request of their own.
  const statusIds = useMemo(
    () => (shared ? groupIds.filter(id => shownClusterName(id, connectionId, clusterName) !== null) : []),
    [shared, groupIds, connectionId, clusterName],
  )
  const { byCluster: statuses } = useMergedClusters(statusIds, useCachedMicrosegStatus)
  const guestErrors = useMemo(() => (shared ? withUnreachable(readErrors, guests, statuses) : readErrors), [shared, readErrors, guests, statuses])

  const [zoneDialog, setZoneDialog] = useState<Editing<MicrosegZone>>(null)
  const [deleting, setDeleting] = useState<MicrosegZone | null>(null)
  // Every state change goes through a dialog: it is applied at once, with the whole draft (UA30).
  const [changing, setChanging] = useState<{ zone: MicrosegZone; state: ZoneState } | null>(null)
  const [assigning, setAssigning] = useState<MicrosegZone | null>(null)
  const removal = useDialogAction()
  const edits = useZoneEdits({ connectionId, policy, reloadPolicy, startRun, onOpenPlan, clusterName })
  const flowEditor = useFlowEditor(edits)
  const egressChange = useEgressChange(edits)
  const { diff } = usePendingChanges(connectionId, policy)
  // Each cluster of a shared policy logs the traffic of its own guests: the history of every one of them is summed.
  const trafficIds = useMemo(() => clustersToRead(connectionId, { anchor, clusterIds }), [connectionId, anchor, clusterIds])
  const uncovered = useZoneUncovered(connectionId, trafficIds)
  // The details of a zone card show the zone panel of the map: they write through the same edits.
  const peers = useMemo(() => targetPeers(guests), [guests])
  const memberCluster = shared ? clusterName ?? bareId : undefined
  // Some cluster's guests could not be read: each zone card and zone panel says its members are not all counted.
  const membersNote = useMemo(
    () => (guestsStatus === 'ready' && Object.keys(guestErrors).length > 0 ? <GroupGuestsUnread errors={guestErrors} clusterName={clusterName} counted /> : null),
    [guestsStatus, guestErrors, clusterName],
  )
  const work = useMemo(
    () => ({ connectionId, edits, version: policy.version, reloadPolicy, peers, clusterName: memberCluster, membersNote }),
    [connectionId, edits, policy.version, reloadPolicy, peers, memberCluster, membersNote],
  )

  const saveZone = (zone: MicrosegZone | null) => async (values: ZoneFormValues, onExceptionCreated: ExceptionCreated) => {
    await edits.saveZone(zone, values, onExceptionCreated)
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
      {guestsStatus === 'ready' && <GroupGuestsUnread errors={guestErrors} clusterName={clusterName} />}

      <ZoneList
        connectionId={connectionId}
        zones={policy.zones}
        flows={policy.flows}
        tagPrefix={policy.policy.tag_prefix}
        guests={guests}
        guestsStatus={guestsStatus}
        membersNote={membersNote}
        pendingMembers={policy.pending_members}
        diff={diff}
        readyAfterHours={edits.readyAfterHours}
        work={work}
        uncovered={uncovered.failed ? 'failed' : uncovered.series}
        onAdd={() => setZoneDialog({ item: null })}
        onEdit={zone => setZoneDialog({ item: zone })}
        onDelete={zone => { removal.reset(); setDeleting(zone) }}
        onAddFlow={zone => flowEditor.create({ dst_zone_id: zone.id })}
        onOpenDrifts={zone => goToSubTab('drifts', { zoneId: zone.id })}
        onEditFlow={flowEditor.edit}
        onDeleteFlow={flowEditor.remove}
        onSetState={onSetState}
        onSetEgress={(zone, action) => { edits.clearMemberError(); egressChange.ask(zone, action) }}
        onAssign={setAssigning}
        onRemoveMember={(ref, cluster) => edits.changeMember(ref, '', cluster)}
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

      {zoneDialog && <ZoneDialog zone={zoneDialog.item} connectionId={connectionId} readyAfterHours={edits.readyAfterHours} onSave={saveZone(zoneDialog.item)} flows={edits.flows} policy={edits.policy} clusterName={clusterName} onClose={() => setZoneDialog(null)} gate={zoneGateOf(edits, () => setZoneDialog(null))} />}
      {flowEditor.dialogs}
      {assigning && (
        <AssignGuestsDialog
          open
          connectionId={connectionId}
          clusterIds={groupIds}
          clusterName={clusterName}
          zone={assigning}
          policy={policy}
          reloadPolicy={reloadPolicy}
          onClose={() => setAssigning(null)}
        />
      )}
      {changing && <ZoneStateConfirm zone={changing.zone} state={changing.state} edits={edits} onClose={() => setChanging(null)} />}
      {egressChange.dialog}
      <MicrosegConfirmDialog
        open={deleting !== null}
        title={deleting ? t('delete.zoneTitle', { name: deleting.name }) : ''}
        body={deleting ? zoneDeleteBody(t, deleting.id, policy.exceptions) : ''}
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
