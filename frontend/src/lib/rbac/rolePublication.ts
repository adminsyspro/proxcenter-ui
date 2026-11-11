// src/lib/rbac/rolePublication.ts
//
// Provider role catalogue (ui#1336): where a role may be held, and what it may
// contain. One definition, owned by the provider tenant, reaches the customer
// tenants it is published to.
//
//  - "provider":     the provider tenant only.
//  - "service_desk": provider staff working INSIDE the customer tenants the
//                    role is published to. Never the provider tenant, never
//                    visible to nor assignable by a Tenant Admin.
//  - "tenant":       published to customer tenants, whose Tenant Admin may
//                    assign it to their own users.
//  - null (legacy):  the role belongs to `tenantId` alone, as before the
//                    catalogue. A provider-owned legacy role may also carry
//                    publications written by the 20261110190000 migration:
//                    they grandfather the customer tenants the OIDC group
//                    mapping already sent it to, for the SSO sync only.
//
// The same predicate guards every way a role becomes effective: the grant
// loader (lib/rbac loadUserGrants), the assignment routes, the OIDC mapping
// and its login-time sync. Unpublishing a role therefore removes the access at
// the next request, even before the materialised rows are cleaned up.

import { DEFAULT_TENANT_ID } from "@/lib/tenant/constants"

import { SENSITIVE_NIC_PERMISSIONS } from "./nicPermissions"

export const ROLE_AUDIENCES = ["provider", "service_desk", "tenant"] as const
export type RoleAudience = (typeof ROLE_AUDIENCES)[number]

/** Audiences whose role is published to customer tenants. */
export const PUBLISHED_AUDIENCES: readonly RoleAudience[] = ["service_desk", "tenant"]

export function isRoleAudience(value: unknown): value is RoleAudience {
  return typeof value === "string" && (ROLE_AUDIENCES as readonly string[]).includes(value)
}

/** The role fields the availability rule reads. */
export type PublishableRole = {
  isSystem: boolean
  tenantId: string | null
  audience?: string | null
  publishAll?: boolean | null
  /** Publication tenant ids. A caller may pre-filter this to the tenant it asks about. */
  publications?: { tenantId: string }[] | null
}

/** System roles, and any role without an owner tenant, are global. */
function isGlobalRole(role: PublishableRole): boolean {
  return role.isSystem || role.tenantId === null || role.tenantId === undefined
}

function isPublishedTo(role: PublishableRole, tenantId: string): boolean {
  return (role.publications ?? []).some(p => p.tenantId === tenantId)
}

/**
 * Whether a grant of `role` in `tenantId` is in force. System roles are
 * governed by their own lists (PROVIDER_ONLY_ROLE_IDS, PROTECTED_ROLE_IDS) and
 * always pass here.
 */
export function isRoleAvailableInTenant(role: PublishableRole, tenantId: string): boolean {
  if (isGlobalRole(role)) return true
  const audience = role.audience ?? null
  if (audience === null) {
    if (role.tenantId === tenantId) return true
    return role.tenantId === DEFAULT_TENANT_ID && tenantId !== DEFAULT_TENANT_ID && isPublishedTo(role, tenantId)
  }
  if (audience === "provider") return tenantId === DEFAULT_TENANT_ID
  if (tenantId === DEFAULT_TENANT_ID) return false
  return !!role.publishAll || isPublishedTo(role, tenantId)
}

/**
 * Whether a Tenant Admin (or any caller working from inside `tenantId`) may see
 * and assign `role` there through the ordinary assignment routes. Narrower than
 * isRoleAvailableInTenant: service-desk roles and grandfathered legacy
 * publications stay a provider matter.
 */
export function isRoleAssignableInTenant(role: PublishableRole, tenantId: string): boolean {
  if (isGlobalRole(role)) return true
  const audience = role.audience ?? null
  if (audience === null) return role.tenantId === tenantId
  if (audience === "service_desk") return false
  return isRoleAvailableInTenant(role, tenantId)
}

