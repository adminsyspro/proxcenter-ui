// src/lib/vdc/scope.ts
// vDC Scope Resolver & Cluster Filter
//
// Resolves which nodes/storages/pools a tenant is allowed to see based on
// their vDC assignments, and provides a filter function for cluster data.

import { prisma } from '@/lib/db/prisma'
import { DEFAULT_TENANT_ID } from '@/lib/tenant'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VdcScope {
  /** PVE connection IDs referenced by the tenant's vDCs */
  connectionIds: Set<string>
  /** PBS connection IDs the tenant has at least one vDC binding on */
  pbsConnectionIds: Set<string>
  /** Per-connection: allowed node names */
  nodesByConnection: Map<string, Set<string>>
  /** Per-connection: allowed storage IDs */
  storagesByConnection: Map<string, Set<string>>
  /** Per-connection: PVE pool names (VMs must be in one of these pools) */
  poolsByConnection: Map<string, Set<string>>
  /** Per-connection: allowed SDN VNet names */
  vnetsByConnection: Map<string, Set<string>>
  /** Per-connection: allowed shared bridge names */
  sharedBridgesByConnection: Map<string, Set<string>>
  /** Per-PBS-connection: list of { datastore, namespace } the tenant is authorised on. */
  pbsNamespacesByConnection: Map<string, Array<{ datastore: string; namespace: string }>>
  /**
   * Per-PVE-connection: PBS namespaces reachable from a vDC anchored on
   * that PVE cluster (across every PBS binding of every vDC the tenant
   * has on that connection). Used by backup-jobs validation, where the
   * route knows the PVE connection id but the binding rows are keyed
   * by PBS connection id.
   */
  pbsNamespacesByPveConnection: Map<string, Set<string>>
}

// ---------------------------------------------------------------------------
// In-memory cache (60s TTL)
// ---------------------------------------------------------------------------

interface CacheEntry {
  data: VdcScope | null
  expiry: number
}

const scopeCache = new Map<string, CacheEntry>()

// Short TTL: scope drives VM-create pickers (nodes, storages, networks), so
// stale reads are user-visible. Mutations call clearVdcScopeCache, but that
// relies on the caller actually being invoked — this is a safety net when the
// caller is out of band (direct DB edits, race between hot-reload and an
// entry cached by the previous module instance).
const CACHE_TTL_MS = 5_000

// ---------------------------------------------------------------------------
// getVdcScope
// ---------------------------------------------------------------------------

/**
 * Resolves the vDC scope for a tenant.
 *
 * Contract:
 * - Returns `null` ONLY for the default tenant (provider view, no filtering).
 * - Returns a `VdcScope` for every other tenant. When the tenant has zero
 *   enabled vDCs, the returned scope has empty Sets/Maps, which makes every
 *   downstream filter deny by construction (no allowed connection, node,
 *   storage, pool, vnet, bridge, or PBS namespace).
 *
 * Callers that gate behaviour on `scope === null` therefore treat that as
 * "I am the provider", not as "no restrictions". A tenant without vDCs ends
 * up with a non-null empty scope and is denied access through the existing
 * Set lookups.
 */
export async function getVdcScope(tenantId: string): Promise<VdcScope | null> {
  // Default tenant = provider, no filtering
  if (tenantId === DEFAULT_TENANT_ID) return null

  // Check cache
  const now = Date.now()
  const cached = scopeCache.get(tenantId)

  if (cached && cached.expiry > now) {
    return cached.data
  }

  // Build scope from DB
  const scope = await buildVdcScope(tenantId)

  // Cache the result
  scopeCache.set(tenantId, { data: scope, expiry: now + CACHE_TTL_MS })

  return scope
}

// ---------------------------------------------------------------------------
// buildVdcScope (internal)
// ---------------------------------------------------------------------------

