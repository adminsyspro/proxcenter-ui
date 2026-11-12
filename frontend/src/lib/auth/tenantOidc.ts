// src/lib/auth/tenantOidc.ts
//
// Rules that keep a tenant's own OIDC connection inside its tenant (issue #1289).
// A tenant IdP is controlled by the tenant, so every claim it sends is the
// tenant's word: it may sign in that tenant's users and grant them tenant
// roles, nothing more.

import { roleHasSensitiveNicPermissions } from "@/lib/rbac/nicPermissions"
import { isRoleAssignableInTenant } from "@/lib/rbac/rolePublication"
import { TENANT_FORBIDDEN_ROLE_IDS } from "@/lib/rbac/roleIds"
import { normalizeRoleId, type GroupGrant } from "./groupMapping"

// A DNS label: letters, digits and inner hyphens, 63 characters at most.
const DOMAIN_LABEL = /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/

function isDomainName(value: string): boolean {
  if (value.length > 253) return false
  const labels = value.split(".")
  return labels.length >= 2 && labels.every(label => DOMAIN_LABEL.test(label))
}

/**
 * Whether the server checks the addresses of a tenant connection: every URL it
 * calls must be public HTTPS, checked at each sign-in, with no outbound proxy.
 * On unless the provider vouches for the IdP (one it hosts); always on while
 * the tenant manages its IdP, whose URLs then come from the tenant itself.
 * Even an IdP the provider only configured is run by the tenant, which decides
 * what its discovery document announces and where its name points.
 */
export function isCheckedTenantConnection(selfService: boolean, trustedEndpoints: boolean): boolean {
  return selfService || !trustedEndpoints
}

/**
 * Allowed e-mail domains as stored: lowercase, no leading "@", deduplicated,
 * anything that is not a domain name dropped. Accepts the JSON array of the
 * column or the comma / whitespace separated text of the form.
 */
export function normalizeAllowedDomains(input: unknown): string[] {
  let items: unknown[] = []
  if (Array.isArray(input)) items = input
  else if (typeof input === "string") items = input.split(/[\s,;]+/)

  const out: string[] = []
  for (const item of items) {
    if (typeof item !== "string") continue
    let domain = item.trim().toLowerCase()
    while (domain.startsWith("@")) domain = domain.slice(1)
    if (isDomainName(domain) && !out.includes(domain)) out.push(domain)
  }
  return out
}

/** Role a tenant connection grants when no mapping is configured. */
export const TENANT_DEFAULT_ROLE_ID = "role_tenant_viewer"

/**
 * Whether the address belongs to one of the allowed domains. The domain is the
 * whole part after the single "@", compared exactly: a subdomain or a longer
 * name ending the same way is another domain. An empty list allows anything.
 */
export function isEmailDomainAllowed(email: string, domains: readonly string[]): boolean {
  if (domains.length === 0) return true
  const parts = String(email).trim().toLowerCase().split("@")
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false
  return domains.includes(parts[1])
}

/** Why a role cannot be granted by a tenant connection, null when it can. */
export type TenantRoleRefusal = "provider_role" | "unknown_role" | "sensitive_role"

/** What the rules read of a role: its owner, its catalogue fields and its permissions when loaded. */
export type TenantRoleRef = {
  id: string
  tenantId: string | null
  isSystem?: boolean
  audience?: string | null
  publishAll?: boolean | null
  publications?: { tenantId: string }[] | null
  permissions?: { permissionId: string }[]
}

/**
 * Prisma `select` of a TenantRoleRef, the publications narrowed to one tenant.
 * Kept here (not lib/rbac's ROLE_AVAILABILITY_SELECT) to stay free of Prisma.
 */
export const tenantRoleRefSelect = (tenantId: string) => ({
  id: true,
  tenantId: true,
  isSystem: true,
  audience: true,
  publishAll: true,
  publications: { where: { tenantId }, select: { tenantId: true } },
  permissions: { select: { permissionId: true } },
})

/**
 * A tenant connection may grant a role that exists, is not one of the
 * provider-only or wildcard roles, and that the tenant's admin could assign by
 * hand: a global role, one of its own, or a provider catalogue role of the
 * "tenant" audience published to it (ui#1336; never a service desk role). Another
 * tenant's custom role reads as unknown, never as "someone else's". Nor a role
 * carrying the NIC identity rights (MAC, VLAN), which only a super admin may
 * hand out (lib/rbac/assignmentGuards): a group mapping would grant them to
 * whoever the tenant IdP puts in the group.
 */
export function tenantRoleRefusal(role: TenantRoleRef | null, tenantId: string): TenantRoleRefusal | null {
  if (role && TENANT_FORBIDDEN_ROLE_IDS.includes(role.id)) return "provider_role"
  if (!role || !isRoleAssignableInTenant({ ...role, isSystem: !!role.isSystem }, tenantId)) return "unknown_role"
  if (roleHasSensitiveNicPermissions(role)) return "sensitive_role"
  return null
}

/**
 * The mapping rows a tenant connection may act on: rows of its own tenant,
 * naming no vDC or a vDC of that tenant, with a role tenantRoleRefusal accepts.
 * Applied at every sign-in, so a row saved before a role or a vDC changed hands
 * grants nothing it no longer may. Order is kept (first match semantics).
 */
export function confineTenantGrants(
  grants: readonly GroupGrant[],
  tenantId: string,
  roles: ReadonlyMap<string, TenantRoleRef>,
  vdcOwner: ReadonlyMap<string, string>,
): GroupGrant[] {
  return grants.filter(grant => {
    if (grant.tenantId !== tenantId) return false
    if (grant.vdcId && vdcOwner.get(grant.vdcId) !== tenantId) return false
    return tenantRoleRefusal(roles.get(normalizeRoleId(grant.role)) ?? null, tenantId) === null
  })
}
