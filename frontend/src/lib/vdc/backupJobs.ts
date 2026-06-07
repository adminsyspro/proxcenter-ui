// src/lib/vdc/backupJobs.ts
//
// Tenant scoping for PVE backup jobs (/cluster/backup). PVE has no
// per-tenant namespace for vzdump jobs — the cluster-wide list returned
// by GET /cluster/backup contains every job regardless of who created
// it. We compensate at the ProxCenter API layer:
//
//   - tenants only see jobs whose `pool` matches one of their vDC pools
//     on the target connection
//   - tenants can only create/edit/delete/run jobs that target one of
//     their pools — `selectionMode='pool'` with a pool they own
//   - and the chosen `storage`, optional `node`, optional fleecing
//     storage and PBS `namespace` must all live inside the same vDC
//     (validateTenantJobInfra)
//
// Provider (default tenant) gets the unfiltered cluster-wide view, same
// as before. An MSP tenant directly owns the connection's whole cluster,
// so it is treated exactly like the provider here: full job view, any
// selection mode, no pool/storage/node masking. Only iaas (vDC) tenants
// are pool-scoped. The function returns `null` to signal "no filter
// applies" so callers can short-circuit cleanly.
//
// The strict pool-only contract for tenant-side mutations is intentional:
// `selectionMode='include'` (vmid list) and `selectionMode='all'` would
// require validating every vmid against the tenant's pool membership on
// every write, and a job that drifts (a vmid leaves the pool) would
// silently keep backing up a foreign VM. The pool-based contract makes
// drift impossible.

import { getTenantInfrastructureScope, maskingScope } from '@/lib/tenant/infraScope'

import { type VdcScope } from './scope'

/**
 * Returns the set of PVE pool names a tenant is allowed to target via
 * backup jobs on the given connection. `null` means the caller sees the
 * whole cluster with no pool filter — either the provider (default tenant)
 * or an MSP tenant, which directly owns the connection's cluster.
 *
 * An empty Set means an iaas (vDC) tenant has no vDC on this connection:
 * every job is forbidden, every list is empty.
 */
export async function getAllowedJobPools(tenantId: string, connectionId: string): Promise<Set<string> | null> {
  // maskingScope is null for the provider AND for MSP tenants (both own the
  // full cluster, no pool filter) and the vDC scope for an iaas tenant.
  const scope = maskingScope(await getTenantInfrastructureScope(tenantId))
  if (!scope) return null
  return scope.poolsByConnection.get(connectionId) ?? new Set<string>()
}

/**
 * True when a backup job's pool is in the allowed set. Jobs without a
 * pool (selectionMode='all' or 'include') are NEVER tenant-owned —
 * those flows are reserved to the provider.
 */
export function isJobOwnedByTenantPools(
  job: { pool?: string | null },
  allowedPools: Set<string>,
): boolean {
  return !!job.pool && allowedPools.has(job.pool)
}

/**
 * Validate a POST/PUT body coming from a tenant. Throws a `Response`
 * (caller short-circuits with `return validation`) when the body
 * doesn't match the pool-only contract. Returns `null` on success.
 *
 * The shape we accept: { selectionMode: 'pool', pool: <name> } where
 * <name> ∈ allowedPools. Anything else is refused.
 */
export function validateTenantJobBody(
  body: { selectionMode?: string; pool?: string | null },
  allowedPools: Set<string>,
): string | null {
  if (body.selectionMode !== 'pool') {
    return 'Tenant backup jobs must use selectionMode="pool" — pick a vDC pool to back up.'
  }
  if (!body.pool) {
    return 'Tenant backup jobs require a pool.'
  }
  if (!allowedPools.has(body.pool)) {
    return `Pool "${body.pool}" is not authorised for this tenant.`
  }
  return null
}

/**
 * Validate the infrastructure fields of a backup-job payload (storage,
 * node, fleecingStorage, namespace) against a tenant's vDC scope on the
 * target connection. Returns an error message when the body references
 * a resource the tenant is not authorised to use, otherwise null.
 *
 * Call this in addition to `validateTenantJobBody` whenever any of these
 * fields are present in the request body — both POST (create) and PUT
 * (edit). For a PUT, only validate the fields the body actually carries
 * (the route forwards `undefined` fields as no-ops to PVE).
 */
export function validateTenantJobInfra(
  body: {
    storage?: string
    node?: string | null
    fleecing?: unknown
    fleecingStorage?: string
    namespace?: string
  },
  scope: VdcScope,
  connectionId: string,
): string | null {
  const allowedNodes = scope.nodesByConnection.get(connectionId) ?? new Set<string>()
  const allowedStorages = scope.storagesByConnection.get(connectionId) ?? new Set<string>()
  // pbsNamespacesByPveConnection is the right index here: the route
  // gives us the PVE connection id, and we want the union of namespaces
  // the tenant is allowed to address from any vDC anchored on that PVE
  // cluster. The PBS-keyed map (pbsNamespacesByConnection) is used by
  // /api/v1/pbs/[id]/... routes, where the id is a PBS connection.
  const allowedNamespaces = scope.pbsNamespacesByPveConnection.get(connectionId) ?? new Set<string>()

  if (typeof body.storage === 'string' && body.storage.length > 0) {
    if (!allowedStorages.has(body.storage)) {
      return `Storage "${body.storage}" is not authorised for this tenant.`
    }
  }

  // For tenants, PVE backup jobs MUST be pinned to a vDC node. Cluster-
  // wide jobs (no `node` on PVE) would silently target nodes outside the
  // tenant's scope on the next reshape. The helper allows `body.node`
  // to be omitted entirely (PUT shape with unrelated fields), but as
  // soon as it's present in the body, we enforce both non-empty AND
  // belonging to the vDC. The route layer is responsible for requiring
  // node presence at create time.
  if ('node' in body) {
    const v = body.node
    if (typeof v !== 'string' || v.length === 0) {
      return 'Tenants must keep the backup job pinned to a vDC node.'
    }
    if (!allowedNodes.has(v)) {
      return `Node "${v}" is not authorised for this tenant.`
    }
  }

  if (body.fleecing && typeof body.fleecingStorage === 'string' && body.fleecingStorage.length > 0) {
    if (!allowedStorages.has(body.fleecingStorage)) {
      return `Fleecing storage "${body.fleecingStorage}" is not authorised for this tenant.`
    }
  }

  if (typeof body.namespace === 'string' && body.namespace.length > 0) {
    const ns = body.namespace
    if (!allowedNamespaces.has(ns)) {
      return `PBS namespace "${ns}" is not authorised for this tenant on this connection.`
    }
  }

  return null
}
