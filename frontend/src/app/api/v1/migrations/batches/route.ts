import { NextResponse, after } from "next/server"
import { getServerSession } from "next-auth"

import { getSessionPrisma, getCurrentTenantId } from "@/lib/tenant"
import { prisma as globalPrisma } from "@/lib/db/prisma"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { NicConfigError } from "@/lib/rbac/nicPermissions"
import { authOptions } from "@/lib/auth/config"
import { canMigrateConnections, getTenantInfrastructureScope } from "@/lib/tenant/infraScope"
import { validateMigrationRequest, type ValidatedMigration } from "@/lib/migration/validate-request"
import { OPEN_BATCH_STATUSES, QUEUED_STATUS, pumpBatch } from "@/lib/migration/batch-scheduler"
import { batchCounts } from "@/lib/migration/batch-access"
import { checkBatchSpaceForRequest, requestDiskBytes } from "@/lib/migration/batch-space"
import { checkBatchCopyNetwork } from "@/lib/migration/batch-copy-reach"
import { TERMINAL_STATUSES } from "@/lib/tasks/sharedTask"
import { BULK_MIG_CONCURRENCY_MAX, BULK_MIG_CONCURRENCY_MIN } from "@/app/(dashboard)/infrastructure/inventory/bulkMigrationConfig"

export const runtime = "nodejs"

/** A batch above this size is refused: one request validates every VM. */
export const MAX_BATCH_VMS = 500

/** Per-VM fields of a batch; everything else in the body is shared by the whole batch. */
const PER_VM_FIELDS = ["sourceVmId", "sourceVmName", "targetNode", "vcenterDatacenter", "vcenterCluster", "vcenterHost", "diskBytes"] as const

/**
 * POST /api/v1/migrations/batches
 * Create a bulk migration (roadmap#53): every VM becomes a "queued" job with
 * its full config, and the server starts them `concurrency` at a time.
 * Body: the fields of POST /api/v1/migrations shared by the batch, plus
 * `concurrency` and `vms: [{ sourceVmId, sourceVmName, targetNode,
 * vcenterDatacenter?, vcenterCluster?, vcenterHost?, diskBytes? }]`; the
 * target storage must hold the batch (lib/migration/batch-space: exact sizes
 * read from the source, `diskBytes` the estimate when one cannot be read). Each VM passes the
 * checks of POST /api/v1/migrations; the first refusal is returned with the
 * VM's id and nothing is created.
 */
