'use client'

import { useMemo, useState } from 'react'
import { useSWRConfig } from 'swr'
import { useTranslations } from 'next-intl'

import { microsegApi, microsegBaseUrl } from '@/lib/microseg/api'
import { waitForRun } from '@/lib/microseg/useMicroseg'
import { zoneEgress, type EgressState, type GuestRef, type MembersInput, type MicrosegFlow, type MicrosegPolicy, type MicrosegZone, type ZoneState } from '@/lib/microseg/types'

import { InboundRunFailedError } from './dialogParts'
import type { FlowSaveValues } from './FlowDialog'
import type { TrackedRun } from './microsegTabTypes'
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
   * The zone is written first (with the outbound mode). Then the state changes the dialog asked for, each applied at
   * once with the whole draft: the inbound state with the version the write returned; the outbound state after it,
   * once the inbound run has finished (with the version read again then), or at once when only the outbound changed.
   * A failed inbound run stops there (InboundRunFailedError): the outbound change is not sent. A zone set disabled
   * gets no outbound call: the backend turns its outbound off.
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
    if (!zone) return
    const { inbound, outbound } = zoneStateChanges(zone, values)
    if (inbound) {
      const started = await api.setZoneState(zone.id, inbound, next)
      startRun({ runId: started.run_id, kind: 'zoneState', zoneId: zone.id, label: zone.name, runningText: t(`run.running.${inbound}`, { label: zone.name }) })
      if (!outbound) return
      const run = await waitForRun(api.getRun, started.run_id)
      if (run.status === 'failed') throw new InboundRunFailedError(run.error)
      next = (await api.getPolicy()).version
    }
    if (!outbound) return
    const started = await api.setZoneEgressState(zone.id, outbound, next)
    startRun({ runId: started.run_id, kind: 'zoneState', zoneId: zone.id, label: zone.name, runningText: t(`run.running.${egressRunningKey(zoneEgress(zone), outbound)}`, { label: zone.name }) })
  })

  const deleteZone = (zone: MicrosegZone) => write(() => api.deleteZone(zone.id, version))

  const saveFlow = (flow: MicrosegFlow | null, values: FlowSaveValues) => write(() => api.saveFlow({ id: flow?.id, version, ...values }))

  const deleteFlow = (flow: MicrosegFlow) => write(() => api.deleteFlow(flow.id, version))

  /** Applied at once with the whole draft (UA30): the run is followed in the strip of the tab. */
  const setZoneState = (zone: MicrosegZone, state: ZoneState) => write(async () => {
    const started = await api.setZoneState(zone.id, state, version)
    startRun({ runId: started.run_id, kind: 'zoneState', zoneId: zone.id, label: zone.name, runningText: t(`run.running.${state}`, { label: zone.name }) })
  })

  /** Applied at once with the whole draft, like the inbound state: the run is followed in the strip of the tab. */
  const setZoneEgressState = (zone: MicrosegZone, state: Exclude<EgressState, 'off'>) => write(async () => {
    const started = await api.setZoneEgressState(zone.id, state, version)
    startRun({
      runId: started.run_id,
      kind: 'zoneState',
      zoneId: zone.id,
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
    /** The flows of the draft: the zone dialog says which flows to the gateway the zone has already. */
    flows: policy.flows,
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
