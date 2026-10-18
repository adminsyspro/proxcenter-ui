import { NextResponse } from "next/server"

import { batchWithJobs, loadBatchForCaller } from "@/lib/migration/batch-access"

export const runtime = "nodejs"

/**
 * GET /api/v1/migrations/batches/[id]
 * A bulk migration and its jobs (status, progress, logs), in batch order.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const access = await loadBatchForCaller(id)
    if (access.ok === false) return access.response
    return NextResponse.json({ data: await batchWithJobs(access.prisma, access.batch) })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
