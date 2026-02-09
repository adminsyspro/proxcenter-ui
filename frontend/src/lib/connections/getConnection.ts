import { prisma } from "@/lib/db/prisma"
import { decryptSecret } from "@/lib/crypto/secret"

export type PveConn = {
  id: string
  name: string
  baseUrl: string
  apiToken: string
  insecureDev: boolean
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
  if (id) connectionCache.delete(id)
  else connectionCache.clear()
}

export async function getConnectionById(id: string): Promise<PveConn> {
  if (!id) throw new Error("Missing connection id")

  // IMPORTANT: plus de fallback env, puisque tu as supprimé PVE_* de .env.local
  if (id === "default") {
    throw new Error('Default connection is not configured. Create a connection in SQLite (POST /api/v1/connections).')
  }

  const cached = connectionCache.get(id)
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
      insecureTLS: true,
      apiTokenEnc: true,
    },
  })

  if (!c) throw new Error(`Connection not found: ${id}`)
  if (!c.baseUrl) throw new Error(`Connection ${id} has no baseUrl`)
  if (!c.apiTokenEnc) throw new Error(`Connection ${id} has no apiTokenEnc`)

  const result: PveConn = {
    id: c.id,
    name: c.name,
    baseUrl: c.baseUrl,
    apiToken: decryptSecret(c.apiTokenEnc),
    insecureDev: !!c.insecureTLS,
  }

  connectionCache.set(id, { data: result, expiry: Date.now() + CACHE_TTL })

  return result
}

export async function getPbsConnectionById(id: string): Promise<PbsConn> {
  if (!id) throw new Error("Missing PBS connection id")

  const cacheKey = `pbs:${id}`
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
