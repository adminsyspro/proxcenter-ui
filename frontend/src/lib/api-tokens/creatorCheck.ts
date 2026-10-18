// Live check that a write token's creator still holds the rights of the scope
// being used, and of the secondary permissions its handler may check
// (Proxmox-like model): a token never outlives its creator's rights.
// Verdicts (true and false) are cached in-process for 60 s per token+scope or
// token+permission, so a revoked right takes at most one TTL to bite. Under
// control-plane HA each node keeps its own cache (accepted, same as the rate
// limiter).
import { prisma } from "@/lib/db/prisma"
import { holdsBroadPermission, isUserSuperAdmin } from "@/lib/rbac"
import { userHasAccessToTenant } from "@/lib/tenant"

import { holdsWriteScope } from "./grantable"
import { isWriteScope } from "./scopes"

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

/**
 * The creator still exists, is enabled, and (unless super admin) can still
 * reach the token tenant; then `holds` decides on the right itself.
 */
async function creatorPasses(token: CreatorToken, holds: (userId: string) => Promise<boolean>): Promise<boolean> {
  if (!token.creatorUserId) return false
  const userId = token.creatorUserId
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { enabled: true } })
  if (!user || user.enabled === false) return false

  // A super admin passes every step (holdsBroadPermission is true for them too).
  if (await isUserSuperAdmin(userId)) return true

  if (!(await userHasAccessToTenant(userId, token.tenantId))) return false

  return holds(userId)
}

async function cachedVerdict(cacheKey: string, compute: () => Promise<boolean>): Promise<boolean> {
  const now = Date.now()
  sweep(now)
  const hit = cache.get(cacheKey)
  if (hit && hit.expiresAt > now) return hit.verdict
  const verdict = await compute()
  cache.set(cacheKey, { verdict, expiresAt: now + TTL_MS })
  return verdict
}

/** Whether the creator still holds every permission key of the write scope `scopeId`. */
export function creatorStillHolds(token: CreatorToken, scopeId: string): Promise<boolean> {
  return cachedVerdict(`${token.tokenId}:${scopeId}`, async () =>
    isWriteScope(scopeId) &&
    creatorPasses(token, userId => holdsWriteScope(userId, token.tenantId, scopeId, token.connectionIds)))
}

/**
 * Whether the creator still holds the single permission `key` broadly: a
 * secondary permission an entry's handler may check beyond its scope.
 */
export function creatorStillHoldsPermission(token: CreatorToken, key: string): Promise<boolean> {
  return cachedVerdict(`${token.tokenId}:permission:${key}`, () =>
    creatorPasses(token, userId => holdsBroadPermission(userId, token.tenantId, key, token.connectionIds)))
}

export function _resetCreatorCheckCache(): void {
  cache.clear()
  lastSweepAt = 0
}
