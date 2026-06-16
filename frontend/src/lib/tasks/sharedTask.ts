import { getCurrentTenantId, getSessionPrisma, getTenantConnectionIds, DEFAULT_TENANT_ID } from "@/lib/tenant"
import { prisma as globalPrisma } from "@/lib/db/prisma"

export const TERMINAL_STATUSES = ["completed", "failed", "cancelled"] as const

// config.sourceType / hostType -> display label. Mirrors the mapping used in
// InventoryDialogs when the migration task is first created.
export const SOURCE_TYPE_LABELS: Record<string, string> = {
  esxi: "ESXi",
  "esxi-direct": "ESXi",
  vcenter: "vCenter",
  hyperv: "Hyper-V",
  nutanix: "Nutanix",
  xcpng: "XCP-ng",
}

export function sourceTypeLabel(t?: string | null): string {
  if (!t) return "External"
  return SOURCE_TYPE_LABELS[t] ?? t
}

export interface SharedTask {
  id: string
  kind: "migration"
  label: string
  sourceVmName: string | null
  targetNode: string
  targetVmid: number | null
  status: string
  currentStep: string | null
  progress: number
  totalDisks: number | null
  currentDisk: number | null
  bytesTransferred: number | null
  totalBytes: number | null
  transferSpeed: string | null
  error: string | null
  isMine: boolean
  createdByName: string
  createdAt: string
  startedAt: string | null
  completedAt: string | null
}

export interface SharedTaskScope {
  tenantId: string
  isDefault: boolean
  client: any // tenant-scoped or global Prisma client (same surface for our reads)
  reachableConnectionIds: Set<string>
}

/** Resolve the Prisma client + reachable connections for the caller's tenant. */
export async function resolveSharedTaskScope(): Promise<SharedTaskScope> {
  const tenantId = await getCurrentTenantId()
  const isDefault = tenantId === DEFAULT_TENANT_ID
  const client = isDefault ? globalPrisma : await getSessionPrisma()
  const reachableConnectionIds = await getTenantConnectionIds()
  return { tenantId, isDefault, client, reachableConnectionIds }
}

/** Prisma `where` fragment: active (any pipeline) OR recently-finished. */
export function sharedTaskWindowWhere(cutoff: Date) {
  return {
    OR: [
      { status: { notIn: TERMINAL_STATUSES as unknown as string[] } },
      { updatedAt: { gte: cutoff } },
    ],
  }
}

/** Same predicate as sharedTaskWindowWhere, evaluated in memory (detail route). */
export function jobInSharedTaskWindow(job: { status: string; updatedAt: Date }, cutoff: Date): boolean {
  return !(TERMINAL_STATUSES as readonly string[]).includes(job.status) || job.updatedAt >= cutoff
}

/** DEFAULT (NOC) sees everything; others only their reachable target connections. */
export function jobPassesSharedTaskScope(
  job: { targetConnectionId: string },
  scope: { isDefault: boolean; reachableConnectionIds: Set<string> },
): boolean {
  return scope.isDefault || scope.reachableConnectionIds.has(job.targetConnectionId)
}

/** Map a MigrationJob row to the summary DTO. Never emits raw createdBy or logs. */
export function toSharedTask(
  job: any,
  opts: { isMine: boolean; createdByName: string },
): SharedTask {
  const vm = job.sourceVmName || job.sourceVmId || (job.targetVmid != null ? String(job.targetVmid) : "")
  const srcType = sourceTypeLabel((job.config as any)?.sourceType)
  return {
    id: job.id,
    kind: "migration",
    label: `${vm} (${srcType} -> Proxmox)`,
    sourceVmName: job.sourceVmName ?? null,
    targetNode: job.targetNode,
    targetVmid: job.targetVmid ?? null,
    status: job.status,
    currentStep: job.currentStep ?? null,
    progress: job.progress ?? 0,
    totalDisks: job.totalDisks ?? null,
    currentDisk: job.currentDisk ?? null,
    bytesTransferred: job.bytesTransferred != null ? Number(job.bytesTransferred) : null,
    totalBytes: job.totalBytes != null ? Number(job.totalBytes) : null,
    transferSpeed: job.transferSpeed ?? null,
    error: job.error ?? null,
    isMine: opts.isMine,
    createdByName: opts.createdByName,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt ? job.startedAt.toISOString() : null,
    completedAt: job.completedAt ? job.completedAt.toISOString() : null,
  }
}
