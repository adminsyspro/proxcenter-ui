// src/lib/rbac/userRoleSummary.ts
//
// Read a user's RBAC assignments the way the Users page needs to show them
// (issue #1074). Since the SSO "combine every matching role" strategy, a user
// can legitimately hold several roles in ONE tenant, and the page used to read
// any second role as "roles differ across tenants", hiding the roles behind a
// warning chip and an empty role picker.
//
// Client-safe: no server import, the page is a client component.

/** Who owns an assignment row, read from its id prefix (see lib/auth/roleSync). */
export type AssignmentOrigin = "oidc" | "ldap" | "manual"

export function assignmentOrigin(assignmentId: string | null | undefined): AssignmentOrigin {
  if (assignmentId?.startsWith("oidc_")) return "oidc"
  if (assignmentId?.startsWith("ldap_")) return "ldap"
  return "manual"
}

export type UserRoleEntry = {
  id?: string | null
  name?: string | null
  color?: string | null
  is_system?: boolean
  tenant_id?: string | null
  tenant_name?: string | null
  assignment_id?: string | null
}

export type UserRoleSummary<R extends UserRoleEntry = UserRoleEntry> = {
  /** One entry per distinct role, in assignment order. */
  distinctRoles: R[]
  /**
   * True only when the user's tenants do not all hold the same SET of roles.
   * Several roles inside a single tenant (SSO cumulative mapping) is not
   * divergence: saving one role from the dialog does not erase a difference
   * between tenants there, it collapses the cumulated roles.
   */
  divergentAcrossTenants: boolean
  /** The sign-in provider owning at least one row, when any does. */
  providerManagedBy: "oidc" | "ldap" | null
  /** At least one row was granted by an admin rather than by a provider. */
  hasManualRow: boolean
}

export function summarizeUserRoles<R extends UserRoleEntry>(roles: readonly R[] | null | undefined): UserRoleSummary<R> {
  const list = Array.isArray(roles) ? roles : []

  const distinctRoles: R[] = []
  const seenRoles = new Set<string>()
  const roleSetsByTenant = new Map<string, Set<string>>()
  let providerManagedBy: "oidc" | "ldap" | null = null
  let hasManualRow = false

  for (const role of list) {
    if (!role?.id) continue
    if (!seenRoles.has(role.id)) {
      seenRoles.add(role.id)
      distinctRoles.push(role)
    }

    const tenant = role.tenant_id || ""
    const set = roleSetsByTenant.get(tenant)
    if (set) set.add(role.id)
    else roleSetsByTenant.set(tenant, new Set([role.id]))

    const origin = assignmentOrigin(role.assignment_id)
    if (origin === "manual") hasManualRow = true
    else providerManagedBy ??= origin
  }

  const signatures = new Set([...roleSetsByTenant.values()].map(set => [...set].sort((x, y) => x.localeCompare(y)).join("\u0000")))

  return {
    distinctRoles,
    divergentAcrossTenants: signatures.size > 1,
    providerManagedBy,
    hasManualRow,
  }
}
