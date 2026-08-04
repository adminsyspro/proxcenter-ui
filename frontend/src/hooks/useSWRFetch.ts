import useSWR, { type SWRConfiguration } from 'swr'
import { dequal } from 'dequal'
import { getSession } from 'next-auth/react'

// A dead session makes every hook on the page 401 within the same tick.
// next-auth throttles its own re-checks via __NEXTAUTH._lastSync, but that is
// an internal detail of next-auth, not something to depend on here — this is
// a second, local throttle so a burst of 401s triggers at most one
// getSession() call within RECHECK_WINDOW_MS.
const RECHECK_WINDOW_MS = 2000
let lastRecheckAt = 0

function recheckSessionOnce() {
  const now = Date.now()
  if (now - lastRecheckAt < RECHECK_WINDOW_MS) return
  lastRecheckAt = now
  // getSession() calls next-auth's own fetchData("session", ...), which hits
  // /api/auth/session directly with the platform fetch — it never goes
  // through this file's fetcher, so this cannot recurse. It updates
  // next-auth's internal session state, which flips useSession() to
  // "unauthenticated" so SessionExpiryGuard redirects, instead of waiting up
  // to 60s for AuthProvider's refetchInterval to tick.
  // Fire-and-forget: never awaited here, so it cannot delay or change the
  // error this fetcher throws below.
  void getSession().catch(() => {})
}

// Exported for testing: this is the file's chokepoint for every SWR-backed
// data call, so its 401 handling is covered directly (useSWRFetch.test.ts)
// rather than only indirectly through a hook that calls it.
export const fetcher = (url: string) => fetch(url, { cache: 'no-store' }).then(async res => {
  if (!res.ok) {
    // 401 = not authenticated (session is dead) → worth an immediate recheck.
    // 403 = authenticated but forbidden for this resource, a normal outcome
    // for a user lacking a right — must NOT trigger a sign-out.
    if (res.status === 401) recheckSessionOnce()
    throw new Error(`API error: ${res.status}`)
  }
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Invalid JSON response from ${url}`)
  }
})

export function useSWRFetch<T = any>(url: string | null, options?: SWRConfiguration) {
  return useSWR<T>(url, fetcher, { compare: dequal, ...options })
}
