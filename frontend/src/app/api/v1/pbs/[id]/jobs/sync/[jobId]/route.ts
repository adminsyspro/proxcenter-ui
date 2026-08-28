import {
  deletePbsJobConfig,
  updatePbsJobConfig,
  type PbsJobRouteContext,
} from "@/lib/proxmox/pbsJobConfig"
import { SYNC_JOB } from "@/lib/proxmox/pbsJobSpecs"

export const runtime = "nodejs"

/**
 * PUT /api/v1/pbs/[id]/jobs/sync/[jobId]
 * Met à jour un Sync Job
 */
export async function PUT(req: Request, ctx: PbsJobRouteContext) {
  return updatePbsJobConfig(req, ctx, SYNC_JOB)
}

/**
 * DELETE /api/v1/pbs/[id]/jobs/sync/[jobId]
 * Supprime un Sync Job
 */
export async function DELETE(req: Request, ctx: PbsJobRouteContext) {
  return deletePbsJobConfig(req, ctx, SYNC_JOB)
}
