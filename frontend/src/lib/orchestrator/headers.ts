// Lightweight header helper for Next.js API routes that proxy directly
// to the orchestrator via raw fetch() (instead of the orchestratorFetch
// client). These routes still need to send X-API-Key, otherwise the
// orchestrator auth middleware returns 401. Centralising the env read
// and the conditional header lets callers stay one-liner without
// silently dropping the key when ORCHESTRATOR_API_KEY is empty.
//
// Async since issue #1105: the actor headers (who is behind the call, for
// the orchestrator's own audit rows) come from the ambient request, and
// reading a session is asynchronous. Outside a request they are left out.

import { actorHeaders } from './actor'

const ORCHESTRATOR_API_KEY = process.env.ORCHESTRATOR_API_KEY || ''

export async function orchestratorHeaders(
  extra: Record<string, string> = {}
): Promise<Record<string, string>> {
  // Server identity and actor are written AFTER the caller's extras on
  // purpose: a caller-supplied value must not override them.
  const headers: Record<string, string> = { ...extra, ...(await actorHeaders()) }
  if (ORCHESTRATOR_API_KEY) {
    headers['X-API-Key'] = ORCHESTRATOR_API_KEY
  }
  return headers
}
