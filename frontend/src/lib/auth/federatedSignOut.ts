// src/lib/auth/federatedSignOut.ts
//
// Sign the user out of ProxCenter AND of the identity provider.
//
// signOut() alone drops our cookie while the IdP keeps its own session, so the
// next "Continue with <provider>" click silently signs the same person back in
// with no password prompt. Every sign-out button goes through here so the two
// paths can never drift apart again.

import { signOut } from "next-auth/react"

/**
 * The end-session URL has to be fetched BEFORE the local sign-out: the route
 * reads the id_token out of the session cookie, which signOut() is about to
 * clear.
 */
async function fetchEndSessionUrl(): Promise<string | null> {
  try {
    const res = await fetch("/api/v1/auth/oidc/logout-url")
    if (!res.ok) return null
    const data = await res.json()
    return typeof data?.url === "string" ? data.url : null
  } catch {
    // Offline, proxy error, anything: fall back to the local sign-out rather
    // than leaving the user stuck on a page they asked to leave.
    return null
  }
}

export async function federatedSignOut(callbackUrl = "/login"): Promise<void> {
  const endSessionUrl = await fetchEndSessionUrl()

  if (!endSessionUrl) {
    await signOut({ callbackUrl })
    return
  }

  // redirect:false so NextAuth clears the cookie without navigating; the IdP
  // then sends the browser back to callbackUrl itself.
  await signOut({ redirect: false })
  window.location.href = endSessionUrl
}
