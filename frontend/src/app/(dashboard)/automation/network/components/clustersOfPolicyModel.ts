import type { MicrosegStatus } from '@/lib/microseg/types'

import { firewallOffByHand } from './microseg/summaryModel'

/** The one state a cluster of the policy shows on the Dashboard. */
export type ClusterStateKey = 'stop' | 'unreachable' | 'firewallOff' | 'pending' | 'applied' | 'unknown'

export type ClusterStateInput = {
  /** The cluster's own GET /status; undefined when it could not be read. */
  status: Pick<MicrosegStatus, 'engine' | 'emergency_stop'> | undefined
  /** The link is active (the policy was applied there at least once). */
  active: boolean
  /** The link's `stop_cluster_disabled`: the emergency stop turned the cluster firewall off. */
  stopDisabled: boolean
}

/**
 * The state of one cluster, by priority: emergency stop in force, unreachable since a time, cluster firewall off (by
 * hand, or still off after a stop was lifted), not applied yet (link inactive), applied. A cluster whose status could
 * not be read is unknown, whatever its link says.
 */
export function clusterState({ status, active, stopDisabled }: ClusterStateInput): { key: ClusterStateKey; since?: string } {
  if (!status) return { key: 'unknown' }
  if (status.emergency_stop) return { key: 'stop' }
  const since = status.engine.unreachable_since
  if (since) return { key: 'unreachable', since }
  const off = firewallOffByHand(status, stopDisabled) || (stopDisabled && status.engine.cluster_firewall === 'disabled')
  if (off) return { key: 'firewallOff' }
  return { key: active ? 'applied' : 'pending' }
}

/** The icon and colour of a state: green applied, orange pending or unknown, red stop, unreachable and firewall off. */
export const CLUSTER_STATE_MARK: Record<ClusterStateKey, { icon: string; color: 'success.main' | 'warning.main' | 'error.main' }> = {
  stop: { icon: 'ri-stop-circle-line', color: 'error.main' },
  unreachable: { icon: 'ri-wifi-off-line', color: 'error.main' },
  firewallOff: { icon: 'ri-shield-cross-line', color: 'error.main' },
  pending: { icon: 'ri-time-line', color: 'warning.main' },
  applied: { icon: 'ri-checkbox-circle-line', color: 'success.main' },
  unknown: { icon: 'ri-question-line', color: 'warning.main' },
}
