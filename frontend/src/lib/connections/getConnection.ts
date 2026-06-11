import { prisma } from "@/lib/db/prisma"
import { decryptSecret } from "@/lib/crypto/secret"
import { getCurrentTenantId } from "@/lib/tenant"
import { DEFAULT_TENANT_ID } from "@/lib/tenant/constants"

export type PveConn = {
  id: string
  name: string
  baseUrl: string
  apiToken: string
  insecureDev: boolean
  behindProxy: boolean
  /** Owning tenant of the connection row (set by getConnectionById). */
  tenantId?: string
}

export type PbsConn = {
  id: string
  name: string
  baseUrl: string
  apiToken: string
  insecureDev: boolean
  /** Owning tenant of the connection row (set by getPbsConnectionById). */
  tenantId?: string
}

/**
 * Provider (NOC) fleet-access guard for cross-tenant rows resolved from the
 * SESSION tenant. The provider supervises the whole fleet including MSP-owned
 * connections (A1 fleet-scope decision), but a narrowly scoped default-tenant
 * user (node/vm/tag/pool grants only) must not reach client-owned rows: the
 * session caller needs a connection-scoped view grant. Internal callers that
 * pass an explicit tenantId (fleet enumeration, pollers, DRS, failover) are
 * trusted and never hit this. Denials throw the same not-found error as a
 * missing row so connection ids cannot be enumerated.
 */
async function assertProviderFleetViewFromSession(id: string, kind: "pve" | "pbs"): Promise<void> {
  // Dynamic import: keeps the RBAC/session stack out of this module's load
  // path for the many non-request callers.
  const { checkPermission, PERMISSIONS } = await import("@/lib/rbac")
  const denied =
    kind === "pbs"
      ? await checkPermission(PERMISSIONS.BACKUP_VIEW, "pbs", id)
      : await checkPermission(PERMISSIONS.CONNECTION_VIEW, "connection", id)
  // 401 = no session at all: a background/internal caller (poller, detached
  // migration pipeline) rather than a scoped user, so trusted server code
  // passes. This cannot be reached by an unauthenticated HTTP caller: the
  // global middleware (src/middleware.ts) returns 401 for any /api request
  // without a valid JWT before route handlers run, so sessionless execution
  // here can only be non-request server code. The guard bounds AUTHENTICATED
  // users (403 = authenticated but lacking the grant).
  if (denied && denied.status !== 401) {
    throw new Error(
      kind === "pbs" ? `PBS Connection not found: ${id}` : `Connection not found: ${id}`
    )
  }
}

/** Whether a session-tenant caller is crossing into another tenant's row. */
function isCrossTenantFromSession(
  rowTenantId: string | undefined,
  resolvedTenantId: string,
  explicitTenant: boolean
): boolean {
  return (
    !explicitTenant &&
    resolvedTenantId === DEFAULT_TENANT_ID &&
    (rowTenantId ?? DEFAULT_TENANT_ID) !== DEFAULT_TENANT_ID
  )
}

// In-memory cache for connections
const connectionCache = new Map<string, { data: PveConn | PbsConn; expiry: number }>()
const CACHE_TTL = 60_000 // 60 seconds

export function invalidateConnectionCache(id?: string) {
  if (id) {
    // Cache keys are now tenantId:id — iterate and delete all matching entries for this id
    for (const key of connectionCache.keys()) {
      if (key === id || key.endsWith(`:${id}`)) {
        connectionCache.delete(key)
      }
    }
  } else {
    connectionCache.clear()
  }
}

export async function getConnectionById(id: string, tenantId?: string): Promise<PveConn> {
  if (!id) throw new Error("Missing connection id")

  // IMPORTANT: plus de fallback env, puisque tu as supprimé PVE_* de .env.local
  if (id === "default") {
    throw new Error('Default connection is not configured. Create a connection in SQLite (POST /api/v1/connections).')
  }

  const explicitTenant = tenantId !== undefined
  const resolvedTenantId = tenantId ?? await getCurrentTenantId()

  const cacheKey = `${resolvedTenantId}:${id}`
  const cached = connectionCache.get(cacheKey)
  if (cached && cached.expiry > Date.now()) {
    // The cache is keyed per tenant, not per user: re-assert the provider
    // fleet guard for session callers so an entry cached by an authorized NOC
    // user is not served to a narrowly scoped one.
    const row = cached.data as PveConn
    if (isCrossTenantFromSession(row.tenantId, resolvedTenantId, explicitTenant)) {
      await assertProviderFleetViewFromSession(id, "pve")
    }
    return row
  }

  const c = await prisma.connection.findUnique({
    where: { id },

    // on SELECT uniquement ce qu'il faut, mais on inclut bien baseUrl
    select: {
      id: true,
      name: true,
      baseUrl: true,
      behindProxy: true,
      insecureTLS: true,
      apiTokenEnc: true,
      tenantId: true,
    },
  })

  if (!c) throw new Error(`Connection not found: ${id}`)

  // Tenant isolation: the provider (NOC, = the default tenant) supervises the
  // whole fleet including MSP-owned connections (A1 fleet-scope decision); its
  // session callers still need a connection-scoped view grant (see
  // assertProviderFleetViewFromSession). Any OTHER tenant must own the
  // connection OR hold a vDC assignment on it.
  if (c.tenantId !== resolvedTenantId) {
    if (resolvedTenantId === DEFAULT_TENANT_ID) {
      if (!explicitTenant) {
        await assertProviderFleetViewFromSession(id, "pve")
      }
    } else {
      const vdcAccess = await prisma.vdc.findFirst({
        where: { tenantId: resolvedTenantId, connectionId: id, enabled: true },
        select: { id: true },
      })
      if (!vdcAccess) {
        throw new Error(`Connection not found: ${id}`)
      }
    }
  }

  if (!c.baseUrl) throw new Error(`Connection ${id} has no baseUrl`)
  if (!c.apiTokenEnc) throw new Error(`Connection ${id} has no apiTokenEnc`)

  const result: PveConn = {
    id: c.id,
    name: c.name,
    baseUrl: c.baseUrl,
    apiToken: decryptSecret(c.apiTokenEnc),
    insecureDev: !!c.insecureTLS,
    behindProxy: !!c.behindProxy,
    tenantId: c.tenantId,
  }

  connectionCache.set(cacheKey, { data: result, expiry: Date.now() + CACHE_TTL })

  return result
}


