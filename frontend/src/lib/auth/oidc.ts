// src/lib/auth/oidc.ts
// OIDC/SSO authentication helpers

import { getDb } from "@/lib/db/sqlite"
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

/**
 * Checks if OIDC is enabled
 */
export function isOidcEnabled(): boolean {
  const db = getDb()

  const config = db
    .prepare("SELECT enabled FROM oidc_config WHERE id = 'default'")
    .get() as { enabled: number } | undefined

  return config?.enabled === 1
}

/**
 * Reads the full OIDC config from the database, decrypts the client secret
 */
export function getOidcConfig(): OidcConfig | null {
  const db = getDb()

  const config = db
    .prepare("SELECT * FROM oidc_config WHERE id = 'default'")
    .get() as any

  if (!config) return null

  let clientSecret: string | null = null

  if (config.client_secret_enc) {
    try {
      clientSecret = decryptSecret(config.client_secret_enc)
    } catch (e) {
      console.error("Error decrypting OIDC client secret:", e)
    }
  }

  let groupRoleMapping: Record<string, string> = {}

  try {
    groupRoleMapping = JSON.parse(config.group_role_mapping || '{}')
  } catch {
    // Invalid JSON, use empty mapping
  }

  return {
    enabled: config.enabled === 1,
    providerName: config.provider_name || 'SSO',
    issuerUrl: config.issuer_url,
    clientId: config.client_id,
    clientSecret,
    scopes: config.scopes || 'openid profile email',
    authorizationUrl: config.authorization_url || null,
    tokenUrl: config.token_url || null,
    userinfoUrl: config.userinfo_url || null,
    claimEmail: config.claim_email || 'email',
    claimName: config.claim_name || 'name',
    claimGroups: config.claim_groups || null,
    autoProvision: config.auto_provision === 1,
    defaultRole: config.default_role || 'viewer',
    groupRoleMapping,
  }
}

/**
 * Resolves the ProxCenter role based on IdP groups and the group-to-role mapping.
 * Returns the mapped role if a group matches, otherwise the default role.
 */
export function resolveOidcRole(
  groups: string[] | undefined,
  config: OidcConfig
): string {
  if (!groups || groups.length === 0 || !config.groupRoleMapping) {
    return config.defaultRole
  }

  // Check each group against the mapping (first match wins)
  for (const group of groups) {
    const mappedRole = config.groupRoleMapping[group]

    if (mappedRole) {
      return mappedRole
    }
  }

  return config.defaultRole
}
