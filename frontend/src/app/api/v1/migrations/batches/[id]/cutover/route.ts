import { NextResponse } from "next/server"

import { loadBatchForCaller } from "@/lib/migration/batch-access"
import { parseBatchSelection } from "@/lib/migration/batch-selection"
import { CUTOVER_ELIGIBLE, requestJobCutover } from "@/lib/migration/warm/request-cutover"
import { audit } from "@/lib/audit"
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"

interface SkippedJob { jobId: string; sourceVmName: string | null; status: string; error?: string }

/**
 * POST /api/v1/migrations/batches/[id]/cutover
 * Cut over the warm migrations of a batch that wait for it, all of them or the
 * ones named in `{ jobIds: string[] }`. Each one is asked the way the single
 * route asks it, with the guest conversion chosen at launch. The answer lists
 * the migrations cut over and the ones left alone with their state, so a wave
 * half replicated says which VMs are not ready yet.
 */
async function handlePost(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const access = await loadBatchForCaller(id)
    if (access.ok === false) return access.response

    const body = await req.json().catch(() => null) as { jobIds?: unknown } | null
    const jobs = await access.prisma.migrationJob.findMany({
      where: { batchId: id },
      select: { id: true, sourceVmName: true, status: true },
      orderBy: [{ batchOrder: "asc" }, { createdAt: "asc" }],
    }) as Array<{ id: string; sourceVmName: string | null; status: string }>
    const parsed = parseBatchSelection(body?.jobIds, jobs.map(j => j.id))
    if (parsed.ok === false) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const selection = parsed.selection

    const requested: string[] = []
    const skipped: SkippedJob[] = []
    for (const job of jobs) {
      if (selection && !selection.has(job.id)) continue
      const entry = { jobId: job.id, sourceVmName: job.sourceVmName, status: job.status }
      if (!CUTOVER_ELIGIBLE.has(job.status)) { skipped.push(entry); continue }
      try {
        await requestJobCutover(access.prisma, job.id)
        requested.push(job.id)
      } catch (e: any) {
        // One row that cannot be written must not leave the rest of the wave waiting.
        skipped.push({ ...entry, error: e?.message || String(e) })
      }
    }
    // The row names the VMs cut over, not only the batch: a group cutover stops
    // source VMs, and "which ones" is what an audit is read for.
    const nameOf = new Map(jobs.map(j => [j.id, j.sourceVmName]))
    await audit({
      category: "migration", action: "run", resourceType: "batch", resourceId: id, status: "success",
      details: { operation: "cutover", requested: requested.map(jobId => ({ jobId, sourceVmName: nameOf.get(jobId) ?? null })), skipped },
    }).catch(() => {})
    return NextResponse.json({ data: { requested, skipped } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export const POST = withAudit({ category: "migration", resourceType: "batch", resourceParam: "id", action: "run" }, handlePost)
