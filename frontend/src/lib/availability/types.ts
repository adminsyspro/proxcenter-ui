// src/lib/availability/types.ts
//
// Mirrors of the orchestrator's availability types (internal/availability),
// field for field with their JSON tags: the routes relay these shapes as is.
// Times are RFC 3339 strings in UTC.

export type AvailabilityKind = 'node' | 'cluster' | 'guest'

/** up, down and maintenance are recorded; unobserved and absent are derived. */
export type AvailabilityState = 'up' | 'down' | 'maintenance' | 'unobserved' | 'absent'

/** A guest is keyed by its vmid alone (node empty), a node by its name. */
export interface ObjectRef {
  connection_id: string
  kind: AvailabilityKind
  node?: string
  vmid?: number
}

export interface Slot {
  start: string
  state: AvailabilityState
}

/** A run of down time; `state` is always `down`. */
export interface Incident {
  from: string
  to: string
  state: AvailabilityState
}

export interface Result {
  ref: ObjectRef
  up_seconds: number
  down_seconds: number
  maintenance_seconds: number
  unobserved_seconds: number
  /** %, null when up + down is zero. */
  availability: number | null
  /** %, null when up + down + unobserved is zero. */
  coverage: number | null
  slots: Slot[]
  incidents: Incident[]
}

export interface Budget {
  allowed_seconds: number
  used_seconds: number
  remaining_seconds: number
}

export interface Summary {
  up_seconds: number
  down_seconds: number
  unobserved_seconds: number
  availability: number | null
  coverage: number | null
  /** Objects under the target, 0 without a target. */
  below_target: number
  /** null without a target. */
  budget: Budget | null
}

/** What a tenant may see of one connection: everything, or these nodes and the guests of these pools. */
export interface ConnScope {
  all: boolean
  nodes?: string[]
  pools?: string[]
}

/** null (never this object) is the provider; a connection absent from `connections` is not visible. */
export interface AvailabilityScope {
  connections: Record<string, ConnScope>
}

export interface CurrentState {
  ref: ObjectRef
  state: AvailabilityState
}

/** POST /availability/query */
export interface QueryRequest {
  from: string
  to: string
  slot_seconds: number
  tenant_id: string
  scope: AvailabilityScope | null
  connection_ids?: string[]
  objects?: ObjectRef[]
  policy_id?: string
}

export interface QueryResponse {
  from: string
  to: string
  results: Result[]
  summary: Summary
  policy: { id: string; name: string; target: number } | null
}

/** POST /availability/current */
export interface CurrentRequest {
  connection_ids: string[]
  tenant_id: string
  scope: AvailabilityScope | null
  include_covered: boolean
}

export interface CurrentResponse {
  collected_at: Record<string, string>
  states: CurrentState[]
  covered_guests_down: number | null
}

/** GET / PUT /availability/settings */
export interface OrchestratorAvailabilitySettings {
  retention_days?: number
  /** The connections the registry measures; none until ticked. */
  connection_ids?: string[]
  /** The enabled policies covering a guest of each connection, by name. */
  connection_policies?: Record<string, string[]>
}

/** A guest ticked in a policy, as stored in SlaPolicy.guests. */
export interface GuestKey {
  connectionId: string
  vmid: number
}
