// src/lib/incidents/types.ts
//
// Shapes of the incident register (orchestrator /incidents/*), snake_case as
// the orchestrator sends them. Status, severity and the time bounds are
// computed by the orchestrator at read time.

export type IncidentStatus = 'open' | 'resolved' | 'closed'

export interface IncidentComment {
  id: string
  incident_id: string
  body: string
  internal: boolean
  author_id: string
  author_name: string
  created_at: string
  edited_at?: string
}

export interface IncidentAction {
  id: string
  incident_id: string
  text: string
  done: boolean
  done_by?: string
  done_at?: string
  position: number
}

/** An alert as the orchestrator sends it; the fields the register reads are typed. */
export interface IncidentAlert {
  id: string
  type?: string
  severity?: string
  connection_id?: string
  resource?: string
  resource_id?: number
  resolved_at?: string | null
  [key: string]: unknown
}

export interface IncidentView {
  id: string
  title: string
  root_cause: string
  impact: string
  postmortem_by?: string
  postmortem_at?: string
  created_by: string
  created_at: string
  updated_at: string
  status: IncidentStatus
  severity: string
  started_at: string
  ended_at?: string
  alerts: IncidentAlert[]
  comments: IncidentComment[]
  actions: IncidentAction[]
  alert_count: number
  comment_count: number
}

export interface IncidentSummary {
  id: string
  title: string
  status: IncidentStatus
  comment_count: number
}

export interface IncidentList {
  incidents: IncidentView[]
  total: number
}

export type OutageKind = 'node' | 'guest' | 'cluster'

export interface OutageQuery {
  connection_id: string
  kind: OutageKind
  node: string
  vmid: number
  from: string
  to: string
}

export interface IncidentCreateBody {
  title: string
  alert_id: string
  created_by: string
}

export interface IncidentPatch {
  title?: string
  root_cause?: string
  impact?: string
}

export interface ActionPatch {
  text?: string
  done?: boolean
}

export interface ForOutagesResponse {
  matches: unknown[]
}

export interface IncidentContextOutage {
  connection_id: string
  kind: OutageKind
  node: string
  vmid: number
  state: 'down'
  from: string
  to: string | null
}

export interface IncidentContext {
  incident: IncidentView
  outages: IncidentContextOutage[]
}
