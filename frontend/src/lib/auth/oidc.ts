// src/lib/auth/oidc.ts
// OIDC / SSO config helpers. NextAuth's OIDC provider is built on the values
// returned here at request time, so the singleton row in `oidc_config` is
// the canonical source of truth (encrypted client secret + claim mappings).

import { prisma } from "@/lib/db/prisma"
import { decryptSecret } from "@/lib/crypto/secret"
import { syncProviderGrants, type ProviderGrantsDb, type MembershipPort } from "./roleSync"
import {
  DEFAULT_TENANT_ID,
  normalizeGroupGrantMapping,
  projectGrantsToRoleMapping,
  type GroupGrant,
} from "./groupMapping"
import { loadVdcScopes, toProviderGrantRows, type ResolvedGrant, type VdcScopeDb } from "./vdcScope"

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
  /**
   * Legacy flat projection of the mapping: only the unscoped provider-tenant
   * grants. Kept for the `users.role` display column and resolveOidcRole.
   */
  groupRoleMapping: Record<string, string>
  /** Full tenant/vDC aware mapping, the authoritative shape since v1.5. */
  groupGrants: GroupGrant[]
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

  // group_role_mapping is JSONB holding either the tenant/vDC aware entry list
  // or, on a config written before v1.5, the legacy flat { group: role } object.
  // normalizeGroupGrantMapping absorbs both, so no data migration is needed.
  const groupGrants = normalizeGroupGrantMapping(row.groupRoleMapping)
  const groupRoleMapping = projectGrantsToRoleMapping(groupGrants)

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
    groupGrants,
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
 * Resolve every grant an OIDC login is entitled to, in claim order.
 *
 * A group may appear in several mapping entries, so one login can produce a
 * role in the provider tenant AND a vDC-scoped role in a customer tenant. Only
 * the first entry per (tenant, vDC) pair is kept, which is the multi-tenant
 * reading of the historical "first match wins".
 *
 * When nothing matches, the configured default role is granted in the provider
 * tenant, preserving the pre-v1.5 behaviour where leaving every mapped group
 * demotes the user instead of locking them out.
 */
export function resolveOidcGrants(
  groups: string[] | undefined,
  config: OidcConfig,
): ResolvedGrant[] {
  const mapping = config.groupGrants || []
  const resolved: ResolvedGrant[] = []
  const seen = new Set<string>()

  if (groups && groups.length > 0 && mapping.length > 0) {
    for (const rawGroup of groups) {
      const group = String(rawGroup).trim()
      if (!group) continue
      for (const entry of mapping) {
        if (entry.group !== group) continue
        const key = `${entry.tenantId}\u0000${entry.vdcId ?? ""}`
        if (seen.has(key)) continue
        seen.add(key)
        resolved.push({ tenantId: entry.tenantId, vdcId: entry.vdcId, roleId: toRoleId(entry.role) })
      }
    }
  }

  if (resolved.length === 0) {
    return [{ tenantId: DEFAULT_TENANT_ID, vdcId: null, roleId: toRoleId(config.defaultRole) }]
  }
  return resolved
}

/**
 * Role id for the denormalised `users.role` display column at auto-provision
 * time. The column has no tenant, so the provider-tenant grant wins when there
 * is one, otherwise the first resolved grant.
 */
export function oidcSeedRoleId(groups: string[] | undefined, config: OidcConfig): string {
  const grants = resolveOidcGrants(groups, config)
  const preferred = grants.find(g => g.tenantId === DEFAULT_TENANT_ID) || grants[0]
  return preferred.roleId
}

/**
 * Re-sync a user's OIDC-derived RBAC assignments on login (issues #383, #442).
 *
 * The re-sync is AUTHORITATIVE (allowed to overwrite/demote/revoke the `oidc_`
 * rows) only when a mapping is actually configured AND the IdP sent a real
 * groups array on this login. An empty array still counts as authoritative
 * ("removed from every mapped group" must demote to the configured default).
 *
 * When there is no mapping, or the groups claim is missing / not an array, the
 * grants are `null`: syncProviderGrants then PRESERVES every existing
 * assignment (mirroring LDAP) and only seeds the configured default for a first
 * login. This is the #442 fix.
 *
 * Since v1.5 a mapping entry can name a tenant and a vDC, so the sync
 * reconciles a SET of rows across tenants and keeps tenant membership in step,
 * instead of owning a single provider-tenant row. Only `oidc_`-prefixed rows
 * are touched, so manual assignments are preserved (issue #940).
 */
export async function syncOidcRoleAssignment(
  db: ProviderGrantsDb & VdcScopeDb,
  params: {
    userId: string
    groups: string[] | undefined
    config: OidcConfig
    now: Date
    newId: () => string
    groupsClaimIsArray: boolean
    membership: MembershipPort
  },
): Promise<void> {
  const { userId, groups, config, now, newId, groupsClaimIsArray, membership } = params

  const hasMapping = (config.groupGrants?.length ?? 0) > 0
  let rows = null
  if (hasMapping && groupsClaimIsArray) {
    const resolved = resolveOidcGrants(groups, config)
    const vdcScopes = await loadVdcScopes(
      db,
      resolved.map(g => g.vdcId).filter((id): id is string => !!id),
    )
    rows = toProviderGrantRows(resolved, vdcScopes)
  }

  await syncProviderGrants(db, {
    userId,
    grants: rows,
    defaultRoleId: toRoleId(config.defaultRole),
    now,
    idPrefix: "oidc_",
    newId,
    membership,
  })
}
