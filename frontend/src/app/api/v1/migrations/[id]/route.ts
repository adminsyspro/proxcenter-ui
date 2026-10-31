import { NextResponse } from "next/server"

import { getSessionPrisma } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { migrateScope, scopedJobWhere } from "@/lib/migration/authorize"
import { serializeMigrationJob } from "@/lib/migration/batch-access"
import { parseLogOffset } from "@/lib/migration/jobLogs"

export const runtime = "nodejs"

/**
 * GET /api/v1/migrations/[id]
 * Get migration job status + progress + logs. ?after=<n>: the caller already
 * has the first n log lines, only the following ones come back.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const prisma = await getSessionPrisma()
    const denied = await checkPermission(PERMISSIONS.VM_MIGRATE)
    if (denied) return denied

    const { id } = await params
    const job = await prisma.migrationJob.findFirst({ where: scopedJobWhere({ id }, await migrateScope()) })

    if (!job) {
      return NextResponse.json({ error: "Migration job not found" }, { status: 404 })
    }

    return NextResponse.json({ data: serializeMigrationJob(job, parseLogOffset(new URL(req.url).searchParams.get("after"))) })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
