// GPUs a vDC is about to hold (#672). A clone or a restore writes its hostpciN
// and joins the pool from inside its PVE task, so a fresh collection does not
// see them until the task ends. They are reserved under the vDC lock once PVE
// accepted the request, and released when the task ends or the reservation
// expires. Kept on globalThis for the same reason as the vDC lock.
import { waitForTaskStopped } from '@/lib/proxmox/tasks'
import { parseUpid } from '@/lib/proxmox/upid'

import { entryUsage, type GpuDemand, type VdcGpuEntry } from './vdcQuota'

export type PendingGpus = { vmid: string; demand: GpuDemand[] }

type Reservation = PendingGpus & { expires: number }

/** How long a reservation lives at most: the end of a task never seen frees it. */
export const RESERVATION_TTL_MS = 2 * 60 * 60_000
const TASK_POLL_MS = 10_000

const g = globalThis as { __pcVdcGpuPending?: Map<string, Set<Reservation>> }
const store = (g.__pcVdcGpuPending ??= new Map<string, Set<Reservation>>())

/** Reserves the GPUs a VM of the vDC is about to hold; the returned function releases them. */
export function reserveVdcGpus(vdcId: string, vmid: string, demand: GpuDemand[], opts: { ttlMs?: number; now?: number } = {}): () => void {
  const r: Reservation = { vmid, demand, expires: (opts.now ?? Date.now()) + (opts.ttlMs ?? RESERVATION_TTL_MS) }
  const set = store.get(vdcId) ?? new Set<Reservation>()
  set.add(r)
  store.set(vdcId, set)
  return () => {
    set.delete(r)
    if (set.size === 0 && store.get(vdcId) === set) store.delete(vdcId)
  }
}

/** The reservations of a vDC still running. */
export function pendingVdcGpus(vdcId: string, now = Date.now()): PendingGpus[] {
  const set = store.get(vdcId)
  if (!set) return []
  const out: PendingGpus[] = []
  for (const r of set) {
    if (r.expires <= now) set.delete(r)
    else out.push({ vmid: r.vmid, demand: r.demand })
  }
  if (set.size === 0) store.delete(vdcId)
  return out
}

/**
 * Releases a reservation once its task is seen stopped, whatever its exit
 * status. The task is polled on the node its UPID names (a clone to another
 * node runs on the source node), for as long as the reservation may live; a
 * task whose end is never seen leaves the reservation to its expiry.
 */
export async function releaseWhenTaskStops(conn: unknown, upid: string, fallbackNode: string, release: () => void): Promise<void> {
  if (!upid) return
  const node = parseUpid(upid)?.node ?? fallbackNode
  const end = await waitForTaskStopped(conn as any, node, upid, { timeoutMs: RESERVATION_TTL_MS, intervalMs: TASK_POLL_MS })
  if (end.stopped) release()
}

/** Test seam. */
export function resetVdcPending(): void {
  store.clear()
}

/**
 * GPUs held per line: what the pool holds, plus the reservations of VMs the
 * collection does not show in the pool yet (a VM it shows counts once).
 */
export function vdcUsage(
  vdcId: string,
  entries: VdcGpuEntry[],
  gpus: Array<GpuDemand & { vmid: string; template: boolean }>,
): Map<string, number> {
  const held = new Set(gpus.map((x) => x.vmid))
  const pending = pendingVdcGpus(vdcId)
    .filter((p) => !held.has(p.vmid))
    .flatMap((p) => p.demand.map((d) => ({ ...d, template: false })))
  return entryUsage(entries, [...gpus, ...pending])
}