async function buildVdcScope(tenantId: string): Promise<VdcScope> {
  // 1. Find all enabled vDCs for this tenant + their child rows in a single
  //    Prisma query (replaces the SQLite N+1 prepared-statement loop).
  const vdcRows = await prisma.vdc.findMany({
    where: { tenantId, enabled: true },
    select: {
      id: true,
      connectionId: true,
      pvePoolName: true,
      primaryStorage: true,
      nodes: { select: { nodeName: true } },
      storages: { select: { storageId: true } },
      vnets: { select: { pveName: true } },
      sharedBridges: { select: { bridge: true } },
      pbsNamespaces: { select: { pbsConnectionId: true, datastore: true, namespace: true } },
    },
  })

  // 2. Build the scope. When vdcRows is empty (tenant has no vDC), every
  // collection stays empty and the caller's Set/Map lookups return
  // undefined, which existing filters interpret as "deny". This is the
  // safe default for a non-provider tenant: only DEFAULT_TENANT_ID gets
  // unfiltered access (returned as `null` by getVdcScope).
  const connectionIds = new Set<string>()
  const nodesByConnection = new Map<string, Set<string>>()
  const storagesByConnection = new Map<string, Set<string>>()
  const poolsByConnection = new Map<string, Set<string>>()
  const vnetsByConnection = new Map<string, Set<string>>()
  const sharedBridgesByConnection = new Map<string, Set<string>>()
  const pbsNamespacesByConnection = new Map<string, Array<{ datastore: string; namespace: string }>>()
  const pbsNamespacesByPveConnection = new Map<string, Set<string>>()
  const pbsConnectionIds = new Set<string>()

  for (const row of vdcRows) {
    const connId = row.connectionId
    connectionIds.add(connId)

    // Nodes: merge across multiple vDCs on the same connection
    if (!nodesByConnection.has(connId)) nodesByConnection.set(connId, new Set())
    for (const nr of row.nodes) {
      nodesByConnection.get(connId)!.add(nr.nodeName)
    }

    // Storages: merge across multiple vDCs on the same connection.
    // Includes the vDC's primary VM-disk storage (`vdcs.primary_storage`)
    // and any PBS pseudo-storages bound to the vDC (`vdc_storages` rows
    // managed by pbsOrchestrator). Together these form the tenant's
    // visible storage scope for inventory and deploy paths.
    if (!storagesByConnection.has(connId)) storagesByConnection.set(connId, new Set())
    if (row.primaryStorage) storagesByConnection.get(connId)!.add(row.primaryStorage)
    for (const sr of row.storages) {
      storagesByConnection.get(connId)!.add(sr.storageId)
    }

    // Pools: each vDC has exactly one PVE pool
    if (!poolsByConnection.has(connId)) poolsByConnection.set(connId, new Set())
    poolsByConnection.get(connId)!.add(row.pvePoolName)

    // VNets: merge across multiple vDCs on the same connection
    if (!vnetsByConnection.has(connId)) vnetsByConnection.set(connId, new Set())
    for (const vr of row.vnets) {
      vnetsByConnection.get(connId)!.add(vr.pveName)
    }

    // Shared bridges: merge across multiple vDCs on the same connection
    if (!sharedBridgesByConnection.has(connId)) sharedBridgesByConnection.set(connId, new Set())
    for (const sb of row.sharedBridges) {
      sharedBridgesByConnection.get(connId)!.add(sb.bridge)
    }

    // PBS namespaces: keyed by PBS connection (a vDC can have bindings on
    // multiple PBS connections; many vDCs can share the same PBS). Also
    // mirrored under the vDC's PVE connection so backup-jobs validation
    // (which only knows the PVE connection id) can answer "is this
    // namespace ever bound to a vDC on this cluster?".
    for (const pr of row.pbsNamespaces) {
      const list = pbsNamespacesByConnection.get(pr.pbsConnectionId) ?? []
      list.push({ datastore: pr.datastore, namespace: pr.namespace })
      pbsNamespacesByConnection.set(pr.pbsConnectionId, list)
      pbsConnectionIds.add(pr.pbsConnectionId)

      const pveSet = pbsNamespacesByPveConnection.get(connId) ?? new Set<string>()
      pveSet.add(pr.namespace)
      pbsNamespacesByPveConnection.set(connId, pveSet)
    }
  }

  return {
    connectionIds,
    pbsConnectionIds,
    nodesByConnection,
    storagesByConnection,
    poolsByConnection,
    vnetsByConnection,
    sharedBridgesByConnection,
    pbsNamespacesByConnection,
    pbsNamespacesByPveConnection,
  }
}

// ---------------------------------------------------------------------------
// applyVdcFilter
// ---------------------------------------------------------------------------

/**
 * Filters a ClusterData object by vDC scope. Called after RBAC filtering.
 *
 * Expected cluster shape:
 *   { id: string (connectionId), name: string, nodes: [{ node: string, guests: [{ pool?: string, ... }] }] }
 *
 * Behaviour:
 * - scope === null  ->  return cluster unchanged (no vDC restrictions)
 * - no scope for this connection  ->  tenant has no vDC on this cluster, hide everything
 * - otherwise  ->  filter nodes + filter guests by pool membership
 *
 * VMs without a `pool` (undefined / empty string) are hidden for vDC-scoped
 * tenants because they don't belong to any vDC pool.
 */
export function applyVdcFilter(cluster: any, scope: VdcScope | null): any {
  // No scope means no vDC restrictions - return as-is
  if (scope === null) return cluster

  const connId: string = cluster.id
  const allowedNodes = scope.nodesByConnection.get(connId)

  // Tenant has no vDC on this connection - hide everything
  if (!allowedNodes) {
    return { ...cluster, nodes: [] }
  }

  const allowedPools = scope.poolsByConnection.get(connId) ?? new Set<string>()

  // Filter nodes, then filter guests within each remaining node
  const filteredNodes = cluster.nodes
    .filter((node: any) => allowedNodes.has(node.node))
    .map((node: any) => {
      const filteredGuests = (node.guests ?? []).filter((guest: any) => {
        // VMs without a pool are hidden for vDC-scoped tenants
        const pool = guest.pool
        if (!pool || pool === '') return false

        return allowedPools.has(pool)
      })

      return { ...node, guests: filteredGuests }
    })

  return { ...cluster, nodes: filteredNodes }
}

