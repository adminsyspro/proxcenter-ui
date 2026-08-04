'use client'

import { SessionProvider } from 'next-auth/react'

export default function AuthProvider({ children, session }) {
  return (
    // refetchInterval polls /api/auth/session, which runs the auth-session-
    // hardening `jwt` callback (a DB read) on every tick — so a user sitting
    // on a page eventually notices a dead session instead of the UI just
    // emptying itself as calls 401. 60s keeps that at one query per tab per
    // minute; do not shorten it, that multiplies DB load per open tab.
    // refetchOnWindowFocus stays at its default (true): returning to a tab
    // still revalidates immediately.
    <SessionProvider session={session} refetchInterval={60}>
      {children}
    </SessionProvider>
  )
}
