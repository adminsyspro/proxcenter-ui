// src/app/api/v1/auth/ldap/route.ts
import { NextResponse } from "next/server"

import { getDb } from "@/lib/db/sqlite"
import { encryptSecret } from "@/lib/crypto/secret"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

// GET /api/v1/auth/ldap - Récupérer la config LDAP
export async function GET() {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)

    if (denied) return denied

    const db = getDb()

    const config = db
      .prepare(
        `SELECT id, enabled, url, bind_dn, bind_password_enc, base_dn, user_filter, email_attribute, name_attribute, tls_insecure, created_at, updated_at
         FROM ldap_config WHERE id = 'default'`
      )
      .get() as any

    if (!config) {
      return NextResponse.json({
        data: {
          enabled: false,
          url: "",
          bind_dn: "",
          base_dn: "",
          user_filter: "(uid={{username}})",
          email_attribute: "mail",
          name_attribute: "cn",
          tls_insecure: false,
        },
      })
    }

    return NextResponse.json({
      data: {
        enabled: config.enabled === 1,
        url: config.url,
        bind_dn: config.bind_dn || "",
        base_dn: config.base_dn,
        user_filter: config.user_filter,
        email_attribute: config.email_attribute,
        name_attribute: config.name_attribute,
        tls_insecure: config.tls_insecure === 1,
        hasBindPassword: !!config.bind_password_enc,
      },
    })
  } catch (error: any) {
    console.error("Erreur GET LDAP config:", error)
    
return NextResponse.json({ error: error?.message || "Erreur serveur" }, { status: 500 })
  }
}

// PUT /api/v1/auth/ldap - Sauvegarder la config LDAP
export async function PUT(req: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)

    if (denied) return denied

    const body = await req.json()

    const {
      enabled,
      url,
      bind_dn,
      bind_password,
      base_dn,
      user_filter,
      email_attribute,
      name_attribute,
      tls_insecure,
    } = body

    // Validation
    if (enabled) {
      if (!url) {
        return NextResponse.json({ error: "URL LDAP requise" }, { status: 400 })
      }

      if (!base_dn) {
        return NextResponse.json({ error: "Base DN requise" }, { status: 400 })
      }
    }

    const db = getDb()
    const now = new Date().toISOString()

    // Vérifier si une config existe
    const existing = db.prepare("SELECT id FROM ldap_config WHERE id = 'default'").get()

    // Chiffrer le mot de passe si fourni
    let bindPasswordEnc = undefined

    if (bind_password) {
      bindPasswordEnc = encryptSecret(bind_password)
    }

    if (existing) {
      // Mise à jour
      const updates: string[] = [
        "enabled = ?",
        "url = ?",
        "bind_dn = ?",
        "base_dn = ?",
        "user_filter = ?",
        "email_attribute = ?",
        "name_attribute = ?",
        "tls_insecure = ?",
        "updated_at = ?",
      ]

      const values: any[] = [
        enabled ? 1 : 0,
        url || "",
        bind_dn || null,
        base_dn || "",
        user_filter || "(uid={{username}})",
        email_attribute || "mail",
        name_attribute || "cn",
        tls_insecure ? 1 : 0,
        now,
      ]

      if (bindPasswordEnc !== undefined) {
        updates.push("bind_password_enc = ?")
        values.push(bindPasswordEnc)
      }

      values.push("default")

      db.prepare(`UPDATE ldap_config SET ${updates.join(", ")} WHERE id = ?`).run(...values)
    } else {
      // Création
      db.prepare(
        `INSERT INTO ldap_config (id, enabled, url, bind_dn, bind_password_enc, base_dn, user_filter, email_attribute, name_attribute, tls_insecure, created_at, updated_at)
         VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        enabled ? 1 : 0,
        url || "",
        bind_dn || null,
        bindPasswordEnc || null,
        base_dn || "",
        user_filter || "(uid={{username}})",
        email_attribute || "mail",
        name_attribute || "cn",
        tls_insecure ? 1 : 0,
        now,
        now
      )
    }

    // Audit
    const { audit } = await import("@/lib/audit")

    await audit({
      action: "update",
      category: "settings",
      resourceType: "ldap_config",
      resourceId: "default",
      resourceName: "Configuration LDAP",
      details: { 
        enabled, 
        url: url || null,
        base_dn: base_dn || null,
        bindPasswordChanged: !!bind_password,
      },
      status: "success",
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("Erreur PUT LDAP config:", error)
    
return NextResponse.json({ error: error?.message || "Erreur serveur" }, { status: 500 })
  }
}
