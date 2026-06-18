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
 * Normalise a resolved OIDC role into a `role_`-prefixed RBAC role id. The
 * group->role mapping accepts both "role_db" (new) and "db" (legacy) values,
 * and the default role is stored either way too.
 */
export function oidcRoleId(groups: string[] | undefined, config: OidcConfig): string {
  const resolved = resolveOidcRole(groups, config)
  return resolved.startsWith("role_") ? resolved : `role_${resolved}`
}

/**
 * Re-sync a user's OIDC-derived RBAC assignment on every login (issue #383).
 *
 * Unlike LDAP, resolveOidcRole always resolves to a concrete role (its default
 * on no match), so this is a full re-evaluation: the user follows their current
 * IdP groups on each sign-in, and leaving a mapped group demotes them to the
 * default role at the next login. The `oidc_`-prefixed row is the only one
 * touched, so manual assignments are preserved (assignments are additive).
 */
export async function syncOidcRoleAssignment(
  db: ProviderSyncDb,
  params: { userId: string; groups: string[] | undefined; config: OidcConfig; now: Date; newId: () => string },
): Promise<void> {
  const { userId, groups, config, now, newId } = params
  await syncProviderRoleAssignment(db, {
    userId,
    resolvedRoleId: oidcRoleId(groups, config),
    defaultRoleId: "role_viewer",
    now,
    idPrefix: "oidc_",
    newId,
  })
}
