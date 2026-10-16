/**
 * Telemetry health of the sFlow agents, as the orchestrator evaluates it
 * (roadmap#52), reduced to what the Network Flows table shows.
 *
 * Configuration and reception are two facts. The table used to paint a green
 * "Active" chip from the first alone, which is how three configured nodes
 * whose UDP export was filtered looked healthy for days (ui#1066). The chip now
 * follows the orchestrator's verdict, and "configured" on its own is a neutral
 * state, not a green one.
 */

export type TelemetryState =
  | 'receiving'
  | 'awaiting'
  | 'missing'
  | 'identity_unknown'
  | 'host_offline'
  | 'collector_unavailable'

export interface AgentTelemetry {
  connection_id: string
  connection_name: string
  node: string
  agent_ip: string
  target: string
  polling_interval: number
  sampling_rate: number
  configured_at: string
  state: TelemetryState
  last_seen?: string
  /** -1 when never. */
  seconds_since_seen: number
  seconds_silent: number
  timeout_seconds: number
  grace_seconds: number
  source_ip?: string
  flow_rate: number
  sample_count: number
  datagram_count: number
  counter_count: number
  detail: string
}

export interface TelemetryHealth {
  evaluated_at: string
  collector_enabled: boolean
  collector_started_at?: string
  agents: AgentTelemetry[]
  unmatched_agents: Array<{ agent_ip: string; source_ip?: string; last_seen: string; active: boolean }>
  alerts_enabled: boolean
  timeout_seconds: number
  grace_seconds: number
}

/** The chip of one node row. `configured` is what SSH found on the node. */
export type TelemetryChipKind = TelemetryState | 'not_configured' | 'configured' | 'no_ovs'

export interface TelemetryChip {
  kind: TelemetryChipKind
  /** i18n key under networkFlows. */
  labelKey: string
  color: 'success' | 'info' | 'error' | 'warning' | 'default'
  variant: 'filled' | 'outlined'
}

const CHIPS: Record<TelemetryChipKind, Omit<TelemetryChip, 'kind'>> = {
  receiving: { labelKey: 'telemetryReceiving', color: 'success', variant: 'filled' },
  awaiting: { labelKey: 'telemetryAwaiting', color: 'info', variant: 'outlined' },
  missing: { labelKey: 'telemetryMissing', color: 'error', variant: 'filled' },
  identity_unknown: { labelKey: 'telemetryIdentityUnknown', color: 'warning', variant: 'outlined' },
  host_offline: { labelKey: 'telemetryHostOffline', color: 'default', variant: 'outlined' },
  collector_unavailable: { labelKey: 'telemetryCollectorUnavailable', color: 'default', variant: 'outlined' },
  // Configured over SSH, no verdict from the collector yet (or no orchestrator):
  // neutral on purpose, this is the state that used to be painted green.
  configured: { labelKey: 'telemetryConfigured', color: 'default', variant: 'outlined' },
  not_configured: { labelKey: 'notConfigured', color: 'warning', variant: 'outlined' },
  no_ovs: { labelKey: 'telemetryNoOvs', color: 'default', variant: 'outlined' },
}

export function telemetryChip(
  node: { hasOvs: boolean; sflowConfigured: boolean },
  health: AgentTelemetry | undefined,
  collectorEnabled: boolean,
): TelemetryChip {
  let kind: TelemetryChipKind
  if (!node.hasOvs) kind = 'no_ovs'
  else if (!node.sflowConfigured) kind = 'not_configured'
  else if (!collectorEnabled) kind = 'collector_unavailable'
  else if (health) kind = health.state
  else kind = 'configured'

  return { kind, ...CHIPS[kind] }
}

/** Find the verdict of a node row, keyed the way the orchestrator keys it. */
export function telemetryOf(
  health: TelemetryHealth | null | undefined,
  node: { connectionId: string; node: string },
): AgentTelemetry | undefined {
  return health?.agents?.find(a => a.connection_id === node.connectionId && a.node === node.node)
}

/** Count the rows per state, for the card header. */
export function summarizeTelemetry(agents: AgentTelemetry[] | undefined): Partial<Record<TelemetryState, number>> {
  const counts: Partial<Record<TelemetryState, number>> = {}
  for (const a of agents ?? []) counts[a.state] = (counts[a.state] ?? 0) + 1

  return counts
}

/**
 * Elapsed time the way an operator reads it: "12 s", "7 min", "3 h 2 min",
 * "2 d". Negative or unknown values read as never.
 */
export function formatElapsed(seconds: number | null | undefined): string | null {
  if (seconds == null || seconds < 0 || !Number.isFinite(seconds)) return null
  const s = Math.round(seconds)
  if (s < 60) return `${s} s`
  const minutes = Math.floor(s / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  if (hours < 24) return restMinutes === 0 ? `${hours} h` : `${hours} h ${restMinutes} min`
  const days = Math.floor(hours / 24)
  const restHours = hours % 24

  return restHours === 0 ? `${days} d` : `${days} d ${restHours} h`
}
