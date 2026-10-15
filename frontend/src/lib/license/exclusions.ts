// A connection outside the license (roadmap#58): it stays visible and
// readable, counts in no quota, and every write to it is refused, by the
// orchestrator for its own calls, by pveFetch for the frontend's API writes
// and by executeSSH for its shell commands. The flag is the Connection row's
// license_excluded column, owned by the orchestrator through
// PUT /license/exclusions/{connectionId}; this module only reads it.

import { locales, type Locale } from "@/i18n/config"
import { safeLog } from "@/lib/log/sanitize"

const CACHE_TTL_MS = 30_000

type Entry = { excluded: boolean; expiry: number }

// The write guard asks on every write, so an answer is kept a short while.
// Per process: the proxy route that changes the flag clears its entry.
const cache = new Map<string, Entry>()

/**
 * Thrown by pveFetch for a write to an excluded connection, before any
 * request. Carries the status and code the routes answer with, and no
 * "PVE 403" prefix: this refusal is ProxCenter's, not a token permission.
 */
export class PveLicenseExcludedError extends Error {
  readonly statusCode = 403
  readonly code = "CONNECTION_LICENSE_EXCLUDED"
  readonly connectionId: string

  constructor(connectionId: string, message = "This cluster is outside the license: ProxCenter refuses any change on it.") {
    super(message)
    this.name = "PveLicenseExcludedError"
    this.connectionId = connectionId
  }
}

/**
 * The refusal in the language of the request: routes answer with the error's
 * message, which the UI shows as is. English outside a request (a background
 * job has no cookie) or for a locale the cookie does not name.
 */
export async function licenseExcludedError(connectionId: string): Promise<PveLicenseExcludedError> {
  try {
    const { cookies } = await import("next/headers")
    const locale = (await cookies()).get("NEXT_LOCALE")?.value

    if (locale && (locales as readonly string[]).includes(locale)) {
      const messages = (await import(`@/messages/${locale as Locale}.json`)).default
      const message = messages?.errors?.connectionLicenseExcluded

      if (typeof message === "string") return new PveLicenseExcludedError(connectionId, message)
    }
  } catch {
    // No request scope: the English default below.
  }

  return new PveLicenseExcludedError(connectionId)
}

export async function isConnectionLicenseExcluded(id: string): Promise<boolean> {
  if (!id) return false

  const now = Date.now()
  const hit = cache.get(id)
  if (hit && hit.expiry > now) return hit.excluded

  let excluded = false
  try {
    // Lazy, like the other database reads of the PVE client: keeps Prisma out
    // of the module graph of every library that only reads from PVE.
    const { prisma } = await import("@/lib/db/prisma")
    const row = await prisma.connection.findUnique({ where: { id }, select: { licenseExcluded: true } })
    excluded = !!row?.licenseExcluded
  } catch (e) {
    // Deliberately fail-open. A frontend write (pveFetch, executeSSH) never
    // goes through the orchestrator, so nothing else would refuse it: a
    // database hiccup simply leaves writes allowed for the TTL. That miss is
    // cached like an answer, so it is not retried on every write either.
    console.warn("[license] Could not read a connection's exclusion, writes stay allowed:", safeLog(id).replace(/[\r\n]/g, ""), safeLog((e as Error)?.message))
  }

  cache.set(id, { excluded, expiry: now + CACHE_TTL_MS })

  return excluded
}

export function invalidateLicenseExclusionCache(id?: string): void {
  if (id) cache.delete(id)
  else cache.clear()
}
