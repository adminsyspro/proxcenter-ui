// src/lib/backups/restoreDrills/orchestratorFetch.ts
//
// Raw GET of a drill sub-resource on the orchestrator, for the routes that
// relay something else than JSON (the evidence PDF, the console screenshot):
// orchestratorFetch hides the status code of a refusal and parses JSON.

import { NextResponse } from 'next/server'

import { orchestratorHeaders } from '@/lib/orchestrator/headers'

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:8080'
const DEFAULT_TIMEOUT_MS = 30_000

export type DrillResourceFetch = { res: Response } | { response: Response }

/** GET `/restore-drills/{id}/{resource}`; a ready 503 answer when the orchestrator is out of reach. */
export async function fetchDrillResource(id: string, resource: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<DrillResourceFetch> {
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/api/v1/restore-drills/${encodeURIComponent(id)}/${resource}`, {
      headers: await orchestratorHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    })
    return { res }
  } catch {
    return { response: NextResponse.json({ error: 'Orchestrator unavailable', code: 'ORCHESTRATOR_UNAVAILABLE' }, { status: 503 }) }
  }
}

/** The body as JSON, or null for a plain text one. */
export function parseJsonBody(text: string): any {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** A refusal of the orchestrator relayed with its status: its `error` field, else its text. */
export function relayedError(status: number, text: string): Response {
  const parsed = parseJsonBody(text)
  const error = typeof parsed?.error === 'string' && parsed.error ? parsed.error : text || `Orchestrator error ${status}`
  return NextResponse.json({ error }, { status })
}
