// src/lib/auth/insecureLogin.ts
//
// An install whose NEXTAUTH_URL is https marks its session and CSRF cookies
// Secure. A login page opened over plain HTTP from anything but localhost
// cannot store them, yet NextAuth's signIn() still reports success, so the
// page would bounce back to /login without a word. After a sign-in the server
// accepted, this checks whether a session actually exists and, on an insecure
// page, returns the HTTPS address the user should open instead.

interface PageLocation {
  hostname: string
  pathname: string
  search: string
}

/** Same page on https://, default port, since that is what the installers publish. */
export function httpsAddress(location: PageLocation): string {
  return `https://${location.hostname}${location.pathname}${location.search}`
}

/**
 * Returns the HTTPS address to show when the session cookie was dropped on an
 * insecure page, or null when there is nothing to explain (secure page, or a
 * session that does exist).
 */
export async function droppedSessionHttpsAddress(
  secureContext: boolean,
  location: PageLocation,
  readSession: () => Promise<unknown>
): Promise<string | null> {
  if (secureContext) return null

  let session: unknown = null

  try {
    session = await readSession()
  } catch {
    session = null
  }

  return session ? null : httpsAddress(location)
}
