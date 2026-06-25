// src/lib/auth/oidc.ts
// OIDC / SSO config helpers. NextAuth's OIDC provider is built on the values
// returned here at request time, so the singleton row in `oidc_config` is
// the canonical source of truth (encrypted client secret + claim mappings).

import { prisma } from "@/lib/db/prisma"
import { decryptSecret } from "@/lib/crypto/secret"
import { syncProviderRoleAssignment, type ProviderSyncDb } from "./roleSync"

export interface OidcConfig {
  enabled: boolean
  providerName: string
  issuerUrl: string
  clientId: string
  clientSecret: string | null
  scopes: string
  authorizationUrl: string | null
  tokenUrl: string | null
  userinfoUrl: string | null
  claimEmail: string
  claimName: string
  claimGroups: string | null
  autoProvision: boolean
  defaultRole: string
  groupRoleMapping: Record<string, string>
  showLocalLogin: boolean
  forceSsoRedirect: boolean
}

/** Cheap "is OIDC turned on" probe — see isLdapEnabled for the rationale. */
export async function isOidcEnabled(): Promise<boolean> {
  const row = await prisma.oidcConfig.findUnique({
    where: { id: "default" },
    select: { enabled: true },
  })
  return row?.enabled === true
}

/** Reads the full OIDC config + decrypts the client secret. */
export async function getOidcConfig(): Promise<OidcConfig | null> {
  const row = await prisma.oidcConfig.findUnique({ where: { id: "default" } })
  if (!row) return null

  let clientSecret: string | null = null
  if (row.clientSecretEnc) {
    try {
      clientSecret = decryptSecret(row.clientSecretEnc)
    } catch (e) {
      console.error("Error decrypting OIDC client secret:", e)
    }
  }

  // group_role_mapping is JSONB → already an object. Coerce defensively in
  // case an older row was migrated as something unexpected.
  const groupRoleMapping: Record<string, string> =
    row.groupRoleMapping && typeof row.groupRoleMapping === "object" && !Array.isArray(row.groupRoleMapping)
      ? (row.groupRoleMapping as Record<string, string>)
      : {}

  return {
    enabled: row.enabled,
    providerName: row.providerName || "SSO",
    issuerUrl: row.issuerUrl,
    clientId: row.clientId,
    clientSecret,
    scopes: row.scopes || "openid profile email",
    authorizationUrl: row.authorizationUrl,
    tokenUrl: row.tokenUrl,
    userinfoUrl: row.userinfoUrl,
    claimEmail: row.claimEmail || "email",
    claimName: row.claimName || "name",
    claimGroups: row.claimGroups,
    autoProvision: row.autoProvision,
    defaultRole: row.defaultRole || "viewer",
    groupRoleMapping,
    showLocalLogin: row.showLocalLogin,
    forceSsoRedirect: row.forceSsoRedirect,
  }
}

/**
 * Resolve the ProxCenter role from an OIDC ID-token's groups claim.
 * First match wins; falls back to config.defaultRole when no group matches.
 * (LDAP and OIDC differ here: OIDC always returns the default, while LDAP
 * returns null to preserve manually-assigned roles.)
 */
export function resolveOidcRole(
  groups: string[] | undefined,
  config: OidcConfig,
): string {
  if (!groups || groups.length === 0 || !config.groupRoleMapping) {
    return config.defaultRole
  }

  for (const rawGroup of groups) {
    const group = String(rawGroup).trim()
    if (!group) continue
    const mappedRole = config.groupRoleMapping[group]
    if (mappedRole) {
      return mappedRole
    }
  }

  return config.defaultRole
}

/**
 * Normalise a role value to a `role_`-prefixed RBAC role id. Both the
 * group->role mapping and the default role accept either "role_db" (new) or
 * "db" (legacy); falls back to "role_viewer" for an empty/missing value.
 */
export function toRoleId(role: string | null | undefined): string {
  const r = (role || "viewer").trim()
  return r.startsWith("role_") ? r : `role_${r}`
}

/**
 * Normalise a resolved OIDC role into a `role_`-prefixed RBAC role id. The
 * group->role mapping accepts both "role_db" (new) and "db" (legacy) values,
 * and the default role is stored either way too.
 */
export function oidcRoleId(groups: string[] | undefined, config: OidcConfig): string {
  return toRoleId(resolveOidcRole(groups, config))
}

/**
 * Re-sync a user's OIDC-derived RBAC assignment on login (issues #383, #442).
 *
 * The re-sync is AUTHORITATIVE (allowed to overwrite/demote the `oidc_` row)
 * only when a group->role mapping is actually configured AND the IdP sent a
 * real groups array on this login. An empty array still counts as authoritative
 * ("removed from every mapped group" must demote to the configured default).
 *
 * When there is no mapping, or the groups claim is missing / not an array, the
 * resolved role is `null`: syncProviderRoleAssignment then PRESERVES the user's
 * existing assignment (mirroring LDAP) and only seeds the configured default for
 * a first login. This is the #442 fix — a 1.4.4 re-sync demoted every OIDC user
 * with no mapped group back to viewer on each login, locking out admins whose
 * role was assigned manually. The `oidc_`-prefixed row is the only one touched,
 * so manual assignments are preserved.
 */
export async function syncOidcRoleAssignment(
  db: ProviderSyncDb,
  params: {
    userId: string
    groups: string[] | undefined
    config: OidcConfig
    now: Date
    newId: () => string
    groupsClaimIsArray: boolean
  },
): Promise<void> {
  const { userId, groups, config, now, newId, groupsClaimIsArray } = params

  const hasMapping =
    !!config.groupRoleMapping && Object.keys(config.groupRoleMapping).length > 0
  const resolvedRoleId =
    hasMapping && groupsClaimIsArray ? oidcRoleId(groups, config) : null

  await syncProviderRoleAssignment(db, {
    userId,
    resolvedRoleId,
    defaultRoleId: toRoleId(config.defaultRole),
    now,
    idPrefix: "oidc_",
    newId,
  })
}
