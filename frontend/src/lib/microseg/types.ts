// src/lib/microseg/types.ts
//
// The JSON the orchestrator's micro-segmentation API speaks (snake_case, as
// the Go json tags in internal/microseg/{models,engine_result,drift,preflight,
// inventory}.go and the envelopes of internal/api/microseg*.go).

export type GuestType = 'qemu' | 'lxc'

export type GuestRef = { node: string; type: GuestType; vmid: number }

export type ZoneState = 'disabled' | 'observe' | 'enforce'
export type ZoneEnforcement = 'guest' | 'vnet'

/** Outbound (egress) filtering of a zone, independent of its inbound state. */
export type EgressState = 'off' | 'observe' | 'enforce'
/** What outbound filtering covers: the local network (the subnets of the zoned VMs) or the local network and Internet. */
export type EgressMode = 'local' | 'all'
export type FlowDirection = 'in' | 'out'

export type MicrosegSettings = {
  light_interval_sec: number
  ips_interval_sec: number
  full_interval_sec: number
  log_interval_sec: number
  ready_after_hours: number
  write_cap: number
  observe_log_rate_limit: string
  /** Owned by the engine, never sent back. */
  original_log_rate_limit: string
  notify_drift: boolean
  notify_paused: boolean
  notify_unprotected: boolean
  notify_blocked: boolean
  /** Optional: the addresses ProxCenter reaches the guests from, instead of the detected one (max 16). */
  self_ips?: string[]
}

/** The policy row of a connection (Go `Policy`). */
export type MicrosegPolicyRecord = {
  id: string
  connection_id: string
  tag_prefix: string
  version: number
  settings: MicrosegSettings
  emergency_stop: boolean
  /** The stop switched the cluster firewall off (kept by the engine until the stop is lifted). */
  stop_cluster_disabled?: boolean
  created_at: string
  updated_at: string
  updated_by: string
}

export type MicrosegZone = {
  id: string
  policy_id: string
  name: string
  label: string
  color: string
  enforcement: ZoneEnforcement
  vnet_id: string
  state: ZoneState
  isolate_members: boolean
  observe_since: string | null
  /** Absent on lot-1 data: off. Only meaningful while `state` is observe or enforce, see `zoneEgress`. */
  egress_state?: EgressState
  /** Absent: 'local'. */
  egress_mode?: EgressMode
  egress_observe_since?: string | null
}

/** The effective outbound state of a zone: absent, or a zone neither observed nor enforced, is off. */
export function zoneEgress(z: Pick<MicrosegZone, 'state' | 'egress_state'>): EgressState {
  if (z.state !== 'observe' && z.state !== 'enforce') return 'off'

  return z.egress_state === 'observe' || z.egress_state === 'enforce' ? z.egress_state : 'off'
}

export type FlowOrigin = 'manual' | 'learned' | (string & {})

export type MicrosegFlow = {
  id: string
  policy_id: string
  src_zone_id: string
  src_cidr: string
  dst_zone_id: string
  dst_cidr: string
  proto: string
  dport: string
  comment: string
  origin: FlowOrigin
  created_by: string
}

export type PendingMember = {
  id: string
  policy_id: string
  node: string
  type: GuestType
  vmid: number
  zone_id: string
}

export type SuggestionKind = 'would_block' | 'blocked'
export type SuggestionStatus = 'pending' | 'accepted' | 'dismissed'

export type MicrosegSuggestion = {
  id: string
  policy_id: string
  kind: SuggestionKind
  /** Absent: 'in'. Outbound: `src_*` is the emitting zone, `dst_*` the destination. */
  direction?: FlowDirection
  src_key: string
  src_ip: string
  src_zone_id: string
  /** The destination: a zone id, an IP, or `0.0.0.0/0` / `::/0` for the aggregate "many destinations". Absent on lot-1 data. */
  dst_key?: string
  dst_ip: string
  /** Empty for an outbound flow to a destination outside any zone. */
  dst_zone_id: string
  proto: string
  dport: string
  hits: number
  first_seen: string
  last_seen: string
  status: SuggestionStatus
}

/** The aggregate outbound row: "many destinations". */
export function isAggregateDst(s: { dst_key?: string }): boolean {
  return s.dst_key === '0.0.0.0/0' || s.dst_key === '::/0'
}

/** What a revision froze: the tag prefix, the zones and the flows. */
export type MicrosegSnapshot = {
  tag_prefix: string
  zones: MicrosegZone[]
  flows: MicrosegFlow[]
}

