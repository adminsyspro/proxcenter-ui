'use client'

import { useMemo, useState } from 'react'
import { useSWRConfig } from 'swr'
import { useTranslations } from 'next-intl'

import { microsegApi, microsegBaseUrl } from '@/lib/microseg/api'
import { waitForRun } from '@/lib/microseg/useMicroseg'
import { zoneEgress, type EgressState, type GuestRef, type MembersInput, type MicrosegFlow, type MicrosegPolicy, type MicrosegZone, type ZoneState } from '@/lib/microseg/types'

import { InboundRunFailedError } from './dialogParts'
import { draftBody, draftChanged, type ExceptionDraft } from './exceptionModel'
import type { FlowSaveValues } from './FlowDialog'
import type { TrackedRun } from './microsegTabTypes'
import { startedRuns } from './runsInProgress'
import { usePendingChanges } from './usePendingChanges'
import { gatewayCidr, gatewayServiceFlows, type ZoneFormValues } from './zoneForm'

const DEFAULT_READY_AFTER_HOURS = 24

/**
 * The state changes a zone dialog asks for: the inbound one when its state moved; the outbound one when its outbound
 * moved, unless the zone is set disabled (the backend turns the outbound off with it).
 */
export function zoneStateChanges(zone: MicrosegZone, values: Pick<ZoneFormValues, 'state' | 'egress_state'>): { inbound: ZoneState | null; outbound: EgressState | null } {
  const inbound = values.state === zone.state ? null : values.state
  const outbound = values.state === 'disabled' || values.egress_state === zoneEgress(zone) ? null : values.egress_state
  return { inbound, outbound }
}

/** The running line of an outbound change: observing from off, reopening from blocking, blocking, or off. */
function egressRunningKey(from: EgressState, to: EgressState): string {
  if (to === 'enforce') return 'egressEnforce'
  if (to === 'off') return 'egressOff'
  return from === 'enforce' ? 'egressReopen' : 'egressObserve'
}

/**
 * The flows from a zone to its gateway the dialog asks for and the draft does not hold yet: one per protocol and port
 * of each service (DNS is UDP and TCP 53). A gateway left empty asks for none.
 */
export function missingGatewayFlows(zoneId: string, gateway: string, services: readonly string[], flows: readonly MicrosegFlow[]): { dst_cidr: string; proto: string; dport: string }[] {
  if (!gateway) return []
  const dst = gatewayCidr(gateway)
  const has = (proto: string, dport: string) => flows.some(f => f.src_zone_id === zoneId && f.dst_cidr === dst && f.proto === proto && (f.dport ?? '') === dport)
  const wanted = services.flatMap(s => gatewayServiceFlows(s, gateway))
  // One flow per protocol and ports, even when two services name the same one (SSH and a typed "tcp/22").
  const unique = wanted.filter((f, i) => wanted.findIndex(o => o.proto === f.proto && o.dport === f.dport) === i)
  return unique.filter(f => !has(f.proto, f.dport)).map(f => ({ dst_cidr: dst, ...f }))
}

/** Told as soon as a new exception of a zone save is written: the draft it was (the object of the list) and the id it got. */
export type ExceptionCreated = (draft: ExceptionDraft, id: string) => void

export type ZoneEditsInput = {
  connectionId: string
  policy: MicrosegPolicy
  /** Re-reads the draft: after every write, and on a VERSION_CONFLICT. */
  reloadPolicy: () => Promise<unknown>
  /** Follows the run a zone state change starts. */
  startRun: (run: TrackedRun) => void
  /** The plan window, offered when a state change is refused for pending changes. */
  onOpenPlan?: () => void
  /** Names a cluster of a shared policy as the user sees it: the exceptions offer the clusters it names. */
  clusterName?: (id: string) => string
}

/**
 * The writes on the zones, flows and members of the draft, shared by the Policy sub-tab and the zone panel of the map.
 * Every write carries the draft version. After it, success or not, the policy and the status are read again (the map, the counts and
 * the pending-changes bar follow); on any failure (a VERSION_CONFLICT included) the policy is read again too and the error is rethrown, so the
 * dialog keeps its input and says why. A 400 keeps the server's wording (writeErrorMessage).
 */
