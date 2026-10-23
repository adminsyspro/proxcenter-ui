// src/app/api/v1/auth/ldap/diagnose/route.ts
import { NextResponse } from "next/server"

import { PERMISSIONS } from "@/lib/rbac"
import { requireProviderAdmin } from "@/lib/tenant/providerGuard"
import { prisma } from "@/lib/db/prisma"
import { bindPasswordOrSaved } from "@/lib/auth/ldap"
import { normalizeGroupRoleEntries } from "@/lib/auth/groupMapping"
import { evaluateLdapLookup, type LdapLookupResult } from "@/lib/auth/ldapDiagnostic"

export const runtime = "nodejs"

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://localhost:8080"
const ORCHESTRATOR_API_KEY = process.env.ORCHESTRATOR_API_KEY || ""

/**
 * POST /api/v1/auth/ldap/diagnose
 *
 * Administrator-only user lookup diagnostic (roadmap#38). Finds a test
 * username exactly as sign-in does (service account, Base DN, user filter)
 * through the orchestrator, then applies the allowed-group restriction and
 * the role mapping of the form being edited, saved or not.
 *
 * Read-only by design: no password is taken or checked, no account is
 * created, no role is assigned, the configuration is not written. The only
 * row written is the audit entry of the diagnostic itself.
 */
export async function POST(req: Request) {
  try {
    // Companion of the platform-wide LDAP config, replays the saved bind
    // password and reads any account by email: provider tenant only.
    const denied = await requireProviderAdmin(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied

    const body = await req.json().catch(() => ({}))
    const username = typeof body.test_username === "string" ? body.test_username.trim() : ""

    if (!body.url) {
      return NextResponse.json({ success: false, error: "LDAP URL is required" }, { status: 400 })
    }
    if (!username) {
      return NextResponse.json({ success: false, error: "username_required" }, { status: 400 })
    }

    const bindPassword = await bindPasswordOrSaved(body.bind_dn, body.bind_password)

    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (ORCHESTRATOR_API_KEY) headers["X-API-Key"] = ORCHESTRATOR_API_KEY

    let res: Response
    try {
      res = await fetch(`${ORCHESTRATOR_URL}/api/v1/auth/ldap/lookup`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          username,
          config: {
            url: body.url,
            bind_dn: body.bind_dn || "",
            bind_password: bindPassword || "",
            base_dn: body.base_dn || "",
            user_filter: body.user_filter || "",
            email_attribute: body.email_attribute || "",
            name_attribute: body.name_attribute || "",
            tls_insecure: !!body.tls_insecure,
            ca_cert: body.ca_cert || "",
            group_attribute: body.group_attribute || "",
          },
        }),
        signal: AbortSignal.timeout(20000),
      })
    } catch (e: any) {
      return NextResponse.json({ success: false, error: "orchestrator_unreachable", detail: e?.message || String(e) }, { status: 502 })
    }

    // An orchestrator older than this diagnostic has no such route.
    if (res.status === 404) {
      return NextResponse.json({ success: false, error: "orchestrator_outdated" }, { status: 501 })
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      return NextResponse.json({ success: false, error: "orchestrator_error", detail: `HTTP ${res.status} ${text}`.trim() }, { status: 502 })
    }

    const lookup = (await res.json()) as LdapLookupResult

    const evaluation = evaluateLdapLookup(
      lookup,
      {
        requireGroup: !!body.require_group,
        allowedGroups: Array.isArray(body.allowed_groups)
          ? body.allowed_groups.map((g: unknown) => String(g).trim()).filter(Boolean)
          : [],
        groupRoleMapping: normalizeGroupRoleEntries(body.group_role_mapping),
        defaultRole: typeof body.default_role === "string" ? body.default_role : "",
      },
      username,
    )

    // Whether sign-in would create the account or update an existing one:
    // that is what decides between the default role and the current role
    // when no mapping row matches. A read, nothing more.
    let account: { exists: boolean; email: string; enabled?: boolean; ldapRoleId?: string | null } | null = null
    const email = evaluation.subject?.email?.toLowerCase()
    if (email) {
      const user = await prisma.user.findUnique({ where: { email }, select: { id: true, enabled: true } })
      if (user) {
        const ldapRow = await prisma.rbacUserRole.findFirst({
          where: { userId: user.id, id: { startsWith: "ldap_" } },
          select: { roleId: true },
        })
        account = { exists: true, email, enabled: user.enabled, ldapRoleId: ldapRow?.roleId ?? null }
      } else {
        account = { exists: false, email }
      }
    }

    const { audit } = await import("@/lib/audit")
    await audit({
      action: "test",
      category: "settings",
      resourceType: "ldap_config",
      resourceId: "default",
      resourceName: "LDAP configuration",
      details: {
        diagnostic: "user_lookup",
        test_username: username,
        status: lookup.status,
        blocker: evaluation.blocker,
      },
      status: "success",
    })

    return NextResponse.json({ success: true, data: { lookup, evaluation, account } })
  } catch (error: any) {
    console.error("LDAP diagnosis error:", error)
    return NextResponse.json({ success: false, error: error?.message || "LDAP diagnosis failed" }, { status: 500 })
  }
}
