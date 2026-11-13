// POST /api/v1/tenant/identity/test — discovery check of the issuer a tenant
// admin typed (issue #1289, lot 2). The URL is checked BEFORE any request, the
// request goes through the strict dispatcher (every address checked when the
// socket opens) and never follows a redirect, which could lead inside. The
// provider's outbound proxy, when one applies, refuses the test as it would
// refuse the sign-in: the proxy would resolve the host out of reach of checks.
import { NextResponse } from "next/server"

import { withAudit } from "@/lib/audit/withAudit"
import { prisma } from "@/lib/db/prisma"
import { oidcFetchDispatcher } from "@/lib/auth/oidcProxy"
import { assertPublicHttpsUrl, OidcUrlRefused } from "@/lib/auth/oidcUrlGuard"
import { resolveTenantIdentity } from "@/lib/auth/tenantIdentityGate"

export const runtime = "nodejs"

const REQUIRED = ["authorization_endpoint", "token_endpoint", "issuer"] as const

async function handlePost(req: Request) {
  const { response, tenant } = await resolveTenantIdentity()
  if (response) return response
  if (!tenant) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  let issuer: URL
  try {
    issuer = await assertPublicHttpsUrl(String(body?.issuer_url || ""))
  } catch (e) {
    const message = e instanceof OidcUrlRefused ? e.message : "Invalid issuer URL"
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }

  let base = `${issuer.origin}${issuer.pathname}`
  while (base.endsWith("/")) base = base.slice(0, -1)
  const discoveryUrl = `${base}/.well-known/openid-configuration`

  const proxy = await prisma.oidcConfig.findUnique({ where: { id: tenant.id }, select: { proxyUrl: true, proxyBypass: true } })
  let dispatcher: ReturnType<typeof oidcFetchDispatcher>
  try {
    dispatcher = oidcFetchDispatcher(proxy, discoveryUrl, process.env, { strict: true })
  } catch (e) {
    if (e instanceof OidcUrlRefused) return NextResponse.json({ success: false, error: e.message })
    throw e
  }

  try {
    const res = await fetch(discoveryUrl, {
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      dispatcher,
    } as RequestInit)
    if (!res.ok) return NextResponse.json({ success: false, error: `Discovery endpoint returned HTTP ${res.status}` })

    const data = await res.json()
    const missing = REQUIRED.filter(key => !data?.[key])
    if (missing.length > 0) return NextResponse.json({ success: false, error: `Missing required fields: ${missing.join(", ")}` })

    return NextResponse.json({
      success: true,
      endpoints: {
        issuer: data.issuer,
        authorization_endpoint: data.authorization_endpoint,
        token_endpoint: data.token_endpoint,
        userinfo_endpoint: data.userinfo_endpoint || null,
      },
    })
  } catch {
    // No detail: the reason a request inside the provider's network failed is
    // exactly what this route must not tell.
    return NextResponse.json({ success: false, error: "The discovery document could not be read" })
  }
}

export const POST = withAudit({ category: "settings", resourceType: "oidc" }, handlePost)
