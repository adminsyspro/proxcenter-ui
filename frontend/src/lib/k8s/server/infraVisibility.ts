/**
 * Infra-visibility gate for the K8s topology bridge.
 *
 * resolveInfraVisibility(tenantId) combines the tenant PVE connection filter
 * with the current request's RBAC infra scope and produces:
 *
 *   { enabled: boolean; connectionFilter: Set<string> | null }
 *
 * null filter  = the caller may enumerate ALL connections (provider + super-admin).
 * empty Set    = no connections are visible; the bridge MUST NOT run (enabled: false).
 * non-empty Set = the exact connection IDs the bridge may query.
 *
 * COMBINATION SEMANTICS (see task brief for rationale):
 *   - Both unrestricted (null) -> null filter, enabled.
 *   - Tenant restricts + RBAC null -> tenant filter is the filter.
 *   - Tenant null + RBAC restricts -> RBAC ids are the filter.
 *   - Both restrict -> intersection (keeps only ids visible in both).
 *   - Result empty Set -> enabled: false.
 */

import { getTenantInfrastructureScope, pveConnectionFilter } from '@/lib/tenant/infraScope'
import { getRBACContext, getRbacInfraScope, isConnectionVisible } from '@/lib/rbac'

export interface InfraVisibility {
  enabled: boolean
  connectionFilter: Set<string> | null
}

/**
 * Resolve the Proxmox bridge visibility for a given tenant.
 *
 * Reads the current request session (via getRBACContext) to derive the RBAC
 * scope. Combines with the tenant infrastructure scope. Pure-logic after the
 * two async lookups.
 *
 * WIRING CAVEATS FOR CONSUMING ROUTES:
 *
 * (a) Session-tenant coupling: RBAC is derived from the SESSION context
 *     (getRBACContext). The consuming route MUST pass the session tenantId.
 *     Passing a tenantId that differs from the session tenant will mismatch
 *     the RBAC half and the tenant-scope half, producing incorrect filters.
 *
 * (b) NOT an auth gate: when there is no session (provider background call),
 *     this function returns enabled:true with null filter (all connections).
 *     The consuming route MUST enforce authentication and the k8s.view
 *     permission BEFORE calling this function.
 *
 * Never throws: prefer returning { enabled: false } on unexpected errors so
 * callers fail safe. (Callers that need error detail should propagate normally.)
 */
export async function resolveInfraVisibility(
  tenantId: string,
): Promise<InfraVisibility> {
  const [infra, rbacCtx] = await Promise.all([
    getTenantInfrastructureScope(tenantId),
    getRBACContext(),
  ])

  // Tenant filter: null = provider (all connections), Set = restricted.
  const tenantFilter = pveConnectionFilter(infra)

  // RBAC scope: null = unrestricted (super-admin or no session).
  const rbacPrincipal = rbacCtx?.principal ?? rbacCtx?.userId
  const rbac = rbacCtx && !rbacCtx.isAdmin && rbacPrincipal
    ? await getRbacInfraScope(rbacPrincipal, rbacCtx.tenantId)
    : null

  // Both unrestricted: full access.
  if (tenantFilter === null && rbac === null) {
    return { enabled: true, connectionFilter: null }
  }

  // Compute the concrete visible Set.
  // Starting universe: tenant set if restricted, else the RBAC-visible ids.
  let universe: Set<string>

  if (tenantFilter !== null) {
    // Start from tenant filter.
    universe = tenantFilter
  } else {
    // tenantFilter is null (provider), but RBAC restricts.
    // Derive universe from RBAC (rbac is non-null here).
    const ids = new Set<string>()
    for (const id of rbac!.fullConnections) ids.add(id)
    for (const id of rbac!.nodesByConnection.keys()) ids.add(id)
    universe = ids
  }

  // If RBAC is non-null, intersect: keep only ids visible to RBAC.
  let connectionFilter: Set<string>

  if (rbac !== null) {
    const intersected = new Set<string>()
    for (const id of universe) {
      if (isConnectionVisible(rbac, id)) intersected.add(id)
    }
    connectionFilter = intersected
  } else {
    // Copy universe so a consumer mutating the result cannot corrupt a
    // shared cache (e.g. a 60s-cached vDC connectionIds Set).
    connectionFilter = new Set(universe)
  }

  if (connectionFilter.size === 0) {
    return { enabled: false, connectionFilter: new Set() }
  }

  return { enabled: true, connectionFilter }
}
