import useSWR, { type SWRConfiguration } from 'swr'
import { dequal } from 'dequal'

// A dead session makes every hook on the page 401 within the same tick. A
// 401 is proof the session is already gone server-side — the jwt callback
// refused and the cookie was cleared before this response was even sent — so
// there is nothing left to re-check; redirect straight away.
//
// next-auth's own getSession() cannot do this job from here: it fetches
// /api/auth/session and then only notifies OTHER tabs, via a
// localStorage-backed channel (node_modules/next-auth/client/_utils.js:
// `post` does localStorage.setItem, `receive` listens for the DOM "storage"
// event). Per the storage-event spec, that event fires in every other
// same-origin document and NEVER in the one that wrote the value — so
// calling getSession() from this tab's own fetcher updates every other open
// tab's SessionProvider but never this one, leaving this tab waiting on
// AuthProvider's 60s refetchInterval. Hence the hard navigation below
// instead.
const REDIRECT_WINDOW_MS = 2000
let lastRedirectAt = 0

// Exported: also called deliberately by the flows that knowingly kill the
// caller's own session (admin sessions-tab revoke of the current row, admin
// revoke-all targeting yourself, self password change). Those must not wait
// for some poller's 401 echo — they know at click time the session is dead.
export function redirectToLoginOnce() {
  // This module can be evaluated server-side (SSR); nothing to do there.
  if (typeof window === 'undefined') return

  // Already on the login page: don't re-navigate into a redirect loop.
  if (window.location.pathname.startsWith('/login')) return

  // A dead session makes ~10 hooks 401 at once; only one navigation is
  // needed. Same throttle shape as before, just guarding a navigation now
  // instead of a getSession() call.
  const now = Date.now()
  if (now - lastRedirectAt < REDIRECT_WINDOW_MS) return
  lastRedirectAt = now

  // Hard navigation (not next/navigation's router — this is a plain module,
  // not a component). replace(), not assign(), so the dead page doesn't
  // stay in history — consistent with SessionExpiryGuard's router.replace().
  // callbackUrl mirrors SessionExpiryGuard's and proxy.ts's own
  // no-token redirect so re-authenticating returns the user where they were.
  const callbackUrl = encodeURIComponent(window.location.pathname)
  window.location.replace(`/login?callbackUrl=${callbackUrl}`)
}

// Exported for testing: this is the file's chokepoint for every SWR-backed
// data call, so its 401 handling is covered directly (useSWRFetch.test.ts)
// rather than only indirectly through a hook that calls it.
export const fetcher = (url: string) => fetch(url, { cache: 'no-store' }).then(async res => {
  if (!res.ok) {
    // 401 = not authenticated (session is dead) → redirect now. 403 =
    // authenticated but forbidden for this resource, a normal outcome for a
    // user lacking a right — must NOT trigger a sign-out.
    if (res.status === 401) redirectToLoginOnce()
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
