import { NextResponse } from "next/server"

import { getSessionPrisma } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { requestV2vRootChoice } from "@/lib/migration/v2v-pipeline"

export const runtime = "nodejs"

/**
 * The pipeline only polls for this choice while guest inspection has parked on
 * several bootable roots, which it advertises with this step. The status stays
 * "converting_disks" throughout, so the step is the only reliable gate (#738).
 */
const ROOT_CHOICE_STEP = "awaiting_root_choice"

/**
 * POST /api/v1/migrations/[id]/root-choice
 * Body: { root: "/dev/sda1" }
 *
 * Tell a parked cold v2v conversion which root filesystem to convert. The
 * value reaches a shell command line on the Proxmox node, so it is checked
 * against the candidate list the pipeline recorded when it parked: an
 * allowlist, not sanitization.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const prisma = await getSessionPrisma()
    const denied = await checkPermission(PERMISSIONS.VM_MIGRATE)
    if (denied) return denied

    const body = await req.json().catch(() => null)
    const root = typeof body?.root === "string" ? body.root.trim() : ""
    if (!root) {
      return NextResponse.json({ error: "A non-empty root device is required" }, { status: 400 })
    }

    const { id } = await params
    const job = await prisma.migrationJob.findUnique({
      where: { id },
      select: { id: true, status: true, currentStep: true, config: true },
    })
    if (!job) return NextResponse.json({ error: "Migration job not found" }, { status: 404 })
    if (job.currentStep !== ROOT_CHOICE_STEP) {
      return NextResponse.json({ error: "Cannot choose a root filesystem for a job that is not waiting for one" }, { status: 400 })
    }

    const candidates = (job.config as any)?.v2vRootCandidates
    const allowed = Array.isArray(candidates)
      ? candidates.some((c: any) => typeof c?.device === "string" && c.device.trim() === root)
      : false
    if (!allowed) {
      return NextResponse.json({ error: "The root device must be one of the candidates listed for this job" }, { status: 400 })
    }

    if (!requestV2vRootChoice(id, root)) {
      return NextResponse.json({ error: "The pipeline rejected this root device" }, { status: 400 })
    }
    return NextResponse.json({ data: { status: "root_choice_requested", root } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
