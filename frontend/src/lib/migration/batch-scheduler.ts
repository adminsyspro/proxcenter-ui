/**
 * Server-side queue of a bulk migration (roadmap#53).
 *
 * The queue used to live in the browser that launched the batch: only the
 * first N jobs existed in the database, and the page started the next one when
 * a slot freed up. A closed tab, a reload or a crashed browser left the rest of
 * the batch unstarted, silently. A batch is now a `migration_batches` row and
 * every one of its jobs a `migration_jobs` row created up front as "queued"
 * with its full config; this module starts them, `concurrency` at a time.
 *
 * pumpBatch() is the only thing that starts a queued job. It runs when the
 * batch is created or resumed, when one of its jobs ends, and every
 * BATCH_PUMP_INTERVAL_MS from startBatchPump() so a batch carries on after a
 * restart (the startup orphan sweep fails the jobs the dead process was
 * running, and the next pass starts the following ones). Two pumps of one
 * batch (two jobs ending together, or the periodic pass meeting a job end,
 * possibly in two HA replicas) are serialised by a row lock on the batch, so
 * the slot count is never read by two of them at once; on top of that a job
 * only starts when its own conditional `queued -> pending` update touched the
 * row, so it can never start twice.
 */
import { prisma } from "@/lib/db/prisma"
import { resolveInstanceId } from "@/lib/migration/orphan-sweep"
import { startMigrationJob, type StartableJob } from "@/lib/migration/start-job"
import { releaseLease, tryAcquireLease } from "@/lib/scheduler/lease"
import { TERMINAL_STATUSES } from "@/lib/tasks/sharedTask"
import { clampBulkConcurrency } from "@/app/(dashboard)/infrastructure/inventory/bulkMigrationConfig"
import { hasPermission, PERMISSIONS } from "@/lib/rbac"
import { migrationNicPermissions } from "@/lib/migration/authorize"
import { canMigrateConnections, getTenantInfrastructureScope } from "@/lib/tenant/infraScope"
import { runWithBackgroundTenant } from "@/lib/tenant/background"
import { DEFAULT_TENANT_ID } from "@/lib/tenant/constants"

export const BATCH_STATUSES = ["running", "paused", "cancelled", "completed"] as const
export type BatchStatus = (typeof BATCH_STATUSES)[number]

/** Statuses of a batch that will still start jobs or may again (paused). */
export const OPEN_BATCH_STATUSES: BatchStatus[] = ["running", "paused"]

export const QUEUED_STATUS = "queued"

export const BATCH_PUMP_INTERVAL_MS = 30_000
const LEASE_NAME = "migration-batches"
const LEASE_TTL_MS = 3 * BATCH_PUMP_INTERVAL_MS

const isTerminal = (status: string) => (TERMINAL_STATUSES as readonly string[]).includes(status)

