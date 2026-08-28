/**
 * Progress helpers for the rolling update monitor (ui#814).
 *
 * The orchestrator reports a status per node and, while apt runs, a
 * `package_progress` object derived from apt's own output. The wizard used to
 * count whole nodes only, so the bar stayed at 0 / 3 for the ten minutes a
 * package upgrade takes. These helpers turn both signals into one fraction.
 */

/** Node statuses in execution order; the index is the node's step. */
export const NODE_STEPS = [
  'pending',
  'entering_maintenance',
  'migrating_vms',
  'updating',
  'rebooting',
  'waiting_return',
  'verifying_health',
  'exiting_maintenance',
  'completed'
] as const

export type PackagePhase = 'waiting_lock' | 'download' | 'unpack' | 'configure' | 'done'

export interface PackageProgress {
  phase: PackagePhase | string
  done: number
  total: number
  updated_at?: string
}

export interface NodeProgressLike {
  node_name?: string
  status: string
  package_progress?: PackageProgress | null
  update_output?: string | null
}

export interface RunProgressLike {
  status?: string
  total_nodes: number
  completed_nodes: number
  pending_approval?: string | null
  node_statuses?: NodeProgressLike[] | null
}

/** The three apt phases that count packages, in order. */
const PACKAGE_PHASES = ['download', 'unpack', 'configure']

/** 0..1 position of apt inside the `updating` step. */
export function packageFraction(progress?: PackageProgress | null): number {
  if (!progress) return 0
  if (progress.phase === 'done') return 1

  const phaseIndex = PACKAGE_PHASES.indexOf(progress.phase)

  if (phaseIndex < 0) return 0
  const inPhase = progress.total > 0 ? Math.min(progress.done / progress.total, 1) : 0

  return (phaseIndex + inPhase) / PACKAGE_PHASES.length
}

/** 0..1 position of a node inside its own steps; finished nodes count as 1. */
export function nodeStepFraction(node: NodeProgressLike): number {
  if (node.status === 'completed' || node.status === 'skipped' || node.status === 'failed') return 1

  const index = NODE_STEPS.indexOf(node.status as (typeof NODE_STEPS)[number])

  if (index <= 0) return 0

  const within = node.status === 'updating' ? packageFraction(node.package_progress) : 0

  return (index + within) / (NODE_STEPS.length - 1)
}

/** 0..100 value for the run's progress bar. */
export function runProgressPercent(run: RunProgressLike): number {
  if (!run.total_nodes || run.total_nodes <= 0) return 0

  const nodes = run.node_statuses

  if (!nodes || nodes.length === 0) {
    return clampPercent((run.completed_nodes / run.total_nodes) * 100)
  }

  const sum = nodes.reduce((acc, node) => acc + nodeStepFraction(node), 0)

  return clampPercent((sum / run.total_nodes) * 100)
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0

  return Math.max(0, Math.min(100, value))
}

/** i18n key and values describing apt's position for a node, or null when apt is not running. */
export function packageProgressLabel(progress?: PackageProgress | null): { key: string; values: Record<string, string | number> } | null {
  if (!progress) return null

  const count = progress.total > 0 ? `${progress.done}/${progress.total}` : `${progress.done}`

  switch (progress.phase) {
    case 'waiting_lock':
      return { key: 'updates.pkgWaitingLock', values: { seconds: progress.done } }
    case 'download':
      return { key: 'updates.pkgDownloading', values: { count } }
    case 'unpack':
      return { key: 'updates.pkgUnpacking', values: { count } }
    case 'configure':
      return { key: 'updates.pkgConfiguring', values: { count } }
    case 'done':
      return { key: 'updates.pkgDone', values: { count: progress.done } }
    default:
      return null
  }
}

/** A paused run that names a node in `pending_approval` wants an approval, not a resume. */
export function isAwaitingApproval(run: Pick<RunProgressLike, 'status' | 'pending_approval'>): boolean {
  return run.status === 'paused' && !!run.pending_approval
}

/** The apt output of a failed node is the only place its cause is stated: open it by default. */
export function shouldExpandOutput(node: Pick<NodeProgressLike, 'status' | 'update_output'>): boolean {
  return node.status === 'failed' && !!node.update_output
}
