import { NextResponse } from "next/server"

import { loadBatchForCaller } from "@/lib/migration/batch-access"
import { parseBatchSelection } from "@/lib/migration/batch-selection"
import { SYNC_INTERVAL_VALUE_ERROR, canSetSyncInterval, readRequestedSyncInterval, setJobSyncInterval } from "@/lib/migration/warm/set-sync-interval"
import { audit } from "@/lib/audit"
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"

interface SkippedJob { jobId: string; sourceVmName: string | null; status: string; error?: string }
interface BatchJob { id: string; sourceVmName: string | null; status: string; cutoverRequestedAt: Date | null; config: unknown }

/**
 * POST /api/v1/migrations/batches/[id]/sync-interval
 * `{ syncIntervalSec: number | null, jobIds?: string[] }`: change the interval
 * between two syncs of the migrations of a batch that wait for a manual
 * cutover, all of them or the ones named. `null` puts them back on the setting
 * of the source connection. The answer lists the migrations changed and the
 * ones left alone with their state.
 */
async function handlePost(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const access = await loadBatchForCaller(id)
    if (access.ok === false) return access.response

    const body = await req.json().catch(() => null) as { jobIds?: unknown } | null
    const requested = readRequestedSyncInterval(body)
    if (requested === undefined) return NextResponse.json({ error: SYNC_INTERVAL_VALUE_ERROR }, { status: 400 })

    const jobs = await access.prisma.migrationJob.findMany({
      where: { batchId: id },
      select: { id: true, sourceVmName: true, status: true, cutoverRequestedAt: true, config: true },
      orderBy: [{ batchOrder: "asc" }, { createdAt: "asc" }],
    }) as BatchJob[]
    const parsed = parseBatchSelection(body?.jobIds, jobs.map(j => j.id))
    if (parsed.ok === false) return NextResponse.json({ error: parsed.error }, { status: 400 })

    const updated: string[] = []
    const skipped: SkippedJob[] = []
    for (const job of jobs) {
      if (parsed.selection && !parsed.selection.has(job.id)) continue
      const entry = { jobId: job.id, sourceVmName: job.sourceVmName, status: job.status }
      if (!canSetSyncInterval(job)) { skipped.push(entry); continue }
      try {
        await setJobSyncInterval(access.prisma, job, requested)
        updated.push(job.id)
      } catch (e: any) {
        // One row that cannot be written must not leave the rest of the wave unchanged.
        skipped.push({ ...entry, error: e?.message || String(e) })
      }
    }
    const nameOf = new Map(jobs.map(j => [j.id, j.sourceVmName]))
    await audit({
      category: "migration", action: "update", resourceType: "batch", resourceId: id, status: "success",
      details: { operation: "sync-interval", syncIntervalSec: requested, updated: updated.map(jobId => ({ jobId, sourceVmName: nameOf.get(jobId) ?? null })), skipped },
    }).catch(() => {})
    return NextResponse.json({ data: { updated, skipped } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export const POST = withAudit({ category: "migration", resourceType: "batch", resourceParam: "id", action: "update" }, handlePost)