export function useZoneEdits({ connectionId, policy, reloadPolicy, startRun, onOpenPlan, clusterName }: ZoneEditsInput) {
  const t = useTranslations('microsegPilot.policy')
  const { mutate } = useSWRConfig()
  const api = useMemo(() => microsegApi(connectionId), [connectionId])
  /**
   * The URL a write of one cluster goes through: an exception or a member is written through its own cluster (the
   * backend takes the cluster from the URL and refuses another cluster's row), the tab's connection by default.
   */
  const apiOf = (cluster?: string) => (cluster && cluster !== connectionId ? microsegApi(cluster) : api)
  /** The cluster of a stored exception. */
  const clusterOf = (exceptionId: string) => policy.exceptions.find(e => e.id === exceptionId)?.connection_id
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
   * The zone is written first (with the outbound mode), then its flows to the gateway and its exceptions, one write
   * each with the version the write before returned. Then the state changes the dialog asked for, each applied at
   * once with the whole draft: the inbound state with the version the write returned; the outbound state after it,
   * once the inbound run has finished (with the version read again then), or at once when only the outbound changed.
   * An inbound run that failed (on every cluster of a shared policy) stops there (InboundRunFailedError): the outbound
   * change is not sent. A zone set disabled
   * gets no outbound call: the backend turns its outbound off.
   * `onExceptionCreated` lets the dialog give its new exceptions their ids, so that a save tried again updates them.
   */
  const saveZone = (zone: MicrosegZone | null, values: ZoneFormValues, onExceptionCreated?: ExceptionCreated) => write(async () => {
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
      gateway: values.gateway.trim(),
    })
    // The flows to the gateway, created with the zone (a new one has its id in the answer), one write each.
    let next = saved.version
    const zoneId = zone?.id ?? saved.zone?.id
    if (zoneId) {
      for (const f of missingGatewayFlows(zoneId, values.gateway.trim(), values.gateway_services, policy.flows)) {
        next = (await api.saveFlow({ version: next, src_zone_id: zoneId, comment: t('zoneDialog.gatewayFlowComment'), ...f })).version
      }
    }
    if (zoneId) {
      // The exceptions the dialog removed, then the ones it changed or added, in the order of its list.
      // A save tried again after a later step failed finds its first writes done: an exception already deleted is
      // not deleted again, one already created comes back with its id (`onExceptionCreated`) and is not created twice.
      // Each one through its own cluster, the version going from one write to the next whatever the cluster (one draft).
      for (const id of values.removed_exceptions) {
        if (!policy.exceptions.some(e => e.id === id)) continue
        next = (await apiOf(clusterOf(id)).deleteException(id, next)).version
      }
      for (const draft of values.exceptions) {
        const stored = draft.id ? policy.exceptions.find(e => e.id === draft.id) : undefined
        if (stored && !draftChanged(draft, stored)) continue
        const written = await apiOf(draft.connectionId ?? stored?.connection_id).saveException({ id: draft.id, version: next, zone_id: zoneId, ...draftBody(draft) })
        next = written.version
        if (!draft.id && written.exception?.id) onExceptionCreated?.(draft, written.exception.id)
      }
    }
    if (!zone) return
    const { inbound, outbound } = zoneStateChanges(zone, values)
    if (inbound) {
      const started = await api.setZoneState(zone.id, inbound, next)
      const tracked = startedRuns(started, connectionId)
      startRun({ ...tracked, kind: 'zoneState', zoneId: zone.id, label: zone.name, runningText: t(`run.running.${inbound}`, { label: zone.name }) })
      if (!outbound) return
      // The outbound change waits for the inbound one on every cluster: a cluster still busy would refuse it. It is
      // sent once the inbound change went through on at least one cluster, and stops when it failed everywhere. The
      // outbound route is policy-wide: its run also starts on the cluster whose inbound run failed. Both states are
      // stored in the policy and that cluster converges to them at its next pass (about one engine tick once it is
      // reachable again); until then its firewall can briefly hold an inconsistent mix of the old and new states. The
      // inbound line of the strip reports the partial outcome.
      const runs = tracked.runs
        ? await Promise.all(tracked.runs.flatMap(r => (r.run_id ? [waitForRun(microsegApi(r.connection_id).getRun, r.run_id)] : [])))
        : [await waitForRun(api.getRun, started.run_id)]
      if (runs.every(run => run.status === 'failed')) throw new InboundRunFailedError(runs[0]?.error)
      next = (await api.getPolicy()).version
    }
    if (!outbound) return
    const started = await api.setZoneEgressState(zone.id, outbound, next)
    startRun({ ...startedRuns(started, connectionId), kind: 'zoneState', zoneId: zone.id, label: zone.name, runningText: t(`run.running.${egressRunningKey(zoneEgress(zone), outbound)}`, { label: zone.name }) })
  })

  const deleteZone = (zone: MicrosegZone) => write(() => api.deleteZone(zone.id, version))

  const saveFlow = (flow: MicrosegFlow | null, values: FlowSaveValues) => write(() => api.saveFlow({ id: flow?.id, version, ...values }))

  const deleteFlow = (flow: MicrosegFlow) => write(() => api.deleteFlow(flow.id, version))

  /** One exception of a zone written alone (the zone panel): created without id, updated with one, through its cluster. */
  const saveException = (zoneId: string, draft: ExceptionDraft) => write(() => apiOf(draft.connectionId ?? (draft.id ? clusterOf(draft.id) : undefined))
    .saveException({ id: draft.id, version, zone_id: zoneId, ...draftBody(draft) }))

  const deleteException = (exceptionId: string) => write(() => apiOf(clusterOf(exceptionId)).deleteException(exceptionId, version))

  /** Applied at once with the whole draft (UA30): the run is followed in the strip of the tab. */
  const setZoneState = (zone: MicrosegZone, state: ZoneState) => write(async () => {
    const started = await api.setZoneState(zone.id, state, version)
    startRun({ ...startedRuns(started, connectionId), kind: 'zoneState', zoneId: zone.id, label: zone.name, runningText: t(`run.running.${state}`, { label: zone.name }) })
  })

  /** Applied at once with the whole draft, like the inbound state: the run is followed in the strip of the tab. */
  const setZoneEgressState = (zone: MicrosegZone, state: Exclude<EgressState, 'off'>) => write(async () => {
    const started = await api.setZoneEgressState(zone.id, state, version)
    startRun({
      ...startedRuns(started, connectionId),
      kind: 'zoneState',
      zoneId: zone.id,
      label: zone.name,
      runningText: t(`run.running.${state === 'observe' ? 'egressReopen' : 'egressEnforce'}`, { label: zone.name }),
    })
  })

  /**
   * One member write at a time; a failure is kept in `memberError`. It goes through the member's cluster: `POST /members`
   * writes the rows of its URL's cluster only (the connection of the tab when none is given).
   */
  const memberWrite = (body: MembersInput, cluster?: string) => {
    if (memberBusy) return
    setMemberError(null)
    setMemberBusy(true)
    void write(() => apiOf(cluster).setMembers(body))
      .catch(setMemberError)
      .finally(() => setMemberBusy(false))
  }

  /** Queues a guest for a zone (a draft change, the next apply moves the tag): `zoneId` "" takes it out of every zone. */
  const changeMember = (ref: GuestRef, zoneId: string, cluster?: string) => memberWrite({ version, zone_id: zoneId, guests: [ref] }, cluster)

  /** Forgets the queued removal or move of a guest: it stays in its zone and the draft loses that change. */
  const keepMember = (ref: GuestRef, cluster?: string) => memberWrite({ version, clear: [{ type: ref.type, vmid: ref.vmid }] }, cluster)

  return {
    /** The flows of the draft: the zone dialog says which flows to the gateway the zone has already. */
    flows: policy.flows,
    connectionId,
    policy,
    /** Given only by a screen that names the clusters of a shared policy. */
    clusterName,
    zones: policy.zones,
    readyAfterHours: policy.policy.settings?.ready_after_hours || DEFAULT_READY_AFTER_HOURS,
    pendingChanges,
    onOpenPlan,
    saveZone,
    deleteZone,
    saveFlow,
    deleteFlow,
    saveException,
    deleteException,
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