/**
 * Permission ceiling of the roles published to customer tenants: what the
 * system Tenant Admin role carries (parents imply their children, as in
 * grantsPermission), plus the NIC identity rights, which stay grantable by a
 * super admin only (assignmentGuards rule 4) but belong inside a tenant.
 */
export function buildTenantCeiling(tenantAdminPermissions: Iterable<string>): Set<string> {
  const ceiling = new Set<string>(tenantAdminPermissions)
  for (const p of SENSITIVE_NIC_PERMISSIONS) ceiling.add(p)
  return ceiling
}

function withinCeiling(ceiling: Set<string>, permission: string): boolean {
  if (ceiling.has(permission)) return true
  const parts = permission.split(".")
  for (let i = parts.length - 1; i >= 2; i--) {
    if (ceiling.has(parts.slice(0, i).join("."))) return true
  }
  return false
}

/** The permissions of `requested` the ceiling refuses, sorted for a stable message. */
export function ceilingViolations(requested: Iterable<string>, ceiling: Set<string>): string[] {
  const out = new Set<string>()
  for (const p of requested) if (!withinCeiling(ceiling, p)) out.add(p)
  return Array.from(out).sort((a, b) => a.localeCompare(b))
}

export type PublicationInput = {
  audience: RoleAudience | null
  publishAll: boolean
  tenantIds: string[]
}

// FLAT on purpose (tsconfig strict:false breaks discriminated-union narrowing):
// callers test `ok`, then read `error` or `value`.
export type PublicationParse = { ok: boolean; error?: string; value?: PublicationInput }

/**
 * Validate the audience / publication part of a role payload. `published_tenants`
 * is only meaningful for a published audience, and never names the provider
 * tenant.
 */
export function parsePublicationInput(body: {
  audience?: unknown
  publish_all?: unknown
  published_tenants?: unknown
}): PublicationParse {
  const rawAudience = body.audience ?? null
  if (rawAudience !== null && !isRoleAudience(rawAudience)) {
    return { ok: false, error: `Unknown role audience: ${String(rawAudience)}` }
  }
  const audience = rawAudience as RoleAudience | null
  const published = audience !== null && PUBLISHED_AUDIENCES.includes(audience)

  if (!published) {
    if (body.publish_all === true || (Array.isArray(body.published_tenants) && body.published_tenants.length > 0)) {
      return { ok: false, error: "Only service desk and tenant roles can be published to tenants" }
    }
    return { ok: true, value: { audience, publishAll: false, tenantIds: [] } }
  }

  if (body.published_tenants !== undefined && !Array.isArray(body.published_tenants)) {
    return { ok: false, error: "published_tenants must be a list of tenant ids" }
  }
  const tenantIds = Array.from(
    new Set(
      ((body.published_tenants as unknown[]) ?? [])
        .filter((t): t is string => typeof t === "string")
        .map(t => t.trim())
        .filter(Boolean),
    ),
  )
  if (tenantIds.includes(DEFAULT_TENANT_ID)) {
    return { ok: false, error: "A published role cannot be published to the provider tenant" }
  }
  const publishAll = body.publish_all === true
  return { ok: true, value: { audience, publishAll, tenantIds: publishAll ? [] : tenantIds } }
}

/**
 * The catalogue fields of a role in an API response. A customer tenant sees
 * the audience of the roles offered to it, never where else they are
 * published.
 */
export function publicationFields(
  role: { audience?: string | null; publishAll?: boolean | null; publications?: { tenantId: string }[] | null },
  providerView: boolean,
): { audience: string | null; publish_all: boolean | null; published_tenants: string[] | null } {
  const audience = role.audience ?? null
  if (!providerView) return { audience, publish_all: null, published_tenants: null }
  return {
    audience,
    publish_all: !!role.publishAll,
    published_tenants: (role.publications ?? []).map(p => p.tenantId).sort((a, b) => a.localeCompare(b)),
  }
}

/** Prisma filter of the catalogue roles offered to a customer tenant's own admins. */
export function tenantCatalogueFilter(tenantId: string) {
  return {
    audience: "tenant",
    OR: [{ publishAll: true }, { publications: { some: { tenantId } } }],
  }
}