/** A job of a batch that holds a slot: started and not finished. */
export function holdsBatchSlot(status: string): boolean {
  return status !== QUEUED_STATUS && !isTerminal(status)
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

/**
 * Row lock on the batch until the transaction ends: an UPDATE holds it, and a
 * concurrent one waits for the commit (Postgres, READ COMMITTED), so the
 * statements that follow in the transaction read what the previous pump
 * wrote. Written through the client rather than as SELECT ... FOR UPDATE so
 * it honours the schema the client is bound to. False when the batch is gone.
 */
async function lockBatch(tx: Tx, batchId: string): Promise<boolean> {
  const { count } = await tx.migrationBatch.updateMany({ where: { id: batchId }, data: { updatedAt: new Date() } })
  return count === 1
}

/**
 * Error of the jobs a batch could not start because the rights it was created
 * with are gone. Says nothing about the other connections or the user.
 */
export const JOB_REVOKED_ERROR =
  "Not started: the user who created this bulk migration no longer holds the rights this VM's migration needs (pinned copy adapter or network settings). Start it again."

export const BATCH_REVOKED_ERROR =
  "Not started: the user who created this bulk migration may no longer migrate between these clusters. Start the remaining VMs again."

export interface BatchAuthorizationInput {
  tenantId: string
  createdBy: string | null
  sourceConnectionId: string
  targetConnectionId: string
}

/**
 * A queued job starts long after the request that validated it, so the rights
 * it relied on are read again before each start: the creator is still an
 * enabled user holding vm.migrate in the batch's tenant, and that tenant may
 * still migrate between the two clusters. A batch without a known creator has
 * nobody whose rights can be read again: it never starts anything more. The
 * rights that depend on one job (its pinned copy adapter, its NICs) are read
 * again by jobStillAuthorized.
 */
export async function batchStillAuthorized(b: BatchAuthorizationInput): Promise<boolean> {
  if (!canMigrateConnections(await getTenantInfrastructureScope(b.tenantId), b.sourceConnectionId, b.targetConnectionId)) return false
  if (!b.createdBy) return false
  const user = await prisma.user.findUnique({ where: { id: b.createdBy }, select: { enabled: true } })
  if (!user?.enabled) return false
  if (!(await hasPermission({ userId: b.createdBy, permission: PERMISSIONS.VM_MIGRATE, tenantId: b.tenantId }))) return false
  // The jobs run with the batch tenant as an explicit tenant (lib/tenant/
  // background), which skips the per-user guard getConnectionById applies to a
  // provider session reading a connection another tenant owns: checked here
  // instead, for the batch's two connections (every job of a batch has them).
  if (b.tenantId !== DEFAULT_TENANT_ID) return true
  const foreign = await prisma.connection.findMany({
    where: { id: { in: [b.sourceConnectionId, b.targetConnectionId] }, tenantId: { not: DEFAULT_TENANT_ID } },
    select: { id: true },
  })
  for (const c of foreign) {
    if (!(await hasPermission({ userId: b.createdBy, permission: PERMISSIONS.CONNECTION_VIEW, resourceType: "connection", resourceId: c.id, tenantId: b.tenantId }))) return false
  }
  return true
}

/**
 * The rights a single queued job needs beyond those of its batch, for the
 * batch creator, read again before it starts: pinning the copy to a VMkernel
 * adapter moves a host-wide tag on a vCenter source (connection.manage on the
 * source), and each NIC needs the VLAN and MAC permissions it needed at the
 * creation (lib/migration/authorize).
 */
export async function jobStillAuthorized(b: BatchAuthorizationInput, job: Pick<StartableJob, "targetConnectionId" | "targetNode" | "config">): Promise<boolean> {
  if (!b.createdBy) return false
  const c = (job.config ?? {}) as Record<string, any>
  const userId = b.createdBy
  if (typeof c.copyVmk === "string" && c.copyVmk
    && !(await hasPermission({ userId, permission: PERMISSIONS.CONNECTION_MANAGE, resourceType: "connection", resourceId: b.sourceConnectionId, tenantId: b.tenantId }))) {
    return false
  }
  const needs = migrationNicPermissions({
    tenantId: b.tenantId, targetConnectionId: job.targetConnectionId, targetNode: job.targetNode,
    targetVmid: typeof c.targetVmid === "number" ? c.targetVmid : undefined,
    networkBridge: String(c.networkBridge ?? ""), vlanTag: typeof c.vlanTag === "number" ? c.vlanTag : undefined,
    nics: Array.isArray(c.nics) ? c.nics : undefined,
  })
  for (const need of needs) {
    if (!(await hasPermission({ userId, permission: need.permission, resourceType: need.resourceType, resourceId: need.resourceId, tenantId: b.tenantId }))) return false
  }
  return true
}

export interface PumpDeps {
  /** Re-checks the rights the batch was created with; defaults to batchStillAuthorized. */
  authorizeJob?: (b: BatchAuthorizationInput, job: StartableJob) => Promise<boolean>
  authorize?: (b: BatchAuthorizationInput) => Promise<boolean>
  /** Runs a claimed job; the default starts its pipeline in the background. */
  launch?: (job: StartableJob, tenantId: string, batchId: string) => void
  instanceId?: string
  now?: () => Date
}

export interface PumpResult {
  started: string[]
  status: BatchStatus | null
}

/**
 * Start the next queued jobs of `batchId` while it is running and has free
 * slots, and mark it completed once nothing is queued or running. Returns the
 * ids of the jobs it started. Never throws on a missing batch.
 */
export async function pumpBatch(batchId: string, deps: PumpDeps = {}): Promise<PumpResult> {
  const launch = deps.launch ?? launchInBackground
  const instanceId = deps.instanceId ?? resolveInstanceId()
  const now = deps.now ?? (() => new Date())

  const authorize = deps.authorize ?? batchStillAuthorized
  const authorizeJob = deps.authorizeJob ?? jobStillAuthorized

  // Rights first, outside the lock (they read other tables), for any batch
  // with something left to start, whatever status was read here: a resume
  // landing between this read and the lock must not skip the check.
  const head = await prisma.migrationBatch.findUnique({
    where: { id: batchId },
    select: { tenantId: true, createdBy: true, sourceConnectionId: true, targetConnectionId: true },
  })
  if (head && await prisma.migrationJob.count({ where: { batchId, status: QUEUED_STATUS } }) > 0 && !(await authorize(head))) {
    await cancelQueuedJobs(batchId, now(), BATCH_REVOKED_ERROR)
    console.warn(`[migration-batch] batch ${batchId}: rights revoked, queued jobs cancelled`)
    return { started: [], status: "cancelled" }
  }

  const { claimed, tenantId, status } = await prisma.$transaction(async (tx) => {
    if (!(await lockBatch(tx, batchId))) return { claimed: [] as StartableJob[], tenantId: "", status: null }
    const batch = await tx.migrationBatch.findUnique({ where: { id: batchId }, select: { status: true, concurrency: true, tenantId: true } })
    if (!batch) return { claimed: [] as StartableJob[], tenantId: "", status: null }
    if (batch.status !== "running") return { claimed: [] as StartableJob[], tenantId: batch.tenantId, status: batch.status as BatchStatus }

    const jobs = await tx.migrationJob.findMany({
      where: { batchId },
      select: { id: true, status: true, batchOrder: true },
      orderBy: [{ batchOrder: "asc" }, { createdAt: "asc" }],
    })
    const running = jobs.filter(j => holdsBatchSlot(j.status)).length
    const queued = jobs.filter(j => j.status === QUEUED_STATUS)

    if (running === 0 && queued.length === 0) {
      await tx.migrationBatch.update({ where: { id: batchId }, data: { status: "completed" } })
      return { claimed: [] as StartableJob[], tenantId: batch.tenantId, status: "completed" as BatchStatus }
    }

    const picked: StartableJob[] = []
    let slots = clampBulkConcurrency(batch.concurrency) - running
    for (const job of queued) {
      if (slots <= 0) break
      // The status guard is what makes a start happen once: a pump that lost
      // the row (cancelled meanwhile, or claimed elsewhere) touches nothing.
      const { count } = await tx.migrationJob.updateMany({
        where: { id: job.id, status: QUEUED_STATUS },
        data: { status: "pending", currentStep: "pending", startedAt: now(), ownerInstanceId: instanceId },
      })
      if (count !== 1) continue
      const row = await tx.migrationJob.findUnique({
        where: { id: job.id },
        select: { id: true, sourceConnectionId: true, sourceVmId: true, sourceVmName: true, targetConnectionId: true, targetNode: true, targetStorage: true, config: true },
      })
      if (row) picked.push(row)
      slots--
    }
    return { claimed: picked, tenantId: batch.tenantId, status: "running" as BatchStatus }
  })

  // Started after the commit, so a pipeline never reads a row still locked. A
  // job whose own rights are gone fails with the reason instead of starting.
  const started: string[] = []
  for (const job of claimed) {
    if (head && !(await authorizeJob(head, job))) {
      await prisma.migrationJob.updateMany({ where: { id: job.id, status: "pending" }, data: { status: "failed", error: JOB_REVOKED_ERROR, completedAt: now() } })
      console.warn(`[migration-batch] batch ${batchId}: job ${job.id} lost the rights it was created with, not started`)
      continue
    }
    launch(job, tenantId, batchId)
    started.push(job.id)
  }
  return { started, status }
}

/**
 * Run the pipeline of a batch job without blocking the caller, then pump its
 * batch again: the end of a job frees its slot. The pipelines record their
 * own failures on the row; anything they throw is logged and the batch goes on.
 */
export function launchInBackground(job: StartableJob, tenantId: string, batchId: string): void {
  // The job may start from the periodic pass, outside any request: the
  // pipelines read the batch tenant from this context instead of a session.
  void runWithBackgroundTenant(tenantId, () => startMigrationJob(job, tenantId))
    .catch(err => console.error(`[migration-batch] job ${job.id} of batch ${batchId} failed to run:`, err))
    .finally(() => {
      void pumpBatch(batchId).catch(err => console.error(`[migration-batch] pump of batch ${batchId} failed:`, err))
    })
}

/** running -> paused. Jobs already started carry on; nothing new starts. */
export async function pauseBatch(batchId: string): Promise<boolean> {
  const { count } = await prisma.migrationBatch.updateMany({ where: { id: batchId, status: "running" }, data: { status: "paused" } })
  return count === 1
}

/** paused -> running, then start what the free slots allow. */
export async function resumeBatch(batchId: string, deps: PumpDeps = {}): Promise<boolean> {
  const { count } = await prisma.migrationBatch.updateMany({ where: { id: batchId, status: "paused" }, data: { status: "running" } })
  if (count !== 1) return false
  await pumpBatch(batchId, deps)
  return true
}

/**
 * Cancel every job of the batch that has not started; the running ones
 * carry on (each can still be cancelled on its own). The batch is closed:
 * nothing of it will start any more. Returns the number of jobs cancelled.
 */
export async function cancelQueuedJobs(batchId: string, now: Date = new Date(), error?: string): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await lockBatch(tx, batchId)
    const { count } = await tx.migrationJob.updateMany({
      where: { batchId, status: QUEUED_STATUS },
      data: { status: "cancelled", currentStep: "cancelled", completedAt: now, ...(error && { error }) },
    })
    await tx.migrationBatch.updateMany({ where: { id: batchId, status: { in: OPEN_BATCH_STATUSES } }, data: { status: "cancelled" } })
    return count
  })
}

