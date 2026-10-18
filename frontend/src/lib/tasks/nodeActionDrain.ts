/**
 * The node reboot/shutdown dialog evacuates the node through a host drain
 * (#248) instead of migrating every guest to one target from the browser.
 * These helpers are the pure part of that flow: the request it sends, when
 * the drain is over, and what still stands in the way of the node action.
 */

export type NodeActionDrainGuest = {
  vmid: number
  name?: string
  type?: string
  status?: string
  running?: boolean
  kept?: boolean
  reason?: string
  error?: string
  failure_reason?: string
  task_id?: string
}

export type NodeActionDrain = {
  id: string
  status: string
  node: string
  total_guests?: number
  completed_guests?: number
  failed_guests?: number
  skipped_guests?: number
  maintenance_enabled?: boolean
  guests?: NodeActionDrainGuest[]
  error?: string
}

export const NODE_ACTION_DRAIN_TERMINAL = ['completed', 'partial', 'failed', 'cancelled']

/**
 * Config of the drain a node action starts. Stopped guests are left where
 * they are (a reboot does not need them gone, and a stopped guest with a lock
 * must not turn into a reason to force); the node enters HA maintenance when
 * it has peers, exactly as the dialog always did before rebooting.
 */
export function nodeActionDrainConfig(opts: { cluster: boolean; targetNode?: string; maxParallel?: number }) {
  return {
    target_node: opts.targetNode || '',
    max_concurrent_migrations: opts.maxParallel ?? 2,
    include_stopped: false,
    enter_maintenance: opts.cluster,
  }
}

export function isNodeActionDrainOver(status?: string): boolean {
  return !!status && NODE_ACTION_DRAIN_TERMINAL.includes(status)
}

/** Guests that still stand on the node after the drain, kept ones excluded. */
export function nodeActionDrainRemaining(drain: NodeActionDrain | null | undefined): NodeActionDrainGuest[] {
  if (!drain || !Array.isArray(drain.guests)) return []

  return drain.guests.filter(g => g.status !== 'completed' && !g.kept)
}

/** The progress line: settled guests over the ones the drain handles. */
export function nodeActionDrainProgress(drain: NodeActionDrain | null | undefined): { done: number; total: number } {
  const total = drain?.total_guests ?? drain?.guests?.length ?? 0
  const done = (drain?.completed_guests ?? 0) + (drain?.failed_guests ?? 0) + (drain?.skipped_guests ?? 0)

  return { done: Math.min(done, total), total }
}

/** Why a remaining guest stayed, in the words the Task Center shows. */
export function nodeActionDrainReason(g: NodeActionDrainGuest): string {
  return g.failure_reason || g.error || g.reason || ''
}
