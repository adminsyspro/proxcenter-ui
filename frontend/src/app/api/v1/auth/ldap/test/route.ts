// src/app/api/v1/auth/ldap/test/route.ts
import { NextResponse } from "next/server"

import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { bindPasswordOrSaved } from "@/lib/auth/ldap"

export const runtime = "nodejs"

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:8080'
const ORCHESTRATOR_API_KEY = process.env.ORCHESTRATOR_API_KEY || ''

/**
 * POST /api/v1/auth/ldap/test
 * Test la connexion LDAP avec les paramètres fournis
 *
 * Cette API délègue TOUJOURS le test à l'orchestrator Go.
 * Les credentials ne transitent jamais par le navigateur.
 */
export async function POST(req: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)

    if (denied) return denied

    const body = await req.json()

    let {
      url,
      bind_dn,
      bind_password,
      base_dn,
      user_filter,
      tls_insecure,
      ca_cert,
    } = body

    // Validation basique
    if (!url) {
      return NextResponse.json({
        success: false,
        error: "URL LDAP requise"
      }, { status: 400 })
    }

    // If bind_password is empty but a saved password exists in DB, use it
    // (the form only exposes a "hasBindPassword" hint via GET, never the
    // ciphertext, so the user can re-test without re-entering the secret).
    bind_password = await bindPasswordOrSaved(bind_dn, bind_password)

    // Toujours utiliser l'orchestrator pour le test LDAP
    const result = await testLdapViaOrchestrator({
      url,
      bind_dn,
      bind_password,
      base_dn,
      user_filter,
      tls_insecure,
      ca_cert,
    })

    // Audit
    const { audit } = await import("@/lib/audit")

    await audit({
      action: "test",
      category: "settings",
      resourceType: "ldap_config",
      resourceId: "default",
      resourceName: "Configuration LDAP",
      details: { 
        url,
        base_dn,
        success: result.success,
        via_orchestrator: true,
      },
      status: result.success ? "success" : "failure",
      errorMessage: result.success ? undefined : result.message,
    })

    // `checks` says what the test verified and what it did not (roadmap#38):
    // a green test never meant that a user can find their way in.
    if (result.success) {
      return NextResponse.json({
        success: true,
        message: result.message,
        checks: result.checks,
      })
    } else {
      return NextResponse.json({
        success: false,
        error: result.message,
        checks: result.checks,
      })
    }
  } catch (error: any) {
    console.error("Erreur test LDAP:", error)
    
    return NextResponse.json({ 
      success: false,
      error: error?.message || "Erreur lors du test LDAP" 
    }, { status: 500 })
  }
}

/** One line of the connection test verdict, as the orchestrator reports it. */
interface LdapTestCheck {
  id: string
  status: "passed" | "failed" | "warning" | "skipped" | "not_checked"
  detail?: string
}

/**
 * Teste la connexion LDAP via l'orchestrator Go
 */
async function testLdapViaOrchestrator(config: {
  url: string
  bind_dn?: string
  bind_password?: string
  base_dn?: string
  user_filter?: string
  tls_insecure?: boolean
  ca_cert?: string
}): Promise<{ success: boolean; message: string; checks?: LdapTestCheck[] }> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (ORCHESTRATOR_API_KEY) {
      headers['X-API-Key'] = ORCHESTRATOR_API_KEY
    }

    const res = await fetch(`${ORCHESTRATOR_URL}/api/v1/auth/ldap/test`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        url: config.url,
        bind_dn: config.bind_dn,
        bind_password: config.bind_password,
        base_dn: config.base_dn,
        user_filter: config.user_filter,
        tls_insecure: config.tls_insecure,
        ca_cert: config.ca_cert || "",
      }),
      signal: AbortSignal.timeout(15000),
    })

    const data = await res.json()

    return {
      success: data.success || false,
      message: data.message || data.error || 'Unknown error',
      // Absent on an orchestrator older than roadmap#38: the UI then shows the message alone.
      checks: Array.isArray(data.checks) ? data.checks : undefined,
    }
  } catch (error: any) {
    return {
      success: false,
      message: `Erreur de communication avec l'orchestrator: ${error?.message || error}`,
    }
  }
}
