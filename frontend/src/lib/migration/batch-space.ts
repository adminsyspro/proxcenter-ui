/**
 * Target space of a whole bulk migration (roadmap#53).
 *
 * Each job checks its own target storage at planning time (target-space.ts),
 * so a batch whose VMs fit one by one but not together used to start, then
 * fail its last VMs on "Insufficient disk space". The batch is checked as a
 * whole before it starts: on a shared storage (Ceph, NFS, ...) every VM lands
 * on the same pool, on a local one (ZFS, LVM, dir) each node only receives its
 * share of the round-robin. Same 10 % margin and same size as the per-job
 * check (the disks' capacity, lib/migration/batch-disk-sizes); a VM whose
 * size cannot be read is counted with the source list's estimate, which can
 * only raise a warning, never block.
 *
 * Used by the bulk dialog (through POST /api/v1/migrations/batches/space-check)
 * and by POST /api/v1/migrations/batches itself.
 */
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { evaluateTargetSpace, gib } from "@/lib/migration/warm/target-space"
import { readBatchDiskSizes } from "@/lib/migration/batch-disk-sizes"

export interface BatchSpaceVm {
  targetNode: string
  /** Exact bytes, as the engine reads them (lib/migration/batch-disk-sizes); null when unreadable. */
  diskBytes: number | null
  /** The source list's estimate, used only when diskBytes is null, and never to block. */
  estimatedBytes?: number
}

export interface BatchSpaceProblem {
  storage: string
  /** Null for a shared storage: the whole batch lands on it whatever the node. */
  node: string | null
  availableBytes: number
  requiredBytes: number
  /** Set when the node could not report the storage. */
  error?: string
  /** The figure includes VMs sized from the source list's estimate: a warning, not a refusal. */
  estimated?: boolean
  message: string
}

export interface BatchSpaceResult {
  /** False only on exact figures (or an unreadable storage): the batch must not start. */
  ok: boolean
  problems: BatchSpaceProblem[]
  /** Shortfalls that rest on estimated sizes: shown, never blocking. */
  warnings: BatchSpaceProblem[]
}

type StorageStatus = { avail?: unknown; type?: unknown; shared?: unknown }
export type ReadStorageStatus = (node: string) => Promise<StorageStatus>

const positive = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0)

interface Share { exact: number; estimate: number; hasEstimate: boolean }

/** Bytes each target node receives, in node order of first appearance: exact, and exact-or-estimated. */
export function bytesPerNode(vms: BatchSpaceVm[]): Map<string, Share> {
  const out = new Map<string, Share>()
  for (const vm of vms) {
    const share = out.get(vm.targetNode) ?? { exact: 0, estimate: 0, hasEstimate: false }
    if (vm.diskBytes === null) {
      share.estimate += positive(vm.estimatedBytes)
      share.hasEstimate = share.hasEstimate || positive(vm.estimatedBytes) > 0
    } else {
      share.exact += positive(vm.diskBytes)
      share.estimate += positive(vm.diskBytes)
    }
    out.set(vm.targetNode, share)
  }
  return out
}

export function batchSpaceMessage(p: Pick<BatchSpaceProblem, "storage" | "node" | "availableBytes" | "requiredBytes" | "error" | "estimated">): string {
  const where = p.node ? `${p.storage} (${p.node})` : p.storage
  if (p.error) return `Cannot read free space on ${where}: ${p.error}`
  if (p.estimated) return `Maybe not enough space on ${where}: ${gib(p.availableBytes)} GB free, this batch needs about ${gib(p.requiredBytes)} GB plus a 10% margin (estimated from the source's used space)`
  return `Not enough space on ${where}: ${gib(p.availableBytes)} GB free, this batch needs ${gib(p.requiredBytes)} GB plus a 10% margin`
}

function verdict(storage: string, node: string | null, status: StorageStatus, share: Share, out: { problems: BatchSpaceProblem[]; warnings: BatchSpaceProblem[] }) {
  const exact = evaluateTargetSpace(storage, status, share.exact)
  if (share.exact > 0 && !exact.sufficient) {
    const p = { storage, node, availableBytes: exact.availableBytes, requiredBytes: share.exact }
    out.problems.push({ ...p, message: batchSpaceMessage(p) })
    return
  }
  if (!share.hasEstimate) return
  const estimated = evaluateTargetSpace(storage, status, share.estimate)
  if (!estimated.sufficient) {
    const p = { storage, node, availableBytes: estimated.availableBytes, requiredBytes: share.estimate, estimated: true }
    out.warnings.push({ ...p, message: batchSpaceMessage(p) })
  }
}

/**
 * Verdict for the batch from the storage status of each target node (the
 * status says whether the storage is shared). Pure but for `read`.
 */
export async function evaluateBatchSpace(storage: string, vms: BatchSpaceVm[], read: ReadStorageStatus): Promise<BatchSpaceResult> {
  const perNode = bytesPerNode(vms)
  const out = { problems: [] as BatchSpaceProblem[], warnings: [] as BatchSpaceProblem[] }
  const total: Share = { exact: 0, estimate: 0, hasEstimate: false }
  for (const s of perNode.values()) { total.exact += s.exact; total.estimate += s.estimate; total.hasEstimate ||= s.hasEstimate }
  if (total.estimate === 0) return { ok: true, ...out }
  for (const [node, share] of perNode) {
    if (share.estimate === 0) continue
    let status: StorageStatus
    try {
      status = await read(node)
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : String(e)
      const p = { storage, node, availableBytes: 0, requiredBytes: share.exact || share.estimate, error }
      out.problems.push({ ...p, message: batchSpaceMessage(p) })
      continue
    }
    const shared = status?.shared === 1 || status?.shared === true || status?.shared === "1"
    if (shared) {
      // One pool for the whole batch: one verdict, against the total.
      verdict(storage, null, status, total, out)
      return { ok: out.problems.length === 0, ...out }
    }
    verdict(storage, node, status, share, out)
  }
  return { ok: out.problems.length === 0, ...out }
}

/** evaluateBatchSpace against the live `/nodes/{node}/storage/{storage}/status` of the target cluster. */
export async function checkBatchTargetSpace(targetConnectionId: string, storage: string, vms: BatchSpaceVm[]): Promise<BatchSpaceResult> {
  const conn = await getConnectionById(targetConnectionId)
  return evaluateBatchSpace(storage, vms, node =>
    pveFetch<StorageStatus>(conn, `/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/status`))
}

/**
 * The batch's VMs with their exact sizes (read from the source like the
 * engines do) and the request's estimate as a fallback, then the verdict.
 */
export async function checkBatchSpaceForRequest(a: {
  tenantId: string; sourceConnectionId: string; targetConnectionId: string; storage: string
  vms: Array<{ sourceVmId: string; targetNode: string; estimatedBytes: number }>
}): Promise<BatchSpaceResult> {
  const exact = await readBatchDiskSizes(a.tenantId, a.sourceConnectionId, a.vms.map(v => v.sourceVmId))
  return checkBatchTargetSpace(a.targetConnectionId, a.storage, a.vms.map(v => ({
    targetNode: v.targetNode, diskBytes: exact.get(v.sourceVmId) ?? null, estimatedBytes: v.estimatedBytes,
  })))
}

/** The per-VM disk bytes of a batch request, 0 when absent or not a sane number. */
export function requestDiskBytes(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) && n > 0 && n < 2 ** 53 ? Math.floor(n) : 0
}
