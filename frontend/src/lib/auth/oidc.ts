// src/lib/auth/oidc.ts
// OIDC / SSO config helpers. NextAuth's OIDC provider is built on the values
// returned here at request time, so the singleton row in `oidc_config` is
// the canonical source of truth (encrypted client secret + claim mappings).

import { prisma } from "@/lib/db/prisma"
import { decryptSecret } from "@/lib/crypto/secret"

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
