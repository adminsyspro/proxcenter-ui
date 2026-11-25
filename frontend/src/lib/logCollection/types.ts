// How the firewall logs of a cluster reach the micro-segmentation engine,
// as GET /api/v1/connections/{id}/log-collection answers (the orchestrator's
// /logfwd/{id}).

export type LogCollectionMode = 'api' | 'forwarder'

/** installed once the forwarder runs; missing for a node of the cluster that has none at all. */
export type LogForwarderState = 'installing' | 'installed' | 'failed' | 'removing' | 'missing'

export interface LogCollectionNode {
  node: string
  state?: LogForwarderState
  /** openfile: systemd hands the service one descriptor. adm: older systemd, the service joins the adm group. */
  variant?: string
  version?: string
  connected?: boolean
  silent?: boolean
  paused?: boolean
  last_line_at?: string
  lag_seconds?: number
  lines_per_min_15m?: number
  queue_bytes?: number
  dropped?: number
  budget_hits_24h?: number
  drift?: string
  /** The node has a forwarder but is no longer in the PVE cluster. */
  left?: boolean
  error?: string
}

export interface LogCollectionRunNode {
  node: string
  step: string
  error?: string
  done: boolean
}

export interface LogCollectionRun {
  id: string
  kind: 'install' | 'uninstall'
  status: 'running' | 'done' | 'failed'
  nodes: LogCollectionRunNode[]
  started_at: string
  finished_at?: string
}

export interface LogCollectionLimits {
  min_queue_mb: number
  max_queue_mb: number
  min_budget: number
  max_budget: number
}

export interface LogCollectionState {
  mode: LogCollectionMode
  receiver_host: string
  receiver_port: number
  queue_mb: number
  budget_lines_per_min: number
  receiver_default: string
  ssh_enabled: boolean
  has_policy: boolean
  limits: LogCollectionLimits
  nodes: LogCollectionNode[]
  run: LogCollectionRun | null
  busy: boolean
}

export interface LogCollectionSettings {
  mode: LogCollectionMode
  receiver_host: string
  receiver_port: number
  queue_mb: number
  budget_lines_per_min: number
}

export interface LogCollectionProblem {
  code: 'ssh_unreachable' | 'host_key_unconfirmed' | 'sudo_missing' | 'systemd_unknown' | 'receiver_unreachable' | string
  detail?: string
}

export interface LogCollectionCheck {
  node: string
  ok: boolean
  variant?: string
  systemd?: number
  problems?: LogCollectionProblem[]
}

/** A refusal of the orchestrator, as the UI reads it. */
export interface LogCollectionRefusal {
  code: string
  error: string
  checks?: LogCollectionCheck[]
}

export const DEFAULT_RECEIVER_PORT = 6344
/** What the orchestrator sets on a cluster that was never configured. */
export const DEFAULT_QUEUE_MB = 256
export const DEFAULT_BUDGET_LINES_PER_MIN = 30000

/**
 * The receiver, the queue and the budget are folded under "Advanced settings": shown by themselves once one of them is
 * not what ProxCenter proposes, so that nothing set by hand stays out of sight.
 */
export function advancedChanged(state: LogCollectionState): boolean {
  return (!!state.receiver_host && state.receiver_host !== state.receiver_default)
    || (!!state.receiver_port && state.receiver_port !== DEFAULT_RECEIVER_PORT)
    || state.queue_mb !== DEFAULT_QUEUE_MB
    || state.budget_lines_per_min !== DEFAULT_BUDGET_LINES_PER_MIN
}

/** What the form shows for a state: the saved settings, the proposed receiver when none is saved yet. */
export function settingsOf(state: LogCollectionState): LogCollectionSettings {
  return {
    mode: state.mode,
    receiver_host: state.receiver_host || state.receiver_default || '',
    receiver_port: state.receiver_port || DEFAULT_RECEIVER_PORT,
    queue_mb: state.queue_mb,
    budget_lines_per_min: state.budget_lines_per_min,
  }
}

/** Why the forwarder mode cannot be chosen, or null when it can. */
export function forwarderBlocker(state: Pick<LogCollectionState, 'ssh_enabled' | 'has_policy'>): 'ssh' | 'policy' | null {
  if (!state.ssh_enabled) return 'ssh'
  if (!state.has_policy) return 'policy'

  return null
}

const HOST = /^(?!-)[A-Za-z0-9.:[\]-]{1,253}$/

/** The fields of the settings that are not valid, by name. The orchestrator validates again. */
export function invalidFields(s: LogCollectionSettings, limits: LogCollectionLimits): Array<keyof LogCollectionSettings> {
  if (s.mode === 'api') return []
  const bad: Array<keyof LogCollectionSettings> = []

  if (!HOST.test(s.receiver_host.trim())) bad.push('receiver_host')
  if (!Number.isInteger(s.receiver_port) || s.receiver_port < 1 || s.receiver_port > 65535) bad.push('receiver_port')
  if (!Number.isInteger(s.queue_mb) || s.queue_mb < limits.min_queue_mb || s.queue_mb > limits.max_queue_mb) bad.push('queue_mb')
  if (!Number.isInteger(s.budget_lines_per_min) || s.budget_lines_per_min < limits.min_budget || s.budget_lines_per_min > limits.max_budget) bad.push('budget_lines_per_min')

  return bad
}

/** Whether applying the settings changes the nodes (an installation or a removal), or only the receiver. */
export function changesNodes(state: LogCollectionState, s: LogCollectionSettings): boolean {
  if (s.mode !== state.mode) return true
  if (s.mode === 'api') return false

  return s.receiver_host.trim() !== state.receiver_host || s.receiver_port !== state.receiver_port || s.queue_mb !== state.queue_mb
}

/** The dot of a node row: green when its forwarder delivers, orange when held back or changed, red otherwise. */
export function nodeStatus(n: LogCollectionNode): 'online' | 'maintenance' | 'offline' | undefined {
  if (n.state === 'installing' || n.state === 'removing') return undefined
  if (n.state !== 'installed' || n.silent) return 'offline'
  if (n.drift || n.paused) return 'maintenance'

  return 'online'
}

/** The label key of a node's state under settings.logCollection.nodeState. */
export function nodeStateKey(n: LogCollectionNode, mode?: LogCollectionState['mode']): string {
  // A cluster back to the API read only runs removals: a failure there is one.
  if (n.state === 'failed' && mode === 'api') return 'removeFailed'
  if (n.state !== 'installed') return n.state ?? 'missing'
  if (n.silent) return 'silent'
  if (n.drift) return 'drifted'
  if (n.paused) return 'paused'

  return 'installed'
}
