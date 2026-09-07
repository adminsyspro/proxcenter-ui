import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"

/**
 * Free space on the warm target storage versus what the source disks need.
 *
 * Warm writes each target disk as a block volume of the source disk's full
 * capacity: a zvol reserves that capacity up front (zfspool without `sparse`),
 * LVM allocates it, RBD and LVM-thin grow into it as the copy lands. Cold
 * already refuses a target below the disks' size plus a 10 % margin at
 * planning time; warm had no such guard and only failed at volume allocation,
 * after the node preflight had said "ready". The dialog now asks this
 * before enabling the launch, and the engine applies the same rule as a
 * backstop for the cluster-auto node choice.
 */
export interface TargetSpaceResult {
  storage: string
  /** PVE storage type as reported by the node (zfspool, lvmthin, rbd, ...). */
  type?: string
  availableBytes: number
  requiredBytes: number
  /** availableBytes covers requiredBytes plus TARGET_SPACE_MARGIN. */
  sufficient: boolean
  /** Set when the node could not report the storage (unknown storage, node down). */
  error?: string
}

/** Same 10 % headroom the cold engine applies to its target-storage check. */
export const TARGET_SPACE_MARGIN = 1.1

/** Pure verdict from a PVE storage status payload (`avail` in bytes). */
export function evaluateTargetSpace(
  storage: string,
  status: { avail?: unknown; type?: unknown } | null | undefined,
  requiredBytes: number,
): TargetSpaceResult {
  const parsed = Number(status?.avail ?? 0)
  const availableBytes = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
  return {
    storage,
    type: typeof status?.type === "string" ? status.type : undefined,
    availableBytes,
    requiredBytes,
    sufficient: availableBytes >= requiredBytes * TARGET_SPACE_MARGIN,
  }
}

/**
 * Read `/nodes/{node}/storage/{storage}/status` on the target connection and
 * compare its live `avail` with requiredBytes. Never throws: a storage the
 * node cannot report is returned as insufficient with the error text, so the
 * caller blocks the launch and shows why instead of failing later.
 */
export async function checkTargetStorageSpace(
  targetConnectionId: string,
  node: string,
  storage: string,
  requiredBytes: number,
): Promise<TargetSpaceResult> {
  try {
    const conn = await getConnectionById(targetConnectionId)
    const status = await pveFetch<{ avail?: number; type?: string }>(
      conn,
      `/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/status`,
    )
    return evaluateTargetSpace(storage, status, requiredBytes)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { storage, availableBytes: 0, requiredBytes, sufficient: false, error: message }
  }
}

/** "12.2" style GiB figure for messages. */
export function gib(bytes: number): string {
  return (bytes / 1073741824).toFixed(1)
}

/**
 * Planning-time guard: the same verdict as checkTargetStorageSpace, turned into
 * the error the operator reads in the job log. Throws when the storage cannot
 * hold the disks or cannot be read; returns the verdict otherwise so the
 * caller can log the two figures.
 */
export async function assertTargetStorageSpace(
  targetConnectionId: string,
  node: string,
  storage: string,
  requiredBytes: number,
): Promise<TargetSpaceResult> {
  const space = await checkTargetStorageSpace(targetConnectionId, node, storage, requiredBytes)
  if (space.error) {
    throw new Error(`Cannot read free space on "${storage}" (node ${node}): ${space.error}`)
  }
  if (!space.sufficient) {
    throw new Error(
      `Insufficient disk space on "${storage}": ${gib(space.availableBytes)} GB free, need ${gib(space.requiredBytes)} GB plus a 10% margin. Free up space or pick another storage.`,
    )
  }
  return space
}
