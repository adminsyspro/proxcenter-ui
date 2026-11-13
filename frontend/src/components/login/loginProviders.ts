// Login page helpers for the tenant login URL /login/<slug> (issue #1289).

const PROVIDERS_API = '/api/v1/auth/providers'
const PROVIDER_IDP = 'oidc'

/** Endpoint describing the sign-in options of /login, or of a tenant's /login/<slug>. */
export function providersEndpoint(tenantSlug?: string | null): string {
  return tenantSlug ? `${PROVIDERS_API}?tenant=${encodeURIComponent(tenantSlug)}` : PROVIDERS_API
}

/**
 * NextAuth provider the SSO button starts: the one the API named (a tenant's
 * own IdP is "oidc-<tenant>"), else the provider IdP.
 */
export function ssoProviderId(answer: { oidcProviderId?: unknown } | null | undefined): string {
  const id = answer?.oidcProviderId
  return typeof id === 'string' && (id === PROVIDER_IDP || id.startsWith(`${PROVIDER_IDP}-`)) ? id : PROVIDER_IDP
}

export type SsoDeps = {
  signIn: (provider: string, options: { callbackUrl: string }) => Promise<unknown>
  getCsrfToken: () => Promise<string | undefined>
  fetch: typeof fetch
  navigate: (url: string) => void
}

/**
 * Start the SSO button's flow. The provider IdP goes through next-auth's client
 * signIn() as always. A tenant IdP is deliberately absent from the public
 * provider list (it would enumerate the tenants), and signIn() refuses a
 * provider it does not list, so its sign-in is posted directly: the same
 * request signIn() would send, to a route that registers that one provider.
 */
export async function startSso(providerId: string, callbackUrl: string, deps: SsoDeps): Promise<void> {
  if (providerId === PROVIDER_IDP) {
    await deps.signIn(providerId, { callbackUrl })
    return
  }
  const csrfToken = (await deps.getCsrfToken()) || ''
  const res = await deps.fetch(`/api/auth/signin/${encodeURIComponent(providerId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrfToken, callbackUrl, json: 'true' }),
  })
  const data = await res.json().catch(() => ({}))
  deps.navigate(typeof data?.url === 'string' && data.url ? data.url : callbackUrl)
}
