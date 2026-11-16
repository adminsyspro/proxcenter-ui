import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"

import { hasServerFeature } from "@/lib/auth/requireEnterprise"
import { Features } from "@/lib/license/features"
import { loadBatchForCaller } from "@/lib/migration/batch-access"
import { parseCopyRateLimit } from "@/lib/migration/warm/copy-rate"
import {
  COPY_RATE_BATCH_ERROR, COPY_RATE_FEATURE_ERROR, COPY_RATE_VALUE_ERROR, canSetBatchCopyRate, readRequestedCopyRate,
} from "@/lib/migration/warm/set-copy-rate"
import { audit } from "@/lib/audit"
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/v1/migrations/batches/[id]/copy-rate
 * The copy rate cap of a batch, shared by its jobs while they copy, with the
 * cap of the source connection's hosts.
 */
export async function GET(_req: Request, { params }: Params) {
  try {
    const { id } = await params
    const access = await loadBatchForCaller(id)
    if (access.ok === false) return access.response
    const row = await access.prisma.migrationBatch.findUnique({ where: { id }, select: { copyRateLimit: true } })
    const conn = await access.prisma.connection.findUnique({ where: { id: access.batch.sourceConnectionId }, select: { migrationCopyRateLimitPerHostMBps: true } })
    return NextResponse.json({
      data: {
        copyRateLimit: parseCopyRateLimit(row?.copyRateLimit) ?? null,
        perHostMbps: conn?.migrationCopyRateLimitPerHostMBps || null,
        editable: canSetBatchCopyRate(access.batch),
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

/**
 * POST /api/v1/migrations/batches/[id]/copy-rate
 * `{ copyRateLimit: CopyRateLimit | null }`: change the cap of a running or
 * paused batch, or remove it. Every copy of the batch picks the change up
 * within one round of its governor (10 s).
 */
async function handlePost(req: Request, { params }: Params) {
  try {
    const { id } = await params
    const access = await loadBatchForCaller(id)
    if (access.ok === false) return access.response
    const requested = readRequestedCopyRate(await req.json().catch(() => null))
    if (requested === undefined) return NextResponse.json({ error: COPY_RATE_VALUE_ERROR }, { status: 400 })
    if (!canSetBatchCopyRate(access.batch)) return NextResponse.json({ error: COPY_RATE_BATCH_ERROR }, { status: 409 })
    if (!(await hasServerFeature(Features.VMWARE_MIGRATION))) return NextResponse.json({ error: COPY_RATE_FEATURE_ERROR }, { status: 403 })

    await access.prisma.migrationBatch.update({ where: { id }, data: { copyRateLimit: requested ?? Prisma.DbNull } })
    await audit({
      category: "migration", action: "update", resourceType: "batch", resourceId: id, status: "success",
      details: { operation: "copy-rate", copyRateLimit: requested },
    }).catch(() => {})
    return NextResponse.json({ data: { copyRateLimit: requested } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export const POST = withAudit({ category: "migration", resourceType: "batch", resourceParam: "id", action: "update" }, handlePost)
