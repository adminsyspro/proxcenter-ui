// src/lib/orchestrator/actor.ts
//
// Who is behind an orchestrator call (issue #1105). The Go backend writes its
// own audit rows (DRS moves, rolling updates, drains, replication) and names
// the actor from these two headers; without them the row says
// `system:orchestrator`. Resolved best-effort from the ambient request: a
// background job has no request, `headers()` throws, and the headers are
// simply left out.

export const ACTOR_ID_HEADER = 'X-ProxCenter-Actor-Id'
export const ACTOR_EMAIL_HEADER = 'X-ProxCenter-Actor-Email'

/** Printable ASCII only: a header value can carry neither CR/LF nor UTF-8. */
function headerSafe(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, '').trim()
}

export async function actorHeaders(): Promise<Record<string, string>> {
  try {
    // Imported on use: principal.ts pulls next/headers and the auth chain,
    // which the callers of lib/orchestrator/headers.ts must not load upfront.
    const { getPrincipal } = await import('@/lib/auth/principal')
    const { principal } = await getPrincipal()
    if (!principal) return {}

    const out: Record<string, string> = {}
    if (principal.kind === 'token') {
      // A token has no user; the orchestrator row names the token instead.
      const tokenId = headerSafe(principal.tokenId ?? '')
      if (tokenId) out[ACTOR_EMAIL_HEADER] = `token:${tokenId}`
      return out
    }
    const userId = headerSafe(principal.userId ?? '')
    const userEmail = headerSafe(principal.userEmail ?? '')
    if (userId) out[ACTOR_ID_HEADER] = userId
    if (userEmail) out[ACTOR_EMAIL_HEADER] = userEmail
    return out
  } catch {
    // No request scope, or the session could not be read: unattributed call.
    return {}
  }
}
