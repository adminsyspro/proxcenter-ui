// Live check that a write token's creator still holds the rights of the scope
// being used (Proxmox-like model): a token never outlives its creator's rights.
// Verdicts (true and false) are cached in-process for 60 s per token+scope, so
// a revoked right takes at most one TTL to bite. Under control-plane HA each
// node keeps its own cache (accepted, same as the rate limiter).
import { prisma } from "@/lib/db/prisma"
import { holdsBroadPermission, isUserSuperAdmin } from "@/lib/rbac"
import { userHasAccessToTenant } from "@/lib/tenant"

import { isWriteScope, WRITE_SCOPE_DEFINITIONS } from "./scopes"

const TTL_MS = 60_000

type CreatorToken = {
  tokenId: string
  tenantId: string
  creatorUserId: string | null
  connectionIds: string[] | null
}

const cache = new Map<string, { verdict: boolean; expiresAt: number }>()
let lastSweepAt = 0

/** Evict expired verdicts, at most once per TTL. */
function sweep(nowMs: number): void {
  if (nowMs - lastSweepAt < TTL_MS) return
  lastSweepAt = nowMs
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= nowMs) cache.delete(key)
  }
}

async function compute(token: CreatorToken, scopeId: string): Promise<boolean> {
  if (!token.creatorUserId || !isWriteScope(scopeId)) return false
  const keys = WRITE_SCOPE_DEFINITIONS[scopeId]
  if (!keys) return false

  const userId = token.creatorUserId
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { enabled: true } })
  if (!user || user.enabled === false) return false

  // A super admin passes every step (holdsBroadPermission is true for them too).
  if (await isUserSuperAdmin(userId)) return true

  if (!(await userHasAccessToTenant(userId, token.tenantId))) return false

  for (const key of keys) {
    if (!(await holdsBroadPermission(userId, token.tenantId, key, token.connectionIds))) return false
  }
  return true
}

export async function creatorStillHolds(token: CreatorToken, scopeId: string): Promise<boolean> {
  const now = Date.now()
  sweep(now)
  const cacheKey = `${token.tokenId}:${scopeId}`
  const hit = cache.get(cacheKey)
  if (hit && hit.expiresAt > now) return hit.verdict
  const verdict = await compute(token, scopeId)
  cache.set(cacheKey, { verdict, expiresAt: now + TTL_MS })
  return verdict
}

export function _resetCreatorCheckCache(): void {
  cache.clear()
  lastSweepAt = 0
}
