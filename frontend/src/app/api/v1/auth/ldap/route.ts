// src/app/api/v1/auth/ldap/route.ts
import { NextResponse } from "next/server"

import { normalizeGroupRoleMapping } from "@/lib/auth/groupMapping"
import { prisma } from "@/lib/db/prisma"
import { encryptSecret } from "@/lib/crypto/secret"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

// GET /api/v1/auth/ldap — fetch the singleton LDAP config
export async function GET() {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied

    const config = await prisma.ldapConfig.findUnique({ where: { id: "default" } })

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
          ca_cert: "",
          group_attribute: "memberOf",
          // Frontend expects a string here (it does JSON.parse with a string|object guard).
          // Returning the canonical empty-object string keeps the response shape stable.
          group_role_mapping: "{}",
          default_role: "role_viewer",
          require_group: false,
          allowed_groups: [],
        },
      })
    }

    // group_role_mapping is JSONB on Postgres → an object at the JS level.
    // Frontend handles both, but stringify here so the wire shape stays
    // identical to the legacy SQLite response.
    const groupRoleMappingStr =
      config.groupRoleMapping == null
        ? "{}"
        : typeof config.groupRoleMapping === "string"
          ? (config.groupRoleMapping as string)
          : JSON.stringify(config.groupRoleMapping)

    const allowedGroupsArr: string[] = Array.isArray(config.allowedGroups)
      ? (config.allowedGroups as string[])
      : []

    return NextResponse.json({
      data: {
        enabled: config.enabled,
        url: config.url,
        bind_dn: config.bindDn || "",
        base_dn: config.baseDn,
        user_filter: config.userFilter,
        email_attribute: config.emailAttribute,
        name_attribute: config.nameAttribute,
        tls_insecure: config.tlsInsecure,
        // A CA certificate is public material, so unlike the bind password it
        // goes back to the form as-is and can be re-submitted on a test.
        ca_cert: config.caCert || "",
        hasBindPassword: !!config.bindPasswordEnc,
        group_attribute: config.groupAttribute || "memberOf",
        group_role_mapping: groupRoleMappingStr,
        default_role: config.defaultRole || "role_viewer",
        require_group: config.requireGroup,
        allowed_groups: allowedGroupsArr,
      },
    })
  } catch (error: any) {
    console.error("Erreur GET LDAP config:", error)
    return NextResponse.json({ error: error?.message || "Erreur serveur" }, { status: 500 })
  }
}

// PUT /api/v1/auth/ldap — save the singleton LDAP config (insert or update)
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
      ca_cert,
      group_attribute,
      group_role_mapping,
      default_role,
      require_group,
      allowed_groups,
    } = body

    if (enabled) {
      if (!url) {
        return NextResponse.json({ error: "URL LDAP requise" }, { status: 400 })
      }
      if (!base_dn) {
        return NextResponse.json({ error: "Base DN requise" }, { status: 400 })
      }
    }

    // Reject anything that is not a PEM certificate bundle before it reaches
    // the orchestrator, where a bad paste would only show up as a failed bind.
    const caCert = typeof ca_cert === "string" ? ca_cert.trim() : ""
    if (caCert && !/-----BEGIN CERTIFICATE-----/.test(caCert)) {
      return NextResponse.json(
        { error: "Le certificat CA doit être au format PEM (-----BEGIN CERTIFICATE-----)" },
        { status: 400 },
      )
    }

    const mappingObj = normalizeGroupRoleMapping(group_role_mapping)

    const allowedGroupsArr: string[] = Array.isArray(allowed_groups)
      ? allowed_groups.map((g: unknown) => String(g).trim()).filter(Boolean)
      : []

    const now = new Date()
    const baseData = {
      enabled: !!enabled,
      url: url || "",
      bindDn: bind_dn || null,
      baseDn: base_dn || "",
      userFilter: user_filter || "(uid={{username}})",
      emailAttribute: email_attribute || "mail",
      nameAttribute: name_attribute || "cn",
      tlsInsecure: !!tls_insecure,
      caCert: caCert || null,
      groupAttribute: group_attribute || "memberOf",
      groupRoleMapping: mappingObj,
      defaultRole: default_role || "role_viewer",
      requireGroup: !!require_group,
      allowedGroups: allowedGroupsArr,
      updatedAt: now,
    }

    // Encrypt the bind password only when the form submitted a non-empty
    // value: leaving the field blank preserves the previously-saved secret
    // (the GET response only exposes a `hasBindPassword` boolean).
    const update: Record<string, unknown> = { ...baseData }
    const create: Record<string, unknown> = {
      id: "default",
      ...baseData,
      createdAt: now,
      bindPasswordEnc: null as string | null,
    }
    if (bind_password) {
      const enc = encryptSecret(bind_password)
      update.bindPasswordEnc = enc
      create.bindPasswordEnc = enc
    }

    await prisma.ldapConfig.upsert({
      where: { id: "default" },
      update,
      create: create as any,
    })

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
        caCert: !!caCert,
      },
      status: "success",
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("Erreur PUT LDAP config:", error)
    return NextResponse.json({ error: error?.message || "Erreur serveur" }, { status: 500 })
  }
}
