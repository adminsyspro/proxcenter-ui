import {
  deletePbsJobConfig,
  updatePbsJobConfig,
  type PbsJobRouteContext,
} from "@/lib/proxmox/pbsJobConfig"
import { VERIFY_JOB } from "@/lib/proxmox/pbsJobSpecs"
import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"

export const runtime = "nodejs"

/**
 * PUT /api/v1/pbs/[id]/jobs/verify/[jobId]
 * Met à jour un Verify Job
 */
async function putHandler(req: Request, ctx: PbsJobRouteContext) {
  return updatePbsJobConfig(req, ctx, VERIFY_JOB)
}

/**
 * DELETE /api/v1/pbs/[id]/jobs/verify/[jobId]
 * Supprime un Verify Job
 */
async function deleteHandler(req: Request, ctx: PbsJobRouteContext) {
  return deletePbsJobConfig(req, ctx, VERIFY_JOB)
}

export const PUT = withPublicApiGuard("pbs-job-verify-update", putHandler)
export const DELETE = withPublicApiGuard("pbs-job-verify-delete", deleteHandler)
