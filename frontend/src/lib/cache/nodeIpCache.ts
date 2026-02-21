/**
 * In-memory cache of cluster node IPs per connection.
 * Populated by the nodes API route, consumed by pveFetch failover.
 * Uses globalThis to survive Next.js hot-reload.
 */

type NodeIpEntry = {
  ips: string[]
  port: number
  protocol: string
  timestamp: number
}

type FailoverLockEntry = {
  promise: Promise<string | null>
  timestamp: number
}

const CACHE_KEY = "__proxcenter_node_ip_cache__" as const
const LOCK_KEY = "__proxcenter_failover_lock__" as const
const TTL_MS = 10 * 60 * 1_000 // 10 minutes
const LOCK_TTL_MS = 30_000 // 30 seconds

function getStore(): Map<string, NodeIpEntry> {
  if (!(globalThis as any)[CACHE_KEY]) {
    ;(globalThis as any)[CACHE_KEY] = new Map<string, NodeIpEntry>()
  }
  return (globalThis as any)[CACHE_KEY]
}

function getLockStore(): Map<string, FailoverLockEntry> {
  if (!(globalThis as any)[LOCK_KEY]) {
    ;(globalThis as any)[LOCK_KEY] = new Map<string, FailoverLockEntry>()
  }
  return (globalThis as any)[LOCK_KEY]
}

/** Store known node IPs for a connection */
export function setNodeIps(connId: string, ips: string[], port: number, protocol: string): void {
  const store = getStore()
  store.set(connId, { ips, port, protocol, timestamp: Date.now() })
}

/** Retrieve cached node IPs (returns null if expired or missing) */
export function getNodeIps(connId: string): { ips: string[]; port: number; protocol: string } | null {
  const store = getStore()
  const entry = store.get(connId)
  if (!entry) return null
  if (Date.now() - entry.timestamp > TTL_MS) {
    store.delete(connId)
    return null
  }
  return { ips: entry.ips, port: entry.port, protocol: entry.protocol }
}

/** Clear node IP cache for a specific connection or all */
export function invalidateNodeIpCache(connId?: string): void {
  const store = getStore()
  if (connId) store.delete(connId)
  else store.clear()
}

/** Get existing failover lock for a connection (prevents thundering herd) */
export function getFailoverLock(connId: string): Promise<string | null> | null {
  const locks = getLockStore()
  const entry = locks.get(connId)
  if (!entry) return null
  if (Date.now() - entry.timestamp > LOCK_TTL_MS) {
    locks.delete(connId)
    return null
  }
  return entry.promise
}

/** Set a failover lock — returns the promise other callers should await */
export function setFailoverLock(connId: string, promise: Promise<string | null>): void {
  const locks = getLockStore()
  locks.set(connId, { promise, timestamp: Date.now() })
  // Auto-clean after resolution
  promise.finally(() => {
    const current = locks.get(connId)
    if (current?.promise === promise) locks.delete(connId)
  })
}