export async function POST(req: Request) {
  try {
    const prisma = await getSessionPrisma()
    const denied = await checkPermission(PERMISSIONS.VM_MIGRATE)
    if (denied) return denied

    const session = await getServerSession(authOptions)
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })

    const concurrency = Number(body.concurrency ?? BULK_MIG_CONCURRENCY_MIN)
    if (!Number.isInteger(concurrency) || concurrency < BULK_MIG_CONCURRENCY_MIN || concurrency > BULK_MIG_CONCURRENCY_MAX) {
      return NextResponse.json({ error: `concurrency must be an integer between ${BULK_MIG_CONCURRENCY_MIN} and ${BULK_MIG_CONCURRENCY_MAX}` }, { status: 400 })
    }
    const vms: Array<Record<string, unknown>> = Array.isArray(body.vms) ? body.vms : []
    if (vms.length === 0 || vms.length > MAX_BATCH_VMS || vms.some(vm => !vm || typeof vm !== "object")) {
      return NextResponse.json({ error: `vms must list between 1 and ${MAX_BATCH_VMS} VMs` }, { status: 400 })
    }
    // A batch puts every VM on one storage (its space check reasons on it):
    // per-disk placement (#317) is a single-VM choice, refused rather than
    // applied by disk position to VMs whose disks were never reviewed.
    if (body.disks !== undefined || vms.some(vm => vm.disks !== undefined)) {
      return NextResponse.json({ error: "disks (per-disk storage) is not available for a batch: every VM of a batch goes to targetStorage" }, { status: 400 })
    }
    const ids = vms.map(vm => String(vm.sourceVmId ?? ""))
    if (new Set(ids).size !== ids.length) {
      return NextResponse.json({ error: "A VM appears twice in the batch" }, { status: 400 })
    }

    const { vms: _vms, concurrency: _c, ...shared } = body
    for (const f of PER_VM_FIELDS) delete shared[f]

    const tenantId = await getCurrentTenantId()
    const validated: ValidatedMigration[] = []
    for (const vm of vms) {
      const perVm: Record<string, unknown> = {}
      for (const f of PER_VM_FIELDS) if (vm[f] !== undefined) perVm[f] = vm[f]
      const result = await validateMigrationRequest({ ...shared, ...perVm }, { prisma, tenantId })
      if (result.ok === false) {
        const payload = await result.response.json().catch(() => ({ error: "Invalid request" }))
        return NextResponse.json({ ...payload, sourceVmId: perVm.sourceVmId ?? null }, { status: result.response.status })
      }
      validated.push(result.value)
    }

    const first = validated[0]
    // The batch checks below read the source's VMs and the target's storage and
    // nodes with the credentials stored on both connections, like the
    // space-check and copy-check routes: same right to view each of them.
    for (const id of new Set([first.sourceConnectionId, first.targetConnectionId])) {
      const deniedView = await checkPermission(PERMISSIONS.CONNECTION_VIEW, "connection", id)
      if (deniedView) return deniedView
    }
    // Warm VMware: every VM's node must reach the copy adapter of its source
    // host (lib/migration/batch-copy-reach), or its job fails at planning.
    if (first.config.migrationType === "warm" && first.sourceConn.type === "vmware") {
      const copy = await checkBatchCopyNetwork({
        tenantId, sourceConnectionId: first.sourceConnectionId, targetConnectionId: first.targetConnectionId,
        pinnedDevice: typeof first.config.copyVmk === "string" ? first.config.copyVmk : undefined,
        vms: validated.map(v => ({ sourceVmId: v.sourceVmId, name: v.sourceVmName || v.sourceVmId })),
        candidates: [...new Set(validated.map(v => v.targetNode))],
        auto: false,
        requested: Object.fromEntries(validated.map(v => [v.sourceVmId, v.targetNode])),
      })
      if (copy.problems.length) {
        return NextResponse.json({ error: copy.problems.map(p => p.message).join("; "), problems: copy.problems }, { status: 400 })
      }
    }
    // The target storage must hold the whole batch, not each VM on its own
    // (each job still checks its own disks at planning time).
    const space = await checkBatchSpaceForRequest({
      tenantId, sourceConnectionId: first.sourceConnectionId, targetConnectionId: first.targetConnectionId, storage: first.targetStorage,
      vms: validated.map((v, i) => ({ sourceVmId: v.sourceVmId, targetNode: v.targetNode, estimatedBytes: requestDiskBytes(vms[i].diskBytes) })),
    })
    if (!space.ok) {
      return NextResponse.json({ error: space.problems.map(p => p.message).join("; "), problems: space.problems }, { status: 400 })
    }
    const createdBy = session?.user?.id || null
    const { batch, jobIds } = await prisma.$transaction(async (tx: any) => {
      const batch = await tx.migrationBatch.create({
        data: { tenantId, createdBy, sourceConnectionId: first.sourceConnectionId, targetConnectionId: first.targetConnectionId, concurrency, status: "running" },
      })
      const jobIds: string[] = []
      for (const [batchOrder, v] of validated.entries()) {
        const job = await tx.migrationJob.create({
          data: {
            tenantId,
            sourceConnectionId: v.sourceConnectionId,
            sourceVmId: v.sourceVmId,
            sourceVmName: v.sourceVmName,
            sourceHost: v.sourceHost,
            targetConnectionId: v.targetConnectionId,
            targetNode: v.targetNode,
            targetStorage: v.targetStorage,
            config: v.config,
            // Not started: no startedAt and no owner until the scheduler claims it.
            status: QUEUED_STATUS,
            currentStep: QUEUED_STATUS,
            createdBy,
            batchId: batch.id,
            batchOrder,
          },
          select: { id: true },
        })
        jobIds.push(job.id)
      }
      return { batch, jobIds }
    })

    after(async () => {
      await pumpBatch(batch.id).catch(err => console.error(`[migration-batch] first pump of batch ${batch.id} failed:`, err))
    })

    return NextResponse.json({ data: { batchId: batch.id, jobIds } })
  } catch (e: any) {
    if (e instanceof NicConfigError) return NextResponse.json({ error: e.message }, { status: 400 })
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

/**
 * GET /api/v1/migrations/batches?active=1&sourceConnectionId=...
 * The caller's batches, newest first. `active=1` keeps the ones still open
 * (running or paused) or with a job still running, which is what the
 * follow-up dialog reopens on.
 */
export async function GET(req: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.VM_MIGRATE)
    if (denied) return denied
    const prisma = await getSessionPrisma()
    const tenantId = await getCurrentTenantId()
    const { searchParams } = new URL(req.url)
    const active = searchParams.get("active") === "1"
    const sourceConnectionId = searchParams.get("sourceConnectionId")

    const where: Record<string, unknown> = {}
    if (sourceConnectionId) where.sourceConnectionId = sourceConnectionId
    if (active) {
      where.OR = [
        { status: { in: OPEN_BATCH_STATUSES } },
        { jobs: { some: { status: { notIn: [...TERMINAL_STATUSES, QUEUED_STATUS] } } } },
      ]
    }
    const batches = await prisma.migrationBatch.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { jobs: { select: { status: true } } },
    })
    const infra = await getTenantInfrastructureScope(tenantId)
    const visible = batches.filter((b: any) => canMigrateConnections(infra, b.sourceConnectionId, b.targetConnectionId))
    // Source hypervisor of each batch, for the icon of its taskbar entry. Read
    // with the global client: a provider batch may come from a connection an
    // MSP tenant owns, and only the type of a connection the batch already
    // names is returned.
    const sources = visible.length === 0 ? [] : await globalPrisma.connection.findMany({
      where: { id: { in: [...new Set<string>(visible.map((b: any) => String(b.sourceConnectionId)))] } },
      select: { id: true, type: true, subType: true },
    })
    const typeById = new Map(sources.map(c => [c.id, c.type === "vmware" && c.subType === "vcenter" ? "vcenter" : c.type]))
    return NextResponse.json({
      data: visible.map(({ jobs, ...b }: any) => ({ ...b, sourceType: typeById.get(b.sourceConnectionId) ?? null, total: jobs.length, counts: batchCounts(jobs) })),
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
