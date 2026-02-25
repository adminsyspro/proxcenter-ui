// src/app/api/v1/auth/oidc/route.ts
import { NextResponse } from "next/server"

import { getDb } from "@/lib/db/sqlite"
import { encryptSecret } from "@/lib/crypto/secret"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

// GET /api/v1/auth/oidc - Get OIDC config
export async function GET() {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)

    if (denied) return denied

    const db = getDb()

    const config = db
      .prepare(
        `SELECT id, enabled, provider_name, issuer_url, client_id, client_secret_enc,
                scopes, authorization_url, token_url, userinfo_url,
                claim_email, claim_name, claim_groups,
                auto_provision, default_role, group_role_mapping,
                created_at, updated_at
         FROM oidc_config WHERE id = 'default'`
      )
      .get() as any

    if (!config) {
      return NextResponse.json({
        data: {
          enabled: false,
          provider_name: 'SSO',
          issuer_url: '',
          client_id: '',
          scopes: 'openid profile email',
          authorization_url: '',
          token_url: '',
          userinfo_url: '',
          claim_email: 'email',
          claim_name: 'name',
          claim_groups: 'groups',
          auto_provision: true,
          default_role: 'viewer',
          group_role_mapping: '{}',
          hasClientSecret: false,
        },
      })
    }

    return NextResponse.json({
      data: {
        enabled: config.enabled === 1,
        provider_name: config.provider_name || 'SSO',
        issuer_url: config.issuer_url || '',
        client_id: config.client_id || '',
        scopes: config.scopes || 'openid profile email',
        authorization_url: config.authorization_url || '',
        token_url: config.token_url || '',
        userinfo_url: config.userinfo_url || '',
        claim_email: config.claim_email || 'email',
        claim_name: config.claim_name || 'name',
        claim_groups: config.claim_groups || 'groups',
        auto_provision: config.auto_provision === 1,
        default_role: config.default_role || 'viewer',
        group_role_mapping: config.group_role_mapping || '{}',
        hasClientSecret: !!config.client_secret_enc,
      },
    })
  } catch (error: any) {
    console.error("Error GET OIDC config:", error)

    return NextResponse.json({ error: error?.message || "Server error" }, { status: 500 })
  }
}

// PUT /api/v1/auth/oidc - Save OIDC config
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

    // Validation
    if (enabled) {
      if (!issuer_url) {
        return NextResponse.json({ error: "Issuer URL is required" }, { status: 400 })
      }

      if (!client_id) {
        return NextResponse.json({ error: "Client ID is required" }, { status: 400 })
      }
    }

    const db = getDb()
    const now = new Date().toISOString()

    // Check if config exists
    const existing = db.prepare("SELECT id FROM oidc_config WHERE id = 'default'").get()

    // Encrypt client secret if provided
    let clientSecretEnc: string | undefined = undefined

    if (client_secret) {
      clientSecretEnc = encryptSecret(client_secret)
    }

    if (existing) {
      // Update
      const updates: string[] = [
        "enabled = ?",
        "provider_name = ?",
        "issuer_url = ?",
        "client_id = ?",
        "scopes = ?",
        "authorization_url = ?",
        "token_url = ?",
        "userinfo_url = ?",
        "claim_email = ?",
        "claim_name = ?",
        "claim_groups = ?",
        "auto_provision = ?",
        "default_role = ?",
        "group_role_mapping = ?",
        "updated_at = ?",
      ]

      const values: any[] = [
        enabled ? 1 : 0,
        provider_name || 'SSO',
        issuer_url || '',
        client_id || '',
        scopes || 'openid profile email',
        authorization_url || null,
        token_url || null,
        userinfo_url || null,
        claim_email || 'email',
        claim_name || 'name',
        claim_groups || 'groups',
        auto_provision ? 1 : 0,
        default_role || 'viewer',
        typeof group_role_mapping === 'string' ? group_role_mapping : JSON.stringify(group_role_mapping || {}),
        now,
      ]

      if (clientSecretEnc !== undefined) {
        updates.push("client_secret_enc = ?")
        values.push(clientSecretEnc)
      }

      values.push("default")

      db.prepare(`UPDATE oidc_config SET ${updates.join(", ")} WHERE id = ?`).run(...values)
    } else {
      // Insert
      db.prepare(
        `INSERT INTO oidc_config (id, enabled, provider_name, issuer_url, client_id, client_secret_enc,
          scopes, authorization_url, token_url, userinfo_url,
          claim_email, claim_name, claim_groups,
          auto_provision, default_role, group_role_mapping,
          created_at, updated_at)
         VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        enabled ? 1 : 0,
        provider_name || 'SSO',
        issuer_url || '',
        client_id || '',
        clientSecretEnc || null,
        scopes || 'openid profile email',
        authorization_url || null,
        token_url || null,
        userinfo_url || null,
        claim_email || 'email',
        claim_name || 'name',
        claim_groups || 'groups',
        auto_provision ? 1 : 0,
        default_role || 'viewer',
        typeof group_role_mapping === 'string' ? group_role_mapping : JSON.stringify(group_role_mapping || {}),
        now,
        now
      )
    }

    // Audit
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