/**
 * A revision. GET /policy returns `last_revision` WITHOUT its snapshot;
 * GET /revisions returns it.
 */
export type MicrosegRevision = {
  id: string
  version: number
  author: string
  created_at: string
  snapshot?: MicrosegSnapshot
}

/** GET /policy. */
export type MicrosegPolicy = {
  policy: MicrosegPolicyRecord
  zones: MicrosegZone[]
  flows: MicrosegFlow[]
  pending_members: PendingMember[]
  last_revision: MicrosegRevision | null
  version: number
  pending_changes: boolean
}

export type StepKind =
  | 'cluster.ratelimit' | 'ipset.create' | 'ipset.sync' | 'group.create' | 'group.rules'
  | 'guest.tags' | 'guest.group' | 'guest.nic' | 'guest.enable' | 'guest.observe.add'
  | 'guest.observe.remove' | 'guest.policy' | 'guest.restore' | 'guest.release'
  | 'group.delete' | 'ipset.delete' | 'rule.move' | (string & {})

/** One step of a plan, or one step outcome (Go `StepRef`). */
export type StepRef = {
  index: number
  kind: StepKind
  object: string
  guest?: GuestRef
  summary: string
  error?: string
}

/** A step of the plan window (alias of StepRef, kept for the brief's name). */
export type PlanStep = StepRef

export type MicrosegRunResult = {
  guests: number
  members: number
  /** "check" on the full run a manual check asked for (POST /check); absent on a scheduled run. */
  trigger?: string
  steps: number
  done?: StepRef[]
  failed?: StepRef[]
  not_run?: StepRef[]
  truncated?: boolean
  held?: boolean
  interrupted?: boolean
  collisions?: string[]
  foreign_rules?: string[]
  ambiguous?: GuestRef[]
  unread?: GuestRef[]
  drifts: number
  with_ips?: number
  events?: number
  suggestions?: number
  /** The nodes whose log page was full: the rest is read on the next run. */
  log_truncated?: string[]
  /** The nodes whose log rotated since the previous read: the last lines of the old file are not read. */
  log_rotated?: string[]
  errors?: string[]
  /** Ingress events left out because their destination is not the guest that logged them (flooded bridge). */
  dropped_foreign_dst?: number
  plan?: StepRef[]
  /** Draft version the plan was computed from. */
  version?: number
  revision_id?: string
  pending_applied?: number
  complete?: boolean
  notes?: string[]
  /** The run was written while the emergency stop holds the cluster firewall off. */
  stop_active?: boolean
}

export type RunKind = 'light' | 'ips' | 'full' | 'log' | 'targeted' | 'plan' | 'apply' | 'remove'
export type RunStatus = 'running' | 'done' | 'failed'

export type MicrosegRun = {
  id: string
  policy_id: string
  kind: RunKind | (string & {})
  status: RunStatus
  started_at: string
  duration_ms: number
  api_calls: number
  writes: number
  /** On GET /runs/{id}; GET /runs (list) carries it for the engine loops only (light, ips, full, log, targeted). */
  result?: MicrosegRunResult | null
  error: string
}

export type DriftKind =
  | 'unzoned_running' | 'nic_firewall_off' | 'foreign_accept' | 'ipset_out_of_sync'
  | 'member_without_ip' | 'ambiguous_zone' | 'object_collision' | (string & {})

export type MicrosegDrift = {
  kind: DriftKind
  guest?: GuestRef
  object?: string
  detail?: Record<string, unknown>
}

/** GET /drifts. `computed` is false until the first full run after an orchestrator restart or a leader change. */
export type MicrosegDriftList = { drifts: MicrosegDrift[]; computed: boolean }

export type PreflightStatus = 'pass' | 'warn' | 'fail'

export type PreflightCheck = {
  id: string
  status: PreflightStatus
  detail?: Record<string, unknown>
  fix?: string
}

export type MicrosegRunSummary = {
  started_at: string
  status: RunStatus
  api_calls: number
  writes: number
}

export type MicrosegCoverage = { running: number; zoned: number; members: number; protected: number }

/** What the engine reports of the Proxmox cluster firewall. */
export type ClusterFirewallState = 'enabled' | 'disabled' | 'unknown'

