// Resources a vDC is about to hold (roadmap#265). A create, a clone or a
// catalogue deployment is admitted on the usage PVE reports, and its guest
// only joins the pool from inside the PVE task: several requests admitted at
// the same time all passed the same check. Each admitted creation is reserved
// under the pool lock, and released when its task ends or the reservation
// expires. Kept on globalThis for the same reason as the vDC lock.

export type QuotaAmounts = {
  vcpus: number
  ramMb: number
  storageMb: number
  vms: number
  storageMbByStorage?: Record<string, number>
}

export type PendingQuota = QuotaAmounts & { vmid: string }

type Reservation = { pending: PendingQuota; expires: number }

/** How long a reservation lives at most: the end of a task never seen frees it. */
export const QUOTA_RESERVATION_TTL_MS = 2 * 60 * 60_000

const g = globalThis as { __pcVdcQuotaPending?: Map<string, Set<Reservation>> }
const store = (g.__pcVdcQuotaPending ??= new Map<string, Set<Reservation>>())

/** Key of a vDC pool: also the key of its lock. */
export function quotaPoolKey(connectionId: string, poolName: string): string {
  return `quota:${connectionId}:${poolName}`
}

/** Reserves what a guest of the pool is about to hold; the returned function releases it. */
export function reserveVdcQuota(
  connectionId: string,
  poolName: string,
  vmid: string,
  amounts: QuotaAmounts,
  opts: { ttlMs?: number; now?: number } = {},
): () => void {
  const key = quotaPoolKey(connectionId, poolName)
  const r: Reservation = { pending: { vmid, ...amounts }, expires: (opts.now ?? Date.now()) + (opts.ttlMs ?? QUOTA_RESERVATION_TTL_MS) }
  const set = store.get(key) ?? new Set<Reservation>()
  set.add(r)
  store.set(key, set)
  return () => {
    set.delete(r)
    if (set.size === 0 && store.get(key) === set) store.delete(key)
  }
}

/** The reservations of a pool still running. */
export function pendingVdcQuota(connectionId: string, poolName: string, now = Date.now()): PendingQuota[] {
  const key = quotaPoolKey(connectionId, poolName)
  const set = store.get(key)
  if (!set) return []
  const out: PendingQuota[] = []
  for (const r of set) {
    if (r.expires <= now) set.delete(r)
    else out.push(r.pending)
  }
  if (set.size === 0) store.delete(key)
  return out
}

/** Test seam. */
export function resetVdcQuotaPending(): void {
  store.clear()
}
