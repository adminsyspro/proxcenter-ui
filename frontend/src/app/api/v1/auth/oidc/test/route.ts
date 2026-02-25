// src/app/api/v1/auth/oidc/test/route.ts
import { NextResponse } from "next/server"

import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

/**
 * POST /api/v1/auth/oidc/test
 * Tests OIDC discovery by fetching the .well-known/openid-configuration endpoint
 */
export async function POST(req: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)

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
    const baseUrl = issuer_url.replace(/\/+$/, '')
    const discoveryUrl = `${baseUrl}/.well-known/openid-configuration`

    const res = await fetch(discoveryUrl, {
      signal: AbortSignal.timeout(10000),
      headers: { 'Accept': 'application/json' },
    })

    if (!res.ok) {
      return NextResponse.json({
        success: false,
        error: `Discovery endpoint returned HTTP ${res.status}`,
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
      })
    }

    // Audit
    const { audit } = await import("@/lib/audit")

    await audit({
      action: "test",
      category: "settings",
      resourceType: "oidc_config",
      resourceId: "default",
      resourceName: "Configuration OIDC/SSO",
      details: {
        issuer_url,
        discoveredIssuer: data.issuer,
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
    })
  } catch (error: any) {
    console.error("Error OIDC discovery test:", error)

    // Audit failure
    try {
      const { audit } = await import("@/lib/audit")

      await audit({
        action: "test",
        category: "settings",
        resourceType: "oidc_config",
        resourceId: "default",
        resourceName: "Configuration OIDC/SSO",
        details: { error: error?.message },
        status: "failure",
        errorMessage: error?.message,
      })
    } catch {
      // Audit failure is non-critical
    }

    return NextResponse.json({
      success: false,
      error: error?.message || "Error during OIDC discovery test",
    }, { status: 500 })
  }
}
