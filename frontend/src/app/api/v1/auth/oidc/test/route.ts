// src/app/api/v1/auth/oidc/test/route.ts
import { NextResponse } from "next/server"

import { getOidcConfig } from "@/lib/auth/oidc"
import { checkProxyUrl, describeOidcFetchError, oidcFetchDispatcher, proxyFor, type OidcProxySettings } from "@/lib/auth/oidcProxy"
import { PERMISSIONS } from "@/lib/rbac"
import { requireProviderAdmin } from "@/lib/tenant/providerGuard"

export const runtime = "nodejs"

/**
 * The proxy the form currently shows, saved or not, so the admin can test a
 * proxy before saving it. A blank password keeps the saved one, like the
 * password field itself.
 */
async function formProxy(body: any): Promise<{ settings: OidcProxySettings; error?: string }> {
  const rawUrl = typeof body?.proxy_url === "string" ? body.proxy_url.trim() : ""
  const settings: OidcProxySettings = {
    proxyUrl: null,
    proxyUsername: null,
    proxyPassword: null,
    proxyBypass: typeof body?.proxy_bypass === "string" ? body.proxy_bypass : null,
  }
  if (!rawUrl) return { settings }

  const checked = checkProxyUrl(rawUrl)
  if (checked.error) return { settings, error: checked.error }
  settings.proxyUrl = checked.url

  const username = typeof body?.proxy_username === "string" ? body.proxy_username.trim() : ""
  if (username) {
    settings.proxyUsername = username
    settings.proxyPassword = body?.proxy_password ? String(body.proxy_password) : null
    if (!settings.proxyPassword) {
      const saved = await getOidcConfig()
      if (saved?.proxyUsername === username) settings.proxyPassword = saved.proxyPassword
    }
  }
  return { settings }
}

/**
 * How the call went out, shown under the result: "direct" on a site with a
 * proxy usually means the bypass list caught the IdP.
 */
function routeInfo(route: ReturnType<typeof proxyFor>) {
  return route ? { via: "proxy", proxy: route.display, proxy_source: route.source } : { via: "direct" }
}

/**
 * POST /api/v1/auth/oidc/test
 * Tests OIDC discovery by fetching the .well-known/openid-configuration endpoint
 */
export async function POST(req: Request) {
  let discoveryUrl: string | null = null
  let route: ReturnType<typeof proxyFor> = null
  try {
    // Companion of the platform-wide OIDC config: provider tenant only.
    const denied = await requireProviderAdmin(PERMISSIONS.ADMIN_SETTINGS)

    if (denied) return denied

    const body = await req.json()
    const { issuer_url } = body

    if (!issuer_url) {
      return NextResponse.json({
        success: false,
        error: "Issuer URL is required",
      }, { status: 400 })
    }

    // Normalize: remove trailing slash
    let baseUrl = String(issuer_url)
    while (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1)

    // Validate URL protocol to prevent SSRF — reconstruct from parsed components to cut taint
    const parsedUrl = new URL(`${baseUrl}/.well-known/openid-configuration`)
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return NextResponse.json({
        success: false,
        error: "Only http and https protocols are allowed",
      }, { status: 400 })
    }
    discoveryUrl = `${parsedUrl.origin}${parsedUrl.pathname}`

    const proxy = await formProxy(body)
    if (proxy.error) {
      return NextResponse.json({ success: false, error: proxy.error }, { status: 400 })
    }
    route = proxyFor(proxy.settings, discoveryUrl)
    const dispatcher = oidcFetchDispatcher(proxy.settings, discoveryUrl)
    const via = routeInfo(route)

    const res = await fetch(discoveryUrl, {
      signal: AbortSignal.timeout(10000),
      headers: { 'Accept': 'application/json' },
      ...(dispatcher ? { dispatcher } : {}),
    } as RequestInit)

    if (!res.ok) {
      return NextResponse.json({
        success: false,
        error: `Discovery endpoint returned HTTP ${res.status}`,
        ...via,
      })
    }

    const data = await res.json()

    // Validate required endpoints
    const required = ['authorization_endpoint', 'token_endpoint', 'issuer']
    const missing = required.filter(key => !data[key])

    if (missing.length > 0) {
      return NextResponse.json({
        success: false,
        error: `Missing required fields: ${missing.join(', ')}`,
        endpoints: {
          issuer: data.issuer || null,
          authorization_endpoint: data.authorization_endpoint || null,
          token_endpoint: data.token_endpoint || null,
          userinfo_endpoint: data.userinfo_endpoint || null,
        },
        ...via,
      })
    }

    // Audit
    const { audit } = await import("@/lib/audit")

    await audit({
      action: "test",
      category: "settings",
      resourceType: "oidc_config",
      resourceId: "default",
      resourceName: "OIDC/SSO configuration",
      details: {
        issuer_url,
        discoveredIssuer: data.issuer,
        via: via.via,
        proxy: route?.display ?? null,
        success: true,
      },
      status: "success",
    })

    return NextResponse.json({
      success: true,
      message: `Discovery successful for ${data.issuer}`,
      endpoints: {
        issuer: data.issuer,
        authorization_endpoint: data.authorization_endpoint,
        token_endpoint: data.token_endpoint,
        userinfo_endpoint: data.userinfo_endpoint || null,
        jwks_uri: data.jwks_uri || null,
      },
      ...via,
    })
  } catch (error: any) {
    console.error("Error OIDC discovery test:", error)

    // undici only says "fetch failed": dig out the reason (DNS, proxy 407,
    // untrusted certificate, timeout) so the admin knows what to fix.
    const failure = discoveryUrl ? describeOidcFetchError(error, discoveryUrl, route) : null

    // Audit failure
    try {
      const { audit } = await import("@/lib/audit")

      await audit({
        action: "test",
        category: "settings",
        resourceType: "oidc_config",
        resourceId: "default",
        resourceName: "OIDC/SSO configuration",
        details: { error: failure?.message ?? error?.message, proxy: route?.display ?? null },
        status: "failure",
        errorMessage: failure?.message ?? error?.message,
      })
    } catch {
      // Audit failure is non-critical
    }

    return NextResponse.json({
      success: false,
      error: failure?.message || error?.message || "Error during OIDC discovery test",
      ...(failure ? { error_code: failure.code, error_host: failure.host, error_status: failure.status ?? null } : {}),
      ...(discoveryUrl ? routeInfo(route) : {}),
    }, { status: 500 })
  }
}
