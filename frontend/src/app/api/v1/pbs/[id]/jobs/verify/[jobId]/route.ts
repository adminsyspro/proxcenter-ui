import {
  deletePbsJobConfig,
  updatePbsJobConfig,
  type PbsJobRouteContext,
} from "@/lib/proxmox/pbsJobConfig"
import { VERIFY_JOB } from "@/lib/proxmox/pbsJobSpecs"

export const runtime = "nodejs"

/**
 * PUT /api/v1/pbs/[id]/jobs/verify/[jobId]
 * Met à jour un Verify Job
 */
export async function PUT(req: Request, ctx: PbsJobRouteContext) {
  return updatePbsJobConfig(req, ctx, VERIFY_JOB)
}

/**
 * DELETE /api/v1/pbs/[id]/jobs/verify/[jobId]
 * Supprime un Verify Job
 */
export async function DELETE(req: Request, ctx: PbsJobRouteContext) {
  return deletePbsJobConfig(req, ctx, VERIFY_JOB)
}
