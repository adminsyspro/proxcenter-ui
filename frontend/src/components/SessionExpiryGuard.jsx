'use client'

import { useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter, usePathname } from 'next/navigation'

// The auth-session-hardening branch clears the cookie server-side whenever a
// session dies (idle timeout, absolute-cap expiry, revocation, or a legacy
// cookie with no sid): the jwt callback throws, next-auth's session route
// catches it, calls sessionStore.clean(), and returns an empty body. Nothing
// on the client reacted to that — every guarded data call just started
// returning 401 and the open page quietly emptied itself instead of sending
// the user to /login. AuthProvider's refetchInterval is what makes
// useSession() notice within a minute; this guard is what acts on it.
export default function SessionExpiryGuard({ children }) {
  const { status } = useSession()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    // Do nothing while the initial session fetch is in flight: redirecting
    // on "loading" would bounce every user on every page load.
    if (status !== 'unauthenticated') return

    // callbackUrl matches proxy.ts's own no-token redirect
    // (`loginUrl.searchParams.set("callbackUrl", pathname)`) so
    // re-authenticating returns the user where they were.
    const loginUrl = `/login?callbackUrl=${encodeURIComponent(pathname)}`

    // replace(), not push(): the dead page must not stay in history. No
    // signOut() — the cookie is already cleared server-side by the time
    // status is "unauthenticated", so it would only be a redundant round trip.
    router.replace(loginUrl)
  }, [status, pathname, router])

  return children
}
