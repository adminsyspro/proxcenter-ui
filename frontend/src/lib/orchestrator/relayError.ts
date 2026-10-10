import { NextResponse } from 'next/server'

import { parseOrchestratorError } from './client'
import { ORCHESTRATOR_UNAVAILABLE } from './replicationError'

/**
 * Error answer of a route that only relays to the orchestrator. Validation
 * answers (4xx) are passed through with their message so the dialog shows
 * the actual reason; anything else is a 500 carrying the error message, or
 * the fallback. An unreachable orchestrator is expected and not logged.
 */
export function relayOrchestratorError(error: unknown, fallback: string) {
  const upstream = parseOrchestratorError(error)

  if (upstream && upstream.status >= 400 && upstream.status < 500) {
    return NextResponse.json({ error: upstream.message }, { status: upstream.status })
  }

  if ((error as { code?: string } | null)?.code !== ORCHESTRATOR_UNAVAILABLE) {
    console.error(fallback, error)
  }

  return NextResponse.json({ error: (error instanceof Error && error.message) || fallback }, { status: 500 })
}
