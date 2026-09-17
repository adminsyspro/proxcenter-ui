import { NextResponse } from 'next/server'

import { parseOrchestratorError } from './client'

export const ORCHESTRATOR_UNAVAILABLE = 'ORCHESTRATOR_UNAVAILABLE'

export function replicationErrorResponse(error: unknown, fallback: string) {
  // The Go server drops a long request after 30 s but finishes the work
  // (roadmap#8): tag the answer so the page refreshes before it reports.
  if ((error as { code?: string } | null)?.code === ORCHESTRATOR_UNAVAILABLE) {
    return NextResponse.json(
      { error: (error instanceof Error && error.message) || fallback, code: ORCHESTRATOR_UNAVAILABLE },
      { status: 503 },
    )
  }

  const upstream = parseOrchestratorError(error)

  return NextResponse.json(
    { ...(upstream?.details ?? {}), error: upstream?.message || (error instanceof Error ? error.message : fallback) },
    { status: upstream?.status || 500 },
  )
}
