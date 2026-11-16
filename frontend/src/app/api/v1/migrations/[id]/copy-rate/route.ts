import { NextResponse } from "next/server"

import { getSessionPrisma } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { hasServerFeature } from "@/lib/auth/requireEnterprise"
import { Features } from "@/lib/license/features"
import { migrateScope, scopedJobWhere } from "@/lib/migration/authorize"
import { parseCopyRateLimit } from "@/lib/migration/warm/copy-rate"
import { HEARTBEAT_TTL_MS, resolveCopyRateShare, type GovernorDb } from "@/lib/migration/warm/copy-rate-governor"
import {
  COPY_RATE_BATCH_JOB_ERROR, COPY_RATE_FEATURE_ERROR, COPY_RATE_JOB_ERROR, COPY_RATE_VALUE_ERROR, canSetCopyRate, readRequestedCopyRate, setJobCopyRate,
} from "@/lib/migration/warm/set-copy-rate"
import { jobConfigOf } from "@/lib/migration/warm/set-sync-interval"
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string }> }

/** The job, for a caller allowed to migrate between its two ends; a Response otherwise. */
async function loadJob(id: string) {
  const denied = await checkPermission(PERMISSIONS.VM_MIGRATE)
  if (denied) return { denied }
  const prisma = await getSessionPrisma()
  const job = await prisma.migrationJob.findFirst({ where: scopedJobWhere({ id }, await migrateScope()) })
  if (!job) return { denied: NextResponse.json({ error: "Migration job not found" }, { status: 404 }) }
  return { prisma, job }
}

/**
 * GET /api/v1/migrations/[id]/copy-rate
 * The copy rate cap of a warm migration: its own, or its batch's for a job of
 * a batch, with the cap of its source host and the share it copies at right
 * now (null while it does not copy). Read with the right to migrate, like the
 * sync interval.
 */
export async function GET(_req: Request, { params }: Params) {
  try {
    const { id } = await params
    const found = await loadJob(id)
    if (found.denied) return found.denied
    const { prisma, job } = found
    const batch = job.batchId
      ? await prisma.migrationBatch.findUnique({ where: { id: job.batchId }, select: { copyRateLimit: true } })
      : null
    const own = job.batchId ? batch?.copyRateLimit : jobConfigOf(job).copyRateLimit
    const conn = await prisma.connection.findUnique({ where: { id: job.sourceConnectionId }, select: { migrationCopyRateLimitPerHostMBps: true } })
    const now = new Date()
    const copying = job.copyActiveAt instanceof Date && now.getTime() - job.copyActiveAt.getTime() < HEARTBEAT_TTL_MS
    const effectiveMbps = copying ? (await resolveCopyRateShare(prisma as unknown as GovernorDb, job.id, now)).mbps : null
    return NextResponse.json({
      data: {
        copyRateLimit: parseCopyRateLimit(own) ?? null,
        scope: job.batchId ? "batch" : "job",
        batchId: job.batchId ?? null,
        perHostMbps: conn?.migrationCopyRateLimitPerHostMBps || null,
        effectiveMbps,
        editable: canSetCopyRate(job),
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

/**
 * PATCH /api/v1/migrations/[id]/copy-rate
 * `{ copyRateLimit: CopyRateLimit | null }`: change the cap of a single warm
 * migration while it runs, or remove it. A job of a batch shares its batch's
 * cap, changed on the batch. The running copy picks the change up within one
 * round of its governor.
 */
async function handlePatch(req: Request, { params }: Params) {
  try {
    const { id } = await params
    const found = await loadJob(id)
    if (found.denied) return found.denied
    const { prisma, job } = found
    const requested = readRequestedCopyRate(await req.json().catch(() => null))
    if (requested === undefined) return NextResponse.json({ error: COPY_RATE_VALUE_ERROR }, { status: 400 })
    if (!canSetCopyRate(job)) return NextResponse.json({ error: COPY_RATE_JOB_ERROR }, { status: 400 })
    if (job.batchId) return NextResponse.json({ error: COPY_RATE_BATCH_JOB_ERROR }, { status: 409 })
    if (!(await hasServerFeature(Features.VMWARE_MIGRATION))) return NextResponse.json({ error: COPY_RATE_FEATURE_ERROR }, { status: 403 })

    await setJobCopyRate(prisma, job, requested)
    return NextResponse.json({ data: { copyRateLimit: requested } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export const PATCH = withAudit({ category: "migration", resourceType: "migration", resourceParam: "id", action: "update" }, handlePatch)
