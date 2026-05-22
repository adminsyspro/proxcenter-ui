// src/app/api/v1/auth/oidc/route.ts
import { NextResponse } from "next/server"

import { normalizeGroupRoleMapping } from "@/lib/auth/groupMapping"
import { prisma } from "@/lib/db/prisma"
import { encryptSecret } from "@/lib/crypto/secret"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

// GET /api/v1/auth/oidc — fetch the singleton OIDC config
export async function GET() {
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
          // Frontend expects a string here (it does JSON.parse with a string|object guard).
          group_role_mapping: "{}",
          hasClientSecret: false,
        },
      })
    }

    const groupRoleMappingStr =
      config.groupRoleMapping == null
        ? "{}"
        : typeof config.groupRoleMapping === "string"
          ? (config.groupRoleMapping as string)
          : JSON.stringify(config.groupRoleMapping)

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
        group_role_mapping: groupRoleMappingStr,
        hasClientSecret: !!config.clientSecretEnc,
      },
    })
  } catch (error: any) {
    console.error("Error GET OIDC config:", error)
    return NextResponse.json({ error: error?.message || "Server error" }, { status: 500 })
  }
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

    const mappingObj = normalizeGroupRoleMapping(group_role_mapping)

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
      groupRoleMapping: mappingObj,
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