// ---------------------------------------------------------------------------
// guardTenantStorageWrite
// ---------------------------------------------------------------------------

/**
 * Enforce that the current caller may write to a given PVE storage:
 * - super admins (no vDC scope) pass through unchanged
 * - tenants must target a storage listed in their vDC AND whose backend is
 *   not shared (ceph/nfs/cifs leak content across tenants).
 * Returns a Response (403) when blocked, null when allowed.
 */
export async function guardTenantStorageWrite(
  connId: string,
  storage: string
): Promise<Response | null> {
  const { getCurrentTenantId } = await import('@/lib/tenant')
  const { NextResponse } = await import('next/server')
  const { getConnectionById } = await import('@/lib/connections/getConnection')
  const { pveFetch } = await import('@/lib/proxmox/client')
  const { getTenantInfrastructureScope } = await import('@/lib/tenant/infraScope')

  const infra = await getTenantInfrastructureScope(await getCurrentTenantId())
  // Provider: no restriction.
  if (infra.kind === 'provider') return null
  // MSP: the tenant owns the whole (dedicated) cluster — any storage on an
  // owned connection is writable, including shared backends (no cross-tenant
  // leak on a dedicated cluster).
  if (infra.kind === 'msp') {
    return infra.connectionIds.has(connId)
      ? null
      : NextResponse.json({ error: 'Storage not accessible' }, { status: 403 })
  }

  // iaas: existing vDC logic (must target a storage in the vDC and a non-shared backend).
  const scope = infra.vdcScope
  const allowed = scope.storagesByConnection.get(connId)
  if (!allowed || !allowed.has(storage)) {
    return NextResponse.json({ error: 'Storage not accessible' }, { status: 403 })
  }

  const conn = await getConnectionById(connId)
  try {
    const config = await pveFetch<any>(conn, `/storage/${encodeURIComponent(storage)}`)
    if (config?.shared === 1 || config?.shared === true) {
      return NextResponse.json(
        { error: 'Shared storages are not writable from a tenant' },
        { status: 403 }
      )
    }
  } catch {
    return NextResponse.json({ error: 'Storage not accessible' }, { status: 403 })
  }

  return null
}

// ---------------------------------------------------------------------------
// assertVdcPbsAccess
// ---------------------------------------------------------------------------

export type VdcPbsAccess =
  | { kind: 'admin' }
  | { kind: 'tenant'; allowed: ReadonlyArray<{ datastore: string; namespace: string }> }

/**
 * Authorise the current caller to interact with a PBS connection:
 * - super admins (no vDC scope) → { kind: 'admin' }, route handlers behave as before.
 * - tenants with at least one binding on this PBS → { kind: 'tenant', allowed }
 *   carrying their (datastore, namespace) tuples; route handlers MUST filter
 *   any returned data through this list.
 * - any other tenant → 403 Response (return it directly from the route).
 *
 * Designed for read paths in /api/v1/pbs/[id]/... where vDC tenants need
 * cross-tenant access to provider-owned PBS connections, restricted to their
 * authorised namespaces.
 */
export async function assertVdcPbsAccess(connId: string): Promise<VdcPbsAccess | Response> {
  const { getCurrentTenantId } = await import('@/lib/tenant')
  const { NextResponse } = await import('next/server')
  const { getTenantInfrastructureScope } = await import('@/lib/tenant/infraScope')

  const infra = await getTenantInfrastructureScope(await getCurrentTenantId())
  if (infra.kind === 'provider') return { kind: 'admin' }
  // MSP: owns the PBS connection directly → full (admin-like) access, no
  // namespace filtering (dedicated cluster).
  if (infra.kind === 'msp') {
    return infra.connectionIds.has(connId)
      ? { kind: 'admin' }
      : NextResponse.json({ error: 'PBS not accessible for this tenant' }, { status: 403 })
  }

  // iaas: existing namespace logic.
  const scope = infra.vdcScope
  const allowed = scope.pbsNamespacesByConnection.get(connId)
  if (!allowed || allowed.length === 0) {
    return NextResponse.json({ error: 'PBS not accessible for this tenant' }, { status: 403 })
  }

  return { kind: 'tenant', allowed }
}

// ---------------------------------------------------------------------------
// clearVdcScopeCache
// ---------------------------------------------------------------------------

/**
 * Clears the in-memory vDC scope cache.
 *
 * Call this when vDCs are created, updated, or deleted to ensure the next
 * scope resolution picks up the latest state.
 *
 * @param tenantId  Optional. If provided, only the cache for that tenant is cleared.
 *                  If omitted, the entire cache is flushed.
 */
export function clearVdcScopeCache(tenantId?: string): void {
  if (tenantId) {
    scopeCache.delete(tenantId)
  } else {
    scopeCache.clear()
  }
}
