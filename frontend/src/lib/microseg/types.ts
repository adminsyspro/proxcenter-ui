// src/lib/microseg/types.ts
//
// The JSON the orchestrator's micro-segmentation API speaks (snake_case, as
// the Go json tags in internal/microseg/{models,engine_result,drift,preflight,
// inventory}.go and the envelopes of internal/api/microseg*.go).

export type GuestType = 'qemu' | 'lxc'

export type GuestRef = { node: string; type: GuestType; vmid: number }

export type ZoneState = 'disabled' | 'observe' | 'enforce'
export type ZoneEnforcement = 'guest' | 'vnet'

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
}

/** The policy row of a connection (Go `Policy`). */
export type MicrosegPolicyRecord = {
  id: string
  connection_id: string
  tag_prefix: string
  version: number
  settings: MicrosegSettings
  emergency_stop: boolean
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
}

export type FlowOrigin = 'manual' | 'suggestion' | string

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
  src_key: string
  src_ip: string
  src_zone_id: string
  dst_ip: string
  dst_zone_id: string
  proto: string
  dport: string
  hits: number
  first_seen: string
  last_seen: string
  status: SuggestionStatus
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
  log_truncated?: string[]
  errors?: string[]
  plan?: StepRef[]
  /** Draft version the plan was computed from. */
  version?: number
  revision_id?: string
  pending_applied?: number
  complete?: boolean
  notes?: string[]
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
  /** Omitted by GET /runs (list), present on GET /runs/{id}. */
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

/** GET /status. */
export type MicrosegStatus = {
  engine: {
    paused_until: string | null
    held: boolean
    last_runs: Record<string, MicrosegRunSummary>
    last_log: string | null
  }
  coverage: MicrosegCoverage
  zones_by_state: Record<ZoneState, number>
  emergency_stop: boolean
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

export type MembersInput = {
  version: number
  /** '' removes the guests from any zone. */
  zone_id: string
  guests: GuestRef[]
}

export type ResolveSuggestionsInput = {
  version: number
  ids: string[]
  action: SuggestionAction
}

export type EmergencyStopResult = { accepted: boolean; applied_by: 'self' | 'leader'; on: boolean }
