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
  normalizeMappingStrategy,
  projectGrantsToRoleMapping,
  type GroupGrant,
  type MappingStrategy,
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
  /** How several matching mapping rows combine for one login. */
  groupMappingStrategy: MappingStrategy
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
    groupMappingStrategy: normalizeMappingStrategy(row.groupMappingStrategy),
    showLocalLogin: row.showLocalLogin,
    forceSsoRedirect: row.forceSsoRedirect,
  }
}

/**
 * Resolve the ProxCenter role from an OIDC ID-token's groups claim.
 * The topmost matching mapping row wins (the flat projection keeps the grants
 * in the admin's row order); falls back to config.defaultRole when no group
 * matches. (LDAP and OIDC differ here: OIDC always returns the default, while
 * LDAP returns null to preserve manually-assigned roles.)
 */
export function resolveOidcRole(
  groups: string[] | undefined,
  config: OidcConfig,
): string {
  if (!groups || groups.length === 0 || !config.groupRoleMapping) {
    return config.defaultRole
  }

  const claimed = new Set<string>()
  for (const rawGroup of groups) {
    const group = String(rawGroup).trim()
    if (group) claimed.add(group)
  }

  for (const [group, role] of Object.entries(config.groupRoleMapping)) {
    if (role && claimed.has(group)) return role
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
 * Resolve every grant an OIDC login is entitled to, walking the mapping from
 * the top row down.
 *
 * ⚠️ The mapping drives the loop, NOT the groups claim (issue #992). Until
 * v1.5 the outer loop was the claim, so for a user in several mapped groups the
 * winner was whichever group the IdP happened to list first: an admin could not
 * influence it, and the "first match wins" the form promises was not true of
 * anything they could see. Reading the rows in order makes that promise real.
 *
 * `first_match` keeps the topmost matching row per (tenant, vDC) pair, the
 * multi-tenant reading of the historical behaviour. `cumulative` keeps every
 * matching row instead, so someone in several teams collects the roles of all
 * of them; permissions are a union across assignments (see lib/rbac
 * loadUserGrants), so the extra rows widen access and never narrow it.
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
  const cumulative = config.groupMappingStrategy === "cumulative"

  if (groups && groups.length > 0 && mapping.length > 0) {
    const claimed = new Set<string>()
    for (const rawGroup of groups) {
      const group = String(rawGroup).trim()
      if (group) claimed.add(group)
    }

    for (const entry of mapping) {
      if (!claimed.has(entry.group)) continue
      const roleId = toRoleId(entry.role)
      const scope = `${entry.tenantId}\u0000${entry.vdcId ?? ""}`
      // first_match dedupes on the scope, so one role per tenant/vDC survives.
      // cumulative dedupes on the scope AND the role, which only drops the
      // exact duplicate two rows would produce for the same user.
      const key = cumulative ? `${scope}\u0000${roleId}` : scope
      if (seen.has(key)) continue
      seen.add(key)
      resolved.push({ tenantId: entry.tenantId, vdcId: entry.vdcId, roleId })
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
 * is one, otherwise the first resolved grant. Under `cumulative` a user can
 * hold several roles in the provider tenant: the column then shows the topmost
 * mapping row, while the real access is the union of every assignment.
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
