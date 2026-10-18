import { NextResponse } from "next/server"

import { loadBatchForCaller } from "@/lib/migration/batch-access"
import { cancelQueuedJobs, OPEN_BATCH_STATUSES } from "@/lib/migration/batch-scheduler"

export const runtime = "nodejs"

/**
 * POST /api/v1/migrations/batches/[id]/cancel-queued
 * Cancel the jobs of the batch that have not started and close it. Running
 * jobs carry on; each one is cancelled through POST /api/v1/migrations/[id]/cancel.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const access = await loadBatchForCaller(id)
    if (access.ok === false) return access.response
    if (!(OPEN_BATCH_STATUSES as string[]).includes(access.batch.status)) {
      return NextResponse.json({ error: `Cannot cancel the queue of a ${access.batch.status} batch` }, { status: 409 })
    }
    const cancelled = await cancelQueuedJobs(id)
    return NextResponse.json({ data: { status: "cancelled", cancelled } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
