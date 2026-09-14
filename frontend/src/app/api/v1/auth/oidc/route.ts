// src/app/api/v1/auth/oidc/route.ts
import { NextResponse } from "next/server"

import { normalizeGroupGrantMapping, type GroupGrant } from "@/lib/auth/groupMapping"
import { prisma } from "@/lib/db/prisma"
import { encryptSecret } from "@/lib/crypto/secret"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

/**
 * Origin the server uses when it builds URLs for the IdP. Served to the form so
 * the URLs it tells the admin to register are the ones we actually send, even
 * when NEXTAUTH_URL differs from the host the browser is on.
 */
function appOrigin(req: Request): string {
  const configured = process.env.NEXTAUTH_URL
  if (configured) return configured.replace(/\/+$/, "")
  try {
    return new URL(req.url).origin
  } catch {
    return ""
  }
}

// GET /api/v1/auth/oidc — fetch the singleton OIDC config
export async function GET(req: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied

    const config = await prisma.oidcConfig.findUnique({ where: { id: "default" } })

    if (!config) {
      return NextResponse.json({
        data: {
          enabled: false,
          provider_name: "SSO",
          issuer_url: "",
          client_id: "",
          scopes: "openid profile email",
          authorization_url: "",
          token_url: "",
          userinfo_url: "",
          claim_email: "email",
          claim_name: "name",
          claim_groups: "groups",
          auto_provision: true,
          default_role: "viewer",
          show_local_login: true,
          force_sso_redirect: false,
          // Frontend expects a string here (it does JSON.parse with a string|object guard).
          group_role_mapping: "[]",
          hasClientSecret: false,
          tenants: await listMappingTenants(),
          vdcs: await listMappingVdcs(),
          app_origin: appOrigin(req),
        },
      })
    }

    // Always answer the entry-list shape, whatever the row holds: a config
    // written before v1.5 is still a flat { group: role } object and must reach
    // the form as entries so a save does not silently rewrite it.
    const groupRoleMappingStr = JSON.stringify(
      toWireEntries(normalizeGroupGrantMapping(config.groupRoleMapping)),
    )

    return NextResponse.json({
      data: {
        enabled: config.enabled,
        provider_name: config.providerName || "SSO",
        issuer_url: config.issuerUrl || "",
        client_id: config.clientId || "",
        scopes: config.scopes || "openid profile email",
        authorization_url: config.authorizationUrl || "",
        token_url: config.tokenUrl || "",
        userinfo_url: config.userinfoUrl || "",
        claim_email: config.claimEmail || "email",
        claim_name: config.claimName || "name",
        claim_groups: config.claimGroups || "groups",
        auto_provision: config.autoProvision,
        default_role: config.defaultRole || "viewer",
        show_local_login: config.showLocalLogin,
        force_sso_redirect: config.forceSsoRedirect,
        group_role_mapping: groupRoleMappingStr,
        hasClientSecret: !!config.clientSecretEnc,
        tenants: await listMappingTenants(),
        vdcs: await listMappingVdcs(),
        app_origin: appOrigin(req),
      },
    })
  } catch (error: any) {
    console.error("Error GET OIDC config:", error)
    return NextResponse.json({ error: error?.message || "Server error" }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// Tenant / vDC aware group mapping
// ---------------------------------------------------------------------------
//
// The picker lists are served from THIS route rather than fetched separately by
// the form: /api/v1/tenants gates on ADMIN_TENANTS while this tab only requires
// ADMIN_SETTINGS, so an admin allowed to configure SSO would otherwise get an
// empty tenant list and no way to tell why.

type WireEntry = { group: string; tenant: string; vdc: string; role: string }

/** Grant entries in the shape the config form posts and reads back. */
function toWireEntries(grants: readonly GroupGrant[]): WireEntry[] {
  return grants.map(g => ({
    group: g.group,
    tenant: g.tenantId,
    vdc: g.vdcId || "",
    role: g.role,
  }))
}

async function listMappingTenants() {
  const rows = await prisma.tenant.findMany({
    select: { id: true, name: true, slug: true },
    orderBy: { name: "asc" },
  })
  return rows
}

async function listMappingVdcs() {
  const rows = await prisma.vdc.findMany({
    select: { id: true, tenantId: true, name: true, slug: true },
    orderBy: { name: "asc" },
  })
  return rows
}

/**
 * Reject a mapping that points at something which does not exist: a typo in a
 * tenant id, or a vDC that was deleted or moved, would otherwise only surface
 * at someone's next login as a silently dropped grant.
 */
// Returns the error message, or null when every target resolves. A plain
// nullable string rather than a discriminated union: tsconfig runs with
// strict:false, which does not narrow `{ ok: true } | { ok: false, error }`.
async function validateGrantTargets(grants: readonly GroupGrant[]): Promise<string | null> {
  const tenantIds = [...new Set(grants.map(g => g.tenantId))]
  if (tenantIds.length > 0) {
    const known = await prisma.tenant.findMany({
      where: { id: { in: tenantIds } },
      select: { id: true },
    })
    const knownIds = new Set(known.map(t => t.id))
    const missing = tenantIds.find(id => !knownIds.has(id))
    if (missing) return `Unknown tenant in group mapping: ${missing}`
  }

  const vdcIds = [...new Set(grants.map(g => g.vdcId).filter((id): id is string => !!id))]
  if (vdcIds.length === 0) return null

  const vdcs = await prisma.vdc.findMany({
    where: { id: { in: vdcIds } },
    select: { id: true, tenantId: true },
  })
  const byId = new Map(vdcs.map(v => [v.id, v.tenantId]))
  for (const grant of grants) {
    if (!grant.vdcId) continue
    const ownerTenant = byId.get(grant.vdcId)
    if (!ownerTenant) {
      return `Unknown vDC in group mapping: ${grant.vdcId}`
    }
    if (ownerTenant !== grant.tenantId) {
      return `vDC ${grant.vdcId} belongs to tenant ${ownerTenant}, not ${grant.tenantId}`
    }
  }
  return null
}

// PUT /api/v1/auth/oidc — save the singleton OIDC config (insert or update)
export async function PUT(req: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied

    const body = await req.json()

    const {
      enabled,
      provider_name,
      issuer_url,
      client_id,
      client_secret,
      scopes,
      authorization_url,
      token_url,
      userinfo_url,
      claim_email,
      claim_name,
      claim_groups,
      auto_provision,
      default_role,
      show_local_login,
      force_sso_redirect,
      group_role_mapping,
    } = body

    if (enabled) {
      if (!issuer_url) {
        return NextResponse.json({ error: "Issuer URL is required" }, { status: 400 })
      }
      if (!client_id) {
        return NextResponse.json({ error: "Client ID is required" }, { status: 400 })
      }
    }

    // Anti-lockout: hiding the local form or auto-redirecting to the IdP only
    // makes sense when SSO works. When OIDC is off, coerce both back to safe
    // values so the local form can never be hidden without a working SSO (and
    // so disabling OIDC never gets rejected for carrying stale flags).
    const persistShowLocalLogin = enabled ? show_local_login !== false : true
    const persistForceSsoRedirect = enabled ? !!force_sso_redirect : false

    const grants = normalizeGroupGrantMapping(group_role_mapping)
    const targetError = await validateGrantTargets(grants)
    if (targetError) {
      return NextResponse.json({ error: targetError }, { status: 400 })
    }

    const now = new Date()
    const baseData = {
      enabled: !!enabled,
      providerName: provider_name || "SSO",
      issuerUrl: issuer_url || "",
      clientId: client_id || "",
      scopes: scopes || "openid profile email",
      authorizationUrl: authorization_url || null,
      tokenUrl: token_url || null,
      userinfoUrl: userinfo_url || null,
      claimEmail: claim_email || "email",
      claimName: claim_name || "name",
      claimGroups: claim_groups || "groups",
      autoProvision: !!auto_provision,
      defaultRole: default_role || "viewer",
      showLocalLogin: persistShowLocalLogin,
      forceSsoRedirect: persistForceSsoRedirect,
      groupRoleMapping: grants,
      updatedAt: now,
    }

    // Same pattern as LDAP: only overwrite the encrypted client secret when
    // a fresh value is submitted, so the form blank-by-default UX preserves
    // the existing secret on every save that doesn't rotate it.
    const update: Record<string, unknown> = { ...baseData }
    const create: Record<string, unknown> = {
      id: "default",
      ...baseData,
      createdAt: now,
      clientSecretEnc: null as string | null,
    }
    if (client_secret) {
      const enc = encryptSecret(client_secret)
      update.clientSecretEnc = enc
      create.clientSecretEnc = enc
    }

    await prisma.oidcConfig.upsert({
      where: { id: "default" },
      update,
      create: create as any,
    })

    const { audit } = await import("@/lib/audit")
    await audit({
      action: "update",
      category: "settings",
      resourceType: "oidc_config",
      resourceId: "default",
      resourceName: "Configuration OIDC/SSO",
      details: {
        enabled,
        issuer_url: issuer_url || null,
        client_id: client_id || null,
        clientSecretChanged: !!client_secret,
      },
      status: "success",
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("Error PUT OIDC config:", error)
    return NextResponse.json({ error: error?.message || "Server error" }, { status: 500 })
  }
}
