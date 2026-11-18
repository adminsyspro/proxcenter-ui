import type { useFormatter } from 'next-intl'

import type { MicrosegDriftList, MicrosegPolicy, MicrosegStatus } from '@/lib/microseg/types'

import type { Coverage } from './coverage'

/** A pause whose end is past `now` is over (the engine clears the field on its next pass). */
export function stillPaused(pausedUntil: string | null | undefined, now: number = Date.now()): boolean {
  return !!pausedUntil && !(Date.parse(pausedUntil) <= now)
}

/** A date for a line of text: medium date and short time, or the raw text when it is not a date. */
export function formatWhen(format: ReturnType<typeof useFormatter>, iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : format.dateTime(d, { dateStyle: 'medium', timeStyle: 'short' })
}

/**
 * The emergency stop switched the cluster firewall off: the stop is in force, or the policy remembers that the stop
 * turned it off (`stop_cluster_disabled`), and the engine says it is off, or, while it cannot read the firewall
 * ('unknown' or absent), the policy alone says so. A firewall that is off with no stop explaining it is `firewallOffByHand`.
 */
export function clusterFirewallOff(status: Pick<MicrosegStatus, 'engine' | 'emergency_stop'> | undefined, policy: Pick<MicrosegPolicy, 'policy'> | undefined): boolean {
  const state = status?.engine.cluster_firewall
  const stopDisabled = !!policy?.policy.stop_cluster_disabled
  if (state === 'disabled') return !!status?.emergency_stop || stopDisabled
  return state !== 'enabled' && stopDisabled
}

/**
 * The cluster firewall is off and the emergency stop does not explain it (someone switched it off in Proxmox): nothing is
 * filtered on that cluster. `stopDisabled` is the link's `stop_cluster_disabled`.
 */
export function firewallOffByHand(status: Pick<MicrosegStatus, 'engine' | 'emergency_stop'> | undefined, stopDisabled: boolean): boolean {
  return status?.engine.cluster_firewall === 'disabled' && !status.emergency_stop && !stopDisabled
}

/**
 * Where one cluster of a shared policy stands after the emergency stop was set (`on`) or lifted, from its own status:
 * null once it followed (or while its status is unknown: its unread line says so). After a stop, a cluster whose
 * firewall is still on is pending (the engine retries it every minute). After a lift, a cluster whose firewall the stop
 * turned off (`stopDisabled`, the link's flag) and that is still off is pending, or `held` when the engine said it keeps
 * it off on purpose (the rules that keep its nodes reachable could not be checked: the `stop_lift_held` drift).
 */
export function stopFollowState(
  on: boolean,
  status: Pick<MicrosegStatus, 'emergency_stop' | 'engine'> | undefined,
  stopDisabled: boolean,
  held: boolean,
): 'pending' | 'held' | null {
  if (!status) return null
  const firewall = status.engine.cluster_firewall
  if (on) return status.emergency_stop && firewall !== 'enabled' ? null : 'pending'
  const stillOff = stopDisabled && firewall !== 'enabled'
  if (!status.emergency_stop && !stillOff) return null
  return held && !status.emergency_stop ? 'held' : 'pending'
}

/**
 * Running guests in no zone: the engine's `unzoned_running` drifts once its full run computed them (what the Drifts
 * sub-tab lists, ambiguous guests left out), else running minus zoned from the status. Null when neither is known.
 */
export function unzonedRunning(cov: Coverage | null, drifts: MicrosegDriftList | undefined): number | null {
  if (drifts?.computed) return drifts.drifts.filter(d => d.kind === 'unzoned_running').length
  if (!cov) return null
  return Math.max(0, cov.running - cov.zoned)
}
