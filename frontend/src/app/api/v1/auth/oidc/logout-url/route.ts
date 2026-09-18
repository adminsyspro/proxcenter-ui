// GET /api/v1/auth/oidc/logout-url
//
// Hands the caller the IdP end-session URL to jump to after the local
// sign-out, or null when there is nothing to do (session is not an SSO one,
// OIDC is off, or the provider advertises no end_session_endpoint).
//
// Any signed-in user may call it: it reveals nothing beyond the IdP their own
// session was opened against, and it is on the path of an action they are
// always allowed to take. Refusing here would leave them signed in at the IdP.
import { NextRequest, NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"

import { getOidcConfig } from "@/lib/auth/oidc"
import { buildEndSessionUrl, discoverEndSessionEndpoint } from "@/lib/auth/oidcLogout"
import { sessionIdToken } from "@/lib/auth/sessions"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// A function, not a module-level constant: a Response body can only be read
// once, so a shared instance would come back already consumed on the second
// request that has nothing to log out of.
const noLogout = () => NextResponse.json({ url: null })

export async function GET(req: NextRequest) {
  try {
    const token = await getToken({
      req,
      secret: process.env.NEXTAUTH_SECRET || "build-time-placeholder",
    })
    if (!token || token.authProvider !== "oidc") return noLogout()

    const config = await getOidcConfig()
    if (!config || !config.enabled) return noLogout()

    const endSessionEndpoint = await discoverEndSessionEndpoint(config.issuerUrl)
    if (!endSessionEndpoint) return noLogout()

    // Back to our own login page. Built from the request so a deployment behind
    // a proxy lands on the host the user actually browsed, and NEXTAUTH_URL
    // wins when it is set (it is the value registered at the IdP).
    const base = process.env.NEXTAUTH_URL || new URL(req.url).origin
    const postLogoutRedirectUri = new URL("/login", base).toString()

    // The hint lives on the session row. `token.idToken` is the cookie-borne
    // form this release moves away from: sessions opened before the upgrade
    // still carry it, and would otherwise lose their IdP sign-out until they
    // expire. Drop that fallback once no such cookie can be alive.
    const idToken =
      (token.sid ? await sessionIdToken(token.sid) : null) ??
      (typeof token.idToken === "string" ? token.idToken : null)

    return NextResponse.json({
      url: buildEndSessionUrl({
        endSessionEndpoint,
        idToken,
        clientId: config.clientId,
        postLogoutRedirectUri,
      }),
    })
  } catch (e: any) {
    // A failure here must never trap the user in a session they asked to leave:
    // the caller falls back to the plain local sign-out.
    console.error("[oidcLogout] could not build the end-session URL:", e?.message || e)
    return NextResponse.json({ url: null })
  }
}
