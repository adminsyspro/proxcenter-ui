// Single source of truth for NextAuth cookie names and the `secure` flag.
//
// The NAMES stay derived from NEXTAUTH_URL and static for the process
// lifetime: three readers (proxy.ts twice, the 2FA verify route) must
// look up the same name the issuer wrote, and they have no per-request
// agreement with it.
//
// The FLAG is per-request and monotonic: env OR actual transport. It can only
// ever ADD `Secure`, never remove it, so no existing session regresses. A
// spoofed x-forwarded-proto can only make the attacker's own browser refuse
// to send the cookie over http — the failure direction is safe, which is why
// this needs no TRUST_PROXY_HEADERS opt-in. Requiring one would recreate the
// exact trap being fixed: TLS added, variable forgotten, still vulnerable.

export function envPrefersSecureCookies(): boolean {
  return process.env.NEXTAUTH_URL?.startsWith('https://') ?? false
}

export function sessionCookieName(): string {
  return envPrefersSecureCookies()
    ? '__Secure-next-auth.session-token'
    : 'next-auth.session-token'
}

export function callbackUrlCookieName(): string {
  return envPrefersSecureCookies()
    ? '__Secure-next-auth.callback-url'
    : 'next-auth.callback-url'
}

export function csrfCookieName(): string {
  return envPrefersSecureCookies()
    ? '__Host-next-auth.csrf-token'
    : 'next-auth.csrf-token'
}

export function requestPrefersSecure(headers: Headers | null | undefined): boolean {
  if (!headers) return false
  const proto = headers.get('x-forwarded-proto')
  if (proto) {
    // Only the first hop is client-facing; later hops describe internal legs.
    const first = proto.split(',')[0]?.trim().toLowerCase()
    if (first === 'https') return true
    if (first === 'http') return false
  }
  return headers.get('x-forwarded-ssl')?.trim().toLowerCase() === 'on'
}

export function resolveCookieSecure(headers: Headers | null | undefined): boolean {
  return envPrefersSecureCookies() || requestPrefersSecure(headers)
}
