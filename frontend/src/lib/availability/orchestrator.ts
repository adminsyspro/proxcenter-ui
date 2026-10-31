// src/lib/availability/orchestrator.ts
//
// Calls of the availability registry (orchestrator /availability/*) and the
// short error codes the routes answer with. A client never receives the text
// of an upstream error: only a code, never a connection, node or guest name.

import { NextResponse } from 'next/server'

import { Features } from '@/lib/license/features'
import { safeLog } from '@/lib/log/sanitize'
import { orchestratorFetch, parseOrchestratorError } from '@/lib/orchestrator/client'
import { ORCHESTRATOR_UNAVAILABLE } from '@/lib/orchestrator/replicationError'

import type {
  CurrentRequest,
  CurrentResponse,
  OrchestratorAvailabilitySettings,
  QueryRequest,
  QueryResponse,
} from './types'

/** What an upstream code must look like to be relayed as is. */
const SHORT_CODE = /^[a-z][a-z_]{0,63}$/

export function codeResponse(error: string, status: number): NextResponse {
  return NextResponse.json({ error }, { status })
}

export const featureRequired = (): NextResponse =>
  NextResponse.json({ error: 'feature_required', feature: Features.SLA_MONITORING }, { status: 403 })

export const notFound = (): NextResponse => codeResponse('not_found', 404)

export const orchestratorUnavailable = (): NextResponse => codeResponse('orchestrator_unavailable', 503)

export function queryAvailability(body: QueryRequest): Promise<QueryResponse> {
  return orchestratorFetch<QueryResponse>('/availability/query', { method: 'POST', body })
}

export function currentAvailability(body: CurrentRequest): Promise<CurrentResponse> {
  return orchestratorFetch<CurrentResponse>('/availability/current', { method: 'POST', body })
}

export function getRetentionSettings(): Promise<OrchestratorAvailabilitySettings> {
  return orchestratorFetch<OrchestratorAvailabilitySettings>('/availability/settings')
}

export function putRetentionSettings(body: OrchestratorAvailabilitySettings): Promise<OrchestratorAvailabilitySettings> {
  return orchestratorFetch<OrchestratorAvailabilitySettings>('/availability/settings', { method: 'PUT', body })
}

/** The connections the registry measures. */
export async function getMeasuredConnections(): Promise<string[]> {
  return (await getRetentionSettings()).connection_ids ?? []
}

/** The status of an orchestrator refusal, null when the call did not get an answer. */
export function upstreamStatus(error: unknown): number | null {
  return parseOrchestratorError(error)?.status ?? null
}

/**
 * The answer to a failed call: the licence refusal and a 400 code relayed,
 * a 404 as not_found, anything else from the orchestrator (or no answer at
 * all) as orchestrator_unavailable, so the page shows its banner and no
 * figure. An error of our own (Prisma) is a 500.
 */
export function availabilityErrorResponse(error: unknown, context: string): NextResponse {
  const upstream = parseOrchestratorError(error)
  if (upstream) {
    // The orchestrator's licence gate answers {code: FEATURE_REQUIRED}.
    if (upstream.status === 403 && upstream.details?.code === 'FEATURE_REQUIRED') return featureRequired()
    if (upstream.status === 404) return notFound()
    if (upstream.status === 400) return codeResponse(SHORT_CODE.test(upstream.message) ? upstream.message : 'invalid_request', 400)
    console.error(`[availability] ${context}: orchestrator ${upstream.status}`, safeLog(upstream.message))
    return orchestratorUnavailable()
  }
  const code = (error as { code?: string } | null)?.code
  const message = error instanceof Error ? error.message : String(error)
  if (code === ORCHESTRATOR_UNAVAILABLE || message === 'Orchestrator request timeout') return orchestratorUnavailable()
  console.error(`[availability] ${context}:`, safeLog(message))
  return codeResponse('internal_error', 500)
}
