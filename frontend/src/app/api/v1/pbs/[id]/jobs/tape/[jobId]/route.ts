import {
  deletePbsJobConfig,
  updatePbsJobConfig,
  type PbsJobRouteContext,
} from "@/lib/proxmox/pbsJobConfig"
import { TAPE_JOB } from "@/lib/proxmox/pbsJobSpecs"

export const runtime = "nodejs"

/**
 * PUT /api/v1/pbs/[id]/jobs/tape/[jobId]
 * Met à jour un Tape Backup Job
 */
export async function PUT(req: Request, ctx: PbsJobRouteContext) {
  return updatePbsJobConfig(req, ctx, TAPE_JOB)
}

/**
 * DELETE /api/v1/pbs/[id]/jobs/tape/[jobId]
 * Supprime un Tape Backup Job
 */
export async function DELETE(req: Request, ctx: PbsJobRouteContext) {
  return deletePbsJobConfig(req, ctx, TAPE_JOB)
}
