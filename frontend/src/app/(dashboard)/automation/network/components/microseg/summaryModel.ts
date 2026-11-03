import type { useFormatter } from 'next-intl'

import type { MicrosegDriftList, MicrosegPolicy, MicrosegSnapshot, MicrosegStatus } from '@/lib/microseg/types'

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

/** What an admin starts, not what the engine does by itself: these runs are not "checks". */
const ADMIN_KINDS = new Set(['plan', 'apply', 'remove', 'restore'])

/** Zones of the last applied revision that enforce, and those that only observe (disabled ones are neither). */
export function deployedCounts(snapshot: MicrosegSnapshot): { enforced: number; observing: number } {
  const zones = snapshot.zones ?? []
  return {
    enforced: zones.filter(z => z.state === 'enforce').length,
    observing: zones.filter(z => z.state === 'observe').length,
  }
}

/** When the engine last looked at the cluster: its newest own run, whatever the kind. Null before the first one. */
export function lastCheckAt(status: Pick<MicrosegStatus, 'engine'>): Date | null {
  let newest: Date | null = null
  for (const [kind, run] of Object.entries(status.engine.last_runs ?? {})) {
    if (ADMIN_KINDS.has(kind)) continue
    const at = new Date(run.started_at)
    if (Number.isNaN(at.getTime())) continue
    if (!newest || at > newest) newest = at
  }
  return newest
}

/**
 * The emergency stop switched the cluster firewall off: the engine says so, or, while it cannot read the firewall
 * ('unknown' or absent), the policy remembers that the stop did it.
 */
export function clusterFirewallOff(status: Pick<MicrosegStatus, 'engine'> | undefined, policy: Pick<MicrosegPolicy, 'policy'> | undefined): boolean {
  const state = status?.engine.cluster_firewall
  if (state === 'disabled') return true
  return state !== 'enabled' && !!policy?.policy.stop_cluster_disabled
}

/** Runs an admin starts and that change what is deployed. */
const DEPLOY_KINDS = ['apply', 'remove', 'restore'] as const

/**
 * When the deployed state last changed, as far as the engine tells: the start of its newest apply, remove and restore
 * runs. A new value means the last revision may have moved and the policy must be read again.
 */
export function adminRunsMark(status: Pick<MicrosegStatus, 'engine' | 'emergency_stop'>): string {
  const runs = status.engine.last_runs ?? {}
  return [...DEPLOY_KINDS.map(kind => runs[kind]?.started_at ?? ''), String(!!status.emergency_stop)].join('|')
}

/** No policy on this connection yet: the orchestrator answers its empty draft, version 0, never deployed. */
export function policyNotSetUp(policy: Pick<MicrosegPolicy, 'version' | 'last_revision' | 'zones'>): boolean {
  return !policy.last_revision && policy.version === 0 && (policy.zones ?? []).length === 0
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
