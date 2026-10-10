// src/lib/net/clientIp.ts
// Client IP of the current request, trusting only the X-Forwarded-For hops
// our own reverse proxies appended.
//
// Every proxy appends the address it received the request from, so with N
// trusted proxies the client is the entry at position len - N. With the
// shipped nginx alone (N = 1) that is its $remote_addr; anything to the left
// was written by the client and is ignored. X-Real-IP is not read: behind a
// load balancer it holds the balancer's address, without a proxy it is forged.
//
// N is the "Trusted reverse proxies" security policy (login_trusted_proxies).
// 0 = ProxCenter is exposed directly: every header is client-controlled and a
// route handler does not see the socket address, so no IP is resolved.

import { prisma } from "@/lib/db/prisma"

export const DEFAULT_TRUSTED_PROXIES = 1

// Audit writes resolve the IP on every call: the setting is cached briefly.
// Another instance of an HA deployment picks a change up within the TTL.
const CACHE_TTL_MS = 30_000

let cache: { value: number; expiresAt: number } | null = null

/** Drop the cached setting, called when the security policies are saved. */
export function invalidateTrustedProxiesCache(): void {
  cache = null
}

export async function getTrustedProxies(): Promise<number> {
  const now = Date.now()
  if (cache && cache.expiresAt > now) return cache.value

  let value = DEFAULT_TRUSTED_PROXIES
  try {
    const row = await prisma.securityPolicy.findFirst({
      where: { id: "default", tenantId: "default" },
      select: { loginTrustedProxies: true },
    })
    const n = Number(row?.loginTrustedProxies)
    if (row && Number.isInteger(n) && n >= 0) value = n
  } catch {
    // Policy unreadable: keep the shipped topology (our nginx in front).
  }
  cache = { value, expiresAt: now + CACHE_TTL_MS }
  return value
}

/**
 * Pure resolution: the X-Forwarded-For entry the outermost trusted proxy saw,
 * or null when there is no header, fewer hops than trusted proxies, or no
 * trusted proxy at all.
 */
export function resolveClientIp(forwardedFor: string | string[] | null | undefined, trustedProxies: number): string | null {
  if (!(trustedProxies > 0)) return null
  const value = Array.isArray(forwardedFor) ? forwardedFor.join(",") : forwardedFor ?? ""
  const hops = value.split(",").map((h) => h.trim()).filter(Boolean)
  if (hops.length < trustedProxies) return null
  return hops[hops.length - trustedProxies] || null
}

type HeaderSource = Headers | Record<string, unknown> | null | undefined

/** X-Forwarded-For from a Fetch `Headers` or from the plain object NextAuth hands to `authorize`. */
export function forwardedForOf(headers: HeaderSource): string | string[] | null {
  if (!headers) return null
  if (typeof (headers as Headers).get === "function") return (headers as Headers).get("x-forwarded-for")
  const raw = (headers as Record<string, unknown>)["x-forwarded-for"]
  if (typeof raw === "string") return raw
  if (Array.isArray(raw)) return raw.map(String)
  return null
}

/** Client IP for these headers, with the trusted proxies setting (cached). */
export async function clientIpFromHeaders(headers: HeaderSource): Promise<string | null> {
  return resolveClientIp(forwardedForOf(headers), await getTrustedProxies())
}
