'use client'

import { useMemo, useState } from 'react'
import { useSWRConfig } from 'swr'
import { useTranslations } from 'next-intl'

import { microsegApi, microsegBaseUrl } from '@/lib/microseg/api'
import { zoneEgress, type EgressState, type GuestRef, type MembersInput, type MicrosegFlow, type MicrosegPolicy, type MicrosegZone, type ZoneState } from '@/lib/microseg/types'

import type { FlowSaveValues } from './FlowDialog'
import type { TrackedRun } from './microsegTabTypes'
import { usePendingChanges } from './usePendingChanges'
import type { ZoneFormValues } from './zoneForm'

const DEFAULT_READY_AFTER_HOURS = 24

export type ZoneEditsInput = {
  connectionId: string
  policy: MicrosegPolicy
  /** Re-reads the draft: after every write, and on a VERSION_CONFLICT. */
  reloadPolicy: () => Promise<unknown>
  /** Follows the run a zone state change starts. */
  startRun: (run: TrackedRun) => void
  /** The plan window, offered when a state change is refused for pending changes. */
  onOpenPlan?: () => void
}

/**
 * The writes on the zones, flows and members of the draft, shared by the Policy sub-tab and the zone panel of the map.
 * Every write carries the draft version. After it, success or not, the policy and the status are read again (the map, the counts and
 * the pending-changes bar follow); on any failure (a VERSION_CONFLICT included) the policy is read again too and the error is rethrown, so the
 * dialog keeps its input and says why. A 400 keeps the server's wording (writeErrorMessage).
 */
export function useZoneEdits({ connectionId, policy, reloadPolicy, startRun, onOpenPlan }: ZoneEditsInput) {
  const t = useTranslations('microsegPilot.policy')
  const { mutate } = useSWRConfig()
  const api = useMemo(() => microsegApi(connectionId), [connectionId])
  const pendingChanges = usePendingChanges(connectionId, policy)
  const [memberBusy, setMemberBusy] = useState(false)
  const [memberError, setMemberError] = useState<unknown>(null)
  const { version } = policy

  const refresh = async () => {
    await Promise.all([
      reloadPolicy().catch(() => undefined),
      Promise.resolve(mutate(`${microsegBaseUrl(connectionId)}/status`)).catch(() => undefined),
    ])
  }

  /**
   * Runs a write and always refreshes after it: a write made of two calls (the zone, then its outbound state) may have
   * changed the draft before the second one failed, so a 400 or a 5xx must not leave the UI on the old version.
   */
  async function write(action: () => Promise<unknown>) {
    try {
      await action()
    } finally {
      await refresh()
    }
  }

  /**
   * The zone is written first (with the outbound mode); when the outbound control changed, its state follows, applied
   * at once with the version the write returned: observation on a check, off on an uncheck.
   */
  const saveZone = (zone: MicrosegZone | null, values: ZoneFormValues) => write(async () => {
    const saved = await api.saveZone({
      id: zone?.id,
      version,
      name: values.name,
      label: values.label,
      color: values.color,
      enforcement: zone?.enforcement ?? 'guest',
      vnet_id: zone?.vnet_id ?? '',
      isolate_members: values.isolate_members,
      egress_mode: values.egress_mode,
    })
    if (!zone || values.egress_control === (zoneEgress(zone) !== 'off')) return
    const state = values.egress_control ? 'observe' : 'off'
    const started = await api.setZoneEgressState(zone.id, state, saved.version)
    startRun({
      runId: started.run_id,
      kind: 'zoneState',
      label: zone.name,
      runningText: t(`run.running.${state === 'observe' ? 'egressObserve' : 'egressOff'}`, { label: zone.name }),
    })
  })

  const deleteZone = (zone: MicrosegZone) => write(() => api.deleteZone(zone.id, version))

  const saveFlow = (flow: MicrosegFlow | null, values: FlowSaveValues) => write(() => api.saveFlow({ id: flow?.id, version, ...values }))

  const deleteFlow = (flow: MicrosegFlow) => write(() => api.deleteFlow(flow.id, version))

  /** Applied at once with the whole draft (UA30): the run is followed in the strip of the tab. */
  const setZoneState = (zone: MicrosegZone, state: ZoneState) => write(async () => {
    const started = await api.setZoneState(zone.id, state, version)
    startRun({ runId: started.run_id, kind: 'zoneState', label: zone.name, runningText: t(`run.running.${state}`, { label: zone.name }) })
  })

  /** Applied at once with the whole draft, like the inbound state: the run is followed in the strip of the tab. */
  const setZoneEgressState = (zone: MicrosegZone, state: Exclude<EgressState, 'off'>) => write(async () => {
    const started = await api.setZoneEgressState(zone.id, state, version)
    startRun({
      runId: started.run_id,
      kind: 'zoneState',
      label: zone.name,
      runningText: t(`run.running.${state === 'observe' ? 'egressReopen' : 'egressEnforce'}`, { label: zone.name }),
    })
  })

  /** One member write at a time; a failure is kept in `memberError`. */
  const memberWrite = (body: MembersInput) => {
    if (memberBusy) return
    setMemberError(null)
    setMemberBusy(true)
    void write(() => api.setMembers(body))
      .catch(setMemberError)
      .finally(() => setMemberBusy(false))
  }

  /** Queues a guest for a zone (a draft change, the next apply moves the tag): `zoneId` "" takes it out of every zone. */
  const changeMember = (ref: GuestRef, zoneId: string) => memberWrite({ version, zone_id: zoneId, guests: [ref] })

  /** Forgets the queued removal or move of a guest: it stays in its zone and the draft loses that change. */
  const keepMember = (ref: GuestRef) => memberWrite({ version, clear: [{ type: ref.type, vmid: ref.vmid }] })

  return {
    connectionId,
    policy,
    zones: policy.zones,
    readyAfterHours: policy.policy.settings?.ready_after_hours || DEFAULT_READY_AFTER_HOURS,
    pendingChanges,
    onOpenPlan,
    saveZone,
    deleteZone,
    saveFlow,
    deleteFlow,
    setZoneState,
    setZoneEgressState,
    /** Reports a failure the panel shows in its alert (the one-click reopen has no dialog to show it). */
    reportError: setMemberError,
    changeMember,
    keepMember,
    memberBusy,
    memberError,
    clearMemberError: () => setMemberError(null),
  }
}

export type ZoneEdits = ReturnType<typeof useZoneEdits>
