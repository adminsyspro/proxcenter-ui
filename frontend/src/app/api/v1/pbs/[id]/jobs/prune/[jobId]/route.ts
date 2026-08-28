import {
  deletePbsJobConfig,
  updatePbsJobConfig,
  type PbsJobRouteContext,
} from "@/lib/proxmox/pbsJobConfig"
import { PRUNE_JOB } from "@/lib/proxmox/pbsJobSpecs"

export const runtime = "nodejs"

/**
 * PUT /api/v1/pbs/[id]/jobs/prune/[jobId]
 * Met à jour un Prune Job
 */
export async function PUT(req: Request, ctx: PbsJobRouteContext) {
  return updatePbsJobConfig(req, ctx, PRUNE_JOB)
}

/**
 * DELETE /api/v1/pbs/[id]/jobs/prune/[jobId]
 * Supprime un Prune Job
 */
export async function DELETE(req: Request, ctx: PbsJobRouteContext) {
  return deletePbsJobConfig(req, ctx, PRUNE_JOB)
}
