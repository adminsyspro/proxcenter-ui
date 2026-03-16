import { prisma } from "@/lib/db/prisma"
import { decryptSecret } from "@/lib/crypto/secret"
import { getCurrentTenantId } from "@/lib/tenant"

export type PveConn = {
  id: string
  name: string
  baseUrl: string
  apiToken: string
  insecureDev: boolean
  behindProxy: boolean
}

export type PbsConn = {
  id: string
  name: string
  baseUrl: string
  apiToken: string
  insecureDev: boolean
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

  const resolvedTenantId = tenantId ?? await getCurrentTenantId()

  const cacheKey = `${resolvedTenantId}:${id}`
  const cached = connectionCache.get(cacheKey)
  if (cached && cached.expiry > Date.now()) {
    return cached.data as PveConn
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

  // Tenant isolation: always verify the connection belongs to the requesting tenant
  if (c.tenantId !== resolvedTenantId) {
    throw new Error(`Connection not found: ${id}`)
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
  }

  connectionCache.set(cacheKey, { data: result, expiry: Date.now() + CACHE_TTL })

  return result
}

export async function getPbsConnectionById(id: string, tenantId?: string): Promise<PbsConn> {
  if (!id) throw new Error("Missing PBS connection id")

  const resolvedTenantId = tenantId ?? await getCurrentTenantId()

  const cacheKey = `pbs:${resolvedTenantId}:${id}`
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
      tenantId: true,
    },
  })

  if (!c) throw new Error(`PBS Connection not found: ${id}`)

  // Tenant isolation: always verify the connection belongs to the requesting tenant
  if (c.tenantId !== resolvedTenantId) {
    throw new Error(`PBS Connection not found: ${id}`)
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
  }

  connectionCache.set(cacheKey, { data: result, expiry: Date.now() + CACHE_TTL })

  return result
}
