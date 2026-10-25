// src/lib/tls/policy.ts
//
// Turns the stored settings into the handful of values start.js applies on
// every request. Kept here rather than in start.js because start.js is
// CommonJS outside the Next bundle and no unit test of this repo reaches it.

import type { TlsSettings } from '@/lib/tls/schema'

export interface HttpPolicy {
  redirect: boolean
  httpsPublicPort: number
  hstsHeader: string | null
}

export function hstsHeaderValue(hsts: TlsSettings['hsts']): string | null {
  if (!hsts.enabled) return null

  let value = `max-age=${hsts.maxAge}`

  if (hsts.includeSubDomains) value += '; includeSubDomains'
  if (hsts.preload) value += '; preload'

  return value
}

/**
 * The port users type is the PUBLISHED one, which Docker maps onto the
 * container's TLS_PORT. APP_URL is the only place that knows it, so the
 * redirect target is built from there and never from the listening socket.
 */
function publicHttpsPort(appUrl: string | undefined): number {
  try {
    const parsed = new URL(appUrl ?? '')

    if (parsed.port) return Number.parseInt(parsed.port, 10)
  } catch {
    // A malformed APP_URL falls through to the default below.
  }

  return 443
}

export function buildHttpPolicy(settings: TlsSettings, appUrl = process.env.APP_URL): HttpPolicy {
  // Redirecting to a port nothing listens on would lock the operator out of
  // their own appliance, so every branch below is gated on `enabled`.
  if (!settings.enabled) return { redirect: false, httpsPublicPort: publicHttpsPort(appUrl), hstsHeader: null }

  return {
    redirect: settings.redirectHttp,
    httpsPublicPort: publicHttpsPort(appUrl),
    hstsHeader: hstsHeaderValue(settings.hsts),
  }
}

/**
 * Strips the port from a `Host` header while keeping IPv6 brackets, since
 * `[2001:db8::1]:3000`.split(':')[0] truncates the address itself and
 * produces a Location header `new URL()` rejects outright. Returns null
 * instead of a broken host for an empty or unparsable header, so the caller
 * can skip the redirect rather than emit one that fails.
 *
 * This is the tested source of truth for the identical, hand-mirrored
 * function in start.js: start.js is CommonJS outside the Next bundle and
 * cannot import this module directly, so keep the two in sync by hand.
 */
export function redirectHost(hostHeader: string | undefined): string | null {
  const host = String(hostHeader ?? '').trim()

  if (!host) return null

  if (host.startsWith('[')) {
    const end = host.indexOf(']')

    return end === -1 ? null : host.slice(0, end + 1)
  }

  return host.split(':')[0] || null
}
