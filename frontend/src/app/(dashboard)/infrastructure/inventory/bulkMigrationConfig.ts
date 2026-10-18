/**
 * Bulk migration concurrency, shared between the bulk dialog
 * (InventoryDialogs.tsx, which sends it with the batch) and the batch routes
 * under /api/v1/migrations/batches, whose scheduler starts the queued jobs of a
 * batch as slots free up.
 *
 * The cap used to be a hard-coded constant (1, sequential), and before that two
 * copies that drifted apart (the dispatcher at 1, the poller at 2). It is now an
 * operator setting of the bulk dialog, "Maximum parallel migrations" (roadmap#53),
 * stored on the batch row so the server keeps the same value for the whole
 * batch, whether or not the tab that launched it stays open. The default stays
 * sequential: vCenter NFC throughput and node I/O contention make blind
 * parallelism slower overall, and the operator who sizes a wave knows what the
 * source hosts and the target nodes can take.
 */
export const BULK_MIG_CONCURRENCY_DEFAULT = 1
export const BULK_MIG_CONCURRENCY_MIN = 1
export const BULK_MIG_CONCURRENCY_MAX = 5

/**
 * Normalise a concurrency value coming from the dialog state: anything that is
 * not a finite number lands on the default, and the result is clamped to the
 * allowed range. Never returns 0, so a batch always has at least one slot.
 */
export function clampBulkConcurrency(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return BULK_MIG_CONCURRENCY_DEFAULT
  return Math.min(BULK_MIG_CONCURRENCY_MAX, Math.max(BULK_MIG_CONCURRENCY_MIN, Math.round(n)))
}

/**
 * Temporary-storage need of a batch (virt-v2v sources): each running job stages
 * its source disks (committed size x 2, source + converted), and up to
 * `concurrency` jobs run at once, so the peak is the sum of the N biggest VMs.
 * Sequential (1) degrades to "biggest VM x 2", the rule the dialog used before.
 */
export function bulkTempBytesRequired(committedBytes: number[], concurrency: number): number {
  const n = clampBulkConcurrency(concurrency)
  const sorted = committedBytes.map(b => (Number.isFinite(b) && b > 0 ? b : 0)).sort((a, b) => b - a)
  return sorted.slice(0, n).reduce((s, b) => s + b, 0) * 2
}

/**
 * Target nodes of a batch, in round-robin order (roadmap#53). "Auto" spreads
 * over the online nodes of the chosen cluster (all of its nodes when none
 * reports a status), a single node takes every VM. Shared by the launch and
 * by the target-space check, which must see the same distribution.
 */
export function bulkTargetNodes(targetNode: string, targetConn: string, nodeOptions: Array<{ connId: string; node: string; status?: string }>): string[] {
  if (!targetNode) return []
  if (targetNode !== '__auto__') return [targetNode]
  const ofCluster = nodeOptions.filter(o => o.connId === targetConn)
  const online = ofCluster.filter(o => o.status === 'online').map(o => o.node)
  return online.length > 0 ? online : ofCluster.map(o => o.node)
}

/**
 * Disk bytes a source VM needs on the target, as the inventory reports it:
 * committed plus uncommitted (the provisioned size) where the source gives
 * both (vSphere), committed otherwise, 0 when unknown.
 */
export function bulkVmDiskBytes(vm: { committed?: number | null; uncommitted?: number | null }): number {
  const committed = Number(vm?.committed) || 0
  const uncommitted = Number(vm?.uncommitted) || 0
  return Math.max(0, committed) + Math.max(0, uncommitted)
}
