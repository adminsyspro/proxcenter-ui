// src/lib/vdc/scope.ts
// vDC Scope Resolver & Cluster Filter
//
// Resolves which nodes/storages/pools a tenant is allowed to see based on
// their vDC assignments, and provides a filter function for cluster data.

import { prisma } from '@/lib/db/prisma'
import { isSharedStorage } from '@/lib/proxmox/storage'
import { DEFAULT_TENANT_ID } from '@/lib/tenant'

import { clearVdcContextCache, getVdcContext } from './context'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VdcStoragePolicyInfo {
  policyId: string
  name: string
  iopsRd: number | null
  iopsWr: number | null
  mbpsRd: number | null
  mbpsWr: number | null
}

export interface VdcScope {
  /** PVE connection IDs referenced by the tenant's vDCs */
  connectionIds: Set<string>
  /** PBS connection IDs the tenant has at least one vDC binding on */
  pbsConnectionIds: Set<string>
  /** Per-connection: allowed node names */
  nodesByConnection: Map<string, Set<string>>
  /** Per-connection: storage IDs the tenant may SEE (writable ones plus read-only ISO libraries) */
  storagesByConnection: Map<string, Set<string>>
  /** Per-connection: storage IDs the tenant may WRITE to (primary, storage policies, PBS pseudo-storages) */
  writableStoragesByConnection: Map<string, Set<string>>
  /** Per-connection: read-only ISO library storages granted to the tenant (#894) */
  isoLibrariesByConnection: Map<string, Set<string>>
  /** Per-connection: ISO libraries where the tenant may upload/delete its own `custom-<slug>-*` files */
  uploadLibrariesByConnection: Map<string, Set<string>>
  /** Per-connection: policied storages and their QoS caps */
  storagePoliciesByConnection: Map<string, Map<string, VdcStoragePolicyInfo>>
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

/**
 * Storages a tenant may WRITE to on a connection: primary VM-disk storage,
 * storage-policy tiers and PBS pseudo-storages, never a read-only ISO
 * library (#894). A scope built before the writable map existed (older
 * fixtures) falls back to the visible set, which is the pre-#894 contract.
 */
export function writableStoragesFor(scope: VdcScope, connId: string): Set<string> {
  return scope.writableStoragesByConnection?.get(connId)
    ?? scope.storagesByConnection.get(connId)
    ?? new Set<string>()
}

/** 403 body for a write aimed at a storage the tenant only reaches as an ISO library. */
export function readOnlyLibraryError(storage: string): string {
  return `Storage "${storage}" is a read-only ISO library`
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
 *
 * Rule of thumb for callers: an allow/deny verdict or anything feeding
 * enforcement resolves the UNION ({ ignoreVdcContext: true }); anything
 * shaping a user-visible list follows the context (default).
 */
export async function getVdcScope(
  tenantId: string,
  opts?: {
    /**
     * Authorization callers (ownership checks, token scoping) must see the
     * tenant's FULL union regardless of the view context — a deep link to a
     * vDC-B object keeps working while the browser is in context A (design
     * ruling: the cookie is a view filter, not a security boundary).
     */
    ignoreVdcContext?: boolean
  }
): Promise<VdcScope | null> {
  // Default tenant = provider, no filtering
  if (tenantId === DEFAULT_TENANT_ID) return null

  // Resolve the vDC view context (null = union). Fail-open by contract.
  const vdcContext = opts?.ignoreVdcContext ? null : await getVdcContext(tenantId)

  // Check cache — keyed per (tenant, context) so a narrowed scope can never
  // be served to the union view or to another context.
  const cacheKey = `${tenantId}::${vdcContext ?? 'all'}`
  const now = Date.now()
  const cached = scopeCache.get(cacheKey)

  if (cached && cached.expiry > now) {
    return cached.data
  }

  // Build scope from DB
  const scope = await buildVdcScope(tenantId, vdcContext)

  // Cache the result
  scopeCache.set(cacheKey, { data: scope, expiry: now + CACHE_TTL_MS })

  return scope
}

// ---------------------------------------------------------------------------
// buildVdcScope (internal)
// ---------------------------------------------------------------------------

async function buildVdcScope(tenantId: string, vdcContext: string | null = null): Promise<VdcScope> {
  // 1. Find all enabled vDCs for this tenant + their child rows in a single
  //    Prisma query (replaces the SQLite N+1 prepared-statement loop).
  //    With a vDC view context, restrict to that single vDC — tenantId stays
  //    in the where so a forged foreign id yields zero rows (deny-by-
  //    construction empty scope, same contract as a vDC-less tenant).
  const vdcRows = await prisma.vdc.findMany({
    where: { tenantId, enabled: true, ...(vdcContext ? { id: vdcContext } : {}) },
    select: {
      id: true,
      connectionId: true,
      pvePoolName: true,
      primaryStorage: true,
      nodes: { select: { nodeName: true } },
      storages: { select: { storageId: true } },
      isoLibraries: { select: { storageId: true, allowUploads: true } },
      vnets: { select: { pveName: true } },
      sharedBridges: { select: { bridge: true } },
      pbsNamespaces: { select: { pbsConnectionId: true, datastore: true, namespace: true } },
      storagePolicies: {
        select: {
          policy: {
            select: { id: true, name: true, storageId: true, iopsRd: true, iopsWr: true, mbpsRd: true, mbpsWr: true },
          },
        },
      },
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
  const writableStoragesByConnection = new Map<string, Set<string>>()
  const isoLibrariesByConnection = new Map<string, Set<string>>()
  const uploadLibrariesByConnection = new Map<string, Set<string>>()
  const storagePoliciesByConnection = new Map<string, Map<string, VdcStoragePolicyInfo>>()
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
    if (!writableStoragesByConnection.has(connId)) writableStoragesByConnection.set(connId, new Set())
    if (!isoLibrariesByConnection.has(connId)) isoLibrariesByConnection.set(connId, new Set())
    if (!uploadLibrariesByConnection.has(connId)) uploadLibrariesByConnection.set(connId, new Set())
    const visible = storagesByConnection.get(connId)!
    const writable = writableStoragesByConnection.get(connId)!
    if (row.primaryStorage) { visible.add(row.primaryStorage); writable.add(row.primaryStorage) }
    for (const sr of row.storages) {
      visible.add(sr.storageId); writable.add(sr.storageId)
    }
    // ISO libraries (#894) are visible so the CD/DVD pickers and the content
    // route accept them, but deliberately NOT writable: uploads, deletions
    // and data disks on them are refused downstream.
    for (const lib of row.isoLibraries ?? []) {
      visible.add(lib.storageId)
      isoLibrariesByConnection.get(connId)!.add(lib.storageId)
      if (lib.allowUploads) uploadLibrariesByConnection.get(connId)!.add(lib.storageId)
    }

    // Storage policies: their storages join the visible/authorised storage
    // set, and the QoS caps go to a parallel per-storage map. QoS is
    // unambiguous connection-wide (one policy per (connection, storage)),
    // so merging across the tenant's vDCs cannot conflict; the per-vDC
    // quota deliberately does NOT live here (resolveVdcForTenant owns it).
    if (!storagePoliciesByConnection.has(connId)) storagePoliciesByConnection.set(connId, new Map())
    for (const sp of row.storagePolicies) {
      storagesByConnection.get(connId)!.add(sp.policy.storageId)
      writableStoragesByConnection.get(connId)!.add(sp.policy.storageId)
      storagePoliciesByConnection.get(connId)!.set(sp.policy.storageId, {
        policyId: sp.policy.id,
        name: sp.policy.name,
        iopsRd: sp.policy.iopsRd ?? null,
        iopsWr: sp.policy.iopsWr ?? null,
        mbpsRd: sp.policy.mbpsRd ?? null,
        mbpsWr: sp.policy.mbpsWr ?? null,
      })
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
    writableStoragesByConnection,
    isoLibrariesByConnection,
    uploadLibrariesByConnection,
    storagePoliciesByConnection,
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
/** Filename prefix a tenant's own uploads carry, mirroring POST /custom-images. */
export function tenantUploadPrefix(tenantId: string, slug: string | null | undefined): string {
  return `custom-${slug || tenantId.replace(/[^a-z0-9-]/gi, '').toLowerCase()}-`
}

export type UploadOwner = { kind: 'provider' } | { kind: 'tenant'; slug: string } | { kind: 'unknown' }

/**
 * Who owns a file on a storage shared between tenants, from its name alone
 * (PVE keeps no per-file metadata). Files without the `custom-` prefix are
 * the provider's catalogue. A `custom-<slug>-…` file belongs to the tenant
 * whose slug is the LONGEST match, so `custom-acme-prod-x.iso` is `acme-prod`'s
 * and never `acme`'s; a prefix matching no known slug is `unknown` and is
 * treated as nobody's (hidden, never writable).
 */
export function resolveUploadOwner(filename: string, slugs: Iterable<string>): UploadOwner {
  const base = String(filename ?? '').split('/').pop() ?? ''
  if (!base.startsWith('custom-')) return { kind: 'provider' }
  let best: string | null = null
  for (const s of slugs) {
    if (s && base.startsWith(`custom-${s}-`) && (best === null || s.length > best.length)) best = s
  }
  return best ? { kind: 'tenant', slug: best } : { kind: 'unknown' }
}

/** Slug of the current tenant plus every slug of the platform, for ownership resolution. */
export async function loadTenantSlugs(tenantId: string): Promise<{ mine: string; all: string[] }> {
  const rows = await prisma.tenant.findMany({ select: { id: true, slug: true } })
  const mine = rows.find(r => r.id === tenantId)?.slug || tenantId.replace(/[^a-z0-9-]/gi, '').toLowerCase()
  // `mine` may be the id-derived fallback of a tenant without a slug: it must
  // still count as a known owner, or its own files would resolve to `unknown`.
  const all = new Set(rows.map(r => r.slug).filter(Boolean) as string[])
  all.add(mine)
  return { mine, all: [...all] }
}

/** True when the tenant reaches `storage` only through an ISO library grant. */
export function isLibraryOnlyStorage(scope: VdcScope, connId: string, storage: string): boolean {
  if (!scope.isoLibrariesByConnection?.get(connId)?.has(storage)) return false
  const writable = scope.writableStoragesByConnection?.get(connId) ?? scope.storagesByConnection.get(connId) ?? new Set<string>()
  return !writable.has(storage)
}

/**
 * The name a file uploaded by the current caller must carry on `storage`.
 * On an ISO library that allows uploads, an iaas tenant's file is namespaced
 * with `custom-<slug>-` when it is not already (the storage browser sends the
 * raw file name), so the guard accepts it and the provider catalogue can never
 * be shadowed. Everywhere else the name is returned unchanged.
 */
export async function tenantUploadFilename(connId: string, storage: string, filename: string): Promise<string> {
  const { getCurrentTenantId } = await import('@/lib/tenant')
  const { getTenantInfrastructureScope } = await import('@/lib/tenant/infraScope')
  const base = String(filename ?? '').split('/').pop() ?? ''
  if (!base) return filename
  const tenantId = await getCurrentTenantId()
  const infra = await getTenantInfrastructureScope(tenantId, { ignoreVdcContext: true })
  if (infra.kind !== 'iaas') return filename
  const scope = infra.vdcScope
  const writable = scope.writableStoragesByConnection?.get(connId) ?? scope.storagesByConnection.get(connId) ?? new Set<string>()
  if (writable.has(storage) || !scope.uploadLibrariesByConnection?.get(connId)?.has(storage)) return filename
  const { mine, all } = await loadTenantSlugs(tenantId)
  const owner = resolveUploadOwner(base, all)
  // Already ours: keep. Anything else (provider-looking, another tenant's
  // prefix, unknown prefix) gets our namespace in front; the guard then
  // re-checks ownership, so a name colliding with a longer slug still 403s.
  if (owner.kind === 'tenant' && owner.slug === mine) return base
  return `${tenantUploadPrefix(tenantId, mine)}${base}`
}

export async function guardTenantStorageWrite(
  connId: string,
  storage: string,
  opts: { filename?: string | null; content?: string | null } = {},
): Promise<Response | null> {
  const { getCurrentTenantId } = await import('@/lib/tenant')
  const { NextResponse } = await import('next/server')
  const { getConnectionById } = await import('@/lib/connections/getConnection')
  const { pveFetch } = await import('@/lib/proxmox/client')
  const { getTenantInfrastructureScope } = await import('@/lib/tenant/infraScope')

  // Authorization verdict (design ruling §5): judged against the tenant's
  // FULL union — the view context must not turn a legitimate access into a 403.
  const tenantId = await getCurrentTenantId()
  const infra = await getTenantInfrastructureScope(tenantId, {
    ignoreVdcContext: true,
  })
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
  // A storage the tenant only reaches as an ISO library (#894) is read-only,
  // unless the grant allows uploads: then the tenant may write or delete ITS
  // OWN files only, recognised by the `custom-<slug>-` prefix that keeps them
  // apart from the provider catalogue and from other tenants' uploads. The
  // shared-backend refusal below does not apply there, the prefix does the
  // isolation; a caller that cannot name the file fails closed.
  const writable = scope.writableStoragesByConnection?.get(connId) ?? allowed
  if (!writable.has(storage)) {
    if (scope.uploadLibrariesByConnection?.get(connId)?.has(storage)) {
      const filename = String(opts.filename ?? '').split('/').pop() ?? ''
      if (!filename) {
        return NextResponse.json({ error: 'This storage is a read-only ISO library' }, { status: 403 })
      }
      // Only ISO content may land on a library: other types are not
      // ownership-filtered anywhere and would leak to every grantee.
      if (opts.content !== undefined && opts.content !== null && String(opts.content) !== 'iso') {
        return NextResponse.json({ error: 'Only ISO images can be written to an ISO library' }, { status: 403 })
      }
      const { mine, all } = await loadTenantSlugs(tenantId)
      const owner = resolveUploadOwner(filename, all)
      if (owner.kind !== 'tenant' || owner.slug !== mine) {
        const hint = owner.kind === 'tenant'
          ? `"${filename}" falls in another tenant's namespace (custom-${owner.slug}-), rename it`
          : `files on this ISO library must be named custom-${mine}-<name> to be yours`
        return NextResponse.json(
          { error: `${hint}; the provider catalogue and other tenants' files cannot be changed` },
          { status: 403 },
        )
      }
      return null
    }
    return NextResponse.json({ error: 'This storage is a read-only ISO library' }, { status: 403 })
  }

  const conn = await getConnectionById(connId)
  try {
    const config = await pveFetch<any>(conn, `/storage/${encodeURIComponent(storage)}`)
    if (isSharedStorage({ shared: config?.shared, type: config?.type })) {
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

  // Authorization verdict (design ruling §5): judged against the tenant's
  // FULL union — the view context must not turn a legitimate access into a 403.
  const infra = await getTenantInfrastructureScope(await getCurrentTenantId(), {
    ignoreVdcContext: true,
  })
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
    // Keys are `${tenantId}::${vdcId | 'all'}` — purge every context entry.
    const prefix = `${tenantId}::`
    for (const key of scopeCache.keys()) {
      if (key.startsWith(prefix)) scopeCache.delete(key)
    }
    clearVdcContextCache(tenantId)
  } else {
    scopeCache.clear()
    clearVdcContextCache()
  }
}