/** GET /status. */
export type MicrosegStatus = {
  engine: {
    paused_until: string | null
    held: boolean
    /** A manual check is queued and its full run has not started yet (absent on an orchestrator without the check). */
    check_pending?: boolean
    /**
     * The Proxmox cluster firewall as the engine last read it: the Emergency stop turns it off in one request
     * (absent on an orchestrator that does not report it).
     */
    cluster_firewall?: ClusterFirewallState
    last_runs: Record<string, MicrosegRunSummary>
    last_log: string | null
  }
  /** Null until the first full run after an orchestrator restart or a leader change: nothing is measured yet. */
  coverage: MicrosegCoverage | null
  /** When the coverage was measured (ISO), absent while `coverage` is null. */
  coverage_at?: string
  zones_by_state: Record<ZoneState, number>
  emergency_stop: boolean
  /** The log reading per node (absent on an orchestrator without it). */
  log_nodes?: MicrosegLogNode[]
}

export type MicrosegLogNode = {
  node: string
  lines_last: number
  lines_per_min_15m: number
  lag_seconds: number
  full_pages_24h: number
}

export type SuggestionAction = 'accept' | 'accept_cidr' | 'dismiss'

export type ZoneInput = {
  /** Present: PUT /zones/{id}; absent: POST /zones. */
  id?: string
  version: number
  name: string
  enforcement: ZoneEnforcement
  label?: string
  color?: string
  vnet_id?: string
  isolate_members?: boolean
  /** The orchestrator ignores `egress_state` on a zone write: it changes through setZoneEgressState. */
  egress_mode?: EgressMode
}

export type FlowInput = {
  /** Present: PUT /flows/{id}; absent: POST /flows. */
  id?: string
  version: number
  proto: string
  src_zone_id?: string
  src_cidr?: string
  dst_zone_id?: string
  dst_cidr?: string
  dport?: string
  comment?: string
  origin?: string
}

export type PolicyUpdate = {
  version: number
  tag_prefix?: string
  /** Partial: omitted fields keep their value. */
  settings?: Partial<Omit<MicrosegSettings, 'original_log_rate_limit'>>
}

/** A pending member by type and vmid (the node it was queued on may have changed since). */
export type PendingKey = { type: GuestType; vmid: number }

/**
 * POST /members: queues `guests` for `zone_id` ('' removes them from any zone) and/or deletes the pending change of each
 * `clear` guest (the undo of a queued removal or move; a guest with none is ignored). `zone_id` goes with `guests` only.
 */
export type MembersInput =
  | { version: number; zone_id: string; guests: GuestRef[]; clear?: PendingKey[] }
  | { version: number; clear: PendingKey[] }

export type ResolveSuggestionsInput = {
  version: number
  ids: string[]
  action: SuggestionAction
  /** accept_cidr on an outbound row: IPv4 8..32 (default 24), IPv6 16..128 (default 64); refused on the aggregate. */
  prefix_len?: number
}

/** POST /check: the check is queued, the engine starts it at its next pass (up to a minute). */
export type CheckQueued = { queued: boolean; requested_at: string }

export type EmergencyStopResult = { accepted: boolean; applied_by: 'self' | 'leader'; on: boolean }

/** A flow the engine saw towards a zone guest (the orchestrator's in-memory ring, read from the node logs every minute). */
export type MicrosegEvent = {
  /** Monotonic per connection, the newest event has the highest: the exact cursor of the paging. */
  seq: number
  ts: string
  node: string
  vmid: number
  type: GuestType
  guest: string
  /** The zone of the guest the flow reached (its name when the event was seen: a renamed zone keeps the old name on past events). */
  zone: string
  /** The zone of the source, empty when the source is in none. */
  src_zone: string
  src_ip: string
  dst_ip: string
  proto: string
  dport: number | string
  verdict: SuggestionKind
  /** Absent: 'in'. */
  direction?: FlowDirection
}

/** One row of GET /traffic: the hits of a (zone, source zone, verdict) in the bucket that starts at `at`. */
export type MicrosegTrafficBucket = {
  at: string
  /** The zone of the guest that logged the flow. */
  zone: string
  /** The zone of the source, empty when the source is in none. */
  src_zone: string
  verdict: string
  hits: number
  /** Absent: 'in'. For 'out', `zone` is the emitting zone and `src_zone` the destination zone ('' outside). */
  direction?: FlowDirection
}

/** GET /traffic: the persisted history of the flows (7 days), `step` in seconds. */
export type MicrosegTraffic = { step: number; from: string; to: string; buckets: MicrosegTrafficBucket[] }

/** GET /events: newest first. */
export type MicrosegEventList = {
  events: MicrosegEvent[]
  /** The page stopped at the limit or the ring dropped older lines. */
  truncated: boolean
  /** Time of the oldest event returned, null for an empty list. */
  oldest: string | null
}
