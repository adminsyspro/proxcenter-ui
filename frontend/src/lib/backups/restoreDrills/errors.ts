// src/lib/backups/restoreDrills/errors.ts
//
// Relays an orchestrator failure with its own status and body: the 422 of a
// refused drill carries the preflight, the 409 names the concurrency limit or
// the state that forbids a cancel or a cleanup. The dialog needs both.

import { ORCHESTRATOR_UNAVAILABLE, replicationErrorResponse } from '@/lib/orchestrator/replicationError'

export function drillErrorResponse(error: unknown, fallback: string): Response {
  if ((error as { code?: string } | null)?.code !== ORCHESTRATOR_UNAVAILABLE) {
    console.error(`[restore-drills] ${fallback}:`, error instanceof Error ? error.message : error)
  }
  return replicationErrorResponse(error, fallback)
}
