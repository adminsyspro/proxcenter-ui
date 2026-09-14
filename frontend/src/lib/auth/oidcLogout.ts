// src/lib/auth/oidcLogout.ts
//
// RP-initiated logout (OpenID Connect RP-Initiated Logout 1.0).
//
// NextAuth's signOut() only clears the local cookie. The IdP keeps its own
// session cookie, so the next authorize request is silently re-authenticated
// and the user lands back in the app without a password prompt. On a shared
// workstation that is a real problem: "sign out" has to mean signed out.
//
// The end_session_endpoint is discovered from the issuer rather than
// configured: it is not part of the config form, and a provider that does not
// advertise one (Google, for instance) simply gets the local sign-out we always
// did. Degrading is deliberate — a missing endpoint must never block a logout.

const DISCOVERY_TTL_MS = 5 * 60 * 1000

type CacheEntry = { endSession: string | null; at: number }
const discoveryCache = new Map<string, CacheEntry>()

/** Exposed for tests; the TTL makes a stale IdP change self-heal in 5 minutes. */
export function clearEndSessionCache(): void {
  discoveryCache.clear()
}

/**
 * Build the discovery URL for an issuer, or null when the issuer is not a plain
 * http(s) URL. Rebuilt from the parsed components so a crafted issuer cannot
 * smuggle a query string or credentials into the fetch (same guard as the
 * discovery test route).
 */
export function buildDiscoveryUrl(issuerUrl: string | null | undefined): string | null {
  if (!issuerUrl) return null
  let base = String(issuerUrl).trim()
  while (base.endsWith("/")) base = base.slice(0, -1)
  if (!base) return null

  try {
    const parsed = new URL(`${base}/.well-known/openid-configuration`)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return null
  }
}

/**
 * Read `end_session_endpoint` from the issuer's discovery document. Returns null
 * when the issuer is unreachable, malformed, or advertises no such endpoint.
 * Cached for 5 minutes, including the null answer, so a logout never waits on a
 * slow IdP more than once.
 */
export async function discoverEndSessionEndpoint(
  issuerUrl: string | null | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const discoveryUrl = buildDiscoveryUrl(issuerUrl)
  if (!discoveryUrl) return null

  const cached = discoveryCache.get(discoveryUrl)
  if (cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.endSession

  let endSession: string | null = null
  try {
    const res = await fetchImpl(discoveryUrl, {
      signal: AbortSignal.timeout(5000),
      headers: { Accept: "application/json" },
    })
    if (res.ok) {
      const doc = await res.json()
      const raw = doc?.end_session_endpoint
      if (typeof raw === "string" && raw) {
        const parsed = new URL(raw)
        if (parsed.protocol === "http:" || parsed.protocol === "https:") endSession = raw
      }
    }
  } catch (e: any) {
    console.warn(`[oidcLogout] discovery failed for ${discoveryUrl}: ${e?.message || e}`)
  }

  discoveryCache.set(discoveryUrl, { endSession, at: Date.now() })
  return endSession
}

/**
 * Assemble the end-session URL.
 *
 * `id_token_hint` is the interoperable form and the only one Okta accepts, so it
 * wins whenever the token is at hand. An expired hint is fine: the spec has the
 * OP treat it as a hint, not as authentication. Without it we fall back to
 * `client_id`, which is what Keycloak and Entra need to skip their "really log
 * out?" confirmation screen.
 */
export function buildEndSessionUrl(params: {
  endSessionEndpoint: string
  idToken?: string | null
  clientId?: string | null
  postLogoutRedirectUri: string
}): string {
  const { endSessionEndpoint, idToken, clientId, postLogoutRedirectUri } = params
  const url = new URL(endSessionEndpoint)
  url.searchParams.set("post_logout_redirect_uri", postLogoutRedirectUri)
  if (idToken) url.searchParams.set("id_token_hint", idToken)
  else if (clientId) url.searchParams.set("client_id", clientId)
  return url.toString()
}
