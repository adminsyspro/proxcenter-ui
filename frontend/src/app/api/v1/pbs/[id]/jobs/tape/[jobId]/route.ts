import {
  deletePbsJobConfig,
  updatePbsJobConfig,
  type PbsJobRouteContext,
} from "@/lib/proxmox/pbsJobConfig"
import { TAPE_JOB } from "@/lib/proxmox/pbsJobSpecs"
import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"

export const runtime = "nodejs"

/**
 * PUT /api/v1/pbs/[id]/jobs/tape/[jobId]
 * Met à jour un Tape Backup Job
 */
async function putHandler(req: Request, ctx: PbsJobRouteContext) {
  return updatePbsJobConfig(req, ctx, TAPE_JOB)
}

/**
 * DELETE /api/v1/pbs/[id]/jobs/tape/[jobId]
 * Supprime un Tape Backup Job
 */
async function deleteHandler(req: Request, ctx: PbsJobRouteContext) {
  return deletePbsJobConfig(req, ctx, TAPE_JOB)
}

export const PUT = withPublicApiGuard("pbs-job-tape-update", putHandler)
export const DELETE = withPublicApiGuard("pbs-job-tape-delete", deleteHandler)
