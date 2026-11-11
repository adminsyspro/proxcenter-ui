// src/lib/auth/oidc.ts
// OIDC / SSO config helpers. NextAuth's OIDC providers are built at request
// time from the `oidc_config` rows (see oidcConnections.ts): the "default" row
// is the provider IdP, every other row the IdP of one tenant (issue #1289).

import { prisma } from "@/lib/db/prisma"
import { syncProviderGrants, type ProviderGrantsDb, type MembershipPort } from "./roleSync"
import {
  ALL_PUBLISHED_TENANTS,
  DEFAULT_TENANT_ID,
  type GroupGrant,
  type MappingStrategy,
} from "./groupMapping"
import { getOidcConnection, PROVIDER_CONNECTION_ID } from "./oidcConnections"
import { loadVdcScopes, toProviderGrantRows, type ResolvedGrant, type VdcScopeDb } from "./vdcScope"

export interface OidcConfig {
  /** Connection id: "default" for the provider IdP, else the tenant id (issue #1289). */
  id: string
  /** Tenant whose users this connection signs in. */
  tenantId: string
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
  /** Refuse to link an existing account to an e-mail the IdP does not vouch for. */
  requireVerifiedEmail: boolean
  /** Read a missing email_verified claim as verified (IdPs that never send it). */
  idpVerifiesEmail: boolean
  /** Outbound proxy towards the IdP; null falls back to the environment. */
  proxyUrl: string | null
  proxyUsername: string | null
  proxyPassword: string | null
  proxyBypass: string | null
  /** Tenant connections: e-mail domains allowed to sign in, empty = any. */
  allowedDomains: string[]
  /**
   * The tenant manages this connection itself (self-service): its URLs came
   * from the tenant, so the server only reaches public HTTPS addresses for it.
   */
  strictUrls: boolean
}

/** Cheap "is OIDC turned on" probe for the provider IdP — see isLdapEnabled for the rationale. */
export async function isOidcEnabled(): Promise<boolean> {
  const row = await prisma.oidcConfig.findUnique({
    where: { id: PROVIDER_CONNECTION_ID },
    select: { enabled: true },
  })
  return row?.enabled === true
}

/** The provider IdP's configuration, client secret decrypted. */
export async function getOidcConfig(): Promise<OidcConfig | null> {
  return getOidcConnection(PROVIDER_CONNECTION_ID)
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
    // A configured group mapping that matched nothing must NOT fall back to a
    // provider-tenant grant: provider membership requires an explicit group, so
    // leaving every mapped group (claims `groups:[]`) grants no access rather
    // than silently handing out the provider default role (CX-23). This still
    // revokes the old mapped grants (issue #442's intent) — it just revokes all
    // the way instead of stopping at a provider floor. Only a deployment with
    // no group mapping at all uses the simple default grant.
    if (mapping.length > 0) return []
    return [{ tenantId: config.tenantId || DEFAULT_TENANT_ID, vdcId: null, roleId: toRoleId(config.defaultRole) }]
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
  // No grant resolved (a configured mapping matched nothing): the denormalised
  // display column gets the lowest-privilege tenant viewer, never a provider
  // role. The authoritative RBAC grant is what resolveOidcGrants returned (none).
  return preferred ? preferred.roleId : "role_tenant_viewer"
}

/** What expandAllTenantGrants needs beyond the sync's own surface. */
export type AllTenantsDb = {
  rbacRole: { findUnique: (args: any) => Promise<any> }
  tenant?: { findMany: (args: any) => Promise<Array<{ id: string }>> }
}

/**
 * Expand the entries that target "every tenant the role is published to"
 * (tenant "*", ui#1336) into one grant per such tenant, in the row's place,
 * then dedupe again with the strategy's key: an earlier row naming a tenant
 * explicitly still wins under first_match.
 */
export async function expandAllTenantGrants(
  db: AllTenantsDb,
  grants: ResolvedGrant[],
  cumulative: boolean,
): Promise<ResolvedGrant[]> {
  if (!grants.some(g => g.tenantId === ALL_PUBLISHED_TENANTS)) return grants

  const expandOne = async (grant: ResolvedGrant): Promise<ResolvedGrant[]> => {
    if (grant.tenantId !== ALL_PUBLISHED_TENANTS) return [grant]
    const role = await db.rbacRole.findUnique({
      where: { id: grant.roleId },
      select: { audience: true, publishAll: true, publications: { select: { tenantId: true } } },
    })
    if (!role || (role.audience !== "service_desk" && role.audience !== "tenant")) return []
    const tenantIds: string[] = role.publishAll
      ? ((await db.tenant?.findMany({ where: { enabled: true, id: { not: DEFAULT_TENANT_ID } }, select: { id: true } })) ?? []).map(t => t.id)
      : (role.publications ?? []).map((p: { tenantId: string }) => p.tenantId)
    return tenantIds.sort((x, y) => x.localeCompare(y)).map(tenantId => ({ tenantId, vdcId: null, roleId: grant.roleId }))
  }
  // Expanded side by side, flattened back in the mapping's row order.
  const expanded = (await Promise.all(grants.map(expandOne))).flat()

  const seen = new Set<string>()
  return expanded.filter(g => {
    const scope = `${g.tenantId}\u0000${g.vdcId ?? ""}`
    const key = cumulative ? `${scope}\u0000${g.roleId}` : scope
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
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
  db: ProviderGrantsDb & VdcScopeDb & AllTenantsDb,
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
    const resolved = await expandAllTenantGrants(db, resolveOidcGrants(groups, config), config.groupMappingStrategy === "cumulative")
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
