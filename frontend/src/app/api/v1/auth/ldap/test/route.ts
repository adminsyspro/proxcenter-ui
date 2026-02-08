// src/app/api/v1/auth/ldap/test/route.ts
import { NextResponse } from "next/server"

import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth/config"

export const runtime = "nodejs"

import { getOrchestratorApiKey } from '@/lib/orchestrator/api-key'
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:8080'

/**
 * POST /api/v1/auth/ldap/test
 * Test la connexion LDAP avec les paramètres fournis
 * 
 * Cette API délègue TOUJOURS le test à l'orchestrator Go.
 * Les credentials ne transitent jamais par le navigateur.
 */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user.role !== "admin") {
      return NextResponse.json({ error: "Non autorisé" }, { status: 403 })
    }

    const body = await req.json()

    const {
      url,
      bind_dn,
      bind_password,
      base_dn,
      user_filter,
      tls_insecure,
    } = body

    // Validation basique
    if (!url) {
      return NextResponse.json({ 
        success: false, 
        error: "URL LDAP requise" 
      }, { status: 400 })
    }

    // Toujours utiliser l'orchestrator pour le test LDAP
    const result = await testLdapViaOrchestrator({
      url,
      bind_dn,
      bind_password,
      base_dn,
      user_filter,
      tls_insecure,
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

    if (result.success) {
      return NextResponse.json({ 
        success: true, 
        message: result.message 
      })
    } else {
      return NextResponse.json({ 
        success: false, 
        error: result.message 
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
}): Promise<{ success: boolean; message: string }> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    const apiKey = getOrchestratorApiKey()
    if (apiKey) {
      headers['X-API-Key'] = apiKey
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
      }),
      signal: AbortSignal.timeout(15000),
    })

    const data = await res.json()

    return {
      success: data.success || false,
      message: data.message || data.error || 'Unknown error',
    }
  } catch (error: any) {
    return {
      success: false,
      message: `Erreur de communication avec l'orchestrator: ${error?.message || error}`,
    }
  }
}
