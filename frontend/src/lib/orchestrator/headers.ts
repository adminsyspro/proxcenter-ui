// Lightweight header helper for Next.js API routes that proxy directly
// to the orchestrator via raw fetch() (instead of the orchestratorFetch
// client). These routes still need to send X-API-Key, otherwise the
// orchestrator auth middleware returns 401. Centralising the env read
// and the conditional header lets callers stay one-liner without
// silently dropping the key when ORCHESTRATOR_API_KEY is empty.

const ORCHESTRATOR_API_KEY = process.env.ORCHESTRATOR_API_KEY || ''

export function orchestratorHeaders(
  extra: Record<string, string> = {}
): Record<string, string> {
  const headers: Record<string, string> = { ...extra }
  if (ORCHESTRATOR_API_KEY) {
    headers['X-API-Key'] = ORCHESTRATOR_API_KEY
  }
  return headers
}
