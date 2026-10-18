import { NextResponse } from "next/server"

import { loadBatchForCaller } from "@/lib/migration/batch-access"
import { pauseBatch } from "@/lib/migration/batch-scheduler"

export const runtime = "nodejs"

/**
 * POST /api/v1/migrations/batches/[id]/pause
 * Stop starting the queued jobs of a running batch; the started ones carry on.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const access = await loadBatchForCaller(id)
    if (access.ok === false) return access.response
    if (!(await pauseBatch(id))) {
      return NextResponse.json({ error: `Cannot pause a ${access.batch.status} batch` }, { status: 409 })
    }
    return NextResponse.json({ data: { status: "paused" } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
