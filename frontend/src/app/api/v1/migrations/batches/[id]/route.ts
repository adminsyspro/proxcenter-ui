import { NextResponse } from "next/server"

import { batchWithJobs, loadBatchForCaller } from "@/lib/migration/batch-access"
import { parseLogOffsets } from "@/lib/migration/jobLogs"

export const runtime = "nodejs"

/**
 * GET /api/v1/migrations/batches/[id]
 * A bulk migration and its jobs (status, progress, logs), in batch order.
 * ?logsAfter=<n>,<n>,... (one count per job, batch order): the lines each job
 * already shown, only the new ones come back (see batchWithJobs).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const access = await loadBatchForCaller(id)
    if (access.ok === false) return access.response
    const logsAfter = parseLogOffsets(new URL(req.url).searchParams.get("logsAfter"))
    return NextResponse.json({ data: await batchWithJobs(access.prisma, access.batch, logsAfter) })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
