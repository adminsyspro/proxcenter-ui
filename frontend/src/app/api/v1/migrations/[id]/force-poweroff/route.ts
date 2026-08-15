import { NextResponse } from "next/server"

import { getSessionPrisma } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { requestWarmForcePowerOff } from "@/lib/migration/warm/warm-pipeline"

export const runtime = "nodejs"

/**
 * The pipeline only listens for this while it is waiting on a powered-off source,
 * which it advertises with this step. Gating on the step rather than the status
 * covers both callers: the cutover (status "cutover") and the checksum fallback
 * that shuts the source down before copying (status "full_copy").
 */
const FORCE_POWER_OFF_STEP = "awaiting_power_off"

/**
 * POST /api/v1/migrations/[id]/force-poweroff
 * Stop waiting for a clean guest shutdown and power the source off hard.
 *
 * Never automatic: a hard power off makes the final delta crash-consistent, so
 * the decision belongs to the operator (#614).
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const prisma = await getSessionPrisma()
    const denied = await checkPermission(PERMISSIONS.VM_MIGRATE)
    if (denied) return denied

    const { id } = await params
    const job = await prisma.migrationJob.findUnique({ where: { id } })
    if (!job) return NextResponse.json({ error: "Migration job not found" }, { status: 404 })
    if (job.currentStep !== FORCE_POWER_OFF_STEP) {
      return NextResponse.json({ error: "This migration is not waiting for the source to power off" }, { status: 400 })
    }

    requestWarmForcePowerOff(id)
    return NextResponse.json({ data: { status: "force_power_off_requested" } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