/** One pass over every running batch. */
export async function pumpRunningBatches(deps: PumpDeps = {}): Promise<number> {
  const batches = await prisma.migrationBatch.findMany({ where: { status: "running" }, select: { id: true } })
  let started = 0
  for (const b of batches) {
    try {
      started += (await pumpBatch(b.id, deps)).started.length
    } catch (err) {
      console.error(`[migration-batch] pump of batch ${b.id} failed:`, err)
    }
  }
  return started
}

let timer: ReturnType<typeof setInterval> | null = null
let inFlight = false

/**
 * Every BATCH_PUMP_INTERVAL_MS, the holder of the `migration-batches` lease
 * pumps every running batch: a batch survives a restart, and a pump lost to a
 * crash between a job end and its pump is caught up. One process pumps at a
 * time (HA replicas, several dev servers on one database); the row lock of
 * pumpBatch() keeps it consistent with the job-end pumps of the others.
 */
export function startBatchPump(): void {
  if (timer) return
  const holder = resolveInstanceId()
  const tick = async () => {
    if (inFlight) return
    inFlight = true
    try {
      if (!(await tryAcquireLease(LEASE_NAME, holder, LEASE_TTL_MS))) return
      const started = await pumpRunningBatches()
      if (started > 0) console.log(`[migration-batch] started ${started} queued job(s)`)
    } catch (err) {
      console.error("[migration-batch] periodic pump failed:", err)
    } finally {
      inFlight = false
    }
  }
  timer = setInterval(() => { void tick() }, BATCH_PUMP_INTERVAL_MS)
  timer.unref?.()
  // First pass soon after boot, once the orphan sweep has failed what died with the previous process.
  setTimeout(() => { void tick() }, 5_000).unref?.()
  process.once("beforeExit", () => { releaseLease(LEASE_NAME, holder).catch(() => {}) })
}

/** Test hook: stop the timer started by startBatchPump(). */
export function stopBatchPump(): void {
  if (timer) clearInterval(timer)
  timer = null
}
