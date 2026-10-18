import { NextResponse } from "next/server"

import { loadBatchForCaller } from "@/lib/migration/batch-access"
import { resumeBatch } from "@/lib/migration/batch-scheduler"

export const runtime = "nodejs"

/**
 * POST /api/v1/migrations/batches/[id]/resume
 * Start the queued jobs of a paused batch again, as many as its concurrency allows.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const access = await loadBatchForCaller(id)
    if (access.ok === false) return access.response
    if (!(await resumeBatch(id))) {
      return NextResponse.json({ error: `Cannot resume a ${access.batch.status} batch` }, { status: 409 })
    }
    return NextResponse.json({ data: { status: "running" } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
