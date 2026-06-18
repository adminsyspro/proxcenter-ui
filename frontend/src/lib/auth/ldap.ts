// src/lib/auth/ldap.ts
// LDAP authentication helpers. The actual LDAP bind happens in the Go
// orchestrator; this module owns the local config state (read/decrypt) and
// the role-resolution mapping.

import { prisma } from "@/lib/db/prisma"
import { decryptSecret } from "@/lib/crypto/secret"
import { syncProviderRoleAssignment, type ProviderSyncDb } from "./roleSync"

export interface LdapUser {
  dn: string
  email: string
  name: string
  avatar: string | null
  groups: string[]
}

export interface LdapConfig {
  enabled: boolean
  url: string
  bindDn: string | null
  bindPassword: string | null
  baseDn: string
  userFilter: string
  emailAttribute: string
  nameAttribute: string
  tlsInsecure: boolean
  groupAttribute: string
  groupRoleMapping: Record<string, string>
  defaultRole: string
  requireGroup: boolean
  allowedGroups: string[]
}

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://localhost:8080"
const ORCHESTRATOR_API_KEY = process.env.ORCHESTRATOR_API_KEY || ""

/**
 * Cheap "is LDAP turned on" probe used by the login UI / NextAuth provider
 * predicate. Reads only the boolean flag so the row's encrypted bind password
 * does not need to be touched on every page load.
 */
export async function isLdapEnabled(): Promise<boolean> {
  const row = await prisma.ldapConfig.findUnique({
    where: { id: "default" },
    select: { enabled: true },
  })
  return row?.enabled === true
}

/** Reads the full LDAP config + decrypts the bind password. */
export async function getLdapConfig(): Promise<LdapConfig | null> {
  const row = await prisma.ldapConfig.findUnique({ where: { id: "default" } })
  if (!row) return null

  let bindPassword: string | null = null
  if (row.bindPasswordEnc) {
    try {
      bindPassword = decryptSecret(row.bindPasswordEnc)
    } catch (e) {
      console.error("Erreur déchiffrement bind password LDAP:", e)
    }
  }

  // group_role_mapping is now a JSONB column, so Prisma returns the parsed
  // object directly. Coerce to Record<string,string> defensively in case a
  // legacy row somehow still holds an array or unrelated shape.
  const groupRoleMapping: Record<string, string> =
    row.groupRoleMapping && typeof row.groupRoleMapping === "object" && !Array.isArray(row.groupRoleMapping)
      ? (row.groupRoleMapping as Record<string, string>)
      : {}

  // allowed_groups is JSONB string[] — defensive cast for the same reason.
  const allowedGroups: string[] = Array.isArray(row.allowedGroups)
    ? (row.allowedGroups as string[])
    : []

  return {
    enabled: row.enabled,
    url: row.url,
    bindDn: row.bindDn,
    bindPassword,
    baseDn: row.baseDn,
    userFilter: row.userFilter,
    emailAttribute: row.emailAttribute,
    nameAttribute: row.nameAttribute,
    tlsInsecure: row.tlsInsecure,
    groupAttribute: row.groupAttribute || "memberOf",
    groupRoleMapping,
    defaultRole: row.defaultRole || "role_viewer",
    requireGroup: row.requireGroup,
    allowedGroups,
  }
}

/**
 * Authenticate against LDAP via the Go orchestrator. The orchestrator does
 * the actual bind + group lookup; we forward the locally-stored config so
 * credentials never leave the server. Returns null on auth failure, throws
 * on transport / orchestrator-down failures so the caller can surface a
 * "service unavailable" rather than mistaking it for invalid creds.
 */
export async function authenticateLdap(
  username: string,
  password: string,
): Promise<LdapUser | null> {
  if (!(await isLdapEnabled())) {
    return null
  }

  const config = await getLdapConfig()
  if (!config || !config.enabled) {
    return null
  }

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }
    if (ORCHESTRATOR_API_KEY) {
      headers["X-API-Key"] = ORCHESTRATOR_API_KEY
    }

    const res = await fetch(`${ORCHESTRATOR_URL}/api/v1/auth/ldap/authenticate`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        username,
        password,
        config: {
          url: config.url,
          bind_dn: config.bindDn,
          bind_password: config.bindPassword,
          base_dn: config.baseDn,
          user_filter: config.userFilter,
          email_attribute: config.emailAttribute,
          name_attribute: config.nameAttribute,
          tls_insecure: config.tlsInsecure,
          group_attribute: config.groupAttribute,
        },
      }),
      signal: AbortSignal.timeout(15000),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      console.error(`Orchestrator LDAP auth failed: ${res.status} ${text}`)
      return null
    }

    const data = await res.json()
    if (!data.success || !data.user) {
      return null
    }

    return {
      dn: data.user.dn,
      email: data.user.email,
      name: data.user.name,
      avatar: data.user.avatar || null,
      groups: data.user.groups || [],
    }
  } catch (error: any) {
    console.error("Erreur orchestrator LDAP auth:", error?.message || error)
    throw new Error("Erreur de communication avec l'orchestrator pour l'authentification LDAP")
  }
}

/**
 * Resolve a ProxCenter role from LDAP group membership. Tries an exact-DN
 * match first, then falls back to extracting the CN. First match wins.
 * Returns null when no group matches so the caller can preserve manually
 * assigned roles instead of forcing the defaultRole.
 */
export function resolveLdapRole(groups: string[], config: LdapConfig): string | null {
  if (!groups || groups.length === 0 || !config.groupRoleMapping || Object.keys(config.groupRoleMapping).length === 0) {
    return null
  }

  for (const rawGroup of groups) {
    const group = String(rawGroup).trim()
    if (!group) continue
    if (config.groupRoleMapping[group]) {
      return config.groupRoleMapping[group]
    }
    const cnMatch = group.match(/^CN=([^,]+)/i)
    if (cnMatch) {
      const cn = cnMatch[1].trim()
      if (cn && config.groupRoleMapping[cn]) {
        return config.groupRoleMapping[cn]
      }
    }
  }

  return null
}

/**
 * Sync a user's LDAP-derived RBAC assignment on login (issue #383).
 *
 * Thin wrapper over the provider-agnostic core: LDAP owns the `ldap_`-prefixed
 * row. resolveLdapRole returns null when no group matches, so an existing role
 * is preserved (LDAP never demotes on a missing group). See roleSync.ts.
 */
export async function syncLdapRoleAssignment(
  db: ProviderSyncDb,
  params: {
    userId: string
    resolvedRoleId: string | null
    defaultRoleId: string
    now: Date
    newId: () => string
  },
): Promise<void> {
  return syncProviderRoleAssignment(db, { ...params, idPrefix: "ldap_" })
}
