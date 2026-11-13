// src/lib/auth/tenantOidcSignIn.ts
//
// Sign-in through a tenant's own IdP (issue #1289). The tenant controls that
// IdP and therefore every claim it sends, the e-mail and email_verified
// included. So, unlike the provider IdP:
//  - an identity is found by (connection, sub) only, never by e-mail: an
//    address already used by any account refuses the sign-in instead of linking;
//  - the account lives in that tenant only, and the IdP grants tenant roles in
//    that tenant only, re-checked at every sign-in (confineTenantGrants);
//  - an allowed-domain list, when set, filters the addresses it may provision.

import { nanoid } from "nanoid"

import { prisma } from "@/lib/db/prisma"
import { normalizeRoleId, readGroupsClaim } from "./groupMapping"
import { resolveOidcGrants, toRoleId, type OidcConfig } from "./oidc"
import { auditOidcLinkRefusal, OIDC_LINK_REFUSED, type OidcLinkRefusal } from "./oidcLinking"
import { syncProviderGrants, type ProviderGrantRow } from "./roleSync"
import { confineTenantGrants, isEmailDomainAllowed, TENANT_DEFAULT_ROLE_ID, tenantRoleRefSelect, tenantRoleRefusal } from "./tenantOidc"
import { loadVdcScopes, toProviderGrantRows } from "./vdcScope"
import { isSessionTenantDisabled } from "./jwtContext"

/** The NextAuth user object the callback fills in for the JWT. */
type SignInUser = { id: string; email?: string | null; name?: string | null; role?: unknown; authProvider?: unknown }

const REFUSED = `/login?error=${OIDC_LINK_REFUSED}`

async function refuse(email: string, reason: OidcLinkRefusal, connection: string): Promise<string> {
  await auditOidcLinkRefusal(email, reason, connection)
  return REFUSED
}

/**
 * Role ids and vDC owners the mapping and the default role refer to, read once
 * so the confinement rules can be applied as pure functions.
 */
async function loadReferences(config: OidcConfig) {
  const roleIds = [...new Set([toRoleId(config.defaultRole), ...config.groupGrants.map(g => normalizeRoleId(g.role))])]
  const roleRows = await prisma.rbacRole.findMany({
    where: { id: { in: roleIds } },
    select: tenantRoleRefSelect(config.tenantId),
  })
  const roles = new Map(roleRows.map(r => [r.id, r]))

  const vdcIds = config.groupGrants.map(g => g.vdcId).filter((id): id is string => !!id)
  const vdcScopes = await loadVdcScopes(prisma, vdcIds)
  const vdcOwner = new Map([...vdcScopes].map(([id, scope]) => [id, scope.tenantId]))

  return { roles, vdcOwner }
}

/**
 * The grant rows this sign-in is entitled to, or null when the IdP is not
 * authoritative (no mapping configured, or no groups array sent): the caller
 * then keeps the roles the user already holds and seeds the default once.
 * A configured mapping whose every row was dropped grants nothing.
 */
async function resolveTenantGrantRows(
  config: OidcConfig,
  groups: string[],
  groupsClaimIsArray: boolean,
  refs: Awaited<ReturnType<typeof loadReferences>>,
): Promise<ProviderGrantRow[] | null> {
  if (config.groupGrants.length === 0 || !groupsClaimIsArray) return null
  const confined = confineTenantGrants(config.groupGrants, config.tenantId, refs.roles, refs.vdcOwner)
  if (confined.length === 0) return []
  const resolved = resolveOidcGrants(groups, { ...config, groupGrants: confined })
  const scopes = await loadVdcScopes(prisma, resolved.map(g => g.vdcId).filter((id): id is string => !!id))
  return toProviderGrantRows(resolved, scopes)
}

/**
 * NextAuth signIn callback body for a tenant connection. Returns true to let the
 * user in, false to refuse silently, or the login URL carrying the refusal.
 */
export async function signInWithTenantConnection(params: {
  user: SignInUser
  profile: Record<string, unknown>
  config: OidcConfig
}): Promise<boolean | string> {
  const { user, profile, config } = params
  const tenantId = config.tenantId
  const now = new Date()

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { enabled: true } })
  if (!tenant?.enabled) return false

  const sub = typeof profile.sub === "string" ? profile.sub : ""
  const email = String(profile[config.claimEmail] || profile.email || "").toLowerCase().trim()
  const name = String(profile[config.claimName] || profile.name || email)
  if (!sub || !email) return false

  const { groups, groupsClaimIsArray } = readGroupsClaim(profile, config.claimGroups)
  const refs = await loadReferences(config)
  const configuredDefault = toRoleId(config.defaultRole)
  const defaultRoleId = tenantRoleRefusal(refs.roles.get(configuredDefault) ?? null, tenantId) ? TENANT_DEFAULT_ROLE_ID : configuredDefault
  const rows = await resolveTenantGrantRows(config, groups, groupsClaimIsArray, refs)

  if (!isEmailDomainAllowed(email, config.allowedDomains)) return refuse(email, "email_domain_not_allowed", tenantId)

  const existing = await prisma.user.findFirst({
    where: { oidcConnectionId: tenantId, oidcSub: sub },
    select: { id: true, email: true, role: true, enabled: true },
  })

  if (existing) {
    if (!existing.enabled) return false
    // Removed from the tenant by an admin: the IdP alone does not bring the
    // account back, only a mapping that grants it a role does (below).
    const member = await prisma.userTenant.findUnique({
      where: { userId_tenantId: { userId: existing.id, tenantId } },
      select: { userId: true },
    })
    if (!member && !rows?.length) return false

    await prisma.user.update({ where: { id: existing.id }, data: { name, lastLoginAt: now, updatedAt: now } })
    user.id = existing.id
    user.email = existing.email
    user.role = existing.role
  } else {
    // Never bound by e-mail: the tenant IdP vouches for addresses it does not own.
    const holder = await prisma.user.findUnique({ where: { email }, select: { id: true } })
    if (holder) return refuse(email, "email_in_use", tenantId)
    if (!config.autoProvision) return false

    const id = nanoid()
    const displayRole = (rows?.[0]?.roleId ?? defaultRoleId).replace(/^role_/, "")
    await prisma.user.create({
      data: {
        id, tenantId, email, name, role: displayRole, authProvider: "oidc",
        oidcSub: sub, oidcConnectionId: tenantId, enabled: true, createdAt: now, updatedAt: now, lastLoginAt: now,
      },
    })
    await prisma.userTenant.create({ data: { userId: id, tenantId, isDefault: true, joinedAt: now } })
    user.id = id
    user.email = email
    user.role = displayRole
  }
  user.name = name
  user.authProvider = "oidc"

  // lib/tenant is imported lazily: it pulls lib/auth/principal, which would
  // close an import cycle back onto the auth configuration.
  const { addUserToTenant, removeUserFromTenant } = await import("@/lib/tenant")
  await syncProviderGrants(prisma, {
    userId: user.id,
    grants: rows,
    defaultRoleId,
    now,
    idPrefix: "oidc_",
    newId: () => `oidc_${nanoid(12)}`,
    homeTenantId: tenantId,
    fallbackRoleId: TENANT_DEFAULT_ROLE_ID,
    membership: {
      add: (userId, target) => addUserToTenant(userId, target),
      remove: (userId, target) => removeUserFromTenant(userId, target),
    },
  })

  return !(await isSessionTenantDisabled(user.id))
}
