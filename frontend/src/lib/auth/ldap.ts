// src/lib/auth/ldap.ts
// LDAP authentication helpers. The actual LDAP bind happens in the Go
// orchestrator; this module owns the local config state (read/decrypt) and
// the role-resolution mapping.

import { prisma } from "@/lib/db/prisma"
import { decryptSecret } from "@/lib/crypto/secret"
import { syncProviderRoleAssignment, type ProviderSyncDb } from "./roleSync"
import { normalizeGroupRoleEntries, type GroupRoleEntry } from "./groupMapping"

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
  caCert: string | null
  groupAttribute: string
  /** Ordered mapping rows; the topmost match wins at login time. */
  groupRoleMapping: GroupRoleEntry[]
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

/**
 * The bind password a test or a diagnostic should use: the one typed in the
 * form, or else the saved one, so the admin can re-run it without re-entering
 * the secret (the form only ever receives a `hasBindPassword` hint).
 */
export async function bindPasswordOrSaved(
  bindDn: string | null | undefined,
  bindPassword: string | null | undefined,
): Promise<string | undefined> {
  if (bindPassword || !bindDn) return bindPassword || undefined
  try {
    const row = await prisma.ldapConfig.findUnique({
      where: { id: "default" },
      select: { bindPasswordEnc: true },
    })
    return row?.bindPasswordEnc ? decryptSecret(row.bindPasswordEnc) : undefined
  } catch {
    return undefined
  }
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
      console.error("LDAP bind password decryption error:", e)
    }
  }

  // group_role_mapping is a JSONB column holding the ordered entry list, or,
  // on a config written before v1.5, the legacy flat { group: role } object.
  // normalizeGroupRoleEntries absorbs both, so no data migration is required.
  const groupRoleMapping = normalizeGroupRoleEntries(row.groupRoleMapping)

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
    caCert: row.caCert || null,
    groupAttribute: row.groupAttribute || "memberOf",
    groupRoleMapping,
    defaultRole: row.defaultRole || "role_viewer",
    requireGroup: row.requireGroup,
    allowedGroups,
  }
}

/**
 * Why an LDAP sign-in failed, for the lockout policy: only `invalid_password`
 * (the user was found in the directory, the bind was refused) counts against
 * the account. `user_not_found` counts against the IP only, `error` (LDAP or
 * orchestrator unreachable, misconfiguration) not at all.
 */
export type LdapAuthOutcome =
  | { user: LdapUser; failure: null }
  | {
      user: null
      failure: "user_not_found" | "invalid_password" | "error"
      /**
       * The precise cause, for the server log and the audit trail only: the
       * person signing in keeps seeing the generic invalid-credentials message,
       * so a filter that excludes them reveals nothing about their account.
       * The orchestrator's `reason` code when it sends one (user_not_found,
       * ambiguous_match, invalid_filter, service_bind_failed, ...).
       */
      reason: string
      /** The orchestrator's error text, never a password. */
      detail?: string
    }

// The orchestrator answers this exact text both for an unknown user and for
// a refused bind. Newer orchestrators add `user_found` to tell them apart.
const LDAP_INVALID_CREDENTIALS = "Invalid credentials"

/** Same as authenticateLdap, with the reason of a failure. */
export async function authenticateLdapDetailed(
  username: string,
  password: string,
): Promise<LdapAuthOutcome> {
  if (!(await isLdapEnabled())) {
    return { user: null, failure: "error", reason: "disabled" }
  }

  const config = await getLdapConfig()
  if (!config || !config.enabled) {
    return { user: null, failure: "error", reason: "disabled" }
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
          // PEM of the CA that signed the LDAPS certificate. The orchestrator
          // adds it to the system pool; empty means system store only.
          ca_cert: config.caCert || "",
          group_attribute: config.groupAttribute,
        },
      }),
      signal: AbortSignal.timeout(15000),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      console.error(`Orchestrator LDAP auth failed: ${res.status} ${text}`)
      return { user: null, failure: "error", reason: "orchestrator_error", detail: `HTTP ${res.status}` }
    }

    const data = await res.json()
    if (!data.success || !data.user) {
      const detail = typeof data.error === "string" ? data.error : undefined
      const reported = typeof data.reason === "string" && data.reason ? data.reason : null
      if (data.error !== LDAP_INVALID_CREDENTIALS) {
        return { user: null, failure: "error", reason: reported ?? "directory_error", detail }
      }
      // An orchestrator without `user_found` cannot tell: count it as a
      // refused bind, the row cap bounds what unknown names can add.
      const failure = data.user_found === false ? "user_not_found" : "invalid_password"
      return { user: null, failure, reason: reported ?? failure, detail }
    }

    return {
      failure: null,
      user: {
        dn: data.user.dn,
        email: data.user.email,
        name: data.user.name,
        avatar: data.user.avatar || null,
        groups: data.user.groups || [],
      },
    }
  } catch (error: any) {
    console.error("Orchestrator LDAP auth error:", error?.message || error)
    throw new Error("Communication error with the orchestrator during LDAP authentication")
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
  return (await authenticateLdapDetailed(username, password)).user
}

/**
 * The mapping row that decides a user's role from their LDAP groups. The rows
 * are read from the top down and the first one the user belongs to wins, so
 * the order shown in the LDAP form is the order that decides (issue #992):
 * before that the outer loop was the directory's group list, which put the
 * winner beyond the admin's reach. Each row matches an exact DN, or the CN
 * extracted from the user's DN, so either spelling works on both sides.
 */
export function matchLdapRoleEntry(groups: string[], mapping: GroupRoleEntry[] | null | undefined): GroupRoleEntry | null {
  if (!groups || groups.length === 0 || !mapping || mapping.length === 0) {
    return null
  }

  // Both spellings of every group the user holds, so a row can be tested once.
  const claimed = new Set<string>()
  for (const rawGroup of groups) {
    const group = String(rawGroup).trim()
    if (!group) continue
    claimed.add(group)
    const cnMatch = group.match(/^CN=([^,]+)/i)
    const cn = cnMatch ? cnMatch[1].trim() : ""
    if (cn) claimed.add(cn)
  }

  for (const entry of mapping) {
    if (entry.role && claimed.has(entry.group)) return entry
  }

  return null
}

/**
 * Resolve a ProxCenter role from LDAP group membership (see matchLdapRoleEntry).
 *
 * Returns null when no group matches so the caller can preserve manually
 * assigned roles instead of forcing the defaultRole.
 */
export function resolveLdapRole(groups: string[], config: Pick<LdapConfig, "groupRoleMapping">): string | null {
  return matchLdapRoleEntry(groups, config.groupRoleMapping)?.role ?? null
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