/**
 * Loads a PBS connection by id WITHOUT tenant ownership check.
 *
 * Use only when the caller has already validated the requester's right to
 * reach this PBS via another mechanism (e.g. presence of a vDC binding on
 * (pbsConnectionId, datastore, namespace) for the current tenant). The
 * regular getPbsConnectionById rejects cross-tenant lookups, which breaks
 * vDC tenants who legitimately read backups from a provider-owned PBS.
 */
export async function getPbsConnectionByIdUnscoped(id: string): Promise<PbsConn> {
  if (!id) throw new Error("Missing PBS connection id")

  const cacheKey = `pbs-unscoped:${id}`
  const cached = connectionCache.get(cacheKey)
  if (cached && cached.expiry > Date.now()) {
    return cached.data as PbsConn
  }

  const c = await prisma.connection.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      type: true,
      baseUrl: true,
      insecureTLS: true,
      apiTokenEnc: true,
    },
  })

  if (!c) throw new Error(`PBS Connection not found: ${id}`)
  if (c.type !== 'pbs') throw new Error(`Connection ${id} is not a PBS connection`)
  if (!c.baseUrl) throw new Error(`PBS Connection ${id} has no baseUrl`)
  if (!c.apiTokenEnc) throw new Error(`PBS Connection ${id} has no apiTokenEnc`)

  const result: PbsConn = {
    id: c.id,
    name: c.name,
    baseUrl: c.baseUrl,
    apiToken: decryptSecret(c.apiTokenEnc),
    insecureDev: !!c.insecureTLS,
  }

  connectionCache.set(cacheKey, { data: result, expiry: Date.now() + CACHE_TTL })

  return result
}

export async function getPbsConnectionById(id: string, tenantId?: string): Promise<PbsConn> {
  if (!id) throw new Error("Missing PBS connection id")

  const explicitTenant = tenantId !== undefined
  const resolvedTenantId = tenantId ?? await getCurrentTenantId()

  const cacheKey = `pbs:${resolvedTenantId}:${id}`
  const cached = connectionCache.get(cacheKey)
  if (cached && cached.expiry > Date.now()) {
    // Per-tenant cache, not per-user: re-assert the provider fleet guard for
    // session callers (see getConnectionById).
    const row = cached.data as PbsConn
    if (isCrossTenantFromSession(row.tenantId, resolvedTenantId, explicitTenant)) {
      await assertProviderFleetViewFromSession(id, "pbs")
    }
    return row
  }

  const c = await prisma.connection.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      type: true,
      baseUrl: true,
      insecureTLS: true,
      apiTokenEnc: true,
      tenantId: true,
    },
  })

  if (!c) throw new Error(`PBS Connection not found: ${id}`)

  // Tenant isolation: the provider (NOC, = the default tenant) supervises the
  // whole fleet including MSP-owned PBS connections (A1 fleet-scope decision);
  // its session callers still need a pbs-scoped view grant (see
  // assertProviderFleetViewFromSession). Any OTHER tenant must own the
  // connection OR have it referenced by one of its vDC PBS bindings. The
  // latter lets tenants reach provider-owned PBS connections through their
  // vDC scope (mirrors the assertVdcPbsAccess pattern used in the backups
  // route).
  if (c.tenantId !== resolvedTenantId) {
    if (resolvedTenantId === DEFAULT_TENANT_ID) {
      if (!explicitTenant) {
        await assertProviderFleetViewFromSession(id, "pbs")
      }
    } else {
      const { getVdcScope } = await import('@/lib/vdc/scope')
      const scope = await getVdcScope(resolvedTenantId)
      if (!scope || !scope.pbsConnectionIds.has(id)) {
        throw new Error(`PBS Connection not found: ${id}`)
      }
    }
  }

  if (c.type !== 'pbs') throw new Error(`Connection ${id} is not a PBS connection`)
  if (!c.baseUrl) throw new Error(`PBS Connection ${id} has no baseUrl`)
  if (!c.apiTokenEnc) throw new Error(`PBS Connection ${id} has no apiTokenEnc`)

  const result: PbsConn = {
    id: c.id,
    name: c.name,
    baseUrl: c.baseUrl,
    apiToken: decryptSecret(c.apiTokenEnc),
    insecureDev: !!c.insecureTLS,
    tenantId: c.tenantId,
  }

  connectionCache.set(cacheKey, { data: result, expiry: Date.now() + CACHE_TTL })

  return result
}
