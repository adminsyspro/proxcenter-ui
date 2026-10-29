'use client'

import { useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter, usePathname } from 'next/navigation'

// How long to wait before checking again when the session could not be
// confirmed either way (network error, proxy error page).
export const SESSION_RECHECK_MS = 15_000

// next-auth answers a dead session with 200 and an empty body, and the
// cookie is already cleared server-side by then. Anything else that is not
// a JSON body (a network error, a proxy's HTML error page, a non-200) says
// nothing about the session.
async function checkSession() {
  try {
    const res = await fetch('/api/auth/session', { cache: 'no-store', credentials: 'same-origin' })
    if (!res.ok) return 'unknown'
    const body = await res.json()
    return body && Object.keys(body).length > 0 ? 'alive' : 'signed-out'
  } catch {
    return 'unknown'
  }
}

// The auth-session-hardening branch clears the cookie server-side whenever a
// session dies (idle timeout, absolute-cap expiry, revocation, or a legacy
// cookie with no sid): the jwt callback throws, next-auth's session route
// catches it, calls sessionStore.clean(), and returns an empty body. Nothing
// on the client reacted to that — every guarded data call just started
// returning 401 and the open page quietly emptied itself instead of sending
// the user to /login. AuthProvider's refetchInterval is what makes
// useSession() notice within a minute; this guard is what acts on it.
//
// next-auth also reports "unauthenticated" when that poll merely FAILS: its
// client returns null on any fetch or JSON error, exactly as for a dead
// session. One network blip, or a reverse proxy answering with an HTML page,
// used to send a signed-in user to /login. So the guard asks the server
// itself before redirecting, and only a confirmed refusal sends the user to
// /login; otherwise it resyncs the provider or tries again later.
export default function SessionExpiryGuard({ children }) {
  const { status, update } = useSession()
  const router = useRouter()
  const pathname = usePathname()

  // update() changes identity on every provider render; reading it from a
  // ref keeps the check below from restarting each time it is called.
  const updateRef = useRef(update)
  useEffect(() => {
    updateRef.current = update
  }, [update])

  useEffect(() => {
    // Do nothing while the initial session fetch is in flight: redirecting
    // on "loading" would bounce every user on every page load.
    if (status !== 'unauthenticated') return

    let cancelled = false
    let timer

    const check = async () => {
      const verdict = await checkSession()
      if (cancelled) return
      if (verdict === 'signed-out') {
        // callbackUrl matches proxy.ts's own no-token redirect
        // (`loginUrl.searchParams.set("callbackUrl", pathname)`) so
        // re-authenticating returns the user where they were.
        // replace(), not push(): the dead page must not stay in history. No
        // signOut() — the cookie is already cleared server-side, so it would
        // only be a redundant round trip.
        router.replace(`/login?callbackUrl=${encodeURIComponent(pathname)}`)
        return
      }
      // Alive: refetch so the provider leaves "unauthenticated". The timer
      // still runs in case that refetch fails too; the status change clears it.
      if (verdict === 'alive') updateRef.current?.()
      timer = setTimeout(check, SESSION_RECHECK_MS)
    }

    check()

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [status, pathname, router])

  return children
}
