// src/lib/incidents/orchestrator.ts
//
// Calls of the incident register (orchestrator /incidents/*) and the answer to
// a failed call. The orchestrator has no session: the proxy routes put the
// author in the body, taken from the session, never from the request.

import { NextResponse } from 'next/server'

import { codeResponse, orchestratorUnavailable } from '@/lib/availability/orchestrator'
import { Features } from '@/lib/license/features'
import { safeLog } from '@/lib/log/sanitize'
import { orchestratorFetch, orchestratorPath, parseOrchestratorError } from '@/lib/orchestrator/client'
import { ORCHESTRATOR_UNAVAILABLE } from '@/lib/orchestrator/replicationError'

import type {
  ActionPatch,
  ForOutagesResponse,
  IncidentAction,
  IncidentComment,
  IncidentContext,
  IncidentCreateBody,
  IncidentList,
  IncidentPatch,
  IncidentSummary,
  IncidentView,
  IncidentAlert,
  OutageQuery,
} from './types'

/** What an upstream code must look like to be relayed as is. */
const UPSTREAM_CODE = /^[A-Z][A-Z_]{0,63}$/

/** The statuses of the register's own refusals (incidentError and requireIncidentStore in the orchestrator). */
const RELAYED_STATUS = new Set([400, 404, 409, 503])

/** Like the SLA one, with the feature id of the register. */
export const featureRequired = (): NextResponse =>
  NextResponse.json({ error: 'feature_required', feature: Features.INCIDENTS }, { status: 403 })

export interface ListFilter {
  status?: string
  from?: string
  to?: string
  limit?: string
  offset?: string
}

function query(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v)
  const s = q.toString()
  return s ? `?${s}` : ''
}

export function listIncidents(filter: ListFilter): Promise<IncidentList> {
  return orchestratorFetch<IncidentList>(`/incidents${query({ ...filter })}`)
}

export function createIncident(body: IncidentCreateBody): Promise<IncidentView> {
  return orchestratorFetch<IncidentView>('/incidents', { method: 'POST', body })
}

export function getIncident(id: string): Promise<IncidentView> {
  return orchestratorFetch<IncidentView>(orchestratorPath`/incidents/${id}`)
}

export function patchIncident(id: string, body: IncidentPatch): Promise<IncidentView> {
  return orchestratorFetch<IncidentView>(orchestratorPath`/incidents/${id}`, { method: 'PATCH', body })
}

export function deleteIncident(id: string): Promise<{ status: string }> {
  return orchestratorFetch<{ status: string }>(orchestratorPath`/incidents/${id}`, { method: 'DELETE' })
}

export function getIncidentContext(id: string): Promise<IncidentContext> {
  return orchestratorFetch<IncidentContext>(orchestratorPath`/incidents/${id}/context`)
}

export function getIncidentCandidates(id: string): Promise<{ alerts: IncidentAlert[] }> {
  return orchestratorFetch<{ alerts: IncidentAlert[] }>(orchestratorPath`/incidents/${id}/candidates`)
}

export function attachAlert(id: string, body: { alert_id: string; by: string }): Promise<IncidentView> {
  return orchestratorFetch<IncidentView>(orchestratorPath`/incidents/${id}/alerts`, { method: 'POST', body })
}

export function detachAlert(id: string, alertId: string): Promise<IncidentView> {
  return orchestratorFetch<IncidentView>(orchestratorPath`/incidents/${id}/alerts/${alertId}`, { method: 'DELETE' })
}

export function addComment(
  id: string,
  body: { body: string; internal: boolean; author_id: string; author_name: string },
): Promise<IncidentComment> {
  return orchestratorFetch<IncidentComment>(orchestratorPath`/incidents/${id}/comments`, { method: 'POST', body })
}

export function editComment(id: string, cid: string, body: { body: string; author_id: string }): Promise<IncidentComment> {
  return orchestratorFetch<IncidentComment>(orchestratorPath`/incidents/${id}/comments/${cid}`, { method: 'PATCH', body })
}

export function deleteComment(id: string, cid: string): Promise<{ status: string }> {
  return orchestratorFetch<{ status: string }>(orchestratorPath`/incidents/${id}/comments/${cid}`, { method: 'DELETE' })
}

export function addAction(id: string, body: { text: string }): Promise<IncidentAction> {
  return orchestratorFetch<IncidentAction>(orchestratorPath`/incidents/${id}/actions`, { method: 'POST', body })
}

export function updateAction(id: string, aid: string, body: ActionPatch & { by: string }): Promise<IncidentAction> {
  return orchestratorFetch<IncidentAction>(orchestratorPath`/incidents/${id}/actions/${aid}`, { method: 'PATCH', body })
}

export function deleteAction(id: string, aid: string): Promise<{ status: string }> {
  return orchestratorFetch<{ status: string }>(orchestratorPath`/incidents/${id}/actions/${aid}`, { method: 'DELETE' })
}

export function closeIncident(id: string, body: { by: string }): Promise<IncidentView> {
  return orchestratorFetch<IncidentView>(orchestratorPath`/incidents/${id}/close`, { method: 'POST', body })
}

export function reopenIncident(id: string): Promise<IncidentView> {
  return orchestratorFetch<IncidentView>(orchestratorPath`/incidents/${id}/reopen`, { method: 'POST', body: {} })
}

export function incidentsByAlerts(ids: string[]): Promise<{ incidents: Record<string, IncidentSummary> }> {
  return orchestratorFetch<{ incidents: Record<string, IncidentSummary> }>(`/incidents/by-alerts${query({ ids: ids.join(',') })}`)
}

export function incidentsForOutages(outages: OutageQuery[]): Promise<ForOutagesResponse> {
  return orchestratorFetch<ForOutagesResponse>('/incidents/for-outages', { method: 'POST', body: { outages } })
}

/**
 * The answer to a failed call: the licence refusal and the register's own
 * refusals (400, 404, 409, 503 INCIDENTS_UNAVAILABLE) relayed as {error, code}
 * with the upstream status, anything else from the orchestrator (or no answer
 * at all) as orchestrator_unavailable. A client never receives the text of an
 * upstream error.
 */
export function incidentErrorResponse(error: unknown, context: string): NextResponse {
  const upstream = parseOrchestratorError(error)
  if (upstream) {
    const code = typeof upstream.details?.code === 'string' ? upstream.details.code : ''
    if (upstream.status === 403 && code === 'FEATURE_REQUIRED') return featureRequired()
    if (RELAYED_STATUS.has(upstream.status) && UPSTREAM_CODE.test(code)) {
      return NextResponse.json({ error: code.toLowerCase(), code }, { status: upstream.status })
    }
    console.error(`[incidents] ${context}: orchestrator ${upstream.status}`, safeLog(upstream.message))
    return orchestratorUnavailable()
  }
  const code = (error as { code?: string } | null)?.code
  const message = error instanceof Error ? error.message : String(error)
  if (code === ORCHESTRATOR_UNAVAILABLE || message === 'Orchestrator request timeout') return orchestratorUnavailable()
  console.error(`[incidents] ${context}:`, safeLog(message))
  return codeResponse('internal_error', 500)
}
