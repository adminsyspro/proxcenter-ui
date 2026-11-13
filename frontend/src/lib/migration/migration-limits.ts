/**
 * Limits on the migrations a bulk batch starts at once (ui#1332).
 *
 * A vCenter NFC stream is capped per stream, not per link, so a wave of
 * hundreds of VMs needs several streams at once; but each running migration
 * costs its target node a virt-v2v or nbdkit process (measured on the lab:
 * about 650 MB of RAM and 1.5 cores at peak per job, linear), and each source
 * ESXi host serves one export per stream. Three limits keep a wave inside what
 * the infrastructure can take, all set per connection in Settings:
 * - on the target PVE cluster, the migrations running into it at once, all
 *   batches and single migrations included, which also bounds the batch
 *   concurrency the bulk dialog offers;
 * - on the target PVE cluster, the migrations running into one of its nodes;
 * - on a VMware source, the migrations reading from one of its ESXi hosts.
 *
 * Only queued batch jobs wait for these limits: a single migration started by
 * hand starts at once, but counts against them while it runs.
 */

/** Migrations running into one target cluster at once, when its connection sets nothing. */
export const MIGRATION_PARALLEL_DEFAULT = 5
/** Migrations running into one node of the target cluster, when its connection sets nothing. */
export const MIGRATION_PER_NODE_DEFAULT = 2
/** Migrations reading from one ESXi host of a VMware source, when its connection sets nothing. */
export const MIGRATION_PER_SOURCE_HOST_DEFAULT = 4
/** Highest value an operator may set for any of the three limits. */
export const MIGRATION_LIMIT_MAX = 20

export interface TargetLimitSettings {
  migrationMaxParallel?: number | null
  migrationMaxPerNode?: number | null
}

export interface SourceLimitSettings {
  type?: string | null
  migrationMaxPerSourceHost?: number | null
}

export interface MigrationLimits {
  cluster: number
  perNode: number
  perSourceHost: number
}

function setting(value: number | null | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) return fallback
  return Math.min(MIGRATION_LIMIT_MAX, Math.round(value))
}

/** The limits that apply to migrations from `source` into `target`. */
export function effectiveMigrationLimits(target: TargetLimitSettings | null, source: SourceLimitSettings | null): MigrationLimits {
  const cluster = setting(target?.migrationMaxParallel, MIGRATION_PARALLEL_DEFAULT)
  return {
    cluster,
    perNode: Math.min(cluster, setting(target?.migrationMaxPerNode, MIGRATION_PER_NODE_DEFAULT)),
    perSourceHost: source?.type === "vmware"
      ? setting(source.migrationMaxPerSourceHost, MIGRATION_PER_SOURCE_HOST_DEFAULT)
      : Infinity,
  }
}

/**
 * The source host a job reads from: the ESXi host of a vCenter source (the
 * job config's `vcenterHost`), or the connection itself for a direct ESXi,
 * which is a single host.
 */
export function sourceHostKey(sourceConnectionId: string, config: unknown): string {
  const host = (config as Record<string, unknown> | null)?.vcenterHost
  return `${sourceConnectionId}|${typeof host === "string" ? host : ""}`
}

export interface QueuedSlotJob {
  id: string
  targetNode: string
  sourceHostKey: string | null
}

export interface RunningSlotJob {
  targetNode: string
  sourceHostKey: string | null
  /** True when it runs into the batch's target cluster; false when it only shares a source host. */
  sameTarget: boolean
}

export interface PickInput {
  /** Queued jobs of the batch, in batch order. */
  queued: QueuedSlotJob[]
  /** Migrations running into the target cluster or reading from the batch's source. */
  running: RunningSlotJob[]
  /** Jobs of this batch among them. */
  batchRunning: number
  limits: MigrationLimits & { batch: number }
}

/**
 * Ids of the queued jobs to start now, in batch order. A job whose node or
 * source host is full waits and the next one is tried, so a wave spread over
 * several nodes keeps every node busy; the batch and cluster limits stop the
 * walk.
 */
export function pickJobsToStart({ queued, running, batchRunning, limits }: PickInput): string[] {
  let batchFree = Math.min(limits.batch, limits.cluster) - batchRunning
  let clusterFree = limits.cluster - running.filter(r => r.sameTarget).length
  const onNode = new Map<string, number>()
  const onHost = new Map<string, number>()
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)
  for (const r of running) {
    if (r.sameTarget) bump(onNode, r.targetNode)
    if (r.sourceHostKey) bump(onHost, r.sourceHostKey)
  }

  const picked: string[] = []
  for (const job of queued) {
    if (batchFree <= 0 || clusterFree <= 0) break
    if ((onNode.get(job.targetNode) ?? 0) >= limits.perNode) continue
    if (job.sourceHostKey && (onHost.get(job.sourceHostKey) ?? 0) >= limits.perSourceHost) continue
    picked.push(job.id)
    batchFree--
    clusterFree--
    bump(onNode, job.targetNode)
    if (job.sourceHostKey) bump(onHost, job.sourceHostKey)
  }
  return picked
}

const TARGET_LIMIT_FIELDS = ["migrationMaxParallel", "migrationMaxPerNode"] as const
const SOURCE_LIMIT_FIELDS = ["migrationMaxPerSourceHost"] as const
export type MigrationLimitField = typeof TARGET_LIMIT_FIELDS[number] | typeof SOURCE_LIMIT_FIELDS[number]
const LIMIT_FIELDS_BY_TYPE: Record<string, readonly MigrationLimitField[]> = { pve: TARGET_LIMIT_FIELDS, vmware: SOURCE_LIMIT_FIELDS }

/**
 * The limit settings of `body` that belong to a connection of `type`: the
 * cluster and per-node limits on a PVE target, the per-host limit on a VMware
 * source. Null (back to the default) is kept; a field not sent is left out.
 */
export function migrationLimitFields(type: string | null | undefined, body: Record<string, unknown>): Partial<Record<MigrationLimitField, number | null>> {
  const fields: readonly MigrationLimitField[] = LIMIT_FIELDS_BY_TYPE[type ?? ""] ?? []
  const out: Partial<Record<MigrationLimitField, number | null>> = {}
  for (const f of fields) {
    const v = body[f]
    if (v === null) out[f] = null
    else if (typeof v === "number") out[f] = v
  }
  return out
}
