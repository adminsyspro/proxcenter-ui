'use client'

import { useState } from 'react'
import { Box, Button } from '@mui/material'
import { useTranslations } from 'next-intl'

import { microsegApi } from '@/lib/microseg/api'
import type { GuestRef, MicrosegFlow, MicrosegZone, ZoneState } from '@/lib/microseg/types'

import AssignGuestsDialog from './AssignGuestsDialog'
import { isVersionConflict, useDialogAction } from './dialogParts'
import FlowDialog, { type FlowSaveValues } from './FlowDialog'
import FlowList from './FlowList'
import MicrosegConfirmDialog from './MicrosegConfirmDialog'
import MicrosegErrorAlert from './MicrosegErrorAlert'
import type { MicrosegSubTabProps } from './microsegTabTypes'
import ZoneDialog from './ZoneDialog'
import ZoneEnforceDialog from './ZoneEnforceDialog'
import type { ZoneFormValues } from './zoneForm'
import ZoneList from './ZoneList'
import { useZoneGuests } from './useZoneGuests'

const DEFAULT_READY_AFTER_HOURS = 24

type Editing<T> = { item: T | null } | null
type Deleting = { kind: 'zone'; zone: MicrosegZone } | { kind: 'flow'; flow: MicrosegFlow } | null

/**
 * The Policy sub-tab: zones and flows of the draft. Every write carries the
 * draft version; a VERSION_CONFLICT reloads the policy and keeps the dialog
 * (and its input) open. A zone state change starts a run, followed in the strip
 * of the tab (it survives a switch of sub-tab).
 */
export default function PolicyPanel({ connectionId, policy, reloadPolicy, startRun, onOpenPreflight }: MicrosegSubTabProps) {
  const t = useTranslations('microsegPilot.policy')
  const api = microsegApi(connectionId)
  const { guests, status: guestsStatus } = useZoneGuests(connectionId)

  const [zoneDialog, setZoneDialog] = useState<Editing<MicrosegZone>>(null)
  const [flowDialog, setFlowDialog] = useState<Editing<MicrosegFlow>>(null)
  const [deleting, setDeleting] = useState<Deleting>(null)
  const [enforcing, setEnforcing] = useState<MicrosegZone | null>(null)
  const [assigning, setAssigning] = useState<MicrosegZone | null>(null)
  const [actionError, setActionError] = useState<unknown>(null)
  const [removingMember, setRemovingMember] = useState(false)
  const removal = useDialogAction()

  const readyAfterHours = policy.policy.settings?.ready_after_hours || DEFAULT_READY_AFTER_HOURS
  const refresh = () => reloadPolicy().catch(() => undefined)

  /** Runs a write; on success reloads the policy, on a conflict reloads it too and rethrows so the dialog keeps its input. */
  async function write(action: () => Promise<unknown>) {
    try {
      await action()
    } catch (e) {
      if (isVersionConflict(e)) await refresh()
      throw e
    }
    await refresh()
  }

  const saveZone = (zone: MicrosegZone | null) => async (values: ZoneFormValues) => {
    await write(() => api.saveZone({
      id: zone?.id,
      version: policy.version,
      name: values.name,
      label: values.label,
      color: values.color,
      enforcement: zone?.enforcement ?? 'guest',
      vnet_id: zone?.vnet_id ?? '',
      isolate_members: values.isolate_members,
    }))
    setZoneDialog(null)
  }

  const saveFlow = (flow: MicrosegFlow | null) => async (values: FlowSaveValues) => {
    await write(() => api.saveFlow({ id: flow?.id, version: policy.version, ...values }))
    setFlowDialog(null)
  }

  const confirmDelete = async () => {
    if (!deleting) return
    const ok = await removal.run(() => write(() => (
      deleting.kind === 'zone' ? api.deleteZone(deleting.zone.id, policy.version) : api.deleteFlow(deleting.flow.id, policy.version)
    )))
    if (ok) setDeleting(null)
  }

  /** Takes a guest out of every zone: a draft change, the next apply removes the zone tag. */
  const removeMember = (ref: GuestRef) => {
    if (removingMember) return
    setActionError(null)
    setRemovingMember(true)
    write(() => api.setMembers({ version: policy.version, zone_id: '', guests: [ref] }))
      .catch(setActionError)
      .finally(() => setRemovingMember(false))
  }

  const startState = (zone: MicrosegZone, state: ZoneState) => write(async () => {
    const started = await api.setZoneState(zone.id, state, policy.version)
    startRun({ runId: started.run_id, kind: 'zoneState', label: zone.name, runningText: t(`run.running.${state}`, { label: zone.name }) })
  })

  const onSetState = (zone: MicrosegZone, state: ZoneState) => {
    setActionError(null)
    if (state === 'enforce') {
      setEnforcing(zone)
      return
    }
    startState(zone, state).catch(setActionError)
  }

  return (
    <Box>
      {onOpenPreflight && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
          <Button size='small' variant='outlined' startIcon={<i className='ri-heart-pulse-line' />} onClick={onOpenPreflight}>{t('preflightButton')}</Button>
        </Box>
      )}
      {actionError != null && <MicrosegErrorAlert error={actionError} onClose={() => setActionError(null)} />}

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
        onRemoveMember={removeMember}
        removeBusy={removingMember}
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
      {enforcing && (
        <ZoneEnforceDialog
          connectionId={connectionId}
          zone={enforcing}
          readyAfterHours={readyAfterHours}
          onConfirm={async () => { await startState(enforcing, 'enforce'); setEnforcing(null) }}
          onCancel={() => setEnforcing(null)}
        />
      )}
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
